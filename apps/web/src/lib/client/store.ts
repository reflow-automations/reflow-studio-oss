import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { GenerateRequest, MediaKind, MediaRole, NormalizedRequest } from "@reflow/core";
import type { CreateType } from "@/lib/client/api";

export interface Draft {
  model: string | null;
  prompt: string;
  negative_prompt: string;
  aspect_ratio: string | null;
  duration: number | null;
  count: number;
  medias: Partial<Record<MediaRole, string[]>>;
  params: Record<string, unknown>;
}

export interface MediaPreview {
  url: string | null;
  kind: MediaKind;
  label?: string;
}

export interface Notice {
  id: number;
  message: string;
  tone: "info" | "success" | "error";
}

interface StudioState {
  drafts: Record<CreateType, Draft>;
  previews: Record<string, MediaPreview>;
  notices: Notice[];
  setDraft: (type: CreateType, patch: Partial<Draft>) => void;
  setModel: (type: CreateType, modelId: string) => void;
  setParam: (type: CreateType, name: string, value: unknown) => void;
  setMedia: (type: CreateType, role: MediaRole, values: string[]) => void;
  addMedia: (type: CreateType, role: MediaRole, value: string, max: number) => boolean;
  removeMedia: (type: CreateType, role: MediaRole, value: string) => void;
  setPreview: (id: string, preview: MediaPreview) => void;
  prefill: (type: CreateType, request: GenerateRequest | NormalizedRequest) => void;
  resetDraft: (type: CreateType) => void;
  notify: (message: string, tone?: Notice["tone"]) => void;
  dismissNotice: (id: number) => void;
}

export const emptyDraft = (): Draft => ({ model: null, prompt: "", negative_prompt: "", aspect_ratio: null, duration: null, count: 1, medias: {}, params: {} });

let noticeSeq = 0;

export const useStudioStore = create<StudioState>()(
  persist(
    (set, get) => ({
      drafts: { image: emptyDraft(), video: emptyDraft() },
      previews: {},
      notices: [],
      setDraft: (type, patch) => set((s) => ({ drafts: { ...s.drafts, [type]: { ...s.drafts[type], ...patch } } })),
      setModel: (type, modelId) =>
        set((s) => {
          const current = s.drafts[type];
          if (current.model === modelId) return s;
          // Keep prompt/medias, drop model-specific params so defaults apply.
          return { drafts: { ...s.drafts, [type]: { ...current, model: modelId, params: {} } } };
        }),
      setParam: (type, name, value) =>
        set((s) => {
          const params = { ...s.drafts[type].params };
          if (value === undefined || value === "" || value === null) delete params[name];
          else params[name] = value;
          return { drafts: { ...s.drafts, [type]: { ...s.drafts[type], params } } };
        }),
      setMedia: (type, role, values) => set((s) => ({ drafts: { ...s.drafts, [type]: { ...s.drafts[type], medias: { ...s.drafts[type].medias, [role]: values } } } })),
      addMedia: (type, role, value, max) => {
        const current = get().drafts[type].medias[role] ?? [];
        if (current.includes(value)) return true;
        if (current.length >= max) return false;
        get().setMedia(type, role, [...current, value]);
        return true;
      },
      removeMedia: (type, role, value) => {
        const current = get().drafts[type].medias[role] ?? [];
        get().setMedia(
          type,
          role,
          current.filter((v) => v !== value),
        );
      },
      setPreview: (id, preview) => set((s) => ({ previews: { ...s.previews, [id]: preview } })),
      prefill: (type, request) => {
        const medias: Partial<Record<MediaRole, string[]>> = {};
        for (const m of request.medias ?? []) (medias[m.role] ??= []).push(m.value);
        set((s) => ({
          drafts: {
            ...s.drafts,
            [type]: {
              model: request.model,
              prompt: request.prompt ?? "",
              negative_prompt: request.negative_prompt ?? "",
              aspect_ratio: request.aspect_ratio ?? null,
              duration: request.duration ?? null,
              count: request.count ?? 1,
              medias,
              params: { ...(request.params ?? {}) },
            },
          },
        }));
      },
      resetDraft: (type) => set((s) => ({ drafts: { ...s.drafts, [type]: { ...emptyDraft(), model: s.drafts[type].model } } })),
      notify: (message, tone = "info") => {
        noticeSeq += 1;
        const id = noticeSeq;
        set((s) => ({ notices: [...s.notices.slice(-3), { id, message, tone }] }));
        setTimeout(() => get().dismissNotice(id), 4500);
      },
      dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
    }),
    {
      name: "reflow-studio",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ drafts: s.drafts, previews: s.previews }),
      skipHydration: true,
    },
  ),
);

/** Read a draft for a create screen. */
export function useDraft(type: CreateType): Draft {
  return useStudioStore((s) => s.drafts[type]);
}
