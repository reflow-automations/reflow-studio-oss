import { cn } from "@/lib/utils/cn";
import { BRAND, STUDIO_NAME } from "@/components/brand/site";

/**
 * Logo geometry on a 32 x 32 grid, shared by the React mark, app/icon.svg, the
 * apple icon and the OG images. The glyph is a geometric R: a stem, a bowl
 * with a counter, and a curved leg that flows out of the bowl.
 */
export const LOGO_GEOMETRY = {
  viewBox: "0 0 32 32",
  tileRadius: 8,
  /** Stem and bowl as one shape; the counter is cut out with evenodd. */
  body: "M8 7H17.25A6 6 0 0 1 17.25 19H13V25H8ZM13 11V15H17A2 2 0 0 0 17 11Z",
  /** The leg, stroked with a round cap. */
  leg: "M13.75 19C18.5 19 21.25 20.5 22.75 23",
  legWidth: 5,
} as const;

interface LogoMarkProps {
  /** Rendered size in px (square). */
  size?: number;
  className?: string;
  /** Accessible name. Leave empty when a visible wordmark sits next to the mark. */
  title?: string;
}

/** The orange tile with the ink R. Decorative unless `title` is given. */
export function LogoMark({ size = 28, className, title }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={LOGO_GEOMETRY.viewBox}
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <rect width="32" height="32" rx={LOGO_GEOMETRY.tileRadius} fill={BRAND.accent} />
      <path d={LOGO_GEOMETRY.body} fill={BRAND.ink} fillRule="evenodd" />
      <path d={LOGO_GEOMETRY.leg} fill="none" stroke={BRAND.ink} strokeWidth={LOGO_GEOMETRY.legWidth} strokeLinecap="round" />
    </svg>
  );
}

interface LogoProps {
  className?: string;
  /** Mark size in px. */
  markSize?: number;
  /** Hide the wordmark (mark only, gets the studio name as accessible name). */
  markOnly?: boolean;
  /** Wordmark text, defaults to the instance name. */
  name?: string;
  wordmarkClassName?: string;
}

/** Mark plus wordmark. The wordmark is real text so it stays selectable and translatable. */
export function Logo({ className, markSize = 28, markOnly = false, name = STUDIO_NAME, wordmarkClassName }: LogoProps) {
  if (markOnly) return <LogoMark size={markSize} className={className} title={name} />;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2.5", className)}>
      <LogoMark size={markSize} />
      <span className={cn("truncate text-[15px] leading-tight font-semibold tracking-[-0.01em] whitespace-nowrap text-fg", wordmarkClassName)}>{name}</span>
    </span>
  );
}
