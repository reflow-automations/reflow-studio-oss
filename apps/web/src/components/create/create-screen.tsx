"use client";

import { useQuery } from "@tanstack/react-query";
import { api, type CreateType, type GenerationView } from "@/lib/client/api";
import { humanize } from "@/lib/client/format";
import { useDraft, useStudioStore } from "@/lib/client/store";
import { PromptDock } from "@/components/create/prompt-dock";
import { GenerationFeed } from "@/components/generations/generation-feed";

export function CreateScreen({ type }: { type: CreateType }) {
  const modelsQuery = useQuery({ queryKey: ["models", { type }], queryFn: () => api.models.list({ type, limit: 100 }), staleTime: 5 * 60_000 });
  const draft = useDraft(type);
  const addMedia = useStudioStore((s) => s.addMedia);
  const setPreview = useStudioStore((s) => s.setPreview);
  const prefill = useStudioStore((s) => s.prefill);
  const notify = useStudioStore((s) => s.notify);

  const models = modelsQuery.data?.items ?? [];
  const model = models.find((m) => m.id === draft.model) ?? models[0] ?? null;

  function onReuse(gen: GenerationView) {
    prefill(type, gen.request);
    notify("Prompt and settings restored into the dock.", "success");
  }

  function onUseAsReference(gen: GenerationView) {
    if (!model) return;
    const kind = gen.output_type === "image" || gen.output_type === "video" ? gen.output_type : null;
    const slot = kind ? model.medias.find((s) => s.kind === kind) : undefined;
    if (!slot) {
      notify(`${model.name} has no ${gen.output_type} input slot.`, "error");
      return;
    }
    const output = gen.outputs.find((o) => o.url) ?? gen.outputs[0];
    if (!addMedia(type, slot.role, gen.id, slot.max ?? 1)) {
      notify(`${humanize(slot.role)} already holds ${slot.max ?? 1} item(s).`, "error");
      return;
    }
    setPreview(gen.id, { url: output?.url ?? null, kind: slot.kind, label: `generation ${gen.id.slice(0, 8)}` });
    notify(`Added as ${humanize(slot.role)}.`, "success");
  }

  return (
    <div className="flex flex-col lg:h-dvh lg:flex-row">
      <section className="order-2 min-w-0 flex-1 lg:order-1 lg:overflow-y-auto" aria-label="Results">
        <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
          <h1 className="text-base font-semibold tracking-tight">{type === "image" ? "Create image" : "Create video"}</h1>
          <p className="text-xs text-muted">Newest first · live status</p>
        </div>
        <div className="p-4 sm:p-6">
          <GenerationFeed filters={{ type }} onReuse={onReuse} onUseAsReference={onUseAsReference} emptyTitle={`No ${type}s yet`} emptyDescription="Write a prompt in the dock and hit Generate." />
        </div>
      </section>
      <aside className="order-1 w-full shrink-0 border-b border-border bg-panel lg:order-2 lg:w-[400px] lg:overflow-y-auto lg:border-b-0 lg:border-l xl:w-[440px]" aria-label="Prompt dock">
        <PromptDock type={type} models={models} model={model} modelsLoading={modelsQuery.isPending} modelsError={modelsQuery.error} onRetryModels={() => void modelsQuery.refetch()} />
      </aside>
    </div>
  );
}
