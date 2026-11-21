-- SIGNATURE — BATCH 3 MIGRATION
-- Adds: admin moderation (remove any artwork, review reports, removal log),
--       an artist-controlled "allow download" switch.
-- For your EXISTING Supabase project. Safe to run more than once (idempotent).
-- Run this BEFORE deploying the new code:
-- Supabase Dashboard -> SQL Editor -> New query -> paste -> Run

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
