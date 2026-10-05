import { cn } from "@/lib/utils/cn";

/** First letter of the e-mail's local part, for the avatar circle. */
export function accountInitial(email: string): string {
  const first = email.trim().charAt(0);
  return first ? first.toUpperCase() : "?";
}

/** Avatar initial, e-mail and workspace name. Truncates; the full e-mail is in the title. */
export function AccountSummary({ email, workspace, className }: { email: string; workspace: string | null; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border-strong bg-hover text-[13px] font-semibold text-fg-2" aria-hidden>
        {accountInitial(email)}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-fg" title={email}>
          {email}
        </p>
        <p className="truncate text-xs text-muted">{workspace ?? "No workspace yet"}</p>
      </div>
    </div>
  );
}
