# Signature — setup guide

This is a full rebuild containing everything built across the whole project:
passwordless email-code (OTP) login, masonry Explore grid, working Popular
sort, a real Following feed, public artist profiles, real notifications,
edit/delete on your own work, share links, and Critique Requested mode.
Everything runs on free tiers — Supabase (database, auth, storage) + Vercel
(hosting).

## 1. Create your Supabase project

1. Go to https://supabase.com → sign in with GitHub → "New project"
2. Name it `signature`, set a strong database password (save it), pick the closest region
3. Wait ~90 seconds for it to finish setting up

## 2. Run the database setup

1. In Supabase, open **SQL Editor** → **New query**
2. Open `supabase-schema.sql` from this project, copy all of it, paste it in
3. Click **Run**

This creates every table (profiles, works, likes, comments, follows,
collections, notifications), the image storage bucket, all security rules,
and the automatic triggers that create profiles on signup and notifications
on likes/comments/follows.

## 3. Turn on Email OTP

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
