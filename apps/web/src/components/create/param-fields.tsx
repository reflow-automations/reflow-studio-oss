"use client";

import { useState } from "react";
import type { ModelParameter, PublicModel } from "@reflow/core";
import type { CreateType } from "@/lib/client/api";
import { humanize } from "@/lib/client/format";
import { useDraft, useStudioStore } from "@/lib/client/store";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { Badge } from "@/components/ui/badge";

export function ParamFields({ type, model }: { type: CreateType; model: PublicModel }) {
  const draft = useDraft(type);
  const setParam = useStudioStore((s) => s.setParam);
  return (
    <details open className="group rounded-md border border-border">
      <summary className="cursor-pointer list-none px-3 py-2 text-[11px] font-medium tracking-wide text-muted uppercase select-none hover:text-fg">
        Parameters <span className="text-subtle">({model.parameters.length})</span>
      </summary>
      <div className="grid grid-cols-1 gap-3 border-t border-border p-3 sm:grid-cols-2">
        {model.parameters.map((p) => (
          <ParamField key={`${model.id}:${p.name}`} param={p} value={draft.params[p.name] ?? p.default} onChange={(v) => setParam(type, p.name, v)} />
        ))}
      </div>
    </details>
  );
}

interface ParamFieldProps {
  param: ModelParameter;
  value: unknown;
  onChange: (value: unknown) => void;
}

function ParamLabel({ param }: { param: ModelParameter }) {
  return (
    <>
      {humanize(param.name)}
      {param.required ? <span className="text-danger"> *</span> : null}
      {param.affects_cost ? (
        <Badge tone="warning" className="ml-1.5 h-4 px-1 normal-case" title="Affects price">
          $
        </Badge>
      ) : null}
    </>
  );
}

function ParamField({ param, value, onChange }: ParamFieldProps) {
  const id = `param-${param.name}`;
  const numeric = param.type === "number" || param.type === "integer";

  if (param.type === "boolean") {
    return (
      <Field label={<ParamLabel param={param} />} htmlFor={id} hint={param.description}>
        <Toggle id={id} checked={Boolean(value)} onChange={onChange} label={humanize(param.name)} />
      </Field>
    );
  }
  if (param.options && param.options.length > 0) {
    return (
      <Field label={<ParamLabel param={param} />} htmlFor={id} hint={param.description}>
        <Select
          id={id}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") onChange(undefined);
            else onChange(numeric ? Number(raw) : raw);
          }}
        >
          {!param.required || value === undefined ? <option value="">{param.default !== undefined ? `Default (${String(param.default)})` : "—"}</option> : null}
          {param.options.map((o) => (
            <option key={String(o)} value={String(o)}>
              {String(o)}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  if (numeric) return <NumberField id={id} param={param} value={value} onChange={onChange} />;
  if (param.type === "string_array") {
    return (
      <Field label={<ParamLabel param={param} />} htmlFor={id} hint={`${param.description} Comma separated.`}>
        <Input id={id} value={Array.isArray(value) ? value.join(", ") : ""} placeholder="a, b, c" onChange={(e) => onChange(e.target.value.trim() ? e.target.value.split(",").map((s) => s.trim()).filter(Boolean) : undefined)} />
      </Field>
    );
  }
  if (param.type === "object") return <JsonField id={id} param={param} value={value} onChange={onChange} />;
  return (
    <Field label={<ParamLabel param={param} />} htmlFor={id} hint={param.description}>
      <Input id={id} value={typeof value === "string" ? value : value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value)} placeholder={param.default !== undefined ? String(param.default) : undefined} />
    </Field>
  );
}

function NumberField({ id, param, value, onChange }: ParamFieldProps & { id: string }) {
  const [local, setLocal] = useState<string | null>(null);
  const shown = local ?? (value === undefined || value === null ? "" : String(value));
  const range = [param.min !== undefined ? `min ${param.min}` : null, param.max !== undefined ? `max ${param.max}` : null].filter(Boolean).join(", ");
  return (
    <Field label={<ParamLabel param={param} />} htmlFor={id} hint={range ? `${param.description} (${range})` : param.description}>
      <Input
        id={id}
        type="number"
        inputMode={param.type === "integer" ? "numeric" : "decimal"}
        min={param.min}
        max={param.max}
        step={param.type === "integer" ? 1 : "any"}
        value={shown}
        placeholder={param.default !== undefined ? String(param.default) : undefined}
        onChange={(e) => {
          const raw = e.target.value;
          setLocal(raw);
          if (raw === "") onChange(undefined);
          else if (Number.isFinite(Number(raw))) onChange(Number(raw));
        }}
        onBlur={() => setLocal(null)}
      />
    </Field>
  );
}

function JsonField({ id, param, value, onChange }: ParamFieldProps & { id: string }) {
  const [text, setText] = useState(() => (value === undefined || value === null ? "" : JSON.stringify(value, null, 2)));
  const [error, setError] = useState<string | null>(null);
  return (
    <Field label={<ParamLabel param={param} />} htmlFor={id} hint={`${param.description} JSON object.`} error={error} className="sm:col-span-2">
      <Textarea
        id={id}
        value={text}
        spellCheck={false}
        className="font-mono text-xs"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text.trim() === "") {
            setError(null);
            onChange(undefined);
            return;
          }
          try {
            const parsed: unknown = JSON.parse(text);
            if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("must be a JSON object");
            setError(null);
            onChange(parsed);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Invalid JSON");
          }
        }}
      />
    </Field>
  );
}
