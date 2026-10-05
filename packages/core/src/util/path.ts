/**
 * Minimal path language used by declarative output mappings.
 *
 * Grammar: segments separated by '.', where a segment may end with '[]' to
 * iterate over an array. Examples:
 *   'images[].url'        -> every image url in { images: [{ url }] }
 *   'video.url'           -> { video: { url } }
 *   'data.resultUrls[]'   -> every string in { data: { resultUrls: [] } }
 *
 * `getPath` always returns a flat array of matches (possibly empty) so callers
 * never need to special-case single vs. multiple results.
 */
export function getPath(input: unknown, path: string): unknown[] {
  if (path === "" || path === "$") return input === undefined ? [] : [input];
  const segments = path.split(".");
  let current: unknown[] = [input];
  for (const rawSegment of segments) {
    const iterate = rawSegment.endsWith("[]");
    const key = iterate ? rawSegment.slice(0, -2) : rawSegment;
    const next: unknown[] = [];
    for (const item of current) {
      let value: unknown = item;
      if (key !== "") {
        if (value === null || typeof value !== "object") continue;
        value = (value as Record<string, unknown>)[key];
      }
      if (value === undefined || value === null) continue;
      if (iterate) {
        if (Array.isArray(value)) next.push(...value);
      } else {
        next.push(value);
      }
    }
    current = next;
    if (current.length === 0) break;
  }
  return current;
}

/** First match of `getPath`, or undefined. */
export function getFirst<T = unknown>(input: unknown, path: string): T | undefined {
  return getPath(input, path)[0] as T | undefined;
}

/**
 * Set a value on a nested object using a dot path, creating intermediate
 * objects. A trailing '[]' appends to an array instead of overwriting.
 */
export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < segments.length; i++) {
    const raw = segments[i] ?? "";
    const isLast = i === segments.length - 1;
    const append = raw.endsWith("[]");
    const key = append ? raw.slice(0, -2) : raw;
    if (isLast) {
      if (append) {
        const existing = cursor[key];
        const arr = Array.isArray(existing) ? existing : [];
        if (Array.isArray(value)) arr.push(...value);
        else arr.push(value);
        cursor[key] = arr;
      } else {
        cursor[key] = value;
      }
      return;
    }
    const existing = cursor[key];
    if (existing === null || typeof existing !== "object" || Array.isArray(existing)) {
      const created: Record<string, unknown> = {};
      cursor[key] = created;
      cursor = created;
    } else {
      cursor = existing as Record<string, unknown>;
    }
  }
}
