// Weekly "Fresh Eyes" digest — emails opted-in users a short list of recent
// pieces that are asking for critique.
//
// Runs on GitHub Actions (.github/workflows/weekly-digest.yml), NOT in the browser.
// It needs the Supabase *service role* key, which must never go in the frontend.
//
// Local test (prints who would be emailed, sends nothing):
//   DRY_RUN=true SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... GMAIL_USER=... \
//   GMAIL_APP_PASSWORD=... SITE_URL=https://your-site.vercel.app npm run digest

import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GMAIL_USER", "GMAIL_APP_PASSWORD", "SITE_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error("Missing environment variables:", missing.join(", "));
  process.exit(1);
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
const SITE_URL = process.env.SITE_URL.replace(/\/+$/, "");
const DRY_RUN = process.env.DRY_RUN === "true";
const MAX_EMAILS = Number(process.env.MAX_EMAILS || 400); // Gmail allows roughly 500 messages a day
const PIECES_PER_EMAIL = 5;
const WINDOW_DAYS = 7;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function loadRecentCritiquePieces() {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("works")
    .select("id, title, image_url, user_id, created_at, profiles!works_user_id_fkey(name)")
    .eq("critique_requested", true)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return data || [];
}

async function loadEmailsFor(ids) {
  const wanted = new Set(ids);
  const emails = new Map();
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const user of data.users) if (wanted.has(user.id) && user.email) emails.set(user.id, user.email);
    if (data.users.length < 1000) break;
  }
  return emails;
}

function buildEmail(name, pieces) {
  const rows = pieces
    .map(
      (w) => `
      <tr>
        <td style="padding:12px 0;width:132px;vertical-align:top;">
          <a href="${SITE_URL}/?work=${w.id}"><img src="${esc(w.image_url)}" width="120" style="display:block;border-radius:6px;" alt="${esc(w.title)}" /></a>
        </td>
        <td style="padding:12px 0 12px 12px;vertical-align:top;font-family:Arial,sans-serif;font-size:14px;color:#222;">
          <strong>${esc(w.title)}</strong><br />
          <span style="color:#666;">by ${esc(w.profiles?.name || "an artist")}</span><br /><br />
          <a href="${SITE_URL}/?work=${w.id}" style="color:#111;">Give feedback &rarr;</a>
        </td>
      </tr>`
    )
    .join("");

  const html = `
  <div style="max-width:560px;margin:0 auto;font-family:Arial,sans-serif;color:#222;">
    <h2 style="font-family:Georgia,serif;font-weight:normal;">Fresh Eyes</h2>
    <p>Hi ${esc(name || "there")} — these artists asked for honest critique this week:</p>
    <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    <p style="font-size:12px;color:#888;margin-top:28px;">
      You're getting this because you turned on the weekly digest in Settings on Signature.
      Turn it off any time at <a href="${SITE_URL}" style="color:#888;">${SITE_URL}</a> &rarr; Settings.
    </p>
  </div>`;

  const text = [
    "Fresh Eyes — artists asking for critique this week",
    "",
    ...pieces.map((w) => `• ${w.title} by ${w.profiles?.name || "an artist"}\n  ${SITE_URL}/?work=${w.id}`),
    "",
    `You're getting this because you turned on the weekly digest in Settings. Turn it off at ${SITE_URL}.`,
  ].join("\n");

  return { html, text };
}

async function main() {
  const pieces = await loadRecentCritiquePieces();
  if (pieces.length === 0) {
    console.log("No critique-requested pieces in the last 7 days — nothing to send.");
    return;
  }

  const { data: subscribers, error } = await supabase.from("profiles").select("id, name").eq("digest_opt_in", true);
  if (error) throw error;
  if (!subscribers || subscribers.length === 0) {
    console.log("Nobody has opted in to the digest yet.");
    return;
  }

  const emails = await loadEmailsFor(subscribers.map((s) => s.id));
  const transporter = DRY_RUN
    ? null
    : nodemailer.createTransport({ service: "gmail", auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });

  let sent = 0;
  for (const sub of subscribers) {
    if (sent >= MAX_EMAILS) { console.log(`Reached MAX_EMAILS (${MAX_EMAILS}); stopping.`); break; }
    const to = emails.get(sub.id);
    if (!to) continue;
    const forThem = pieces.filter((w) => w.user_id !== sub.id).slice(0, PIECES_PER_EMAIL);
    if (forThem.length === 0) continue;

    if (DRY_RUN) {
      console.log(`[dry run] would email ${to} with ${forThem.length} piece(s)`);
    } else {
      const { html, text } = buildEmail(sub.name, forThem);
      await transporter.sendMail({ from: `"Signature" <${GMAIL_USER}>`, to, subject: "Fresh Eyes: artists asking for critique this week", html, text });
      console.log(`sent to ${to}`);
      await new Promise((resolve) => setTimeout(resolve, 1000)); // stay well under Gmail's rate limits
    }
    sent++;
  }
  console.log(DRY_RUN ? `Dry run complete — ${sent} email(s) would be sent.` : `Done — ${sent} email(s) sent.`);
}

main().catch((err) => {
  console.error("Digest failed:", err);
  process.exit(1);
});
