"use client";

import { useActionState, useState } from "react";
import { revokeApiKeyAction, type RevokeApiKeyState } from "@/app/actions/api-keys";
import { Button } from "@/components/ui/button";

export function RevokeKeyButton({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState<RevokeApiKeyState, FormData>(revokeApiKeyAction, {});
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} aria-label={`Revoke ${name}`}>
        Revoke
      </Button>
    );
  }
  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="danger" loading={pending}>
        Confirm revoke
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Keep
      </Button>
      {state.error ? (
        <span className="text-[11px] text-danger" role="alert">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
