const PROBE_ORIGIN = "http://next.invalid";

/**
 * Only allow same-origin absolute paths as post-login redirect targets.
 *
 * Rejected: anything not starting with a single "/", protocol-relative "//",
 * backslashes (browsers treat "\" like "/"), and ASCII control characters,
 * because URL parsers strip tab/CR/LF so "/\t/evil.com" would become
 * "//evil.com". The value is then resolved against a probe origin and must
 * stay on it. Returns the normalised path + query + hash.
 */
export function safeNext(value: string | null | undefined, fallback = "/create/image"): string {
  if (!value) return fallback;
  if (/[\u0000-\u001F\u007F\\]/.test(value)) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE_ORIGIN) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (!path.startsWith("/") || path.startsWith("//")) return fallback;
  if (isAuthPath(url.pathname)) return fallback;
  return path;
}

function isAuthPath(pathname: string): boolean {
  return ["/login", "/auth", "/setup"].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
