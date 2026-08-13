import Anthropic from '@anthropic-ai/sdk'
import { createServerClient } from '@/lib/supabase/server'
import { isAllowedEmail } from '@/lib/auth'
import { COOKS_BUCKET } from '@/lib/queue'

// Enrichment is fire-and-forget from the client; the sweep fits comfortably
// inside the 60s function budget (2 cooks max).
export const maxDuration = 60

type CookRow = {
  id: string
  note_raw: string
  photo: { storage_path: string }[] | null
}

type Extraction = {
  dish_name: string
  cuisine: string
  sub_region: string
  ingredients: { name: string; amount: string }[]
  techniques: string[]
  confidence: { dish_name: 'high' | 'medium' | 'low'; cuisine: 'high' | 'medium' | 'low' }
}

const ENRICH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dish_name', 'cuisine', 'sub_region', 'ingredients', 'techniques', 'confidence'],
  properties: {
    dish_name: { type: 'string' },
    cuisine: { type: 'string' },
    sub_region: { type: 'string' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'amount'],
        properties: {
          name: { type: 'string' },
          amount: { type: 'string' },
        },
      },
    },
    techniques: { type: 'array', items: { type: 'string' } },
    confidence: {
      type: 'object',
      additionalProperties: false,
      required: ['dish_name', 'cuisine'],
      properties: {
        dish_name: { type: 'string', enum: ['high', 'medium', 'low'] },
        cuisine: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
    },
  },
}

const ENRICH_PROMPT = (note: string) =>
  `You are classifying a home cook's meal. From the note (and photo), extract the dish. Be specific and honest: 'Singapore black pepper prawns' not 'seafood'. Use the cook's own vocabulary. Unknown values: empty string / empty array, never invented. Note: ${note}`

const DEEPSEEK_SYSTEM =
  "You are classifying a home cook's meal. From the note, extract the dish. Be specific and honest: 'Singapore black pepper prawns' not 'seafood'. Use the cook's own vocabulary. Unknown values: empty string / empty array, never invented. Respond in JSON."

const anthropic = new Anthropic()

async function photoToBase64(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  path: string,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(COOKS_BUCKET).download(path)
  if (error || !data) return null // download error -> treat as no photo (DeepSeek path)
  return Buffer.from(await data.arrayBuffer()).toString('base64')
}

async function claudeExtract(photoB64: string, note: string): Promise<Extraction> {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 4096,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: ENRICH_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: photoB64 } },
          { type: 'text', text: ENRICH_PROMPT(note) },
        ],
      },
    ],
  })
  if (msg.stop_reason === 'refusal') throw new Error('claude refusal')
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  return JSON.parse(text)
}

async function deepseekExtract(note: string): Promise<Extraction> {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: DEEPSEEK_SYSTEM },
        { role: 'user', content: note },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 2000,
    }),
  })
  if (!res.ok) throw new Error(`deepseek ${res.status}`)
  const body = await res.json()
  return JSON.parse(body.choices[0].message.content)
}

// Returns the extracted dish name on success, null on any failure (failure is
// recorded as enrichment_status='failed' so the sweep won't hot-loop).
async function enrichCook(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  cook: CookRow,
): Promise<string | null> {
  try {
    const photoPath = cook.photo?.[0]?.storage_path
    const photoB64 = photoPath ? await photoToBase64(supabase, photoPath) : null
    // Raw model output goes into extraction as-is — never trimmed or reshaped.
    const extraction: Extraction = photoB64
      ? await claudeExtract(photoB64, cook.note_raw)
      : await deepseekExtract(cook.note_raw)

    const dishName = String(extraction.dish_name ?? '').trim()
    let dishId: string | null = null
    if (dishName) {
      const { data: existing } = await supabase
        .from('dish')
        .select('id')
        .ilike('canonical_name', dishName)
        .limit(1)
      dishId = existing?.[0]?.id ?? null
      if (!dishId) {
        const { data: inserted } = await supabase
          .from('dish')
          .insert({ canonical_name: dishName, cuisine: extraction.cuisine, sub_region: extraction.sub_region })
          .select('id')
          .single()
        dishId = inserted?.id ?? null
      }
    }

    const { error } = await supabase
      .from('cook')
      .update({ extraction, enrichment_status: 'done', dish_id: dishId })
      .eq('id', cook.id)
    if (error) throw error
    return dishName
  } catch (err) {
    console.warn(`enrich ${cook.id} failed`, err)
    try {
      await supabase
        .from('cook')
        .update({ enrichment_status: 'failed' })
        .eq('id', cook.id)
    } catch {
      // best-effort: marking failed is the anti-hot-loop, but the sweep
      // re-picks 'queued' rows anyway
    }
    return null
  }
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !isAllowedEmail(user.email)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { cookId } = await req.json().catch(() => ({}))
  const select = 'id, note_raw, photo(storage_path)'

  if (typeof cookId === 'string') {
    const { data: cook } = await supabase
      .from('cook')
      .select(select)
      .eq('id', cookId)
      .maybeSingle()
    if (!cook) return Response.json({ error: 'cook not found' }, { status: 404 })
    const dishName = await enrichCook(supabase, cook as CookRow)
    return Response.json({ dish_name: dishName })
  }

  // Sweep: oldest queued cooks first, max 2 per run.
  const { data: cooks } = await supabase
    .from('cook')
    .select(select)
    .eq('enrichment_status', 'queued')
    .order('cooked_at', { ascending: true })
    .limit(2)
  if (cooks == null) return Response.json({ error: 'sweep failed' }, { status: 500 })
  let processed = 0
  for (const cook of cooks as CookRow[]) {
    await enrichCook(supabase, cook)
    processed++
  }
  return Response.json({ processed })
}
