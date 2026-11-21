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
-- Data API access. Supabase stopped granting this automatically for tables created
-- from 30 Oct 2026, so it is stated here. Row Level Security above still decides
-- which rows anyone can actually see or change.
-- ============================================================
grant usage on schema public to anon, authenticated, service_role;
grant select on public.profiles, public.works, public.likes, public.comments, public.follows to anon;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.works to authenticated;
grant select, insert, delete on public.likes, public.comments, public.follows to authenticated;
grant select, insert, update, delete on public.collections to authenticated;
grant select, update, delete on public.notifications to authenticated;
grant select, insert on public.reports to authenticated;
grant all on public.profiles, public.works, public.likes, public.comments, public.follows,
  public.collections, public.notifications, public.reports to service_role;

-- ============================================================
-- Batch 2 features (from migration-batch-2.sql)
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

-- ------------------------------------------------------------
-- Data API access. Supabase stopped granting this automatically for tables created
-- from 30 Oct 2026, so it is stated here. Row Level Security above still decides
-- which rows anyone can actually see or change.
-- ------------------------------------------------------------
grant select on public.work_steps, public.growth_threads to anon;
grant select, insert, delete on public.work_steps, public.growth_threads to authenticated;
grant select, insert, delete on public.tag_follows to authenticated;
grant select, insert on public.verification_requests to authenticated;
grant all on public.work_steps, public.growth_threads, public.tag_follows, public.verification_requests to service_role;

-- Make the new tables/functions visible to the app right away.
notify pgrst, 'reload schema';


-- ============================================================
-- Batch 3 features (from migration-batch-3.sql)
-- ============================================================

-- ------------------------------------------------------------
-- 0. Make sure the `reports` table exists. (It came from the original setup SQL;
--    some projects never ran that part, which caused: relation "reports" does not exist.)
--    Does nothing if the table is already there.
-- ------------------------------------------------------------
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references profiles(id) on delete cascade not null,
  work_id uuid references works(id) on delete cascade not null,
  reason text not null,
  details text default '',
  status text not null default 'pending', -- 'pending' | 'reviewed' | 'dismissed'
  created_at timestamptz default now()
);

alter table reports enable row level security;

drop policy if exists "Users can view their own reports" on reports;
create policy "Users can view their own reports" on reports for select using (auth.uid() = reporter_id);

drop policy if exists "Users can submit reports" on reports;
create policy "Users can submit reports" on reports for insert with check (auth.uid() = reporter_id);

grant select, insert on public.reports to authenticated;
grant all on public.reports to service_role;

-- ------------------------------------------------------------
-- 1. Columns
-- ------------------------------------------------------------
alter table profiles add column if not exists verified boolean not null default false;
alter table profiles add column if not exists is_admin boolean not null default false;
alter table works add column if not exists allow_download boolean not null default false;

-- ------------------------------------------------------------
-- 2. Admin check (used by the rules below)
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$ language sql stable security definer set search_path = public;

grant execute on function public.is_admin() to anon, authenticated;

-- ------------------------------------------------------------
-- 3. Nobody can promote themselves. Requests coming through the app
--    (auth.uid() is set) can never change `verified` or `is_admin` unless the
--    person is an admin (that is how the Approve button works). You can also
--    change them from the SQL Editor (auth.uid() is null there).
-- ------------------------------------------------------------
create or replace function public.protect_verified_flag()
returns trigger as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.verified := false;
      new.is_admin := false;
    else
      new.verified := old.verified;
      new.is_admin := old.is_admin;
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
-- 4. Admins can remove any artwork (and its files)
-- ------------------------------------------------------------
drop policy if exists "Users can delete their own works" on works;
create policy "Users can delete their own works" on works
  for delete using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can delete their own uploads" on storage.objects;
create policy "Users can delete their own uploads" on storage.objects
  for delete using (
    bucket_id = 'artwork'
    and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin())
  );

-- ------------------------------------------------------------
-- 5. Admins can read and resolve reports
-- ------------------------------------------------------------
drop policy if exists "Admins can view all reports" on reports;
create policy "Admins can view all reports" on reports
  for select using (public.is_admin());

drop policy if exists "Admins can update reports" on reports;
create policy "Admins can update reports" on reports
  for update using (public.is_admin());

-- ------------------------------------------------------------
-- 6. Removal log (who removed what, and why). Survives the artwork being deleted.
-- ------------------------------------------------------------
create table if not exists moderation_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references profiles(id) on delete set null,
  work_id uuid,
  work_title text,
  owner_id uuid,
  reason text not null,
  created_at timestamptz default now()
);

alter table moderation_log enable row level security;

drop policy if exists "Admins can read the moderation log" on moderation_log;
create policy "Admins can read the moderation log" on moderation_log
  for select using (public.is_admin());

drop policy if exists "Admins can write the moderation log" on moderation_log;
create policy "Admins can write the moderation log" on moderation_log
  for insert with check (public.is_admin() and admin_id = auth.uid());

-- ------------------------------------------------------------
-- 7. Verification requests: admins can see them all and approve / decline.
--    (Requires migration-batch-2.sql, which creates verification_requests.)
-- ------------------------------------------------------------
drop policy if exists "Admins can view all verification requests" on verification_requests;
create policy "Admins can view all verification requests" on verification_requests
  for select using (public.is_admin());

create or replace function public.review_verification(p_request_id uuid, p_approve boolean)
returns void as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can review verification requests';
  end if;
  select user_id into v_user from public.verification_requests where id = p_request_id;
  if v_user is null then
    raise exception 'Verification request not found';
  end if;
  update public.verification_requests
    set status = case when p_approve then 'approved' else 'rejected' end
    where id = p_request_id;
  if p_approve then
    update public.profiles set verified = true where id = v_user;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.review_verification(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- 8. MAKE YOURSELF AN ADMIN (run once, with your own username):
--
--    update profiles set is_admin = true where username = 'your_username';
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Data API access (see migration-batch-2.sql for why). Row Level Security limits the
-- reports update and the moderation log to admins.
-- ------------------------------------------------------------
grant update on public.reports to authenticated;
grant select, insert on public.moderation_log to authenticated;
grant all on public.moderation_log to service_role;

-- Make the new tables/functions visible to the app right away.
notify pgrst, 'reload schema';


-- ============================================================
-- Batch 4 features (from migration-batch-4.sql)
-- ============================================================

-- ------------------------------------------------------------
-- 1. pg_net lets the database call your Vercel function.
--    If this notice appears, enable it by hand:
--    Dashboard -> Database -> Extensions -> pg_net.
-- ------------------------------------------------------------
do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'Could not enable pg_net automatically. Enable it in Dashboard > Database > Extensions.';
end $$;

-- ------------------------------------------------------------
-- 2. Preferences + bookkeeping columns
-- ------------------------------------------------------------
alter table profiles add column if not exists email_follows boolean not null default true;
alter table profiles add column if not exists email_comments boolean not null default true;
alter table profiles add column if not exists email_likes boolean not null default true;
alter table profiles add column if not exists email_shares boolean not null default true;

alter table notifications add column if not exists emailed_at timestamptz;

create index if not exists notifications_email_idx on notifications(recipient_id, emailed_at);

-- ------------------------------------------------------------
-- 3. Private settings (where the Vercel URL and the shared secret live).
--    RLS is on and there are NO policies, so the app can never read this table.
-- ------------------------------------------------------------
create table if not exists app_settings (
  key text primary key,
  value text not null
);

alter table app_settings enable row level security;
revoke all on app_settings from anon, authenticated;

-- ------------------------------------------------------------
-- 4. The function that pings Vercel. It can never break a like/comment/follow:
--    any failure is swallowed.
-- ------------------------------------------------------------
create or replace function public.notify_by_email(p_payload jsonb)
returns void as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from public.app_settings where key = 'notify_url';
  select value into v_secret from public.app_settings where key = 'notify_secret';
  if v_url is null or v_secret is null then
    return; -- not configured yet: emails are simply off
  end if;
  perform net.http_post(
    url := v_url,
    body := p_payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret)
  );
exception when others then
  raise warning 'notify_by_email failed: %', sqlerrm;
end;
$$ language plpgsql security definer set search_path = public;

-- ------------------------------------------------------------
-- 5. Triggers: every new in-app notification (follow / comment / like / share) emails the artist.
-- ------------------------------------------------------------
create or replace function public.handle_notification_email()
returns trigger as $$
begin
  perform public.notify_by_email(jsonb_build_object('kind', 'notification', 'id', new.id));
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_notification_email on notifications;
create trigger on_notification_email
  after insert on notifications
  for each row execute function public.handle_notification_email();

-- Reports email the admins (the reporter's identity is never sent to the artist).
create or replace function public.handle_report_email()
returns trigger as $$
begin
  perform public.notify_by_email(jsonb_build_object('kind', 'report', 'id', new.id));
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_report_email on reports;
create trigger on_report_email
  after insert on reports
  for each row execute function public.handle_report_email();

-- ------------------------------------------------------------
-- 6. "Share" events. People can no longer insert notifications directly
--    (that would let anyone spam anyone's inbox); shares go through this function,
--    which uses the caller's real identity and allows one per person per piece per day.
-- ------------------------------------------------------------
drop policy if exists "System can insert notifications" on notifications;

create or replace function public.record_share(p_work_id uuid)
returns void as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then return; end if;
  select user_id into v_owner from public.works where id = p_work_id;
  if v_owner is null or v_owner = auth.uid() then return; end if;
  if exists (
    select 1 from public.notifications
    where recipient_id = v_owner and actor_id = auth.uid() and work_id = p_work_id
      and type = 'share' and created_at > now() - interval '1 day'
  ) then
    return;
  end if;
  insert into public.notifications (recipient_id, actor_id, type, work_id)
  values (v_owner, auth.uid(), 'share', p_work_id);
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.record_share(uuid) to authenticated;

-- ------------------------------------------------------------
-- 7. TURN IT ON — run these two statements ONCE, with your own values:
--    (use your real site address, and a long random secret you make up;
--     the SAME secret goes into Vercel as NOTIFY_SECRET)
--
-- insert into app_settings (key, value) values
--   ('notify_url',    'https://signature-gray.vercel.app/api/notify'),
--   ('notify_secret', 'PASTE-A-LONG-RANDOM-STRING-HERE')
-- on conflict (key) do update set value = excluded.value;
--
-- To turn emails off again:  delete from app_settings where key in ('notify_url','notify_secret');
--
-- To see whether the database reached Vercel (status 200 = good):
--    select id, status_code, error_msg, created from net._http_response order by created desc limit 10;
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Data API access. app_settings is private: only the server (service_role) may touch it.
-- ------------------------------------------------------------
grant all on public.app_settings to service_role;
grant all on public.notifications to service_role;

-- Make the new tables/functions visible to the app right away.
notify pgrst, 'reload schema';


-- ============================================================
-- Batch 5 features (from migration-batch-5.sql)
-- ============================================================

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


-- ============================================================
-- Batch 6 features (from migration-batch-6.sql)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Stop the per-event emails. (Reports to admins still email instantly.)
-- ------------------------------------------------------------
drop trigger if exists on_notification_email on notifications;
drop function if exists public.handle_notification_email();

-- ------------------------------------------------------------
-- 2. Remember which comment a notification is about, so the daily summary
--    can quote what the person wrote.
-- ------------------------------------------------------------
alter table notifications add column if not exists comment_id uuid references comments(id) on delete set null;

create or replace function public.handle_new_comment()
returns trigger as $$
begin
  insert into public.notifications (recipient_id, actor_id, type, work_id, comment_id)
  select w.user_id, new.user_id, 'comment', new.work_id, new.id
  from public.works w where w.id = new.work_id and w.user_id != new.user_id;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ------------------------------------------------------------
-- 3. The daily job looks for notifications that haven't been emailed yet.
-- ------------------------------------------------------------
create index if not exists notifications_unsent_idx on notifications(created_at) where emailed_at is null;

-- Make the changes visible to the app right away.
notify pgrst, 'reload schema';
