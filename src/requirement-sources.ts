import fs from "fs";
import path from "path";
import { sanitizeSecrets, detectPromptInjections, ingestDocument } from "./document-ingestion";
import type { Requirement, RequirementSource, RequirementSourceType, SourceConflict, SourcePolicy } from "./core-models";

export interface RequirementInput {
  requirements?: string[];
  sources?: RequirementSource[];
  specFile?: string;
  policy?: SourcePolicy;
}

export interface RequirementContext {
  requirements: Requirement[];
  sources: RequirementSource[];
  conflicts: SourceConflict[];
  warnings: string[];
  promptInjectionDetected: boolean;
  secretsMaskedCount: number;
}

function sourceTypeForFile(filePath: string): RequirementSourceType {
  return path.extname(filePath).toLowerCase() === ".pdf" ? "pdf" : "file";
}

function sourceFromManual(value: string, index: number): RequirementSource {
  const sanitized = sanitizeSecrets(value);
  return { type: "manual", id: `manual-${index + 1}`, title: `Manual requirement ${index + 1}`, content: sanitized.sanitized, provenance: [{ sourceType: "manual", sourceId: `manual-${index + 1}`, excerpt: sanitized.sanitized }], authority: "PRIMARY", status: "AVAILABLE" };
}

export function loadRequirementSource(filePath: string): RequirementSource {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`Requirement source not found: ${resolved}`);
  const extension = path.extname(resolved).toLowerCase();
  if (extension === ".pdf") throw new Error("PDF sources require normalizeRequirementsAsync so page provenance can be preserved");
  const raw = fs.readFileSync(resolved, "utf8");
  const content = parseStructuredText(raw, extension);
  const sanitized = sanitizeSecrets(content);
  return { type: sourceTypeForFile(resolved), id: resolved, location: resolved, title: path.basename(resolved), content: sanitized.sanitized, provenance: [{ sourceType: sourceTypeForFile(resolved), sourceId: resolved, filePath: resolved, excerpt: sanitized.sanitized.slice(0, 1000) }], authority: "PRIMARY", status: "AVAILABLE" };
}

function parseStructuredText(raw: string, extension: string): string {
  if (extension === ".json") {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).join("\n");
    if (parsed && typeof parsed === "object") {
      const values = (parsed as { requirements?: unknown; acceptanceCriteria?: unknown }).requirements || (parsed as { acceptanceCriteria?: unknown }).acceptanceCriteria;
      if (Array.isArray(values)) return values.map(String).join("\n");
      return JSON.stringify(parsed, null, 2);
    }
  }
  if (extension === ".yaml" || extension === ".yml") {
    return raw.split(/\r?\n/).map((line) => line.replace(/^\s*[-]\s*/, "").replace(/^\s*(?:requirement|description|title)\s*:\s*/i, "").trim()).filter((line) => line && !line.startsWith("#") && !/^\w+\s*:$/.test(line)).join("\n");
  }
  return raw;
}

export async function loadRequirementSourceAsync(filePath: string): Promise<RequirementSource> {
  const resolved = path.resolve(filePath);
  if (path.extname(resolved).toLowerCase() !== ".pdf") return loadRequirementSource(resolved);
  const result = await ingestDocument(resolved);
  if (result.status !== "SUCCESS") throw new Error(result.error || `PDF source unavailable: ${result.status}`);
  const pages = result.pages.map((page) => page.text).join("\n");
  return { type: "pdf", id: resolved, location: resolved, title: path.basename(resolved), content: pages, provenance: result.pages.flatMap((page) => [{ sourceType: "pdf" as const, sourceId: resolved, filePath: resolved, page: page.pageNumber, excerpt: page.text.slice(0, 1000) }]), authority: "PRIMARY", status: "AVAILABLE" };
}

function splitRequirements(source: RequirementSource): Requirement[] {
  const lines = source.content.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim()).filter(Boolean);
  const values = lines.length ? lines : [source.content.trim()];
  return values.filter(Boolean).map((description, index) => ({ id: `${source.id || source.type}-${index + 1}`, title: description.slice(0, 100), description, source, provenance: [...source.provenance], status: "CONFIRMED" }));
}

export function normalizeRequirements(input: RequirementInput): RequirementContext {
  const sources: RequirementSource[] = [...(input.sources || [])];
  if (input.specFile) sources.push(loadRequirementSource(input.specFile));
  (input.requirements || []).forEach((value, index) => sources.push(sourceFromManual(value, index)));
  const warnings: string[] = [];
  let promptInjectionDetected = false;
  let secretsMaskedCount = 0;
  for (const source of sources) {
    const sanitized = sanitizeSecrets(source.content); secretsMaskedCount += sanitized.maskedCount; source.content = sanitized.sanitized;
    if (detectPromptInjections(source.content).length) { promptInjectionDetected = true; warnings.push(`PROMPT INJECTION ATTEMPT DETECTED in ${source.id || source.type}`); }
  }
  const requirements = sources.flatMap(splitRequirements);
  const conflicts: SourceConflict[] = [];
  const endpointFacts = new Map<string, Array<{ requirement: Requirement; method: string }>>();
  for (const requirement of requirements) {
    const match = requirement.description.match(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s]+)/i);
    if (!match) continue;
    const key = match[2].toLowerCase();
    const entries = endpointFacts.get(key) || [];
    entries.push({ requirement, method: match[1].toUpperCase() });
    endpointFacts.set(key, entries);
  }
  for (const [endpoint, entries] of endpointFacts) {
    const methods = [...new Set(entries.map((entry) => entry.method))];
    if (methods.length > 1) {
      const requirementIds = entries.map((entry) => entry.requirement.id);
      const provenance = entries.flatMap((entry) => entry.requirement.provenance);
      entries.forEach((entry) => { entry.requirement.status = "CONFLICTING"; });
      conflicts.push({ id: `conflict-${endpoint}`, requirementIds, sources: provenance, description: `Conflicting HTTP methods for ${endpoint}: ${methods.join(" vs ")}`, material: true, status: "CONFLICTING" });
    }
  }
  const duplicateDescriptions = new Map<string, Requirement[]>();
  for (const requirement of requirements) { const key = requirement.description.toLowerCase().replace(/\s+/g, " "); const list = duplicateDescriptions.get(key) || []; list.push(requirement); duplicateDescriptions.set(key, list); }
  for (const group of duplicateDescriptions.values()) if (group.length > 1 && new Set(group.map((item) => item.source.type)).size > 1) group.forEach((item) => { item.status = "SUPPORTED"; });
  const preferred = input.policy?.preferredTypes || [];
  if (preferred.length) requirements.forEach((item) => { if (!preferred.includes(item.source.type)) item.status = item.status === "CONFIRMED" ? "SUPPORTED" : item.status; });
  return { requirements, sources, conflicts, warnings, promptInjectionDetected, secretsMaskedCount };
}

export async function normalizeRequirementsAsync(input: RequirementInput): Promise<RequirementContext> {
  const sources: RequirementSource[] = [...(input.sources || [])];
  if (input.specFile) {
    const source = path.extname(input.specFile).toLowerCase() === ".pdf"
      ? await loadRequirementSourceAsync(input.specFile)
      : loadRequirementSource(input.specFile);
    sources.push(source);
  }
  return normalizeRequirements({ ...input, sources, specFile: undefined });
}
