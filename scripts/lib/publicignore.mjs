// Minimal gitignore-style matcher for .publicignore (no dependencies).
//
// Supported syntax, with git's semantics:
//   - blank lines and lines starting with "#" are ignored ("\#" escapes a literal "#")
//   - "!pattern" re-includes a path ("\!" escapes a literal "!")
//   - a trailing "/" matches directories only
//   - a pattern with a "/" at the start or in the middle is anchored to the root;
//     otherwise it matches at any depth
//   - "*", "?", "[...]" and "**" (leading "**/", trailing "/**", inner "/**/")
// As in git, a file inside an excluded directory cannot be re-included by a later
// negation, so a broad "docs/private/" can never be undone by accident.

import { existsSync, readFileSync } from "node:fs";

/** Convert one glob body (no leading "!" or trailing "/") into a RegExp source. */
function globToRegExpSource(glob) {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const prevIsSlash = i === 0 || glob[i - 1] === "/";
        const next = glob[i + 2];
        if (prevIsSlash && next === "/") {
          // "**/" : zero or more directories
          out += "(?:.*/)?";
          i += 3;
          continue;
        }
        if (prevIsSlash && next === undefined) {
          // trailing "**" : everything below
          out += ".*";
          i += 2;
          continue;
        }
        // "**" elsewhere behaves like "*"
        out += "[^/]*";
        i += 2;
        continue;
      }
      out += "[^/]*";
      i += 1;
      continue;
    }
    if (c === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    if (c === "[") {
      const end = glob.indexOf("]", i + 2);
      if (end !== -1) {
        let body = glob.slice(i + 1, end);
        if (body.startsWith("!")) body = `^${body.slice(1)}`;
        out += `[${body.replace(/\\/g, "\\\\")}]`;
        i = end + 1;
        continue;
      }
    }
    if (c === "\\" && i + 1 < glob.length) {
      out += glob[i + 1].replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      i += 2;
      continue;
    }
    out += c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    i += 1;
  }
  return out;
}

/**
 * Parse .publicignore text into rules.
 * @param {string} text
 * @returns {Array<{ source: string, negate: boolean, dirOnly: boolean, regex: RegExp }>}
 */
export function parseIgnore(text) {
  const rules = [];
  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    let line = rawLine.replace(/(?<!\\)\s+$/, "");
    if (line === "" || line.startsWith("#")) continue;
    let negate = false;
    if (line.startsWith("!")) {
      negate = true;
      line = line.slice(1);
    } else if (line.startsWith("\\!") || line.startsWith("\\#")) {
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.replace(/\/+$/, "");
    }
    if (line === "") continue;
    const anchored = line.includes("/");
    const body = line.replace(/^\/+/, "");
    const src = globToRegExpSource(body);
    const regex = new RegExp(anchored ? `^${src}$` : `^(?:.*/)?${src}$`);
    rules.push({ source: rawLine.trim(), negate, dirOnly, regex });
  }
  return rules;
}

/**
 * Build a matcher. `isExcluded(relPath)` takes a POSIX path relative to the root.
 * @param {ReturnType<typeof parseIgnore>} rules
 */
export function createMatcher(rules) {
  const dirCache = new Map();
  const evaluate = (p, isDir) => {
    let excluded = false;
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) continue;
      if (rule.regex.test(p)) excluded = !rule.negate;
    }
    return excluded;
  };
  const dirExcluded = (dir) => {
    if (dirCache.has(dir)) return dirCache.get(dir);
    const slash = dir.lastIndexOf("/");
    const parentExcluded = slash > 0 ? dirExcluded(dir.slice(0, slash)) : false;
    const result = parentExcluded || evaluate(dir, true);
    dirCache.set(dir, result);
    return result;
  };
  return {
    rules,
    isExcluded(relPath) {
      const p = relPath.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
      if (p === "") return false;
      const slash = p.lastIndexOf("/");
      if (slash > 0 && dirExcluded(p.slice(0, slash))) return true;
      return evaluate(p, false);
    },
  };
}

/** Load a .publicignore file; a missing file yields a matcher that excludes nothing. */
export function loadIgnoreFile(file) {
  if (!file || !existsSync(file)) return createMatcher([]);
  return createMatcher(parseIgnore(readFileSync(file, "utf8")));
}
