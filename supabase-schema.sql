-- SIGNATURE — full database schema (for a FRESH Supabase project)
-- Run once: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Already have a live project? Don't run this file. Run migration-batch-2.sql instead.

-- PROFILES (extends built-in auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  name text not null,
  bio text default '',
  website text default '',
  instagram text default '',
  twitter text default '',
  avatar_url text,
  cover_url text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
create policy "Profiles are viewable by everyone" on profiles for select using (true);
create policy "Users can insert their own profile" on profiles for insert with check (auth.uid() = id);
create policy "Users can update their own profile" on profiles for update using (auth.uid() = id);

-- Auto-create a profile whenever someone signs up (uses metadata passed at signup)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data->>'name', 'New artist')
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- WORKS (artwork posts)
create table works (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  title text not null default 'Untitled',
  description text default '',
  category text default 'Mixed',
  medium text default '',
  tags text[] default '{}',
  image_url text not null,
  views int default 0,
  critique_requested boolean default false,
  created_at timestamptz default now()
);

alter table works enable row level security;
create policy "Works are viewable by everyone" on works for select using (true);
create policy "Users can insert their own works" on works for insert with check (auth.uid() = user_id);
create policy "Users can update their own works" on works for update using (auth.uid() = user_id);
create policy "Users can delete their own works" on works for delete using (auth.uid() = user_id);

-- LIKES
create table likes (
  user_id uuid references profiles(id) on delete cascade,
  work_id uuid references works(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, work_id)
);

alter table likes enable row level security;
create policy "Likes are viewable by everyone" on likes for select using (true);
create policy "Users can like as themselves" on likes for insert with check (auth.uid() = user_id);
create policy "Users can unlike as themselves" on likes for delete using (auth.uid() = user_id);

-- COMMENTS
create table comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  work_id uuid references works(id) on delete cascade not null,
  text text not null,
  is_critique boolean default false,
  created_at timestamptz default now()
);

alter table comments enable row level security;
create policy "Comments are viewable by everyone" on comments for select using (true);
create policy "Users can comment as themselves" on comments for insert with check (auth.uid() = user_id);
create policy "Users can delete their own comments" on comments for delete using (auth.uid() = user_id);

-- FOLLOWS
create table follows (
  follower_id uuid references profiles(id) on delete cascade,
  following_id uuid references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (follower_id, following_id)
);

alter table follows enable row level security;
create policy "Follows are viewable by everyone" on follows for select using (true);
create policy "Users can follow as themselves" on follows for insert with check (auth.uid() = follower_id);
create policy "Users can unfollow as themselves" on follows for delete using (auth.uid() = follower_id);

-- COLLECTIONS (private to their owner)
create table collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  work_ids uuid[] default '{}',
  created_at timestamptz default now()
);

alter table collections enable row level security;
create policy "Users can view their own collections" on collections for select using (auth.uid() = user_id);
create policy "Users can insert their own collections" on collections for insert with check (auth.uid() = user_id);
create policy "Users can update their own collections" on collections for update using (auth.uid() = user_id);
create policy "Users can delete their own collections" on collections for delete using (auth.uid() = user_id);

-- NOTIFICATIONS
create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references profiles(id) on delete cascade not null,
  actor_id uuid references profiles(id) on delete cascade not null,
  type text not null, -- 'like' | 'comment' | 'follow'
  work_id uuid references works(id) on delete cascade,
  read boolean default false,
  created_at timestamptz default now()
);

alter table notifications enable row level security;
create policy "Users can view their own notifications" on notifications for select using (auth.uid() = recipient_id);
create policy "System can insert notifications" on notifications for insert with check (true);
create policy "Users can mark their own notifications read" on notifications for update using (auth.uid() = recipient_id);
create policy "Users can delete their own notifications" on notifications for delete using (auth.uid() = recipient_id);

create or replace function public.handle_new_like()
returns trigger as $$
begin
  insert into public.notifications (recipient_id, actor_id, type, work_id)
  select w.user_id, new.user_id, 'like', new.work_id
  from public.works w where w.id = new.work_id and w.user_id != new.user_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_new_like on likes;
create trigger on_new_like after insert on likes for each row execute function public.handle_new_like();

create or replace function public.handle_new_comment()
returns trigger as $$
begin
  insert into public.notifications (recipient_id, actor_id, type, work_id)
  select w.user_id, new.user_id, 'comment', new.work_id
  from public.works w where w.id = new.work_id and w.user_id != new.user_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_new_comment on comments;
create trigger on_new_comment after insert on comments for each row execute function public.handle_new_comment();

create or replace function public.handle_new_follow()
returns trigger as $$
begin
  insert into public.notifications (recipient_id, actor_id, type)
  values (new.following_id, new.follower_id, 'follow');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_new_follow on follows;
create trigger on_new_follow after insert on follows for each row execute function public.handle_new_follow();

-- REPORTS (content moderation)
create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references profiles(id) on delete cascade not null,
  work_id uuid references works(id) on delete cascade not null,
  reason text not null,
  details text default '',
  status text not null default 'pending', -- 'pending' | 'reviewed' | 'dismissed'
  created_at timestamptz default now()
);

alter table reports enable row level security;
create policy "Users can view their own reports" on reports for select using (auth.uid() = reporter_id);
create policy "Users can submit reports" on reports for insert with check (auth.uid() = reporter_id);

-- STORAGE: one public bucket for artwork, process shots, avatars and covers (free tier: 1GB)
insert into storage.buckets (id, name, public) values ('artwork', 'artwork', true)
on conflict (id) do nothing;

create policy "Public read access to artwork bucket" on storage.objects
  for select using (bucket_id = 'artwork');

create policy "Authenticated users can upload to artwork bucket" on storage.objects
  for insert with check (bucket_id = 'artwork' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update their own uploads" on storage.objects
  for update using (bucket_id = 'artwork' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete their own uploads" on storage.objects
  for delete using (bucket_id = 'artwork' and auth.uid()::text = (storage.foldername(name))[1]);

-- ============================================================
-- Batch 2 features (appended from migration-batch-2.sql)
-- ============================================================
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
