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
- Reporting for moderation, plus Privacy Policy and Terms pages
- Responsive: desktop sidebar, phone bottom navigation, tablet layout

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite |
| Auth, database, storage | [Supabase](https://supabase.com) (Postgres + Row Level Security) |
| Hosting | [Vercel](https://vercel.com) |
| Email | Gmail SMTP (sign-in links and the weekly digest) |
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
2. Run [`supabase-schema.sql`](./supabase-schema.sql) in the SQL Editor (fresh install). For an existing project, run [`migration-batch-2.sql`](./migration-batch-2.sql) instead.
3. Follow [`SETUP.md`](./SETUP.md) for the magic-link email template, Gmail SMTP, Vercel deployment, the weekly digest, and the pre-launch checklist.

## Project structure

```
signature/
├── src/
│   ├── App.jsx                    # the whole app: components, pages, logic
│   ├── main.jsx                   # React entry point
│   └── supabaseClient.js          # Supabase client
├── scripts/fresh-eyes-digest.mjs  # weekly digest email job
├── .github/workflows/             # schedule for the digest
├── supabase-schema.sql            # full schema for a fresh project
├── migration-batch-2.sql          # upgrade for an existing project
├── SETUP.md                       # detailed setup + launch checklist
└── vercel.json                    # SPA rewrite for client-side routing
```

## Database

| Table | Purpose |
|---|---|
| `profiles` | accounts (extends Supabase auth); `verified`, `digest_opt_in` |
| `works` | published artwork |
| `work_steps` | process shots attached to a work |
| `growth_threads` | links a work to the earlier work it improves on |
| `likes`, `comments`, `follows` | social graph (comments carry a critique flag) |
| `tag_follows` | tags a user follows (private) |
| `collections` | private groupings of a user's work |
| `notifications` | likes/comments/follows, created by triggers |
| `reports` | flagged content for moderation |
| `verification_requests` | pending/approved/rejected badge requests |

Every table uses Row Level Security. Users can only change their own data, and the `verified` flag is protected by a trigger so nobody can grant it to themselves.

## License

Free to use, modify, and self-host. No license restrictions currently specified — ask before redistributing commercially.

---

<div align="center">

Made for artists, not for advertisers.

</div>
