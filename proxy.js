import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function proxy(request) {
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isDashboardRoute = request.nextUrl.pathname.startsWith("/dashboard");
const isMerchantLoginRoute = request.nextUrl.pathname.startsWith("/login");
const isBuyerLoginRoute = request.nextUrl.pathname.startsWith("/buyer/login");

  if (isDashboardRoute && !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isMerchantLoginRoute && user) {
  return NextResponse.redirect(new URL("/dashboard", request.url));
}

if (isBuyerLoginRoute && user) {
  return NextResponse.redirect(new URL("/buyer", request.url));
}

  return response;
}

export const config = {
  matcher: [
  "/dashboard/:path*",
  "/login",
  "/buyer/login",
],
};