// Self-test for the public export. Run with: node --test scripts/*.test.mjs
// Builds throwaway git repositories under the OS temp directory; nothing touches this repo.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { buildIdentifierHashes } from "./check-public.mjs";
import { ExportError, exportPublic, parseArgs, parseAuthor } from "./export-public.mjs";

const tmpDirs = [];
const makeTmp = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const commitAll = (repo, message) => {
  git(repo, "add", "-A");
  git(repo, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "-m", message);
};
const write = (root, rel, content) => {
  const file = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const listFiles = (root) => {
  const out = [];
  const visit = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) visit(path.join(dir, e.name), childRel);
      else out.push(childRel);
    }
  };
  visit(root, "");
  return out.sort();
};
const silent = () => {};

/** A small source repo with a private folder, an identifier list and a public tree. */
function makeSourceRepo() {
  const repo = makeTmp("export-public-src-");
  git(repo, "init", "-q", "-b", "main");
  write(repo, "README.md", "# Demo\n");
  write(repo, "src/app.js", "console.log('hello');\n");
  write(repo, ".publicignore", "docs/private/\n*.local.json\n");
  write(repo, "docs/guide.md", "Public guide.\n");
  write(repo, "docs/private/notes.md", "Internal plan for Acme Corp.\n");
  write(repo, "docs/private/leak-identifiers.txt", "Acme Corp\n");
  write(repo, "scripts/public-allowlist.txt", "");
  write(repo, "tool.local.json", '{"owner":"Acme Corp"}\n');
  commitAll(repo, "init");
  return repo;
}

describe("exportPublic", () => {
  it("exports HEAD without the excluded paths and passes the gate", () => {
    const repo = makeSourceRepo();
    const target = path.join(makeTmp("export-public-out-"), "public");
    const result = exportPublic({ repo, target, log: silent });
    assert.deepEqual(listFiles(target), [".publicignore", "README.md", "docs/guide.md", "scripts/public-allowlist.txt", "src/app.js"]);
    assert.equal(result.excluded, 3);
    assert.equal(fs.readFileSync(path.join(target, "src/app.js"), "utf8"), "console.log('hello');\n");
    assert.equal(fs.existsSync(path.join(target, ".git")), false);
  });

  it("refuses a non-empty target unless --force, and --force replaces an earlier export", () => {
    const repo = makeSourceRepo();
    const target = path.join(makeTmp("export-public-out-"), "public");
    exportPublic({ repo, target, log: silent });
    write(target, "stale.txt", "old\n");
    assert.throws(() => exportPublic({ repo, target, log: silent }), (err) => err instanceof ExportError && err.exitCode === 2 && /not empty/.test(err.message));
    exportPublic({ repo, target, force: true, log: silent });
    assert.equal(fs.existsSync(path.join(target, "stale.txt")), false);
    assert.equal(fs.existsSync(path.join(target, "README.md")), true);
  });

  it("--force never clears a folder that is not an earlier export", () => {
    const repo = makeSourceRepo();
    const target = makeTmp("export-public-out-");
    write(target, "important.txt", "keep me\n");
    assert.throws(() => exportPublic({ repo, target, force: true, log: silent }), /not an earlier export/);
    assert.equal(fs.readFileSync(path.join(target, "important.txt"), "utf8"), "keep me\n");
  });

  it("refuses targets inside the repository, containing it, or sharing its git directory", () => {
    const repo = makeSourceRepo();
    assert.throws(() => exportPublic({ repo, target: path.join(repo, "out"), log: silent }), /inside the source repository/);
    assert.throws(() => exportPublic({ repo, target: path.dirname(repo), force: true, log: silent }), /contains the source repository/);
    const worktree = path.join(makeTmp("export-public-wt-"), "wt");
    git(repo, "worktree", "add", "-q", "--detach", worktree);
    assert.throws(() => exportPublic({ repo, target: worktree, force: true, log: silent }), /worktree of the source repository/);
  });

  it("aborts with exit code 1 when a public file leaks a secret or identifier", () => {
    const repo = makeSourceRepo();
    write(repo, "src/config.js", `export const owner = "acme corp";\nexport const key = "${"gh" + "p_" + "aB3".repeat(12)}";\n`);
    commitAll(repo, "leak");
    const target = path.join(makeTmp("export-public-out-"), "public");
    assert.throws(
      () => exportPublic({ repo, target, init: true, log: silent }),
      (err) => {
        assert.ok(err instanceof ExportError);
        assert.equal(err.exitCode, 1);
        assert.deepEqual(err.hits.map((h) => `${h.file}:${h.line}|${h.pattern}`), ["src/config.js:1|owner-identifier#1", "src/config.js:2|github-token"]);
        return true;
      },
    );
    assert.equal(fs.existsSync(path.join(target, ".git")), false, "no repository is created when the gate fails");
  });

  it("uses the hashed identifiers when the plain-text list is not in the repository", () => {
    const repo = makeSourceRepo();
    fs.rmSync(path.join(repo, "docs", "private"), { recursive: true });
    write(repo, "scripts/public-identifier-hashes.txt", buildIdentifierHashes("Acme Corp\n").text);
    write(repo, "src/about.js", 'export const owner = "ACME-corp";\n');
    commitAll(repo, "public-style repo");
    const target = path.join(makeTmp("export-public-out-"), "public");
    assert.throws(
      () => exportPublic({ repo, target, log: silent }),
      (err) => {
        assert.equal(err.exitCode, 1);
        assert.deepEqual(
          err.hits.map((h) => h.file),
          ["src/about.js"],
        );
        assert.match(err.hits[0].pattern, /^owner-identifier-hash#\d+$/);
        return true;
      },
    );
  });

  it("--init commits once with the given author and committer and never adds a remote", () => {
    const repo = makeSourceRepo();
    const target = path.join(makeTmp("export-public-out-"), "public");
    const first = exportPublic({ repo, target, init: true, author: "Jane Doe <jane@example.com>", log: silent });
    assert.match(first.commit, /^[0-9a-f]{40}$/);
    assert.equal(git(target, "rev-parse", "--abbrev-ref", "HEAD"), "main");
    assert.equal(git(target, "log", "--format=%an <%ae>|%cn <%ce>|%s"), "Jane Doe <jane@example.com>|Jane Doe <jane@example.com>|Initial public release");
    assert.equal(git(target, "remote"), "");
    assert.equal(git(target, "status", "--porcelain"), "");

    const again = exportPublic({ repo, target, init: true, force: true, author: "Jane Doe <jane@example.com>", log: silent });
    assert.equal(again.commit, null, "an unchanged export creates no commit");

    write(repo, "src/app.js", "console.log('v2');\n");
    commitAll(repo, "v2");
    const update = exportPublic({ repo, target, init: true, force: true, author: "Jane Doe <jane@example.com>", log: silent });
    assert.ok(update.commit);
    assert.equal(git(target, "rev-list", "--count", "HEAD"), "2");
    assert.equal(git(target, "log", "-1", "--format=%s"), "Update public snapshot");
  });

  it("--worktree exports uncommitted and untracked files and skips files deleted on disk", () => {
    const repo = makeSourceRepo();
    write(repo, "src/new.js", "export const fresh = true;\n");
    fs.rmSync(path.join(repo, "docs", "guide.md"));
    const target = path.join(makeTmp("export-public-out-"), "public");
    exportPublic({ repo, target, worktree: true, log: silent });
    const files = listFiles(target);
    assert.ok(files.includes("src/new.js"));
    assert.ok(!files.includes("docs/guide.md"));
    assert.ok(!files.some((f) => f.startsWith("docs/private/")));
  });

  it("--ref exports an older commit", () => {
    const repo = makeSourceRepo();
    const firstSha = git(repo, "rev-parse", "HEAD");
    write(repo, "src/later.js", "export {};\n");
    commitAll(repo, "later");
    const target = path.join(makeTmp("export-public-out-"), "public");
    exportPublic({ repo, target, ref: firstSha, log: silent });
    assert.ok(!listFiles(target).includes("src/later.js"));
    assert.throws(() => exportPublic({ repo, target: path.join(target, "x"), ref: "no-such-ref", log: silent }), /unknown ref/);
  });

  it("--dry-run writes nothing", () => {
    const repo = makeSourceRepo();
    const target = path.join(makeTmp("export-public-out-"), "public");
    const lines = [];
    const result = exportPublic({ repo, target, dryRun: true, log: (l) => lines.push(l) });
    assert.equal(fs.existsSync(target), false);
    assert.equal(result.exported, 5);
    assert.ok(lines.some((l) => l.includes("excluded  docs/private/notes.md")));
  });

  it("refuses to run without an exclusion list", () => {
    const repo = makeSourceRepo();
    fs.rmSync(path.join(repo, ".publicignore"));
    commitAll(repo, "drop publicignore");
    const target = path.join(makeTmp("export-public-out-"), "public");
    assert.throws(() => exportPublic({ repo, target, log: silent }), /no exclusion list/);
  });
});

describe("argument parsing", () => {
  it("parses authors and rejects malformed ones", () => {
    assert.deepEqual(parseAuthor("Reflow Automations <noreply@users.noreply.github.com>"), {
      name: "Reflow Automations",
      email: "noreply@users.noreply.github.com",
    });
    assert.throws(() => parseAuthor("no email here"), ExportError);
    assert.throws(() => parseArgs(["out", "--author", "bad"]), ExportError);
  });

  it("parses flags and rejects unknown ones", () => {
    const opts = parseArgs(["out", "--worktree", "--force", "--init", "--message", "Release 0.1.0"]);
    assert.equal(opts.target, "out");
    assert.equal(opts.worktree, true);
    assert.equal(opts.force, true);
    assert.equal(opts.init, true);
    assert.equal(opts.message, "Release 0.1.0");
    assert.throws(() => parseArgs(["out", "--push"]), /unknown option/);
    assert.throws(() => parseArgs(["out", "other"]), /unexpected argument/);
  });
});
