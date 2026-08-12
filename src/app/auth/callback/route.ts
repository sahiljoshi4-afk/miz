import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { isAllowedEmail } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  if (code) {
    const supabase = await createServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const { data } = await supabase.auth.getUser()
      if (isAllowedEmail(data.user?.email)) {
        return NextResponse.redirect(`${origin}/`)
      }
      await supabase.auth.signOut()
      return NextResponse.redirect(`${origin}/login?reason=not-invited`)
    }
  }
  return NextResponse.redirect(`${origin}/login?reason=error`)
}
