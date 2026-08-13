import { createServerClient } from '@/lib/supabase/server'
import { isAllowedEmail } from '@/lib/auth'

export const maxDuration = 30

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !isAllowedEmail(user.email)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))

  // Grantee accepts an incoming share.
  if (typeof body.acceptGrantorId === 'string') {
    const { error } = await supabase
      .from('view_share')
      .update({ status: 'accepted' })
      .eq('grantor_id', body.acceptGrantorId)
      .eq('grantee_id', user.id)
    if (error) return Response.json({ error: 'accept_failed' }, { status: 400 })
    return Response.json({ ok: true })
  }

  // Share by email.
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email) return Response.json({ error: 'bad_request' }, { status: 400 })
  const { data: target } = await supabase.rpc('lookup_profile', { p_email: email })
  if (!target?.id) return Response.json({ error: 'not_joined' }, { status: 409 })
  if (target.id === user.id) return Response.json({ error: 'self' }, { status: 400 })

  const { error } = await supabase.from('view_share').insert({
    grantor_id: user.id,
    grantee_id: target.id,
    status: 'pending',
  })
  if (error?.code === '23505') return Response.json({ ok: true, duplicate: true })
  if (error) return Response.json({ error: 'insert_failed' }, { status: 400 })
  return Response.json({ ok: true, display_name: target.display_name })
}

export async function DELETE(req: Request) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !isAllowedEmail(user.email)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { otherId } = await req.json().catch(() => ({}))
  if (typeof otherId !== 'string' || !otherId) {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  // Grantee side first (ignore), then grantor side (revoke).
  const { data: deleted } = await supabase
    .from('view_share')
    .delete()
    .eq('grantor_id', otherId)
    .eq('grantee_id', user.id)
    .select()
  if (!deleted || deleted.length === 0) {
    await supabase
      .from('view_share')
      .delete()
      .eq('grantor_id', user.id)
      .eq('grantee_id', otherId)
  }
  return Response.json({ ok: true })
}
