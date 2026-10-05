"use client";

import { useEffect } from "react";
import "./globals.css";
import { fontVariables } from "@/components/brand/fonts";
import { LogoMark } from "@/components/brand/logo";
import { STUDIO_NAME } from "@/components/brand/site";
import { ErrorState } from "@/components/ui/error-state";
import { buttonClasses } from "@/components/ui/button";

/**
 * Last-resort boundary for errors in the root or (studio) layout, such as a
 * missing or invalid environment variable on a fresh deployment. It replaces
 * the root layout, so it renders its own <html> and imports the global styles.
 * Links are plain anchors: a full reload is the safest way out of a broken
 * layout.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className={fontVariables}>
      <body className="flex min-h-dvh flex-col items-center justify-center bg-bg font-sans text-fg antialiased">
        <title>{`Something went wrong | ${STUDIO_NAME}`}</title>
        <LogoMark size={32} title={STUDIO_NAME} />
        <ErrorState
          className="pt-8"
          title="The studio could not start"
          description={
            <>
              This usually means the deployment is missing configuration, for example a Supabase key or a database migration. The setup checklist shows which step needs attention.
            </>
          }
          digest={error.digest}
          onRetry={retry}
          actions={
            <>
              <a href="/setup" className={buttonClasses({ variant: "secondary" })}>
                Open setup checklist
              </a>
              <a href="/login" className={buttonClasses({ variant: "ghost" })}>
                Sign in again
              </a>
            </>
          }
        />
      </body>
    </html>
  );
}
