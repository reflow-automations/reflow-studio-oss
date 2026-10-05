import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { checkOwner } from "@/lib/auth/owner";
import { classifyPath } from "@/lib/auth/public-paths";
import { supabasePublicConfig } from "@/lib/supabase/keys";

/**
 * Refreshes the Supabase session cookie on navigation and gates the app UI
 * behind an allowed owner login. API routes are not matched here; they
 * authenticate themselves (session or bearer API key).
 *
 * - Open paths (/s/<token>, /gallery, metadata files, demo media) skip Supabase entirely.
 * - Without Supabase configuration every other page goes to /setup (fail closed).
 * - Signed-out visitors go to /login; signed-in accounts outside OWNER_EMAILS
 *   go to /login?denied=...; /login and /setup stay reachable for both.
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const access = classifyPath(path);
  if (access === "open") return NextResponse.next();

  const config = supabasePublicConfig();
  if (!config) {
    if (path === "/setup" || path.startsWith("/setup/")) return NextResponse.next();
    const setup = new URL("/setup", request.url);
    setup.searchParams.set("reason", "supabase_not_configured");
    return NextResponse.redirect(setup);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const redirectWithCookies = (target: URL) => {
    const redirect = NextResponse.redirect(target);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };
  if (!data?.claims) {
    if (access === "auth") return response;
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${path}${request.nextUrl.search}`);
    return redirectWithCookies(login);
  }
  const owner = checkOwner(typeof data.claims.email === "string" ? data.claims.email : null);
  if (!owner.allowed) {
    // Signed in but not an owner: keep them on the public auth pages (login offers sign-out).
    if (access === "auth") return response;
    const login = new URL("/login", request.url);
    login.searchParams.set("denied", owner.reason);
    return redirectWithCookies(login);
  }
  if (path === "/login") return redirectWithCookies(new URL("/", request.url));
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|\\.well-known|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|mp4|webm|txt|xml|webmanifest)$).*)"],
};
