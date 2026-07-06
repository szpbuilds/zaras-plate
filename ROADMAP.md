# Zara's Plate — Roadmap

Next-phase work, captured as three independent tracks. Order is flexible, but they
share one linchpin: **a backend**. Standing one up unlocks the database, lets the
Anthropic API key live server-side (fixing `callClaude`), and makes a "real" shared
app possible. Recommendations below are **proposals** — override freely when we build.

Current baseline (for context):
- Pure React + Vite frontend, **no backend**. `callClaude` (`src/App.jsx`) POSTs straight
  to `api.anthropic.com` with no key — only worked inside the claude.ai artifact sandbox.
- The weekly `menu`, `customRecipes` ("Add to cookbook" results), and generated picks are
  **in-memory only** — lost on reload. `localStorage` persists just per-recipe toggle prefs
  and the daily-picks cache (`loadPrefs`/`savePrefs`).
- Recipes are a static `RECIPES` array in code, plus runtime `customRecipes`.
- The **Log** tab exists in `COMPOSER_TABS` as a stub (placeholder text only) — no log view yet.

---

## 1. Real recipe database (+ backend)

**Goal:** Persist recipes, the weekly plan, and generated content in a real datastore so data
survives reloads and can grow into a genuine recipe library — not a hardcoded array.

**Where it stands:** Everything lives in memory or in a static array. `RECIPES` is code;
`customRecipes` and `menu` vanish on refresh. There is no server.

**Key considerations:**
- Schema: `recipes` (the library, replacing/augmenting `RECIPES`), `menu_entries`
  (day + meal slot + recipe ref, replacing the in-memory `menu`), and later `logs` (track 2).
- Ownership: **per-user (decided)** — each person gets their own recipes, plan, and logs, so
  **auth is in scope from the start** (Supabase Auth or equivalent); every table is scoped by `user_id`.
- The same backend should host the **Anthropic proxy** so `callClaude` stops calling
  `api.anthropic.com` directly. This is the single highest-leverage change in the whole roadmap.
- Migration: seed the DB from today's `RECIPES` array so nothing is lost.

**Proposed approach:** **Supabase** (hosted Postgres + auth + JS client, generous free tier) —
fastest path from zero, and its edge functions can hold the Anthropic proxy.
_Alternatives:_ Vercel/Netlify serverless functions + **Neon** (serverless Postgres); or
Cloudflare Workers + D1. Pick based on where we deploy (track 3).

**Open questions:**
- Do we keep `localStorage` as an offline cache layer, or go fully server-backed?

**Tasks:**
- [ ] Choose backend/DB host and create the project
- [ ] Set up user auth; scope every table by `user_id`
- [ ] Define schema: recipes, menu_entries (day + meal slot), all per-user
- [ ] Stand up the server-side Anthropic proxy; repoint `callClaude` at it
- [ ] Replace in-memory `menu` / `customRecipes` with DB reads/writes
- [ ] Seed the DB from the existing `RECIPES` array

**Dependencies:** None to start. **Unblocks** persistent logging (track 2) and a genuine
shared app (track 3).

---

## 2. Logging functionality

**Goal:** Turn the stub **Log** tab into a real meal log / food diary — record what was
actually eaten, when, and its macros, feeding the macro-tracker side of the app.

**Where it stands:** `COMPOSER_TABS` has a `log` entry with placeholder copy, but no log
view or data model. Macro rendering already exists (`NutritionCard`, `PlanMacroSummary`) and
can be reused.

**Key considerations:**
- Data model **(decided)**: reuse the meal-slot model (breakfast / lunch / snack / dinner),
  and stamp the **actual `logged_at` date+time** when the item is logged — so an entry ≈
  `{ meal, logged_at, source (library recipe | external | freeform), macros, notes }`.
  Note `logged_at` is the real moment of logging, distinct from a *planned* day in the `menu`.
- Relationship to the plan: is a log its own thing, or "mark a planned meal as eaten"
  (one tap from the Plan tab)? Likely both — quick-log from the plan **and** ad-hoc entries.
- Views: a daily/weekly log list + a macro roll-up (reuse `PlanMacroSummary`-style totals).

**Proposed approach:** Build the Log tab as a dated list of entries with a quick "log this
meal" action from Plan-tab cards. Start against `localStorage`, then move to the DB once
track 1 lands so history is durable.

**Open questions:**
- Track only macros, or also portions/servings and a rating/notes field?

**Tasks:**
- [ ] Define the log-entry data model (meal slot + `logged_at` timestamp)
- [ ] Build the Log tab view (entries by logged date/time + macro roll-up)
- [ ] Add "log this meal" from Plan/recipe cards
- [ ] Persist to `localStorage`, then migrate to DB (after track 1)

**Dependencies:** Works standalone on `localStorage`; **best after track 1** for durable history.

---

## 3. Shareable URL for friends / testing

**Goal:** A live URL to hand to friends so they can try the app and give feedback.

**Where it stands:** Runs only on `localhost` via `npm run dev`. `npm run build` produces a
static `dist/` — deployable today, but with two caveats below.

**Key considerations:**
- **Decided: hold for the backend-backed version.** No interim static-only preview — the shared
  URL waits until the backend (track 1) is in, so friends get per-user accounts, shared/persistent
  data, and working AI features rather than a per-browser shell.
- **Never ship the API key in the frontend** — the shared build must call the proxy, not
  `api.anthropic.com`. This couples the deploy to track 1.
- Access: since data is per-user (track 1), friends sign in with their own account; a public
  unlisted URL is fine. Optionally gate signups (invite/allowlist) during testing.

**Proposed approach:** **Vercel** (or Netlify) — first-class Vite support, serverless
functions for the proxy, and env-var management for the key, all in one place. Single deploy of
the full backend-backed app once track 1 lands.

**Open questions:**
- Custom domain, or a default `*.vercel.app` / `*.netlify.app` URL for testing?
- Open signups or an invite/allowlist gate during the friends-testing phase?

**Tasks:**
- [ ] Pick a host and connect the GitHub repo for CI deploys
- [ ] Configure the Anthropic key as a server-side env var (with the proxy)
- [ ] Wire the deployed build to the backend + auth (track 1)
- [ ] Decide access model (open signups vs. invite/allowlist)

**Dependencies:** **Depends on track 1** (backend + auth + proxy) — the deploy follows it.

---

## Suggested sequencing (order is flexible)

1. **Backend + auth + Anthropic proxy** (start of track 1) — the linchpin; unblocks the other two.
2. **Database migration** (rest of track 1) — move `menu`/recipes off in-memory state, scoped per user.
3. **Logging** (track 2) — build on the persistence layer.
4. **Backend-backed shared deploy** (track 3) — hand it to friends for real.

No interim static preview — the shared URL waits for the backend-backed build (decided).
