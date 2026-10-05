"use client";

import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";

interface CountControlProps {
  value: number;
  max: number;
  onChange: (count: number) => void;
}

export function CountControl({ value, max, onChange }: CountControlProps) {
  const options = Array.from({ length: Math.max(1, Math.min(4, max)) }, (_, i) => i + 1);
  return (
    <Field label="Variants" hint={max < 4 ? `This model returns at most ${max} per request.` : undefined}>
      <div className="flex gap-1.5" role="group" aria-label="Number of variants">
        {options.map((n) => (
          <Chip key={n} active={n === value} onClick={() => onChange(n)} className="w-9">
            {n}
          </Chip>
        ))}
      </div>
    </Field>
  );
}
