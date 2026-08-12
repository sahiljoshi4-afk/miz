import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { ensureProfile, isAllowedEmail } from '@/lib/auth'

export default async function Home() {
  const supabase = await createServerClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user || !isAllowedEmail(data.user.email)) redirect('/login')
  await ensureProfile(supabase)
  // Task 5 fills in the feed here.
  return <main className="min-h-dvh bg-paper" />
}
