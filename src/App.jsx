import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";
import LandingPage from "./Landing.jsx";

// Self-hosted (see main.jsx). Plus Jakarta Sans for everything; Playfair italic only for accent words.
const FONT_SERIF = "'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', -apple-system, 'Segoe UI', sans-serif";
const FONT_ACCENT = "'Playfair Display', Georgia, serif";
const FONT_SANS = "'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', -apple-system, 'Segoe UI', sans-serif";
const CATEGORIES = ["All", "Illustration", "Photography", "Painting", "Sketch", "Digital", "Mixed"];
const MAX_UPLOAD_MB = 25;
const MAX_PROCESS_SHOTS = 4;


/* ------------------------------------------------------------------ */
/* Data helpers                                                        */
/* ------------------------------------------------------------------ */

const WORK_SELECT = "*, profiles!works_user_id_fkey(name, username, avatar_url, verified), likes(count), comments(count), work_steps(count)";
const WORK_SELECT_BASIC = "*, profiles!works_user_id_fkey(name, username, avatar_url), likes(count), comments(count)";

// Runs a works query including the verified badge. If the latest database
// migration hasn't been run yet, it quietly retries without that column so the
// feed never goes blank.
async function queryWorks(modify) {
  let res = await modify(supabase.from("works").select(WORK_SELECT));
  if (res.error) {
    console.warn("Works query failed, retrying without verified badge:", res.error.message);
    res = await modify(supabase.from("works").select(WORK_SELECT_BASIC));
  }
  return res;
}

const withLikeCount = (w) => ({ ...w, like_count: w.likes?.[0]?.count || 0, comment_count: w.comments?.[0]?.count || 0, step_count: w.work_steps?.[0]?.count || 0 });

async function fetchFullWork(id) {
  const { data, error } = await queryWorks((q) => q.eq("id", id).maybeSingle());
  if (error || !data) return null;
  return withLikeCount(data);
}

const extOf = (file) => (file.name.split(".").pop() || "jpg").toLowerCase();
const pathFromUrl = (url) => (url || "").split("/artwork/")[1];
const cleanTags = (raw) =>
  Array.from(new Set(raw.split(",").map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean)));

// "my_sketch-01.JPG" -> "My sketch 01"
const titleFromFilename = (name) => {
  const base = name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "Untitled";
};

// Inserts a work. `allow_download` only exists after migration-batch-3.sql; if the column
// is missing, retry without it so uploads never break.
async function insertWork(payload) {
  let res = await supabase.from("works").insert(payload).select("id").single();
  if (res.error && "allow_download" in payload && /allow_download/i.test(res.error.message || "")) {
    console.warn("allow_download column missing - run migration-batch-3.sql. Retrying without it.");
    const { allow_download, ...rest } = payload;
    res = await supabase.from("works").insert(rest).select("id").single();
    res.droppedDownloadFlag = true;
  }
  return res;
}

// Saves the original file to the visitor's device. Supabase storage URLs accept ?download=<name>,
// which makes the browser save the file instead of opening it.
function downloadArtwork(work) {
  const url = work.image_url;
  const ext = (url.split("?")[0].split(".").pop() || "jpg").toLowerCase();
  const slug = (work.title || "artwork").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "artwork";
  const a = document.createElement("a");
  a.href = `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(`${slug}.${ext}`)}`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Admin-only: log the removal, delete the artwork row, then delete its files.
async function removeWorkAsAdmin(work, adminId, reason) {
  const { data: stepRows } = await supabase.from("work_steps").select("image_url").eq("work_id", work.id);
  const paths = [work.image_url, ...(stepRows || []).map((s) => s.image_url)].map(pathFromUrl).filter(Boolean);
  const { error: logError } = await supabase
    .from("moderation_log")
    .insert({ admin_id: adminId, work_id: work.id, work_title: work.title, owner_id: work.user_id, reason });
  if (logError) return { error: logError };
  const { data: deleted, error: delError } = await supabase.from("works").delete().eq("id", work.id).select("id");
  if (delError) return { error: delError };
  if (!deleted || deleted.length === 0) {
    return { error: { message: "Nothing was deleted. Make sure this account is an admin and migration-batch-3.sql has been run." } };
  }
  if (paths.length > 0) await supabase.storage.from("artwork").remove(paths);
  return { error: null };
}

const AI_AXES = [
  ["composition", "Composition"],
  ["colour", "Colour"],
  ["technique", "Technique"],
  ["emotional_impact", "Emotional impact"],
];

// Asks our server to write an AI first-pass critique for one of the caller's own pieces.
// The server does the work (and holds the API key); the browser only sends the piece's id.
async function requestAiCritique(workId, { regenerate = false } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: "Please sign in again." };
  try {
    const res = await fetch("/api/ai-critique", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ workId, regenerate }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body.error || "The AI critique couldn't be created. Please try again in a moment.", code: body.code };
    return { critique: body.critique };
  } catch {
    return { error: "Couldn't reach the server. Check your connection and try again." };
  }
}

// Runs `worker` over `items` with at most `limit` running at once.
async function runPool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

/* ------------------------------------------------------------------ */
/* Global styles                                                       */
/* ------------------------------------------------------------------ */

const GlobalStyle = () => (
  <style>{`
    /* ================= Design tokens =================
       60% Sky Blue #0593C6 (the canvas)  ·  30% White #FCFFFF (panels, cards)  ·  10% Hot Pink #D83995 (accents)
       Variables below default to the WHITE-surface look; anything on the blue canvas adds class "t-blue". */
    :root, .t-white, .sig-panel, .sig-modal-card, .sig-work-side-pane {
      --sky: #0593C6; --sky-600: #047FAB; --sky-700: #036A91; --sky-300: #5CC3E6; --sky-200: #A9DEF1; --sky-100: #E4F5FB;
      --white: #FCFFFF; --pink: #D83995; --pink-600: #B82E7E; --pink-100: #FCE8F3; --ink: #06283A;
      --fg: #06283A; --fg-2: rgba(6,40,58,0.82); --fg-3: rgba(6,40,58,0.66); --fg-4: rgba(6,40,58,0.46);
      --border: rgba(5,147,198,0.18); --border-strong: rgba(5,147,198,0.36);
      --surface: rgba(5,147,198,0.07); --surface-2: rgba(5,147,198,0.14);
      --card: #FCFFFF; --stage: #031d2b; --avatar: #cfe9f4;
      --accent: #D83995; --accent-text: #B82E7E; --accent-soft: rgba(216,57,149,0.12);
      --danger: #C4263F; --warn: #8a5a00; --ok: #0a7d57; --ok-bg: #bff0dc; --link: #036A91;
      --shadow: 0 10px 30px rgba(3,70,100,0.18); --shadow-lg: 0 24px 60px rgba(2,50,74,0.32);
    }
    .t-blue {
      --fg: #FCFFFF; --fg-2: rgba(252,255,255,0.94); --fg-3: rgba(252,255,255,0.84); --fg-4: rgba(252,255,255,0.66);
      --border: rgba(255,255,255,0.34); --border-strong: rgba(255,255,255,0.62);
      --surface: rgba(255,255,255,0.16); --surface-2: rgba(255,255,255,0.26);
      --accent-text: #FCFFFF; --link: #FCFFFF; color: var(--fg);
    }

    * { box-sizing: border-box; }
    html, body { margin: 0; background: #0593C6; }
    body { font-family: ${FONT_SANS}; color: var(--fg); -webkit-text-size-adjust: 100%; -webkit-font-smoothing: antialiased; }
    .sig-serif { font-family: ${FONT_SERIF}; letter-spacing: -0.02em; font-weight: 600; }
    .sig-accent { font-family: ${FONT_ACCENT}; font-style: italic; font-weight: 400; letter-spacing: 0; }
    ::selection { background: #D83995; color: #fff; }
    :focus-visible { outline: 3px solid var(--pink); outline-offset: 2px; }

    /* The sky-blue canvas: a slow-drifting mesh of blue and a little pink, with a fine ribbed-glass texture */
    .sig-canvas {
      position: relative; background:
        radial-gradient(900px 620px at 88% -8%, rgba(216,57,149,0.42), transparent 62%),
        radial-gradient(800px 560px at -8% 8%, rgba(92,195,230,0.75), transparent 62%),
        radial-gradient(700px 520px at 60% 108%, rgba(3,106,145,0.55), transparent 60%),
        linear-gradient(165deg, #0aa2d8 0%, #0593C6 45%, #047FAB 100%);
      background-attachment: fixed;
    }
    .sig-canvas::before {
      content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: 0.55;
      background: repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 10px);
      -webkit-mask-image: linear-gradient(180deg, #000 0%, transparent 85%); mask-image: linear-gradient(180deg, #000 0%, transparent 85%);
    }
    .sig-canvas > * { position: relative; z-index: 1; }

    /* ---------- Buttons ---------- */
    .sig-btn-primary {
      background: var(--pink); color: #fff; border: none; border-radius: 999px;
      padding: 12px 24px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: ${FONT_SANS};
      box-shadow: 0 8px 22px rgba(216,57,149,0.38); transition: transform .18s ease, box-shadow .2s ease, background .15s ease;
    }
    .sig-btn-primary:hover { background: #e24aa3; transform: translateY(-2px); box-shadow: 0 14px 30px rgba(216,57,149,0.46); }
    .sig-btn-primary:active { transform: translateY(0) scale(0.98); }
    .sig-btn-primary:disabled { opacity: .45; cursor: not-allowed; transform: none; box-shadow: none; }
    .sig-btn-outline {
      background: transparent; color: var(--sky-700); border: 1.5px solid var(--sky); border-radius: 999px;
      padding: 11px 22px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: ${FONT_SANS};
      transition: background .15s ease, color .15s ease, transform .18s ease;
    }
    .sig-btn-outline:hover { background: var(--sky); color: #fff; transform: translateY(-1px); }
    .sig-btn-outline:disabled { opacity: .45; cursor: not-allowed; transform: none; }
    .t-blue .sig-btn-outline { color: #fff; border-color: rgba(255,255,255,0.75); }
    .t-blue .sig-btn-outline:hover { background: #fff; color: var(--sky-700); }

    /* ---------- Forms ---------- */
    .sig-input {
      width: 100%; background: #fff; border: 1.5px solid var(--border-strong);
      border-radius: 12px; padding: 12px 14px; color: var(--ink); font-size: 14px; font-family: ${FONT_SANS};
      outline: none; transition: border-color .15s ease, box-shadow .15s ease;
    }
    .sig-input:focus { border-color: var(--sky); box-shadow: 0 0 0 4px rgba(5,147,198,0.2); }
    .sig-input::placeholder { color: rgba(6,40,58,0.46); }
    select.sig-input { color-scheme: light; }
    select.sig-input option { background: #fff; color: #06283A; }
    textarea.sig-input { resize: vertical; font-family: ${FONT_SANS}; }
    .sig-label {
      display: block; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--fg-3); margin-bottom: 8px; font-weight: 700;
    }

    /* ---------- Navigation ---------- */
    .sig-nav-item {
      display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-radius: 14px;
      color: var(--fg-2); font-size: 14px; font-weight: 600; cursor: pointer; transition: background .15s ease, color .15s ease, transform .15s ease;
    }
    .sig-nav-item:hover { background: var(--surface-2); color: var(--sky-700); transform: translateX(2px); }
    .sig-nav-item.active { background: var(--sky-700); color: #fff; box-shadow: 0 8px 18px rgba(3,106,145,0.3); }
    .sig-cat-pill {
      font-size: 12px; letter-spacing: 0.05em; text-transform: uppercase; padding: 8px 16px; flex-shrink: 0;
      border-radius: 999px; cursor: pointer; color: var(--sky-700); font-weight: 700; background: rgba(252,255,255,0.92);
      border: 1px solid transparent; transition: transform .15s ease, background .15s ease, color .15s ease; white-space: nowrap;
    }
    .sig-cat-pill:not(.active):hover { transform: translateY(-2px); background: #fff; }
    .sig-cat-pill.active { background: var(--pink); color: #fff; box-shadow: 0 6px 16px rgba(216,57,149,0.4); }
    .sig-chip {
      display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 7px 13px;
      border-radius: 999px; background: var(--surface); color: var(--fg-2); cursor: pointer; letter-spacing: 0.02em;
      border: 1px solid var(--border); transition: border-color .15s ease, background .15s ease, transform .15s ease;
    }
    .sig-chip:hover { border-color: var(--border-strong); transform: translateY(-1px); }
    .sig-select-sm {
      background: rgba(252,255,255,0.92); color: var(--sky-700); border: 1px solid transparent; border-radius: 999px; font-weight: 600;
      padding: 8px 14px; font-size: 12px; font-family: ${FONT_SANS}; outline: none; cursor: pointer; color-scheme: light;
    }
    .sig-select-sm:focus { box-shadow: 0 0 0 3px rgba(216,57,149,0.45); }
    .sig-select-sm option { background: #fff; color: #06283A; }

    /* ---------- The gallery grid ---------- */
    .sig-masonry { column-count: 4; column-gap: 18px; padding: 26px 40px 70px; }
    .sig-card {
      position: relative; border-radius: 24px; cursor: pointer; background: var(--white); padding: 6px; break-inside: avoid;
      margin-bottom: 18px; display: inline-block; width: 100%; box-shadow: 0 10px 28px rgba(2,60,86,0.24);
      transition: transform .32s cubic-bezier(.2,.8,.2,1), box-shadow .32s ease;
    }
    .sig-card:hover { transform: translateY(-7px) rotate(-0.5deg); box-shadow: 0 26px 50px rgba(2,50,74,0.38); }
    .sig-card-media { position: relative; overflow: hidden; border-radius: 19px; background: var(--sky-100); }
    .sig-card img { width: 100%; display: block; transition: transform .7s cubic-bezier(.2,.8,.2,1); }
    .sig-card:hover img { transform: scale(1.06); }
    .sig-card-info { opacity: 0; transform: translateY(10px); transition: opacity .25s ease, transform .3s ease; }
    .sig-card:hover .sig-card-info, .sig-card:focus-visible .sig-card-info { opacity: 1; transform: none; }
    @media (hover: none) { .sig-card-info { opacity: 1; transform: none; } }

    .sig-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
    .sig-scrollbar::-webkit-scrollbar-thumb { background: rgba(5,147,198,0.4); border-radius: 4px; }
    .sig-fade-in { animation: sigFadeIn .45s cubic-bezier(.2,.8,.2,1) both; }
    @keyframes sigFadeIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }

    /* ---------- Panels ---------- */
    input[type="checkbox"], input[type="radio"] { accent-color: #D83995; }
    .sig-sheet { margin: 24px 40px 90px; padding: 26px 28px; background: var(--white); color: var(--ink); border-radius: 28px; box-shadow: var(--shadow); }
    .sig-sheet, .sig-sheet * { --fg: #06283A; }
    .sig-panel { background: var(--white); color: var(--ink); border-radius: 24px; box-shadow: var(--shadow); }
    .sig-modal-overlay { position: fixed; inset: 0; background: rgba(3,50,72,0.58); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 12px; }
    .sig-modal-card { width: 100%; max-height: 94vh; overflow-y: auto; background: var(--white); color: var(--ink); border-radius: 28px; box-shadow: var(--shadow-lg); }
    .sig-select-bar {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 40;
      display: flex; align-items: center; gap: 12px; padding: 10px 14px 10px 22px;
      background: var(--ink); color: #fff; border-radius: 999px; box-shadow: 0 14px 40px rgba(2,40,58,0.5);
      font-size: 14px; font-weight: 600; white-space: nowrap;
    }

    /* ---------- Layout shell ---------- */
    .sig-app-shell { display: flex; min-height: 100vh; }
    .sig-sidebar-desktop { display: block; padding: 16px 0 16px 16px; }
    .sig-mobile-topbar { display: none; }
    .sig-mobile-bottomnav { display: none; }
    .sig-main-area { flex: 1; min-width: 0; height: 100vh; overflow-y: auto; }

    .sig-work-detail { display: flex; height: 100vh; background: var(--white); color: var(--ink); }
    .sig-work-image-pane { flex: 1; min-width: 0; position: relative; background: radial-gradient(1000px 700px at 50% 30%, #0aa2d8 0%, #0593C6 38%, #036A91 100%); display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .sig-work-side-pane { width: 380px; flex-shrink: 0; border-left: 1px solid var(--border); padding: 24px 26px 40px; overflow-y: auto; background: var(--white); color: var(--ink); }

    /* ---------- Landing (extra rules live in Landing.jsx) ---------- */

    /* ---------- Tablet ---------- */
    @media (min-width: 861px) and (max-width: 1100px) {
      .sig-sidebar-desktop > div { width: 220px !important; }
      .sig-masonry { column-count: 3; }
      .sig-work-side-pane { width: 330px; }
    }
    @media (max-width: 1200px) { .sig-masonry { column-count: 3; } }

    /* ---------- Phone + small tablet ---------- */
    @media (max-width: 860px) {
      .sig-app-shell { flex-direction: column; }
      .sig-sidebar-desktop { display: none !important; }
      .sig-mobile-topbar { display: flex !important; }
      .sig-mobile-bottomnav { display: flex !important; }
      .sig-main-area { height: auto; min-height: 100vh; overflow: visible; padding-bottom: 100px; }
      .sig-masonry { column-count: 2; column-gap: 12px; padding: 14px 12px 40px; }
      .sig-card { border-radius: 20px; padding: 4px; margin-bottom: 12px; }
      .sig-card-media { border-radius: 16px; }
      .sig-select-bar { bottom: 96px; }
      .sig-sheet { margin: 14px 12px 100px; padding: 18px 16px; border-radius: 24px; }

      .sig-work-detail { flex-direction: column; height: auto; min-height: 100vh; }
      .sig-work-image-pane { flex: none; height: 62vh; }
      .sig-work-side-pane { width: 100%; border-left: none; border-top: 1px solid var(--border); overflow: visible; }

      .sig-topbar-row { flex-direction: column; align-items: flex-start !important; gap: 14px; padding: 20px 16px 0 !important; }
      .sig-topbar-search { width: 100% !important; }
      .sig-category-bar { flex-direction: column; align-items: stretch !important; gap: 12px; padding: 14px 16px 16px !important; }
      .sig-cat-scroll { overflow-x: auto; padding-bottom: 4px; }
      .sig-sort-row { justify-content: flex-start; flex-wrap: wrap; }
      .sig-tag-bar { padding: 12px 16px 0 !important; }
      .sig-page-pad { padding-left: 16px !important; padding-right: 16px !important; }

      .sig-auth-grid { grid-template-columns: 1fr !important; min-height: 100vh; }
      .sig-auth-hero-panel { display: none !important; }
      .sig-auth-form { padding: 28px 22px !important; }

      .sig-profile-header { flex-direction: column; align-items: flex-start !important; padding: 0 16px !important; margin-top: -36px !important; }
      .sig-settings-grid { grid-template-columns: 1fr !important; }
      .sig-upload-modal-grid { grid-template-columns: 1fr !important; }
      .sig-upload-modal-grid > div:first-child { border-right: none !important; border-bottom: 1px solid var(--border); }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; scroll-behavior: auto !important; }
    }
  `}</style>
);

/* ------------------------------------------------------------------ */
/* Small UI pieces                                                     */
/* ------------------------------------------------------------------ */

function Icon({ name, size = 16 }) {
  const p = { stroke: "currentColor", fill: "none", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
  const map = {
    explore: <circle cx="12" cy="12" r="9" {...p} />,
    home: <path d="M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z" {...p} />,
    user: <><circle cx="12" cy="8" r="3.2" {...p} /><path d="M5 20c1.5-4 4.5-6 7-6s5.5 2 7 6" {...p} /></>,
    bell: <><path d="M6 16v-5a6 6 0 1112 0v5l1.5 2h-15z" {...p} /><path d="M10 20a2 2 0 004 0" {...p} /></>,
    layers: <><path d="M12 3l8 4-8 4-8-4z" {...p} /><path d="M4 12l8 4 8-4" {...p} /><path d="M4 16l8 4 8-4" {...p} /></>,
    gear: <><circle cx="12" cy="12" r="2.8" {...p} /><path d="M12 3v2M12 19v2M4.2 6.6l1.5 1.2M18.3 16.2l1.5 1.2M3 12h2M19 12h2M4.2 17.4l1.5-1.2M18.3 7.8l1.5-1.2" {...p} /></>,
    exit: <><path d="M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4" {...p} /><path d="M14 8l5 4-5 4M19 12H9" {...p} /></>,
    signin: <><path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4" {...p} /><path d="M10 8l-5 4 5 4M5 12h10" {...p} /></>,
    search: <><circle cx="11" cy="11" r="6.5" {...p} /><path d="M20 20l-4.3-4.3" {...p} /></>,
    heart: <path d="M12 20s-7-4.6-9.3-9C1.2 8 2.3 5 5.4 5c1.8 0 3.2 1 3.6 2.4C9.4 6 10.8 5 12.6 5c3.1 0 4.2 3 2.7 6-2.3 4.4-9.3 9-9.3 9z" {...p} />,
    comment: <path d="M4 5h16v11H8l-4 4z" {...p} />,
    trash: <path d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M7 7l1 13h8l1-13" {...p} />,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" {...p} /><circle cx="12" cy="12" r="2.5" {...p} /></>,
    upload: <><path d="M12 15V4M8 8l4-4 4 4" {...p} /><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" {...p} /></>,
    back: <path d="M15 5l-7 7 7 7" {...p} />,
    chevR: <path d="M9 5l7 7-7 7" {...p} />,
    share: <><circle cx="18" cy="5" r="2.5" {...p} /><circle cx="6" cy="12" r="2.5" {...p} /><circle cx="18" cy="19" r="2.5" {...p} /><path d="M8.2 10.8l7.6-4.6M8.2 13.2l7.6 4.6" {...p} /></>,
    edit: <><path d="M4 20h4l11-11-4-4L4 16v4z" {...p} /><path d="M13.5 6.5l4 4" {...p} /></>,
    flag: <><path d="M5 4v16" {...p} /><path d="M5 4h11l-2.5 4L16 12H5" {...p} /></>,
    check: <path d="M5 12.5l4.5 4.5L19 7.5" {...p} strokeWidth={2.4} />,
    plus: <path d="M12 5v14M5 12h14" {...p} />,
    x: <path d="M6 6l12 12M18 6L6 18" {...p} />,
    tag: <><path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z" {...p} /><circle cx="7.5" cy="7.5" r="1.2" {...p} /></>,
    download: <><path d="M12 4v11M8 11l4 4 4-4" {...p} /><path d="M5 19h14" {...p} /></>,
    shield: <path d="M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6z" {...p} />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24">{map[name] || null}</svg>;
}

function Logo({ size = 22, light = false }) {
  const tile = size + 10;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <span
        aria-hidden="true"
        style={{ width: tile, height: tile, borderRadius: Math.round(tile * 0.31), flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: light ? "#FCFFFF" : "linear-gradient(135deg, #0593C6, #D83995)", boxShadow: light ? "none" : "0 6px 16px rgba(5,147,198,0.35)" }}
      >
        <svg width={tile} height={tile} viewBox="0 0 32 32">
          <path d="M8.5 21.5c3-8.5 6.2-11.8 8.2-9.8s-3.2 8.4-1 9.4 5-4 7.8-6.4" stroke={light ? "#D83995" : "#fff"} strokeWidth="2.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="sig-serif" style={{ fontSize: size, color: light ? "#fff" : "var(--ink)" }}>Signature</span>
    </span>
  );
}

function VerifiedBadge({ size = 14 }) {
  return (
    <span
      title="Verified artist"
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: "50%", background: "var(--pink)", color: "#fff", marginLeft: 5, verticalAlign: "middle", flexShrink: 0 }}
    >
      <Icon name="check" size={Math.max(size - 4, 8)} />
    </span>
  );
}

function EmptyState({ title, sub }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "56px 20px" }}>
      <div className="sig-panel sig-fade-in" style={{ textAlign: "center", padding: "40px 38px", maxWidth: 460 }}>
        <div style={{ width: 58, height: 58, borderRadius: "50%", background: "var(--pink-100)", color: "var(--pink)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}>
          <Icon name="layers" size={26} />
        </div>
        <div className="sig-serif" style={{ fontSize: 24, color: "var(--ink)", marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 14, color: "var(--fg-3)", lineHeight: 1.6 }}>{sub}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

function Sidebar({ profile, page, setPage, onUploadClick, onSignOut, onMyProfile, unreadCount }) {
  const items = [
    { id: "explore", label: "Explore", icon: "explore" },
    { id: "following", label: "Following", icon: "home" },
  ];
  const authedItems = [
    { id: "profile", label: "My profile", icon: "user" },
    { id: "notifications", label: "Notifications", icon: "bell" },
    { id: "collections", label: "Collections", icon: "layers" },
    { id: "settings", label: "Settings", icon: "gear" },
    ...(profile?.is_admin ? [{ id: "admin", label: "Moderation", icon: "shield" }] : []),
  ];
  return (
    <div className="sig-panel" style={{ width: 264, flexShrink: 0, padding: "26px 16px 16px", display: "flex", flexDirection: "column", height: "calc(100vh - 32px)", position: "sticky", top: 16 }}>
      <div style={{ marginBottom: 30, padding: "0 6px", cursor: "pointer" }} onClick={() => setPage("landing")}>
        <Logo size={21} />
        <div style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--fg-3)", marginTop: 6, fontWeight: 700 }}>A GALLERY FOR CREATORS</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((it) => (
          <div key={it.id} className={"sig-nav-item" + (page === it.id ? " active" : "")} onClick={() => setPage(it.id)}>
            <Icon name={it.icon} /> {it.label}
          </div>
        ))}
        {profile && authedItems.map((it) => (
          <div
            key={it.id}
            className={"sig-nav-item" + (page === it.id ? " active" : "")}
            onClick={() => (it.id === "profile" ? onMyProfile() : setPage(it.id))}
            style={{ justifyContent: "space-between" }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}><Icon name={it.icon} /> {it.label}</span>
            {it.id === "notifications" && unreadCount > 0 && (
              <span style={{ background: "var(--pink)", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 999, minWidth: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{unreadCount}</span>
            )}
          </div>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      {profile ? (
        <>
          <button className="sig-btn-primary" style={{ width: "100%", marginBottom: 16 }} onClick={onUploadClick}>+ Upload artwork</button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 8px 2px", borderTop: "1px solid var(--border)" }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--avatar)", flexShrink: 0, overflow: "hidden", boxShadow: "0 0 0 2px #fff, 0 0 0 4px var(--pink)" }}>
              {profile.avatar_url && <img src={profile.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0, marginLeft: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", color: "var(--ink)" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.name}</span>
                {profile.verified && <VerifiedBadge size={13} />}
              </div>
              <div style={{ fontSize: 12, color: "var(--fg-3)" }}>@{profile.username}</div>
            </div>
            <div style={{ cursor: "pointer", color: "var(--fg-3)" }} onClick={onSignOut} title="Sign out"><Icon name="exit" /></div>
          </div>
        </>
      ) : (
        <button className="sig-btn-primary" style={{ width: "100%" }} onClick={() => setPage("signin")}>Sign in</button>
      )}
    </div>
  );
}

function MobileTopBar({ profile, setPage, onUploadClick }) {
  return (
    <div
      className="sig-mobile-topbar"
      style={{ alignItems: "center", justifyContent: "space-between", padding: "12px 16px", position: "sticky", top: 0, background: "rgba(252,255,255,0.92)", WebkitBackdropFilter: "blur(14px)", backdropFilter: "blur(14px)", boxShadow: "0 6px 24px rgba(2,60,86,0.18)", zIndex: 20 }}
    >
      <div style={{ cursor: "pointer" }} onClick={() => setPage("landing")}><Logo size={18} /></div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {profile ? (
          <>
            <div style={{ cursor: "pointer", color: "var(--sky-700)", fontWeight: 700, display: "flex", alignItems: "center", gap: 6, fontSize: 13 }} onClick={onUploadClick}>
              <Icon name="upload" /> Upload
            </div>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--avatar)", overflow: "hidden", cursor: "pointer", boxShadow: "0 0 0 2px #fff, 0 0 0 3.5px var(--pink)" }} onClick={() => setPage("settings")}>
              {profile.avatar_url && <img src={profile.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </div>
          </>
        ) : (
          <button className="sig-btn-primary" style={{ padding: "8px 16px", fontSize: 13 }} onClick={() => setPage("signin")}>Sign in</button>
        )}
      </div>
    </div>
  );
}

function MobileBottomNav({ profile, page, setPage, onMyProfile, unreadCount }) {
  const Tab = ({ id, label, icon, onClick, dot }) => {
    const active = page === id;
    return (
      <div
        onClick={onClick || (() => setPage(id))}
        style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "7px 12px", borderRadius: 18, background: active ? "var(--sky-700)" : "transparent", color: active ? "#fff" : "var(--fg-3)", cursor: "pointer", transition: "background .2s ease, color .2s ease" }}
      >
        <Icon name={icon} />
        <span style={{ fontSize: 10, fontWeight: 700 }}>{label}</span>
        {dot && <span style={{ position: "absolute", top: 4, right: 8, background: "var(--pink)", width: 8, height: 8, borderRadius: "50%", border: "2px solid #fff" }} />}
      </div>
    );
  };
  return (
    <div
      className="sig-mobile-bottomnav"
      style={{ position: "fixed", bottom: "calc(10px + env(safe-area-inset-bottom))", left: 10, right: 10, background: "rgba(252,255,255,0.96)", WebkitBackdropFilter: "blur(14px)", backdropFilter: "blur(14px)", borderRadius: 26, boxShadow: "0 14px 40px rgba(2,50,74,0.4)", zIndex: 30, padding: "6px", justifyContent: "space-around" }}
    >
      <Tab id="explore" label="Explore" icon="explore" />
      <Tab id="following" label="Following" icon="home" />
      {profile && (
        <>
          <Tab id="profile" label="Profile" icon="user" onClick={onMyProfile} />
          <Tab id="notifications" label="Alerts" icon="bell" dot={unreadCount > 0} />
          <Tab id="collections" label="Saved" icon="layers" />
          {profile.is_admin && <Tab id="admin" label="Admin" icon="shield" />}
        </>
      )}
    </div>
  );
}

function TopBar({ eyebrow, title, search, setSearch }) {
  return (
    <div className="sig-topbar-row t-blue" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "32px 40px 0", gap: 16 }}>
      <div>
        <span style={{ display: "inline-block", background: "#fff", color: "var(--sky-700)", fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", padding: "5px 13px", borderRadius: 999, marginBottom: 12, boxShadow: "0 4px 12px rgba(2,60,86,0.18)" }}>{eyebrow}</span>
        <div className="sig-serif" style={{ fontSize: "clamp(32px, 4vw, 48px)", lineHeight: 1.05, color: "#fff", textShadow: "0 2px 18px rgba(3,70,100,0.28)" }}>{title}</div>
      </div>
      {search !== undefined && (
        <div className="sig-topbar-search" style={{ position: "relative", width: 320 }}>
          <div style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--sky)" }}><Icon name="search" /></div>
          <input
            className="sig-input"
            style={{ paddingLeft: 42, borderRadius: 999, borderColor: "transparent", boxShadow: "0 10px 26px rgba(2,60,86,0.22)", padding: "13px 16px 13px 42px" }}
            placeholder="Search work, artists, tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

const SORTS = [
  ["recent", "Latest"],
  ["oldest", "Oldest"],
  ["views", "Most viewed"],
  ["popular", "Most liked"],
  ["discussed", "Most discussed"],
  ["title", "Title A–Z"],
];
const RANGES = [
  ["all", "Any time"],
  ["day", "Today"],
  ["week", "This week"],
  ["month", "This month"],
];

function CategoryBar({ cat, setCat, sort, setSort, range, setRange, critiqueOnly, setCritiqueOnly }) {
  return (
    <div className="sig-category-bar t-blue" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, padding: "22px 40px 4px" }}>
      <div className="sig-cat-scroll" style={{ display: "flex", gap: 8 }}>
        {CATEGORIES.map((c) => (
          <div key={c} className={"sig-cat-pill" + (cat === c ? " active" : "")} onClick={() => setCat(c)}>{c}</div>
        ))}
      </div>
      <div className="sig-sort-row" style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
        <span
          className="sig-chip"
          onClick={() => setCritiqueOnly(!critiqueOnly)}
          style={{ background: critiqueOnly ? "var(--pink)" : "rgba(252,255,255,0.92)", color: critiqueOnly ? "#fff" : "var(--sky-700)", borderColor: "transparent", fontSize: 12, padding: "8px 14px", fontWeight: 700 }}
        >
          Critique requested
        </span>
        <select className="sig-select-sm" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Posted">
          {RANGES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <select className="sig-select-sm" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
          {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
    </div>
  );
}

function Grid({ works, onOpen, selectable = false, selectedIds, onToggle, emptyTitle, emptySub }) {
  if (works.length === 0) {
    return <EmptyState title={emptyTitle || "Nothing to see — yet."} sub={emptySub || "Be the first to publish, or check back soon."} />;
  }
  return (
    <div className="sig-masonry">
      {works.map((w, i) => {
        const selected = selectable && selectedIds?.has(w.id);
        const activate = () => (selectable ? onToggle(w.id) : onOpen(w));
        return (
          <div
            key={w.id}
            className="sig-card sig-fade-in"
            role="button"
            tabIndex={0}
            aria-label={`${w.title} by ${w.profiles?.name || "Unknown"}`}
            onClick={activate}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } }}
            style={{ animationDelay: `${Math.min(i, 12) * 40}ms`, ...(selected ? { outline: "4px solid var(--pink)", outlineOffset: 2 } : {}) }}
          >
            <div className="sig-card-media">
              <img src={w.image_url} alt={w.title} loading="lazy" />
              <div className="sig-card-info" style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "34px 14px 12px", background: "linear-gradient(transparent, rgba(3,40,58,0.9))", color: "#fff" }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{w.title}</div>
                <div style={{ color: "rgba(255,255,255,0.88)", fontSize: 12, display: "flex", alignItems: "center", marginTop: 1 }}>
                  {w.profiles?.name || "Unknown"}
                  {w.profiles?.verified && <VerifiedBadge size={12} />}
                </div>
              </div>
              {(w.critique_requested || w.step_count > 0) && !selectable && (
                <div style={{ position: "absolute", top: 10, left: 10, right: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {w.critique_requested && (
                    <div style={{ fontSize: 10, letterSpacing: "0.06em", padding: "4px 9px", borderRadius: 999, background: "var(--pink)", color: "#fff", fontWeight: 800, boxShadow: "0 4px 12px rgba(216,57,149,0.45)" }}>CRITIQUE</div>
                  )}
                  {w.step_count > 0 && (
                    <div
                      title="Includes process shots — open it and swipe"
                      style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", padding: "4px 9px", borderRadius: 999, background: "rgba(252,255,255,0.95)", color: "var(--sky-700)" }}
                    >
                      <Icon name="layers" size={11} /> PROCESS
                    </div>
                  )}
                </div>
              )}
              {selectable && (
                <div
                  style={{
                    position: "absolute", top: 10, right: 10, width: 26, height: 26, borderRadius: "50%",
                    border: "2px solid #fff", background: selected ? "var(--pink)" : "rgba(0,0,0,0.4)",
                    color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  {selected && <Icon name="check" size={14} />}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Landing, legal, auth                                                */
/* ------------------------------------------------------------------ */

function LegalPage({ title, updated, children, setPage }) {
  return (
    <div className="sig-canvas sig-scrollbar" style={{ overflowY: "auto", height: "100vh" }}>
      <div className="t-blue" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 32px", maxWidth: 980, margin: "0 auto" }}>
        <div style={{ cursor: "pointer" }} onClick={() => setPage("landing")}><Logo size={20} light /></div>
        <button className="sig-btn-outline" onClick={() => setPage("landing")}>Back home</button>
      </div>
      <div className="sig-panel sig-fade-in" style={{ maxWidth: 780, margin: "8px auto 80px", padding: "46px 46px 56px", width: "calc(100% - 32px)" }}>
        <div className="sig-serif" style={{ fontSize: "clamp(30px, 4vw, 42px)", marginBottom: 8, color: "var(--ink)" }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--fg-3)", marginBottom: 36 }}>Last updated {updated}</div>
        <div style={{ fontSize: 15, color: "var(--fg-2)", lineHeight: 1.8 }}>{children}</div>
      </div>
    </div>
  );
}

const Strong = ({ children }) => <strong style={{ color: "var(--fg)" }}>{children}</strong>;

function PrivacyPage({ setPage }) {
  return (
    <LegalPage title="Privacy Policy" updated="22 October 2026" setPage={setPage}>
      <p><Strong>What we collect.</Strong> When you create an account, we store your email address, the name and username you choose, and any profile details you add (bio, links, avatar, cover image). When you publish artwork, we store the image file, title, description, category, tags, any process shots you attach, and any comments or likes tied to it.</p>
      <p><Strong>How we use it.</Strong> Your email is used only to send you sign-in links, one summary email a day, only on days when someone follows, comments on, likes or shares your work (you can turn each of these off in Settings; views are never emailed), and, if you opt in, a weekly digest of new work. We do not sell, rent, or share your data with advertisers. We do not run ads on Signature.</p>
      <p><Strong>AI critique.</Strong> Only if you ask for it (or tick the box when publishing a piece that asks for critique), a resized copy of that image and the title, description, medium and tags you wrote are sent to Anthropic, an AI company, so it can write a first-pass critique. Nothing is sent otherwise. The critique is shown on the piece, labelled as AI-written, and you can remove it at any time.</p>
      <p><Strong>Weekly digest.</Strong> The digest is off by default. If you turn it on in Settings, we email you a short weekly list of new pieces asking for critique. You can turn it off at any time.</p>
      <p><Strong>Verification.</Strong> If you request a verification badge, we store the note and links you submit so they can be reviewed by hand. We never ask for government ID or identity documents.</p>
      <p><Strong>Where it's stored.</Strong> Account data, artwork, and images are stored with Supabase, our database and hosting provider, on servers they operate. Data is protected by access rules so only you can edit or delete your own account and uploads.</p>
      <p><Strong>Public content.</Strong> Artwork you publish, its process shots, any Growth Thread you create, and your name, username, and avatar are visible to anyone who visits Signature, including people without an account. Comments and likes are attributed to your account and are also public. Your collections and the tags you follow are private to you.</p>
      <p><Strong>Moderation.</Strong> Reports are reviewed by Signature administrators, who are emailed the report including the reporter's name. The artist is never told who made a report. When content is removed, the image files are deleted and we keep a private log of the title and the reason for removal.</p>
      <p><Strong>Your choices.</Strong> You can edit or delete any artwork you've published at any time. You can update your profile in Settings. If you'd like your account and all associated data permanently deleted, contact us using the details below and we'll process the request.</p>
      <p><Strong>Cookies and tracking.</Strong> Signature uses only the minimum technical storage needed to keep you signed in. We do not use third-party advertising trackers.</p>
      <p><Strong>Changes.</Strong> If this policy changes in a meaningful way, we'll update the date above.</p>
      <p><Strong>Contact.</Strong> Questions about your data can be sent to the email address that sends your sign-in links.</p>
    </LegalPage>
  );
}

function TermsPage({ setPage }) {
  return (
    <LegalPage title="Terms of Service" updated="22 October 2026" setPage={setPage}>
      <p><Strong>Using Signature.</Strong> Signature is a free gallery and community for artists, illustrators, photographers, and creators to publish and discuss original work. By creating an account, you agree to these terms.</p>
      <p><Strong>Your content.</Strong> You retain full ownership of everything you upload. By publishing artwork, you grant Signature a license to display, resize, and store it so the platform can function — we never claim ownership of your work and never use it for anything beyond displaying it on the site.</p>
      <p><Strong>Only upload what's yours.</Strong> Don't publish artwork, photographs, or other content you don't have the rights to. Don't impersonate another artist or misattribute someone else's work as your own. Process shots and Growth Threads must show your own work.</p>
      <p><Strong>AI critique.</Strong> An AI critique is automated, can be wrong, and is no substitute for feedback from people. Use it as a starting point. It is always labelled as AI-written.</p>
      <p><Strong>Downloads.</Strong> Artists decide whether others may download the full-resolution file. A download is for personal reference only — it never transfers any rights, and you must ask the artist before reusing, sharing or selling it.</p>
      <p><Strong>Community conduct.</Strong> Critiques and comments should be honest but respectful. Harassment, hate speech, sexually explicit content, and content that endangers or exploits minors are never permitted and will result in immediate removal and account termination.</p>
      <p><Strong>Verification badge.</Strong> The badge is granted by hand after review and can be removed if it turns out the work isn't yours.</p>
      <p><Strong>Reporting and removal.</Strong> If you see content that violates these terms, use the report option on the artwork. Signature administrators may remove any content that breaks these terms, with or without a report. Removals are recorded in a private log with the reason.</p>
      <p><Strong>Account termination.</Strong> We may suspend or remove accounts that violate these terms. You may delete your own content at any time.</p>
      <p><Strong>No warranty.</Strong> Signature is provided free and as-is. We aim for reliability but can't guarantee the service will always be available or error-free.</p>
      <p><Strong>Changes to these terms.</Strong> We may update these terms as the platform evolves. Continued use after changes means you accept the updated terms.</p>
    </LegalPage>
  );
}

function AuthPage({ mode, setPage, onError, error }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const isSignup = mode === "signup";

  async function sendLink() {
    onError("");
    if (isSignup) {
      if (!name.trim() || !username.trim() || !email.trim()) { onError("Fill in every field."); return; }
      const { data: existing } = await supabase.from("profiles").select("id").eq("username", username.trim()).maybeSingle();
      if (existing) { onError("That username is taken. Try another."); return; }
    } else if (!email.trim()) {
      onError("Enter your email.");
      return;
    }
    setBusy(true);
    const { error: linkError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: window.location.origin,
        ...(isSignup
          ? { data: { username: username.trim(), name: name.trim() }, shouldCreateUser: true }
          : { shouldCreateUser: false }),
      },
    });
    setBusy(false);
    if (linkError) { onError(linkError.message || linkError.error_description || "Something went wrong. Try again."); return; }
    setLinkSent(true);
  }

  const heroCopy = isSignup
    ? { title: <>A studio, a gallery,<br />a <span className="sig-accent">home.</span></>, sub: "Free forever. Non-algorithmic. Yours entirely." }
    : { title: <>Come back to<br />your <span className="sig-accent">studio.</span></>, sub: "Every stroke you made is still here. So is your community." };

  const heroPanel = (side) => (
    <div className="sig-auth-hero-panel" style={{ position: "relative", overflow: "hidden", background: "linear-gradient(165deg, #0aa2d8 0%, #0593C6 50%, #036A91 100%)", color: "#fff" }}>
      <div style={{ position: "absolute", width: "60%", aspectRatio: "1", left: "-18%", top: "-14%", borderRadius: "50%", background: "#5CC3E6", opacity: 0.75, filter: "blur(70px)" }} />
      <div style={{ position: "absolute", width: "58%", aspectRatio: "1", right: "-16%", bottom: "-14%", borderRadius: "50%", background: "#D83995", opacity: 0.55, filter: "blur(70px)" }} />
      <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 11px)" }} />
      <div style={{ position: "absolute", top: 28, [side]: 40, cursor: "pointer" }} onClick={() => setPage("landing")}><Logo size={20} light /></div>
      <div style={{ position: "absolute", bottom: 48, left: 44, right: 44 }}>
        <div className="sig-serif" style={{ fontSize: "clamp(34px, 3.6vw, 52px)", lineHeight: 1.04, marginBottom: 14, textShadow: "0 4px 26px rgba(3,70,100,0.3)" }}>{heroCopy.title}</div>
        <div style={{ fontSize: 15, color: "rgba(255,255,255,0.96)", marginBottom: 22 }}>{heroCopy.sub}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["Honest critique", "Process shots", "Full resolution"].map((t) => (
            <span key={t} style={{ fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: 999, background: "rgba(3,70,100,0.4)", border: "1px solid rgba(255,255,255,0.35)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)" }}>{t}</span>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="sig-auth-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", minHeight: "100vh", background: "var(--white)", color: "var(--ink)" }}>
      {!isSignup && heroPanel("left")}
      <div className="sig-auth-form" style={{ padding: 48, display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 460, margin: "0 auto", width: "100%" }}>
        <div style={{ marginBottom: 30, cursor: "pointer" }} onClick={() => setPage("landing")}><Logo size={19} /></div>
        {linkSent ? (
          <>
            <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--fg-3)", marginBottom: 8 }}>ALMOST THERE</div>
            <div className="sig-serif" style={{ fontSize: 30, marginBottom: 14 }}>Check your inbox.</div>
            <div style={{ fontSize: 14, color: "var(--fg-2)", lineHeight: 1.6, marginBottom: 22 }}>
              We sent a sign-in link to <strong style={{ color: "var(--fg)" }}>{email.trim()}</strong>. Open it on this device and you'll be signed in automatically — no code to type.
            </div>
            <div style={{ padding: "14px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", fontSize: 13, lineHeight: 1.65, color: "var(--fg-2)", marginBottom: 20 }}>
              <div style={{ fontWeight: 500, color: "var(--fg)", marginBottom: 6 }}>Can't find it?</div>
              <div>It can take up to a minute. Check your <strong style={{ color: "var(--fg)" }}>Spam</strong>, <strong style={{ color: "var(--fg)" }}>Promotions</strong> and <strong style={{ color: "var(--fg)" }}>Updates</strong> folders.</div>
              <div style={{ marginTop: 6 }}>If it's in Spam, open it and tap <strong style={{ color: "var(--fg)" }}>Not spam</strong> so future sign-in emails reach your inbox.</div>
            </div>
            {error && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 14 }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--fg-3)" }}>
              <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => { setLinkSent(false); onError(""); }}>Use a different email</span>
              <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={sendLink}>{busy ? "…" : "Resend link"}</span>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--fg-3)", marginBottom: 8 }}>{isSignup ? "CREATE ACCOUNT" : "SIGN IN"}</div>
            <div className="sig-serif" style={{ fontSize: 32, marginBottom: 10 }}>{isSignup ? "Sign your work." : "Welcome back."}</div>
            <div style={{ fontSize: 13, color: "var(--fg-3)", marginBottom: 24 }}>No password needed — we'll email you a one-click sign-in link.</div>
            {isSignup && (
              <>
                <div style={{ marginBottom: 14 }}><label className="sig-label">Name</label><input className="sig-input" value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div style={{ marginBottom: 14 }}><label className="sig-label">Username</label><input className="sig-input" placeholder="ada_lovelace" value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, "_"))} /></div>
              </>
            )}
            <div style={{ marginBottom: 20 }}>
              <label className="sig-label">Email</label>
              <input className="sig-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendLink()} />
            </div>
            {error && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 14 }}>{error}</div>}
            <button className="sig-btn-primary" style={{ marginBottom: 14 }} disabled={busy} onClick={sendLink}>{busy ? "Sending…" : "Send sign-in link"}</button>
            <div style={{ textAlign: "center", fontSize: 13, color: "var(--fg-3)" }}>
              {isSignup
                ? <>Already have one? <span style={{ color: "var(--fg)", cursor: "pointer", textDecoration: "underline" }} onClick={() => { onError(""); setPage("signin"); }}>Sign in</span></>
                : <>New here? <span style={{ color: "var(--fg)", cursor: "pointer", textDecoration: "underline" }} onClick={() => { onError(""); setPage("signup"); }}>Create an account</span></>}
            </div>
            {isSignup && (
              <div style={{ textAlign: "center", fontSize: 12, color: "var(--fg-4)", marginTop: 14 }}>
                By creating an account you agree to our <span style={{ textDecoration: "underline", cursor: "pointer" }} onClick={() => setPage("terms")}>Terms</span> and <span style={{ textDecoration: "underline", cursor: "pointer" }} onClick={() => setPage("privacy")}>Privacy Policy</span>.
              </div>
            )}
          </>
        )}
      </div>
      {isSignup && heroPanel("right")}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modals                                                              */
/* ------------------------------------------------------------------ */

function ModalHeader({ title, onClose }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
      <div className="sig-serif" style={{ fontSize: 19 }}>{title}</div>
      <div style={{ cursor: "pointer", color: "var(--fg-3)", display: "flex" }} onClick={onClose}><Icon name="x" /></div>
    </div>
  );
}

function UploadModal({ userId, myWorks, onClose, onPublished, onSwitchToBulk }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [medium, setMedium] = useState("");
  const [tags, setTags] = useState("");
  const [critiqueRequested, setCritiqueRequested] = useState(false);
  const [allowDownload, setAllowDownload] = useState(false);
  const [aiCritique, setAiCritique] = useState(true);
  const [steps, setSteps] = useState([]);
  const [threadOn, setThreadOn] = useState(false);
  const [previousId, setPreviousId] = useState("");
  const [threadNote, setThreadNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);
  const stepsRef = useRef(null);

  function handleFile(f) {
    if (!f) return;
    if (f.size > MAX_UPLOAD_MB * 1024 * 1024) { setErr(`File is over ${MAX_UPLOAD_MB}MB.`); return; }
    setErr("");
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function addSteps(fileList) {
    const incoming = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    const room = MAX_PROCESS_SHOTS - steps.length;
    const accepted = [];
    let message = "";
    for (const f of incoming.slice(0, room)) {
      if (f.size > MAX_UPLOAD_MB * 1024 * 1024) { message = `Each process shot must be under ${MAX_UPLOAD_MB}MB.`; continue; }
      accepted.push({ file: f, preview: URL.createObjectURL(f) });
    }
    if (incoming.length > room) message = `You can add up to ${MAX_PROCESS_SHOTS} process shots.`;
    setErr(message);
    if (accepted.length) setSteps((s) => [...s, ...accepted]);
    if (stepsRef.current) stepsRef.current.value = "";
  }

  async function publish() {
    if (!file) { setErr("Add an image first."); return; }
    if (!title.trim()) { setErr("Give your work a title."); return; }
    if (!description.trim()) { setErr("Add a description — tell the story of this piece."); return; }
    if (!category) { setErr("Choose a category."); return; }
    const tagList = cleanTags(tags);
    if (tagList.length === 0) { setErr("Add at least one tag."); return; }
    if (threadOn && !previousId) { setErr("Choose the earlier piece this one builds on."); return; }
    if (threadOn && !threadNote.trim()) { setErr("Say briefly what you changed."); return; }

    setBusy(true);
    setErr("");
    let newId;
    let droppedDownload = false;
    try {
      const path = `${userId}/${Date.now()}.${extOf(file)}`;
      const { error: uploadError } = await supabase.storage.from("artwork").upload(path, file);
      if (uploadError) throw uploadError;
      const { data: pub } = supabase.storage.from("artwork").getPublicUrl(path);
      const payload = {
        user_id: userId,
        title: title.trim(),
        description: description.trim(),
        category,
        medium: medium.trim(),
        tags: tagList,
        image_url: pub.publicUrl,
        critique_requested: critiqueRequested,
      };
      if (allowDownload) payload.allow_download = true;
      const { data: created, error: insertError, droppedDownloadFlag } = await insertWork(payload);
      if (insertError) throw insertError;
      droppedDownload = !!droppedDownloadFlag;
      newId = created.id;
    } catch (e) {
      console.error("Publish failed:", e);
      setErr(e.message || "Upload failed. Check the browser console for details.");
      setBusy(false);
      return;
    }

    // Optional extras — the piece is already published, so a failure here shouldn't undo it.
    const warnings = [];
    if (droppedDownload) warnings.push("download setting");
    if (steps.length > 0) {
      try {
        const rows = [];
        for (let i = 0; i < steps.length; i++) {
          const p = `${userId}/${Date.now()}-step${i + 1}.${extOf(steps[i].file)}`;
          const { error: upErr } = await supabase.storage.from("artwork").upload(p, steps[i].file);
          if (upErr) throw upErr;
          const { data: pub } = supabase.storage.from("artwork").getPublicUrl(p);
          rows.push({ work_id: newId, image_url: pub.publicUrl, position: i });
        }
        const { error: stepErr } = await supabase.from("work_steps").insert(rows);
        if (stepErr) throw stepErr;
      } catch (e) {
        console.error("Process shots failed:", e);
        warnings.push("process shots");
      }
    }
    if (threadOn) {
      const { error: threadErr } = await supabase.from("growth_threads").insert({
        new_work_id: newId,
        previous_work_id: previousId,
        note: threadNote.trim(),
      });
      if (threadErr) { console.error("Growth thread failed:", threadErr); warnings.push("Growth Thread"); }
    }
    setBusy(false);
    if (warnings.length) {
      window.alert(`Your piece is published, but the ${warnings.join(" and ")} couldn't be saved. Make sure the latest database migration has been run.`);
    }
    if (critiqueRequested && aiCritique) requestAiCritique(newId).then(() => {}); // runs in the background
    onPublished();
  }

  return (
    <div className="sig-modal-overlay" onClick={onClose}>
      <div className="sig-modal-card sig-fade-in sig-scrollbar" style={{ maxWidth: 800 }} onClick={(e) => e.stopPropagation()}>
        <ModalHeader title="Publish new work" onClose={onClose} />
        <UploadTabs mode="single" onSingle={() => {}} onBulk={onSwitchToBulk} />
        <div className="sig-upload-modal-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
          <div style={{ padding: 22, borderRight: "1px solid var(--border)" }}>
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
              style={{ height: 260, border: "1.5px dashed var(--border-strong)", borderRadius: 8, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", overflow: "hidden" }}
            >
              {preview ? <img src={preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (
                <>
                  <Icon name="upload" />
                  <div style={{ marginTop: 10, fontSize: 14 }}>Drop the finished piece or click to browse</div>
                  <div style={{ fontSize: 12, color: "var(--fg-4)", marginTop: 4 }}>JPG · PNG · WEBP · UP TO {MAX_UPLOAD_MB}MB</div>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />

            <div style={{ marginTop: 20 }}>
              <label className="sig-label">Studio Log — process shots (optional)</label>
              <div style={{ fontSize: 12, color: "var(--fg-3)", marginBottom: 10, lineHeight: 1.5 }}>
                Add up to {MAX_PROCESS_SHOTS} in-progress images in order (sketch → linework → colour). Viewers can swipe through them.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {steps.map((s, i) => (
                  <div key={i} style={{ position: "relative", width: 64, height: 64, borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
                    <img src={s.preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <div style={{ position: "absolute", bottom: 2, left: 4, fontSize: 10, fontWeight: 600, textShadow: "0 1px 3px #000" }}>{i + 1}</div>
                    <div
                      onClick={() => setSteps((arr) => arr.filter((_, idx) => idx !== i))}
                      style={{ position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: "50%", background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                    >
                      <Icon name="x" size={10} />
                    </div>
                  </div>
                ))}
                {steps.length < MAX_PROCESS_SHOTS && (
                  <div
                    onClick={() => stepsRef.current?.click()}
                    style={{ width: 64, height: 64, borderRadius: 6, border: "1.5px dashed var(--border-strong)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--fg-3)" }}
                  >
                    <Icon name="plus" />
                  </div>
                )}
              </div>
              <input ref={stepsRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => addSteps(e.target.files)} />
            </div>
          </div>

          <div style={{ padding: 22 }}>
            <div style={{ marginBottom: 14 }}><label className="sig-label">Title *</label><input className="sig-input" placeholder="Give it a name" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div style={{ marginBottom: 14 }}><label className="sig-label">Description *</label><textarea className="sig-input" rows={3} placeholder="Tell the story of this piece" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div>
                <label className="sig-label">Category *</label>
                <select className="sig-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Select</option>
                  {CATEGORIES.filter((c) => c !== "All").map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div><label className="sig-label">Medium</label><input className="sig-input" placeholder="Oil on canvas" value={medium} onChange={(e) => setMedium(e.target.value)} /></div>
            </div>
            <div style={{ marginBottom: 14 }}><label className="sig-label">Tags * (comma separated)</label><input className="sig-input" placeholder="portrait, blue, dreamy" value={tags} onChange={(e) => setTags(e.target.value)} /></div>

            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--fg-2)", marginBottom: 14, cursor: "pointer", lineHeight: 1.5 }}>
              <input type="checkbox" style={{ marginTop: 3 }} checked={critiqueRequested} onChange={(e) => setCritiqueRequested(e.target.checked)} />
              Open this piece for critique — invite structured, honest feedback
            </label>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--fg-2)", marginBottom: 14, cursor: "pointer", lineHeight: 1.5 }}>
              <input type="checkbox" style={{ marginTop: 3 }} checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} />
              Let others download the full-resolution file
            </label>
            {critiqueRequested && (
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--fg-2)", marginBottom: 14, cursor: "pointer", lineHeight: 1.5 }}>
                <input type="checkbox" style={{ marginTop: 3 }} checked={aiCritique} onChange={(e) => setAiCritique(e.target.checked)} />
                <span>Also get an AI first-pass critique<span style={{ display: "block", fontSize: 12, color: "var(--fg-3)" }}>A resized copy of the image is sent to an AI service. It appears on the piece a few seconds after you publish.</span></span>
              </label>
            )}

            <div style={{ padding: 14, borderRadius: 10, border: "1px solid rgba(5,147,198,0.25)", background: "rgba(5,147,198,0.04)", marginBottom: 16 }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--fg)", cursor: "pointer", lineHeight: 1.5 }}>
                <input type="checkbox" style={{ marginTop: 3 }} checked={threadOn} onChange={(e) => setThreadOn(e.target.checked)} />
                <span><strong>Growth Thread</strong> — this piece builds on an earlier one, using feedback I got</span>
              </label>
              {threadOn && (
                <div style={{ marginTop: 12 }}>
                  {myWorks.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--fg-3)" }}>You have no earlier pieces yet. Publish this one first, then link future work to it.</div>
                  ) : (
                    <>
                      <label className="sig-label">Earlier piece</label>
                      <select className="sig-input" style={{ marginBottom: 10 }} value={previousId} onChange={(e) => setPreviousId(e.target.value)}>
                        <option value="">Choose one of your works</option>
                        {myWorks.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
                      </select>
                      <label className="sig-label">What did you change?</label>
                      <textarea className="sig-input" rows={2} placeholder="e.g. Fixed the proportions of the hands and warmed up the shadows" value={threadNote} onChange={(e) => setThreadNote(e.target.value)} />
                    </>
                  )}
                </div>
              )}
            </div>

            {err && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{err}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button className="sig-btn-primary" disabled={busy} onClick={publish}>{busy ? "Publishing…" : "Publish"}</button>
              <button className="sig-btn-outline" onClick={onClose}>Cancel</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const MAX_BULK = 20;

function UploadTabs({ mode, onSingle, onBulk }) {
  const tab = (id, label, onClick) => (
    <div
      key={id}
      onClick={onClick}
      style={{ padding: "12px 4px", marginRight: 22, cursor: "pointer", fontSize: 13, borderBottom: mode === id ? "2px solid var(--fg)" : "2px solid transparent", color: mode === id ? "var(--fg)" : "var(--fg-3)" }}
    >
      {label}
    </div>
  );
  return (
    <div style={{ display: "flex", padding: "0 22px", borderBottom: "1px solid var(--border)" }}>
      {tab("single", "One piece", onSingle)}
      {tab("bulk", "Several at once", onBulk)}
    </div>
  );
}

// Upload many pieces in one go. Category, tags, description and medium are shared;
// each image keeps its own editable title.
function BulkUploadModal({ userId, onClose, onPublished, onPartial, onSwitchToSingle }) {
  const [items, setItems] = useState([]);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [medium, setMedium] = useState("");
  const [tags, setTags] = useState("");
  const [critiqueRequested, setCritiqueRequested] = useState(false);
  const [allowDownload, setAllowDownload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [summary, setSummary] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const fileRef = useRef(null);
  const idRef = useRef(0);

  const patch = (id, changes) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...changes } : it)));

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    const room = MAX_BULK - items.length;
    const accepted = [];
    let message = "";
    for (const f of incoming.slice(0, room)) {
      if (f.size > MAX_UPLOAD_MB * 1024 * 1024) { message = `${f.name} is over ${MAX_UPLOAD_MB}MB, so it was skipped.`; continue; }
      accepted.push({ id: ++idRef.current, file: f, preview: URL.createObjectURL(f), title: titleFromFilename(f.name), status: "ready", error: "" });
    }
    if (incoming.length > room) message = `You can upload up to ${MAX_BULK} pieces at a time.`;
    setErr(message);
    setSummary(null);
    if (accepted.length > 0) setItems((list) => [...list, ...accepted]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function publishAll() {
    const targets = items.filter((it) => it.status !== "done");
    if (targets.length === 0) { setErr("Add some images first."); return; }
    if (!description.trim()) { setErr("Add a description — it's shared by every piece (you can edit each later)."); return; }
    if (!category) { setErr("Choose a category."); return; }
    const tagList = cleanTags(tags);
    if (tagList.length === 0) { setErr("Add at least one tag."); return; }
    if (targets.some((it) => !it.title.trim())) { setErr("Every piece needs a title."); return; }

    setBusy(true);
    setErr("");
    setSummary(null);
    setProgress({ done: 0, total: targets.length });
    let ok = 0;
    let failed = 0;
    let droppedFlag = false;

    await runPool(targets, 3, async (item) => {
      patch(item.id, { status: "uploading", error: "" });
      try {
        const path = `${userId}/${Date.now()}-${item.id}.${extOf(item.file)}`;
        const { error: upErr } = await supabase.storage.from("artwork").upload(path, item.file);
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("artwork").getPublicUrl(path);
        const payload = {
          user_id: userId,
          title: item.title.trim(),
          description: description.trim(),
          category,
          medium: medium.trim(),
          tags: tagList,
          image_url: pub.publicUrl,
          critique_requested: critiqueRequested,
        };
        if (allowDownload) payload.allow_download = true;
        const res = await insertWork(payload);
        if (res.error) throw res.error;
        if (res.droppedDownloadFlag) droppedFlag = true;
        patch(item.id, { status: "done" });
        ok++;
      } catch (e) {
        console.error("Bulk upload failed for", item.file.name, e);
        patch(item.id, { status: "error", error: e.message || "Upload failed" });
        failed++;
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    });

    setBusy(false);
    if (droppedFlag) window.alert("Your pieces are published, but the download setting couldn't be saved. Run migration-batch-3.sql in Supabase.");
    if (failed === 0) { onPublished(); return; }
    setSummary({ ok, failed });
    if (ok > 0) onPartial?.();
  }

  const doneCount = items.filter((it) => it.status === "done").length;
  const statusLabel = { ready: "", uploading: "Uploading…", done: "Published", error: "Failed" };

  return (
    <div className="sig-modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="sig-modal-card sig-fade-in sig-scrollbar" style={{ maxWidth: 820 }} onClick={(e) => e.stopPropagation()}>
        <ModalHeader title="Publish new work" onClose={busy ? () => {} : onClose} />
        <UploadTabs mode="bulk" onSingle={busy ? () => {} : onSwitchToSingle} onBulk={() => {}} />
        <div style={{ padding: 22 }}>
          <div
            onClick={() => !busy && fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (!busy) addFiles(e.dataTransfer.files); }}
            style={{ border: "1.5px dashed var(--border-strong)", borderRadius: 10, padding: items.length ? "16px" : "34px 16px", textAlign: "center", cursor: busy ? "default" : "pointer", marginBottom: 18 }}
          >
            <Icon name="upload" />
            <div style={{ marginTop: 8, fontSize: 14 }}>{items.length ? "Add more images" : `Drop up to ${MAX_BULK} images or click to browse`}</div>
            <div style={{ fontSize: 12, color: "var(--fg-4)", marginTop: 4 }}>JPG · PNG · WEBP · UP TO {MAX_UPLOAD_MB}MB EACH · {items.length}/{MAX_BULK} ADDED</div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => addFiles(e.target.files)} />

          {items.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginBottom: 22 }}>
              {items.map((it) => (
                <div key={it.id} style={{ borderRadius: 8, overflow: "hidden", border: `1px solid ${it.status === "error" ? "rgba(196,38,63,0.7)" : "var(--border)"}`, background: "var(--white)" }}>
                  <div style={{ position: "relative", aspectRatio: "1/1" }}>
                    <img src={it.preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: it.status === "done" ? 0.45 : 1 }} />
                    {it.status !== "ready" && (
                      <div style={{ position: "absolute", left: 6, bottom: 6, fontSize: 10, fontWeight: 600, letterSpacing: "0.04em", padding: "3px 8px", borderRadius: 999, background: it.status === "error" ? "var(--danger)" : it.status === "done" ? "var(--sky-700)" : "rgba(0,0,0,0.7)", color: it.status === "uploading" ? "var(--fg)" : "#0a0a0a" }}>
                        {statusLabel[it.status]}
                      </div>
                    )}
                    {!busy && it.status !== "done" && (
                      <div
                        onClick={() => setItems((list) => list.filter((x) => x.id !== it.id))}
                        style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: "50%", background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                      >
                        <Icon name="x" size={12} />
                      </div>
                    )}
                  </div>
                  <input
                    className="sig-input"
                    style={{ borderRadius: 0, border: "none", borderTop: "1px solid var(--border)", fontSize: 12, padding: "8px 10px" }}
                    value={it.title}
                    disabled={busy || it.status === "done"}
                    onChange={(e) => patch(it.id, { title: e.target.value })}
                    placeholder="Title"
                  />
                  {it.status === "error" && <div style={{ fontSize: 11, color: "var(--danger)", padding: "6px 10px 8px" }}>{it.error}</div>}
                </div>
              ))}
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <label className="sig-label">Description * (shared by every piece)</label>
            <textarea className="sig-input" rows={2} placeholder="Tell the story of this set" value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
          </div>
          <div className="sig-settings-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div>
              <label className="sig-label">Category *</label>
              <select className="sig-input" value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
                <option value="">Select</option>
                {CATEGORIES.filter((c) => c !== "All").map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div><label className="sig-label">Medium</label><input className="sig-input" placeholder="Oil on canvas" value={medium} onChange={(e) => setMedium(e.target.value)} disabled={busy} /></div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className="sig-label">Tags * (comma separated, shared)</label>
            <input className="sig-input" placeholder="portrait, blue, dreamy" value={tags} onChange={(e) => setTags(e.target.value)} disabled={busy} />
          </div>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--fg-2)", marginBottom: 10, cursor: "pointer", lineHeight: 1.5 }}>
            <input type="checkbox" style={{ marginTop: 3 }} checked={critiqueRequested} onChange={(e) => setCritiqueRequested(e.target.checked)} disabled={busy} />
            Open these pieces for critique
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--fg-2)", marginBottom: 16, cursor: "pointer", lineHeight: 1.5 }}>
            <input type="checkbox" style={{ marginTop: 3 }} checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} disabled={busy} />
            Let others download the full-resolution files
          </label>

          {busy && <div style={{ fontSize: 13, color: "var(--fg-2)", marginBottom: 12 }}>Publishing… {progress.done} of {progress.total} done. Keep this window open.</div>}
          {summary && (
            <div style={{ fontSize: 13, color: "var(--warn)", marginBottom: 12 }}>
              {summary.ok} published, {summary.failed} failed. Fix or remove the failed ones, then publish again — the finished ones won't be duplicated.
            </div>
          )}
          {err && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{err}</div>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="sig-btn-primary" disabled={busy || items.length === 0} onClick={publishAll}>
              {busy ? "Publishing…" : summary ? "Retry failed" : `Publish ${items.length || ""} piece${items.length === 1 ? "" : "s"}`.replace("  ", " ")}
            </button>
            <button className="sig-btn-outline" disabled={busy} onClick={() => { if (doneCount > 0) onPartial?.(); onClose(); }}>{doneCount > 0 ? "Close" : "Cancel"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditModal({ work, onClose, onSaved }) {
  const [title, setTitle] = useState(work.title || "");
  const [description, setDescription] = useState(work.description || "");
  const [category, setCategory] = useState(work.category || "");
  const [medium, setMedium] = useState(work.medium || "");
  const [tags, setTags] = useState((work.tags || []).join(", "));
  const [critiqueRequested, setCritiqueRequested] = useState(!!work.critique_requested);
  const hasDownloadColumn = typeof work.allow_download === "boolean";
  const [allowDownload, setAllowDownload] = useState(!!work.allow_download);
  const [steps, setSteps] = useState([]); // saved process shots
  const [stepsLoaded, setStepsLoaded] = useState(false);
  const [removedIds, setRemovedIds] = useState([]);
  const [newSteps, setNewSteps] = useState([]); // [{ file, preview }]
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const stepsRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("work_steps").select("*").eq("work_id", work.id).order("position", { ascending: true });
      if (!error) setSteps(data || []);
      setStepsLoaded(!error);
    })();
  }, [work.id]);

  const keptSteps = steps.filter((st) => !removedIds.includes(st.id));
  const room = MAX_PROCESS_SHOTS - keptSteps.length - newSteps.length;

  function addNew(fileList) {
    const incoming = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    const accepted = [];
    let message = "";
    for (const f of incoming.slice(0, Math.max(room, 0))) {
      if (f.size > MAX_UPLOAD_MB * 1024 * 1024) { message = `Each process shot must be under ${MAX_UPLOAD_MB}MB.`; continue; }
      accepted.push({ file: f, preview: URL.createObjectURL(f) });
    }
    if (incoming.length > room) message = `A piece can have up to ${MAX_PROCESS_SHOTS} process shots.`;
    setErr(message);
    if (accepted.length > 0) setNewSteps((list) => [...list, ...accepted]);
    if (stepsRef.current) stepsRef.current.value = "";
  }

  async function save() {
    if (!title.trim()) { setErr("Give your work a title."); return; }
    if (!description.trim()) { setErr("Add a description."); return; }
    if (!category) { setErr("Choose a category."); return; }
    const tagList = cleanTags(tags);
    if (tagList.length === 0) { setErr("Add at least one tag."); return; }
    setBusy(true);
    setErr("");
    const changes = { title: title.trim(), description: description.trim(), category, medium: medium.trim(), tags: tagList, critique_requested: critiqueRequested };
    if (hasDownloadColumn) changes.allow_download = allowDownload;
    const { error } = await supabase.from("works").update(changes).eq("id", work.id);
    if (error) { setBusy(false); setErr(error.message); return; }

    try {
      if (removedIds.length > 0) {
        const gone = steps.filter((st) => removedIds.includes(st.id));
        const { error: delErr } = await supabase.from("work_steps").delete().in("id", removedIds);
        if (delErr) throw delErr;
        const paths = gone.map((st) => pathFromUrl(st.image_url)).filter(Boolean);
        if (paths.length > 0) await supabase.storage.from("artwork").remove(paths);
      }
      if (newSteps.length > 0) {
        const start = keptSteps.length > 0 ? Math.max(...keptSteps.map((st) => st.position)) + 1 : 0;
        const rows = [];
        for (let i = 0; i < newSteps.length; i++) {
          const path = `${work.user_id}/${Date.now()}-step${i + 1}.${extOf(newSteps[i].file)}`;
          const { error: upErr } = await supabase.storage.from("artwork").upload(path, newSteps[i].file);
          if (upErr) throw upErr;
          const { data: pub } = supabase.storage.from("artwork").getPublicUrl(path);
          rows.push({ work_id: work.id, image_url: pub.publicUrl, position: start + i });
        }
        const { error: insErr } = await supabase.from("work_steps").insert(rows);
        if (insErr) throw insErr;
      }
    } catch (e) {
      console.error("Process shots failed:", e);
      setBusy(false);
      setErr(`Your changes were saved, but the process shots failed: ${e.message}. Make sure migration-batch-2.sql has been run.`);
      return;
    }
    setBusy(false);
    onSaved();
  }

  const thumb = (src, key, onRemove, badge) => (
    <div key={key} style={{ position: "relative", width: 64, height: 64, borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
      <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      {badge && <div style={{ position: "absolute", bottom: 2, left: 3, fontSize: 9, fontWeight: 600, textShadow: "0 1px 3px #000" }}>{badge}</div>}
      <div onClick={onRemove} style={{ position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: "50%", background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
        <Icon name="x" size={10} />
      </div>
    </div>
  );

  return (
    <div className="sig-modal-overlay" onClick={onClose}>
      <div className="sig-modal-card sig-fade-in sig-scrollbar" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <ModalHeader title="Edit work" onClose={onClose} />
        <div style={{ padding: 22 }}>
          <div style={{ marginBottom: 14 }}><label className="sig-label">Title</label><input className="sig-input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div style={{ marginBottom: 14 }}><label className="sig-label">Description</label><textarea className="sig-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div>
              <label className="sig-label">Category</label>
              <select className="sig-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.filter((c) => c !== "All").map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div><label className="sig-label">Medium</label><input className="sig-input" value={medium} onChange={(e) => setMedium(e.target.value)} /></div>
          </div>
          <div style={{ marginBottom: 14 }}><label className="sig-label">Tags</label><input className="sig-input" value={tags} onChange={(e) => setTags(e.target.value)} /></div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--fg-2)", marginBottom: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={critiqueRequested} onChange={(e) => setCritiqueRequested(e.target.checked)} />
            Open this piece for critique
          </label>
          {hasDownloadColumn && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--fg-2)", marginBottom: 16, cursor: "pointer" }}>
              <input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} />
              Let others download the full-resolution file
            </label>
          )}

          <div style={{ marginBottom: 18 }}>
            <label className="sig-label">Studio Log — process shots</label>
            {!stepsLoaded ? (
              <div style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.5 }}>Process shots aren't available yet. Run migration-batch-2.sql in Supabase, then reopen this window.</div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: "var(--fg-3)", marginBottom: 10, lineHeight: 1.5 }}>
                  Up to {MAX_PROCESS_SHOTS}, in order — viewers swipe through them before the finished piece.
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {keptSteps.map((st, i) => thumb(st.image_url, st.id, () => setRemovedIds((ids) => [...ids, st.id]), String(i + 1)))}
                  {newSteps.map((st, i) => thumb(st.preview, `new-${i}`, () => setNewSteps((list) => list.filter((_, idx) => idx !== i)), "NEW"))}
                  {room > 0 && (
                    <div onClick={() => stepsRef.current?.click()} style={{ width: 64, height: 64, borderRadius: 6, border: "1.5px dashed var(--border-strong)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--fg-3)" }}>
                      <Icon name="plus" />
                    </div>
                  )}
                </div>
                <input ref={stepsRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => addNew(e.target.files)} />
              </>
            )}
          </div>

          {err && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>{err}</div>}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="sig-btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</button>
            <button className="sig-btn-outline" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const REPORT_REASONS = [
  "Not the poster's original work",
  "Sexually explicit or inappropriate content",
  "Harassment or hate speech",
  "Spam or scam",
  "Endangers or exploits a minor",
  "Other",
];

function ReportModal({ work, reporterId, onClose, onSubmitted }) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!reason) { setErr("Choose a reason."); return; }
    setBusy(true);
    setErr("");
    const { error } = await supabase.from("reports").insert({ reporter_id: reporterId, work_id: work.id, reason, details: details.trim() });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSubmitted();
  }

  return (
    <div className="sig-modal-overlay" onClick={onClose}>
      <div className="sig-modal-card sig-fade-in sig-scrollbar" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <ModalHeader title="Report this work" onClose={onClose} />
        <div style={{ padding: 22 }}>
          <div style={{ fontSize: 13, color: "var(--fg-3)", marginBottom: 18 }}>
            Reports are reviewed by Signature moderators. The artist is never told who reported.
          </div>
          <label className="sig-label">Reason</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {REPORT_REASONS.map((r) => (
              <label key={r} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
                <input type="radio" name="report-reason" checked={reason === r} onChange={() => setReason(r)} /> {r}
              </label>
            ))}
          </div>
          <label className="sig-label">Additional details (optional)</label>
          <textarea className="sig-input" rows={3} style={{ marginBottom: 16 }} value={details} onChange={(e) => setDetails(e.target.value)} />
          {err && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{err}</div>}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="sig-btn-primary" disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit report"}</button>
            <button className="sig-btn-outline" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Thumbnail grid with checkmarks. Used to add/remove works inside a collection.
function WorkPickerModal({ title, works, initialSelected, onClose, onSave }) {
  const [selected, setSelected] = useState(new Set(initialSelected));
  const [busy, setBusy] = useState(false);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    await onSave(Array.from(selected));
    setBusy(false);
  }

  return (
    <div className="sig-modal-overlay" onClick={onClose}>
      <div className="sig-modal-card sig-fade-in sig-scrollbar" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <ModalHeader title={title} onClose={onClose} />
        <div style={{ padding: 22 }}>
          {works.length === 0 ? (
            <div style={{ fontSize: 14, color: "var(--fg-3)", padding: "20px 0" }}>You haven't published any work yet.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
              {works.map((w) => {
                const on = selected.has(w.id);
                return (
                  <div
                    key={w.id}
                    onClick={() => toggle(w.id)}
                    style={{ position: "relative", aspectRatio: "1/1", borderRadius: 6, overflow: "hidden", cursor: "pointer", outline: on ? "2px solid var(--fg)" : "1px solid var(--border)", outlineOffset: on ? -2 : -1 }}
                  >
                    <img src={w.image_url} alt={w.title} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: on ? 1 : 0.7 }} />
                    <div style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: "50%", border: "2px solid var(--fg)", background: on ? "var(--fg)" : "rgba(0,0,0,0.45)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {on && <Icon name="check" size={13} />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 20, gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, color: "var(--fg-3)" }}>{selected.size} selected</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="sig-btn-outline" onClick={onClose}>Cancel</button>
              <button className="sig-btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Adds the works selected on the profile page to an existing (or new) collection.
function AddToCollectionModal({ profile, workIds, onClose, onDone }) {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chosen, setChosen] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("collections").select("*").eq("user_id", profile.id).order("created_at", { ascending: false });
      const list = data || [];
      setCollections(list);
      setChosen(list.length > 0 ? list[0].id : "new");
      setLoading(false);
    })();
  }, [profile.id]);

  async function save() {
    setErr("");
    setBusy(true);
    let error;
    if (chosen === "new") {
      if (!newName.trim()) { setErr("Name your new collection."); setBusy(false); return; }
      ({ error } = await supabase.from("collections").insert({ user_id: profile.id, name: newName.trim(), work_ids: workIds }));
    } else {
      const col = collections.find((c) => c.id === chosen);
      const merged = Array.from(new Set([...(col?.work_ids || []), ...workIds]));
      ({ error } = await supabase.from("collections").update({ work_ids: merged }).eq("id", chosen));
    }
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onDone(workIds.length);
  }

  return (
    <div className="sig-modal-overlay" onClick={onClose}>
      <div className="sig-modal-card sig-fade-in sig-scrollbar" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <ModalHeader title={`Add ${workIds.length} work${workIds.length === 1 ? "" : "s"} to a collection`} onClose={onClose} />
        <div style={{ padding: 22 }}>
          {loading ? (
            <div style={{ fontSize: 14, color: "var(--fg-3)" }}>Loading…</div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                {collections.map((c) => (
                  <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
                    <input type="radio" name="collection" checked={chosen === c.id} onChange={() => setChosen(c.id)} />
                    {c.name} <span style={{ color: "var(--fg-4)", fontSize: 12 }}>· {(c.work_ids || []).length} works</span>
                  </label>
                ))}
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
                  <input type="radio" name="collection" checked={chosen === "new"} onChange={() => setChosen("new")} />
                  New collection…
                </label>
              </div>
              {chosen === "new" && (
                <input className="sig-input" style={{ marginBottom: 16 }} placeholder="Collection name (e.g. Sketchbook 2026)" value={newName} onChange={(e) => setNewName(e.target.value)} />
              )}
              {err && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{err}</div>}
              <div style={{ display: "flex", gap: 10 }}>
                <button className="sig-btn-primary" disabled={busy} onClick={save}>{busy ? "Adding…" : "Add"}</button>
                <button className="sig-btn-outline" onClick={onClose}>Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Artwork detail                                                      */
/* ------------------------------------------------------------------ */

// The AI's first-pass critique. Clearly labelled, and always shown apart from human comments.
function AiCritiqueCard({ critique, isOwner, busy, onRegenerate, onRemove, message }) {
  const c = critique.content || {};
  return (
    <div style={{ marginBottom: 18, padding: 14, borderRadius: 10, border: "1px solid rgba(5,147,198,0.35)", background: "rgba(5,147,198,0.06)" }}>
      <div style={{ fontSize: 10, letterSpacing: "0.12em", fontWeight: 600, color: "var(--sky-700)", marginBottom: 4 }}>AI CRITIQUE · FIRST PASS</div>
      <div style={{ fontSize: 11, color: "var(--fg-3)", marginBottom: 12, lineHeight: 1.5 }}>
        Written by an AI, so it can be wrong. Treat it as a starting point — feedback from people is below.
      </div>
      {c.summary && <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>{c.summary}</div>}
      {AI_AXES.map(([key, label]) => c[key] && (
        <div key={key} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", color: "var(--sky)", fontWeight: 600, marginBottom: 2 }}>{label.toUpperCase()}</div>
          <div style={{ fontSize: 13, lineHeight: 1.55 }}><span style={{ color: "var(--fg-3)" }}>Working: </span>{c[key].working}</div>
          <div style={{ fontSize: 13, lineHeight: 1.55 }}><span style={{ color: "var(--fg-3)" }}>Try: </span>{c[key].try}</div>
        </div>
      ))}
      {c.questions?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", color: "var(--sky)", fontWeight: 600, marginBottom: 4 }}>QUESTIONS FOR REVIEWERS</div>
          {c.questions.map((q, i) => <div key={i} style={{ fontSize: 13, lineHeight: 1.55 }}>• {q}</div>)}
        </div>
      )}
      {isOwner && (
        <div style={{ display: "flex", gap: 14, marginTop: 14, fontSize: 12, color: "var(--fg-3)" }}>
          <span style={{ cursor: busy ? "default" : "pointer", textDecoration: "underline" }} onClick={() => !busy && onRegenerate()}>{busy ? "Writing a new one…" : "Write a new one"}</span>
          <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={onRemove}>Remove</span>
        </div>
      )}
      {message && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{message}</div>}
    </div>
  );
}

const EMPTY_THREAD = { previous: null, critiques: [], note: "", newer: [] };

function ThreadThumb({ label, work, onClick, current }) {
  return (
    <div onClick={onClick} style={{ cursor: onClick ? "pointer" : "default", minWidth: 0 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.08em", color: current ? "var(--sky-700)" : "var(--fg-3)", marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ aspectRatio: "1/1", borderRadius: 6, overflow: "hidden", outline: current ? "2px solid var(--sky-700)" : "1px solid var(--border)", outlineOffset: -1 }}>
        <img src={work.image_url} alt={work.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </div>
      <div style={{ fontSize: 12, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{work.title}</div>
    </div>
  );
}

function WorkDetail({ work, profile, onBack, onDelete, onViewProfile, onEdit, onOpenWork, onTagClick, onAdminRemove }) {
  const [comment, setComment] = useState("");
  const [likes, setLikes] = useState([]);
  const [comments, setComments] = useState([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isCritique, setIsCritique] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [steps, setSteps] = useState([]);
  const [slide, setSlide] = useState(null); // null = the finished piece
  const [thread, setThread] = useState(EMPTY_THREAD);
  const touchStartX = useRef(null);
  const [hinted, setHinted] = useState(false);
  const [stepsError, setStepsError] = useState("");
  const [ai, setAi] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState("");

  const isOwner = profile?.id === work.user_id;

  useEffect(() => {
    let cancelled = false;
    setSlide(null);
    setSteps([]);
    setThread(EMPTY_THREAD);
    setComment("");
    setIsCritique(false);
    setIsFollowing(false);
    setHinted(false);
    setStepsError("");
    setAi(null);
    setAiBusy(false);
    setAiMsg("");

    (async () => {
      const [likeRes, commentRes, stepRes] = await Promise.all([
        supabase.from("likes").select("user_id").eq("work_id", work.id),
        supabase.from("comments").select("*, profiles!comments_user_id_fkey(name, username)").eq("work_id", work.id).order("created_at", { ascending: false }),
        supabase.from("work_steps").select("*").eq("work_id", work.id).order("position", { ascending: true }),
      ]);
      if (cancelled) return;
      setLikes(likeRes.data || []);
      setComments(commentRes.data || []);
      setSteps(stepRes.error ? [] : stepRes.data || []);
      setStepsError(stepRes.error ? stepRes.error.message : "");
      const aiRes = await supabase.from("ai_critiques").select("*").eq("work_id", work.id).maybeSingle();
      if (!cancelled && !aiRes.error) setAi(aiRes.data || null);

      if (profile && profile.id !== work.user_id) {
        const { data: followRow } = await supabase.from("follows").select("follower_id").eq("follower_id", profile.id).eq("following_id", work.user_id).maybeSingle();
        if (!cancelled) setIsFollowing(!!followRow);
      }

      // Growth Thread: the earlier piece this one builds on, and any later piece that builds on this one.
      const next = { ...EMPTY_THREAD, newer: [] };
      const { data: asNew } = await supabase.from("growth_threads").select("*").eq("new_work_id", work.id).maybeSingle();
      if (asNew) {
        const { data: prev } = await supabase.from("works").select("id, title, image_url").eq("id", asNew.previous_work_id).maybeSingle();
        if (prev) {
          const critSelect = "*, profiles!comments_user_id_fkey(name, username)";
          let { data: crit } = await supabase.from("comments").select(critSelect).eq("work_id", prev.id).eq("is_critique", true).order("created_at", { ascending: true }).limit(3);
          if (!crit || crit.length === 0) {
            ({ data: crit } = await supabase.from("comments").select(critSelect).eq("work_id", prev.id).order("created_at", { ascending: true }).limit(3));
          }
          next.previous = prev;
          next.note = asNew.note || "";
          next.critiques = crit || [];
        }
      }
      const { data: laterRows } = await supabase.from("growth_threads").select("new_work_id").eq("previous_work_id", work.id);
      if (laterRows && laterRows.length > 0) {
        const { data: later } = await supabase.from("works").select("id, title, image_url").in("id", laterRows.map((r) => r.new_work_id));
        next.newer = later || [];
      }
      if (!cancelled) setThread(next);
    })();

    return () => { cancelled = true; };
  }, [work.id, profile?.id]);

  /* ---- slides (process shots + final piece) ---- */
  const slides = [...steps.map((s, i) => ({ src: s.image_url, label: `Step ${i + 1}` })), { src: work.image_url, label: "Final" }];
  const current = slide === null ? slides.length - 1 : Math.min(slide, slides.length - 1);
  const go = (delta) => {
    setHinted(true);
    setSlide(Math.max(0, Math.min(slides.length - 1, current + delta)));
  };

  // Left / right arrow keys flip through the process shots on a computer.
  useEffect(() => {
    function onKey(e) {
      if (e.target && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function onTouchStart(e) { touchStartX.current = e.touches[0].clientX; }
  function onTouchEnd(e) {
    if (touchStartX.current === null || slides.length < 2) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  }

  /* ---- actions ---- */
  function copyShareLink() {
    // Lets the artist know (and emails them, if they have that on). Safe if it fails.
    if (profile && !isOwner) supabase.rpc("record_share", { p_work_id: work.id }).then(() => {});
    const url = `${window.location.origin}${window.location.pathname}?work=${work.id}`;
    const done = () => { setShareCopied(true); setTimeout(() => setShareCopied(false), 1800); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done).catch(() => window.prompt("Copy this link:", url));
    else window.prompt("Copy this link:", url);
  }

  async function toggleFollow() {
    if (!profile) return;
    if (isFollowing) {
      await supabase.from("follows").delete().eq("follower_id", profile.id).eq("following_id", work.user_id);
      setIsFollowing(false);
    } else {
      await supabase.from("follows").insert({ follower_id: profile.id, following_id: work.user_id });
      setIsFollowing(true);
    }
  }

  const liked = !!profile && likes.some((l) => l.user_id === profile.id);

  async function toggleLike() {
    if (!profile) return;
    if (liked) {
      await supabase.from("likes").delete().eq("user_id", profile.id).eq("work_id", work.id);
      setLikes(likes.filter((l) => l.user_id !== profile.id));
    } else {
      await supabase.from("likes").insert({ user_id: profile.id, work_id: work.id });
      setLikes([...likes, { user_id: profile.id }]);
    }
  }

  async function postComment() {
    if (!comment.trim() || !profile) return;
    const { data, error } = await supabase
      .from("comments")
      .insert({ user_id: profile.id, work_id: work.id, text: comment.trim(), is_critique: isCritique })
      .select("*, profiles!comments_user_id_fkey(name, username)")
      .single();
    if (!error && data) setComments([data, ...comments]);
    setComment("");
    setIsCritique(false);
  }

  async function askAi(regenerate) {
    setAiBusy(true);
    setAiMsg("");
    const result = await requestAiCritique(work.id, { regenerate });
    setAiBusy(false);
    if (result.critique) setAi(result.critique);
    else setAiMsg(result.code === "not_configured" ? "AI critique isn't switched on yet. The site owner needs to finish setting it up." : result.error);
  }

  async function removeAi() {
    if (!window.confirm("Remove the AI critique from this piece?")) return;
    const { error } = await supabase.from("ai_critiques").delete().eq("work_id", work.id);
    if (error) { setAiMsg(error.message); return; }
    setAi(null);
  }

  // Exports the critique on this piece as one clean text file the artist can keep.
  function downloadCritiqueSummary() {
    const critiques = comments.filter((c) => c.is_critique);
    const list = (critiques.length > 0 ? critiques : comments).slice().reverse(); // oldest first
    const noun = critiques.length > 0 ? "critique" : "comment";
    const lines = [
      "CRITIQUE SUMMARY",
      "================",
      "",
      `Piece:    ${work.title}`,
      `Artist:   ${work.profiles?.name || ""} (@${work.profiles?.username || ""})`,
    ];
    if (work.category) lines.push(`Category: ${work.category}`);
    if (work.medium) lines.push(`Medium:   ${work.medium}`);
    lines.push(`Exported: ${new Date().toLocaleDateString()}`);
    if (ai) {
      const a = ai.content || {};
      lines.push("", "AI FIRST-PASS CRITIQUE (written by an AI, so it can be wrong)", "-".repeat(40), a.summary || "");
      for (const [key, label] of AI_AXES) {
        if (a[key]) lines.push("", label, `  Working: ${a[key].working}`, `  Try: ${a[key].try}`);
      }
      if (a.questions?.length) lines.push("", "Questions to ask reviewers:", ...a.questions.map((q) => `  - ${q}`));
    }
    if (list.length > 0) {
      lines.push("", `FEEDBACK FROM PEOPLE: ${list.length} ${noun}${list.length === 1 ? "" : "s"}`, "-".repeat(40));
      list.forEach((c, i) => {
        lines.push("", `${i + 1}. ${c.profiles?.name || "Someone"} — ${new Date(c.created_at).toLocaleDateString()}`, `   ${c.text.replace(/\n/g, "\n   ")}`);
      });
    }
    const blob = new Blob([lines.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `critique-${(work.title || "piece").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const linkStyle = { cursor: "pointer", color: "var(--fg-3)", display: "flex", alignItems: "center", gap: 4, fontSize: 13 };
  const hasThread = thread.previous || thread.newer.length > 0;

  return (
    <div className="sig-work-detail">
      {/* ---------------- image pane ---------------- */}
      <div className="sig-work-image-pane t-blue" style={{ paddingBottom: steps.length > 0 ? 96 : 0 }} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div style={{ position: "absolute", top: 20, left: 20, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "var(--fg)", fontSize: 14, zIndex: 3, background: "rgba(0,0,0,0.35)", padding: "6px 12px 6px 8px", borderRadius: 999 }} onClick={onBack}>
          <Icon name="back" /> Back
        </div>

        <img src={slides[current].src} alt={work.title} style={{ maxWidth: "calc(100% - 56px)", maxHeight: "calc(100% - 56px)", objectFit: "contain", borderRadius: 20, border: "6px solid #FCFFFF", boxShadow: "0 34px 70px rgba(2,40,58,0.5)", background: "#FCFFFF" }} />

        {slides.length > 1 && (
          <>
            <div style={{ position: "absolute", top: 20, right: 20, fontSize: 11, letterSpacing: "0.08em", background: "rgba(0,0,0,0.5)", padding: "5px 10px", borderRadius: 999, zIndex: 3 }}>
              {slides[current].label.toUpperCase()} · {current + 1}/{slides.length}
            </div>
            {current > 0 && (
              <div onClick={() => go(-1)} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 38, height: 38, borderRadius: "50%", background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 3 }}>
                <Icon name="back" size={20} />
              </div>
            )}
            {current < slides.length - 1 && (
              <div onClick={() => go(1)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 38, height: 38, borderRadius: "50%", background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 3 }}>
                <Icon name="chevR" size={20} />
              </div>
            )}
          </>
        )}

        {steps.length > 0 && !hinted && current === slides.length - 1 && (
          <div style={{ position: "absolute", bottom: 108, left: "50%", transform: "translateX(-50%)", zIndex: 3, pointerEvents: "none", background: "rgba(0,0,0,0.7)", padding: "7px 14px", borderRadius: 999, fontSize: 12, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="layers" size={13} /> Swipe or use the arrows to see the process
          </div>
        )}

        {steps.length > 0 && (
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 96, padding: "10px 16px", display: "flex", gap: 8, justifyContent: "center", alignItems: "center", background: "linear-gradient(transparent, rgba(0,0,0,0.6))", zIndex: 3 }}>
            {slides.map((s, i) => (
              <div key={i} onClick={() => { setHinted(true); setSlide(i); }} style={{ textAlign: "center", cursor: "pointer", opacity: i === current ? 1 : 0.55 }}>
                <div style={{ width: 56, height: 56, borderRadius: 6, overflow: "hidden", outline: i === current ? "2px solid var(--fg)" : "1px solid var(--border)", outlineOffset: -1 }}>
                  <img src={s.src} alt={s.label} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </div>
                <div style={{ fontSize: 9, marginTop: 3, letterSpacing: "0.05em" }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------------- side pane ---------------- */}
      <div className="sig-work-side-pane sig-scrollbar">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--fg-3)" }}>{(work.category || "").toUpperCase()}</div>
            {work.critique_requested && (
              <div style={{ fontSize: 10, letterSpacing: "0.06em", padding: "3px 8px", borderRadius: 999, background: "rgba(216,57,149,0.15)", color: "var(--accent-text)", fontWeight: 600 }}>CRITIQUE REQUESTED</div>
            )}
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--fg-3)" }}><Icon name="eye" /> {work.views || 0}</div>
            <div style={linkStyle} onClick={copyShareLink}><Icon name="share" /> {shareCopied ? "Copied" : "Share"}</div>
            {(isOwner || work.allow_download) && (
              <div style={linkStyle} onClick={() => downloadArtwork(work)} title="Save the full-resolution file"><Icon name="download" /> Download</div>
            )}
            {profile && !isOwner && <div style={linkStyle} onClick={() => setShowReport(true)}><Icon name="flag" /> Report</div>}
          </div>
        </div>

        <div className="sig-serif" style={{ fontSize: 26, margin: "8px 0 16px" }}>{work.title}</div>

        {isOwner && (
          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            <button className="sig-btn-outline" style={{ flex: 1, padding: "8px 14px", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={() => onEdit(work)}>
              <Icon name="edit" /> Edit
            </button>
            <button
              className="sig-btn-outline"
              style={{ flex: 1, padding: "8px 14px", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, borderColor: "rgba(216,57,149,0.4)", color: "var(--accent-text)" }}
              onClick={() => { if (window.confirm("Delete this artwork? This can't be undone.")) onDelete(work); }}
            >
              <Icon name="trash" /> Delete
            </button>
          </div>
        )}
        {isOwner && steps.length === 0 && !stepsError && (
          <div onClick={() => onEdit(work)} style={{ ...linkStyle, marginTop: -6, marginBottom: 16, fontSize: 12 }}>
            <Icon name="plus" size={13} /> Add process shots (Studio Log)
          </div>
        )}
        {isOwner && stepsError && (
          <div style={{ fontSize: 12, color: "var(--warn)", marginBottom: 16, lineHeight: 1.5 }}>
            Process shots couldn't be loaded ({stepsError}). Run migration-batch-2.sql in Supabase.
          </div>
        )}

        {profile?.is_admin && !isOwner && (
          <button
            className="sig-btn-outline"
            style={{ width: "100%", padding: "8px 14px", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 18, borderColor: "rgba(216,57,149,0.4)", color: "var(--accent-text)" }}
            onClick={() => onAdminRemove(work)}
          >
            <Icon name="shield" /> Remove (admin)
          </button>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--avatar)", overflow: "hidden", cursor: "pointer", flexShrink: 0 }} onClick={() => onViewProfile(work.user_id)}>
            {work.profiles?.avatar_url && <img src={work.profiles.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
          </div>
          <div style={{ flex: 1, cursor: "pointer", minWidth: 0 }} onClick={() => onViewProfile(work.user_id)}>
            <div style={{ fontSize: 14, fontWeight: 500, display: "flex", alignItems: "center" }}>
              {work.profiles?.name || "Unknown"}
              {work.profiles?.verified && <VerifiedBadge />}
            </div>
            <div style={{ fontSize: 12, color: "var(--fg-3)" }}>@{work.profiles?.username}</div>
          </div>
          {profile && !isOwner && (
            <button className={isFollowing ? "sig-btn-outline" : "sig-btn-primary"} style={{ padding: "6px 16px", fontSize: 12 }} onClick={toggleFollow}>
              {isFollowing ? "Following" : "Follow"}
            </button>
          )}
        </div>

        {work.description && <div style={{ fontSize: 14, color: "var(--fg-2)", lineHeight: 1.6, marginBottom: 16 }}>{work.description}</div>}

        {work.tags?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
            {work.tags.map((t) => (
              <span key={t} className="sig-chip" style={{ fontSize: 11, letterSpacing: "0.04em" }} onClick={() => onTagClick(t)}>
                <Icon name="tag" size={11} /> {t.toUpperCase()}
              </span>
            ))}
          </div>
        )}

        {hasThread && (
          <div style={{ marginBottom: 18, padding: 14, borderRadius: 10, border: "1px solid rgba(5,147,198,0.28)", background: "rgba(5,147,198,0.05)" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--sky-700)", fontWeight: 600, marginBottom: 12 }}>GROWTH THREAD</div>
            {thread.previous && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <ThreadThumb label="BEFORE" work={thread.previous} onClick={() => onOpenWork(thread.previous.id)} />
                  <ThreadThumb label="AFTER · THIS PIECE" work={work} current />
                </div>
                {thread.note && (
                  <div style={{ fontSize: 13, lineHeight: 1.55, marginTop: 12, color: "var(--fg)" }}>
                    <span style={{ color: "var(--fg-3)" }}>What changed: </span>{thread.note}
                  </div>
                )}
                {thread.critiques.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--fg-3)", marginBottom: 6 }}>FEEDBACK ON THE EARLIER PIECE</div>
                    {thread.critiques.map((c) => (
                      <div key={c.id} style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 6, paddingLeft: 10, borderLeft: "2px solid rgba(216,57,149,0.6)", color: "var(--fg-2)" }}>
                        <strong style={{ color: "var(--fg)" }}>{c.profiles?.name || "Someone"}:</strong> {c.text.length > 180 ? c.text.slice(0, 180) + "…" : c.text}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {thread.newer.length > 0 && (
              <div style={{ marginTop: thread.previous ? 14 : 0 }}>
                <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--fg-3)", marginBottom: 8 }}>LATER IMPROVED IN</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {thread.newer.map((n) => <ThreadThumb key={n.id} label="AFTER" work={n} onClick={() => onOpenWork(n.id)} />)}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 18, alignItems: "center", paddingBottom: 16, borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: profile ? "pointer" : "default", color: liked ? "var(--accent-text)" : "var(--fg-2)" }} onClick={toggleLike}>
            <Icon name="heart" /> {likes.length}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--fg-2)" }}><Icon name="comment" /> {comments.length}</div>
        </div>

        {isOwner && (comments.length > 0 || ai) && (
          <button className="sig-btn-outline" style={{ width: "100%", padding: "9px 14px", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 16 }} onClick={downloadCritiqueSummary}>
            <Icon name="download" /> Download critique summary
          </button>
        )}

        {ai && <AiCritiqueCard critique={ai} isOwner={isOwner} busy={aiBusy} onRegenerate={() => askAi(true)} onRemove={removeAi} message={aiMsg} />}
        {!ai && isOwner && work.critique_requested && (
          <div style={{ marginBottom: 18, padding: 14, borderRadius: 10, border: "1px dashed rgba(5,147,198,0.4)" }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Get an AI first-pass critique</div>
            <div style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.6, marginBottom: 10 }}>
              Feedback on composition, colour, technique and emotional impact in about 10 seconds. A resized copy of the image is sent to an AI service (Anthropic). A few per day are allowed.
            </div>
            <button className="sig-btn-outline" style={{ padding: "8px 16px", fontSize: 13 }} disabled={aiBusy} onClick={() => askAi(false)}>{aiBusy ? "Writing critique…" : "Get AI critique"}</button>
            {aiMsg && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>{aiMsg}</div>}
          </div>
        )}

        {profile ? (
          <div style={{ marginBottom: 16 }}>
            <textarea className="sig-input" rows={2} placeholder={work.critique_requested ? "Share honest, constructive feedback…" : "Leave a thoughtful comment…"} value={comment} onChange={(e) => setComment(e.target.value)} />
            {work.critique_requested && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--fg-3)", marginTop: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={isCritique} onChange={(e) => setIsCritique(e.target.checked)} /> Mark as structured critique
              </label>
            )}
            <button className="sig-btn-primary" style={{ marginTop: 8, padding: "8px 18px", fontSize: 13 }} onClick={postComment}>Post</button>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--fg-3)", marginBottom: 16 }}>Sign in to like, follow, or comment.</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {comments.map((c) => (
            <div
              key={c.id}
              style={{ fontSize: 13, padding: c.is_critique ? "10px 12px" : 0, background: c.is_critique ? "rgba(216,57,149,0.08)" : "transparent", borderRadius: c.is_critique ? 8 : 0, borderLeft: c.is_critique ? "2px solid var(--accent-text)" : "none" }}
            >
              {c.is_critique && <div style={{ fontSize: 10, color: "var(--accent-text)", fontWeight: 600, marginBottom: 3, letterSpacing: "0.04em" }}>CRITIQUE</div>}
              <span style={{ fontWeight: 500 }}>{c.profiles?.name || "Someone"}</span>
              <span style={{ color: "var(--fg-2)" }}> {c.text}</span>
            </div>
          ))}
        </div>
      </div>

      {showReport && profile && (
        <ReportModal
          work={work}
          reporterId={profile.id}
          onClose={() => setShowReport(false)}
          onSubmitted={() => { setShowReport(false); setReportSent(true); setTimeout(() => setReportSent(false), 2500); }}
        />
      )}
      {reportSent && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "var(--ink)", color: "#fff", padding: "10px 20px", borderRadius: 999, fontSize: 13, fontWeight: 500, zIndex: 200 }}>
          Report submitted. Thank you.
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Profile, notifications, collections, settings                       */
/* ------------------------------------------------------------------ */

function ProfilePage({ userId, currentProfile, onOpen, onFollowChanged }) {
  const [viewedProfile, setViewedProfile] = useState(null);
  const [works, setWorks] = useState([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState("");
  const isOwn = !!currentProfile && userId === currentProfile.id;

  useEffect(() => {
    let cancelled = false;
    setSelectMode(false);
    setSelected(new Set());
    (async () => {
      setLoading(true);
      const { data: p } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      const { data: w } = await queryWorks((q) => q.eq("user_id", userId).order("created_at", { ascending: false }));
      const { count: followers } = await supabase.from("follows").select("*", { count: "exact", head: true }).eq("following_id", userId);
      let following = false;
      if (currentProfile && currentProfile.id !== userId) {
        const { data: f } = await supabase.from("follows").select("follower_id").eq("follower_id", currentProfile.id).eq("following_id", userId).maybeSingle();
        following = !!f;
      }
      if (!cancelled) {
        setViewedProfile(p);
        setWorks((w || []).map(withLikeCount));
        setFollowerCount(followers || 0);
        setIsFollowing(following);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, currentProfile?.id]);

  async function toggleFollow() {
    if (!currentProfile) return;
    if (isFollowing) {
      await supabase.from("follows").delete().eq("follower_id", currentProfile.id).eq("following_id", userId);
      setIsFollowing(false);
      setFollowerCount((c) => c - 1);
    } else {
      await supabase.from("follows").insert({ follower_id: currentProfile.id, following_id: userId });
      setIsFollowing(true);
      setFollowerCount((c) => c + 1);
    }
    onFollowChanged?.();
  }

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function flash(message) {
    setToast(message);
    setTimeout(() => setToast(""), 2600);
  }

  if (loading) return <div style={{ padding: 40, color: "var(--fg-3)" }}>Loading…</div>;
  if (!viewedProfile) return <EmptyState title="Artist not found." sub="This profile may have been removed." />;

  const totalViews = works.reduce((sum, w) => sum + (w.views || 0), 0);
  const totalLikes = works.reduce((sum, w) => sum + (w.like_count || 0), 0);

  return (
    <div>
      <div style={{ height: 210, margin: "16px 16px 0", borderRadius: 30, boxShadow: "var(--shadow)", background: viewedProfile.cover_url ? `url(${viewedProfile.cover_url}) center/cover` : "linear-gradient(120deg, #036A91 0%, #0593C6 38%, #5CC3E6 68%, #D83995 135%)" }} />
      <div className="sig-page-pad" style={{ padding: "0 40px" }}>
        <div className="sig-panel" style={{ marginTop: -58, padding: "0 28px 24px", position: "relative" }}>
          <div className="sig-profile-header" style={{ display: "flex", alignItems: "flex-end", gap: 20, flexWrap: "wrap", marginTop: 0 }}>
            <div style={{ width: 104, height: 104, borderRadius: "50%", background: "var(--avatar)", border: "5px solid #fff", boxShadow: "0 0 0 3px var(--pink), var(--shadow)", overflow: "hidden", flexShrink: 0, marginTop: -46 }}>
              {viewedProfile.avatar_url && <img src={viewedProfile.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </div>
            <div style={{ paddingTop: 18, flex: 1, minWidth: 180 }}>
              <div className="sig-serif" style={{ fontSize: 26, display: "flex", alignItems: "center", color: "var(--ink)" }}>
                {viewedProfile.name}
                {viewedProfile.verified && <VerifiedBadge size={18} />}
              </div>
              <div style={{ fontSize: 13, color: "var(--fg-3)" }}>@{viewedProfile.username} · {works.length} works · {followerCount} followers</div>
            </div>
            {!isOwn && currentProfile && (
              <button className={isFollowing ? "sig-btn-outline" : "sig-btn-primary"} style={{ marginTop: 18 }} onClick={toggleFollow}>
                {isFollowing ? "Following" : "Follow"}
              </button>
            )}
          </div>
          {viewedProfile.bio && <div style={{ marginTop: 16, fontSize: 14.5, lineHeight: 1.65, color: "var(--fg-2)", maxWidth: 640 }}>{viewedProfile.bio}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <span className="sig-chip" style={{ cursor: "default" }}><b style={{ color: "var(--ink)" }}>{totalViews}</b> total views</span>
            <span className="sig-chip" style={{ cursor: "default" }}><b style={{ color: "var(--ink)" }}>{totalLikes}</b> total likes</span>
          </div>
        </div>
      </div>

      <div className="sig-page-pad t-blue" style={{ padding: "26px 40px 0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span style={{ display: "inline-block", background: "#fff", color: "var(--sky-700)", fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", padding: "6px 14px", borderRadius: 999, boxShadow: "0 4px 12px rgba(2,60,86,0.18)" }}>{isOwn ? "YOUR WORKS" : "WORKS"}</span>
        {isOwn && works.length > 0 && (
          <button className="sig-btn-outline" style={{ padding: "8px 18px", fontSize: 12 }} onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}>
            {selectMode ? "Cancel" : "Select works"}
          </button>
        )}
      </div>

      {selectMode && (
        <div className="sig-page-pad t-blue" style={{ padding: "12px 40px 0", fontSize: 13, color: "var(--fg-2)", fontWeight: 600 }}>
          Tap works to select them, then add them to a collection.
        </div>
      )}

      <Grid
        works={works}
        onOpen={onOpen}
        selectable={selectMode}
        selectedIds={selected}
        onToggle={toggleSelected}
        emptyTitle={isOwn ? "Your studio is empty." : "No works yet."}
        emptySub={isOwn ? "Publish your first piece to start your gallery." : "Check back later."}
      />

      {selectMode && (
        <div className="sig-select-bar">
          <span>{selected.size} selected</span>
          <button className="sig-btn-primary" style={{ padding: "8px 18px", fontSize: 13 }} disabled={selected.size === 0} onClick={() => setShowAdd(true)}>
            Add to collection
          </button>
        </div>
      )}

      {showAdd && (
        <AddToCollectionModal
          profile={currentProfile}
          workIds={Array.from(selected)}
          onClose={() => setShowAdd(false)}
          onDone={(count) => { setShowAdd(false); exitSelectMode(); flash(`Added ${count} work${count === 1 ? "" : "s"} to your collection.`); }}
        />
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "var(--ink)", color: "#fff", padding: "10px 20px", borderRadius: 999, fontSize: 13, fontWeight: 500, zIndex: 200 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function NotificationsPage({ profile, onOpenWork, onMarkAllRead }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*, actor:profiles!notifications_actor_id_fkey(name, username, avatar_url), works(title, image_url)")
        .eq("recipient_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(50);
      setItems(data || []);
      setLoading(false);
      const unread = (data || []).filter((n) => !n.read).map((n) => n.id);
      if (unread.length > 0) {
        await supabase.from("notifications").update({ read: true }).in("id", unread);
        onMarkAllRead?.();
      }
    })();
  }, [profile.id]);

  const verb = (type) => (type === "like" ? "liked your work" : type === "comment" ? "commented on your work" : type === "follow" ? "started following you" : type === "share" ? "shared your work" : "interacted with your work");

  if (loading) return <div style={{ padding: 40, color: "var(--fg-3)" }}>Loading…</div>;

  return (
    <div>
      <TopBar eyebrow="SIGNALS" title="Notifications" />
      {items.length === 0 ? (
        <EmptyState title="A quiet studio." sub="Come back later." />
      ) : (
        <div className="sig-sheet" style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 820 }}>
          {items.map((n) => (
            <div
              key={n.id}
              onClick={() => n.work_id && onOpenWork?.(n.work_id)}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 8, cursor: n.work_id ? "pointer" : "default", background: n.read ? "transparent" : "var(--sky-100)" }}
            >
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--avatar)", flexShrink: 0, overflow: "hidden" }}>
                {n.actor?.avatar_url && <img src={n.actor.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
              </div>
              <div style={{ flex: 1, fontSize: 14, minWidth: 0 }}>
                <strong>{n.actor?.name || "Someone"}</strong> <span style={{ color: "var(--fg-2)" }}>{verb(n.type)}</span>
                {n.works?.title && <span style={{ color: "var(--fg-3)" }}> — {n.works.title}</span>}
              </div>
              {n.works?.image_url && <img src={n.works.image_url} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CollectionsPage({ profile, myWorks, onOpenWork }) {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState(null);
  const [picking, setPicking] = useState(false);

  async function load() {
    const { data } = await supabase.from("collections").select("*").eq("user_id", profile.id).order("created_at", { ascending: false });
    setCollections(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [profile.id]);

  async function create() {
    if (!name.trim()) return;
    await supabase.from("collections").insert({ user_id: profile.id, name: name.trim() });
    setName("");
    setShowNew(false);
    load();
  }

  const byId = new Map(myWorks.map((w) => [w.id, w]));
  const worksIn = (c) => (c.work_ids || []).map((id) => byId.get(id)).filter(Boolean);

  /* ---------- single collection ---------- */
  const open = collections.find((c) => c.id === openId);
  if (open) {
    const items = worksIn(open);
    return (
      <div>
        <div className="sig-page-pad t-blue" style={{ padding: "30px 40px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#fff", fontSize: 14, fontWeight: 600, marginBottom: 18 }} onClick={() => setOpenId(null)}>
            <Icon name="back" /> Collections
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
            <div>
              <span style={{ display: "inline-block", background: "#fff", color: "var(--sky-700)", fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", padding: "5px 13px", borderRadius: 999, marginBottom: 12 }}>COLLECTION · PRIVATE TO YOU</span>
              <div className="sig-serif" style={{ fontSize: "clamp(30px, 4vw, 46px)", lineHeight: 1.05 }}>{open.name}</div>
              <div style={{ fontSize: 13, color: "var(--fg-3)", marginTop: 4 }}>{items.length} work{items.length === 1 ? "" : "s"}</div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="sig-btn-primary" onClick={() => setPicking(true)}>Add / remove works</button>
              <button
                className="sig-btn-outline"
                style={{ borderColor: "rgba(216,57,149,0.4)", color: "var(--accent-text)" }}
                onClick={async () => {
                  if (!window.confirm(`Delete the collection "${open.name}"? Your artwork stays published.`)) return;
                  await supabase.from("collections").delete().eq("id", open.id);
                  setOpenId(null);
                  load();
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
        <Grid works={items} onOpen={onOpenWork} emptyTitle="This collection is empty." emptySub="Use “Add / remove works”, or select works on your profile." />
        {picking && (
          <WorkPickerModal
            title={`Works in “${open.name}”`}
            works={myWorks}
            initialSelected={items.map((w) => w.id)}
            onClose={() => setPicking(false)}
            onSave={async (ids) => {
              await supabase.from("collections").update({ work_ids: ids }).eq("id", open.id);
              setPicking(false);
              load();
            }}
          />
        )}
      </div>
    );
  }

  /* ---------- list ---------- */
  return (
    <div className="sig-page-pad t-blue" style={{ padding: "32px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 26, gap: 12, flexWrap: "wrap" }}>
        <div>
          <span style={{ display: "inline-block", background: "#fff", color: "var(--sky-700)", fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", padding: "5px 13px", borderRadius: 999, marginBottom: 12 }}>YOUR STUDIO</span>
          <div className="sig-serif" style={{ fontSize: "clamp(32px, 4vw, 48px)", lineHeight: 1.05 }}>Collections</div>
        </div>
        <button className="sig-btn-primary" onClick={() => setShowNew(true)}>+ New collection</button>
      </div>
      {showNew && (
        <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
          <input className="sig-input" style={{ maxWidth: 320 }} placeholder="Collection name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
          <button className="sig-btn-primary" onClick={create}>Create</button>
          <button className="sig-btn-outline" onClick={() => setShowNew(false)}>Cancel</button>
        </div>
      )}
      {loading ? (
        <div style={{ color: "var(--fg-3)" }}>Loading…</div>
      ) : collections.length === 0 ? (
        <EmptyState title="No collections yet." sub="Group your works into a series or study — select works on your profile to add them." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
          {collections.map((c) => {
            const items = worksIn(c);
            return (
              <div key={c.id} onClick={() => setOpenId(c.id)} className="sig-panel" style={{ cursor: "pointer", overflow: "hidden", transition: "transform .25s ease, box-shadow .25s ease" }} onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-5px)"; }} onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}>
                <div style={{ aspectRatio: "16/10", background: "var(--sky-100)", display: "grid", gridTemplateColumns: items.length > 1 ? "1fr 1fr" : "1fr", gap: 2 }}>
                  {items.slice(0, 4).map((w) => <img key={w.id} src={w.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />)}
                </div>
                <div style={{ padding: 14 }}>
                  <div style={{ fontWeight: 500 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 4 }}>{items.length} work{items.length === 1 ? "" : "s"}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function VerificationPanel({ profile }) {
  const [request, setRequest] = useState(undefined); // undefined = loading, null = none
  const [note, setNote] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    const { data, error } = await supabase.from("verification_requests").select("*").eq("user_id", profile.id).order("created_at", { ascending: false }).limit(1);
    setRequest(error ? null : data?.[0] || null);
  }
  useEffect(() => { load(); }, [profile.id]);

  async function submit() {
    if (!note.trim()) { setMsg("Tell us how we can confirm the work is yours."); return; }
    setBusy(true);
    setMsg("");
    const { error } = await supabase.from("verification_requests").insert({ user_id: profile.id, note: note.trim(), link: link.trim() });
    setBusy(false);
    if (error) {
      setMsg(looksLikeMissingSetup(error.message)
        ? "Verification isn't switched on yet. The site owner needs to run the latest database update."
        : error.message);
      return;
    }
    setNote("");
    setLink("");
    load();
  }

  const box = { padding: 16, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", marginBottom: 24 };

  if (profile.verified) {
    return (
      <div style={{ ...box, borderColor: "rgba(5,147,198,0.35)" }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 14, fontWeight: 500 }}>You're a verified artist<VerifiedBadge size={16} /></div>
        <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 6 }}>The badge shows next to your name across Signature.</div>
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Get verified</div>
      <div style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.6, marginBottom: 14 }}>
        A hand-reviewed badge that says a real person made this work. We never ask for ID — just show us proof: a link to your other portfolio, or tell us about your process photos.
      </div>
      {request === undefined ? (
        <div style={{ fontSize: 13, color: "var(--fg-3)" }}>Loading…</div>
      ) : request?.status === "pending" ? (
        <div style={{ fontSize: 13, color: "var(--warn)" }}>Your request is waiting for review. We'll add the badge if it's approved.</div>
      ) : (
        <>
          {request?.status === "rejected" && <div style={{ fontSize: 13, color: "var(--danger)", marginBottom: 12 }}>Your last request wasn't approved. You can send another with more proof.</div>}
          <label className="sig-label">How can we confirm it's your work? *</label>
          <textarea className="sig-input" rows={3} style={{ marginBottom: 12 }} placeholder="e.g. I post my WIP on Instagram under the same name; my process shots are on Signature." value={note} onChange={(e) => setNote(e.target.value)} />
          <label className="sig-label">Link (optional)</label>
          <input className="sig-input" style={{ marginBottom: 12 }} placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
          {msg && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>{msg}</div>}
          <button className="sig-btn-outline" disabled={busy} onClick={submit}>{busy ? "Sending…" : "Request verification"}</button>
        </>
      )}
    </div>
  );
}

const EMAIL_PREFS = [
  ["email_follows", "new followers"],
  ["email_comments", "comments on my work"],
  ["email_likes", "likes on my work"],
  ["email_shares", "shares of my work"],
];

function SettingsPage({ profile, onSave }) {
  const [form, setForm] = useState(profile);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const avatarRef = useRef(null);
  const coverRef = useRef(null);

  useEffect(() => setForm(profile), [profile]);

  const digestAvailable = typeof profile.digest_opt_in === "boolean";
  const emailPrefsAvailable = typeof profile.email_likes === "boolean";

  async function uploadTo(field, file) {
    if (!file) return;
    setBusy(true);
    setMsg("");
    const path = `${profile.id}/${field}-${Date.now()}.${extOf(file)}`;
    const { error } = await supabase.storage.from("artwork").upload(path, file, { upsert: true });
    if (error) setMsg(error.message);
    else {
      const { data: pub } = supabase.storage.from("artwork").getPublicUrl(path);
      setForm((f) => ({ ...f, [field]: pub.publicUrl }));
    }
    setBusy(false);
  }

  async function save() {
    setBusy(true);
    setMsg("");
    const payload = { name: form.name, bio: form.bio, website: form.website, instagram: form.instagram, twitter: form.twitter, avatar_url: form.avatar_url, cover_url: form.cover_url };
    if (digestAvailable && form.digest_opt_in !== profile.digest_opt_in) payload.digest_opt_in = form.digest_opt_in;
    if (emailPrefsAvailable) {
      for (const [key] of EMAIL_PREFS) if (form[key] !== profile[key]) payload[key] = form[key];
    }
    const { error } = await onSave(payload);
    setBusy(false);
    if (error) { setMsg(error.message || "Couldn't save your changes."); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div>
      <TopBar eyebrow="STUDIO" title="Settings" />
      <div className="sig-sheet" style={{ maxWidth: 740 }}>
      <label className="sig-label">Cover image</label>
      <div onClick={() => coverRef.current?.click()} style={{ height: 140, borderRadius: 8, border: "1px solid var(--border)", background: form.cover_url ? `url(${form.cover_url}) center/cover` : "var(--surface)", marginBottom: 22, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--fg-4)", fontSize: 12 }}>
        {!form.cover_url && "CHANGE"}
      </div>
      <input ref={coverRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => uploadTo("cover_url", e.target.files[0])} />

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <div onClick={() => avatarRef.current?.click()} style={{ width: 72, height: 72, borderRadius: "50%", background: "var(--avatar)", overflow: "hidden", cursor: "pointer", flexShrink: 0 }}>
          {form.avatar_url && <img src={form.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
        </div>
        <div style={{ fontSize: 13, color: "var(--fg-3)", cursor: "pointer" }} onClick={() => avatarRef.current?.click()}>Click to change your avatar</div>
        <input ref={avatarRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => uploadTo("avatar_url", e.target.files[0])} />
      </div>

      <div style={{ marginBottom: 16 }}><label className="sig-label">Name</label><input className="sig-input" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div style={{ marginBottom: 16 }}><label className="sig-label">Bio</label><textarea className="sig-input" rows={3} value={form.bio || ""} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></div>
      <div className="sig-settings-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 24 }}>
        <div><label className="sig-label">Website</label><input className="sig-input" value={form.website || ""} onChange={(e) => setForm({ ...form, website: e.target.value })} /></div>
        <div><label className="sig-label">Instagram</label><input className="sig-input" value={form.instagram || ""} onChange={(e) => setForm({ ...form, instagram: e.target.value })} /></div>
        <div><label className="sig-label">Twitter</label><input className="sig-input" value={form.twitter || ""} onChange={(e) => setForm({ ...form, twitter: e.target.value })} /></div>
      </div>

      {digestAvailable && (
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, marginBottom: 24, cursor: "pointer", lineHeight: 1.5 }}>
          <input type="checkbox" style={{ marginTop: 4 }} checked={!!form.digest_opt_in} onChange={(e) => setForm({ ...form, digest_opt_in: e.target.checked })} />
          <span>
            Weekly “Fresh Eyes” email
            <span style={{ display: "block", fontSize: 12, color: "var(--fg-3)" }}>A short digest of new pieces asking for critique. Off by default; change it any time.</span>
          </span>
        </label>
      )}

      {emailPrefsAvailable && (
        <div style={{ marginBottom: 24 }}>
          <div className="sig-label">Include in my daily summary email</div>
          {EMAIL_PREFS.map(([key, label]) => (
            <label key={key} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, marginBottom: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={form[key] !== false} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
              {label}
            </label>
          ))}
          <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 4 }}>One email a day, and only if something happened. Views are never emailed. Everything still appears under Notifications.</div>
        </div>
      )}

      {msg && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{msg}</div>}
      <button className="sig-btn-primary" style={{ marginBottom: 36 }} disabled={busy} onClick={save}>{saved ? "Saved" : busy ? "Saving…" : "Save changes"}</button>

      <VerificationPanel profile={profile} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Admin moderation                                                    */
/* ------------------------------------------------------------------ */

// Only real web addresses become clickable (never javascript: links).
const isWebLink = (value) => /^https?:\/\/\S+$/i.test(String(value || "").trim());

// Turns "table not found in the schema cache" style errors into something a person can act on.
const looksLikeMissingSetup = (message) => /schema cache|does not exist|could not find the (table|function)/i.test(String(message || ""));

function AdminPage({ profile, onOpenWork, onViewProfile }) {
  const [tab, setTab] = useState("reports");
  const [requests, setRequests] = useState([]);
  const [requestsError, setRequestsError] = useState("");
  const [reports, setReports] = useState([]);
  const [latest, setLatest] = useState([]);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setLoading(true);
    const [repRes, latestRes, logRes, reqRes] = await Promise.all([
      supabase
        .from("reports")
        .select("*, works(id, title, image_url, user_id, profiles!works_user_id_fkey(name, username)), reporter:profiles!reports_reporter_id_fkey(name, username)")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("works")
        .select("id, title, image_url, user_id, created_at, profiles!works_user_id_fkey(name, username)")
        .order("created_at", { ascending: false })
        .limit(40),
      supabase.from("moderation_log").select("*").order("created_at", { ascending: false }).limit(30),
      supabase
        .from("verification_requests")
        .select("*, requester:profiles!verification_requests_user_id_fkey(id, name, username, avatar_url, verified)")
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
    ]);
    setRequestsError(reqRes.error ? (looksLikeMissingSetup(reqRes.error.message) ? "Verification isn't set up yet. Run migration-batch-2.sql and migration-batch-3.sql in the Supabase SQL Editor." : reqRes.error.message) : "");
    setRequests(reqRes.data || []);
    if (repRes.error) setMsg(`Couldn't load reports: ${repRes.error.message}`);
    setReports(repRes.data || []);
    setLatest(latestRes.data || []);
    setLog(logRes.data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  if (!profile?.is_admin) return <EmptyState title="Admins only." sub="This page is for Signature moderators." />;

  async function remove(work) {
    const reason = window.prompt(`Remove “${work.title}”?\n\nEnter a reason. It is saved in the moderation log:`);
    if (reason === null) return;
    if (!reason.trim()) { window.alert("A reason is required."); return; }
    setBusyId(work.id);
    const { error } = await removeWorkAsAdmin(work, profile.id, reason.trim());
    setBusyId(null);
    if (error) { setMsg(error.message); return; }
    setMsg(`Removed “${work.title}”.`);
    load();
  }

  async function review(request, approve) {
    setBusyId(request.id);
    const { error } = await supabase.rpc("review_verification", { p_request_id: request.id, p_approve: approve });
    setBusyId(null);
    if (error) {
      setMsg(looksLikeMissingSetup(error.message) ? "Run migration-batch-3.sql in the Supabase SQL Editor first." : error.message);
      return;
    }
    const who = request.requester?.username ? `@${request.requester.username}` : "the member";
    setMsg(approve ? `Verified ${who}. The badge now shows next to their name.` : `Declined ${who}'s request.`);
    load();
  }

  async function dismiss(report) {
    setBusyId(report.id);
    const { error } = await supabase.from("reports").update({ status: "dismissed" }).eq("id", report.id);
    setBusyId(null);
    if (error) { setMsg(error.message); return; }
    load();
  }

  const tabBtn = (id, label, count) => (
    <div
      key={id}
      onClick={() => setTab(id)}
      style={{ padding: "12px 4px", marginRight: 22, cursor: "pointer", fontSize: 14, borderBottom: tab === id ? "2px solid var(--fg)" : "2px solid transparent", color: tab === id ? "var(--fg)" : "var(--fg-3)" }}
    >
      {label}{count !== undefined ? ` (${count})` : ""}
    </div>
  );

  const thumb = (w) => (
    <div style={{ width: 96, height: 96, borderRadius: 6, overflow: "hidden", flexShrink: 0, cursor: "pointer", background: "var(--sky-100)" }} onClick={() => onOpenWork(w.id)}>
      <img src={w.image_url} alt={w.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
    </div>
  );

  const dangerBtn = { padding: "7px 16px", fontSize: 12, borderColor: "rgba(216,57,149,0.5)", color: "var(--accent-text)" };

  return (
    <div>
      <TopBar eyebrow="ADMIN" title="Moderation" />
      <div className="sig-page-pad t-blue" style={{ padding: "0 40px", borderBottom: "1px solid var(--border)", display: "flex", marginTop: 20, flexWrap: "wrap" }}>
        {tabBtn("reports", "Reports", reports.length)}
        {tabBtn("verify", "Verification", requests.length)}
        {tabBtn("latest", "Latest uploads")}
        {tabBtn("log", "Removal log")}
      </div>

      {msg && (
        <div className="sig-page-pad" style={{ padding: "14px 40px 0", fontSize: 13, color: "var(--warn)" }}>{msg}</div>
      )}

      <div className="sig-sheet">
        {loading ? (
          <div style={{ color: "var(--fg-3)" }}>Loading…</div>
        ) : tab === "reports" ? (
          reports.length === 0 ? (
            <EmptyState title="No open reports." sub="Reported pieces will show up here." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {reports.map((r) => (
                <div key={r.id} style={{ display: "flex", gap: 14, padding: 14, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", flexWrap: "wrap" }}>
                  {r.works ? thumb(r.works) : <div style={{ width: 96, height: 96, borderRadius: 6, background: "var(--sky-100)" }} />}
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 500 }}>{r.works?.title || "(already removed)"}</div>
                    <div style={{ fontSize: 12, color: "var(--fg-3)", marginBottom: 8 }}>
                      by {r.works?.profiles?.name || "unknown"} (@{r.works?.profiles?.username || "?"})
                    </div>
                    <div style={{ fontSize: 13 }}><strong>{r.reason}</strong></div>
                    {r.details && <div style={{ fontSize: 13, color: "var(--fg-2)", marginTop: 4 }}>{r.details}</div>}
                    <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 6 }}>
                      Reported by {r.reporter?.name || "someone"} · {new Date(r.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {r.works && <button className="sig-btn-outline" style={dangerBtn} disabled={busyId === r.works.id} onClick={() => remove(r.works)}>Remove artwork</button>}
                    <button className="sig-btn-outline" style={{ padding: "7px 16px", fontSize: 12 }} disabled={busyId === r.id} onClick={() => dismiss(r)}>Dismiss</button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : tab === "verify" ? (
          requestsError ? (
            <div style={{ fontSize: 13, color: "var(--warn)", lineHeight: 1.6 }}>{requestsError}</div>
          ) : requests.length === 0 ? (
            <EmptyState title="No verification requests." sub="When a member asks for the badge in Settings, it appears here." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {requests.map((r) => (
                <div key={r.id} style={{ display: "flex", gap: 14, padding: 14, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", flexWrap: "wrap" }}>
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--avatar)", overflow: "hidden", flexShrink: 0, cursor: "pointer" }} onClick={() => onViewProfile?.(r.user_id)}>
                    {r.requester?.avatar_url && <img src={r.requester.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontWeight: 500 }}>{r.requester?.name || "Member"} <span style={{ color: "var(--fg-3)", fontWeight: 400 }}>@{r.requester?.username || "?"}</span></div>
                    <div style={{ fontSize: 13, color: "var(--fg-2)", marginTop: 8, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{r.note}</div>
                    {r.link && (
                      <div style={{ fontSize: 13, marginTop: 8, wordBreak: "break-all" }}>
                        {isWebLink(r.link)
                          ? <a href={r.link.trim()} target="_blank" rel="noopener noreferrer" style={{ color: "var(--link)" }}>{r.link.trim()}</a>
                          : <span style={{ color: "var(--fg-3)" }}>{r.link}</span>}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 8 }}>
                      Requested {new Date(r.created_at).toLocaleString()} ·{" "}
                      <span style={{ textDecoration: "underline", cursor: "pointer" }} onClick={() => onViewProfile?.(r.user_id)}>view their profile and work</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <button className="sig-btn-primary" style={{ padding: "7px 18px", fontSize: 12 }} disabled={busyId === r.id} onClick={() => review(r, true)}>Approve</button>
                    <button className="sig-btn-outline" style={{ padding: "7px 18px", fontSize: 12 }} disabled={busyId === r.id} onClick={() => review(r, false)}>Decline</button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : tab === "latest" ? (
          <>
            <div style={{ fontSize: 13, color: "var(--fg-3)", marginBottom: 16 }}>
              The 40 newest uploads, so you can spot problems without waiting for a report.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
              {latest.map((w) => (
                <div key={w.id} style={{ borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)", background: "var(--white)" }}>
                  <div style={{ aspectRatio: "1/1", cursor: "pointer" }} onClick={() => onOpenWork(w.id)}>
                    <img src={w.image_url} alt={w.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  </div>
                  <div style={{ padding: "8px 10px" }}>
                    <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.title}</div>
                    <div style={{ fontSize: 11, color: "var(--fg-3)", marginBottom: 8 }}>@{w.profiles?.username || "?"} · {new Date(w.created_at).toLocaleDateString()}</div>
                    <button className="sig-btn-outline" style={{ ...dangerBtn, width: "100%", padding: "6px 10px" }} disabled={busyId === w.id} onClick={() => remove(w)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : log.length === 0 ? (
          <EmptyState title="Nothing removed yet." sub="Every removal is recorded here with its reason." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {log.map((l) => (
              <div key={l.id} style={{ padding: "12px 14px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13 }}>
                <div><strong>{l.work_title || "(untitled)"}</strong> <span style={{ color: "var(--fg-3)" }}>· {new Date(l.created_at).toLocaleString()}</span></div>
                <div style={{ color: "var(--fg-2)", marginTop: 4 }}>Reason: {l.reason}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function App() {
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState("landing");
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [works, setWorks] = useState([]);
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState("recent");
  const [range, setRange] = useState("all");
  const [critiqueOnly, setCritiqueOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [uploadMode, setUploadMode] = useState(null); // null | "single" | "bulk"
  const [activeWork, setActiveWork] = useState(null);
  const [authError, setAuthError] = useState("");
  const [creatorCount, setCreatorCount] = useState(0);
  const [followingIds, setFollowingIds] = useState([]);
  const [followingTags, setFollowingTags] = useState([]);
  const [viewedUserId, setViewedUserId] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [editingWork, setEditingWork] = useState(null);

  const loadWorks = useCallback(async () => {
    const { data, error } = await queryWorks((q) => q.order("created_at", { ascending: false }));
    if (error) {
      console.error("loadWorks failed:", error.message, "| code:", error.code, "| details:", error.details, "| hint:", error.hint);
      return;
    }
    setWorks((data || []).map(withLikeCount));
  }, []);

  async function loadFollowing(userId) {
    const { data } = await supabase.from("follows").select("following_id").eq("follower_id", userId);
    setFollowingIds((data || []).map((r) => r.following_id));
  }

  async function loadFollowingTags(userId) {
    const { data } = await supabase.from("tag_follows").select("tag").eq("user_id", userId);
    setFollowingTags((data || []).map((r) => r.tag));
  }

  async function loadUnreadCount(userId) {
    const { count } = await supabase.from("notifications").select("*", { count: "exact", head: true }).eq("recipient_id", userId).eq("read", false);
    setUnreadCount(count || 0);
  }

  async function loadUserExtras(userId) {
    await Promise.all([loadFollowing(userId), loadFollowingTags(userId), loadUnreadCount(userId)]);
  }

  useEffect(() => {
    const deepLinkId = new URLSearchParams(window.location.search).get("work");

    (async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      setSession(s);
      if (s) {
        const { data: p } = await supabase.from("profiles").select("*").eq("id", s.user.id).maybeSingle();
        setProfile(p);
        await loadUserExtras(s.user.id);
        setPage("explore");
      }
      await loadWorks();
      const { count } = await supabase.from("profiles").select("*", { count: "exact", head: true });
      setCreatorCount(count || 0);

      // Shared links (…/?work=<id>) open straight to that piece.
      if (deepLinkId) {
        const w = await fetchFullWork(deepLinkId);
        if (w) {
          setPage("explore");
          setActiveWork(w);
          supabase.rpc("increment_work_views", { p_work_id: w.id }).then(() => {});
        }
        window.history.replaceState({}, "", window.location.pathname);
      }
      setReady(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s);
      if (s) {
        const { data: p } = await supabase.from("profiles").select("*").eq("id", s.user.id).maybeSingle();
        setProfile(p);
        await loadUserExtras(s.user.id);
      } else {
        setProfile(null);
        setFollowingIds([]);
        setFollowingTags([]);
        setUnreadCount(0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadWorks]);

  useEffect(() => {
    if (session && profile && page === "landing") setPage("explore");
  }, [session, profile]);

  /* ---------- navigation + actions ---------- */

  function viewProfile(userId) {
    setViewedUserId(userId);
    setActiveWork(null);
    setPage("profile");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setActiveWork(null);
    setPage("landing");
  }

  function handleOpen(work) {
    supabase.rpc("increment_work_views", { p_work_id: work.id }).then(({ error }) => {
      if (error) console.warn("View count not recorded (run the latest migration):", error.message);
    });
    setActiveWork({ ...work, views: (work.views || 0) + 1 });
  }

  async function openWorkById(id) {
    const w = await fetchFullWork(id);
    if (w) handleOpen(w);
  }

  async function handleDelete(work) {
    const { data: stepRows } = await supabase.from("work_steps").select("image_url").eq("work_id", work.id);
    const paths = [work.image_url, ...(stepRows || []).map((s) => s.image_url)].map(pathFromUrl).filter(Boolean);
    if (paths.length) await supabase.storage.from("artwork").remove(paths);
    await supabase.from("works").delete().eq("id", work.id);
    setActiveWork(null);
    loadWorks();
  }

  async function adminRemoveWork(work) {
    if (!profile?.is_admin) return;
    const reason = window.prompt(`Remove “${work.title}”?\n\nEnter a reason. It is saved in the moderation log:`);
    if (reason === null) return;
    if (!reason.trim()) { window.alert("A reason is required."); return; }
    const { error } = await removeWorkAsAdmin(work, profile.id, reason.trim());
    if (error) { window.alert(error.message); return; }
    setActiveWork(null);
    loadWorks();
  }

  async function handleSaveProfile(payload) {
    const { error } = await supabase.from("profiles").update(payload).eq("id", profile.id);
    if (!error) setProfile({ ...profile, ...payload });
    return { error };
  }

  async function toggleTagFollow(tag) {
    if (!profile) return;
    if (followingTags.includes(tag)) {
      await supabase.from("tag_follows").delete().eq("user_id", profile.id).eq("tag", tag);
      setFollowingTags((tags) => tags.filter((t) => t !== tag));
    } else {
      const { error } = await supabase.from("tag_follows").insert({ user_id: profile.id, tag });
      if (error) { window.alert("Couldn't follow that tag. Make sure the latest database migration has been run."); return; }
      setFollowingTags((tags) => [...tags, tag]);
    }
  }

  function handleTagClick(tag) {
    setSearch(tag);
    setCat("All");
    setActiveWork(null);
    setPage("explore");
  }

  /* ---------- early returns ---------- */

  if (!ready) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}><GlobalStyle />Loading…</div>;
  }
  if (page === "landing") return <><GlobalStyle /><LandingPage setPage={setPage} stats={{ works: works.length, creators: creatorCount }} works={works} /></>;
  if (page === "privacy") return <><GlobalStyle /><PrivacyPage setPage={setPage} /></>;
  if (page === "terms") return <><GlobalStyle /><TermsPage setPage={setPage} /></>;
  if (page === "signin" || page === "signup") return <><GlobalStyle /><AuthPage mode={page} setPage={(p) => { setAuthError(""); setPage(p); }} onError={setAuthError} error={authError} /></>;

  /* ---------- derived data ---------- */

  const myWorks = profile ? works.filter((w) => w.user_id === profile.id) : [];

  let filtered = works.filter((w) => cat === "All" || w.category === cat);
  if (critiqueOnly) filtered = filtered.filter((w) => w.critique_requested);
  if (range !== "all") {
    const days = { day: 1, week: 7, month: 30 }[range];
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    filtered = filtered.filter((w) => new Date(w.created_at).getTime() >= cutoff);
  }
  if (search.trim()) {
    const q = search.trim().toLowerCase().replace(/^#/, "");
    filtered = filtered.filter((w) => w.title?.toLowerCase().includes(q) || w.tags?.some((t) => t.toLowerCase().includes(q)) || w.profiles?.name?.toLowerCase().includes(q));
  }
  const byDate = (a, b) => new Date(b.created_at) - new Date(a.created_at);
  const sorters = {
    recent: byDate,
    oldest: (a, b) => -byDate(a, b),
    views: (a, b) => (b.views || 0) - (a.views || 0) || byDate(a, b),
    popular: (a, b) => (b.like_count || 0) - (a.like_count || 0) || byDate(a, b),
    discussed: (a, b) => (b.comment_count || 0) - (a.comment_count || 0) || byDate(a, b),
    title: (a, b) => (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" }),
  };
  filtered = filtered.slice().sort(sorters[sort] || byDate);

  // "Follow this tag" shows up when the search is exactly one real tag.
  const tagQuery = search.trim().toLowerCase().replace(/^#/, "");
  const tagIsReal = !!tagQuery && !tagQuery.includes(" ") && works.some((w) => w.tags?.some((t) => t.toLowerCase() === tagQuery));
  const tagFollowed = followingTags.includes(tagQuery);

  const followingWorks = profile
    ? works.filter((w) => w.user_id !== profile.id && (followingIds.includes(w.user_id) || w.tags?.some((t) => followingTags.includes(t.toLowerCase()))))
    : [];

  const openUpload = () => (profile ? setUploadMode("single") : setPage("signin"));

  return (
    <>
      <GlobalStyle />
      {activeWork ? (
        <WorkDetail
          work={activeWork}
          profile={profile}
          onBack={() => { setActiveWork(null); loadWorks(); if (profile) loadFollowing(profile.id); }}
          onDelete={handleDelete}
          onViewProfile={viewProfile}
          onEdit={(w) => setEditingWork(w)}
          onOpenWork={openWorkById}
          onTagClick={handleTagClick}
          onAdminRemove={adminRemoveWork}
        />
      ) : (
        <div className="sig-app-shell sig-canvas">
          <div className="sig-sidebar-desktop">
            <Sidebar profile={profile} page={page} setPage={setPage} onUploadClick={openUpload} onSignOut={handleSignOut} onMyProfile={() => viewProfile(profile.id)} unreadCount={unreadCount} />
          </div>
          <MobileTopBar profile={profile} setPage={setPage} onUploadClick={openUpload} />

          <div className="sig-main-area sig-scrollbar">
            {page === "explore" && (
              <>
                <TopBar eyebrow="THE GALLERY" title="Explore" search={search} setSearch={setSearch} />
                <CategoryBar cat={cat} setCat={setCat} sort={sort} setSort={setSort} range={range} setRange={setRange} critiqueOnly={critiqueOnly} setCritiqueOnly={setCritiqueOnly} />
                {profile && tagIsReal && (
                  <div className="sig-tag-bar" style={{ padding: "14px 40px 0" }}>
                    <button className={tagFollowed ? "sig-btn-outline" : "sig-btn-primary"} style={{ padding: "7px 16px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => toggleTagFollow(tagQuery)}>
                      <Icon name="tag" size={13} /> {tagFollowed ? `Following #${tagQuery}` : `Follow #${tagQuery}`}
                    </button>
                  </div>
                )}
                <Grid works={filtered} onOpen={handleOpen} emptyTitle={works.length > 0 ? "No matches." : undefined} emptySub={works.length > 0 ? "Try another category, search or filter." : undefined} />
              </>
            )}

            {page === "following" && (
              <>
                <TopBar eyebrow="YOUR CIRCLE" title="Following" />
                {!profile ? (
                  <EmptyState title="Sign in to build your circle." sub="Follow artists and tags to fill this feed." />
                ) : (
                  <>
                    {followingTags.length > 0 && (
                      <div className="sig-tag-bar" style={{ padding: "18px 40px 0", display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {followingTags.map((t) => (
                          <span key={t} className="sig-chip" onClick={() => toggleTagFollow(t)} title="Unfollow tag">
                            <Icon name="tag" size={12} /> {t} <Icon name="x" size={11} />
                          </span>
                        ))}
                      </div>
                    )}
                    {followingIds.length === 0 && followingTags.length === 0 ? (
                      <EmptyState title="You're not following anyone yet." sub="Follow an artist from any piece, or search a tag on Explore and follow it." />
                    ) : (
                      <Grid works={followingWorks} onOpen={handleOpen} emptyTitle="Nothing new yet." emptySub="New work from the artists and tags you follow will show up here." />
                    )}
                  </>
                )}
              </>
            )}

            {page === "profile" && viewedUserId && (
              <ProfilePage userId={viewedUserId} currentProfile={profile} onOpen={handleOpen} onFollowChanged={() => profile && loadFollowing(profile.id)} />
            )}
            {page === "notifications" && profile && (
              <NotificationsPage profile={profile} onOpenWork={openWorkById} onMarkAllRead={() => setUnreadCount(0)} />
            )}
            {page === "collections" && profile && <CollectionsPage profile={profile} myWorks={myWorks} onOpenWork={handleOpen} />}
            {page === "settings" && profile && <SettingsPage profile={profile} onSave={handleSaveProfile} />}
            {page === "admin" && profile && <AdminPage profile={profile} onOpenWork={openWorkById} onViewProfile={viewProfile} />}
          </div>

          <MobileBottomNav profile={profile} page={page} setPage={setPage} onMyProfile={() => viewProfile(profile.id)} unreadCount={unreadCount} />
        </div>
      )}

      {uploadMode === "single" && profile && (
        <UploadModal
          userId={profile.id}
          myWorks={myWorks}
          onClose={() => setUploadMode(null)}
          onPublished={() => { setUploadMode(null); loadWorks(); }}
          onSwitchToBulk={() => setUploadMode("bulk")}
        />
      )}
      {uploadMode === "bulk" && profile && (
        <BulkUploadModal
          userId={profile.id}
          onClose={() => setUploadMode(null)}
          onPublished={() => { setUploadMode(null); loadWorks(); }}
          onPartial={loadWorks}
          onSwitchToSingle={() => setUploadMode("single")}
        />
      )}
      {editingWork && (
        <EditModal
          work={editingWork}
          onClose={() => setEditingWork(null)}
          onSaved={async () => {
            const id = editingWork.id;
            setEditingWork(null);
            await loadWorks();
            const fresh = await fetchFullWork(id);
            if (fresh) setActiveWork((current) => (current && current.id === id ? { ...fresh, views: current.views } : current));
          }}
        />
      )}
    </>
  );
}
