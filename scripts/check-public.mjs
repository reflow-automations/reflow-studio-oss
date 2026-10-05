#!/usr/bin/env node
// Public leak gate: scans a directory for secrets and owner identifiers before
// anything is published. No dependencies; Node >= 22.
//
//   node scripts/check-public.mjs [dir] [options]
//
//   dir                         directory to scan (default: current directory)
//   --allowlist <file>          known test vectors (default: scripts/public-allowlist.txt next to this script)
//   --identifiers <file>        owner identifiers in plain text, one per line (default:
//                               docs/private/leak-identifiers.txt in this script's repository, or
//                               $CHECK_PUBLIC_IDENTIFIERS; optional, never published)
//   --identifier-hashes <file>  hashed owner identifiers that are safe to publish (default:
//                               scripts/public-identifier-hashes.txt next to this script)
//   --no-identifier-hashes      do not load the hashed identifiers
//   --write-identifier-hashes   regenerate the hashed file from the plain-text list, then exit
//   --publicignore <file>       skip paths matched by this file (default: <dir>/.publicignore when present)
//   --no-publicignore           scan everything, even paths listed in .publicignore
//   --all-files                 walk the file system instead of asking git which files belong to the tree
//   --json                      print hits as JSON
//
// Exit codes: 0 clean, 1 hits found, 2 usage or runtime error.
// Hits print as "path:line:col  pattern  [masked]"; values are always masked.
//
// Owner identifiers come in two forms. The plain-text list (regexes allowed) lives in
// docs/private/, which never leaves the private repository. The hashed list carries only
// truncated SHA-256 hashes of the literal entries, so the public repository and its CI keep
// catching those identifiers without publishing them.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadIgnoreFile } from "./lib/publicignore.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_REPO = path.resolve(SCRIPT_DIR, "..");

export const DEFAULT_ALLOWLIST = path.join(SCRIPT_DIR, "public-allowlist.txt");
export const DEFAULT_IDENTIFIERS = path.join(SCRIPT_REPO, "docs", "private", "leak-identifiers.txt");
export const DEFAULT_IDENTIFIER_HASHES = path.join(SCRIPT_DIR, "public-identifier-hashes.txt");

/** Files larger than this are reported as skipped instead of scanned. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Directories never scanned when walking the file system. */
const WALK_SKIP_DIRS = new Set([".git", "node_modules", ".next", ".turbo", ".vercel", "coverage"]);

const hasLetterAndDigit = (v) => /[A-Za-z]/.test(v) && /\d/.test(v);
const distinctChars = (v) => new Set(v).size;
const PLACEHOLDER_PASSWORDS = new Set(["password", "postgres", "pass", "secret", "changeme", "your-password", "yourpassword"]);

/**
 * Secret patterns, most specific first. A later pattern is ignored where an
 * earlier one already matched the same span. `validate` drops obvious non-secrets.
 */
export const SECRET_PATTERNS = [
  { name: "private-key-pem", regex: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g },
  { name: "google-api-key", regex: /\bAIza[0-9A-Za-z_-]{35}/g },
  { name: "anthropic-api-key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "openai-project-key", regex: /\bsk-proj-[A-Za-z0-9_-]{20,}/g },
  { name: "openai-style-key", regex: /\bsk-(?:[a-z]+-)?[A-Za-z0-9_-]{20,}/g, validate: (v) => hasLetterAndDigit(v.slice(3)) },
  { name: "stripe-live-key", regex: /\b[rs]k_live_[A-Za-z0-9]{16,}/g },
  { name: "webhook-signing-secret", regex: /\bwhsec_[A-Za-z0-9+/=]{20,}/g },
  { name: "jwt", regex: /\beyJhbGci[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]*){0,2}/g },
  { name: "supabase-secret-key", regex: /\bsb_secret_[A-Za-z0-9_-]{10,}/g },
  { name: "reflow-api-key", regex: /\brfl_[A-Za-z0-9_-]{24,}/g },
  { name: "aws-access-key-id", regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: "github-fine-grained-pat", regex: /\bgithub_pat_[A-Za-z0-9_]{22,}/g },
  { name: "slack-token", regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { name: "slack-webhook-url", regex: /hooks\.slack\.com\/[A-Za-z0-9/_-]+/g },
  {
    name: "fal-api-key",
    regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}\b/gi,
  },
  {
    name: "database-url-with-password",
    regex: /\bpostgres(?:ql)?:\/\/[^\s:/@'"`]+:([^\s@/'"`]+)@/g,
    validate: (_v, m) => {
      const pw = m[1] ?? "";
      return pw.length >= 8 && !/[<>[\]{}$*]/.test(pw) && !PLACEHOLDER_PASSWORDS.has(pw.toLowerCase());
    },
  },
  { name: "hex-secret-64", regex: /\b[0-9a-f]{64}\b/g, validate: (v) => hasLetterAndDigit(v) && distinctChars(v) >= 8 },
  { name: "hex-secret-32", regex: /\b[0-9a-f]{32}\b/g, validate: (v) => hasLetterAndDigit(v) && distinctChars(v) >= 8 },
];

/** File names that must never be published. They are reported without being read. */
const FORBIDDEN_FILES = [
  { name: "env-file", test: (base) => (base === ".env" || base.startsWith(".env.")) && base !== ".env.example" },
  { name: "private-key-file", test: (base) => /\.(pem|p12|pfx|key)$/i.test(base) || /^id_(rsa|dsa|ecdsa|ed25519)(\.|$)/.test(base) },
  { name: "local-config-file", test: (base) => /\.local\.(json|md|ya?ml|toml)$/i.test(base) || base === "settings.local.json" },
];

/** Mask a matched value: at most 4 leading characters (never more than a quarter) plus its length. */
export function mask(value) {
  const keep = Math.min(4, Math.floor(value.length / 4));
  return `${value.slice(0, keep)}***(${value.length} chars)`;
}

/**
 * Allowlist: one entry per line. A plain line allows a hit whose matched value
 * equals it exactly; "re:<regex>" allows values matching the regex. "#" starts a comment.
 */
export function parseAllowlist(text) {
  const exact = new Set();
  const regexes = [];
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("re:")) regexes.push(new RegExp(line.slice(3)));
    else exact.add(line);
  }
  return { isAllowed: (value) => exact.has(value) || regexes.some((r) => r.test(value)) };
}

export function loadAllowlist(file) {
  if (!file || !existsSync(file)) return parseAllowlist("");
  return parseAllowlist(readFileSync(file, "utf8"));
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Identifiers: one per line, case-insensitive. Plain lines are literal text,
 * "re:<regex>" lines are regular expressions. Each becomes a pattern named
 * "owner-identifier#<line>" so logs never show the identifier itself.
 */
export function parseIdentifiers(text) {
  const patterns = [];
  text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const line = raw.trim();
      if (!line || line.startsWith("#")) return;
      const source = line.startsWith("re:") ? line.slice(3) : escapeRegExp(line);
      patterns.push({ name: `owner-identifier#${index + 1}`, regex: new RegExp(source, "gi"), identifier: true });
    });
  return patterns;
}

export function loadIdentifiers(file) {
  if (!file || !existsSync(file)) return [];
  return parseIdentifiers(readFileSync(file, "utf8"));
}

// ---------------------------------------------------------------------------
// Hashed identifiers
//
// An identifier is normalised to its lowercase ASCII letter and digit runs ("tokens"),
// joined by one space: "Foo-Bar.example" and "foo_bar example" both become
// "foo bar example". Each line of the hash file is
//   <hash> <first-token-hash> <token-count>
// where a hash is the first 16 hex characters of SHA-256. The scanner tokenizes every
// line the same way and hashes the token windows that start with a known first token,
// so a hit is always aligned to whole tokens ("foobar" does not match "foo bar").
// ---------------------------------------------------------------------------

const TOKEN_REGEX = /[A-Za-z0-9]+/g;
const shortHash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const tokenHashCache = new Map();
const tokenHash = (token) => {
  let h = tokenHashCache.get(token);
  if (h === undefined) {
    if (tokenHashCache.size > 200_000) tokenHashCache.clear();
    h = shortHash(token);
    tokenHashCache.set(token, h);
  }
  return h;
};

/** Lowercase ASCII letter and digit runs of `text`. */
export function identifierTokens(text) {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Hash one identifier; null when it has no letters or digits. */
export function hashIdentifier(text) {
  const tokens = identifierTokens(text);
  if (tokens.length === 0) return null;
  return { hash: shortHash(tokens.join(" ")), first: shortHash(tokens[0]), count: tokens.length };
}

/** Parse a hash file. Throws on a malformed line so a broken file never silently disables the gate. */
export function parseIdentifierHashes(text) {
  const entries = new Map();
  const firsts = new Set();
  let maxCount = 0;
  text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const line = raw.replace(/#.*/, "").trim();
      if (!line) return;
      const m = /^([0-9a-f]{16})\s+([0-9a-f]{16})\s+([1-9][0-9]?)$/.exec(line);
      if (!m) throw new Error(`identifier hashes, line ${index + 1}: expected "<hash> <first-token-hash> <token-count>"`);
      if (!entries.has(m[1])) entries.set(m[1], index + 1);
      firsts.add(m[2]);
      maxCount = Math.max(maxCount, Number(m[3]));
    });
  return { entries, firsts, maxCount, size: entries.size };
}

export function loadIdentifierHashes(file) {
  if (!file || !existsSync(file)) return null;
  return parseIdentifierHashes(readFileSync(file, "utf8"));
}

const IDENTIFIER_HASHES_HEADER = `# Hashed owner identifiers for scripts/check-public.mjs. Generated, do not edit by hand.
#
# The plain-text list stays in the private repository. This file carries only truncated
# SHA-256 hashes of its literal entries, so the public repository and its CI keep catching
# those identifiers without publishing them. Regex entries are not hashed.
#
# Format: <hash> <first-token-hash> <token-count>. An identifier is normalised to its
# lowercase ASCII letter and digit runs joined by one space ("Foo-Bar.example" becomes
# "foo bar example"); a hash is the first 16 hex characters of its SHA-256.
#
# Regenerate after editing the plain-text list:
#   node scripts/check-public.mjs --write-identifier-hashes
`;

/**
 * Build the hash file for the literal entries of a plain-text identifier list.
 * Lines are sorted by hash, so the file does not reveal the order of the private list.
 */
export function buildIdentifierHashes(identifiersText) {
  const lines = new Set();
  let skippedRegex = 0;
  for (const raw of identifiersText.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("re:")) {
      skippedRegex += 1;
      continue;
    }
    const h = hashIdentifier(line);
    if (h) lines.add(`${h.hash} ${h.first} ${h.count}`);
  }
  const body = [...lines].sort().join("\n");
  return { text: `${IDENTIFIER_HASHES_HEADER}\n${body}${body ? "\n" : ""}`, count: lines.size, skippedRegex };
}

/** Token-aligned hashed identifier matches in one line: [{ start, end, line }]. */
function matchIdentifierHashes(line, hashes) {
  const matches = [];
  const tokens = [...line.matchAll(TOKEN_REGEX)];
  for (let i = 0; i < tokens.length; i += 1) {
    if (!hashes.firsts.has(tokenHash(tokens[i][0].toLowerCase()))) continue;
    let joined = "";
    for (let n = 1; n <= hashes.maxCount && i + n <= tokens.length; n += 1) {
      const token = tokens[i + n - 1];
      joined = n === 1 ? token[0].toLowerCase() : `${joined} ${token[0].toLowerCase()}`;
      const hashLine = hashes.entries.get(shortHash(joined));
      if (hashLine === undefined) continue;
      matches.push({ start: tokens[i].index, end: token.index + token[0].length, line: hashLine });
      break;
    }
  }
  return matches;
}

/**
 * Scan text. Returns hits with 1-based line and column; values are masked.
 * @param {string} text
 * @param {{
 *   patterns?: Array<{name: string, regex: RegExp, validate?: Function}>,
 *   allowlist?: { isAllowed(v: string): boolean },
 *   identifierHashes?: ReturnType<typeof parseIdentifierHashes> | null,
 * }} [options]
 */
export function scanText(text, options = {}) {
  const patterns = options.patterns ?? SECRET_PATTERNS;
  const allowlist = options.allowlist ?? parseAllowlist("");
  const hashes = options.identifierHashes?.size ? options.identifierHashes : null;
  const hits = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, lineIndex) => {
    const taken = [];
    const overlaps = (start, end) => taken.some(([s, e]) => start < e && end > s);
    for (const pattern of patterns) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags.includes("g") ? pattern.regex.flags : `${pattern.regex.flags}g`);
      for (const m of line.matchAll(regex)) {
        const value = m[0];
        if (value === "") continue;
        const start = m.index;
        const end = start + value.length;
        if (overlaps(start, end)) continue;
        if (pattern.validate && !pattern.validate(value, m)) continue;
        if (allowlist.isAllowed(value)) continue;
        taken.push([start, end]);
        hits.push({ line: lineIndex + 1, column: start + 1, pattern: pattern.name, masked: mask(value) });
      }
    }
    if (!hashes) return;
    for (const { start, end, line: hashLine } of matchIdentifierHashes(line, hashes)) {
      const value = line.slice(start, end);
      if (overlaps(start, end) || allowlist.isAllowed(value)) continue;
      taken.push([start, end]);
      hits.push({ line: lineIndex + 1, column: start + 1, pattern: `owner-identifier-hash#${hashLine}`, masked: mask(value) });
    }
  });
  return hits.sort((a, b) => a.line - b.line || a.column - b.column);
}

const toPosix = (p) => p.split(path.sep).join("/");

function isInsideGitWorkTree(dir) {
  try {
    const out = execFileSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() === "true";
  } catch {
    return false;
  }
}

/** Files git considers part of the tree: tracked plus untracked-but-not-ignored, relative to `dir`. */
function listGitFiles(dir) {
  const out = execFileSync("git", ["-C", dir, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return [...new Set(out.split("\0").filter(Boolean))];
}

function walkFiles(dir) {
  const files = [];
  const visit = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (WALK_SKIP_DIRS.has(entry.name)) continue;
        visit(path.join(abs, entry.name), childRel);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(childRel);
      }
    }
  };
  visit(dir, "");
  return files;
}

/**
 * Scan a directory.
 * @param {string} dir
 * @param {{
 *   allowlistFile?: string | null,
 *   identifiersFile?: string | null,
 *   identifierHashesFile?: string | null,
 *   publicignoreFile?: string | null,
 *   allFiles?: boolean,
 *   skipFiles?: string[],
 * }} [options]
 */
export function scanDirectory(dir, options = {}) {
  const root = path.resolve(dir);
  const allowlistFile = options.allowlistFile === undefined ? DEFAULT_ALLOWLIST : options.allowlistFile;
  const identifiersFile = options.identifiersFile === undefined ? DEFAULT_IDENTIFIERS : options.identifiersFile;
  const identifierHashesFile = options.identifierHashesFile === undefined ? DEFAULT_IDENTIFIER_HASHES : options.identifierHashesFile;
  const allowlist = loadAllowlist(allowlistFile);
  const identifierPatterns = loadIdentifiers(identifiersFile);
  const identifierHashes = loadIdentifierHashes(identifierHashesFile);
  const patterns = [...SECRET_PATTERNS, ...identifierPatterns];
  const publicignorePath = options.publicignoreFile === undefined ? path.join(root, ".publicignore") : options.publicignoreFile;
  const ignore = loadIgnoreFile(publicignorePath);

  // The gate's own configuration files contain the patterns by design.
  const skipAbs = new Set(
    [allowlistFile, identifiersFile, identifierHashesFile, ...(options.skipFiles ?? [])]
      .filter(Boolean)
      .map((f) => {
        try {
          return realpathSync.native(f).toLowerCase();
        } catch {
          return path.resolve(f).toLowerCase();
        }
      }),
  );

  const useGit = !options.allFiles && isInsideGitWorkTree(root);
  const files = (useGit ? listGitFiles(root) : walkFiles(root)).sort();

  const hits = [];
  const skipped = [];
  let scanned = 0;
  let ignored = 0;
  for (const rel of files) {
    const relPosix = toPosix(rel);
    if (ignore.isExcluded(relPosix)) {
      ignored += 1;
      continue;
    }
    const abs = path.join(root, rel);
    let stat;
    try {
      stat = lstatSync(abs);
    } catch {
      continue; // listed by git but deleted on disk
    }
    if (!stat.isFile()) continue;
    let real;
    try {
      real = realpathSync.native(abs).toLowerCase();
    } catch {
      real = abs.toLowerCase();
    }
    if (skipAbs.has(real)) continue;

    const base = path.posix.basename(relPosix);
    const forbidden = FORBIDDEN_FILES.find((f) => f.test(base));
    if (forbidden) {
      hits.push({ file: relPosix, line: 0, column: 0, pattern: forbidden.name, masked: "(file not read)" });
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) {
      skipped.push({ file: relPosix, reason: `larger than ${MAX_FILE_BYTES} bytes` });
      continue;
    }
    const buf = readFileSync(abs);
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    scanned += 1;
    for (const hit of scanText(buf.toString("utf8"), { patterns, allowlist, identifierHashes })) hits.push({ file: relPosix, ...hit });
  }
  return {
    root,
    hits,
    skipped,
    scanned,
    ignored,
    identifierPatterns: identifierPatterns.length,
    identifierHashes: identifierHashes?.size ?? 0,
    source: useGit ? "git" : "filesystem",
  };
}

/**
 * Regenerate the hash file from a plain-text identifier list.
 * @param {{ identifiersFile?: string, identifierHashesFile?: string }} [options]
 */
export function writeIdentifierHashes(options = {}) {
  const identifiersFile = options.identifiersFile ?? DEFAULT_IDENTIFIERS;
  const identifierHashesFile = options.identifierHashesFile ?? DEFAULT_IDENTIFIER_HASHES;
  if (!existsSync(identifiersFile)) throw new Error(`identifier list not found: ${identifiersFile}`);
  const built = buildIdentifierHashes(readFileSync(identifiersFile, "utf8"));
  writeFileSync(identifierHashesFile, built.text, "utf8");
  return { ...built, identifierHashesFile };
}

export function formatHit(hit) {
  const where = hit.line > 0 ? `${hit.file}:${hit.line}:${hit.column}` : hit.file;
  return `${where}  ${hit.pattern}  [${hit.masked}]`;
}

export function parseArgs(argv) {
  const opts = { dir: ".", json: false, allFiles: false };
  const rest = [...argv];
  while (rest.length) {
    const arg = rest.shift();
    const value = () => {
      const v = rest.shift();
      if (v === undefined || v.startsWith("--")) throw new Error(`${arg} needs a value`);
      return v;
    };
    if (arg === "--allowlist") opts.allowlistFile = path.resolve(value());
    else if (arg === "--identifiers") opts.identifiersFile = path.resolve(value());
    else if (arg === "--identifier-hashes") opts.identifierHashesFile = path.resolve(value());
    else if (arg === "--no-identifier-hashes") opts.identifierHashesFile = null;
    else if (arg === "--write-identifier-hashes") opts.writeIdentifierHashes = true;
    else if (arg === "--publicignore") opts.publicignoreFile = path.resolve(value());
    else if (arg === "--no-publicignore") opts.publicignoreFile = null;
    else if (arg === "--all-files") opts.allFiles = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else opts.dir = arg;
  }
  if (opts.identifiersFile === undefined && process.env.CHECK_PUBLIC_IDENTIFIERS) {
    opts.identifiersFile = path.resolve(process.env.CHECK_PUBLIC_IDENTIFIERS);
  }
  return opts;
}

function printSummary(result, log) {
  const files = new Set(result.hits.map((h) => h.file)).size;
  log(
    `check-public: ${result.hits.length} hit(s) in ${files} file(s); scanned ${result.scanned} file(s) from ${result.source}, ` +
      `${result.ignored} excluded by .publicignore, ${result.identifierPatterns} owner identifier pattern(s) and ` +
      `${result.identifierHashes} hashed identifier(s) loaded.`,
  );
  for (const s of result.skipped) log(`check-public: skipped ${s.file} (${s.reason})`);
}

export function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`check-public: ${err.message}`);
    return 2;
  }
  if (opts.help) {
    console.log(
      "Usage: node scripts/check-public.mjs [dir] [--allowlist file] [--identifiers file] " +
        "[--identifier-hashes file | --no-identifier-hashes] [--publicignore file | --no-publicignore] [--all-files] [--json]\n" +
        "       node scripts/check-public.mjs --write-identifier-hashes [--identifiers file] [--identifier-hashes file]",
    );
    return 0;
  }
  if (opts.writeIdentifierHashes) {
    try {
      const written = writeIdentifierHashes({ identifiersFile: opts.identifiersFile, identifierHashesFile: opts.identifierHashesFile ?? undefined });
      console.log(
        `check-public: wrote ${written.count} hashed identifier(s) to ${written.identifierHashesFile}` +
          (written.skippedRegex ? `; ${written.skippedRegex} regex entr${written.skippedRegex === 1 ? "y" : "ies"} cannot be hashed and stay private-only.` : "."),
      );
      return 0;
    } catch (err) {
      console.error(`check-public: ${err.message}`);
      return 2;
    }
  }
  if (!existsSync(opts.dir)) {
    console.error(`check-public: directory not found: ${opts.dir}`);
    return 2;
  }
  let result;
  try {
    result = scanDirectory(opts.dir, opts);
  } catch (err) {
    console.error(`check-public: ${err.message}`);
    return 2;
  }
  if (opts.json) {
    console.log(JSON.stringify({ hits: result.hits, skipped: result.skipped, scanned: result.scanned }, null, 2));
  } else {
    for (const hit of result.hits) console.log(formatHit(hit));
    printSummary(result, console.log);
  }
  return result.hits.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main();
}
