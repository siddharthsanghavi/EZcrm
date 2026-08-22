import { NextResponse, type NextRequest } from 'next/server';
import { serverClient } from '@/lib/supabase';
import { recordLogin } from '@/lib/login-log';

export async function POST(request: NextRequest) {
  const supabase = await serverClient();

  // Before signOut, while auth.uid() still resolves to who is leaving.
  await recordLogin('signed_out');

  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
