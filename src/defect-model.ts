import type { FailureCategory } from "./failure-classifier";
import type { EvidenceArtifact } from "./evidence-engine";
import type { ProvenanceRecord } from "./core-models";

export interface Defect {
  id: string;
  fingerprint: string;
  title: string;
  classification: FailureCategory;
  severity?: "Blocker" | "Critical" | "Major" | "Minor" | "Trivial";
  sourceTest: string;
  requirement?: string;
  reproduction: string[];
  expected: string;
  actual: string;
  environment?: string;
  browser?: string;
  url?: string;
  evidence: EvidenceArtifact[];
  provenance: ProvenanceRecord[];
  runId: string;
  createdAt: string;
}

export interface DefectResult { status: "CREATED" | "DUPLICATE" | "BLOCKED"; id?: string; reason?: string; }

export interface DefectSink {
  findByFingerprint(fingerprint: string): Promise<Defect | undefined>;
  createDefect(defect: Defect): Promise<DefectResult>;
}

export class LocalDefectSink implements DefectSink {
  private readonly defects = new Map<string, Defect>();
  async findByFingerprint(fingerprint: string): Promise<Defect | undefined> { return this.defects.get(fingerprint); }
  async createDefect(defect: Defect): Promise<DefectResult> {
    if (this.defects.has(defect.fingerprint)) return { status: "DUPLICATE", id: this.defects.get(defect.fingerprint)!.id };
    this.defects.set(defect.fingerprint, defect);
    return { status: "CREATED", id: defect.id };
  }
}
