#!/usr/bin/env node
// Export the public tree of this repository into a separate directory, then run
// the leak gate (scripts/check-public.mjs) on the result. No dependencies; Node >= 22.
//
//   node scripts/export-public.mjs <target-dir> [options]
//
//   --ref <rev>              export this commit (default HEAD); file contents come straight from git
//   --worktree               export the working tree instead: tracked plus untracked, non-ignored files
//                            exactly as they are on disk (for checking work that is not committed yet)
//   --force                  replace an earlier export: everything in the target except .git is deleted
//                            first (refused unless the target holds a .publicignore, as every export does)
//   --init                   after a clean gate: git init -b main (when there is no .git yet),
//                            git add -A and one commit
//   --author "Name <email>"  author and committer of that commit
//                            (default: "Reflow Automations <noreply@users.noreply.github.com>")
//   --message <text>         commit message (default: "Initial public release" or "Update public snapshot")
//   --publicignore <file>    exclusion list (default: .publicignore in the source repository)
//   --allowlist <file>       allowlist for the gate (default: scripts/public-allowlist.txt)
//   --identifiers <file>     owner identifiers for the gate (default: docs/private/leak-identifiers.txt)
//   --identifier-hashes <file>  hashed owner identifiers for the gate
//                            (default: scripts/public-identifier-hashes.txt)
//   --repo <dir>             source repository (default: the repository that contains this script)
//   --dry-run                print what would be exported and excluded; write nothing
//
// The target must be outside the source repository. This script never pushes,
// never adds remotes and never creates repositories on any hosting service.
// Exit codes: 0 done, 1 leak gate found hits, 2 usage error or refusal.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_ALLOWLIST, DEFAULT_IDENTIFIER_HASHES, formatHit, scanDirectory } from "./check-public.mjs";
import { loadIgnoreFile } from "./lib/publicignore.mjs";

const SCRIPT_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_AUTHOR = "Reflow Automations <noreply@users.noreply.github.com>";

export class ExportError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

function git(cwd, args, extra = {}) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...extra,
  });
}

/** Real path of `p`, also when `p` (or its tail) does not exist yet. */
function realpathLoose(p) {
  let current = path.resolve(p);
  const tail = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    tail.unshift(path.basename(current));
    current = parent;
  }
  let real = current;
  try {
    real = fs.realpathSync.native(current);
  } catch {
    // keep the resolved path
  }
  return path.join(real, ...tail);
}

function isWithin(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

export function parseAuthor(value) {
  const m = /^\s*([^<>]+?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(value ?? "");
  if (!m) throw new ExportError(`--author must look like "Name <email>", got: ${value}`);
  return { name: m[1], email: m[2] };
}

/** Refuse targets that could overwrite or publish the source repository. */
export function validateTarget(repoRoot, target) {
  const realRepo = realpathLoose(repoRoot);
  const realTarget = realpathLoose(target);
  if (isWithin(realTarget, realRepo)) throw new ExportError(`refusing: target ${realTarget} is inside the source repository`);
  if (isWithin(realRepo, realTarget)) throw new ExportError(`refusing: target ${realTarget} contains the source repository`);
  if (path.parse(realTarget).root === realTarget) throw new ExportError(`refusing: target ${realTarget} is a file system root`);
  if (realTarget === realpathLoose(os.homedir())) throw new ExportError(`refusing: target ${realTarget} is your home directory`);
  if (fs.existsSync(realTarget) && !fs.statSync(realTarget).isDirectory()) throw new ExportError(`refusing: target ${realTarget} is not a directory`);
  if (fs.existsSync(path.join(realTarget, ".git"))) {
    let targetCommon;
    let repoCommon;
    try {
      targetCommon = realpathLoose(path.resolve(realTarget, git(realTarget, ["rev-parse", "--git-common-dir"]).trim()));
      repoCommon = realpathLoose(path.resolve(realRepo, git(realRepo, ["rev-parse", "--git-common-dir"]).trim()));
    } catch {
      targetCommon = undefined;
    }
    if (targetCommon && repoCommon && path.relative(targetCommon, repoCommon) === "") {
      throw new ExportError(`refusing: target ${realTarget} is a worktree of the source repository`);
    }
  }
  return realTarget;
}

/**
 * Create the target, or clear it (except .git) when --force is set. --force only
 * clears an earlier export (recognised by the .publicignore every export carries),
 * so a mistyped path can never wipe an unrelated folder.
 */
function prepareTarget(target, force, log) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
    return;
  }
  const entries = fs.readdirSync(target).filter((name) => name !== ".git");
  if (entries.length === 0) return;
  if (!force) throw new ExportError(`refusing: target ${target} is not empty (pass --force to replace an earlier export; .git is kept)`);
  if (!fs.existsSync(path.join(target, ".publicignore"))) {
    throw new ExportError(
      `refusing: target ${target} is not empty and is not an earlier export (no .publicignore at its root). --force only replaces earlier exports; use an empty folder.`,
    );
  }
  log(`export-public: clearing ${entries.length} entr${entries.length === 1 ? "y" : "ies"} in ${target} (keeping .git)`);
  for (const name of entries) fs.rmSync(path.join(target, name), { recursive: true, force: true });
}

/** Tracked entries of a commit: [{ path, mode, type, oid }]. */
function listRefEntries(repoRoot, ref) {
  try {
    git(repoRoot, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  } catch {
    throw new ExportError(`unknown ref: ${ref}`);
  }
  const out = git(repoRoot, ["ls-tree", "-r", "-z", "--full-tree", ref]);
  return out
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      const [mode, type, oid] = line.slice(0, tab).split(" ");
      return { path: line.slice(tab + 1), mode, type, oid };
    });
}

/** Read many blobs in one `git cat-file --batch` call. */
function readBlobs(repoRoot, oids) {
  const unique = [...new Set(oids)];
  const blobs = new Map();
  if (unique.length === 0) return blobs;
  const res = spawnSync("git", ["-C", repoRoot, "cat-file", "--batch"], {
    input: `${unique.join("\n")}\n`,
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (res.status !== 0) throw new ExportError(`git cat-file failed: ${res.stderr?.toString() ?? res.error}`);
  const out = res.stdout;
  let pos = 0;
  for (let i = 0; i < unique.length; i += 1) {
    const nl = out.indexOf(0x0a, pos);
    const [oid, type, size] = out.toString("utf8", pos, nl).split(" ");
    if (type === "missing" || size === undefined) throw new ExportError(`git object missing: ${unique[i]}`);
    const start = nl + 1;
    blobs.set(oid, out.subarray(start, start + Number(size)));
    pos = start + Number(size) + 1;
  }
  return blobs;
}

/** Files of the working tree that git would track: [{ path }]. */
function listWorktreeEntries(repoRoot) {
  const out = git(repoRoot, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  return [...new Set(out.split("\0").filter(Boolean))].map((p) => ({ path: p }));
}

function destinationFor(target, relPath) {
  const dest = path.join(target, ...relPath.split("/"));
  if (!isWithin(dest, target) || dest === target) throw new ExportError(`refusing unsafe path from git: ${relPath}`);
  return dest;
}

function writeRefEntries(repoRoot, target, entries, log) {
  const blobs = readBlobs(
    repoRoot,
    entries.filter((e) => e.type === "blob").map((e) => e.oid),
  );
  let written = 0;
  for (const entry of entries) {
    if (entry.type !== "blob") {
      log(`export-public: skipping ${entry.path} (${entry.type}, not a regular file)`);
      continue;
    }
    const dest = destinationFor(target, entry.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const content = blobs.get(entry.oid);
    if (entry.mode === "120000") {
      fs.symlinkSync(content.toString("utf8"), dest);
    } else {
      fs.writeFileSync(dest, content);
      if (entry.mode === "100755") fs.chmodSync(dest, 0o755);
    }
    written += 1;
  }
  return written;
}

function writeWorktreeEntries(repoRoot, target, entries, log) {
  let written = 0;
  for (const entry of entries) {
    const src = path.join(repoRoot, ...entry.path.split("/"));
    let stat;
    try {
      stat = fs.lstatSync(src);
    } catch {
      continue; // tracked but deleted (or moved) on disk
    }
    const dest = destinationFor(target, entry.path);
    if (stat.isSymbolicLink()) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.symlinkSync(fs.readlinkSync(src), dest);
    } else if (stat.isFile()) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      if (stat.mode & 0o111) fs.chmodSync(dest, 0o755);
    } else {
      log(`export-public: skipping ${entry.path} (not a regular file)`);
      continue;
    }
    written += 1;
  }
  return written;
}

function firstExisting(...candidates) {
  return candidates.find((c) => c && fs.existsSync(c)) ?? null;
}

/**
 * Export the public tree. Returns { target, exported, excluded, hits, commit }.
 * Throws ExportError on refusals and when the leak gate finds hits (exitCode 1).
 */
export function exportPublic(options) {
  const log = options.log ?? console.log;
  const repoRoot = git(path.resolve(options.repo ?? SCRIPT_REPO), ["rev-parse", "--show-toplevel"]).trim();
  if (!options.target) throw new ExportError("missing <target-dir>");
  if (options.ref && options.worktree) throw new ExportError("use either --ref or --worktree, not both");

  const publicignoreFile = options.publicignoreFile ?? path.join(repoRoot, ".publicignore");
  if (!fs.existsSync(publicignoreFile)) throw new ExportError(`refusing: no exclusion list at ${publicignoreFile} (pass --publicignore <file>)`);
  const ignore = loadIgnoreFile(publicignoreFile);
  const allowlistFile = options.allowlistFile ?? firstExisting(path.join(repoRoot, "scripts", "public-allowlist.txt"), DEFAULT_ALLOWLIST);
  const identifiersFile = options.identifiersFile ?? firstExisting(path.join(repoRoot, "docs", "private", "leak-identifiers.txt"));
  const identifierHashesFile =
    options.identifierHashesFile ?? firstExisting(path.join(repoRoot, "scripts", "public-identifier-hashes.txt"), DEFAULT_IDENTIFIER_HASHES);

  const target = validateTarget(repoRoot, options.target);
  const ref = options.ref ?? "HEAD";
  const entries = options.worktree ? listWorktreeEntries(repoRoot) : listRefEntries(repoRoot, ref);
  const included = [];
  const excluded = [];
  for (const entry of entries) (ignore.isExcluded(entry.path) ? excluded : included).push(entry);
  const source = options.worktree ? "working tree" : `${ref} (${git(repoRoot, ["rev-parse", "--short", `${ref}^{commit}`]).trim()})`;

  if (options.dryRun) {
    log(`export-public: dry run from ${source}: ${included.length} file(s) would be exported, ${excluded.length} excluded by .publicignore`);
    for (const e of excluded) log(`  excluded  ${e.path}`);
    return { target, exported: included.length, excluded: excluded.length, hits: [], commit: null };
  }

  prepareTarget(target, options.force, log);
  const exported = options.worktree ? writeWorktreeEntries(repoRoot, target, included, log) : writeRefEntries(repoRoot, target, included, log);
  log(`export-public: wrote ${exported} file(s) from ${source} to ${target}; ${excluded.length} excluded by .publicignore`);

  if (!identifiersFile && !identifierHashesFile) {
    log("export-public: warning: no owner identifier list found; the gate checks secret patterns only");
  } else if (!identifiersFile) {
    log("export-public: warning: no plain-text identifier list found; the gate checks secret patterns and hashed identifiers only");
  }
  const gate = scanDirectory(target, { allowlistFile, identifiersFile, identifierHashesFile, publicignoreFile: null, allFiles: true });
  if (gate.hits.length > 0) {
    for (const hit of gate.hits) log(formatHit(hit));
    const files = new Set(gate.hits.map((h) => h.file)).size;
    const err = new ExportError(
      `leak gate failed: ${gate.hits.length} hit(s) in ${files} file(s). The export stays in ${target} for inspection; nothing was committed. Do not publish it.`,
      1,
    );
    err.hits = gate.hits;
    throw err;
  }
  log(
    `export-public: leak gate clean (${gate.scanned} file(s) scanned, ${gate.identifierPatterns} owner identifier pattern(s), ` +
      `${gate.identifierHashes} hashed identifier(s))`,
  );

  let commit = null;
  if (options.init) {
    const author = parseAuthor(options.author ?? DEFAULT_AUTHOR);
    const fresh = !fs.existsSync(path.join(target, ".git"));
    if (fresh) git(target, ["init", "-q", "-b", "main"]);
    git(target, ["add", "-A"]);
    const staged = spawnSync("git", ["-C", target, "diff", "--cached", "--quiet"]);
    if (staged.status === 0) {
      log("export-public: nothing to commit, the target already matches this export");
    } else {
      const message = options.message ?? (fresh ? "Initial public release" : "Update public snapshot");
      const env = {
        ...process.env,
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_COMMITTER_NAME: author.name,
        GIT_COMMITTER_EMAIL: author.email,
      };
      git(target, ["-c", `user.name=${author.name}`, "-c", `user.email=${author.email}`, "commit", "-q", "-m", message], { env });
      commit = git(target, ["rev-parse", "HEAD"]).trim();
      log(`export-public: committed ${commit.slice(0, 12)} as ${author.name} <${author.email}>`);
    }
    const remotes = git(target, ["remote"]).trim();
    if (remotes) log(`export-public: existing remotes left untouched: ${remotes.split(/\s+/).join(", ")}`);
    log("export-public: review the tree, then create and push the public repository yourself. This script never pushes.");
  }
  return { target, exported, excluded: excluded.length, hits: [], commit };
}

export function parseArgs(argv) {
  const opts = {};
  const rest = [...argv];
  while (rest.length) {
    const arg = rest.shift();
    const value = () => {
      const v = rest.shift();
      if (v === undefined || v.startsWith("--")) throw new ExportError(`${arg} needs a value`);
      return v;
    };
    if (arg === "--ref") opts.ref = value();
    else if (arg === "--worktree") opts.worktree = true;
    else if (arg === "--force") opts.force = true;
    else if (arg === "--init") opts.init = true;
    else if (arg === "--author") opts.author = value();
    else if (arg === "--message") opts.message = value();
    else if (arg === "--publicignore") opts.publicignoreFile = path.resolve(value());
    else if (arg === "--allowlist") opts.allowlistFile = path.resolve(value());
    else if (arg === "--identifiers") opts.identifiersFile = path.resolve(value());
    else if (arg === "--identifier-hashes") opts.identifierHashesFile = path.resolve(value());
    else if (arg === "--repo") opts.repo = path.resolve(value());
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg.startsWith("--")) throw new ExportError(`unknown option ${arg}`);
    else if (opts.target === undefined) opts.target = arg;
    else throw new ExportError(`unexpected argument ${arg}`);
  }
  if (opts.author !== undefined) parseAuthor(opts.author);
  return opts;
}

export function main(argv = process.argv.slice(2)) {
  try {
    const opts = parseArgs(argv);
    if (opts.help || opts.target === undefined) {
      console.log(
        'Usage: node scripts/export-public.mjs <target-dir> [--ref <rev> | --worktree] [--force] [--init] [--author "Name <email>"] [--message <text>] [--publicignore <file>] [--allowlist <file>] [--identifiers <file>] [--identifier-hashes <file>] [--repo <dir>] [--dry-run]',
      );
      return opts.help ? 0 : 2;
    }
    exportPublic(opts);
    return 0;
  } catch (err) {
    console.error(`export-public: ${err.message}`);
    return err instanceof ExportError ? err.exitCode : 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main();
}
