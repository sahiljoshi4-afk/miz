# Mise — Product Spec

*Working name. A cooking log that becomes a personal archive.*

**Status:** draft for review
**Date:** August 2026

---

## 1. What this is

A personal-first, install-to-home-screen cooking log that turns "I cooked something" into a structured, searchable, permanent record — in under twenty seconds, without breaking the flow of cooking. Each person (initially Sahil, Pierce, Vishal) owns their own private log. Two sharing overlays sit on top: you can let someone *view* your log, and when you cook together you can log it as a joint entry that lands in both logs. Personal by default; shared only where you choose.

**North star:** in three years, this holds a thousand cooks annotated in my own voice, and it can answer questions no cookbook can — what I actually make, how my versions have evolved, and what I should cook tonight.

**The asset is not the photos.** It's a longitudinal, structured record of my cooking, annotated in my own words. Every valuable feature in this document falls out of that one thing. Which means the only feature that genuinely cannot fail is capture.

---

## 2. Principles

These govern every decision below. When a feature conflicts with a principle, the principle wins.

1. **Capture is sacred.** If logging a dish takes longer than ~20 seconds, I stop using it within a fortnight and the whole thing is worthless. Every other feature is negotiable.
2. **Never block on AI.** The model is an enrichment layer, not a gate. A cook is saved the instant I tap save, with or without a network.
3. **Zero required fields.** A photo alone is a valid entry. A voice note alone is a valid entry.
4. **Wrong is fine, lost is not.** A mislabelled dish is a two-second fix later. A dropped capture is gone forever.
5. **The photos are the design.** Interface chrome is recessive. Nothing competes with the food.
6. **Correct once, learn forever.** Every correction I make becomes context for future extractions. The app should get measurably better at *my* food.
7. **Build for the archive, ship for today.** The schema anticipates the full shape. The UI ships in thin slices.

---

## 3. The capture flow

This is the heart of the product. Specified in more detail than anything else, deliberately.

### 3.1 The happy path

**Step 1 — Shoot** *(target: 0–8s)*
Tap the capture button. Native camera opens immediately via `<input type="file" accept="image/*" capture="environment" multiple>`. Take one to three shots. No custom camera UI — the system camera is faster, better, and already familiar.

**Step 2 — Say** *(target: 8–18s)*
The instant the camera returns, land on a single screen:
- Photo thumbnails across the top (from local blob URLs — no upload wait)
- One large text field below, already focused, keyboard up
- Tap the mic key on the iOS keyboard and talk

Placeholder copy teaches the ideal note without nagging: *"What is it, what's in it, how'd it go?"*

No dropdowns. No cuisine picker. No rating stars. No date field. Nothing to tap except the mic and save.

**Step 3 — Save** *(target: 18–20s)*
One button: **Save cook**. Tap it and you're back on the feed immediately, with the new card already at the top showing the photo. Phone goes in pocket. Total time from unlock to pocket: under twenty seconds.

**Step 4 — Enrich** *(background, invisible)*
Behind the scenes, in order:
1. Row already written to IndexedDB (happened before step 3 completed)
2. Photos compressed client-side, uploaded to Supabase Storage
3. Enrichment endpoint called with photos + note + personal context
4. Card fills in live via Supabase Realtime — dish name, cuisine, ingredients, techniques
5. If it matches an existing dish, it auto-links and the card notes it: *"4th time"*

**Step 5 — Review** *(optional, whenever)*
Nothing ever blocks. Entries the model was unsure about carry a small **Check this** marker. Tap to correct inline. Corrections are stored in a `correction` table and injected as few-shot examples into subsequent extractions.

### 3.2 Latency budget

| Moment | Target | Why it matters |
|---|---|---|
| Cold app open → camera ready | < 2.5s | Longer and I'll use the system camera instead and never log it |
| Photo taken → note screen with keyboard up | < 500ms | Any stall here breaks the "just talk" reflex |
| Save tap → back on feed | < 300ms | Must feel instant. Optimistic, always. |
| Enrichment complete | < 25s | Invisible; I've already put the phone down |

### 3.3 Non-negotiable rules

- No required fields, ever
- No blocking spinner between tapping save and returning to the feed
- No modal dialogs anywhere in the capture path
- Write to IndexedDB **before** anything touches the network
- Works fully offline; queue flushes on next app foreground
- Timestamp comes from photo EXIF, not upload time
- Whole flow reachable one-handed, buttons in the bottom third of the screen
- Greasy-hands tolerant: large tap targets, no precision gestures, no drag

### 3.4 Other capture modes

| Mode | Behaviour |
|---|---|
| **Voice only** | No photo. Straight to the note field. |
| **Text only** | Typed, no dictation. Same screen. |
| **Ate out** | Toggle on the capture screen. Adds a `venue` field, flags `eaten_out`, feeds the "reverse-engineer this" queue rather than the cooking stats. |
| **Add to existing cook** | Take a plated shot after logging the mise en place. Appends a photo to today's most recent cook with one tap. |
| **Backfill** | Multi-select from camera roll. Enriches serially in the background. Review as a swipeable stack — approve, correct, or skip. |

### 3.5 Backfill deserves its own note

I almost certainly have several years of food photos already sitting in my camera roll. Running those through the enrichment pipeline means launching with 300–500 dishes of history rather than an empty app.

This changes everything downstream: analytics are immediately interesting, semantic search has something to find, and dishes already have attempt histories on day one. **Do this in phase 2, not phase 5.**

Note: iOS Safari doesn't support Web Share Target, so photos can't be shared *into* the app from Photos. Backfill has to be an in-app multi-select picker. Not a problem, just a constraint.

---

## 4. Data model

### 4.0 People and sharing

The app is personal-first. Each person owns their own log; sharing is an overlay they opt into, not the default. Three concepts carry it:

- **Profile** — one per human, linked to their Supabase auth identity. Name, avatar, personal enrichment context. Every cook and dish has an `owner`.
- **View-share** — an asymmetric grant: "Vishal may view Sahil's log." One-directional and opt-in. Sahil sharing with Vishal does *not* let Sahil see Vishal's log; that's a separate grant the other way. Like following.
- **Co-cook** — shared authorship of a single entry. When two people cook together, the cook has multiple *participants*; it appears in each participant's feed, attributed to both. One meal, one record, two logs.

**Default privacy is total.** With no shares and no co-cooks, your log is yours alone. Nothing is visible to anyone else until you deliberately grant it.

**Visibility rule (enforced in the database via RLS, §4.4):** you can read a cook if you're one of its participants, *or* its owner has given you an accepted view-share. You can only write a cook if you're a participant on it. None of this is enforced in app code, so a frontend bug can't leak a log.

**Dish lineage is personal.** Each person's "Kimchi Jjigae" is their own dish with their own attempt history and trajectory — this is what keeps the dish page (§7) a personal lab notebook rather than a muddled group average. A co-cooked entry attaches to the owner's lineage and is visible to co-authors as "cooked with —"; see §15 for the one small nuance left open there.

**Joining** is invite-only — you invite someone by email, which sends a Supabase magic link; accepting creates their profile. No open sign-up, no discovery.

### 4.1 The one decision that matters

Separate **Dish** (the idea — "kimchi jjigae") from **Cook** (one attempt, on one date, with photos and notes). Cooks belong to a Dish.

Get this right on day one and iteration tracking, lineage, repertoire depth, and per-dish analytics all become trivial. Get it wrong and it's a flat photo feed forever, and retrofitting means reprocessing everything.

### 4.2 Raw plus normalised

Always store the model's raw JSON output on the cook (`extraction jsonb`) as the source of truth. Normalise into join tables **asynchronously**, as a second step.

This means v1 can query `jsonb` directly and ship fast, while phase 3 can add proper ingredient normalisation without a destructive migration or re-running enrichment. Raw data is never thrown away.

### 4.3 Tables

```sql
profile               -- one per human, linked to auth.users
  id (= auth uid), display_name, avatar_url,
  context jsonb,                 -- personal enrichment context (§5.2)
  created_at

view_share            -- "grantee may view grantor's whole log"
  grantor_id, grantee_id,
  status,                        -- pending | accepted | revoked
  created_at
  PRIMARY KEY (grantor_id, grantee_id)

dish
  id, owner_id,                  -- dishes are personal
  canonical_name, aliases text[], cuisine, sub_region,
  first_cooked_at, cook_count, avg_rating,
  embedding vector, created_at

cook
  id, owner_id,                  -- the log this cook lives in
  dish_id (nullable until matched), cooked_at,
  note_raw text,                 -- the voice transcript, verbatim
  extraction jsonb,              -- raw model output, source of truth
  rating smallint,               -- 1-5, optional, set later
  would_repeat boolean,
  effort_minutes int, servings int,
  occasion text,                 -- "supper club", "weeknight", "Jonty came over"
  eaten_out boolean, venue text,
  source text, source_ref text,  -- "own", "recipe", "restaurant" + link
  enrichment_status text,        -- queued | processing | done | failed | needs_review
  embedding vector, created_at

cook_participant      -- co-cooking; always includes the owner
  cook_id, profile_id,
  role,                          -- owner | co_author
  PRIMARY KEY (cook_id, profile_id)

photo
  id, cook_id, storage_path, width, height,
  phase text,                    -- mise | process | plated
  is_cover boolean, exif jsonb

ingredient            -- canonical, deduped, per owner
  id, owner_id, name, aliases text[], category

cook_ingredient       -- join
  cook_id, ingredient_id, amount_text, notes

technique             -- canonical, per owner
  id, owner_id, name, category

cook_technique        -- join
  cook_id, technique_id

correction            -- every edit, fed back as context
  id, cook_id, author_id, field, model_value, my_value, created_at
```

### 4.4 Security (RLS)

RLS on every table from the first migration. Two predicates cover almost everything:

- **`is_participant(cook)`** — the current user appears in `cook_participant` for this cook.
- **`can_view(owner_id)`** — the current user *is* the owner, or holds an accepted `view_share` from that owner.

Policies:

- `cook` — **read** when `is_participant` OR `can_view(owner_id)`; **write** when `is_participant` (co-authors and the owner can edit a shared entry; a mere viewer cannot).
- `dish`, `ingredient`, `technique` — **read** when `can_view(owner_id)`; **write** only by the owner.
- `photo`, `cook_ingredient`, `cook_technique` — no direct owner; the policy joins through the parent `cook` and reuses its rule.
- `profile` — readable by anyone you have a sharing relationship with (a `view_share` either direction, or co-participation on any cook); writable only by yourself.
- `view_share` — each side can see rows naming them; only the grantor creates or revokes.
- Storage objects inherit the owning cook's read rule.
- `owner_id` / `author_id` / the owner's `cook_participant` row default from `auth.uid()` server-side; the client never asserts identity.

Default state — no shares, no co-cooks — means a log is visible to exactly one person. Sharing only ever *adds* visibility, never assumes it.

---

## 5. Enrichment pipeline

### 5.1 The call

Server-side only — `/api/enrich`. The API key never touches the client.

- **Model:** `claude-sonnet-5` (vision + text, good balance for this). `claude-haiku-4-5-20251001` as a cheap tier for bulk backfill if cost becomes a factor.
- **Input:** 1–3 compressed images + the voice note text + a personal context block
- **Output:** strict JSON via structured outputs, every field carrying a confidence flag

### 5.2 The personal context block

This is the trick that makes the whole thing work. Every enrichment call is built from the **owner's** context:

- The owner's last ~50 dish names and cuisines (so it matches their existing dishes rather than duplicating — dish matching is personal, so it only ever matches against that person's own log)
- The owner's correction history (so it stops making *their* mistakes)
- The owner's known pantry staples, herb garden, common technique vocabulary

Without this, the model returns generic output — "curry, South Asian." With it: "Sri Lankan cashew curry, likely the same as the one from 12 March, coconut milk and pandan, second attempt." Vocabulary matches the person; dishes link to their own history.

For a co-cooked entry, enrich against the owner's context (the log it primarily lives in). A future refinement could blend both participants' vocabularies, but it isn't needed for v1.

### 5.3 Extracted fields

| Field | Notes |
|---|---|
| `dish_name` | Specific. "Kimchi jjigae", not "Korean stew" |
| `cuisine`, `sub_region` | Sub-region matters — Sichuan vs Cantonese is a real distinction |
| `ingredients[]` | Name + rough amount if stated in the note |
| `techniques[]` | Velveting, tempering, blooming spices, wok hei, lamination, fermentation — the practice map |
| `effort` | Active minutes, rough |
| `est_cost_per_portion` | Rough, in GBP |
| `nutrition_estimate` | Protein, carb quality, rough calories. Estimates, clearly labelled as such. |
| `seasonality` | What's in season in this |
| `matched_dish_id` | Link to existing dish, or null to create new |
| `confidence` | Per-field, drives the "Check this" marker |

### 5.4 Dish matching

Two-stage: fuzzy string match on `canonical_name` + `aliases`, then embedding similarity as a fallback. Above threshold, auto-link. Below, create new but flag for review.

Note: the Claude API has no embeddings endpoint. Use Voyage AI (Anthropic's recommended partner) or an equivalent, stored in pgvector.

---

## 6. Retrieval

### 6.1 Semantic search is the feature that makes it feel alive

Keyword filters break down fast — I won't remember whether I called it "peanut noodles" or "dan dan." Embedding the note and extraction into pgvector means I can ask:

> *"that spicy noodle thing with peanuts I made in spring"*

and actually get it. This is the difference between an archive I use and one I don't.

### 6.2 Everything else

- **Feed** — your own log, reverse chronological, large photos, minimal chrome. A co-cooked entry carries a small "with —" attribution; nothing else needs an author mark, because by default the feed is all yours.
- **Viewing a shared log** — a way to switch into someone who's shared with you (e.g. "Vishal's log"), read-only, same layout. Clearly framed as theirs, not yours.
- **Filters** — cuisine, ingredient, technique, rating, season, effort, eaten-out
- **Dish pages** — every attempt in sequence (see §7)
- **Calendar heatmap** — a year of cooking at a glance
- **On this day** — what I made a year ago today

---

## 7. Iteration tracking

**This is what makes it a lab notebook rather than a photo album, and it's the feature I think is most distinctly mine.**

I iterate. The no-knead bread went through rounds. Dishes get remade and refined. Nothing currently captures that.

A Dish page shows every attempt in sequence:
- Photos side by side down the page
- My verbatim note from each attempt
- What changed between attempts (diffed from the extractions)
- Rating trajectory

Then the payoff: after three or four attempts, **generate a canonical recipe from my own experiments** — the version that worked, written up properly, derived entirely from what I actually did and said. That's a personal recipe no cookbook can give me.

---

## 8. Insight layer

Analytics only where they'd change behaviour. No vanity metrics.

- **Cuisine distribution over time** — am I in a Thai rut? Haven't touched Sri Lankan since March?
- **Ingredient frequency** — my actual rotation, versus what I think it is
- **Technique coverage with gaps** — "you've never done a proper braise" is a genuinely motivating prompt
- **Repertoire depth** — dishes cooked 3+ times are "in the repertoire"; watching that list grow is the satisfying bit
- **Novelty rate** — what share of cooks each month are new dishes
- **Herb garden usage** — what I actually pick versus what's just growing
- **Nutrition trend** — protein and carb quality over time, given the low-GI approach. Trends and patterns only, no daily targets or scoring.

---

## 9. Forward-looking layer

Where it stops being a log and becomes a partner. All of this is only possible *because* of the archive.

- **"What should I cook tonight?"** — weighing what's in the fridge, what I haven't made recently, effort available, season, and what I rated well
- **Pantry state** — photo of the shelf becomes an inventory; flags the lemongrass that's on borrowed time
- **Week planning** — plan five dinners, get a shopping list grouped by shop
- **Supper club mode** — menu builder that balances courses, flags oven and hob conflicts, and builds a backwards prep timeline from service. Genuinely hard in my head, easy with structured data.
- **Guest memory** — who came, what they were served, dietary requirements, so I never repeat a menu on the same people
- **Skill progression** — suggest a dish specifically because it practises a technique I haven't used

---

## 10. Output layer

Turning the archive back into things:

- **Generated recipes** from my own voice notes across attempts — rambling becomes a clean card someone else could follow
- **Cookbook export** — greatest hits, photos and all, as a designed PDF I could actually get printed. A lovely object to own in five years.
- **Shareable dish pages** for when someone asks how I made something
- **Multi-user**, eventually — Jonty logging too, or friends following along

---

## 11. Visual direction

*Proposal. Change freely — but change it deliberately, not by drifting into defaults.*

### 11.1 The concept: specimen archive, not cookbook

Not a recipe app, not a social feed. A **field notebook for one cook**. The interface is technical and recessive — small-caps labels, monospace for anything that is data (dates, counts, ratings, attempt numbers), generous negative space. The food photography carries all the warmth. The chrome carries none.

### 11.2 Signature: cuisine as colour

The app's own chrome is neutral. **All colour comes from the data** — each cuisine carries a fixed accent hue, so the archive is colour-coded at a glance and a year view reads as a visual record of what I've been cooking.

Top cuisines get hand-picked hues; everything else is generated deterministically (`hue = hash(cuisine) % 360`, fixed saturation and lightness) so new cuisines are consistent, harmonious, and never clash.

This is structure encoding something true about the content rather than decorating it — and it's the one thing the app will be remembered for.

### 11.3 Signature: the specimen sheet

The Dish page is the second bold move. Attempts run down a single column with a monospace date rail on the left edge. You literally read your own progress down the page. This is the screen to make beautiful.

### 11.4 Tokens

```
Ink        #14150F   near-black, faint green undertone
Paper      #EDEEEA   cool paper white, not cream
Graphite   #6B6D64   secondary text
Hairline   #D6D7D1   rules and dividers
Accent     from cuisine data — never fixed in chrome
```

Deliberately avoiding warm-cream-plus-terracotta and near-black-plus-acid-green. Both are the current house style of AI-generated design and would make this look like everything else.

```
Display    Bricolage Grotesque   dish names — variable, opinionated, slightly odd
Body/UI    Inter Tight           everything else
Data       IBM Plex Mono         dates, counts, ratings, attempt numbers
```

*Alternate display if Bricolage feels too much: Newsreader, for a quieter old-style feel.*

### 11.45 Attribution, when it's needed

Most of the time the feed is entirely yours, so no author marks are needed — a relief for the recessive chrome. Attribution appears in exactly two places: a co-cooked entry ("with Pierce") and the header when you're viewing someone else's shared log ("Vishal's log"). Treat it as data — monospace, a monogram or initial, quiet. Never a chunky social avatar. It sits with the date and attempt number, never competing with the food.

### 11.5 Motion

One orchestrated moment, not scattered effects: the feed card filling in as enrichment completes — photo first, then the name typing in, then the metadata settling. It makes the background work visible and satisfying rather than mysterious. Everything else stays still. Respect `prefers-reduced-motion`.

---

## 12. Technical architecture

### 12.1 Stack

| Layer | Choice |
|---|---|
| App | Next.js (App Router), TypeScript |
| Database | Supabase Postgres + pgvector |
| Files | Supabase Storage |
| Auth | Supabase magic link, invite-only (closed group) |
| Hosting | Vercel |
| AI | Claude API, server-side only |
| Embeddings | Voyage AI (Claude has no embeddings endpoint) |

### 12.2 Key client libraries

- `browser-image-compression` — HEIC/large JPEG down to ~1600px long edge before upload. Significant on mobile data.
- `dexie` — IndexedDB wrapper for the capture queue
- `@tanstack/react-query` — server state, optimistic updates
- Supabase Realtime — live card updates as enrichment lands
- Hand-rolled service worker (`next-pwa` is an option but adds opacity for little gain here)

### 12.3 Enrichment as a job

Client uploads photos, then fires `/api/enrich` and forgets it. The cook row's `enrichment_status` drives the UI; a Realtime subscription updates the card in place. Failed jobs retry on next app foreground.

### 12.4 iOS PWA — what actually works

| | |
|---|---|
| ✅ | Add to Home Screen, standalone display, custom icon and splash |
| ✅ | Camera via file input with `capture` attribute |
| ✅ | Dictation via the system keyboard into any text field |
| ✅ | Service worker + Cache API for the offline shell |
| ✅ | IndexedDB for the capture queue |
| ✅ | Push notifications — iOS 16.4+, only when installed to home screen |
| ❌ | Web Share Target — can't share photos into the app from Photos |
| ❌ | Background Sync API — queue flushes on foreground instead |
| ⚠️ | Storage durability — treat IndexedDB as a queue, never as the archive |
| ⚠️ | Manifest shortcuts (long-press icon → "New cook") — verify current Safari support |

*Safari's PWA support moves. Verify the ❌ and ⚠️ rows before designing around them.*

---

## 13. Build phases

Each phase ends with something usable. Don't start the next until the current one is on the home screen and being used.

**Phase 0 — Prove the loop (on a per-owner foundation)**
Next.js + Supabase + Vercel. One screen: photo in, row in the database, photo on the feed. No AI, no sharing. But get the ownership foundation right now, because retrofitting it is a rebuild: `profile` table, magic-link auth, `owner_id` on every cook and dish, and owner-scoped RLS from the first migration. Just Sahil, just his own log.
*Done when: I've logged five actual dinners without thinking about it, and every row is already owned and RLS-protected.*

**Phase 1 — Capture, properly**
The full §3 flow. Dictation, offline queue, optimistic save, IndexedDB, compression, EXIF timestamps. Enrichment call added, structured JSON, Dish/Cook split, Realtime card updates.
*Done when: capture is under 20 seconds and works with no signal.*

**Phase 2 — Backfill and search**
Camera roll multi-select import. Embeddings and semantic search. Filters. The archive suddenly has depth.
*Done when: I can find a dish from two years ago by describing it badly.*

**Phase 2b — Sharing (view-shares and co-cooks)**
Invite by email. The two overlays: `view_share` (let Vishal see your log) with its accept/revoke flow and the read-only "someone's log" view; and `cook_participant` co-cooking so you and Pierce log a joint meal that lands in both feeds. The RLS predicates from §4.4 go in here. Bring Pierce and Vishal in.
*Done when: Vishal can see my log, and a meal Pierce and I cook together shows up in both our feeds.*

**Phase 3 — The notebook**
Dish pages, attempt history, diffs across attempts, generated canonical recipes. Ingredient and technique normalisation into join tables. Lineage is personal (already decided), so this is per-owner.
*Done when: the bread page tells the story of the bread.*

**Phase 4 — Insight**
Analytics. Technique gaps. Repertoire depth. Calendar heatmap.

**Phase 5 — Partner**
Pantry state, meal suggestions, week planning.

**Phase 6 — If ever**
Supper club mode, guest memory, cookbook export, blended enrichment context on co-cooks, comparing a dish across people who've both made it.

---

## 14. Non-goals

Explicitly out of scope, to stop scope creep:

- **Calorie counting as a purpose.** Nutrition is a trend signal, not a target or a score.
- **A public social feed.** Logs are personal by default. Sharing is explicit, per-person grants (view-shares and co-cooks), not a network — no discovery, no followers you didn't approve, no open sign-up, no likes.
- **Recipe import from the web.** This records what I cooked, not what I might cook.
- **Desktop or Android optimisation.** iOS PWA until it works perfectly.
- **On-device AI.** Enrichment needs a network. That's fine — capture doesn't.
- **A custom camera UI.** The system camera is better and faster.

---

## 15. Open decisions

Things to settle before Claude Code starts:

1. **Landing screen** — does the app open to the feed with a prominent capture button, or straight into the camera? Straight to camera is faster to log but hostile to browsing. Recommendation: feed, with the capture button fixed in the thumb zone.
2. **Rating at capture, or later?** Rating at capture adds a tap. Recommendation: never at capture; rate from the feed whenever.
3. **How wrong is too wrong?** What confidence threshold triggers "Check this" — and does an unreviewed entry still count in analytics?
4. **Nutrition estimates at all?** They're rough by nature. Useful signal, or false precision I'll end up distrusting?
5. **Dish granularity** — is "chicken curry" one dish with variations, or is every meaningful variant its own dish? This decides whether attempt histories are rich or noisy.
6. **Co-cook dish attachment (the one small nuance).** A meal Sahil and Pierce cook together attaches to *one* person's dish lineage — the owner's. Pierce sees it in his feed as "cooked with Sahil" but it counts toward Sahil's kimchi-jjigae history, not his own. Recommendation: accept this for v1 (simple, unambiguous); optionally later let a co-author also link it into their own lineage. Decide before phase 3.
7. **Whose enrichment context on a co-cook?** Recommendation: the owner's, per §5.2. Blending both is a phase-6 nicety.
8. **Name.** *Mise* is a placeholder.

*Resolved: dish lineage is personal — each person's dish has their own attempt history and trajectory. This was the previous open fork; the personal-first model settles it.*
