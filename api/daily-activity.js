// /api/daily-activity — sends ONE summary email per person per day, only if something happened.
//
// Called once a day by Vercel Cron (see "crons" in vercel.json). You can also run it by hand:
//   POST with header  x-notify-secret: <NOTIFY_SECRET>   (add  ?dry=1  to only see who WOULD get one)
//
// What is included: new followers, comments (with what was written), likes, shares.
// What is never included: views. People can switch each type off in Settings.
//
// Server-side only. Needs (names WITHOUT the VITE_ prefix):
//   CRON_SECRET or NOTIFY_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SMTP_USER, SMTP_PASS, SITE_URL
// Optional: SMTP_HOST, SMTP_PORT, MAIL_FROM, DAILY_MAX_EMAILS (default 200), DAILY_WINDOW_HOURS (default 36)

import { createClient } from "@supabase/supabase-js";
import { buildDailySummaryEmail } from "./_lib/emails.js";
import { makeDb as makeBaseDb, makeSender, safeEqual, unwrap } from "./notify.js";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SMTP_USER", "SMTP_PASS", "SITE_URL"];
const TYPES = ["follow", "comment", "like", "share"];
const TYPE_TO_PREF = { follow: "email_follows", comment: "email_comments", like: "email_likes", share: "email_shares" };
const HOUR = 60 * 60 * 1000;

const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* Database access                                                     */
/* ------------------------------------------------------------------ */

export function makeDailyDb(supabase) {
  const base = makeBaseDb(supabase);
  const inChunks = async (ids, run) => {
    const out = [];
    for (const part of chunk([...new Set(ids.filter(Boolean))], 100)) out.push(...((await run(part)) || []));
    return out;
  };
  return {
    getEmail: base.getEmail,
    // Notifications nobody has been emailed about yet. (comment_id only exists after migration 6.)
    async getUnsent(sinceIso) {
      const build = (columns) =>
        supabase.from("notifications").select(columns).is("emailed_at", null).in("type", TYPES).gte("created_at", sinceIso).order("created_at", { ascending: true }).limit(5000);
      let { data, error } = await build("id, recipient_id, actor_id, type, work_id, comment_id, created_at");
      if (error && /comment_id/i.test(error.message || "")) {
        ({ data, error } = await build("id, recipient_id, actor_id, type, work_id, created_at"));
      }
      if (error) throw new Error(error.message);
      return data || [];
    },
    getProfiles: (ids) => inChunks(ids, (part) => unwrap(supabase.from("profiles").select("*").in("id", part))),
    getWorks: (ids) => inChunks(ids, (part) => unwrap(supabase.from("works").select("id, title").in("id", part))),
    getComments: (ids) => inChunks(ids, (part) => unwrap(supabase.from("comments").select("id, text, is_critique").in("id", part))),
    async markEmailed(ids) {
      const stamp = new Date().toISOString();
      for (const part of chunk(ids, 100)) {
        const { error } = await supabase.from("notifications").update({ emailed_at: stamp }).in("id", part);
        if (error) throw new Error(error.message);
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* The job                                                             */
/* ------------------------------------------------------------------ */

export function createDailyHandler({ db, send, env, now = () => Date.now(), pause = sleep }) {
  const siteUrl = String(env.SITE_URL || "").replace(/\/+$/, "");
  const maxEmails = Number(env.DAILY_MAX_EMAILS || 200);
  const windowMs = Number(env.DAILY_WINDOW_HOURS || 36) * HOUR;

  async function run({ dry }) {
    const unsent = await db.getUnsent(new Date(now() - windowMs).toISOString());
    if (unsent.length === 0) return { people: 0, sent: 0, note: "nothing new to email" };

    const byRecipient = new Map();
    for (const n of unsent) {
      if (!byRecipient.has(n.recipient_id)) byRecipient.set(n.recipient_id, []);
      byRecipient.get(n.recipient_id).push(n);
    }

    const [profiles, works, comments] = await Promise.all([
      db.getProfiles([...byRecipient.keys(), ...unsent.map((n) => n.actor_id)]),
      db.getWorks(unsent.map((n) => n.work_id)),
      db.getComments(unsent.map((n) => n.comment_id)),
    ]);
    const profileById = new Map(profiles.map((p) => [p.id, p]));
    const workById = new Map(works.map((w) => [w.id, w]));
    const commentById = new Map(comments.map((c) => [c.id, c]));
    const nameOf = (id) => profileById.get(id)?.name || "Someone";

    let people = 0;
    let sent = 0;
    let failed = 0;
    for (const [recipientId, rows] of byRecipient) {
      const recipient = profileById.get(recipientId);
      if (!recipient) continue;
      // keep only what this person wants emailed (a missing preference column means "yes")
      const wanted = rows.filter((n) => recipient[TYPE_TO_PREF[n.type]] !== false);

      const followers = new Set();
      const likes = new Map();
      const shares = new Map();
      const commentList = [];
      for (const n of wanted) {
        const actor = nameOf(n.actor_id);
        if (n.type === "follow") followers.add(actor);
        else if (n.type === "like" || n.type === "share") {
          const target = n.type === "like" ? likes : shares;
          if (!target.has(n.work_id)) target.set(n.work_id, new Set());
          target.get(n.work_id).add(actor); // the same person liking twice counts once
        } else if (n.type === "comment") {
          const c = commentById.get(n.comment_id);
          commentList.push({ title: workById.get(n.work_id)?.title || "your artwork", workId: n.work_id, name: actor, text: c?.text || "", isCritique: !!c?.is_critique });
        }
      }
      const asRows = (map) => [...map].map(([workId, names]) => ({ workId, title: workById.get(workId)?.title || "your artwork", names: [...names] }));
      const summary = { followers: [...followers], comments: commentList, likes: asRows(likes), shares: asRows(shares) };
      if (summary.followers.length + summary.comments.length + summary.likes.length + summary.shares.length === 0) continue;

      const to = await db.getEmail(recipientId);
      if (!to) continue;
      people++;
      if (dry) continue;
      if (sent >= maxEmails) break; // the rest stay unsent and go out tomorrow (they are still inside the window)
      try {
        await send({ to, ...buildDailySummaryEmail({ recipientName: recipient.name, summary, siteUrl }) });
        await db.markEmailed(wanted.map((n) => n.id));
        sent++;
        await pause(300);
      } catch (err) {
        failed++;
        console.error("daily summary failed for one person:", err.message); // they stay unsent and are retried tomorrow
      }
    }
    return dry ? { dry: true, wouldEmail: people } : { people, sent, failed };
  }

  return async function handler(req, res) {
    if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });

    // Vercel Cron sends:  Authorization: Bearer <CRON_SECRET>.  By hand you can use x-notify-secret.
    if (!env.CRON_SECRET && !env.NOTIFY_SECRET) return res.status(500).json({ error: "Server not configured. Missing: CRON_SECRET (or NOTIFY_SECRET)" });
    const bearer = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
    const manual = req.headers?.["x-notify-secret"] || "";
    const allowed = (env.CRON_SECRET && bearer && safeEqual(bearer, env.CRON_SECRET)) || (env.NOTIFY_SECRET && manual && safeEqual(manual, env.NOTIFY_SECRET));
    if (!allowed) return res.status(401).json({ error: "unauthorized" });

    const missing = REQUIRED_ENV.filter((key) => !env[key]);
    if (missing.length > 0) return res.status(500).json({ error: `Server not configured. Missing: ${missing.join(", ")}` });

    try {
      const dry = req.query?.dry === "1" || req.body?.dry === true;
      return res.status(200).json(await run({ dry }));
    } catch (err) {
      console.error("daily-activity failed:", err);
      return res.status(500).json({ error: "daily summary failed" });
    }
  };
}

/* ------------------------------------------------------------------ */
/* Vercel entry point                                                  */
/* ------------------------------------------------------------------ */

let cached;
export default async function handler(req, res) {
  if (!cached) {
    const env = process.env;
    const ready = REQUIRED_ENV.every((key) => env[key]);
    cached = ready
      ? createDailyHandler({ db: makeDailyDb(createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })), send: makeSender(env), env })
      : createDailyHandler({ db: null, send: null, env });
  }
  return cached(req, res);
}
