# Signature — setup, upgrade & launch checklist

Quick overview lives in [README.md](./README.md). This file is the step-by-step.

---

## A. Upgrading your live site (existing project) — do this in order

1. **Run the database migrations first** (Supabase → **SQL Editor** → **New query** → paste → **Run**), in this order:
   1. [`migration-batch-2.sql`](./migration-batch-2.sql) — process shots, Growth Threads, tag following, **verification requests**, view counter.
   2. [`migration-batch-3.sql`](./migration-batch-3.sql) — admin moderation, downloads, and the admin's approve/decline for verification.
   3. [`migration-batch-4.sql`](./migration-batch-4.sql) — notification emails and email preferences.
   4. [`migration-batch-5.sql`](./migration-batch-5.sql) — AI first-pass critique.
   5. [`migration-batch-6.sql`](./migration-batch-6.sql) — **new**: switches notification emails to one summary a day.

   **Pre-flight check (30 seconds):** run this first. The result should list `profiles`, `works`,
   `likes`, `comments`, `follows`, `collections` and `notifications` (the original tables). If one of
   those is missing, run the matching `create table` part of `supabase-schema.sql` first.
   (`reports` is created for you by batch 3 if it's missing.)
   ```sql
   select table_name from information_schema.tables where table_schema = 'public' order by 1;
   ```

   All are safe to run more than once. Each ends by refreshing Supabase's schema cache, so new
   tables work straight away. If the site shows *"Could not find the table 'public.…' in the
   schema cache"*, that migration has not been run yet — run it, then try again.
   If you deploy the new code first, the site still works, but the features that need new
   tables or columns won't until the SQL is run.

   *Supabase change, 30 Oct 2026:* new tables no longer get API access automatically. These
   migrations already include the `GRANT` lines they need. If you ever create a table by hand,
   add grants too, for example `grant select on public.my_table to anon;` and
   `grant select, insert, update, delete on public.my_table to authenticated, service_role;`.
2. **Make yourself an admin** (run once, with your own username):
   ```sql
   update profiles set is_admin = true where username = 'your_username';
   ```
3. **Replace your project files** with this version and push:
   ```
   git add .
   git commit -m "Verification review, AI critique, notification emails, process shots, admin, downloads"
   git push
   ```
   Vercel redeploys on its own.
4. **Node version:** `package.json` pins `"engines": { "node": "24.x" }`, so Vercel builds on
   Node 24 (Node 20 builds stopped working on 1 Oct 2026).
5. Hard-refresh the live site (Ctrl+Shift+R; on a phone, close and reopen the tab).

## B. Fresh install

1. Create a Supabase project, then run [`supabase-schema.sql`](./supabase-schema.sql) once in the SQL Editor.
2. Make yourself an admin (step A2 above).
3. Copy `.env.example` to `.env` and fill in your Project URL and anon key
   (Supabase → Project Settings → API).
4. `npm install` then `npm run dev`.

## C. Supabase auth settings (one time)

- **Authentication → Providers → Email:** enabled, **Confirm email** ON.
- **Authentication → URL Configuration:** Site URL = your live URL
  (e.g. `https://signature-gray.vercel.app`). Add the same URL, with `/**`, under Redirect URLs.
  Add `http://localhost:5173/**` too if you test locally.
- **Authentication → Emails → Templates:** paste the ready-made templates from
  [`email-templates/`](./email-templates/) — `magic-link.html` into **"Magic link or OTP"** and
  `confirm-signup.html` into **"Confirm sign up"**, and set the subject lines written at the top
  of each file. They use `{{ .ConfirmationURL }}` (a link), never `{{ .Token }}` (a code).

## D. Sign-in emails landing in spam

Gmail decides Primary / Promotions / Spam and **no setting forces "Primary"**. What you can do is
make spam placement unlikely.

**Free, do now**
- Use the templates in `email-templates/` (clear sender name, plain explanation, no tricks).
- The "Check your inbox" screen already tells people to look in Spam/Promotions and tap *Not spam*.
- Don't send large bursts from a brand-new sender; let volume grow gradually.

**The real fix: send from your own domain with a mail service**
Sending from a personal Gmail address to strangers is what Gmail distrusts. Instead:
1. Buy a domain (roughly $10–15 a year).
2. Create an account with a transactional email service (for example Resend or Brevo — check
   their current free limits) and add your domain there.
3. Add the DNS records they give you at your domain registrar: **SPF** and **DKIM**, plus a
   **DMARC** record such as `v=DMARC1; p=none`. Wait until the service shows the domain as verified.
4. Supabase → **Project Settings → Authentication → SMTP Settings**: replace the Gmail details
   with the service's host, port, username and password. Sender address: `no-reply@yourdomain.com`.
5. Check it: send yourself a sign-in email, open it in Gmail → **⋮ → Show original**: SPF, DKIM
   and DMARC should all say **PASS**. You can also score it at mail-tester.com.

Mail that passes all three, from a domain with a clean history, normally reaches the inbox; Gmail
may still file it under Updates. The weekly digest uses the same sender, so fixing this helps both.

## E. Vercel

- Framework Preset: **Vite**.
- Root Directory: **empty** (the repo root is the project).
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## F. Admin moderation (removing unwanted or adult uploads)

Admins get a **Moderation** item in the sidebar (**Admin** tab on phones). It has four tabs:

- **Reports** — every open report with the picture, reason and reporter. Buttons: *Remove artwork*
  or *Dismiss*.
- **Verification** — members asking for the verified badge (see section J).
- **Latest uploads** — the 40 newest pieces with a *Remove* button, so you can catch problems
  without waiting for someone to report them.
- **Removal log** — who removed what, and why.

You can also open any piece and use **Remove (admin)** on its page. Every removal asks for a
reason, writes a log entry, deletes the artwork and deletes its image files from storage.

Notes:
- Removal is manual — there is no automatic image scanning. Check *Latest uploads* regularly.
- Only accounts with `is_admin = true` can do this; the database enforces it and users cannot
  grant it to themselves. To add or remove an admin, use the SQL Editor:
  `update profiles set is_admin = true|false where username = '…';`
- Backup way: Supabase → Table Editor → `works` → delete the row.

## G. Notification emails (one summary a day, plus instant report alerts)

**What members get.** Likes, comments, follows and shares always appear instantly under
**Notifications** in the app. By email they get **one summary per day**, and only on days when
something happened — never one email per like or comment. It names who did what (for comments it
includes what they wrote) and groups likes per piece ("“Sunrise” — liked by Ana, Raj and 3
others"). **Views are never emailed.** Each person chooses what the summary includes in
**Settings → Include in my daily summary email**.

**What admins get.** The moment someone reports a piece, the admins get an email with the
picture, the reason, the details and **who reported**. The artist is **not** emailed and is
**never told who reported**. To send artists a neutral "being reviewed" notice (no reporter name),
set `OWNER_REPORT_NOTICE=true`.

**How it works.** Vercel runs `/api/daily-activity` once a day (03:30 UTC, 09:00 IST — set in
`vercel.json`; the Hobby plan allows one run a day, at some point within that hour). It gathers
each person's not-yet-emailed notifications from the last 36 hours, sends one email each, and marks
them as sent. If an email fails it is retried the next day. Reports use `/api/notify`, called by a
database trigger.

**Setup — once**
1. Run [`migration-batch-4.sql`](./migration-batch-4.sql), then [`migration-batch-6.sql`](./migration-batch-6.sql)
   (batch 6 switches off the old one-email-per-event trigger — run it even if you set up batch 4
   earlier). If a notice mentions `pg_net`, enable it at Supabase → **Database → Extensions →
   pg_net** and run batch 4 again.
2. Vercel → your project → **Settings → Environment Variables**. Add (tick Production, Preview and
   Development):

   | Name | Value |
   |---|---|
   | `CRON_SECRET` | a long random string you make up (Vercel sends it to the daily job) |
   | `NOTIFY_SECRET` | another long random string (used for report alerts and manual tests) |
   | `SUPABASE_URL` | your Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → **service_role** key |
   | `SMTP_USER` | the sending address, e.g. your Gmail address |
   | `SMTP_PASS` | the Google App Password (16 characters, no spaces) |
   | `SITE_URL` | your live address, e.g. `https://signature-gray.vercel.app` |

   Optional: `SMTP_HOST` (default `smtp.gmail.com`), `SMTP_PORT` (default `465`), `MAIL_FROM`
   (e.g. `Signature <no-reply@yourdomain.com>`), `ADMIN_EMAIL`, `OWNER_REPORT_NOTICE`,
   `DAILY_MAX_EMAILS` (default 200 a day), `DAILY_WINDOW_HOURS` (default 36).

   **Do not** start any of these names with `VITE_` — those are published in the website's code.
3. Vercel → **Deployments → ⋯ → Redeploy**. Variables and the schedule only apply to new
   deployments, and cron jobs run only on the **Production** deployment.
4. For the report alerts, run this once in the SQL Editor with your address and the same
   `NOTIFY_SECRET`:
   ```sql
   insert into app_settings (key, value) values
     ('notify_url',    'https://signature-gray.vercel.app/api/notify'),
     ('notify_secret', 'THE-SAME-NOTIFY_SECRET')
   on conflict (key) do update set value = excluded.value;
   ```
5. Test the email path (Windows PowerShell):
   ```powershell
   Invoke-RestMethod -Method Post -Uri "https://signature-gray.vercel.app/api/notify" `
     -Headers @{ "x-notify-secret" = "YOUR_NOTIFY_SECRET" } `
     -ContentType "application/json" -Body '{"kind":"test","to":"you@gmail.com"}'
   ```
   You should see `sent : True` and receive a test email.
6. Test the daily summary without waiting a day. From a second account, like or comment on one of
   your pieces, then **see who would get an email** (sends nothing):
   ```powershell
   Invoke-RestMethod -Method Post -Uri "https://signature-gray.vercel.app/api/daily-activity?dry=1" `
     -Headers @{ "x-notify-secret" = "YOUR_NOTIFY_SECRET" }
   ```
   `wouldEmail : 1` means it found activity. Run it without `?dry=1` to actually send the summary.
   Vercel → your project → **Settings → Cron Jobs** shows the schedule and lets you run it now.

**If nothing arrives**
- `wouldEmail : 0` → no new activity, the person turned those emails off, or the activity is
  older than 36 hours or was already emailed.
- `401` the secret doesn't match; `500` a variable is missing (the message names it) or SMTP
  was refused. Vercel → **Logs** shows what the function printed.
- Reports: `select id, status_code, error_msg, created from net._http_response order by created desc limit 10;`
  (`200` good, `401` secret mismatch, `404` wrong URL, `500` a Vercel variable or SMTP problem).
- To switch report alerts off: `delete from app_settings where key in ('notify_url','notify_secret');`

Sending from a personal Gmail is fine for a small start. For inbox placement use your own domain
with a mail service (section D) — just change `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
and `MAIL_FROM` in Vercel.

## H. AI first-pass critique (optional)

**What it does.** On a piece marked *Critique requested*, the artist can get a written first-pass
critique from an AI: what's working and one thing to try, for composition, colour, technique and
emotional impact, plus a short summary and questions to ask human reviewers. It appears as a
clearly labelled card above the human comments, is included in "Download critique summary",
and the artist can write a new one or remove it. There are **no scores or grades**.

At upload there is an "Also get an AI first-pass critique" box (ticked by default, only shown
when *Critique requested* is on). On an existing piece, the owner sees a **Get AI critique** button.

**It is not free.** It uses Anthropic's paid API, billed per use (about 1–3 thousand tokens of
image plus a short answer for each critique). The site works fine without it: until you add a
key, the button just says AI critique isn't switched on yet. Built-in limits:
- **5 critiques per artist per day** (`AI_CRITIQUES_PER_USER_PER_DAY`)
- **100 per day across the whole site** (`AI_CRITIQUES_PER_DAY`)
- a failed attempt doesn't count, but one where the AI answered and the answer was unusable does
  (that is what caps your bill)

**Setup — once**
1. Run [`migration-batch-5.sql`](./migration-batch-5.sql).
2. Create an account at console.anthropic.com, add billing, create an API key, and **set a
   monthly spend limit** in the console's billing/limits settings so a surprise can't happen.
   Check Anthropic's pricing page for current rates.
3. Vercel → **Settings → Environment Variables** → add `ANTHROPIC_API_KEY` (the key). Also make
   sure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exist (section G uses the same ones).
   **Never** name it with a `VITE_` prefix — that would publish your key in the website's code.
   Optional: `ANTHROPIC_MODEL` (default `claude-haiku-4-5-20251001`, a low-cost model),
   `AI_CRITIQUES_PER_USER_PER_DAY`, `AI_CRITIQUES_PER_DAY`.
4. **Redeploy** (Deployments → ⋯ → Redeploy).
5. Check the key and model work (PowerShell; the secret is your `NOTIFY_SECRET` from section G):
   ```powershell
   Invoke-RestMethod -Method Post -Uri "https://signature-gray.vercel.app/api/ai-critique" `
     -Headers @{ "x-notify-secret" = "YOUR_NOTIFY_SECRET" } `
     -ContentType "application/json" -Body '{"kind":"ping"}'
   ```
   `ok : True` means it works. If it fails, the reply shows Anthropic's status: `401` wrong key,
   `404` wrong model name, `400` the model needs different settings, `429` out of credit or rate
   limited.
6. Real test: mark one of your pieces *Critique requested* and press **Get AI critique**.

**How it works (so you know what is sent).** The browser sends only the piece's id. Your server
checks the person is signed in and owns the piece, applies the daily limits, downloads the stored
image, shrinks it to at most 1568 px (smaller and cheaper, and keeps it under the API's 5 MB
image limit), and sends that copy, plus the title, category, medium, tags and description, to
Anthropic. Nothing is sent unless the artist asks. The Privacy Policy says this.

**Quality and the model.** The default is a low-cost model. For richer critiques set
`ANTHROPIC_MODEL=claude-sonnet-5-5`, which costs more per critique. Newer models can need
different request settings, so run the ping test after changing it.

**See what you've used** (SQL Editor):
```sql
select date_trunc('day', created_at) as day, count(*) as critiques,
       sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens
from ai_usage group by 1 order by 1 desc limit 14;
```

**Honest limits.** AI critique can be wrong or generic, and it is labelled so. It can't judge
things it can't see (scale, texture, the original's colours). It declines some images; the artist
then sees "The AI couldn't review this image."

## I. Weekly "Fresh Eyes" digest (optional)

The digest is an opt-in email (Settings → "Weekly Fresh Eyes email"). It runs as a GitHub
Action, not on Vercel, so it needs secrets stored in GitHub.

1. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**. Add:
   | Secret | Value |
   |---|---|
   | `SUPABASE_URL` | your Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → **service_role** key |
   | `GMAIL_USER` | the address that sends mail |
   | `GMAIL_APP_PASSWORD` | the 16-character Google App Password |
   | `SITE_URL` | your live URL, e.g. `https://signature-gray.vercel.app` |
2. **The service_role key is a master key.** Only ever put it in GitHub secrets (here) or as a
   normal *server* variable on Vercel (section G) — never in `.env`, never in a variable that
   starts with `VITE_` (those get published inside the website's code), never in a screenshot or chat.
3. Test it: GitHub → **Actions → Weekly Fresh Eyes digest → Run workflow** with *Dry run*
   ticked. The log lists who would be emailed. Untick it to send for real.
4. It then runs by itself every Monday at 09:00 IST. Gmail allows roughly 500 emails a day;
   the script stops at 400. GitHub pauses scheduled workflows in a repo with no activity for
   60 days — push any commit to wake it.

## J. Approving verification requests

**Who can request it:** any member, from **Settings → Get verified** (a note plus an optional
link — no ID documents are collected). It works from every account, once
`migration-batch-2.sql` has been run.

**Who sees the requests:** the **admin account(s)**. Admin is not a separate login; it is a normal
account you mark as admin once, in the Supabase SQL Editor (copy the handle shown under the name
in the sidebar, exactly):
```sql
update profiles set is_admin = true where username = 'your_username';
```
Pick the account you personally use to run the site. For example, make your main account the
admin and request verification from your second account to test it. You can have several admins.

**To review:** sign in with the admin account → **Moderation** in the sidebar (**Admin** on a
phone) → **Verification** tab. Each request shows the person's name, @username, their note and
link, and a link to their profile and work. Press **Approve** (the badge appears next to their
name everywhere) or **Decline** (they can send a new request).

To remove a badge later: `update profiles set verified = false where username = '…';`

If you get *"Could not find the table 'public.verification_requests' in the schema cache"*, run
`migration-batch-2.sql`; if Approve does nothing or errors, run `migration-batch-3.sql`.

## K. What members can do (quick reference)

- **Upload one piece** — with optional process shots (Studio Log) and a Growth Thread.
- **Process shots** — add them when uploading (left column, "Studio Log") or any time later:
  open your piece → **Add process shots**, or **Edit**. Cards that have them show a **PROCESS**
  badge. Open one and swipe, press ← →, or tap the thumbnails along the bottom.
  *If you added shots but see no swipe:* Supabase → Table Editor → `work_steps` should have rows
  for that piece. If the table is missing, run `migration-batch-2.sql`, then add the shots again
  through **Edit**.
- **Upload several at once** — the "Several at once" tab takes up to 20 images. Category, tags,
  description and medium are shared; each image has its own title. Three upload at a time; if
  some fail you can retry just those.
- **AI first-pass critique** — on a piece that asks for critique, from the upload box or the
  **Get AI critique** button (the artist only; a few a day).
- **Download** — artists tick "Let others download the full-resolution file" (on upload or in
  Edit). The Download button then appears for everyone; owners can always download their own work.
- **Explore filters** — category, *Critique requested*, posted *Today / This week / This month*,
  and sort by Latest, Oldest, Most viewed, Most liked, Most discussed, or Title A–Z.

## L. Pre-launch checklist

- [ ] Confirm email is ON
- [ ] Site URL + Redirect URLs point at the live domain, not localhost
- [ ] "Magic link or OTP" and "Confirm sign up" templates pasted from `email-templates/`
- [ ] Email sender set up (own domain + SPF/DKIM/DMARC if possible — section D)
- [ ] `migration-batch-2.sql`, `-3`, `-4`, `-5` and `-6` have been run (no "schema cache" errors anywhere)
- [ ] You are an admin and can open Moderation
- [ ] Request verification from a second account, approve it from the admin account, and see the badge
- [ ] AI critique: key added, spend limit set, redeployed, ping test shows `ok : True`
- [ ] Notification emails: Vercel variables added, redeployed, `app_settings` filled in, PowerShell test email received
- [ ] Vercel: Framework Preset = Vite, Root Directory empty, builds on Node 24
- [ ] Sign up as a brand-new user on the live site end to end
- [ ] Upload 3–4 images with the "Several at once" tab
- [ ] Add 2 process shots to a piece and swipe through them
- [ ] Tick "Let others download" on a piece, then download it from a private window
- [ ] Open a shared link (`…/?work=<id>`) in a private window
- [ ] Check it on a phone and a tablet
- [ ] Storage headroom: Supabase free tier is 1 GB of files — bulk uploads use it faster
