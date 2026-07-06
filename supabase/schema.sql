-- Zara's Plate — v1 schema (Phase 2 of ROADMAP.md track 1)
-- Run this in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to re-run (drops/recreates policies; uses IF NOT EXISTS for tables).
--
-- Data model notes:
--  * Everything is per-user, enforced by Row-Level Security (RLS): a row is only
--    visible/editable by the user whose id matches auth.uid().
--  * The two hand-built recipes (Pita, Sandwich) are React COMPONENTS, so they stay
--    in code — they are not rows here. This table holds only user-created ("Add to
--    cookbook") recipes.
--  * A menu_entry of kind='library' references a recipe by `recipe_ref`, which is
--    text so it can hold EITHER a code recipe id (e.g. 'chicken-salad-pita') OR a
--    custom recipes.id UUID (as text). kind='external' stores the web pick in
--    `external_data` instead.

-- ---------------------------------------------------------------------------
-- recipes: user-created custom recipes
-- ---------------------------------------------------------------------------
create table if not exists public.recipes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text not null,
  blurb        text,
  kicker       text,
  tags         jsonb not null default '[]',
  time         text,
  servings     integer,
  protein      jsonb not null default '[]',
  diet         text,
  macros       jsonb,
  ingredients  jsonb not null default '[]',
  steps        jsonb not null default '[]',
  source_url   text,
  source_name  text,
  theme        jsonb,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- menu_entries: the weekly plan (one row per recipe-in-a-meal-slot-on-a-day)
-- ---------------------------------------------------------------------------
create table if not exists public.menu_entries (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  day            date not null,
  meal           text not null check (meal in ('breakfast','lunch','snack','dinner')),
  kind           text not null check (kind in ('library','external')),
  recipe_ref     text,    -- kind='library': code id string OR recipes.id uuid as text
  label          text,
  external_data  jsonb,   -- kind='external': the web pick payload
  macros         jsonb,   -- cached per-serving macros (e.g. external "Calculate macros" result)
  created_at     timestamptz not null default now()
);

create index if not exists menu_entries_user_day_idx on public.menu_entries (user_id, day);
create index if not exists recipes_user_idx on public.recipes (user_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security: each user sees and edits only their own rows
-- ---------------------------------------------------------------------------
alter table public.recipes       enable row level security;
alter table public.menu_entries  enable row level security;

drop policy if exists "own recipes" on public.recipes;
create policy "own recipes" on public.recipes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own menu entries" on public.menu_entries;
create policy "own menu entries" on public.menu_entries
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
