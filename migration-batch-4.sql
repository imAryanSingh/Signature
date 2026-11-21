-- SIGNATURE — BATCH 4 MIGRATION
-- Adds: notification EMAILS (follow / comment / like / share → the artist; reports → admins),
--       per-type email preferences, and a safe "share" event.
-- For your EXISTING Supabase project. Safe to run more than once (idempotent).
-- Run order: batch 2, batch 3, then this file.
--
-- After running it you must also:
--   1. add the server environment variables on Vercel (see SETUP.md, section G)
--   2. run the two INSERT statements at the very bottom of this file (your URL + secret)

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
