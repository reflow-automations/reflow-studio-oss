"use client";

import type { PublicModel } from "@reflow/core";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface DurationControlProps {
  model: PublicModel;
  value: number | null;
  onChange: (seconds: number) => void;
}

export function DurationControl({ model, value, onChange }: DurationControlProps) {
  if (model.durations && model.durations.length > 0) {
    return (
      <Field label="Duration">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Duration">
          {model.durations.map((d) => (
            <Chip key={d} active={d === value} onClick={() => onChange(d)}>
              {d}s
            </Chip>
          ))}
        </div>
      </Field>
    );
  }
  if (model.duration_range) {
    const { min, max } = model.duration_range;
    const current = value ?? min;
    return (
      <Field label="Duration" htmlFor="duration-range" trailing={<span className="font-mono text-xs text-muted">{current}s</span>} hint={`${min}–${max} seconds`}>
        <div className="flex items-center gap-2">
          <input id="duration-range" type="range" min={min} max={max} step={1} value={current} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-(--color-accent)" aria-valuetext={`${current} seconds`} />
          <Input type="number" min={min} max={max} step={1} value={current} onChange={(e) => onChange(Number(e.target.value))} className="w-16" aria-label="Duration in seconds" />
        </div>
      </Field>
    );
  }
  return null;
}
