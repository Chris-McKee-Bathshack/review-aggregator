import { NextRequest, NextResponse } from "next/server";

// Gate 1: any hosted page a person visits needs username+password middleware auth.
// The cron route is excluded here deliberately — it's headless and guards itself
// with its own CRON_SECRET bearer check in route.ts, which Vercel's cron invoker can present;
// it can't present a browser Basic Auth prompt.
export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;

  if (!user || !pass) {
    // Fail closed: if the credentials aren't configured, block rather than serve unprotected.
    return new NextResponse("Auth not configured", { status: 500 });
  }

  const header = req.headers.get("authorization");
  if (header) {
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      const [suppliedUser, suppliedPass] = Buffer.from(encoded, "base64").toString().split(":");
      if (suppliedUser === user && suppliedPass === pass) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Review Aggregator"' },
  });
}

export const config = {
  matcher: ["/((?!api/cron).*)"],
};
