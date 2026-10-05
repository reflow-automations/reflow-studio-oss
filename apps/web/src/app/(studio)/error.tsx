"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/error-state";
import { buttonClasses } from "@/components/ui/button";

export default function StudioError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // Client errors keep their message; server errors are redacted in production and carry a digest instead.
  const description = error.digest ? (
    <>
      The server could not render this screen. Try again, or open the setup checklist if this keeps happening after a deploy. The reference below matches an entry in your Vercel runtime logs.
    </>
  ) : (
    error.message || "Unexpected error."
  );

  return (
    <ErrorState
      title="This screen failed to load"
      description={description}
      digest={error.digest}
      onRetry={retry}
      actions={
        <>
          <Link href="/create/image" className={buttonClasses({ variant: "secondary" })}>
            Back to studio
          </Link>
          <Link href="/setup" className={buttonClasses({ variant: "ghost" })}>
            Setup checklist
          </Link>
        </>
      }
    />
  );
}
