import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_FILE = /\.(.*)$/;

export function middleware(request: NextRequest) {
  const isLandingOnlyModeEnabled =
    process.env.NEXT_PUBLIC_LANDING_ONLY_MODE === "true";

  const { pathname } = request.nextUrl;

  if (!isLandingOnlyModeEnabled) {
    // Single-user mode: no sign-in or sign-up. Pages without a session cookie
    // go through /api/local-session, which signs in the built-in local user.
    if (pathname === "/sign-in" || pathname === "/sign-up") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    const isPage =
      !pathname.startsWith("/api") &&
      !pathname.startsWith("/_next") &&
      !pathname.startsWith("/ingest/") &&
      !PUBLIC_FILE.test(pathname);
    const hasSession =
      request.cookies.has("better-auth.session_token") ||
      request.cookies.has("__Secure-better-auth.session_token");
    if (isPage && !hasSession && request.method === "GET") {
      const url = new URL("/api/local-session", request.url);
      url.searchParams.set("next", pathname + request.nextUrl.search);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (
    pathname === "/" ||
    pathname === "/status" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/billing/webhook") ||
    pathname.startsWith("/ingest/") ||
    // Opt-outs (including mailbox one-click POSTs) must work in every mode.
    pathname === "/email/product-updates/unsubscribe" ||
    PUBLIC_FILE.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api")) {
    return NextResponse.json(
      { error: "SupoClip is in landing-page-only mode." },
      { status: 503 }
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: "/:path*",
};
