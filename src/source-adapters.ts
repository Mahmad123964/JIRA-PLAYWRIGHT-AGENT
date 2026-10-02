import type { IntegrationHealth, Requirement, RequirementSource, RequirementSourceType } from "./core-models";
import { normalizeRequirements, normalizeRequirementsAsync, type RequirementContext } from "./requirement-sources";
import { getIntegrationHealth } from "./integration-health";

export interface RequirementProvider { readonly name: string; health(): IntegrationHealth; getRequirements(): Promise<Requirement[]>; }

export class ManualRequirementProvider implements RequirementProvider {
  readonly name = "manual";
  constructor(private readonly values: string[]) { }
  health(): IntegrationHealth { return { name: "Manual requirements", status: "AVAILABLE" }; }
  async getRequirements(): Promise<Requirement[]> { return normalizeRequirements({ requirements: this.values }).requirements; }
}

export class FileRequirementProvider implements RequirementProvider {
  readonly name = "file";
  constructor(private readonly filePath: string) { }
  health(): IntegrationHealth { return { name: "File requirements", status: "AVAILABLE" }; }
  async getRequirements(): Promise<Requirement[]> { return (await normalizeRequirementsAsync({ specFile: this.filePath })).requirements; }
}

export class UnavailableRequirementProvider implements RequirementProvider {
  constructor(readonly name: string, private readonly sourceType: RequirementSourceType) { }
  health(): IntegrationHealth { return { name: this.name, status: "UNAVAILABLE", reason: `${this.sourceType} integration is not configured` }; }
  async getRequirements(): Promise<Requirement[]> { return []; }
}

export function defaultRequirementProviders(values: string[], specFile?: string): RequirementProvider[] {
  const providers: RequirementProvider[] = [];
  if (values.length) providers.push(new ManualRequirementProvider(values));
  if (specFile) providers.push(new FileRequirementProvider(specFile));
  for (const source of ["jira", "notion", "slack", "github"] as RequirementSourceType[]) providers.push(new UnavailableRequirementProvider(source, source));
  return providers;
}

export async function collectRequirements(providers: RequirementProvider[]): Promise<RequirementContext> {
  const sources: RequirementSource[] = [];
  for (const provider of providers) sources.push(...(await provider.getRequirements()).map((requirement) => requirement.source));
  return normalizeRequirements({ sources });
}

export { getIntegrationHealth };
