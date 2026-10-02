export type RequirementSourceType = "manual" | "file" | "pdf" | "jira" | "notion" | "slack" | "github";
export type RequirementStatus = "CONFIRMED" | "SUPPORTED" | "INFORMATIONAL" | "CONFLICTING" | "UNKNOWN";
export type IntegrationStatus = "AVAILABLE" | "PARTIALLY_AVAILABLE" | "UNAVAILABLE" | "BLOCKED";

export interface ProvenanceRecord {
  sourceType: RequirementSourceType | "browser-exploration";
  sourceId?: string;
  location?: string;
  title?: string;
  filePath?: string;
  page?: number;
  section?: string;
  lineRange?: string;
  observationId?: string;
  excerpt?: string;
}

export interface RequirementSource {
  type: RequirementSourceType;
  id?: string;
  location?: string;
  title?: string;
  content: string;
  provenance: ProvenanceRecord[];
  authority?: "PRIMARY" | "AUTHORITATIVE" | "SUPPORTING" | "INFORMATIONAL";
  status?: IntegrationStatus;
}

export interface Requirement {
  id: string;
  title: string;
  description: string;
  source: RequirementSource;
  provenance: ProvenanceRecord[];
  status: RequirementStatus;
}

export interface SourcePolicy {
  preferredTypes?: RequirementSourceType[];
  authoritativeSourceIds?: string[];
  allowConflicts?: boolean;
}

export interface SourceConflict {
  id: string;
  requirementIds: string[];
  sources: ProvenanceRecord[];
  description: string;
  material: boolean;
  status: "CONFLICTING" | "RESOLVED";
}

export interface IntegrationHealth {
  name: string;
  status: IntegrationStatus;
  reason?: string;
}
