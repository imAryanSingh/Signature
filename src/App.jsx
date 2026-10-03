import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";

const FONT_SERIF = "'Playfair Display', Georgia, serif";
const FONT_SANS = "'Inter', -apple-system, sans-serif";
const CATEGORIES = ["All", "Illustration", "Photography", "Painting", "Sketch", "Digital", "Mixed"];
const MAX_UPLOAD_MB = 25;
const MAX_PROCESS_SHOTS = 4;

const HERO_IMAGES = [
  "https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=800&q=80",
  "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=500&q=80",
  "https://images.unsplash.com/photo-1578321272176-b7bbc0679853?w=500&q=80",
];

/* ------------------------------------------------------------------ */
/* Data helpers                                                        */
/* ------------------------------------------------------------------ */

const WORK_SELECT = "*, profiles!works_user_id_fkey(name, username, avatar_url, verified), likes(count)";
const WORK_SELECT_BASIC = "*, profiles!works_user_id_fkey(name, username, avatar_url), likes(count)";

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

const withLikeCount = (w) => ({ ...w, like_count: w.likes?.[0]?.count || 0 });

async function fetchFullWork(id) {
  const { data, error } = await queryWorks((q) => q.eq("id", id).maybeSingle());
  if (error || !data) return null;
  return withLikeCount(data);
}

const extOf = (file) => (file.name.split(".").pop() || "jpg").toLowerCase();
const pathFromUrl = (url) => (url || "").split("/artwork/")[1];
const cleanTags = (raw) =>
  Array.from(new Set(raw.split(",").map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean)));

/* ------------------------------------------------------------------ */
/* Global styles                                                       */
/* ------------------------------------------------------------------ */

const GlobalStyle = () => (
  <style>{`
    * { box-sizing: border-box; }
    html, body { margin: 0; background: #0a0a0a; }
    body { font-family: ${FONT_SANS}; color: #eae7e0; -webkit-text-size-adjust: 100%; }
    .sig-serif { font-family: ${FONT_SERIF}; }
    ::selection { background: #eae7e0; color: #0a0a0a; }

    .sig-btn-primary {
      background: #eae7e0; color: #0a0a0a; border: none; border-radius: 999px;
      padding: 11px 22px; font-size: 14px; font-weight: 500; cursor: pointer;
      transition: opacity .15s ease; font-family: ${FONT_SANS};
    }
    .sig-btn-primary:hover { opacity: .85; }
    .sig-btn-primary:disabled { opacity: .4; cursor: not-allowed; }
    .sig-btn-outline {
      background: transparent; color: #eae7e0; border: 1px solid rgba(234,231,224,0.25); border-radius: 999px;
      padding: 11px 22px; font-size: 14px; font-weight: 500; cursor: pointer;
      transition: border-color .15s ease, background .15s ease; font-family: ${FONT_SANS};
    }
    .sig-btn-outline:hover { border-color: rgba(234,231,224,0.6); background: rgba(255,255,255,0.03); }
    .sig-btn-outline:disabled { opacity: .4; cursor: not-allowed; }
    .sig-input {
      width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(234,231,224,0.15);
      border-radius: 8px; padding: 11px 14px; color: #eae7e0; font-size: 14px; font-family: ${FONT_SANS};
      outline: none; transition: border-color .15s ease;
    }
    .sig-input:focus { border-color: rgba(234,231,224,0.5); }
    .sig-input::placeholder { color: rgba(234,231,224,0.35); }
    select.sig-input { color-scheme: dark; }
    select.sig-input option { background: #141414; color: #eae7e0; }
    textarea.sig-input { resize: vertical; font-family: ${FONT_SANS}; }
    .sig-label {
      display: block; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
      color: rgba(234,231,224,0.5); margin-bottom: 8px; font-weight: 500;
    }
    .sig-nav-item {
      display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 8px;
      color: rgba(234,231,224,0.7); font-size: 14px; cursor: pointer; transition: background .15s ease, color .15s ease;
    }
    .sig-nav-item:hover { background: rgba(255,255,255,0.04); color: #eae7e0; }
    .sig-nav-item.active { background: rgba(255,255,255,0.07); color: #eae7e0; }
    .sig-cat-pill {
      font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; padding: 7px 14px; flex-shrink: 0;
      border-radius: 999px; cursor: pointer; color: rgba(234,231,224,0.55); font-weight: 500;
      border: 1px solid transparent; transition: all .15s ease; white-space: nowrap;
    }
    .sig-cat-pill.active { background: #eae7e0; color: #0a0a0a; }
    .sig-cat-pill:not(.active):hover { color: #eae7e0; }
    .sig-chip {
      display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 6px 12px;
      border-radius: 999px; background: rgba(255,255,255,0.06); cursor: pointer; letter-spacing: 0.02em;
      border: 1px solid transparent; transition: border-color .15s ease;
    }
    .sig-chip:hover { border-color: rgba(234,231,224,0.3); }

    .sig-masonry { column-count: 4; column-gap: 4px; padding: 24px 40px 60px; }
    .sig-card { position: relative; overflow: hidden; border-radius: 4px; cursor: pointer; background: #141414; break-inside: avoid; margin-bottom: 4px; display: inline-block; width: 100%; }
    .sig-card img { width: 100%; display: block; transition: transform .3s ease; }
    .sig-card:hover img { transform: scale(1.03); }

    .sig-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
    .sig-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
    .sig-fade-in { animation: sigFadeIn .35s ease; }
    @keyframes sigFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

    .sig-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.72); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 12px; }
    .sig-modal-card { width: 100%; max-height: 94vh; overflow-y: auto; background: #141414; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); }

    .sig-select-bar {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 40;
      display: flex; align-items: center; gap: 12px; padding: 10px 14px 10px 20px;
      background: #eae7e0; color: #0a0a0a; border-radius: 999px; box-shadow: 0 8px 30px rgba(0,0,0,0.5);
      font-size: 14px; font-weight: 500; white-space: nowrap;
    }

    /* ---------- Layout shell ---------- */
    .sig-app-shell { display: flex; }
    .sig-sidebar-desktop { display: block; }
    .sig-mobile-topbar { display: none; }
    .sig-mobile-bottomnav { display: none; }
    .sig-main-area { flex: 1; min-width: 0; height: 100vh; overflow-y: auto; }

    .sig-work-detail { display: flex; height: 100vh; }
    .sig-work-image-pane { flex: 1; min-width: 0; position: relative; background: #050505; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .sig-work-side-pane { width: 360px; flex-shrink: 0; border-left: 1px solid rgba(255,255,255,0.08); padding: 22px 24px 40px; overflow-y: auto; }

    /* ---------- Tablet ---------- */
    @media (min-width: 861px) and (max-width: 1100px) {
      .sig-sidebar-desktop > div { width: 220px !important; }
      .sig-masonry { column-count: 3; }
      .sig-landing-hero { gap: 24px !important; padding: 50px 32px 60px !important; }
      .sig-landing-hero-title { font-size: 42px !important; }
      .sig-work-side-pane { width: 320px; }
    }
    @media (max-width: 1200px) { .sig-masonry { column-count: 3; } }

    /* ---------- Phone + small tablet ---------- */
    @media (max-width: 860px) {
      .sig-app-shell { flex-direction: column; }
      .sig-sidebar-desktop { display: none !important; }
      .sig-mobile-topbar { display: flex !important; }
      .sig-mobile-bottomnav { display: flex !important; }
      .sig-main-area { height: auto; min-height: 100vh; overflow: visible; padding-bottom: 84px; }
      .sig-masonry { column-count: 2; padding: 14px 12px 40px; }
      .sig-select-bar { bottom: 84px; }

      .sig-work-detail { flex-direction: column; height: auto; min-height: 100vh; }
      .sig-work-image-pane { flex: none; height: 62vh; }
      .sig-work-side-pane { width: 100%; border-left: none; border-top: 1px solid rgba(255,255,255,0.08); overflow: visible; }

      .sig-topbar-row { flex-direction: column; align-items: flex-start !important; gap: 14px; padding: 20px 16px 0 !important; }
      .sig-topbar-search { width: 100% !important; }
      .sig-category-bar { flex-direction: column; align-items: stretch !important; gap: 12px; padding: 14px 16px 16px !important; }
      .sig-cat-scroll { overflow-x: auto; padding-bottom: 2px; }
      .sig-sort-row { justify-content: flex-end; }
      .sig-tag-bar { padding: 12px 16px 0 !important; }
      .sig-page-pad { padding-left: 16px !important; padding-right: 16px !important; }

      .sig-landing-nav { padding: 16px 18px !important; }
      .sig-landing-hero { grid-template-columns: 1fr !important; padding: 36px 20px 50px !important; gap: 36px !important; }
      .sig-landing-hero-title { font-size: 36px !important; }
      .sig-landing-stats { gap: 24px !important; }
      .sig-landing-manifesto { grid-template-columns: 1fr !important; gap: 20px !important; }
      .sig-landing-section { padding: 40px 20px !important; }
      .sig-landing-craft { grid-template-columns: 1fr !important; }
      .sig-landing-footer { flex-direction: column; gap: 12px; padding: 20px !important; align-items: flex-start !important; }

      .sig-auth-grid { grid-template-columns: 1fr !important; min-height: 100vh; }
      .sig-auth-hero-panel { display: none !important; }
      .sig-auth-form { padding: 32px 22px !important; }

      .sig-profile-header { flex-direction: column; align-items: flex-start !important; padding: 0 16px !important; margin-top: -36px !important; }
      .sig-settings-grid { grid-template-columns: 1fr !important; }
      .sig-upload-modal-grid { grid-template-columns: 1fr !important; }
      .sig-upload-modal-grid > div:first-child { border-right: none !important; border-bottom: 1px solid rgba(255,255,255,0.08); }
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
  };
  return <svg width={size} height={size} viewBox="0 0 24 24">{map[name] || null}</svg>;
}

function VerifiedBadge({ size = 14 }) {
  return (
    <span
      title="Verified artist"
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: "50%", background: "#7cc4a4", color: "#0a0a0a", marginLeft: 5, verticalAlign: "middle", flexShrink: 0 }}
    >
      <Icon name="check" size={Math.max(size - 4, 8)} />
    </span>
  );
}

function EmptyState({ title, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "90px 20px", color: "rgba(234,231,224,0.55)" }}>
      <div className="sig-serif" style={{ fontSize: 26, color: "#eae7e0", marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 14 }}>{sub}</div>
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
  ];
  return (
    <div style={{ width: 272, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.08)", padding: "28px 20px", display: "flex", flexDirection: "column", height: "100vh", position: "sticky", top: 0 }}>
      <div style={{ marginBottom: 36 }}>
        <div className="sig-serif" style={{ fontSize: 24, cursor: "pointer" }} onClick={() => setPage("landing")}>Signature</div>
        <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "rgba(234,231,224,0.4)", marginTop: 2 }}>A GALLERY FOR CREATORS</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
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
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}><Icon name={it.icon} /> {it.label}</span>
            {it.id === "notifications" && unreadCount > 0 && (
              <span style={{ background: "#e0748f", color: "#fff", fontSize: 10, fontWeight: 600, borderRadius: 999, minWidth: 17, height: 17, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{unreadCount}</span>
            )}
          </div>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      {profile ? (
        <>
          <button className="sig-btn-primary" style={{ width: "100%", marginBottom: 20 }} onClick={onUploadClick}>+ Upload artwork</button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#2a2a2a", flexShrink: 0, overflow: "hidden" }}>
              {profile.avatar_url && <img src={profile.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.name}</span>
                {profile.verified && <VerifiedBadge size={13} />}
              </div>
              <div style={{ fontSize: 12, color: "rgba(234,231,224,0.45)" }}>@{profile.username}</div>
            </div>
            <div style={{ cursor: "pointer", color: "rgba(234,231,224,0.5)" }} onClick={onSignOut} title="Sign out"><Icon name="exit" /></div>
          </div>
        </>
      ) : (
        <button className="sig-btn-outline" style={{ width: "100%" }} onClick={() => setPage("signin")}>
          <Icon name="signin" /> &nbsp;Sign in
        </button>
      )}
    </div>
  );
}

function MobileTopBar({ profile, setPage, onUploadClick }) {
  return (
    <div
      className="sig-mobile-topbar"
      style={{ alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)", position: "sticky", top: 0, background: "#0a0a0a", zIndex: 20 }}
    >
      <div className="sig-serif" style={{ fontSize: 20, cursor: "pointer" }} onClick={() => setPage("landing")}>Signature</div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {profile ? (
          <>
            <div style={{ cursor: "pointer", color: "rgba(234,231,224,0.85)", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }} onClick={onUploadClick}>
              <Icon name="upload" /> Upload
            </div>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#2a2a2a", overflow: "hidden", cursor: "pointer" }} onClick={() => setPage("settings")}>
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
  const Tab = ({ id, label, icon, onClick, dot }) => (
    <div
      onClick={onClick || (() => setPage(id))}
      style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "4px 10px", color: page === id ? "#eae7e0" : "rgba(234,231,224,0.4)", cursor: "pointer" }}
    >
      <Icon name={icon} />
      <span style={{ fontSize: 10 }}>{label}</span>
      {dot && <span style={{ position: "absolute", top: 0, right: 6, background: "#e0748f", width: 7, height: 7, borderRadius: "50%" }} />}
    </div>
  );
  return (
    <div
      className="sig-mobile-bottomnav"
      style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#0a0a0a", borderTop: "1px solid rgba(255,255,255,0.08)", zIndex: 30, padding: "8px 4px calc(8px + env(safe-area-inset-bottom))", justifyContent: "space-around" }}
    >
      <Tab id="explore" label="Explore" icon="explore" />
      <Tab id="following" label="Following" icon="home" />
      {profile && (
        <>
          <Tab id="profile" label="Profile" icon="user" onClick={onMyProfile} />
          <Tab id="notifications" label="Alerts" icon="bell" dot={unreadCount > 0} />
          <Tab id="collections" label="Saved" icon="layers" />
        </>
      )}
    </div>
  );
}

function TopBar({ eyebrow, title, search, setSearch }) {
  return (
    <div className="sig-topbar-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "28px 40px 0" }}>
      <div>
        <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "rgba(234,231,224,0.45)", marginBottom: 6 }}>{eyebrow}</div>
        <div className="sig-serif" style={{ fontSize: 34 }}>{title}</div>
      </div>
      {search !== undefined && (
        <div className="sig-topbar-search" style={{ position: "relative", width: 300 }}>
          <div style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "rgba(234,231,224,0.4)" }}><Icon name="search" /></div>
          <input
            className="sig-input"
            style={{ paddingLeft: 38, borderRadius: 999, background: "rgba(255,255,255,0.05)" }}
            placeholder="Search work, artists, tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

function CategoryBar({ cat, setCat, sort, setSort }) {
  const sortBtn = (id) => (
    <span
      key={id}
      onClick={() => setSort(id)}
      style={{ cursor: "pointer", padding: "4px 8px", border: sort === id ? "1px solid rgba(234,231,224,0.5)" : "1px solid transparent", borderRadius: 6, color: sort === id ? "#eae7e0" : "rgba(234,231,224,0.4)" }}
    >
      {id}
    </span>
  );
  return (
    <div className="sig-category-bar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 40px 22px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="sig-cat-scroll" style={{ display: "flex", gap: 6 }}>
        {CATEGORIES.map((c) => (
          <div key={c} className={"sig-cat-pill" + (cat === c ? " active" : "")} onClick={() => setCat(c)}>{c}</div>
        ))}
      </div>
      <div className="sig-sort-row" style={{ display: "flex", gap: 14, fontSize: 12, letterSpacing: "0.05em" }}>
        {sortBtn("recent")}
        {sortBtn("popular")}
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
      {works.map((w) => {
        const selected = selectable && selectedIds?.has(w.id);
        return (
          <div
            key={w.id}
            className="sig-card sig-fade-in"
            onClick={() => (selectable ? onToggle(w.id) : onOpen(w))}
            style={selected ? { outline: "2px solid #eae7e0", outlineOffset: -2 } : undefined}
          >
            <img src={w.image_url} alt={w.title} loading="lazy" />
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "24px 12px 10px", background: "linear-gradient(transparent, rgba(0,0,0,0.85))", fontSize: 12 }}>
              <div style={{ fontWeight: 500 }}>{w.title}</div>
              <div style={{ color: "rgba(234,231,224,0.6)", fontSize: 11, display: "flex", alignItems: "center" }}>
                {w.profiles?.name || "Unknown"}
                {w.profiles?.verified && <VerifiedBadge size={11} />}
              </div>
            </div>
            {w.critique_requested && !selectable && (
              <div style={{ position: "absolute", top: 8, left: 8, fontSize: 9, letterSpacing: "0.05em", padding: "3px 7px", borderRadius: 999, background: "rgba(224,116,143,0.9)", color: "#fff", fontWeight: 600 }}>CRITIQUE</div>
            )}
            {selectable && (
              <div
                style={{
                  position: "absolute", top: 8, right: 8, width: 24, height: 24, borderRadius: "50%",
                  border: "2px solid #eae7e0", background: selected ? "#eae7e0" : "rgba(0,0,0,0.45)",
                  color: "#0a0a0a", display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                {selected && <Icon name="check" size={14} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Landing, legal, auth                                                */
/* ------------------------------------------------------------------ */

function LandingPage({ setPage, stats }) {
  const features = [
    ["Critique Requested", "Flag a piece for honest, structured feedback instead of collecting empty likes."],
    ["Growth Threads", "Link a new piece to the earlier one it improves on — and the critique that shaped it."],
    ["Studio Log", "Show the process: sketch, linework, colour, final — as a swipeable sequence."],
    ["Non-algorithmic feed", "Chronological. Follow artists and tags. Discover what was actually just made."],
    ["High-res, always", "Zoom into every brushstroke. Your originals stay intact."],
    ["Verified artists", "A human-reviewed badge for people who can show they made the work."],
  ];
  return (
    <div style={{ overflowY: "auto", height: "100vh" }} className="sig-scrollbar">
      <div className="sig-landing-nav" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px 48px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="sig-serif" style={{ fontSize: 22 }}>Signature</div>
        <div style={{ display: "flex", gap: 12 }}>
          <button className="sig-btn-outline" onClick={() => setPage("signin")}>Sign in</button>
          <button className="sig-btn-primary" onClick={() => setPage("signup")}>Get started</button>
        </div>
      </div>

      <div className="sig-landing-hero" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, padding: "70px 48px 90px", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", color: "rgba(234,231,224,0.45)", marginBottom: 20 }}>A GALLERY · A COMMUNITY · FREE FOREVER</div>
          <div className="sig-serif sig-landing-hero-title" style={{ fontSize: 52, lineHeight: 1.1, marginBottom: 22 }}>
            Where <span style={{ fontStyle: "italic" }}>artists</span><br />become known<br />by their <span style={{ fontStyle: "italic" }}>signature.</span>
          </div>
          <div style={{ fontSize: 15, color: "rgba(234,231,224,0.65)", lineHeight: 1.6, marginBottom: 32, maxWidth: 460 }}>
            A quiet, high-fidelity home for illustrators, photographers, painters and sketch artists. Non-algorithmic feeds. High-res uploads. Real conversation with real people.
          </div>
          <div style={{ display: "flex", gap: 14, marginBottom: 56, flexWrap: "wrap" }}>
            <button className="sig-btn-primary" onClick={() => setPage("signup")}>Start your portfolio →</button>
            <button className="sig-btn-outline" onClick={() => setPage("explore")}>Wander the gallery</button>
          </div>
          <div className="sig-landing-stats" style={{ display: "flex", gap: 40 }}>
            <div><div className="sig-serif" style={{ fontSize: 26 }}>{stats.works}</div><div style={{ fontSize: 11, color: "rgba(234,231,224,0.45)" }}>WORKS ON DISPLAY</div></div>
            <div><div className="sig-serif" style={{ fontSize: 26 }}>{stats.creators}</div><div style={{ fontSize: 11, color: "rgba(234,231,224,0.45)" }}>SIGNED CREATORS</div></div>
            <div><div className="sig-serif" style={{ fontSize: 26 }}>$0</div><div style={{ fontSize: 11, color: "rgba(234,231,224,0.45)" }}>FOREVER, FOR YOU</div></div>
          </div>
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ borderRadius: 4, aspectRatio: "4/3", overflow: "hidden" }}>
            <img src={HERO_IMAGES[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            <div style={{ borderRadius: 4, aspectRatio: "1/1", overflow: "hidden" }}>
              <img src={HERO_IMAGES[1]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </div>
            <div style={{ borderRadius: 4, aspectRatio: "1/1", overflow: "hidden" }}>
              <img src={HERO_IMAGES[2]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </div>
          </div>
        </div>
      </div>

      <div className="sig-landing-section" style={{ padding: "60px 48px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.12em", color: "rgba(234,231,224,0.45)", marginBottom: 8 }}>MANIFESTO</div>
        <div className="sig-landing-manifesto" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60 }}>
          <div className="sig-serif" style={{ fontSize: 32, lineHeight: 1.2 }}>Made for artists,<br />not for advertisers.</div>
          <div style={{ fontSize: 15, color: "rgba(234,231,224,0.65)", lineHeight: 1.7 }}>
            <p>Signature is a home for the work — the sketch on a Tuesday morning, the finished piece after six weeks, the photograph you almost deleted.</p>
            <p>We show the art in the order it was made. We do not sell you. We do not chase engagement. We do not clip your resolution.</p>
            <p style={{ marginBottom: 0 }}>You keep your originals. You keep your voice. You keep your audience.</p>
          </div>
        </div>
      </div>

      <div className="sig-landing-section" style={{ padding: "50px 48px 70px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.12em", color: "rgba(234,231,224,0.45)", marginBottom: 28 }}>THE CRAFT</div>
        <div className="sig-landing-craft" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 28 }}>
          {features.map(([title, body]) => (
            <div key={title} style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 18 }}>
              <div className="sig-serif" style={{ fontSize: 20, marginBottom: 8 }}>{title}</div>
              <div style={{ fontSize: 13, color: "rgba(234,231,224,0.55)", lineHeight: 1.6 }}>{body}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="sig-landing-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px 48px", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 12, color: "rgba(234,231,224,0.4)" }}>
        <div className="sig-serif" style={{ fontSize: 16, color: "#eae7e0" }}>Signature</div>
        <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ cursor: "pointer" }} onClick={() => setPage("privacy")}>Privacy</span>
          <span style={{ cursor: "pointer" }} onClick={() => setPage("terms")}>Terms</span>
          <span>© 2026 · FREE FOREVER · MADE WITH CARE</span>
        </div>
      </div>
    </div>
  );
}

function LegalPage({ title, updated, children, setPage }) {
  return (
    <div style={{ overflowY: "auto", height: "100vh" }} className="sig-scrollbar">
      <div className="sig-landing-nav" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px 48px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="sig-serif" style={{ fontSize: 22, cursor: "pointer" }} onClick={() => setPage("landing")}>Signature</div>
        <button className="sig-btn-outline" onClick={() => setPage("landing")}>Back home</button>
      </div>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "60px 24px 100px" }}>
        <div className="sig-serif" style={{ fontSize: 38, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: "rgba(234,231,224,0.45)", marginBottom: 40 }}>Last updated {updated}</div>
        <div style={{ fontSize: 15, color: "rgba(234,231,224,0.75)", lineHeight: 1.8 }}>{children}</div>
      </div>
    </div>
  );
}

const Strong = ({ children }) => <strong style={{ color: "#eae7e0" }}>{children}</strong>;

function PrivacyPage({ setPage }) {
  return (
    <LegalPage title="Privacy Policy" updated="29 September 2026" setPage={setPage}>
      <p><Strong>What we collect.</Strong> When you create an account, we store your email address, the name and username you choose, and any profile details you add (bio, links, avatar, cover image). When you publish artwork, we store the image file, title, description, category, tags, any process shots you attach, and any comments or likes tied to it.</p>
      <p><Strong>How we use it.</Strong> Your email is used only to send you sign-in links and, if you opt in, a weekly digest of new work. We do not sell, rent, or share your data with advertisers. We do not run ads on Signature.</p>
      <p><Strong>Weekly digest.</Strong> The digest is off by default. If you turn it on in Settings, we email you a short weekly list of new pieces asking for critique. You can turn it off at any time.</p>
      <p><Strong>Verification.</Strong> If you request a verification badge, we store the note and links you submit so they can be reviewed by hand. We never ask for government ID or identity documents.</p>
      <p><Strong>Where it's stored.</Strong> Account data, artwork, and images are stored with Supabase, our database and hosting provider, on servers they operate. Data is protected by access rules so only you can edit or delete your own account and uploads.</p>
      <p><Strong>Public content.</Strong> Artwork you publish, its process shots, any Growth Thread you create, and your name, username, and avatar are visible to anyone who visits Signature, including people without an account. Comments and likes are attributed to your account and are also public. Your collections and the tags you follow are private to you.</p>
      <p><Strong>Your choices.</Strong> You can edit or delete any artwork you've published at any time. You can update your profile in Settings. If you'd like your account and all associated data permanently deleted, contact us using the details below and we'll process the request.</p>
      <p><Strong>Cookies and tracking.</Strong> Signature uses only the minimum technical storage needed to keep you signed in. We do not use third-party advertising trackers.</p>
      <p><Strong>Changes.</Strong> If this policy changes in a meaningful way, we'll update the date above.</p>
      <p><Strong>Contact.</Strong> Questions about your data can be sent to the email address that sends your sign-in links.</p>
    </LegalPage>
  );
}

function TermsPage({ setPage }) {
  return (
    <LegalPage title="Terms of Service" updated="29 September 2026" setPage={setPage}>
      <p><Strong>Using Signature.</Strong> Signature is a free gallery and community for artists, illustrators, photographers, and creators to publish and discuss original work. By creating an account, you agree to these terms.</p>
      <p><Strong>Your content.</Strong> You retain full ownership of everything you upload. By publishing artwork, you grant Signature a license to display, resize, and store it so the platform can function — we never claim ownership of your work and never use it for anything beyond displaying it on the site.</p>
      <p><Strong>Only upload what's yours.</Strong> Don't publish artwork, photographs, or other content you don't have the rights to. Don't impersonate another artist or misattribute someone else's work as your own. Process shots and Growth Threads must show your own work.</p>
      <p><Strong>Community conduct.</Strong> Critiques and comments should be honest but respectful. Harassment, hate speech, sexually explicit content, and content that endangers or exploits minors are never permitted and will result in immediate removal and account termination.</p>
      <p><Strong>Verification badge.</Strong> The badge is granted by hand after review and can be removed if it turns out the work isn't yours.</p>
      <p><Strong>Reporting.</Strong> If you see content that violates these terms, use the report option on the artwork.</p>
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
    ? { title: <>A studio,<br />a gallery, a home.</>, sub: "Free forever. Non-algorithmic. Yours entirely.", bg: "linear-gradient(160deg,#3d2a1a,#1a1a2e)" }
    : { title: <>Come back<br />to your studio.</>, sub: "Every stroke you made is still here. So is your community.", bg: "linear-gradient(160deg,#0f2d2d,#2a1a2e)" };

  const heroPanel = (side) => (
    <div className="sig-auth-hero-panel" style={{ position: "relative", background: heroCopy.bg }}>
      <div style={{ position: "absolute", top: 24, [side]: 40 }} className="sig-serif">Signature</div>
      <div style={{ position: "absolute", bottom: 40, left: 40, right: 40 }}>
        <div className="sig-serif" style={{ fontSize: 28, marginBottom: 10 }}>{heroCopy.title}</div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.7)" }}>{heroCopy.sub}</div>
      </div>
    </div>
  );

  return (
    <div className="sig-auth-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", minHeight: "100vh" }}>
      {!isSignup && heroPanel("left")}
      <div className="sig-auth-form" style={{ padding: 48, display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 460, margin: "0 auto", width: "100%" }}>
        <div className="sig-serif" style={{ fontSize: 18, marginBottom: 28, cursor: "pointer" }} onClick={() => setPage("landing")}>Signature</div>
        {linkSent ? (
          <>
            <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "rgba(234,231,224,0.45)", marginBottom: 8 }}>ALMOST THERE</div>
            <div className="sig-serif" style={{ fontSize: 30, marginBottom: 14 }}>Check your inbox.</div>
            <div style={{ fontSize: 14, color: "rgba(234,231,224,0.65)", lineHeight: 1.6, marginBottom: 22 }}>
              We sent a sign-in link to <strong style={{ color: "#eae7e0" }}>{email.trim()}</strong>. Open it on this device and you'll be signed in automatically — no code to type.
            </div>
            {error && <div style={{ color: "#e8746a", fontSize: 13, marginBottom: 14 }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "rgba(234,231,224,0.5)" }}>
              <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => { setLinkSent(false); onError(""); }}>Use a different email</span>
              <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={sendLink}>{busy ? "…" : "Resend link"}</span>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "rgba(234,231,224,0.45)", marginBottom: 8 }}>{isSignup ? "CREATE ACCOUNT" : "SIGN IN"}</div>
            <div className="sig-serif" style={{ fontSize: 32, marginBottom: 10 }}>{isSignup ? "Sign your work." : "Welcome back."}</div>
            <div style={{ fontSize: 13, color: "rgba(234,231,224,0.5)", marginBottom: 24 }}>No password needed — we'll email you a one-click sign-in link.</div>
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
            {error && <div style={{ color: "#e8746a", fontSize: 13, marginBottom: 14 }}>{error}</div>}
            <button className="sig-btn-primary" style={{ marginBottom: 14 }} disabled={busy} onClick={sendLink}>{busy ? "Sending…" : "Send sign-in link"}</button>
            <div style={{ textAlign: "center", fontSize: 13, color: "rgba(234,231,224,0.5)" }}>
              {isSignup
                ? <>Already have one? <span style={{ color: "#eae7e0", cursor: "pointer", textDecoration: "underline" }} onClick={() => { onError(""); setPage("signin"); }}>Sign in</span></>
                : <>New here? <span style={{ color: "#eae7e0", cursor: "pointer", textDecoration: "underline" }} onClick={() => { onError(""); setPage("signup"); }}>Create an account</span></>}
            </div>
            {isSignup && (
              <div style={{ textAlign: "center", fontSize: 12, color: "rgba(234,231,224,0.4)", marginTop: 14 }}>
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
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="sig-serif" style={{ fontSize: 19 }}>{title}</div>
      <div style={{ cursor: "pointer", color: "rgba(234,231,224,0.6)", display: "flex" }} onClick={onClose}><Icon name="x" /></div>
    </div>
  );
}

function UploadModal({ userId, myWorks, onClose, onPublished }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [medium, setMedium] = useState("");
  const [tags, setTags] = useState("");
  const [critiqueRequested, setCritiqueRequested] = useState(false);
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
    try {
      const path = `${userId}/${Date.now()}.${extOf(file)}`;
      const { error: uploadError } = await supabase.storage.from("artwork").upload(path, file);
      if (uploadError) throw uploadError;
      const { data: pub } = supabase.storage.from("artwork").getPublicUrl(path);
      const { data: created, error: insertError } = await supabase
        .from("works")
        .insert({
          user_id: userId,
          title: title.trim(),
          description: description.trim(),
          category,
          medium: medium.trim(),
          tags: tagList,
          image_url: pub.publicUrl,
          critique_requested: critiqueRequested,
        })
        .select("id")
        .single();
      if (insertError) throw insertError;
      newId = created.id;
    } catch (e) {
      console.error("Publish failed:", e);
      setErr(e.message || "Upload failed. Check the browser console for details.");
      setBusy(false);
      return;
    }

    // Optional extras — the piece is already published, so a failure here shouldn't undo it.
    const warnings = [];
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
    onPublished();
  }

  return (
    <div className="sig-modal-overlay" onClick={onClose}>
      <div className="sig-modal-card sig-fade-in sig-scrollbar" style={{ maxWidth: 800 }} onClick={(e) => e.stopPropagation()}>
        <ModalHeader title="Publish new work" onClose={onClose} />
        <div className="sig-upload-modal-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
          <div style={{ padding: 22, borderRight: "1px solid rgba(255,255,255,0.08)" }}>
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
              style={{ height: 260, border: "1px dashed rgba(255,255,255,0.2)", borderRadius: 8, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", overflow: "hidden" }}
            >
              {preview ? <img src={preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (
                <>
                  <Icon name="upload" />
                  <div style={{ marginTop: 10, fontSize: 14 }}>Drop the finished piece or click to browse</div>
                  <div style={{ fontSize: 12, color: "rgba(234,231,224,0.4)", marginTop: 4 }}>JPG · PNG · WEBP · UP TO {MAX_UPLOAD_MB}MB</div>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />

            <div style={{ marginTop: 20 }}>
              <label className="sig-label">Studio Log — process shots (optional)</label>
              <div style={{ fontSize: 12, color: "rgba(234,231,224,0.45)", marginBottom: 10, lineHeight: 1.5 }}>
                Add up to {MAX_PROCESS_SHOTS} in-progress images in order (sketch → linework → colour). Viewers can swipe through them.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {steps.map((s, i) => (
                  <div key={i} style={{ position: "relative", width: 64, height: 64, borderRadius: 6, overflow: "hidden", border: "1px solid rgba(255,255,255,0.15)" }}>
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
                    style={{ width: 64, height: 64, borderRadius: 6, border: "1px dashed rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(234,231,224,0.6)" }}
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

            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "rgba(234,231,224,0.75)", marginBottom: 14, cursor: "pointer", lineHeight: 1.5 }}>
              <input type="checkbox" style={{ marginTop: 3 }} checked={critiqueRequested} onChange={(e) => setCritiqueRequested(e.target.checked)} />
              Open this piece for critique — invite structured, honest feedback
            </label>

            <div style={{ padding: 14, borderRadius: 10, border: "1px solid rgba(124,196,164,0.25)", background: "rgba(124,196,164,0.04)", marginBottom: 16 }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "rgba(234,231,224,0.85)", cursor: "pointer", lineHeight: 1.5 }}>
                <input type="checkbox" style={{ marginTop: 3 }} checked={threadOn} onChange={(e) => setThreadOn(e.target.checked)} />
                <span><strong>Growth Thread</strong> — this piece builds on an earlier one, using feedback I got</span>
              </label>
              {threadOn && (
                <div style={{ marginTop: 12 }}>
                  {myWorks.length === 0 ? (
                    <div style={{ fontSize: 12, color: "rgba(234,231,224,0.5)" }}>You have no earlier pieces yet. Publish this one first, then link future work to it.</div>
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

            {err && <div style={{ color: "#e8746a", fontSize: 13, marginBottom: 12 }}>{err}</div>}
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

function EditModal({ work, onClose, onSaved }) {
  const [title, setTitle] = useState(work.title || "");
  const [description, setDescription] = useState(work.description || "");
  const [category, setCategory] = useState(work.category || "");
  const [medium, setMedium] = useState(work.medium || "");
  const [tags, setTags] = useState((work.tags || []).join(", "));
  const [critiqueRequested, setCritiqueRequested] = useState(!!work.critique_requested);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!title.trim()) { setErr("Give your work a title."); return; }
    if (!description.trim()) { setErr("Add a description."); return; }
    if (!category) { setErr("Choose a category."); return; }
    const tagList = cleanTags(tags);
    if (tagList.length === 0) { setErr("Add at least one tag."); return; }
    setBusy(true);
    setErr("");
    const { error } = await supabase
      .from("works")
      .update({ title: title.trim(), description: description.trim(), category, medium: medium.trim(), tags: tagList, critique_requested: critiqueRequested })
      .eq("id", work.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved();
  }

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
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "rgba(234,231,224,0.7)", marginBottom: 16, cursor: "pointer" }}>
            <input type="checkbox" checked={critiqueRequested} onChange={(e) => setCritiqueRequested(e.target.checked)} />
            Open this piece for critique
          </label>
          {err && <div style={{ color: "#e8746a", fontSize: 13, marginBottom: 12 }}>{err}</div>}
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
          <div style={{ fontSize: 13, color: "rgba(234,231,224,0.6)", marginBottom: 18 }}>
            Reports are reviewed by Signature. This won't notify the artist directly.
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
          {err && <div style={{ color: "#e8746a", fontSize: 13, marginBottom: 12 }}>{err}</div>}
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
            <div style={{ fontSize: 14, color: "rgba(234,231,224,0.55)", padding: "20px 0" }}>You haven't published any work yet.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
              {works.map((w) => {
                const on = selected.has(w.id);
                return (
                  <div
                    key={w.id}
                    onClick={() => toggle(w.id)}
                    style={{ position: "relative", aspectRatio: "1/1", borderRadius: 6, overflow: "hidden", cursor: "pointer", outline: on ? "2px solid #eae7e0" : "1px solid rgba(255,255,255,0.1)", outlineOffset: on ? -2 : -1 }}
                  >
                    <img src={w.image_url} alt={w.title} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: on ? 1 : 0.7 }} />
                    <div style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: "50%", border: "2px solid #eae7e0", background: on ? "#eae7e0" : "rgba(0,0,0,0.45)", color: "#0a0a0a", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {on && <Icon name="check" size={13} />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 20, gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, color: "rgba(234,231,224,0.55)" }}>{selected.size} selected</div>
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
            <div style={{ fontSize: 14, color: "rgba(234,231,224,0.55)" }}>Loading…</div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                {collections.map((c) => (
                  <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
                    <input type="radio" name="collection" checked={chosen === c.id} onChange={() => setChosen(c.id)} />
                    {c.name} <span style={{ color: "rgba(234,231,224,0.4)", fontSize: 12 }}>· {(c.work_ids || []).length} works</span>
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
              {err && <div style={{ color: "#e8746a", fontSize: 13, marginBottom: 12 }}>{err}</div>}
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

const EMPTY_THREAD = { previous: null, critiques: [], note: "", newer: [] };

function ThreadThumb({ label, work, onClick, current }) {
  return (
    <div onClick={onClick} style={{ cursor: onClick ? "pointer" : "default", minWidth: 0 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.08em", color: current ? "#7cc4a4" : "rgba(234,231,224,0.5)", marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ aspectRatio: "1/1", borderRadius: 6, overflow: "hidden", outline: current ? "2px solid #7cc4a4" : "1px solid rgba(255,255,255,0.12)", outlineOffset: -1 }}>
        <img src={work.image_url} alt={work.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </div>
      <div style={{ fontSize: 12, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{work.title}</div>
    </div>
  );
}

function WorkDetail({ work, profile, onBack, onDelete, onViewProfile, onEdit, onOpenWork, onTagClick }) {
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

  const isOwner = profile?.id === work.user_id;

  useEffect(() => {
    let cancelled = false;
    setSlide(null);
    setSteps([]);
    setThread(EMPTY_THREAD);
    setComment("");
    setIsCritique(false);
    setIsFollowing(false);

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
  const go = (delta) => setSlide(Math.max(0, Math.min(slides.length - 1, current + delta)));

  function onTouchStart(e) { touchStartX.current = e.touches[0].clientX; }
  function onTouchEnd(e) {
    if (touchStartX.current === null || slides.length < 2) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  }

  /* ---- actions ---- */
  function copyShareLink() {
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
    lines.push(`Exported: ${new Date().toLocaleDateString()}`, "", `${list.length} ${noun}${list.length === 1 ? "" : "s"}`, "-".repeat(40));
    list.forEach((c, i) => {
      lines.push("", `${i + 1}. ${c.profiles?.name || "Someone"} — ${new Date(c.created_at).toLocaleDateString()}`, `   ${c.text.replace(/\n/g, "\n   ")}`);
    });
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

  const linkStyle = { cursor: "pointer", color: "rgba(234,231,224,0.5)", display: "flex", alignItems: "center", gap: 4, fontSize: 13 };
  const hasThread = thread.previous || thread.newer.length > 0;

  return (
    <div className="sig-work-detail">
      {/* ---------------- image pane ---------------- */}
      <div className="sig-work-image-pane" style={{ paddingBottom: steps.length > 0 ? 96 : 0 }} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div style={{ position: "absolute", top: 20, left: 20, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "rgba(234,231,224,0.9)", fontSize: 14, zIndex: 3, background: "rgba(0,0,0,0.35)", padding: "6px 12px 6px 8px", borderRadius: 999 }} onClick={onBack}>
          <Icon name="back" /> Back
        </div>

        <img src={slides[current].src} alt={work.title} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />

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

        {steps.length > 0 && (
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 96, padding: "10px 16px", display: "flex", gap: 8, justifyContent: "center", alignItems: "center", background: "linear-gradient(transparent, rgba(0,0,0,0.6))", zIndex: 3 }}>
            {slides.map((s, i) => (
              <div key={i} onClick={() => setSlide(i)} style={{ textAlign: "center", cursor: "pointer", opacity: i === current ? 1 : 0.55 }}>
                <div style={{ width: 56, height: 56, borderRadius: 6, overflow: "hidden", outline: i === current ? "2px solid #eae7e0" : "1px solid rgba(255,255,255,0.2)", outlineOffset: -1 }}>
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
            <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "rgba(234,231,224,0.45)" }}>{(work.category || "").toUpperCase()}</div>
            {work.critique_requested && (
              <div style={{ fontSize: 10, letterSpacing: "0.06em", padding: "3px 8px", borderRadius: 999, background: "rgba(224,116,143,0.15)", color: "#e0748f", fontWeight: 600 }}>CRITIQUE REQUESTED</div>
            )}
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "rgba(234,231,224,0.5)" }}><Icon name="eye" /> {work.views || 0}</div>
            <div style={linkStyle} onClick={copyShareLink}><Icon name="share" /> {shareCopied ? "Copied" : "Share"}</div>
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
              style={{ flex: 1, padding: "8px 14px", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, borderColor: "rgba(224,116,143,0.4)", color: "#e0748f" }}
              onClick={() => { if (window.confirm("Delete this artwork? This can't be undone.")) onDelete(work); }}
            >
              <Icon name="trash" /> Delete
            </button>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#2a2a2a", overflow: "hidden", cursor: "pointer", flexShrink: 0 }} onClick={() => onViewProfile(work.user_id)}>
            {work.profiles?.avatar_url && <img src={work.profiles.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
          </div>
          <div style={{ flex: 1, cursor: "pointer", minWidth: 0 }} onClick={() => onViewProfile(work.user_id)}>
            <div style={{ fontSize: 14, fontWeight: 500, display: "flex", alignItems: "center" }}>
              {work.profiles?.name || "Unknown"}
              {work.profiles?.verified && <VerifiedBadge />}
            </div>
            <div style={{ fontSize: 12, color: "rgba(234,231,224,0.45)" }}>@{work.profiles?.username}</div>
          </div>
          {profile && !isOwner && (
            <button className={isFollowing ? "sig-btn-outline" : "sig-btn-primary"} style={{ padding: "6px 16px", fontSize: 12 }} onClick={toggleFollow}>
              {isFollowing ? "Following" : "Follow"}
            </button>
          )}
        </div>

        {work.description && <div style={{ fontSize: 14, color: "rgba(234,231,224,0.7)", lineHeight: 1.6, marginBottom: 16 }}>{work.description}</div>}

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
          <div style={{ marginBottom: 18, padding: 14, borderRadius: 10, border: "1px solid rgba(124,196,164,0.28)", background: "rgba(124,196,164,0.05)" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#7cc4a4", fontWeight: 600, marginBottom: 12 }}>GROWTH THREAD</div>
            {thread.previous && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <ThreadThumb label="BEFORE" work={thread.previous} onClick={() => onOpenWork(thread.previous.id)} />
                  <ThreadThumb label="AFTER · THIS PIECE" work={work} current />
                </div>
                {thread.note && (
                  <div style={{ fontSize: 13, lineHeight: 1.55, marginTop: 12, color: "rgba(234,231,224,0.85)" }}>
                    <span style={{ color: "rgba(234,231,224,0.45)" }}>What changed: </span>{thread.note}
                  </div>
                )}
                {thread.critiques.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "rgba(234,231,224,0.45)", marginBottom: 6 }}>FEEDBACK ON THE EARLIER PIECE</div>
                    {thread.critiques.map((c) => (
                      <div key={c.id} style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 6, paddingLeft: 10, borderLeft: "2px solid rgba(224,116,143,0.6)", color: "rgba(234,231,224,0.7)" }}>
                        <strong style={{ color: "#eae7e0" }}>{c.profiles?.name || "Someone"}:</strong> {c.text.length > 180 ? c.text.slice(0, 180) + "…" : c.text}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {thread.newer.length > 0 && (
              <div style={{ marginTop: thread.previous ? 14 : 0 }}>
                <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "rgba(234,231,224,0.45)", marginBottom: 8 }}>LATER IMPROVED IN</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {thread.newer.map((n) => <ThreadThumb key={n.id} label="AFTER" work={n} onClick={() => onOpenWork(n.id)} />)}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 18, alignItems: "center", paddingBottom: 16, borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: profile ? "pointer" : "default", color: liked ? "#e0748f" : "rgba(234,231,224,0.7)" }} onClick={toggleLike}>
            <Icon name="heart" /> {likes.length}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "rgba(234,231,224,0.7)" }}><Icon name="comment" /> {comments.length}</div>
        </div>

        {isOwner && comments.length > 0 && (
          <button className="sig-btn-outline" style={{ width: "100%", padding: "9px 14px", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 16 }} onClick={downloadCritiqueSummary}>
            <Icon name="download" /> Download critique summary
          </button>
        )}

        {profile ? (
          <div style={{ marginBottom: 16 }}>
            <textarea className="sig-input" rows={2} placeholder={work.critique_requested ? "Share honest, constructive feedback…" : "Leave a thoughtful comment…"} value={comment} onChange={(e) => setComment(e.target.value)} />
            {work.critique_requested && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgba(234,231,224,0.55)", marginTop: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={isCritique} onChange={(e) => setIsCritique(e.target.checked)} /> Mark as structured critique
              </label>
            )}
            <button className="sig-btn-primary" style={{ marginTop: 8, padding: "8px 18px", fontSize: 13 }} onClick={postComment}>Post</button>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "rgba(234,231,224,0.5)", marginBottom: 16 }}>Sign in to like, follow, or comment.</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {comments.map((c) => (
            <div
              key={c.id}
              style={{ fontSize: 13, padding: c.is_critique ? "10px 12px" : 0, background: c.is_critique ? "rgba(224,116,143,0.08)" : "transparent", borderRadius: c.is_critique ? 8 : 0, borderLeft: c.is_critique ? "2px solid #e0748f" : "none" }}
            >
              {c.is_critique && <div style={{ fontSize: 10, color: "#e0748f", fontWeight: 600, marginBottom: 3, letterSpacing: "0.04em" }}>CRITIQUE</div>}
              <span style={{ fontWeight: 500 }}>{c.profiles?.name || "Someone"}</span>
              <span style={{ color: "rgba(234,231,224,0.65)" }}> {c.text}</span>
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
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#eae7e0", color: "#0a0a0a", padding: "10px 20px", borderRadius: 999, fontSize: 13, fontWeight: 500, zIndex: 200 }}>
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

  if (loading) return <div style={{ padding: 40, color: "rgba(234,231,224,0.5)" }}>Loading…</div>;
  if (!viewedProfile) return <EmptyState title="Artist not found." sub="This profile may have been removed." />;

  const totalViews = works.reduce((sum, w) => sum + (w.views || 0), 0);
  const totalLikes = works.reduce((sum, w) => sum + (w.like_count || 0), 0);

  return (
    <div>
      <div style={{ height: 180, background: viewedProfile.cover_url ? `url(${viewedProfile.cover_url}) center/cover` : "linear-gradient(135deg,#1a1a2e,#3d2a1a)" }} />
      <div className="sig-profile-header" style={{ padding: "0 40px", marginTop: -44, display: "flex", alignItems: "flex-end", gap: 18 }}>
        <div style={{ width: 96, height: 96, borderRadius: "50%", background: "#2a2a2a", border: "4px solid #0a0a0a", overflow: "hidden", flexShrink: 0 }}>
          {viewedProfile.avatar_url && <img src={viewedProfile.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
        </div>
        <div style={{ paddingBottom: 6, flex: 1 }}>
          <div className="sig-serif" style={{ fontSize: 24, display: "flex", alignItems: "center" }}>
            {viewedProfile.name}
            {viewedProfile.verified && <VerifiedBadge size={18} />}
          </div>
          <div style={{ fontSize: 13, color: "rgba(234,231,224,0.5)" }}>@{viewedProfile.username} · {works.length} works · {followerCount} followers</div>
        </div>
        {!isOwn && currentProfile && (
          <button className={isFollowing ? "sig-btn-outline" : "sig-btn-primary"} style={{ marginBottom: 6 }} onClick={toggleFollow}>
            {isFollowing ? "Following" : "Follow"}
          </button>
        )}
      </div>

      {viewedProfile.bio && <div className="sig-page-pad" style={{ padding: "18px 40px 0", fontSize: 14, color: "rgba(234,231,224,0.7)", maxWidth: 560 }}>{viewedProfile.bio}</div>}

      <div className="sig-page-pad" style={{ display: "flex", gap: 28, padding: "18px 40px 0" }}>
        <div><span className="sig-serif" style={{ fontSize: 18 }}>{totalViews}</span> <span style={{ fontSize: 12, color: "rgba(234,231,224,0.45)" }}>total views</span></div>
        <div><span className="sig-serif" style={{ fontSize: 18 }}>{totalLikes}</span> <span style={{ fontSize: 12, color: "rgba(234,231,224,0.45)" }}>total likes</span></div>
      </div>

      <div className="sig-page-pad" style={{ padding: "22px 40px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", marginTop: 12 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "rgba(234,231,224,0.45)" }}>{isOwn ? "YOUR WORKS" : "WORKS"}</div>
        {isOwn && works.length > 0 && (
          <button className="sig-btn-outline" style={{ padding: "6px 16px", fontSize: 12 }} onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}>
            {selectMode ? "Cancel" : "Select works"}
          </button>
        )}
      </div>

      {selectMode && (
        <div className="sig-page-pad" style={{ padding: "12px 40px 0", fontSize: 13, color: "rgba(234,231,224,0.55)" }}>
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
          <button className="sig-btn-primary" style={{ background: "#0a0a0a", color: "#eae7e0", padding: "8px 18px", fontSize: 13 }} disabled={selected.size === 0} onClick={() => setShowAdd(true)}>
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
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#eae7e0", color: "#0a0a0a", padding: "10px 20px", borderRadius: 999, fontSize: 13, fontWeight: 500, zIndex: 200 }}>
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

  const verb = (type) => (type === "like" ? "liked your work" : type === "comment" ? "commented on your work" : type === "follow" ? "started following you" : "interacted with your work");

  if (loading) return <div style={{ padding: 40, color: "rgba(234,231,224,0.5)" }}>Loading…</div>;

  return (
    <div>
      <TopBar eyebrow="SIGNALS" title="Notifications" />
      {items.length === 0 ? (
        <EmptyState title="A quiet studio." sub="Come back later." />
      ) : (
        <div className="sig-page-pad" style={{ padding: "20px 40px 60px", display: "flex", flexDirection: "column", gap: 2 }}>
          {items.map((n) => (
            <div
              key={n.id}
              onClick={() => n.work_id && onOpenWork?.(n.work_id)}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 8, cursor: n.work_id ? "pointer" : "default", background: n.read ? "transparent" : "rgba(255,255,255,0.03)" }}
            >
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#2a2a2a", flexShrink: 0, overflow: "hidden" }}>
                {n.actor?.avatar_url && <img src={n.actor.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
              </div>
              <div style={{ flex: 1, fontSize: 14, minWidth: 0 }}>
                <strong>{n.actor?.name || "Someone"}</strong> <span style={{ color: "rgba(234,231,224,0.65)" }}>{verb(n.type)}</span>
                {n.works?.title && <span style={{ color: "rgba(234,231,224,0.45)" }}> — {n.works.title}</span>}
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
        <div className="sig-page-pad" style={{ padding: "24px 40px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "rgba(234,231,224,0.7)", fontSize: 14, marginBottom: 18 }} onClick={() => setOpenId(null)}>
            <Icon name="back" /> Collections
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "rgba(234,231,224,0.45)", marginBottom: 6 }}>COLLECTION · PRIVATE TO YOU</div>
              <div className="sig-serif" style={{ fontSize: 34 }}>{open.name}</div>
              <div style={{ fontSize: 13, color: "rgba(234,231,224,0.5)", marginTop: 4 }}>{items.length} work{items.length === 1 ? "" : "s"}</div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="sig-btn-primary" onClick={() => setPicking(true)}>Add / remove works</button>
              <button
                className="sig-btn-outline"
                style={{ borderColor: "rgba(224,116,143,0.4)", color: "#e0748f" }}
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
    <div className="sig-page-pad" style={{ padding: "28px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 26, gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "rgba(234,231,224,0.45)", marginBottom: 6 }}>YOUR STUDIO</div>
          <div className="sig-serif" style={{ fontSize: 34 }}>Collections</div>
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
        <div style={{ color: "rgba(234,231,224,0.5)" }}>Loading…</div>
      ) : collections.length === 0 ? (
        <EmptyState title="No collections yet." sub="Group your works into a series or study — select works on your profile to add them." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
          {collections.map((c) => {
            const items = worksIn(c);
            return (
              <div key={c.id} onClick={() => setOpenId(c.id)} style={{ cursor: "pointer", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ aspectRatio: "16/10", background: "#141414", display: "grid", gridTemplateColumns: items.length > 1 ? "1fr 1fr" : "1fr", gap: 2 }}>
                  {items.slice(0, 4).map((w) => <img key={w.id} src={w.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />)}
                </div>
                <div style={{ padding: 14 }}>
                  <div style={{ fontWeight: 500 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: "rgba(234,231,224,0.45)", marginTop: 4 }}>{items.length} work{items.length === 1 ? "" : "s"}</div>
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
    if (error) { setMsg(error.message); return; }
    setNote("");
    setLink("");
    load();
  }

  const box = { padding: 16, borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.02)", marginBottom: 24 };

  if (profile.verified) {
    return (
      <div style={{ ...box, borderColor: "rgba(124,196,164,0.35)" }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 14, fontWeight: 500 }}>You're a verified artist<VerifiedBadge size={16} /></div>
        <div style={{ fontSize: 12, color: "rgba(234,231,224,0.5)", marginTop: 6 }}>The badge shows next to your name across Signature.</div>
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Get verified</div>
      <div style={{ fontSize: 12, color: "rgba(234,231,224,0.5)", lineHeight: 1.6, marginBottom: 14 }}>
        A hand-reviewed badge that says a real person made this work. We never ask for ID — just show us proof: a link to your other portfolio, or tell us about your process photos.
      </div>
      {request === undefined ? (
        <div style={{ fontSize: 13, color: "rgba(234,231,224,0.5)" }}>Loading…</div>
      ) : request?.status === "pending" ? (
        <div style={{ fontSize: 13, color: "#d9b36c" }}>Your request is waiting for review. We'll add the badge if it's approved.</div>
      ) : (
        <>
          {request?.status === "rejected" && <div style={{ fontSize: 13, color: "#e8746a", marginBottom: 12 }}>Your last request wasn't approved. You can send another with more proof.</div>}
          <label className="sig-label">How can we confirm it's your work? *</label>
          <textarea className="sig-input" rows={3} style={{ marginBottom: 12 }} placeholder="e.g. I post my WIP on Instagram under the same name; my process shots are on Signature." value={note} onChange={(e) => setNote(e.target.value)} />
          <label className="sig-label">Link (optional)</label>
          <input className="sig-input" style={{ marginBottom: 12 }} placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
          {msg && <div style={{ color: "#e8746a", fontSize: 13, marginBottom: 10 }}>{msg}</div>}
          <button className="sig-btn-outline" disabled={busy} onClick={submit}>{busy ? "Sending…" : "Request verification"}</button>
        </>
      )}
    </div>
  );
}

function SettingsPage({ profile, onSave }) {
  const [form, setForm] = useState(profile);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const avatarRef = useRef(null);
  const coverRef = useRef(null);

  useEffect(() => setForm(profile), [profile]);

  const digestAvailable = typeof profile.digest_opt_in === "boolean";

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
    const { error } = await onSave(payload);
    setBusy(false);
    if (error) { setMsg(error.message || "Couldn't save your changes."); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="sig-page-pad" style={{ padding: "28px 40px 60px", maxWidth: 680 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "rgba(234,231,224,0.45)", marginBottom: 6 }}>STUDIO</div>
      <div className="sig-serif" style={{ fontSize: 34, marginBottom: 30 }}>Settings</div>

      <label className="sig-label">Cover image</label>
      <div onClick={() => coverRef.current?.click()} style={{ height: 140, borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: form.cover_url ? `url(${form.cover_url}) center/cover` : "rgba(255,255,255,0.03)", marginBottom: 22, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(234,231,224,0.35)", fontSize: 12 }}>
        {!form.cover_url && "CHANGE"}
      </div>
      <input ref={coverRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => uploadTo("cover_url", e.target.files[0])} />

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <div onClick={() => avatarRef.current?.click()} style={{ width: 72, height: 72, borderRadius: "50%", background: "#2a2a2a", overflow: "hidden", cursor: "pointer", flexShrink: 0 }}>
          {form.avatar_url && <img src={form.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
        </div>
        <div style={{ fontSize: 13, color: "rgba(234,231,224,0.5)", cursor: "pointer" }} onClick={() => avatarRef.current?.click()}>Click to change your avatar</div>
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
            <span style={{ display: "block", fontSize: 12, color: "rgba(234,231,224,0.5)" }}>A short digest of new pieces asking for critique. Off by default; change it any time.</span>
          </span>
        </label>
      )}

      {msg && <div style={{ color: "#e8746a", fontSize: 13, marginBottom: 12 }}>{msg}</div>}
      <button className="sig-btn-primary" style={{ marginBottom: 36 }} disabled={busy} onClick={save}>{saved ? "Saved" : busy ? "Saving…" : "Save changes"}</button>

      <VerificationPanel profile={profile} />
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
  const [search, setSearch] = useState("");
  const [showUpload, setShowUpload] = useState(false);
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
  if (page === "landing") return <><GlobalStyle /><LandingPage setPage={setPage} stats={{ works: works.length, creators: creatorCount }} /></>;
  if (page === "privacy") return <><GlobalStyle /><PrivacyPage setPage={setPage} /></>;
  if (page === "terms") return <><GlobalStyle /><TermsPage setPage={setPage} /></>;
  if (page === "signin" || page === "signup") return <><GlobalStyle /><AuthPage mode={page} setPage={(p) => { setAuthError(""); setPage(p); }} onError={setAuthError} error={authError} /></>;

  /* ---------- derived data ---------- */

  const myWorks = profile ? works.filter((w) => w.user_id === profile.id) : [];

  let filtered = works.filter((w) => cat === "All" || w.category === cat);
  if (search.trim()) {
    const q = search.trim().toLowerCase().replace(/^#/, "");
    filtered = filtered.filter((w) => w.title?.toLowerCase().includes(q) || w.tags?.some((t) => t.toLowerCase().includes(q)) || w.profiles?.name?.toLowerCase().includes(q));
  }
  filtered = filtered.slice().sort((a, b) => (sort === "popular" ? (b.like_count || 0) - (a.like_count || 0) : new Date(b.created_at) - new Date(a.created_at)));

  // "Follow this tag" shows up when the search is exactly one real tag.
  const tagQuery = search.trim().toLowerCase().replace(/^#/, "");
  const tagIsReal = !!tagQuery && !tagQuery.includes(" ") && works.some((w) => w.tags?.some((t) => t.toLowerCase() === tagQuery));
  const tagFollowed = followingTags.includes(tagQuery);

  const followingWorks = profile
    ? works.filter((w) => w.user_id !== profile.id && (followingIds.includes(w.user_id) || w.tags?.some((t) => followingTags.includes(t.toLowerCase()))))
    : [];

  const openUpload = () => (profile ? setShowUpload(true) : setPage("signin"));

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
        />
      ) : (
        <div className="sig-app-shell">
          <div className="sig-sidebar-desktop">
            <Sidebar profile={profile} page={page} setPage={setPage} onUploadClick={openUpload} onSignOut={handleSignOut} onMyProfile={() => viewProfile(profile.id)} unreadCount={unreadCount} />
          </div>
          <MobileTopBar profile={profile} setPage={setPage} onUploadClick={openUpload} />

          <div className="sig-main-area sig-scrollbar">
            {page === "explore" && (
              <>
                <TopBar eyebrow="THE GALLERY" title="Explore" search={search} setSearch={setSearch} />
                <CategoryBar cat={cat} setCat={setCat} sort={sort} setSort={setSort} />
                {profile && tagIsReal && (
                  <div className="sig-tag-bar" style={{ padding: "14px 40px 0" }}>
                    <button className={tagFollowed ? "sig-btn-outline" : "sig-btn-primary"} style={{ padding: "7px 16px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => toggleTagFollow(tagQuery)}>
                      <Icon name="tag" size={13} /> {tagFollowed ? `Following #${tagQuery}` : `Follow #${tagQuery}`}
                    </button>
                  </div>
                )}
                <Grid works={filtered} onOpen={handleOpen} emptyTitle={works.length > 0 ? "No matches." : undefined} emptySub={works.length > 0 ? "Try another category or search." : undefined} />
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
          </div>

          <MobileBottomNav profile={profile} page={page} setPage={setPage} onMyProfile={() => viewProfile(profile.id)} unreadCount={unreadCount} />
        </div>
      )}

      {showUpload && profile && (
        <UploadModal userId={profile.id} myWorks={myWorks} onClose={() => setShowUpload(false)} onPublished={() => { setShowUpload(false); loadWorks(); }} />
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
