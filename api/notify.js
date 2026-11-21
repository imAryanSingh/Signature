// POST /api/notify — instant email alerts that must not wait a day:
//   • a report is filed → emails the admins (called by a database trigger via pg_net)
//   • {"kind":"test","to":"you@example.com"} → sends a test email (to check your SMTP setup)
//
// Likes, comments, follows and shares are NOT handled here any more: they are bundled into one
// summary email per person per day by api/daily-activity.js.
//
// Server-side only. Needs these Vercel environment variables (names WITHOUT the VITE_ prefix):
//   NOTIFY_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SMTP_USER, SMTP_PASS, SITE_URL
// Optional: SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 465), MAIL_FROM,
//   ADMIN_EMAIL, OWNER_REPORT_NOTICE=true

import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { buildReportEmail, buildOwnerReportNotice, buildTestEmail } from "./_lib/emails.js";

const REQUIRED_ENV = ["NOTIFY_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SMTP_USER", "SMTP_PASS", "SITE_URL"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ------------------------------------------------------------------ */
/* Database access + email sending (shared with the daily job)         */
/* ------------------------------------------------------------------ */

export async function unwrap(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}

export function makeDb(supabase) {
  return {
    getProfile: (id) => unwrap(supabase.from("profiles").select("*").eq("id", id).maybeSingle()),
    getWork: (id) => unwrap(supabase.from("works").select("id, title, image_url, user_id").eq("id", id).maybeSingle()),
    getReport: (id) => unwrap(supabase.from("reports").select("*").eq("id", id).maybeSingle()),
    getAdminProfiles: () => unwrap(supabase.from("profiles").select("id, name").eq("is_admin", true)),
    async getEmail(userId) {
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      if (error) throw new Error(error.message);
      return data?.user?.email || null;
    },
  };
}

export function makeSender(env) {
  let transporter;
  return async function send({ to, subject, html, text }) {
    if (!transporter) {
      const port = Number(env.SMTP_PORT || 465);
      transporter = nodemailer.createTransport({
        host: env.SMTP_HOST || "smtp.gmail.com",
        port,
        secure: port === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      });
    }
    await transporter.sendMail({ from: env.MAIL_FROM || `"Signature" <${env.SMTP_USER}>`, to, subject, html, text });
  };
}

/* ------------------------------------------------------------------ */
/* The request handler                                                 */
/* ------------------------------------------------------------------ */

export function createHandler({ db, send, env }) {
  const siteUrl = String(env.SITE_URL || "").replace(/\/+$/, "");

  async function handleReport(id) {
    const report = await db.getReport(id);
    if (!report) return { skipped: "report not found" };
    const work = await db.getWork(report.work_id);
    const reporter = await db.getProfile(report.reporter_id);
    const owner = work ? await db.getProfile(work.user_id) : null;

    const recipients = new Set();
    for (const admin of await db.getAdminProfiles()) {
      const email = await db.getEmail(admin.id);
      if (email) recipients.add(email);
    }
    if (env.ADMIN_EMAIL) recipients.add(env.ADMIN_EMAIL);

    let sent = 0;
    if (recipients.size > 0) {
      const mail = buildReportEmail({
        report,
        reporterName: reporter?.name,
        reporterUsername: reporter?.username,
        work,
        ownerName: owner?.name,
        ownerUsername: owner?.username,
        siteUrl,
      });
      await send({ to: Array.from(recipients).join(", "), ...mail });
      sent++;
    }

    // Optional, off by default. Never includes who reported.
    if (env.OWNER_REPORT_NOTICE === "true" && owner) {
      const to = await db.getEmail(owner.id);
      if (to) {
        await send({ to, ...buildOwnerReportNotice({ work, ownerName: owner.name, siteUrl }) });
        sent++;
      }
    }
    return sent > 0 ? { sent: true, emails: sent } : { skipped: "no admin email configured" };
  }

  return async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

    const missing = REQUIRED_ENV.filter((key) => !env[key]);
    if (missing.length > 0) return res.status(500).json({ error: `Server not configured. Missing: ${missing.join(", ")}` });

    const given = req.headers?.["x-notify-secret"] || "";
    if (!safeEqual(given, env.NOTIFY_SECRET)) return res.status(401).json({ error: "unauthorized" });

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "invalid JSON" }); }
    }
    const { kind, id, to } = body || {};

    try {
      if (kind === "test") {
        if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: "provide a valid `to` address" });
        await send({ to, ...buildTestEmail({ siteUrl }) });
        return res.status(200).json({ sent: true });
      }
      if (kind === "report") {
        if (!UUID.test(String(id))) return res.status(400).json({ error: "invalid id" });
        return res.status(200).json(await handleReport(id));
      }
      return res.status(400).json({ error: "unknown kind" });
    } catch (err) {
      console.error("notify failed:", err);
      return res.status(500).json({ error: "failed to send" });
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
    const missing = REQUIRED_ENV.filter((key) => !env[key]);
    cached =
      missing.length > 0
        ? createHandler({ db: null, send: null, env })
        : createHandler({
            db: makeDb(createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })),
            send: makeSender(env),
            env,
          });
  }
  return cached(req, res);
}
