import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REQUIRED_SCHEMA_VERSION } from "@/lib/setup/schema";

const DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const files = readdirSync(DIR)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort();

/** Every `select N;` body of studio_schema_version() in a migration, in file order. */
function schemaVersionsIn(sql: string): number[] {
  const out: number[] = [];
  const pattern = /create or replace function public\.studio_schema_version\(\)[\s\S]*?\$\$\s*select\s+(\d+)\s*;\s*\$\$/gi;
  for (const match of sql.matchAll(pattern)) out.push(Number(match[1]));
  return out;
}

describe("schema version", () => {
  it("REQUIRED_SCHEMA_VERSION equals the newest migration number", () => {
    const newest = Number(/^(\d+)_/.exec(files.at(-1)!)![1]);
    expect(REQUIRED_SCHEMA_VERSION).toBe(newest);
  });

  it("the newest migration sets studio_schema_version() to its own number", () => {
    const newest = files.at(-1)!;
    const versions = schemaVersionsIn(readFileSync(`${DIR}${newest}`, "utf8"));
    expect(versions.at(-1), `${newest} must redefine public.studio_schema_version()`).toBe(Number(/^(\d+)_/.exec(newest)![1]));
  });

  it("every migration from 0007 on bumps the version to its own number", () => {
    for (const file of files.filter((f) => Number(/^(\d+)_/.exec(f)![1]) >= 7)) {
      expect(schemaVersionsIn(readFileSync(`${DIR}${file}`, "utf8")).at(-1), file).toBe(Number(/^(\d+)_/.exec(file)![1]));
    }
  });

  it("migrations are UTF-8 without a BOM, mojibake or long dashes", () => {
    for (const file of files) {
      const bytes = readFileSync(`${DIR}${file}`);
      expect(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, `${file} has a BOM`).toBe(false);
      const text = bytes.toString("utf8");
      expect(text, file).not.toMatch(/\uFFFD|\u00C3[\u0080-\u00BF]|\u00E2\u20AC/);
      if (Number(/^(\d+)_/.exec(file)![1]) >= 7) expect(text, file).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
