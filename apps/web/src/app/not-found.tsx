import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { buttonClasses } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <LogoMark size={36} />
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-accent tabular-nums">404</p>
        <h1 className="text-3xl font-semibold text-fg">Nothing here</h1>
        <p className="max-w-sm text-sm text-muted">The page or generation you asked for does not exist in this studio, or it was removed.</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link href="/create/image" className={buttonClasses({ variant: "primary" })}>
          Back to the studio
        </Link>
        <Link href="/library" className={buttonClasses({ variant: "secondary" })}>
          Open library
        </Link>
      </div>
    </div>
  );
}
