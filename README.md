<div align="center">

# Signature

**A quiet, high-fidelity gallery for illustrators, photographers, painters, and sketch artists.**

No ads. No algorithm. No paywalls. Just the work.

</div>

---

## About

Signature is a free portfolio and community platform built for artists who want their work seen without the noise of algorithmic feeds and engagement-chasing. Publish artwork, follow other creators, and — uniquely — flag a piece as **"Critique Requested"** to invite honest, structured feedback instead of just likes.

Built with React, Vite, and Supabase. Deployed on Vercel. Runs entirely on free tiers.

## Features

- **Passwordless login** — sign in with a one-click magic link sent to your email, no password to remember
- **Masonry gallery** — every image keeps its true aspect ratio, no cropping
- **Explore & Following feeds** — filter by category, search by tag or artist, sort by recent or popular
- **Public artist profiles** — follower counts, total views/likes, a full gallery of someone's work
- **Critique Requested mode** — flag a piece as open for structured feedback; critique comments are visually distinct from regular ones
- **Real notifications** — likes, comments, and follows, with an unread badge
- **Edit, delete, and share** your own published work
- **Collections** — group your work into series or studies
- **Reporting** — flag content for review, with a `reports` table for moderation
- **Fully responsive** — desktop sidebar, mobile bottom nav, tablet-optimized layouts
- **Privacy Policy & Terms of Service** included

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite |
| Auth, database, storage | [Supabase](https://supabase.com) (Postgres + Row Level Security) |
| Hosting | [Vercel](https://vercel.com) |
| Email delivery | Gmail SMTP (optional, recommended over Supabase's default sender) |

No backend server to run or maintain — Supabase handles auth, the database, and file storage directly from the frontend.

## Getting started

### 1. Clone and install

\`\`\`bash
git clone https://github.com/imAryanSingh/Signature.git
cd Signature
npm install
\`\`\`

### 2. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com)
2. In the SQL Editor, run the contents of [\`supabase-schema.sql\`](./supabase-schema.sql) — this creates every table, the storage bucket, security policies, and automated triggers
3. Under **Authentication → Providers → Email**, enable email sign-in (magic link)
4. Under **Authentication → URL Configuration**, set your Site URL (use \`http://localhost:5173\` for local dev)

### 3. Configure environment variables

\`\`\`bash
cp .env.example .env
\`\`\`

Fill in your Supabase project URL and anon key (found under **Project Settings → API**):

\`\`\`
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
\`\`\`

### 4. Run locally

\`\`\`bash
npm run dev
\`\`\`

### 5. Deploy

Push to GitHub, then import the repo on [Vercel](https://vercel.com). Add the same two environment variables in the Vercel project settings, set the **Framework Preset to Vite**, and deploy. Update your Supabase Site URL to match your production domain afterward.

Full step-by-step instructions, including optional Gmail SMTP setup for reliable email delivery and a pre-launch checklist, are in [\`SETUP.md\`](./SETUP.md).

## Project structure

\`\`\`
signature/
├── src/
│   ├── App.jsx             # entire application — components, pages, logic
│   ├── main.jsx             # React entry point
│   └── supabaseClient.js    # Supabase client initialization
├── supabase-schema.sql      # full database schema, policies, and triggers
├── index.html
└── vercel.json               # SPA rewrite rule for client-side routing
\`\`\`

## Database schema

| Table | Purpose |
|---|---|
| \`profiles\` | user accounts (extends Supabase auth) |
| \`works\` | published artwork |
| \`likes\` | likes on works |
| \`comments\` | comments, with a critique flag |
| \`follows\` | follower relationships |
| \`collections\` | user-created groupings of work |
| \`notifications\` | likes/comments/follows, auto-generated via triggers |
| \`reports\` | flagged content for moderation |

All tables use Row Level Security — users can only modify their own data.

## Contributing

This is a personal/independent project, but issues and pull requests are welcome. If you spot a bug or have a feature idea, open an issue.

## License

Free to use, modify, and self-host. No license restrictions currently specified — ask before redistributing commercially.

---

<div align="center">

Made for artists, not for advertisers.

</div>
