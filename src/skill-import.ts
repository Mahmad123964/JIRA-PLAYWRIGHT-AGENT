// Table schema and Source tag names referenced below come from the
// qa-test-case-generation skill (github.com/saleem-daqa/qa-test-case-generation,
// MIT licence). See THIRD_PARTY_NOTICES.md. No files from that repo are vendored here.
import { sanitizeSecrets, detectPromptInjections } from "./document-ingestion";
import type { TestCase, TestCasePriority, TestCaseType } from "./test-case-generator";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/**
 * The qa-test-case-generation skill's Source tag taxonomy
 * (github.com/saleem-daqa/qa-test-case-generation, MIT licence).
 * "Inferred QA Risk" means no requirement or mockup evidence backs the case.
 */
export type SkillSourceTag = "Requirement" | "Mockup" | "Requirement + Mockup" | "Inferred QA Risk";

export interface RejectedRow {
  row: number;
  reason: string;
}

/** Same as RejectedRow, plus the row's cell content with any secrets already masked -- never the raw row. */
export interface QuarantinedRow extends RejectedRow {
  cells: Record<string, string>;
}

/**
 * One case from the group is kept as the sole approvable case; the rest are
 * set aside -- they never also reach the approval inbox as separate
 * approvable cases, but their full data is retained here, never dropped.
 */
export interface DuplicateGroup {
  key: string;
  keptTestCaseId: string;
  setAsideTestCases: TestCase[];
}

/** Persisted alongside an ApprovalStore so a human can see what an import did later, not only in CLI output. */
export interface SkillImportReport {
  rejected: RejectedRow[];
  quarantined: QuarantinedRow[];
  duplicates: DuplicateGroup[];
  secretsMaskedCount: number;
}

export interface SkillImportResult extends SkillImportReport {
  accepted: TestCase[];
}

interface ParsedRow {
  rowNumber: number;
  cells: Record<string, string>;
}

// ----------------------------------------------------------------------------
// Required columns (assets/default-test-case-template.md)
// ----------------------------------------------------------------------------

const REQUIRED_COLUMNS = [
  "Test Case ID",
  "Module / Feature",
  "Test Scenario",
  "Test Steps",
  "Expected Result",
  "Priority",
] as const;

const PRIORITY_MAP: Record<string, TestCasePriority> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const TEST_TYPE_MAP: Record<string, TestCaseType> = {
  functional: "Functional",
  negative: "Negative",
  boundary: "Boundary",
  validation: "Validation",
  navigation: "Navigation",
  permission: "Permission",
};

const SOURCE_TAG_VALUES: SkillSourceTag[] = ["Requirement", "Mockup", "Requirement + Mockup", "Inferred QA Risk"];

// ----------------------------------------------------------------------------
// Table / CSV parsing
// ----------------------------------------------------------------------------

/**
 * Splits a Markdown table row on "|", honoring "\|" as an escaped literal
 * pipe inside a cell. An unescaped "|" inside a cell's intended content is
 * indistinguishable from a real column boundary -- that row is left with
 * more cells than the header and is rejected by the caller, never silently
 * shifted.
 */
function splitMarkdownRow(line: string): string[] {
  const trimmed = line.trim();
  const body = trimmed.startsWith("|") && trimmed.endsWith("|") ? trimmed.slice(1, -1) : trimmed;
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && body[i + 1] === "|") {
      current += "|";
      i++;
    } else if (body[i] === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += body[i];
    }
  }
  cells.push(current.trim());
  return cells;
}

function isMarkdownSeparatorRow(line: string): boolean {
  return /^\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/.test(line.trim());
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function detectFormat(text: string): "markdown" | "csv" {
  const firstContentLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) || "";
  return firstContentLine.trim().startsWith("|") ? "markdown" : "csv";
}

/**
 * Parses a Markdown pipe table or CSV produced from the skill's default
 * test-case template into header + data rows. Throws when no header row with
 * all required columns can be found — the caller treats that as "reject the
 * whole file".
 */
function parseRows(text: string): { header: string[]; dataRows: { rowNumber: number; cells: string[] }[] } {
  const format = detectFormat(text);
  const lines = text.split(/\r?\n/);

  let header: string[] | null = null;
  const dataRows: { rowNumber: number; cells: string[] }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    if (format === "markdown") {
      if (isMarkdownSeparatorRow(line)) continue;
      const cells = splitMarkdownRow(line);
      if (header === null) {
        header = cells;
      } else {
        dataRows.push({ rowNumber: i + 1, cells });
      }
    } else {
      const cells = splitCsvLine(line);
      if (header === null) {
        header = cells;
      } else {
        dataRows.push({ rowNumber: i + 1, cells });
      }
    }
  }

  if (header === null) {
    throw new Error("No header row found in skill output file");
  }

  return { header, dataRows };
}

function toRowRecord(header: string[], cells: string[], rowNumber: number): ParsedRow {
  const record: Record<string, string> = {};
  for (let i = 0; i < header.length; i++) {
    record[header[i]] = (cells[i] ?? "").trim();
  }
  return { rowNumber, cells: record };
}

// ----------------------------------------------------------------------------
// Row -> TestCase conversion
// ----------------------------------------------------------------------------

function extractSourceTag(row: Record<string, string>): SkillSourceTag | undefined {
  const raw = row["Source"] || row["Notes"] || "";
  return SOURCE_TAG_VALUES.find((tag) => raw.includes(tag));
}

function mapPriority(raw: string): TestCasePriority {
  return PRIORITY_MAP[raw.trim().toLowerCase()] || "Medium";
}

function mapTestType(raw: string): TestCaseType {
  return TEST_TYPE_MAP[raw.trim().toLowerCase()] || "Functional";
}

function dedupKey(tc: TestCase): string {
  // references/deduplication-rules.md: module + role/preconditions + action + input category + expected result.
  // "role" has no dedicated column in the default template; preconditions stand in for it here.
  return [
    tc.module.toLowerCase().trim(),
    tc.preconditions.join("|").toLowerCase().trim(),
    tc.steps.map((s) => s.action).join("|").toLowerCase().trim(),
    tc.testData.toLowerCase().trim(),
    tc.expectedResult.toLowerCase().trim(),
  ].join("::");
}

/**
 * Imports a skill-generated test case table (Markdown or CSV, matching
 * assets/default-test-case-template.md) into TestCase[] for the manual
 * review/approval track.
 *
 * Every imported case is PENDING_APPROVAL / automationEligibility UNKNOWN,
 * carries no expectedAssertion, and has every step flagged needsHumanInput --
 * nothing here is treated as verified. A row is rejected (not silently
 * patched) when required data is missing; a row containing a secret or a
 * prompt-injection attempt is quarantined instead of imported. A duplicate
 * case is set aside rather than also entering the approval inbox as a
 * separate approvable case, but its full data is kept in the result.
 */
export function importSkillOutput(text: string, module: string): SkillImportResult {
  const accepted: TestCase[] = [];
  const rejected: RejectedRow[] = [];
  const quarantined: QuarantinedRow[] = [];
  let secretsMaskedCount = 0;

  const { header, dataRows } = parseRows(text);

  const missingColumns = REQUIRED_COLUMNS.filter((col) => !header.includes(col));
  if (missingColumns.length > 0) {
    throw new Error(`Skill output file is missing required column(s): ${missingColumns.join(", ")}`);
  }

  let counter = 0;
  const generatedAt = new Date().toISOString();

  for (const { rowNumber, cells } of dataRows) {
    if (cells.length !== header.length) {
      rejected.push({
        row: rowNumber,
        reason: `Column count mismatch: expected ${header.length} columns (matching the header), got ${cells.length}`,
      });
      continue;
    }

    const row = toRowRecord(header, cells, rowNumber).cells;

    const missingRequired = REQUIRED_COLUMNS.filter((col) => !row[col] || row[col].trim() === "");
    if (missingRequired.length > 0) {
      rejected.push({ row: rowNumber, reason: `Missing required value(s): ${missingRequired.join(", ")}` });
      continue;
    }

    // Scan every cell for secrets / prompt injection BEFORE anything is stored.
    // Secrets are masked across the whole row regardless of outcome, so a
    // quarantined row's reported cells never carry a raw secret either.
    const sanitizedCells: Record<string, string> = {};
    let rowInjection: string | null = null;
    for (const [col, value] of Object.entries(row)) {
      if (!rowInjection) {
        const injections = detectPromptInjections(value);
        if (injections.length > 0) rowInjection = injections[0];
      }
      const { sanitized, maskedCount } = sanitizeSecrets(value);
      secretsMaskedCount += maskedCount;
      sanitizedCells[col] = sanitized;
    }

    if (rowInjection) {
      quarantined.push({
        row: rowNumber,
        reason: `Prompt injection attempt detected: "${rowInjection}"`,
        cells: sanitizedCells,
      });
      continue;
    }

    counter++;
    const skillSourceTag = extractSourceTag(sanitizedCells);
    const priority = mapPriority(sanitizedCells["Priority"]);
    const testType = mapTestType(sanitizedCells["Test Type"] || "");
    const module_ = sanitizedCells["Module / Feature"] || module;

    const tc: TestCase = {
      testCaseId: sanitizedCells["Test Case ID"] || `TC-IMPORT-${String(counter).padStart(3, "0")}`,
      title: `${skillSourceTag === "Inferred QA Risk" ? "[INFERRED QA RISK — NO VERIFIED EVIDENCE] " : ""}${sanitizedCells["Test Scenario"]}`,
      objective: sanitizedCells["Test Scenario"],
      preconditions: sanitizedCells["Preconditions"] ? [sanitizedCells["Preconditions"]] : [],
      testData: sanitizedCells["Test Data"] || "",
      steps: [
        {
          step: 1,
          action: sanitizedCells["Test Steps"],
          expected: sanitizedCells["Expected Result"],
          // The skill's free-text Expected Result is never promoted to expectedAssertion:
          // nothing here has been verified against a real selector or human-supplied outcome.
          needsHumanInput: "NEEDS_HUMAN_INPUT: imported from manual-track skill output, no verified selector or assertion",
        },
      ],
      expectedResult: sanitizedCells["Expected Result"],
      priority,
      testType,
      module: module_,
      sourceRequirements: [],
      explorationReferences: [],
      assumptions: [],
      risks: skillSourceTag === "Inferred QA Risk" ? ["Inferred QA Risk: no requirement or mockup evidence backs this case"] : [],
      status: "PENDING_APPROVAL",
      automationEligibility: "UNKNOWN",
      sources: [
        {
          type: "manual-skill-import",
          requirement: skillSourceTag,
        },
      ],
      generatedAt,
    };

    accepted.push(tc);
  }

  // Deduplication (references/deduplication-rules.md): the first case per key
  // is kept as the sole approvable case; later ones are set aside rather than
  // also reaching the approval inbox as separate approvable cases, but their
  // full data is retained in the report -- never silently dropped.
  const keptByKey = new Map<string, TestCase>();
  const setAsideByKey = new Map<string, TestCase[]>();
  const finalAccepted: TestCase[] = [];

  for (const tc of accepted) {
    const key = dedupKey(tc);
    const kept = keptByKey.get(key);
    if (kept) {
      const list = setAsideByKey.get(key) || [];
      list.push(tc);
      setAsideByKey.set(key, list);
    } else {
      keptByKey.set(key, tc);
      finalAccepted.push(tc);
    }
  }

  const duplicates: DuplicateGroup[] = [...setAsideByKey.entries()].map(([key, setAsideTestCases]) => ({
    key,
    keptTestCaseId: keptByKey.get(key)!.testCaseId,
    setAsideTestCases,
  }));

  return { accepted: finalAccepted, rejected, duplicates, quarantined, secretsMaskedCount };
}
