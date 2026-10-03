-- SIGNATURE — BATCH 2 MIGRATION
-- For your EXISTING Supabase project. Safe to run more than once (idempotent).
-- Run this BEFORE deploying the new code:
-- Supabase Dashboard -> SQL Editor -> New query -> paste -> Run

-- ------------------------------------------------------------
-- 1. Profiles: verified badge + weekly digest opt-in
-- ------------------------------------------------------------
alter table profiles add column if not exists verified boolean not null default false;
alter table profiles add column if not exists digest_opt_in boolean not null default false;

-- Users must NOT be able to give themselves the verified badge.
-- Requests coming through the app (auth.uid() is set) can never change it;
-- you can, from the SQL Editor / Table Editor (auth.uid() is null there).
create or replace function public.protect_verified_flag()
returns trigger as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.verified := false;
    else
      new.verified := old.verified;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists protect_verified on profiles;
create trigger protect_verified
  before insert or update on profiles
  for each row execute function public.protect_verified_flag();

-- ------------------------------------------------------------
-- 2. Studio Log: process shots attached to a finished piece
-- ------------------------------------------------------------
create table if not exists work_steps (
  id uuid primary key default gen_random_uuid(),
  work_id uuid references works(id) on delete cascade not null,
  image_url text not null,
  caption text default '',
  position int not null default 0,
  created_at timestamptz default now()
);

create index if not exists work_steps_work_idx on work_steps(work_id, position);

alter table work_steps enable row level security;

drop policy if exists "Steps are viewable by everyone" on work_steps;
create policy "Steps are viewable by everyone" on work_steps for select using (true);

drop policy if exists "Owners can add steps" on work_steps;
create policy "Owners can add steps" on work_steps for insert
  with check (exists (select 1 from works w where w.id = work_id and w.user_id = auth.uid()));

drop policy if exists "Owners can delete steps" on work_steps;
create policy "Owners can delete steps" on work_steps for delete
  using (exists (select 1 from works w where w.id = work_id and w.user_id = auth.uid()));

-- ------------------------------------------------------------
-- 3. Growth Threads: link a piece to the earlier piece it improves on
-- ------------------------------------------------------------
create table if not exists growth_threads (
  id uuid primary key default gen_random_uuid(),
  new_work_id uuid references works(id) on delete cascade not null unique,
  previous_work_id uuid references works(id) on delete cascade not null,
  note text not null default '',
  created_at timestamptz default now(),
  check (new_work_id <> previous_work_id)
);

create index if not exists growth_threads_prev_idx on growth_threads(previous_work_id);

alter table growth_threads enable row level security;

drop policy if exists "Threads are viewable by everyone" on growth_threads;
create policy "Threads are viewable by everyone" on growth_threads for select using (true);

-- Both pieces must belong to the person creating the thread.
drop policy if exists "Owners can create threads" on growth_threads;
create policy "Owners can create threads" on growth_threads for insert with check (
  exists (select 1 from works w where w.id = new_work_id and w.user_id = auth.uid())
  and exists (select 1 from works w where w.id = previous_work_id and w.user_id = auth.uid())
);

drop policy if exists "Owners can delete threads" on growth_threads;
create policy "Owners can delete threads" on growth_threads for delete
  using (exists (select 1 from works w where w.id = new_work_id and w.user_id = auth.uid()));

-- ------------------------------------------------------------
-- 4. Tag following
-- ------------------------------------------------------------
create table if not exists tag_follows (
  user_id uuid references profiles(id) on delete cascade,
  tag text not null,
  created_at timestamptz default now(),
  primary key (user_id, tag)
);

alter table tag_follows enable row level security;

drop policy if exists "Users can view their own tag follows" on tag_follows;
create policy "Users can view their own tag follows" on tag_follows for select using (auth.uid() = user_id);

drop policy if exists "Users can follow tags as themselves" on tag_follows;
create policy "Users can follow tags as themselves" on tag_follows for insert with check (auth.uid() = user_id);

drop policy if exists "Users can unfollow tags as themselves" on tag_follows;
create policy "Users can unfollow tags as themselves" on tag_follows for delete using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 5. Verification requests (manual review; no ID documents collected)
-- ------------------------------------------------------------
create table if not exists verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  note text not null,
  link text default '',
  status text not null default 'pending', -- 'pending' | 'approved' | 'rejected'
  created_at timestamptz default now()
);

alter table verification_requests enable row level security;

drop policy if exists "Users can view their own verification requests" on verification_requests;
create policy "Users can view their own verification requests" on verification_requests
  for select using (auth.uid() = user_id);

drop policy if exists "Users can submit verification requests" on verification_requests;
create policy "Users can submit verification requests" on verification_requests
  for insert with check (auth.uid() = user_id and status = 'pending');

-- ------------------------------------------------------------
-- 6. View counter that works for every visitor
--    (before this, only the owner's own views were being counted)
-- ------------------------------------------------------------
create or replace function public.increment_work_views(p_work_id uuid)
returns void as $$
  update public.works set views = coalesce(views, 0) + 1 where id = p_work_id;
$$ language sql security definer set search_path = public;

grant execute on function public.increment_work_views(uuid) to anon, authenticated;
