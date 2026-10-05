import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { STUDIO_HEADLINE } from "@/components/brand/site";
import { SHOWCASE_IMAGES, balanceColumns, type ShowcaseImage } from "@/components/brand/showcase";
import { cn } from "@/lib/utils/cn";

const PROVIDERS = ["fal.ai", "Kie.ai", "Higgsfield"];

/**
 * One scrolling column. The items repeat four times and the column moves by
 * half its own height, so the two halves are identical and the loop is
 * seamless; two copies per half keep even a tall viewport filled.
 */
function ShowcaseColumn({ images, direction, className }: { images: ShowcaseImage[]; direction: "up" | "down"; className?: string }) {
  const loop = [...images, ...images, ...images, ...images];
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col will-change-transform", direction === "up" ? "animate-marquee-up" : "animate-marquee-down", className)}>
      {loop.map((image, i) => (
        // Padding instead of gap keeps both halves exactly the same height.
        <div key={`${image.src}-${i}`} className="pb-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static thumbnails; lazy so phones (panel hidden) never fetch them */}
          <img src={image.src} width={image.width} height={image.height} alt="" loading="lazy" decoding="async" className="block h-auto w-full rounded-md border border-white/5 bg-elevated" />
        </div>
      ))}
    </div>
  );
}

/** Decorative wall of sample outputs behind the value proposition (lg and up). */
function ShowcasePanel() {
  const columns = balanceColumns(SHOWCASE_IMAGES, 3);
  return (
    <section aria-label="About this studio" className="relative hidden min-h-dvh flex-1 overflow-hidden border-r border-border bg-panel lg:flex">
      {/* items-start: each column keeps its content height, which translateY(-50%) is relative to. */}
      <div className="absolute inset-0 flex items-start gap-3 px-3 opacity-80" aria-hidden>
        <ShowcaseColumn images={columns[0]} direction="up" />
        <ShowcaseColumn images={columns[1]} direction="down" className="-mt-24" />
        <ShowcaseColumn images={columns[2]} direction="up" className="-mt-48" />
      </div>
      {/* Fades keep the copy at full contrast over the moving wall. */}
      <div className="absolute inset-0 bg-linear-to-b from-bg/70 via-bg/10 to-transparent" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 h-[62%] bg-linear-to-t from-bg via-bg/90 to-transparent" aria-hidden />

      <div className="relative mt-auto flex max-w-xl flex-col gap-6 p-10 xl:p-14">
        <Logo markSize={36} wordmarkClassName="text-lg" />
        <div className="flex flex-col gap-4">
          <p className="text-5xl font-semibold text-balance text-fg">{STUDIO_HEADLINE}</p>
          <p className="max-w-md text-base text-fg-2">Open source and self-hosted. Bring your own provider keys; prompts, outputs and spend stay in your own database.</p>
        </div>
        <ul className="flex flex-wrap gap-2" aria-label="Supported providers">
          {PROVIDERS.map((provider) => (
            <li key={provider} className="rounded-full border border-border-strong bg-elevated/80 px-3 py-1 text-xs font-medium text-fg-2 backdrop-blur">
              {provider}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Split layout for sign-in style pages: showcase and value proposition on
 * the left (lg and up), the form column on the right. On phones only the form
 * column shows, with the logo and a soft orange glow.
 */
export function AuthFrame({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1">
      <ShowcasePanel />
      <div className="relative flex w-full flex-col overflow-hidden lg:w-[480px] lg:shrink-0 xl:w-[540px]">
        <div className="pointer-events-none absolute -top-40 left-1/2 size-[520px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(247_149_29/0.16),transparent)] lg:hidden" aria-hidden />
        <div className="relative flex flex-1 flex-col justify-center px-5 py-10 sm:px-10">
          <div className="mx-auto flex w-full max-w-sm flex-col gap-8">
            <div className="lg:hidden">
              <Logo markSize={32} />
              <p className="mt-4 text-sm text-muted">{STUDIO_HEADLINE} Bring your own keys.</p>
            </div>
            {children}
          </div>
        </div>
        {footer ? <div className="relative px-5 pb-8 sm:px-10">{footer}</div> : null}
      </div>
    </div>
  );
}
