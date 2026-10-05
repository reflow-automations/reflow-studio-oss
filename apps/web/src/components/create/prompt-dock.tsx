"use client";

import { useMemo, type KeyboardEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import type { PublicModel } from "@reflow/core";
import { api, errorMessage, type CreateType, type GenerateBody } from "@/lib/client/api";
import { useDraft, useStudioStore } from "@/lib/client/store";
import { buildGenerateBody, resolveDraft, validationIssues } from "@/components/create/draft";
import { ModelPicker } from "@/components/create/model-picker";
import { AspectRatioChips } from "@/components/create/aspect-ratio-chips";
import { DurationControl } from "@/components/create/duration-control";
import { CountControl } from "@/components/create/count-control";
import { MediaSlots } from "@/components/create/media-slots";
import { ParamFields } from "@/components/create/param-fields";
import { CostEstimate } from "@/components/create/cost-estimate";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/banner";

interface PromptDockProps {
  type: CreateType;
  models: PublicModel[];
  model: PublicModel | null;
  modelsLoading: boolean;
  modelsError: unknown;
  onRetryModels: () => void;
}

export function PromptDock({ type, models, model, modelsLoading, modelsError, onRetryModels }: PromptDockProps) {
  const draft = useDraft(type);
  const setDraft = useStudioStore((s) => s.setDraft);
  const setModel = useStudioStore((s) => s.setModel);
  const resetDraft = useStudioStore((s) => s.resetDraft);
  const notify = useStudioStore((s) => s.notify);
  const queryClient = useQueryClient();

  const resolved = useMemo(() => resolveDraft(draft, model), [draft, model]);
  const issues = model ? validationIssues(model, draft, resolved) : [];
  const body = model ? buildGenerateBody(model, draft, resolved) : null;

  const generate = useMutation({
    mutationFn: (payload: GenerateBody) => api.generations.create(payload),
    onSuccess: (gen) => {
      void queryClient.invalidateQueries({ queryKey: ["generations"] });
      void queryClient.invalidateQueries({ queryKey: ["balance"] });
      notify(`Submitted to ${gen.provider ?? "provider"} · ${gen.state}`, "success");
    },
  });

  function submit() {
    if (!body || issues.length > 0 || generate.isPending) return;
    generate.mutate(body);
  }

  function onPromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col gap-4 p-4">
        <ModelPicker models={models} model={model} onChange={(id) => setModel(type, id)} loading={modelsLoading} error={modelsError} onRetry={onRetryModels} />

        <Field
          label="Prompt"
          htmlFor="prompt"
          trailing={
            <button type="button" onClick={() => resetDraft(type)} className="text-[11px] text-subtle hover:text-fg">
              Clear
            </button>
          }
          hint="⌘/Ctrl + Enter to generate"
        >
          <Textarea id="prompt" rows={5} value={draft.prompt} onChange={(e) => setDraft(type, { prompt: e.target.value })} onKeyDown={onPromptKeyDown} placeholder={type === "video" ? "Describe the shot, motion and mood…" : "Describe the image you want…"} maxLength={20_000} />
        </Field>

        <details className="group" open={draft.negative_prompt.trim() !== "" || undefined}>
          <summary className="cursor-pointer list-none text-[11px] font-medium tracking-wide text-muted uppercase select-none hover:text-fg">Negative prompt</summary>
          <Textarea aria-label="Negative prompt" rows={2} className="mt-1.5" value={draft.negative_prompt} onChange={(e) => setDraft(type, { negative_prompt: e.target.value })} placeholder="What to avoid…" maxLength={5_000} />
        </details>

        {model && model.aspect_ratios.length > 0 ? <AspectRatioChips options={model.aspect_ratios} value={resolved.aspect_ratio} onChange={(ratio) => setDraft(type, { aspect_ratio: ratio })} /> : null}
        {type === "video" && model ? <DurationControl model={model} value={resolved.duration} onChange={(seconds) => setDraft(type, { duration: seconds })} /> : null}
        <CountControl value={resolved.count} max={resolved.maxCount} onChange={(count) => setDraft(type, { count })} />
        {model && model.medias.length > 0 ? <MediaSlots type={type} model={model} /> : null}
        {model && model.parameters.length > 0 ? <ParamFields type={type} model={model} /> : null}
        <CostEstimate body={body} enabled={Boolean(model) && issues.length === 0} />
      </div>

      <div className="sticky bottom-0 flex flex-col gap-2 border-t border-border bg-panel/95 p-4 backdrop-blur">
        {generate.isError ? <ErrorBanner title="Generation failed" message={errorMessage(generate.error)} /> : null}
        {issues.length > 0 ? (
          <ul className="text-[11px] text-muted" aria-label="Before you can generate">
            {issues.map((issue) => (
              <li key={issue}>· {issue}</li>
            ))}
          </ul>
        ) : null}
        <Button variant="primary" size="lg" className="w-full" onClick={submit} loading={generate.isPending} disabled={!model || issues.length > 0}>
          <Sparkles className="size-4" aria-hidden />
          Generate {model ? model.name : ""}
          {resolved.count > 1 ? ` ×${resolved.count}` : ""}
        </Button>
      </div>
    </div>
  );
}
