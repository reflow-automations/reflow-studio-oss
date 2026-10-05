import type { Capability, ModelDefinition, OutputType, ProviderId, PublicModel } from "./types";
import { toPublicModel } from "./types";
import { StudioError } from "../util/errors";

export interface CatalogQuery {
  type?: OutputType;
  capability?: Capability;
  provider?: ProviderId;
  /** Free-text search over id, name, vendor, description and tags. */
  q?: string;
  includeDeprecated?: boolean;
  limit?: number;
  offset?: number;
}

/** In-memory model registry. The seed catalog lives in ./models; apps may extend it. */
export class ModelRegistry {
  private readonly models = new Map<string, ModelDefinition>();

  constructor(models: ModelDefinition[] = []) {
    for (const model of models) this.register(model);
  }

  register(model: ModelDefinition): void {
    if (this.models.has(model.id)) throw new Error(`duplicate model id ${model.id}`);
    this.models.set(model.id, model);
  }

  has(id: string): boolean {
    return this.models.has(id);
  }

  get(id: string): ModelDefinition | undefined {
    return this.models.get(id);
  }

  require(id: string): ModelDefinition {
    const model = this.models.get(id);
    if (!model) throw new StudioError("model_not_found", `unknown model "${id}"; call models_explore to list available models`);
    return model;
  }

  all(): ModelDefinition[] {
    return [...this.models.values()];
  }

  list(query: CatalogQuery = {}): { items: PublicModel[]; total: number } {
    const q = query.q?.trim().toLowerCase();
    const filtered = this.all().filter((model) => {
      if (!query.includeDeprecated && model.status === "deprecated") return false;
      if (query.type && model.output_type !== query.type) return false;
      if (query.capability && !model.capabilities.includes(query.capability)) return false;
      if (query.provider && !model.bindings.some((b) => b.provider === query.provider)) return false;
      if (q) {
        const haystack = [model.id, model.name, model.vendor, model.description, ...model.tags, ...model.capabilities, ...(model.higgsfield_ids ?? [])].join(" ").toLowerCase();
        if (!q.split(/\s+/).every((term) => haystack.includes(term))) return false;
      }
      return true;
    });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    return { items: filtered.slice(offset, offset + limit).map(toPublicModel), total: filtered.length };
  }

  /** Find models that replace a given Higgsfield model id. */
  byHiggsfieldId(id: string): ModelDefinition[] {
    return this.all().filter((m) => m.higgsfield_ids?.includes(id));
  }
}
