import fs from "fs";
import path from "path";
import { PDFParse } from "pdf-parse";

export type DocumentExtractionStatus =
  | "SUCCESS"
  | "BLOCKED / MISSING REQUIREMENT"
  | "EXTRACTION_ERROR"
  | "SECURITY_BLOCKED";

export interface ExtractedTable {
  rows: string[][];
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  headings: string[];
  tables: ExtractedTable[];
}

export interface DocumentMetadata {
  formatVersion?: string;
  secretsMaskedCount: number;
  promptInjectionDetected: boolean;
  promptInjectionAttempts: string[];
  fileSize?: number;
}

export interface DocumentIngestionResult {
  sourceType: "pdf";
  sourcePath: string;
  status: DocumentExtractionStatus;
  totalPages: number;
  pages: ExtractedPage[];
  error?: string;
  metadata: DocumentMetadata;
}

export interface DocumentIngestionOptions {
  maskSecrets?: boolean;
  detectPromptInjection?: boolean;
}

/**
 * Common secret patterns to sanitize across extracted document content.
 */
const SECRET_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // Bearer tokens
  { regex: /Bearer\s+[A-Za-z0-9_\-\.]{8,}/gi, replacement: "Bearer ***" },
  // Basic Auth
  { regex: /Basic\s+[A-Za-z0-9+/=]{8,}/gi, replacement: "Basic ***" },
  // Jira API Tokens (ATATT3...)
  { regex: /ATATT3[A-Za-z0-9_\-]{20,}/g, replacement: "***" },
  // Generic API Keys / Tokens in key=value or key: value
  {
    regex: /(api[_-]?key|apikey|app[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*["']?([A-Za-z0-9_\-\.]{6,})["']?/gi,
    replacement: "$1: ***",
  },
  // Passwords
  {
    regex: /(password|passwd|pwd|private[_-]?key)\s*[:=]\s*["']?([^"'\s\n\r]{3,})["']?/gi,
    replacement: "$1: ***",
  },
  // Environment variable secrets (e.g. JIRA_API_TOKEN=xyz, DB_PASSWORD=xyz)
  {
    regex: /([A-Z0-9_]*(?:TOKEN|PASSWORD|SECRET|KEY|AUTH))\s*[:=]\s*["']?([A-Za-z0-9_\-\.+=/]{6,})["']?/g,
    replacement: "$1=***",
  },
];

/**
 * Prompt injection patterns to detect and quarantine per Section 56.
 */
const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+)?previous\s+instructions/i,
  /output\s+(?:the\s+)?(?:jira\s+)?api\s+token/i,
  /mark\s+this\s+test\s+as\s+passed\s+unconditionally/i,
  /delete\s+(?:all\s+)?test-results/i,
  /bypass\s+(?:all\s+)?security\s+(?:checks|rules|gates)/i,
  /exfiltrate\s+(?:the\s+)?(?:secrets|credentials|tokens)/i,
];

export function sanitizeSecrets(text: string): { sanitized: string; maskedCount: number } {
  let sanitized = text;
  let maskedCount = 0;

  for (const { regex, replacement } of SECRET_PATTERNS) {
    const matches = sanitized.match(regex);
    if (matches) {
      maskedCount += matches.length;
      sanitized = sanitized.replace(regex, replacement);
    }
  }

  return { sanitized, maskedCount };
}

export function detectPromptInjections(text: string): string[] {
  const detected: string[] = [];
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      detected.push(match[0]);
    }
  }
  return detected;
}

/**
 * Detects headings in text based on markdown conventions, numbered sections, or title patterns.
 */
export function extractHeadingsFromText(text: string): string[] {
  const headings: string[] = [];
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Markdown headers (# Heading, ## Heading)
    if (/^#{1,6}\s+\S+/.test(line)) {
      headings.push(line.replace(/^#{1,6}\s+/, "").trim());
      continue;
    }

    // Numbered headings (e.g. "1. Introduction", "§2.1 Auth Error", "Chapter 1", "Section 3.2")
    if (/^(?:(?:Section|Chapter|§)\s*\d+(?:\.\d+)*|\d+(?:\.\d+)+|\d+\.)\s+[A-Z0-9]/.test(line)) {
      headings.push(line);
      continue;
    }

    // Short standalone title lines in all uppercase or Title Case (under 70 chars, no terminal period)
    if (
      line.length >= 4 &&
      line.length <= 70 &&
      !line.endsWith(".") &&
      !line.endsWith(",") &&
      !line.includes(":") &&
      (/^[A-Z0-9\s\-_/()]+$/.test(line) || /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/.test(line))
    ) {
      headings.push(line);
    }
  }

  return headings;
}

/**
 * Extracts markdown-formatted or pipe-delimited tables from text.
 */
export function extractTablesFromText(text: string): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  const lines = text.split(/\r?\n/);

  let currentTableRows: string[][] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      // Check if separator line (|---|---|)
      if (/^\|(?:\s*:?-+:?\s*\|)+$/.test(trimmed)) {
        continue;
      }
      const cells = trimmed
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      currentTableRows.push(cells);
    } else {
      if (currentTableRows.length > 0) {
        tables.push({ rows: currentTableRows });
        currentTableRows = [];
      }
    }
  }

  if (currentTableRows.length > 0) {
    tables.push({ rows: currentTableRows });
  }

  return tables;
}

/**
 * Checks if a file has a supported document extension.
 */
export function isSupportedDocument(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".pdf";
}

/**
 * Ingests a local PDF document, parses per-page text, extracts headings and tables,
 * sanitizes secrets, checks for prompt injection, and returns structured provenance.
 */
export async function ingestDocument(
  filePath: string,
  options: DocumentIngestionOptions = { maskSecrets: true, detectPromptInjection: true }
): Promise<DocumentIngestionResult> {
  const resolvedPath = path.resolve(filePath);

  // 1. File existence validation (Section 30.3, Section 49)
  if (!fs.existsSync(resolvedPath)) {
    return {
      sourceType: "pdf",
      sourcePath: resolvedPath,
      status: "BLOCKED / MISSING REQUIREMENT",
      totalPages: 0,
      pages: [],
      error: `File not found on filesystem: ${resolvedPath}`,
      metadata: {
        secretsMaskedCount: 0,
        promptInjectionDetected: false,
        promptInjectionAttempts: [],
      },
    };
  }

  // 2. Format validation
  const stats = fs.statSync(resolvedPath);
  if (!stats.isFile()) {
    return {
      sourceType: "pdf",
      sourcePath: resolvedPath,
      status: "EXTRACTION_ERROR",
      totalPages: 0,
      pages: [],
      error: `Target is not a regular file: ${resolvedPath}`,
      metadata: {
        fileSize: stats.size,
        secretsMaskedCount: 0,
        promptInjectionDetected: false,
        promptInjectionAttempts: [],
      },
    };
  }

  const fileBuffer = fs.readFileSync(resolvedPath);

  // 3. Basic PDF signature check (%PDF-)
  const header = fileBuffer.slice(0, 5).toString("ascii");
  if (!header.startsWith("%PDF")) {
    return {
      sourceType: "pdf",
      sourcePath: resolvedPath,
      status: "EXTRACTION_ERROR",
      totalPages: 0,
      pages: [],
      error: `File does not contain valid PDF header signature (%PDF-): ${resolvedPath}`,
      metadata: {
        fileSize: stats.size,
        secretsMaskedCount: 0,
        promptInjectionDetected: false,
        promptInjectionAttempts: [],
      },
    };
  }

  // 4. Parse PDF
  let parser: PDFParse | null = null;
  let totalMaskedCount = 0;
  const allInjections: string[] = [];

  try {
    parser = new PDFParse({ data: fileBuffer });
    const textData = await parser.getText();
    const tableData = await parser.getTable().catch(() => null);

    const pages: ExtractedPage[] = [];
    const rawPages = textData.pages || [];

    for (let i = 0; i < rawPages.length; i++) {
      const pageNum = rawPages[i].num || i + 1;
      let rawText = (rawPages[i].text || "").trim();

      // Sanitization
      if (options.maskSecrets !== false) {
        const { sanitized, maskedCount } = sanitizeSecrets(rawText);
        rawText = sanitized;
        totalMaskedCount += maskedCount;
      }

      // Prompt injection detection
      if (options.detectPromptInjection !== false) {
        const injections = detectPromptInjections(rawText);
        if (injections.length > 0) {
          allInjections.push(...injections);
        }
      }

      // Headings
      const headings = extractHeadingsFromText(rawText);

      // Tables (from text and parser)
      const tables = extractTablesFromText(rawText);
      if (tableData && tableData.pages && tableData.pages[i] && tableData.pages[i].tables) {
        for (const t of tableData.pages[i].tables) {
          if (Array.isArray(t) && t.length > 0) {
            tables.push({ rows: t });
          }
        }
      }

      pages.push({
        pageNumber: pageNum,
        text: rawText,
        headings,
        tables,
      });
    }

    return {
      sourceType: "pdf",
      sourcePath: resolvedPath,
      status: "SUCCESS",
      totalPages: textData.total || pages.length,
      pages,
      metadata: {
        fileSize: stats.size,
        secretsMaskedCount: totalMaskedCount,
        promptInjectionDetected: allInjections.length > 0,
        promptInjectionAttempts: allInjections,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      sourceType: "pdf",
      sourcePath: resolvedPath,
      status: "EXTRACTION_ERROR",
      totalPages: 0,
      pages: [],
      error: `Failed to parse PDF document: ${message}`,
      metadata: {
        fileSize: stats.size,
        secretsMaskedCount: 0,
        promptInjectionDetected: false,
        promptInjectionAttempts: [],
      },
    };
  } finally {
    if (parser) {
      await parser.destroy().catch(() => {});
    }
  }
}

// CLI entry point
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  const targetPath = process.argv[2];
  if (!targetPath) {
    console.error("Usage: node src/document-ingestion.js <path-to-pdf>");
    process.exit(1);
  }

  ingestDocument(targetPath)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.status === "SUCCESS" ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
