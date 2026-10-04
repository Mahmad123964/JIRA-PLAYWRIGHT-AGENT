import crypto from "crypto";
import fs from "fs";

/**
 * Content fingerprints for generated automation artifacts.
 *
 * Regression selection compares the CURRENT bytes of a spec (and the POM it
 * imports) against the fingerprint recorded when the PASS baseline was written.
 * Without this, a spec that was regenerated after its baseline still matched,
 * even though the baseline described different content -- which is exactly how a
 * PASS baseline came to be attached to a spec that then failed for an unrelated
 * reason.
 *
 * A missing file yields undefined rather than a hash, so a deleted artifact is
 * reported as "file missing" instead of silently matching.
 */
export function sha256File(filePath: string): string | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  } catch {
    return undefined;
  }
}

export function sha256Text(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export interface ArtifactFingerprint {
  /** Repo-relative, posix spec path. */
  specPath: string;
  specSha256?: string;
  /** POM the spec imports, repo-relative, posix. */
  pomPath?: string;
  pomSha256?: string;
}

/** Extracts the pages/... import target from generated spec source. */
export function pomImportFromSpec(specSource: string): string | undefined {
  const match = /from\s+"([^"]*pages\/[^"]*\/[A-Za-z0-9_]+Page)"/.exec(specSource);
  return match?.[1];
}

/** Fingerprints a generated spec together with the POM it imports. */
export function fingerprintSpec(repoRoot: string, specPath: string): ArtifactFingerprint {
  const relativeSpec = specPath.replace(/\\/g, "/").replace(/^.*\/(?=tests\/)/, "");
  const fingerprint: ArtifactFingerprint = { specPath: relativeSpec, specSha256: sha256File(specPath) };
  let source = "";
  try { source = fs.readFileSync(specPath, "utf8"); } catch { return fingerprint; }
  const pomImport = pomImportFromSpec(source);
  if (!pomImport) return fingerprint;
  // Resolve the import relative to the spec file, not the repo root. The
  // generated import omits the extension (TypeScript resolves it implicitly),
  // so restore .ts before looking at the filesystem.
  const nodePath = require("path") as typeof import("path");
  const pomPath = nodePath.resolve(nodePath.dirname(specPath), pomImport.endsWith(".ts") ? pomImport : `${pomImport}.ts`);
  fingerprint.pomPath = pomPath.replace(/\\/g, "/").replace(/^.*\/(?=pages\/)/, "");
  fingerprint.pomSha256 = sha256File(pomPath);
  return fingerprint;
}

/**
 * Compares a baseline fingerprint with the file currently on disk.
 *
 * Returns "ok" only when the spec still exists and its bytes are unchanged. A
 * changed spec or a changed POM both count as "changed", because either one
 * invalidates what the baseline proved.
 */
export function compareFingerprint(baseline: ArtifactFingerprint | undefined, repoRoot: string): { status: "ok" | "changed" | "missing"; reason?: string } {
  if (!baseline) return { status: "changed", reason: "no content fingerprint was recorded for this baseline" };
  const current = fingerprintSpec(repoRoot, `${repoRoot}/${baseline.specPath}`);
  if (!current.specSha256) return { status: "missing", reason: `the baseline spec no longer exists on disk (${baseline.specPath})` };
  if (baseline.specSha256 && current.specSha256 !== baseline.specSha256) {
    return { status: "changed", reason: `file changed since baseline: ${baseline.specPath} content differs from the run that recorded the PASS baseline` };
  }
  if (baseline.pomPath) {
    if (!current.pomSha256) return { status: "missing", reason: `the Page Object imported by the baseline spec no longer exists (${baseline.pomPath})` };
    if (baseline.pomSha256 && current.pomSha256 !== baseline.pomSha256) {
      return { status: "changed", reason: `file changed since baseline: the Page Object ${baseline.pomPath} differs from the run that recorded the PASS baseline` };
    }
  }
  return { status: "ok" };
}