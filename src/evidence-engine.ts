import fs from "fs";
import path from "path";
import { sanitizeSecrets } from "./document-ingestion";
import { verifyArtifact, scanSecrets, type SecretScanResult } from "./security-audit";

export type EvidenceStatus = "AVAILABLE" | "UNAVAILABLE" | "NOT_APPLICABLE";
export interface EvidenceArtifact { kind: string; status: EvidenceStatus; path?: string; detail?: string; }
export interface EvidenceBundle { runId: string; artifacts: EvidenceArtifact[]; secretScan: SecretScanResult; }

export class EvidenceManager {
  readonly artifacts: EvidenceArtifact[] = [];
  readonly records: Array<{ path: string; content: string }> = [];
  constructor(readonly runId: string, readonly root = path.resolve("test-results", runId)) { fs.mkdirSync(root, { recursive: true }); }
  addFile(kind: string, filePath: string, notApplicable = false): EvidenceArtifact {
    if (notApplicable) { const a = { kind, status: "NOT_APPLICABLE" as EvidenceStatus }; this.artifacts.push(a); return a; }
    const a = verifyArtifact(filePath); const artifact = { kind, status: a.status as EvidenceStatus, path: a.path }; this.artifacts.push(artifact); return artifact;
  }
  addText(kind: string, fileName: string, content: string): EvidenceArtifact {
    fs.mkdirSync(this.root, { recursive: true });
    const filePath = path.join(this.root, fileName); fs.writeFileSync(filePath, sanitizeSecrets(content).sanitized, "utf8");
    this.records.push({ path: filePath, content: fs.readFileSync(filePath, "utf8") }); return this.addFile(kind, filePath);
  }
  finalize(): EvidenceBundle { return { runId: this.runId, artifacts: this.artifacts, secretScan: scanSecrets(this.records) }; }
}
