# Signature — setup guide

## 🚀 This checkpoint — what's new and what to do

This build adds: Privacy Policy + Terms of Service pages, and a Report
button on every artwork (with a `reports` table for moderation). Combined
with everything from before (OTP-free magic link login, masonry grid,
working Popular sort, real Following feed, public profiles, notifications,
edit/delete, share, critique mode), this is meant to be launch-ready for
public signups.

### If you're updating an existing Supabase project (not starting fresh)

Run just this in Supabase → SQL Editor (safe to run once, adds the reports
table without touching anything else):

```sql
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references profiles(id) on delete cascade not null,
  work_id uuid references works(id) on delete cascade not null,
  reason text not null,
  details text default '',
  status text not null default 'pending',
  created_at timestamptz default now()
);

alter table reports enable row level security;

drop policy if exists "Users can view their own reports" on reports;
create policy "Users can view their own reports" on reports for select using (auth.uid() = reporter_id);

drop policy if exists "Users can submit reports" on reports;
create policy "Users can submit reports" on reports for insert with check (auth.uid() = reporter_id);
```

Then replace your `src/App.jsx` with the one in this zip, and redeploy (push
to GitHub — Vercel redeploys automatically).

### If you're starting fresh

Just run the full `supabase-schema.sql` once — it already includes the
reports table.

## ✅ Pre-launch checklist (public launch, 100 users)

Go through these in order. Check off each before opening signups widely.

1. **Confirm email is ON** — Supabase → Authentication → Providers → Email
   → "Confirm email" toggled on. Stops fake/bot signups.
2. **Site URL is your live domain, not localhost** — Supabase →
   Authentication → URL Configuration → Site URL set to your real
   `.vercel.app` (or custom domain) URL. Also add it under Redirect URLs.
3. **Magic Link email template uses `{{ .ConfirmationURL }}`** — Supabase →
   Authentication → Emails → Templates → "Magic link or OTP" — body should
   contain a link, not `{{ .Token }}`.
4. **Gmail SMTP connected** — Supabase → Project Settings → Authentication →
   SMTP Settings — so sign-in emails send reliably instead of hitting
   Supabase's shared rate limit.
5. **Privacy Policy + Terms live** — included in this checkpoint, linked
   from the landing page footer and the sign-up form.
6. **Report button live** — included in this checkpoint, visible on any
   artwork you didn't post yourself.
7. **Review reports periodically** — Supabase → Table Editor → `reports`
   table. No admin UI yet; check this table manually every so often, or ask
   me to build a simple admin view if volume grows.
8. **Framework Preset is Vite in Vercel** — Vercel → Settings → General →
   Framework Preset must say "Vite," not "Other," or builds fail.
9. **Storage headroom** — free Supabase tier gives 1GB image storage. Fine
   for ~100 users at reasonable upload sizes; keep an eye on it as you grow
   past that.

## 1. Create your Supabase project

1. Go to https://supabase.com → sign in with GitHub → "New project"
2. Name it `signature`, set a strong database password (save it), pick the closest region
3. Wait ~90 seconds for it to finish setting up

## 2. Run the database setup

1. In Supabase, open **SQL Editor** → **New query**
2. Open `supabase-schema.sql` from this project, copy all of it, paste it in
3. Click **Run**

This creates every table (profiles, works, likes, comments, follows,
collections, notifications, reports), the image storage bucket, all
security rules, and the automatic triggers that create profiles on signup
and notifications on likes/comments/follows.

## 3. Turn on Email OTP / Magic Link

Supabase → **Authentication** → **Providers** → **Email**:
- Make sure Email is enabled
- Set **Email OTP length** to `8` (matches the code input in the app — if you
  prefer 6, tell me and I'll adjust the app to match)
- Save

## 4. Send OTP emails from your own Gmail (recommended)

By default Supabase's shared email sender is rate-limited and can be
unreliable. To send from your own Gmail instead:

1. Turn on 2-Step Verification: https://myaccount.google.com/security
2. Generate an app password: https://myaccount.google.com/apppasswords
   (name it "Signature", copy the 16-character password)
3. Supabase → **Project Settings** → **Authentication** → **SMTP Settings** → **Enable Custom SMTP**
   - Sender email: your Gmail address
   - Sender name: Signature
   - Host: `smtp.gmail.com`
   - Port: `587`
   - Username: your Gmail address
   - Password: the 16-character app password (no spaces)
4. Save

5. Supabase → **Authentication** → **Emails** → **Templates** → **Magic Link**:
   edit the template body to include `{{ .Token }}` so it sends the numeric
   code instead of a clickable link, e.g.:
   ```html
   <h2>Your Signature code</h2>
   <p>Enter this code to sign in:</p>
   <h1>{{ .Token }}</h1>
   ```

## 5. Get your API keys

Supabase → **Project Settings** → **API** → copy the **Project URL** and the
**anon public** key.

## 6. Connect the code

Copy `.env.example` to a new file named `.env` in this same folder, and fill in:
```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

## 7. Run it locally

```
npm install
npm run dev
```
Open the printed localhost URL and test: create an account, upload art with
a title/description/category/tags, like/comment, follow another test
account, check notifications.

## 8. Deploy for free on Vercel

1. Push this project to a GitHub repo
2. https://vercel.com → sign in with GitHub → **Add New Project** → pick your repo
3. Add the same two environment variables from your `.env`
4. Click **Deploy**

You'll get a free `.vercel.app` URL. A custom domain later is optional
(~$10-15/year), not required to launch.

## Free tier limits

- Supabase: 500MB database, 1GB file storage, 50,000 monthly active users
- Vercel: 100GB bandwidth/month, unlimited deploys

## What's included in this build

- Passwordless email-code login (sign up and sign in both use OTP, no passwords stored)
- Explore feed: masonry grid (true image proportions, no cropping), category filters, search, working Recent/Popular sort
- Following feed, filtered by real follow relationships
- Public profile pages for any user — view works, follower count, total views/likes; Follow button when viewing someone else
- Real notifications for likes, comments, and follows, with an unread badge in the sidebar
- Upload requires title, description, category, and at least one tag
- Edit and delete your own published work
- Share button — copies a direct link to any artwork
- Critique Requested mode — flag a piece as open for structured feedback; comments can be marked as a critique and are visually highlighted

## Known gaps / good next steps

- Collections exist but works aren't yet assignable to them from the upload/edit flow
- No image compression yet — keep files reasonably sized to protect your free storage quota as more people join
- No moderation/reporting yet — worth adding before opening signups to strangers
