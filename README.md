<div align="center">

# Signature

**A quiet, high-fidelity gallery for illustrators, photographers, painters, and sketch artists.**

No ads. No algorithm. No paywalls. Just the work — and the feedback that makes it better.

</div>

---

## About

Signature is a free portfolio and community platform for artists who want their work seen without the noise of algorithmic feeds. Its core idea: **critique should be visible, structured, and proven to work.** Artists can flag a piece as *Critique Requested*, show the process behind it, and later link a new piece to the earlier one it improves on — so the platform shows feedback turning into better work.

Built with React, Vite, and Supabase. Deployed on Vercel. Runs on free tiers.

## What makes it different

- **Critique Requested** — flag a piece for honest feedback; critique comments are visually distinct and exportable as a text summary.
- **AI first-pass critique** — on a critique-requested piece, a clearly labelled AI card (composition, colour, technique, emotional impact — words only, no scores) appears above the human comments. Optional, artist-triggered, capped per day.
- **Growth Threads** — link a new piece to the earlier one it builds on. The page shows before/after, what changed, and the critique that shaped it.
- **Studio Log** — attach up to 4 process shots (sketch → linework → colour) to a finished piece; viewers swipe through the sequence.
- **Verified artists** — a hand-reviewed badge based on proof of process. No ID documents are ever collected.
- **Non-algorithmic discovery** — chronological feeds; follow artists *and tags*.

## Features

- Passwordless sign-in with a one-click email link
- Masonry gallery that keeps every image's true proportions
- Explore and Following feeds, category filters, search, recent/popular sort
- Public profiles with follower counts and total views/likes
- Notifications for likes, comments, and follows
- Collections — select multiple works on your profile and add them in one go
- Edit, delete, and share (links open straight to the piece)
- Opt-in weekly "Fresh Eyes" email digest of pieces asking for critique
- Upload one piece, or up to 20 at once with shared tags and per-image titles
- Artist-controlled downloads — full-resolution files only when the artist allows it
- Explore filters: category, critique-requested only, posted today/week/month; sort by latest, oldest, most viewed, most liked, most discussed, or title
- Admin moderation: review reports, approve or decline verification requests, scan the latest uploads, remove any piece (with a logged reason)
- Reporting for moderation, plus Privacy Policy and Terms pages
- One summary email a day (only when something happened) about follows, comments, likes and shares — views are never emailed, each type can be turned off — plus instant report alerts to admins; the artist is never told who reported
- Process shots show a PROCESS badge on feed cards; swipe, use the arrow keys, or tap thumbnails; add them later from Edit
- Responsive: desktop sidebar, phone bottom navigation, tablet layout

## Design

Colour system (60 / 30 / 10): **Sky Blue `#0593C6`** is the canvas, **White `#FCFFFF`** is every panel and card, **Hot Pink `#D83995`** is the accent for actions and highlights. Everything is driven by CSS variables in `GlobalStyle` (`src/App.jsx`), so the palette can be changed in one place. Type is **Plus Jakarta Sans** with **Playfair Display italic** for accent words, both self-hosted through `@fontsource` (no Google Fonts request). The landing page lives in `src/Landing.jsx`: parallax hero, glass cards, scroll reveals, a before/after slider, and `prefers-reduced-motion` support.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite |
| Auth, database, storage | [Supabase](https://supabase.com) (Postgres + Row Level Security) |
| Hosting | [Vercel](https://vercel.com) |
| Email | Gmail SMTP (sign-in links and the weekly digest) |
| Server functions | Vercel serverless functions: `api/notify.js` (instant report alerts), `api/daily-activity.js` (the daily summary email), `api/ai-critique.js` (AI critique via Anthropic's API, image shrunk with `sharp`) |
| Scheduled jobs | GitHub Actions (weekly digest) |

There is no always-on backend server. The browser talks to Supabase directly, protected by Row Level Security; the digest runs as a scheduled GitHub Action.

## Getting started

```bash
git clone https://github.com/imAryanSingh/Signature.git
cd Signature
npm install
cp .env.example .env     # then fill in your Supabase URL and anon key
npm run dev
```

1. Create a free Supabase project.
2. Run [`supabase-schema.sql`](./supabase-schema.sql) in the SQL Editor (fresh install). For an existing project, run [`migration-batch-2.sql`](./migration-batch-2.sql) then [`migration-batch-3.sql`](./migration-batch-3.sql), [`-4`](./migration-batch-4.sql) and [`-5`](./migration-batch-5.sql) instead.
3. Follow [`SETUP.md`](./SETUP.md) for the magic-link email template, Gmail SMTP, Vercel deployment, the weekly digest, and the pre-launch checklist.

## Project structure

```
signature/
├── src/
│   ├── App.jsx                    # the whole app: components, pages, logic
│   ├── main.jsx                   # React entry point
│   └── supabaseClient.js          # Supabase client
├── api/notify.js                  # instant report alerts (Vercel function)
├── api/daily-activity.js          # daily summary email, run by Vercel Cron
├── api/ai-critique.js             # AI first-pass critique (Vercel function)
├── tests/notify.test.mjs          # run with: npm test
├── scripts/fresh-eyes-digest.mjs  # weekly digest email job
├── .github/workflows/             # schedule for the digest
├── supabase-schema.sql            # full schema for a fresh project
├── migration-batch-2.sql          # upgrade: Studio Log, Growth Threads, tags, verification
├── migration-batch-3.sql          # upgrade: admin moderation, download switch
├── migration-batch-4.sql          # upgrade: notification emails, preferences
├── migration-batch-5.sql          # upgrade: AI critique
├── migration-batch-6.sql          # upgrade: daily summary email
├── email-templates/               # paste-ready sign-in / confirm emails
├── SETUP.md                       # detailed setup + launch checklist
└── vercel.json                    # SPA rewrite for client-side routing
```

## Database

| Table | Purpose |
|---|---|
| `profiles` | accounts (extends Supabase auth); `verified`, `is_admin`, `digest_opt_in` |
| `works` | published artwork; `allow_download`, `critique_requested` |
| `work_steps` | process shots attached to a work |
| `growth_threads` | links a work to the earlier work it improves on |
| `likes`, `comments`, `follows` | social graph (comments carry a critique flag) |
| `tag_follows` | tags a user follows (private) |
| `collections` | private groupings of a user's work |
| `notifications` | likes/comments/follows, created by triggers |
| `reports` | flagged content for moderation |
| `verification_requests` | pending/approved/rejected badge requests |
| `moderation_log` | admin removals and their reasons |
| `app_settings` | private settings (notification function URL + secret); no app access |
| `ai_critiques` | one AI first-pass critique per piece (readable by all, written only by the server) |
| `ai_usage` | private usage log that powers the AI daily limits; no app access |

Every table uses Row Level Security. Users can only change their own data. The `verified` and `is_admin` flags are protected by a trigger, so nobody can grant them to themselves; admins can remove any artwork through RLS policies that check `is_admin()`.

## License

Free to use, modify, and self-host. No license restrictions currently specified — ask before redistributing commercially.

---

<div align="center">

Made for artists, not for advertisers.

</div>
