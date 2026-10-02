import fs from "fs";
import path from "path";
import { sanitizeSecrets, detectPromptInjections } from "./document-ingestion";

export interface AuditEvent { timestamp: string; runId: string; phase: string; action: string; source?: string; inputReference?: string; outputReference?: string; decision?: string; reason?: string; actor?: string; }
export interface SecretScanResult { status: "PASS" | "FAIL"; maskedCount: number; findings: string[]; scannedFiles: string[]; }

export class AuditTrail {
  readonly events: AuditEvent[] = [];
  constructor(readonly runId: string, readonly filePath?: string) { }
  record(event: Omit<AuditEvent, "timestamp" | "runId">): AuditEvent {
    const result = { ...event, timestamp: new Date().toISOString(), runId: this.runId };
    this.events.push(result);
    return result;
  }
  save(filePath = this.filePath || path.resolve("reports", this.runId, "audit.json")): string {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(this.events, null, 2), "utf8");
    return filePath;
  }
}

export function scanSecrets(values: Array<{ path: string; content: string }>): SecretScanResult {
  const findings: string[] = [];
  let maskedCount = 0;
  const scannedFiles = values.map((v) => v.path);
  for (const value of values) {
    const sanitized = sanitizeSecrets(value.content);
    maskedCount += sanitized.maskedCount;
    if (sanitized.maskedCount > 0) findings.push(`Potential secret in ${value.path}`);
    if (detectPromptInjections(value.content).length > 0) findings.push(`PROMPT INJECTION ATTEMPT DETECTED in ${value.path}`);
  }
  return { status: findings.length ? "FAIL" : "PASS", maskedCount, findings, scannedFiles };
}

export function verifyArtifact(filePath: string): { status: "AVAILABLE" | "UNAVAILABLE"; path: string } {
  const resolved = path.resolve(filePath);
  return { status: fs.existsSync(resolved) ? "AVAILABLE" : "UNAVAILABLE", path: resolved };
}
