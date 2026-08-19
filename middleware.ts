import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC = ['/login', '/auth', '/no-access'];

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without credentials there is no way to check who is signed in, so we cannot
  // safely let anything through. Say so plainly rather than throwing — an
  // unhandled throw here surfaces as MIDDLEWARE_INVOCATION_FAILED on every
  // route, which tells you nothing about the actual cause.
  //
  // NEXT_PUBLIC_* values are inlined at build time, so adding them in the Vercel
  // dashboard is not enough on its own: the project must be redeployed after.
  if (!url || !key) {
    const missing = [
      !url && 'NEXT_PUBLIC_SUPABASE_URL',
      !key && 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ].filter(Boolean) as string[];

    const body =
      `EZcrm is not configured: ${missing.join(' and ')} ` +
      `${missing.length > 1 ? 'are' : 'is'} missing.\n\n` +
      `Set them in your hosting environment, then REDEPLOY — these values are ` +
      `baked in at build time, so saving them alone will not fix this.\n`;

    return new NextResponse(body, {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() revalidates the token with Supabase on every request. Don't swap
  // this for getSession(), which trusts the cookie without checking it.
  //
  // A network failure here must not throw: an exception in middleware fails
  // open-ish (an opaque 500 everywhere) instead of sending people to sign in.
  let user = null;
  try {
    ({
      data: { user },
    } = await supabase.auth.getUser());
  } catch {
    user = null;
  }

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/login';
    redirect.search = '';
    redirect.searchParams.set('next', pathname);
    return NextResponse.redirect(redirect);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
};
