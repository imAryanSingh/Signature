# Signature — setup, upgrade & launch checklist

Quick overview lives in [README.md](./README.md). This file is the step-by-step.

---

## A. Upgrading your live site (existing project) — do this in order

1. **Run the database migration first.**
   Supabase → **SQL Editor** → **New query** → paste all of
   [`migration-batch-2.sql`](./migration-batch-2.sql) → **Run**.
   It is safe to run more than once. (If you deploy the new code first, the feed still
   works, but verified badges, process shots, Growth Threads, tag following and the
   view counter won't until you run it.)
2. **Replace your project files** with this version and push:
   ```
   git add .
   git commit -m "Studio Log, Growth Threads, tag following, verification, digest, collections"
   git push
   ```
   Vercel redeploys on its own.
3. **Node version:** `package.json` now pins `"engines": { "node": "24.x" }`, so Vercel
   builds on Node 24 automatically (Node 20 builds stop working on **1 Oct 2026**).
   If a build ever complains, also set Vercel → Settings → General → Node.js Version → 24.x.
4. Hard-refresh the live site (Ctrl+Shift+R; on a phone, close and reopen the tab).

## B. Fresh install

1. Create a Supabase project, then run [`supabase-schema.sql`](./supabase-schema.sql) once in the SQL Editor.
2. Copy `.env.example` to `.env` and fill in your Project URL and anon key
   (Supabase → Project Settings → API).
3. `npm install` then `npm run dev`.

## C. Supabase auth settings (one time)

- **Authentication → Providers → Email:** enabled, **Confirm email** ON.
- **Authentication → URL Configuration:** Site URL = your live URL
  (e.g. `https://signature-gray.vercel.app`). Add the same URL, with `/**`, under Redirect URLs.
  Add `http://localhost:5173/**` too if you test locally.
- **Authentication → Emails → Templates → "Magic link or OTP":** the body must contain a link,
  not a code:
  ```html
  <h2>Your sign-in link</h2>
  <p>Click below to sign in. This link expires shortly and can only be used once.</p>
  <p><a href="{{ .ConfirmationURL }}">Sign in to Signature</a></p>
  ```
  Do the same for **Confirm sign up**.
- **Project Settings → Authentication → SMTP Settings** (recommended): your Gmail address,
  host `smtp.gmail.com`, port `587`, and a Google **App Password** (needs 2-Step Verification).

## D. Vercel

- Framework Preset: **Vite**.
- Root Directory: **empty** (the repo root is the project).
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## E. Weekly "Fresh Eyes" digest (optional)

The digest is an opt-in email (Settings → "Weekly Fresh Eyes email"). It runs as a GitHub
Action, not on Vercel, so it needs secrets stored in GitHub.

1. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**. Add:
   | Secret | Value |
   |---|---|
   | `SUPABASE_URL` | your Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → **service_role** key |
   | `GMAIL_USER` | the Gmail address that sends mail |
   | `GMAIL_APP_PASSWORD` | the 16-character Google App Password |
   | `SITE_URL` | your live URL, e.g. `https://signature-gray.vercel.app` |
2. **The service_role key is a master key.** Only ever put it in GitHub secrets. Never in
   `.env`, never in Vercel, never in the frontend, never in a screenshot or chat.
3. Test it: GitHub → **Actions → Weekly Fresh Eyes digest → Run workflow** with *Dry run*
   ticked. The log lists who would be emailed. Untick it to send for real.
4. It then runs by itself every Monday at 09:00 IST. Gmail limits sending to roughly 500
   emails a day; the script stops at 400. GitHub pauses scheduled workflows in a repo with
   no activity for 60 days — push any commit to wake it.

## F. Approving verification requests

Members request the badge in Settings → "Get verified" (a note plus an optional link —
no ID documents are collected).

1. Supabase → Table Editor → `verification_requests` → read the pending ones.
2. To approve, run in the SQL Editor (replace the username):
   ```sql
   update profiles set verified = true where username = 'their_username';
   update verification_requests set status = 'approved'
     where user_id = (select id from profiles where username = 'their_username');
   ```
3. To decline: `update verification_requests set status = 'rejected' where id = '…';`
4. To remove a badge: `update profiles set verified = false where username = '…';`

Members cannot give themselves the badge — a database trigger blocks it.

## G. Moderation

Reports land in the `reports` table (Table Editor). Review it regularly. To remove a piece,
delete the row in `works`.

## H. Pre-launch checklist

- [ ] Confirm email is ON
- [ ] Site URL + Redirect URLs point at the live domain, not localhost
- [ ] "Magic link or OTP" and "Confirm sign up" templates use `{{ .ConfirmationURL }}`
- [ ] Gmail SMTP connected
- [ ] `migration-batch-2.sql` has been run
- [ ] Vercel: Framework Preset = Vite, Root Directory empty, builds on Node 24
- [ ] Sign up as a brand-new user on the live site end to end
- [ ] Upload a piece with process shots; link a second piece to it as a Growth Thread
- [ ] Open a shared link (`…/?work=<id>`) in a private window
- [ ] Check it on a phone and a tablet
- [ ] Storage headroom: Supabase free tier is 1 GB of files — fine for ~100 members
