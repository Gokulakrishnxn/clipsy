import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";

// Single-user mode: there is no sign-in or sign-up. This route signs in (and,
// the first time, creates) a built-in local account and sets its session cookie.
const LOCAL_EMAIL = "local@supoclip.local";
const LOCAL_NAME = "Local User";

function localPassword() {
  const secret = process.env.BETTER_AUTH_SECRET ?? "supoclip";
  return createHash("sha256").update(`local-user:${secret}`).digest("hex");
}

function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const body = { email: LOCAL_EMAIL, password: localPassword() };
  const requestHeaders = await headers();

  try {
    await auth.api.signInEmail({ body, headers: requestHeaders });
  } catch {
    await auth.api.signUpEmail({
      body: { ...body, name: LOCAL_NAME },
      headers: requestHeaders,
    });
  }

  return NextResponse.redirect(new URL(next, request.nextUrl.origin));
}
