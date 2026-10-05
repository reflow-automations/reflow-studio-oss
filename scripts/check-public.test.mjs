// Self-test for the public leak gate. Run with: node --test scripts/*.test.mjs
// Every fake secret below is assembled at runtime, so this file never contains a
// literal match for the gate (or for GitHub push protection).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_IDENTIFIER_HASHES,
  DEFAULT_IDENTIFIERS,
  buildIdentifierHashes,
  formatHit,
  hashIdentifier,
  identifierTokens,
  loadIdentifierHashes,
  main,
  mask,
  parseAllowlist,
  parseIdentifierHashes,
  parseIdentifiers,
  SECRET_PATTERNS,
  scanDirectory,
  scanText,
} from "./check-public.mjs";
import { createMatcher, parseIgnore } from "./lib/publicignore.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const tmpDirs = [];
const makeTmp = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const write = (root, rel, content) => {
  const file = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};

const FAKE = {
  "google-api-key": "AI" + "za" + "B".repeat(20) + "c".repeat(10) + "12345",
  "anthropic-api-key": "sk-" + "ant-" + "api03-" + "a1".repeat(15),
  "openai-project-key": "sk-" + "proj-" + "Ab3".repeat(10),
  "openai-style-key": "sk-" + "Ab12".repeat(12),
  "stripe-live-key": "sk" + "_live_" + "A1b2C3d4E5f6G7h8",
  "webhook-signing-secret": "wh" + "sec_" + "A1b2C3d4".repeat(3),
  jwt: "eyJ" + "hbGciOiJIUzI1NiJ9" + ".eyJzdWIiOiIxIn0.abc123",
  "supabase-secret-key": "sb_" + "secret_" + "Xy9".repeat(10),
  "reflow-api-key": "rfl" + "_" + "Q7w".repeat(14),
  "private-key-pem": "-----BEGIN " + "RSA PRIVATE KEY-----",
  "aws-access-key-id": "AK" + "IA" + "Z7Q2".repeat(4),
  "github-token": "gh" + "p_" + "aB3".repeat(12),
  "github-fine-grained-pat": "github" + "_pat_" + "11ABC".repeat(5),
  "slack-token": "xo" + "xb-" + "1234-5678-abcdEFGH",
  "slack-webhook-url": "https://hooks." + "slack.com/services/T000/B000/XXXX",
  "fal-api-key": "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b" + ":" + "9f8e7d6c5b4a3928" + "1706f5e4d3c2b1a0",
  "database-url-with-password": "postgres" + "ql://postgres.abcd:" + "S3cr3tPassw0rd" + "@pooler.example.com:5432/postgres",
  "hex-secret-64": "0123456789abcdef".repeat(4),
  "hex-secret-32": "a1b2c3d4e5f60718" + "293a4b5c6d7e8f90",
};

describe("publicignore matcher", () => {
  const matcher = (text) => createMatcher(parseIgnore(text));

  it("excludes a directory and everything below it, anchored to the root", () => {
    const m = matcher("docs/private/\n");
    assert.equal(m.isExcluded("docs/private/a.md"), true);
    assert.equal(m.isExcluded("docs/private/x/y.json"), true);
    assert.equal(m.isExcluded("docs/privateer.md"), false);
    assert.equal(m.isExcluded("other/docs/private/a.md"), false);
  });

  it("matches unanchored patterns at any depth and anchored ones only at the root", () => {
    const m = matcher("*.local.json\nnode_modules/\n/tmp/\n**/secret.txt\n");
    assert.equal(m.isExcluded("x.local.json"), true);
    assert.equal(m.isExcluded("a/b/c.local.json"), true);
    assert.equal(m.isExcluded("a/node_modules/b.js"), true);
    assert.equal(m.isExcluded("tmp/x.txt"), true);
    assert.equal(m.isExcluded("a/tmp/x.txt"), false);
    assert.equal(m.isExcluded("secret.txt"), true);
    assert.equal(m.isExcluded("a/b/secret.txt"), true);
    assert.equal(m.isExcluded("a/b/secret.txt.bak"), false);
  });

  it("re-includes a file with a negation, but never a file inside an excluded directory", () => {
    assert.equal(matcher("docs/**\n!docs/keep.md\n").isExcluded("docs/keep.md"), false);
    assert.equal(matcher("docs/**\n!docs/keep.md\n").isExcluded("docs/other.md"), true);
    assert.equal(matcher("private/\n!private/ok.md\n").isExcluded("private/ok.md"), true);
  });

  it("ignores comments and blank lines and supports ? and character classes", () => {
    const m = matcher("# comment\n\nfile?.txt\nlog[0-9].md\n");
    assert.equal(m.isExcluded("file1.txt"), true);
    assert.equal(m.isExcluded("file10.txt"), false);
    assert.equal(m.isExcluded("log7.md"), true);
    assert.equal(m.isExcluded("logx.md"), false);
    assert.equal(m.isExcluded("# comment"), false);
  });
});

describe("scanText", () => {
  for (const [name, value] of Object.entries(FAKE)) {
    it(`detects ${name}`, () => {
      const hits = scanText(`const value = "${value}";`);
      assert.equal(hits.length, 1, JSON.stringify(hits));
      assert.equal(hits[0].pattern, name);
      assert.equal(hits[0].line, 1);
    });
  }

  it("ignores placeholders, documentation examples and look-alikes", () => {
    const text = [
      "Authorization: Bearer rfl_…",
      "Authorization: Bearer rfl_...",
      'accessKeyId: "AKIAEXAMPLE"',
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      "postgresql://postgres.<project-ref>:<password>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
      "the anon key (eyJhbGci...) is public",
      "task-" + "x".repeat(30),
      "commit " + "0123456789abcdef0123456789abcdef01234567",
      "0".repeat(64),
    ].join("\n");
    assert.deepEqual(scanText(text), []);
  });

  it("reports one hit for a fal key instead of also flagging its hex half", () => {
    const hits = scanText(FAKE["fal-api-key"]);
    assert.deepEqual(
      hits.map((h) => h.pattern),
      ["fal-api-key"],
    );
  });

  it("masks values in hits and formatted output", () => {
    const value = FAKE["google-api-key"];
    const [hit] = scanText(`key=${value}`);
    assert.equal(hit.column, 5);
    assert.ok(!hit.masked.includes(value.slice(4)), hit.masked);
    assert.ok(!formatHit({ file: "a.ts", ...hit }).includes(value));
    assert.equal(mask("abcdefgh"), "ab***(8 chars)");
    assert.equal(mask("abc"), "***(3 chars)");
  });

  it("honours exact and regex allowlist entries", () => {
    const hex = FAKE["hex-secret-64"];
    assert.equal(scanText(hex, { allowlist: parseAllowlist(`# test vector\n${hex}\n`) }).length, 0);
    assert.equal(scanText(hex, { allowlist: parseAllowlist("re:^0123") }).length, 0);
    assert.equal(scanText(hex, { allowlist: parseAllowlist(hex.slice(0, 20)) }).length, 1);
  });

  it("matches owner identifiers case-insensitively without printing them", () => {
    const patterns = parseIdentifiers("# owner\nAcme Corp\nre:proj-[0-9]{4}\n");
    const hits = scanText("Contact ACME corp about proj-1234 today", { patterns });
    assert.deepEqual(
      hits.map((h) => h.pattern),
      ["owner-identifier#2", "owner-identifier#3"],
    );
    for (const hit of hits) assert.ok(!formatHit({ file: "x", ...hit }).toLowerCase().includes("acme corp"));
  });

  it("reports hits in line and column order, not in pattern order", () => {
    const text = `Acme Corp uses ${FAKE["github-token"]}`;
    const hits = scanText(text, { patterns: [...SECRET_PATTERNS, ...parseIdentifiers("Acme Corp\n")] });
    assert.deepEqual(
      hits.map((h) => h.pattern),
      ["owner-identifier#1", "github-token"],
    );
  });
});

describe("hashed identifiers", () => {
  const hashes = (list) => parseIdentifierHashes(buildIdentifierHashes(list).text);

  it("normalises identifiers to lowercase letter and digit runs", () => {
    assert.deepEqual(identifierTokens("Acme-Corp.example/Team_1"), ["acme", "corp", "example", "team", "1"]);
    assert.deepEqual(hashIdentifier("Acme Corp"), hashIdentifier("acme_corp"));
    assert.equal(hashIdentifier("--- ..."), null);
    const h = hashIdentifier("Acme Corp");
    assert.match(h.hash, /^[0-9a-f]{16}$/);
    assert.equal(h.count, 2);
  });

  it("builds a sorted file without plain text and skips regex entries", () => {
    const built = buildIdentifierHashes("# comment\nAcme Corp\nre:proj-[0-9]+\nsecret-project.example\nAcme Corp\n");
    assert.equal(built.count, 2);
    assert.equal(built.skippedRegex, 1);
    assert.ok(!/acme|secret-project/i.test(built.text.split("\n").filter((l) => !l.startsWith("#")).join("\n")));
    const body = built.text.split("\n").filter((l) => l && !l.startsWith("#"));
    assert.deepEqual(body, [...body].sort());
    assert.equal(parseIdentifierHashes(built.text).size, 2);
  });

  it("matches whole tokens in any case and separator, and masks the value", () => {
    const set = hashes("Acme Corp\nsecret-project.example\n");
    const text = ["Ask ACME-corp today", "see https://secret-project.example/x", "acmecorp is fine", "AcmeCorporation too"].join("\n");
    const hits = scanText(text, { patterns: [], identifierHashes: set });
    assert.deepEqual(
      hits.map((h) => [h.line, h.column]),
      [
        [1, 5],
        [2, 13],
      ],
    );
    for (const hit of hits) {
      assert.match(hit.pattern, /^owner-identifier-hash#\d+$/);
      assert.ok(!hit.masked.toLowerCase().includes("corp") && !hit.masked.includes("project"), hit.masked);
    }
  });

  it("does not double-report a span the plain-text list already caught", () => {
    const hits = scanText("Acme Corp", { patterns: parseIdentifiers("Acme Corp\n"), identifierHashes: hashes("Acme Corp\n") });
    assert.deepEqual(
      hits.map((h) => h.pattern),
      ["owner-identifier#1"],
    );
  });

  it("rejects a malformed hash file instead of silently disabling the gate", () => {
    assert.throws(() => parseIdentifierHashes("not-a-hash\n"), /line 1/);
    assert.equal(parseIdentifierHashes("# only comments\n\n").size, 0);
  });

  it("scanDirectory loads a hash file and --write-identifier-hashes regenerates it", () => {
    const dir = makeTmp("check-public-hashes-");
    const gate = makeTmp("check-public-gate-");
    write(dir, "docs/a.md", "Owned by Acme Corp.\n");
    const list = write(gate, "identifiers.txt", "Acme Corp\n");
    const hashFile = path.join(gate, "hashes.txt");
    const quiet = (fn) => {
      const original = console.log;
      console.log = () => {};
      try {
        return fn();
      } finally {
        console.log = original;
      }
    };
    assert.equal(quiet(() => main(["--write-identifier-hashes", "--identifiers", list, "--identifier-hashes", hashFile])), 0);
    assert.ok(!fs.readFileSync(hashFile, "utf8").toLowerCase().includes("acme"));
    const result = scanDirectory(dir, { identifiersFile: null, identifierHashesFile: hashFile, allowlistFile: null, allFiles: true });
    assert.deepEqual(
      result.hits.map((h) => `${h.file}:${h.line}`),
      ["docs/a.md:1"],
    );
    assert.equal(result.identifierHashes, 1);
    const without = scanDirectory(dir, { identifiersFile: null, identifierHashesFile: null, allowlistFile: null, allFiles: true });
    assert.equal(without.hits.length, 0);
  });

  it("ships a valid hash file next to the script", () => {
    assert.equal(DEFAULT_IDENTIFIER_HASHES, path.join(SCRIPT_DIR, "public-identifier-hashes.txt"));
    const loaded = loadIdentifierHashes(DEFAULT_IDENTIFIER_HASHES);
    assert.ok(loaded && loaded.size > 0, "scripts/public-identifier-hashes.txt is missing or empty");
  });

  it(
    "covers every literal entry of the private identifier list",
    { skip: !fs.existsSync(DEFAULT_IDENTIFIERS) && "no private identifier list in this checkout" },
    () => {
      const expected = buildIdentifierHashes(fs.readFileSync(DEFAULT_IDENTIFIERS, "utf8"));
      const shipped = loadIdentifierHashes(DEFAULT_IDENTIFIER_HASHES);
      const missing = parseIdentifierHashes(expected.text);
      const stale = [...missing.entries.keys()].filter((h) => !shipped.entries.has(h));
      assert.deepEqual(stale, [], "run: node scripts/check-public.mjs --write-identifier-hashes");
    },
  );
});

describe("scanDirectory", () => {
  const setup = () => {
    const dir = makeTmp("check-public-");
    write(dir, "src/clean.ts", "export const ok = 1;\n");
    write(dir, "src/leak.ts", `export const key = "${FAKE["github-token"]}";\n`);
    write(dir, "docs/notes.md", "Talk to Acme Corp.\n");
    write(dir, "private/plan.md", "Acme Corp internal plan\n");
    write(dir, ".publicignore", "private/\n");
    write(dir, ".env.local", `FAL_KEY=${FAKE["fal-api-key"]}\n`);
    write(dir, ".env.example", "FAL_KEY=\n");
    write(dir, "node_modules/pkg/index.js", `module.exports = "${FAKE["google-api-key"]}";\n`);
    fs.writeFileSync(path.join(dir, "image.png"), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]), Buffer.from(FAKE["google-api-key"])]));
    const identifiers = write(dir, "gate/identifiers.txt", "Acme Corp\n");
    const allowlist = write(dir, "gate/allowlist.txt", "");
    return { dir, identifiers, allowlist };
  };

  it("reports secrets, identifiers and env files, and skips ignored, binary and vendored files", () => {
    const { dir, identifiers, allowlist } = setup();
    const result = scanDirectory(dir, { identifiersFile: identifiers, allowlistFile: allowlist, allFiles: true });
    const found = result.hits.map((h) => `${h.file}|${h.pattern}`).sort();
    assert.deepEqual(found, [".env.local|env-file", "docs/notes.md|owner-identifier#1", "src/leak.ts|github-token"]);
    const envHit = result.hits.find((h) => h.pattern === "env-file");
    assert.equal(envHit.masked, "(file not read)");
    assert.equal(result.ignored, 1);
  });

  it("scans paths from .publicignore when told to", () => {
    const { dir, identifiers, allowlist } = setup();
    const result = scanDirectory(dir, { identifiersFile: identifiers, allowlistFile: allowlist, allFiles: true, publicignoreFile: null });
    assert.ok(result.hits.some((h) => h.file === "private/plan.md"));
  });

  it("returns exit code 0 for a clean tree, 1 for hits and 2 for a missing directory", () => {
    const clean = makeTmp("check-public-clean-");
    write(clean, "a.md", "nothing to see\n");
    const quiet = (fn) => {
      const original = console.log;
      const originalError = console.error;
      console.log = () => {};
      console.error = () => {};
      try {
        return fn();
      } finally {
        console.log = original;
        console.error = originalError;
      }
    };
    const { dir, identifiers, allowlist } = setup();
    assert.equal(quiet(() => main([clean, "--all-files", "--identifiers", identifiers, "--allowlist", allowlist])), 0);
    assert.equal(quiet(() => main([dir, "--all-files", "--identifiers", identifiers, "--allowlist", allowlist])), 1);
    assert.equal(quiet(() => main([path.join(clean, "missing"), "--all-files"])), 2);
    assert.equal(quiet(() => main(["--bogus"])), 2);
  });
});
