"use client";

import { useActionState } from "react";
import { Route } from "lucide-react";
import { setProviderPreferenceAction, type PreferenceState } from "@/app/actions/providers";
import type { ProviderPreference } from "@/lib/settings/provider-keys";
import { ErrorBanner, InfoBanner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";

const OPTIONS: Array<{ id: ProviderPreference; label: string; description: string }> = [
  { id: "cheapest", label: "Cheapest estimate", description: "Compare request price estimates. Higgsfield uses an account quote when available, otherwise a labeled catalog estimate. Cashback is excluded." },
  { id: "fal", label: "Prefer fal.ai", description: "Use fal.ai first when it supports the request; other configured providers are fallbacks." },
  { id: "kie", label: "Prefer Kie.ai", description: "Use Kie.ai first when it supports the request; other configured providers are fallbacks." },
  { id: "higgsfield", label: "Prefer Higgsfield API", description: "Use the separate Higgsfield API balance first when it supports the request." },
];

export function ProviderPreferenceForm({ current }: { current: ProviderPreference }) {
  const [state, action, pending] = useActionState<PreferenceState, FormData>(setProviderPreferenceAction, {});
  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-border bg-elevated p-4">
      <div className="flex items-center gap-2">
        <Route className="size-4 text-accent" aria-hidden />
        <h2 className="text-sm font-semibold">Routing preference</h2>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Provider preference</legend>
        {OPTIONS.map((o) => (
          <label key={o.id} className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 text-xs hover:bg-hover">
            <input type="radio" name="preference" value={o.id} defaultChecked={current === o.id} className="mt-0.5 accent-(--color-accent)" />
            <span>
              <span className="font-medium">{o.label}</span>
              <span className="block text-muted">{o.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {state.error ? <ErrorBanner title="Could not save" message={state.error} /> : state.message ? <InfoBanner>{state.message}</InfoBanner> : null}
      <div>
        <Button type="submit" variant="primary" loading={pending}>
          Save preference
        </Button>
      </div>
    </form>
  );
}
