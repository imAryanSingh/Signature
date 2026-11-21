-- SIGNATURE — BATCH 6 MIGRATION
-- Changes notification emails from "one email per like/comment" to "ONE summary email per
-- person per day" (sent by the daily job /api/daily-activity). Views are never emailed.
-- For your EXISTING Supabase project. Safe to run more than once (idempotent).
-- Run order: batch 2, 3, 4, 5, then this file.

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
