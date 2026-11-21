// POST /api/ai-critique — writes an AI first-pass critique for one of the caller's own artworks.
//
// Server-side only. Needs these Vercel environment variables (names WITHOUT the VITE_ prefix):
//   ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional: ANTHROPIC_MODEL (default claude-haiku-4-5-20251001),
//   AI_CRITIQUES_PER_USER_PER_DAY (default 5), AI_CRITIQUES_PER_DAY (default 100),
//   AI_TIMEOUT_MS (default 50000)
//
// Flow: check the caller is signed in and owns the piece → check the daily limits →
// download the stored image → shrink it → ask Claude → validate the answer → save it.
// The browser never sees the API key, and never sends the image itself.

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { SYSTEM_PROMPT, buildUserText, parseCritique } from "./_lib/critique.js";

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const REQUIRED_ENV = ["ANTHROPIC_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024; // the upload limit is 25MB
const STORAGE_PATH = "/storage/v1/object/public/artwork/";

const fail = (res, status, code, error) => res.status(status).json({ code, error });

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ------------------------------------------------------------------ */
/* Pieces that touch the outside world (swapped for fakes in tests)    */
/* ------------------------------------------------------------------ */

// Downloads the artwork — but only from our own Supabase storage, never an arbitrary address.
export function makeImageFetcher(env, fetchImpl = fetch) {
  return async function fetchImage(url) {
    const base = new URL(env.SUPABASE_URL);
    let target;
    try { target = new URL(url); } catch { throw Object.assign(new Error("bad image address"), { code: "image_fetch" }); }
    if (target.origin !== base.origin || !target.pathname.startsWith(STORAGE_PATH)) {
      throw Object.assign(new Error("image is not stored on Signature"), { code: "image_fetch" });
    }
    const res = await fetchImpl(target.toString(), { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw Object.assign(new Error(`image download failed (${res.status})`), { code: "image_fetch" });
    if (Number(res.headers.get("content-length") || 0) > MAX_IMAGE_BYTES) {
      throw Object.assign(new Error("image too large"), { code: "image_fetch" });
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) throw Object.assign(new Error("image too large"), { code: "image_fetch" });
    return buffer;
  };
}

// Shrinks to at most 1568px on the long side (the size Claude reads best, and far cheaper)
// and converts to JPEG, which also keeps us far below the 5MB per-image limit.
export async function resizeForAi(buffer) {
  const { default: sharp } = await import("sharp");
  const out = await sharp(buffer, { failOn: "none", limitInputPixels: 150_000_000 })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return out.toString("base64");
}

export function makeClaudeCaller(env, fetchImpl = fetch) {
  return async function callClaude({ system, userText, imageBase64, maxTokens = 1400 }) {
    const content = [];
    if (imageBase64) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } });
    content.push({ type: "text", text: userText });

    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.ANTHROPIC_MODEL || DEFAULT_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(Number(env.AI_TIMEOUT_MS || 50000)),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body?.error?.message || `Anthropic error ${res.status}`);
      err.status = res.status;
      err.type = body?.error?.type;
      throw err;
    }
    return {
      text: (body.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n"),
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
      stopReason: body.stop_reason,
      model: body.model || env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    };
  };
}

/* ------------------------------------------------------------------ */
/* Database access                                                     */
/* ------------------------------------------------------------------ */

async function unwrap(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}

export function makeAiDb(supabase) {
  const count = async (query) => {
    const { count: n, error } = await query;
    if (error) throw new Error(error.message);
    return n || 0;
  };
  return {
    async getUserId(token) {
      const { data, error } = await supabase.auth.getUser(token);
      return error ? null : data?.user?.id || null;
    },
    getWork: (id) =>
      unwrap(supabase.from("works").select("id, user_id, title, description, category, medium, tags, image_url, critique_requested").eq("id", id).maybeSingle()),
    getCritique: (workId) => unwrap(supabase.from("ai_critiques").select("*").eq("work_id", workId).maybeSingle()),
    countUsageSince: (sinceIso, userId) => {
      let query = supabase.from("ai_usage").select("id", { count: "exact", head: true }).gte("created_at", sinceIso);
      if (userId) query = query.eq("user_id", userId);
      return count(query);
    },
    // Reserve first, check second, so parallel requests can't slip past the daily limit together.
    reserveUsage: async (userId, workId) => (await unwrap(supabase.from("ai_usage").insert({ user_id: userId, work_id: workId }).select("id").single())).id,
    async releaseUsage(id) {
      const { error } = await supabase.from("ai_usage").delete().eq("id", id);
      if (error) console.error("could not release usage reservation:", error.message);
    },
    async finishUsage(id, inputTokens, outputTokens) {
      const { error } = await supabase.from("ai_usage").update({ input_tokens: inputTokens, output_tokens: outputTokens }).eq("id", id);
      if (error) console.error("could not record token usage:", error.message);
    },
    saveCritique: ({ workId, content, model, userId }) =>
      unwrap(
        supabase
          .from("ai_critiques")
          .upsert({ work_id: workId, content, model, requested_by: userId, created_at: new Date().toISOString() }, { onConflict: "work_id" })
          .select("*")
          .single()
      ),
  };
}

/* ------------------------------------------------------------------ */
/* The request handler                                                 */
/* ------------------------------------------------------------------ */

export function createAiHandler({ db, fetchImage, resizeImage, callClaude, env, now = () => Date.now() }) {
  const perUser = Number(env.AI_CRITIQUES_PER_USER_PER_DAY || 5);
  const perDay = Number(env.AI_CRITIQUES_PER_DAY || 100);

  return async function handler(req, res) {
    if (req.method !== "POST") return fail(res, 405, "method", "POST only");

    const missing = REQUIRED_ENV.filter((key) => !env[key]);
    if (missing.length > 0) {
      console.error("AI critique is not configured. Missing:", missing.join(", "));
      return fail(res, 503, "not_configured", "AI critique isn't switched on yet.");
    }

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { return fail(res, 400, "bad_request", "Invalid request."); }
    }
    body = body || {};

    // Owner-only health check: confirms the API key and model work, without needing an artwork.
    if (body.kind === "ping") {
      const given = req.headers?.["x-notify-secret"] || "";
      if (!env.NOTIFY_SECRET || !safeEqual(given, env.NOTIFY_SECRET)) return fail(res, 401, "auth", "unauthorized");
      try {
        const out = await callClaude({ system: "Reply with the single word OK.", userText: "ping", maxTokens: 16 });
        return res.status(200).json({ ok: true, model: out.model, reply: out.text.trim().slice(0, 40) });
      } catch (err) {
        console.error("AI ping failed:", err.status, err.type, err.message);
        return res.status(502).json({ ok: false, status: err.status || null, error: String(err.message).slice(0, 300) });
      }
    }

    // Who is asking?
    const auth = String(req.headers?.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const userId = token ? await db.getUserId(token) : null;
    if (!userId) return fail(res, 401, "auth", "Please sign in again.");

    const { workId, regenerate } = body;
    if (!UUID.test(String(workId))) return fail(res, 400, "bad_request", "Invalid artwork.");

    try {
      const work = await db.getWork(workId);
      if (!work) return fail(res, 404, "not_found", "That artwork wasn't found.");
      if (work.user_id !== userId) return fail(res, 403, "forbidden", "Only the artist can ask for an AI critique.");
      if (!work.critique_requested) return fail(res, 400, "not_requested", "Turn on “Critique requested” for this piece first.");

      const existing = await db.getCritique(workId);
      if (existing && !regenerate) return res.status(200).json({ critique: existing, existing: true });

      // Daily limits. Reserve a slot, then count; give it back if we're over or anything fails.
      const reservation = await db.reserveUsage(userId, workId);
      const since = new Date(now() - DAY).toISOString();
      const [mine, everyone] = await Promise.all([db.countUsageSince(since, userId), db.countUsageSince(since)]);
      if (mine > perUser) {
        await db.releaseUsage(reservation);
        return fail(res, 429, "user_limit", `You've used today's ${perUser} AI critiques. Try again tomorrow.`);
      }
      if (everyone > perDay) {
        await db.releaseUsage(reservation);
        return fail(res, 429, "daily_limit", "AI critiques are paused for today. Please try again tomorrow.");
      }

      let spent = false;
      try {
        let imageBase64;
        try {
          imageBase64 = await resizeImage(await fetchImage(work.image_url));
        } catch (err) {
          console.error("AI critique image step failed:", err.code, err.message);
          await db.releaseUsage(reservation); // nothing was spent, so it doesn't count against the limit
          return fail(res, err.code === "image_fetch" ? 502 : 422, "image", err.code === "image_fetch" ? "Couldn't load the image. Try again in a moment." : "Couldn't read this image file.");
        }

        let result;
        try {
          result = await callClaude({ system: SYSTEM_PROMPT, userText: buildUserText(work), imageBase64 });
        } catch (err) {
          console.error("Anthropic call failed:", err.status, err.type, err.message);
          await db.releaseUsage(reservation); // the request failed, so it doesn't count against the limit
          if (err.name === "TimeoutError" || err.name === "AbortError") return fail(res, 504, "timeout", "The AI took too long. Please try again.");
          if (err.status === 429 || err.status === 529 || err.status >= 500) return fail(res, 503, "busy", "The AI is busy right now. Please try again in a minute.");
          return fail(res, 502, "ai_error", "The AI critique couldn't be created. Please try again later.");
        }

        // From here on tokens were spent, so the attempt stays counted (this is what caps your bill).
        spent = true;
        await db.finishUsage(reservation, result.inputTokens, result.outputTokens);
        if (result.stopReason === "refusal") return fail(res, 422, "refused", "The AI couldn't review this image.");
        const content = parseCritique(result.text);
        if (!content) {
          console.error("AI critique reply could not be read. stop_reason:", result.stopReason);
          return fail(res, 502, "unreadable", "The AI's answer couldn't be read. Please try again.");
        }

        const saved = await db.saveCritique({ workId, content, model: result.model, userId });
        return res.status(200).json({ critique: saved });
      } catch (err) {
        if (!spent) await db.releaseUsage(reservation); // never lose the record of money already spent
        throw err;
      }
    } catch (err) {
      console.error("ai-critique failed:", err);
      return fail(res, 500, "server", "Something went wrong. Please try again.");
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
    const configured = REQUIRED_ENV.every((key) => env[key]);
    cached = configured
      ? createAiHandler({
          db: makeAiDb(createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })),
          fetchImage: makeImageFetcher(env),
          resizeImage: resizeForAi,
          callClaude: makeClaudeCaller(env),
          env,
        })
      : createAiHandler({ db: null, fetchImage: null, resizeImage: null, callClaude: null, env });
  }
  return cached(req, res);
}
