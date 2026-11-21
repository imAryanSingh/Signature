-- SIGNATURE — BATCH 5 MIGRATION
-- Adds: AI first-pass critique (stored critiques + a usage log for spending limits).
-- For your EXISTING Supabase project. Safe to run more than once (idempotent).
-- Run order: batch 2, 3, 4, then this file.

-- ------------------------------------------------------------
-- 1. The critiques themselves (one per artwork, replaced when regenerated).
--    Everyone can read them, like the artwork. Only the server function can write.
--    Artists can remove the AI critique from their own piece.
-- ------------------------------------------------------------
create table if not exists ai_critiques (
  id uuid primary key default gen_random_uuid(),
  work_id uuid references works(id) on delete cascade not null unique,
  content jsonb not null,
  model text,
  requested_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

alter table ai_critiques enable row level security;

drop policy if exists "AI critiques are viewable by everyone" on ai_critiques;
create policy "AI critiques are viewable by everyone" on ai_critiques
  for select using (true);

drop policy if exists "Owners can remove their AI critique" on ai_critiques;
create policy "Owners can remove their AI critique" on ai_critiques
  for delete using (exists (select 1 from works w where w.id = work_id and w.user_id = auth.uid()));

-- ------------------------------------------------------------
-- 2. Usage log. Powers the daily limits (per artist and site-wide) and shows token use.
--    No policies and no grants: the app can never read or write it.
-- ------------------------------------------------------------
create table if not exists ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  work_id uuid references works(id) on delete set null,
  input_tokens int,
  output_tokens int,
  created_at timestamptz default now()
);

create index if not exists ai_usage_created_idx on ai_usage(created_at);
create index if not exists ai_usage_user_idx on ai_usage(user_id, created_at);

alter table ai_usage enable row level security;
revoke all on ai_usage from anon, authenticated;

-- ------------------------------------------------------------
-- Handy: how much AI have you used lately?
--
--   select date_trunc('day', created_at) as day, count(*) as critiques,
--          sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens
--   from ai_usage group by 1 order by 1 desc limit 14;
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Data API access. ai_usage is private (server only).
-- ------------------------------------------------------------
grant select on public.ai_critiques to anon;
grant select, delete on public.ai_critiques to authenticated;
grant all on public.ai_critiques, public.ai_usage to service_role;

-- Make the new tables/functions visible to the app right away.
notify pgrst, 'reload schema';
