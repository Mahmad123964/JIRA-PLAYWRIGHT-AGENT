import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import {
  ingestDocument,
  isSupportedDocument,
  sanitizeSecrets,
  extractHeadingsFromText,
  extractTablesFromText,
} from "../../src/document-ingestion";
import { createTestPdfFixtures } from "./helpers/pdf-helper";

const FIXTURES_DIR = path.resolve(__dirname, "../../test-fixtures/pdf-unit");

test.beforeAll(() => {
  createTestPdfFixtures(FIXTURES_DIR);
});

test.afterAll(() => {
  if (fs.existsSync(FIXTURES_DIR)) {
    fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
  }
});

test.describe("Document Ingestion Module (PDF Requirements)", () => {
  test("1. File extension check (isSupportedDocument)", () => {
    expect(isSupportedDocument("specs/requirements.pdf")).toBe(true);
    expect(isSupportedDocument("specs/requirements.PDF")).toBe(true);
    expect(isSupportedDocument("specs/requirements.docx")).toBe(false);
    expect(isSupportedDocument("specs/requirements.txt")).toBe(false);
  });

  test("2. Valid single-page PDF extraction (text, headings, tables, status)", async () => {
    const pdfPath = path.join(FIXTURES_DIR, "valid-single.pdf");
    const result = await ingestDocument(pdfPath);

    expect(result.status).toBe("SUCCESS");
    expect(result.sourceType).toBe("pdf");
    expect(result.totalPages).toBe(1);
    expect(result.pages.length).toBe(1);

    const page1 = result.pages[0];
    expect(page1.pageNumber).toBe(1);
    expect(page1.text).toContain("Payment API Spec");
    expect(page1.text).toContain("The payment endpoint accepts credit card transactions.");

    // Headings
    expect(page1.headings).toContain("Document Header: Payment API Spec");
    expect(page1.headings).toContain("Section 1.1 Overview");

    // Tables
    expect(page1.tables.length).toBeGreaterThan(0);
    const tableRows = page1.tables[0].rows;
    expect(tableRows.length).toBe(3); // Header + 2 data rows
    expect(tableRows[0]).toEqual(["Endpoint", "Method", "Status"]);
    expect(tableRows[1]).toEqual(["/api/v1/pay", "POST", "200"]);
  });

  test("3. Multi-page PDF extraction & page-number preservation", async () => {
    const pdfPath = path.join(FIXTURES_DIR, "valid-multipage.pdf");
    const result = await ingestDocument(pdfPath);

    expect(result.status).toBe("SUCCESS");
    expect(result.totalPages).toBe(3);
    expect(result.pages.length).toBe(3);

    expect(result.pages[0].pageNumber).toBe(1);
    expect(result.pages[0].text).toContain("User Authentication Specification");

    expect(result.pages[1].pageNumber).toBe(2);
    expect(result.pages[1].text).toContain("Section 2 Endpoints");
    expect(result.pages[1].text).toContain("/api/auth/login");

    expect(result.pages[2].pageNumber).toBe(3);
    expect(result.pages[2].text).toContain("Section 3 Error Codes");
    expect(result.pages[2].tables.length).toBeGreaterThan(0);
  });

  test("4. Missing file handling -> BLOCKED / MISSING REQUIREMENT", async () => {
    const nonExistentPath = path.join(FIXTURES_DIR, "non-existent-requirement.pdf");
    const result = await ingestDocument(nonExistentPath);

    expect(result.status).toBe("BLOCKED / MISSING REQUIREMENT");
    expect(result.totalPages).toBe(0);
    expect(result.pages.length).toBe(0);
    expect(result.error).toContain("File not found");
  });

  test("5. Unreadable/invalid/corrupted PDF -> EXTRACTION_ERROR", async () => {
    const corruptPath = path.join(FIXTURES_DIR, "corrupted.pdf");
    const result = await ingestDocument(corruptPath);

    expect(result.status).toBe("EXTRACTION_ERROR");
    expect(result.totalPages).toBe(0);
    expect(result.pages.length).toBe(0);
    expect(result.error).toBeTruthy();
  });

  test("6. Empty extraction handling (valid PDF structure, empty page text)", async () => {
    const emptyPath = path.join(FIXTURES_DIR, "empty.pdf");
    const result = await ingestDocument(emptyPath);

    expect(result.status).toBe("SUCCESS");
    expect(result.totalPages).toBe(1);
    expect(result.pages.length).toBe(1);
    expect(result.pages[0].text).toBe("");
    expect(result.pages[0].headings.length).toBe(0);
  });

  test("7. Secret masking across document content (Zero Secret Exposure)", async () => {
    const secretPath = path.join(FIXTURES_DIR, "secrets.pdf");
    const result = await ingestDocument(secretPath, { maskSecrets: true });

    expect(result.status).toBe("SUCCESS");
    expect(result.metadata.secretsMaskedCount).toBeGreaterThan(0);

    const fullText = result.pages.map((p) => p.text).join("\n");
    // Ensure actual secrets are masked
    expect(fullText).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(fullText).not.toContain("ATATT3xFfGF0rZ1234567890abcdef");
    expect(fullText).not.toContain("SuperSecurePassword!2026");
    expect(fullText).not.toContain("998877665544332211");
    expect(fullText).toContain("Bearer ***");
    expect(fullText).toContain("password: ***");
  });

  test("8. Prompt injection detection and quarantining (Section 56)", async () => {
    const injectionPath = path.join(FIXTURES_DIR, "injection.pdf");
    const result = await ingestDocument(injectionPath, { detectPromptInjection: true });

    expect(result.status).toBe("SUCCESS");
    expect(result.metadata.promptInjectionDetected).toBe(true);
    expect(result.metadata.promptInjectionAttempts.length).toBeGreaterThan(0);
    expect(result.metadata.promptInjectionAttempts[0]).toMatch(/ignore\s+all\s+previous\s+instructions/i);
  });

  test("9. Standalone sanitization helper unit test", () => {
    const raw = "apiKey: secret_key_12345 and password=mySecretPass";
    const { sanitized, maskedCount } = sanitizeSecrets(raw);

    expect(maskedCount).toBe(2);
    expect(sanitized).toBe("apiKey: *** and password: ***");
  });

  test("10. Heading detection helper unit test", () => {
    const text = "# Heading 1\n## Heading 2\nSection 4.1 Data Schema\nSome normal text paragraph.\n\nTECHNICAL SPECIFICATION\nMore text.";
    const headings = extractHeadingsFromText(text);

    expect(headings).toContain("Heading 1");
    expect(headings).toContain("Heading 2");
    expect(headings).toContain("Section 4.1 Data Schema");
    expect(headings).toContain("TECHNICAL SPECIFICATION");
  });

  test("11. Table extraction helper unit test", () => {
    const tableText = [
      "| Method | Endpoint | Description |",
      "|---|---|---|",
      "| GET | /users | List users |",
      "| POST | /users | Create user |",
    ].join("\n");

    const tables = extractTablesFromText(tableText);
    expect(tables.length).toBe(1);
    expect(tables[0].rows.length).toBe(3); // Header + 2 rows
    expect(tables[0].rows[1]).toEqual(["GET", "/users", "List users"]);
  });
});
