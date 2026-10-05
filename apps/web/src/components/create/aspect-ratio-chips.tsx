"use client";

import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";

interface AspectRatioChipsProps {
  options: string[];
  value: string | null;
  onChange: (ratio: string) => void;
}

function ratioBox(ratio: string): { width: number; height: number } {
  const [w, h] = ratio.split(":").map(Number);
  if (!w || !h) return { width: 12, height: 12 };
  const scale = 12 / Math.max(w, h);
  return { width: Math.max(4, Math.round(w * scale)), height: Math.max(4, Math.round(h * scale)) };
}

export function AspectRatioChips({ options, value, onChange }: AspectRatioChipsProps) {
  return (
    <Field label="Aspect ratio">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Aspect ratio">
        {options.map((ratio) => {
          const box = ratioBox(ratio);
          return (
            <Chip key={ratio} active={ratio === value} onClick={() => onChange(ratio)} className="gap-1.5">
              <span className="inline-block rounded-[2px] border border-current opacity-70" style={{ width: box.width, height: box.height }} aria-hidden />
              {ratio}
            </Chip>
          );
        })}
      </div>
    </Field>
  );
}
