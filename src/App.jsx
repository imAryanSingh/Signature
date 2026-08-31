import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";

const FONT_SERIF = "'Playfair Display', Georgia, serif";
const FONT_SANS = "'Inter', -apple-system, sans-serif";
const CATEGORIES = ["All", "Illustration", "Photography", "Painting", "Sketch", "Digital", "Mixed"];

const HERO_IMAGES = [
  "https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=800&q=80",
  "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=500&q=80",
  "https://images.unsplash.com/photo-1578321272176-b7bbc0679853?w=500&q=80",
];

const GlobalStyle = () => (
  <style>{`
    * { box-sizing: border-box; }
    html, body { margin: 0; background: #0a0a0a; }
    body { font-family: ${FONT_SANS}; color: #eae7e0; }
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
    .sig-input {
      width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(234,231,224,0.15);
      border-radius: 8px; padding: 11px 14px; color: #eae7e0; font-size: 14px; font-family: ${FONT_SANS};
      outline: none; transition: border-color .15s ease;
    }
    .sig-input:focus { border-color: rgba(234,231,224,0.5); }
    .sig-input::placeholder { color: rgba(234,231,224,0.35); }
    select.sig-input { color-scheme: dark; }
    select.sig-input option { background: #141414; color: #eae7e0; }
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
      font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; padding: 7px 14px;
      border-radius: 999px; cursor: pointer; color: rgba(234,231,224,0.55); font-weight: 500;
      border: 1px solid transparent; transition: all .15s ease; white-space: nowrap;
    }
    .sig-cat-pill.active { background: #eae7e0; color: #0a0a0a; }
    .sig-cat-pill:not(.active):hover { color: #eae7e0; }
    .sig-masonry { column-count: 4; column-gap: 4px; padding: 24px 40px 60px; }
    @media (max-width: 1200px) { .sig-masonry { column-count: 3; } }
    @media (max-width: 800px) { .sig-masonry { column-count: 2; } }
    .sig-card { position: relative; overflow: hidden; border-radius: 4px; cursor: pointer; background: #141414; break-inside: avoid; margin-bottom: 4px; display: inline-block; width: 100%; }
    .sig-card img { width: 100%; display: block; transition: transform .3s ease; }
    .sig-card:hover img { transform: scale(1.03); }
    .sig-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
    .sig-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
    .sig-fade-in { animation: sigFadeIn .35s ease; }
    @keyframes sigFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    textarea.sig-input { resize: vertical; font-family: ${FONT_SANS}; }

    /* Responsive layout */
    .sig-app-shell { display: flex; }
    .sig-sidebar-desktop { display: flex; }
    .sig-mobile-topbar { display: none; }
    .sig-mobile-bottomnav { display: none; }
    .sig-main-area { flex: 1; min-width: 0; height: 100vh; overflow-y: auto; }
    .sig-work-detail { display: flex; height: 100vh; }
    .sig-work-image-pane { flex: 1; }
    .sig-work-side-pane { width: 340px; flex-shrink: 0; }

    @media (max-width: 860px) {
      .sig-sidebar-desktop { display: none !important; width: 0 !important; }
      .sig-mobile-topbar { display: flex !important; }
      .sig-mobile-bottomnav { display: flex !important; }
      .sig-app-shell { flex-direction: column !important; }
      .sig-main-area { height: auto; min-height: 100vh; padding-bottom: 76px; overflow-y: visible; }
      .sig-masonry { column-count: 2 !important; padding: 14px 14px 40px !important; }
      .sig-cat-pill { font-size: 11px; padding: 6px 11px; }
      .sig-work-detail { flex-direction: column; height: auto; min-height: 100vh; }
      .sig-work-image-pane { height: 60vh; flex: none; }
      .sig-work-side-pane { width: 100%; padding-bottom: 90px; }
      .sig-landing-hero { grid-template-columns: 1fr !important; padding: 40px 20px !important; }
      .sig-landing-hero-title { font-size: 34px !important; }
      .sig-landing-craft { grid-template-columns: 1fr !important; }
      .sig-landing-manifesto { grid-template-columns: 1fr !important; gap: 24px !important; }
      .sig-auth-grid { grid-template-columns: 1fr !important; }
      .sig-auth-hero-panel { display: none; }
      .sig-topbar-row { flex-direction: column; align-items: flex-start !important; gap: 14px; padding: 20px 16px 0 !important; }
      .sig-topbar-search { width: 100% !important; }
      .sig-category-bar { padding: 14px 16px 16px !important; overflow-x: auto; flex-wrap: nowrap !important; }
      .sig-profile-header { flex-direction: column !important; align-items: flex-start !important; padding: 0 16px !important; margin-top: -36px !important; }
      .sig-profile-header img, .sig-profile-header > div:first-child { width: 76px !important; height: 76px !important; }
      .sig-settings-grid { grid-template-columns: 1fr !important; }
      .sig-upload-modal-grid { grid-template-columns: 1fr !important; }
      .sig-upload-modal-grid > div:first-child { border-right: none !important; border-bottom: 1px solid rgba(255,255,255,0.08); }
    }
    @media (max-width: 480px) {
      .sig-masonry { column-count: 2 !important; column-gap: 3px !important; }
    }
    @media (min-width: 861px) and (max-width: 1100px) {
      .sig-sidebar-desktop > div { width: 220px !important; }
      .sig-masonry { column-count: 3 !important; }
      .sig-landing-hero { gap: 24px !important; padding: 50px 32px 60px !important; }
      .sig-landing-hero-title { font-size: 42px !important; }
    }
  `}</style>
);

function Icon({ name }) {
  const p = { width: 16, height: 16, stroke: "currentColor", fill: "none", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
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
    trash: <><path d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M7 7l1 13h8l1-13" {...p} /></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" {...p} /><circle cx="12" cy="12" r="2.5" {...p} /></>,
    upload: <><path d="M12 15V4M8 8l4-4 4 4" {...p} /><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" {...p} /></>,
    back: <path d="M15 5l-7 7 7 7" {...p} />,
    share: <><circle cx="18" cy="5" r="2.5" {...p} /><circle cx="6" cy="12" r="2.5" {...p} /><circle cx="18" cy="19" r="2.5" {...p} /><path d="M8.2 10.8l7.6-4.6M8.2 13.2l7.6 4.6" {...p} /></>,
    edit: <><path d="M4 20h4l11-11-4-4L4 16v4z" {...p} /><path d="M13.5 6.5l4 4" {...p} /></>,
    flag: <><path d="M5 4v16" {...p} /><path d="M5 4h11l-2.5 4L16 12H5" {...p} /></>,
  };
  return <svg width="16" height="16" viewBox="0 0 24 24">{map[name] || null}</svg>;
}

function EmptyState({ title, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "90px 20px", color: "rgba(234,231,224,0.55)" }}>
      <div className="sig-serif" style={{ fontSize: 26, color: "#eae7e0", marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 14 }}>{sub}</div>
    </div>
  );
}

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
          <div key={it.id} className={"sig-nav-item" + (page === it.id ? " active" : "")} onClick={() => it.id === "profile" ? onMyProfile() : setPage(it.id)} style={{ justifyContent: "space-between" }}>
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
              <div style={{ fontSize: 13, fontWeight: 500 }}>{profile.name}</div>
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
    <div className="sig-mobile-topbar" style={{ alignItems: "center", justifyContent: "space-between", padding: "16px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)", position: "sticky", top: 0, background: "#0a0a0a", zIndex: 20 }}>
      <div className="sig-serif" style={{ fontSize: 20, cursor: "pointer" }} onClick={() => setPage("landing")}>Signature</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {profile ? (
          <>
            <div style={{ cursor: "pointer", color: "rgba(234,231,224,0.8)" }} onClick={onUploadClick}><Icon name="upload" /></div>
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
  const items = [
    { id: "explore", label: "Explore", icon: "explore" },
    { id: "following", label: "Following", icon: "home" },
  ];
  return (
    <div className="sig-mobile-bottomnav" style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#0a0a0a", borderTop: "1px solid rgba(255,255,255,0.08)", zIndex: 30, padding: "8px 4px", justifyContent: "space-around" }}>
      {items.map((it) => (
        <div key={it.id} onClick={() => setPage(it.id)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "4px 10px", color: page === it.id ? "#eae7e0" : "rgba(234,231,224,0.4)" }}>
          <Icon name={it.icon} />
          <span style={{ fontSize: 10 }}>{it.label}</span>
        </div>
      ))}
      {profile && (
        <>
          <div onClick={onMyProfile} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "4px 10px", color: page === "profile" ? "#eae7e0" : "rgba(234,231,224,0.4)" }}>
            <Icon name="user" />
            <span style={{ fontSize: 10 }}>Profile</span>
          </div>
          <div onClick={() => setPage("notifications")} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "4px 10px", position: "relative", color: page === "notifications" ? "#eae7e0" : "rgba(234,231,224,0.4)" }}>
            <Icon name="bell" />
            <span style={{ fontSize: 10 }}>Alerts</span>
            {unreadCount > 0 && <span style={{ position: "absolute", top: 0, right: 4, background: "#e0748f", width: 7, height: 7, borderRadius: "50%" }} />}
          </div>
          <div onClick={() => setPage("collections")} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "4px 10px", color: page === "collections" ? "#eae7e0" : "rgba(234,231,224,0.4)" }}>
            <Icon name="layers" />
            <span style={{ fontSize: 10 }}>Saved</span>
          </div>
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
          <input className="sig-input" style={{ paddingLeft: 38, borderRadius: 999, background: "rgba(255,255,255,0.05)" }} placeholder="Search work, artists, tags..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}
    </div>
  );
}

function CategoryBar({ cat, setCat, sort, setSort }) {
  return (
    <div className="sig-category-bar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 40px 22px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ display: "flex", gap: 6 }}>
        {CATEGORIES.map((c) => (
          <div key={c} className={"sig-cat-pill" + (cat === c ? " active" : "")} onClick={() => setCat(c)}>{c}</div>
        ))}
      </div>
      {sort !== undefined && (
        <div style={{ display: "flex", gap: 14, fontSize: 12, letterSpacing: "0.05em" }}>
          <span onClick={() => setSort("recent")} style={{ cursor: "pointer", padding: "4px 8px", border: sort === "recent" ? "1px solid rgba(234,231,224,0.5)" : "1px solid transparent", borderRadius: 6, color: sort === "recent" ? "#eae7e0" : "rgba(234,231,224,0.4)" }}>recent</span>
          <span onClick={() => setSort("popular")} style={{ cursor: "pointer", padding: "4px 8px", border: sort === "popular" ? "1px solid rgba(234,231,224,0.5)" : "1px solid transparent", borderRadius: 6, color: sort === "popular" ? "#eae7e0" : "rgba(234,231,224,0.4)" }}>popular</span>
        </div>
      )}
    </div>
  );
}

function Grid({ works, onOpen }) {
  if (works.length === 0) return <EmptyState title="Nothing to see — yet." sub="Be the first to publish, or check back soon." />;
  return (
    <div className="sig-masonry">
      {works.map((w) => (
        <div key={w.id} className="sig-card sig-fade-in" onClick={() => onOpen(w)}>
          <img src={w.image_url} alt={w.title} loading="lazy" />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "24px 12px 10px", background: "linear-gradient(transparent, rgba(0,0,0,0.85))", fontSize: 12 }}>
            <div style={{ fontWeight: 500 }}>{w.title}</div>
            <div style={{ color: "rgba(234,231,224,0.6)", fontSize: 11 }}>{w.profiles?.name || "Unknown"}</div>
          </div>
          {w.critique_requested && (
            <div style={{ position: "absolute", top: 8, left: 8, fontSize: 9, letterSpacing: "0.05em", padding: "3px 7px", borderRadius: 999, background: "rgba(224,116,143,0.9)", color: "#fff", fontWeight: 600 }}>CRITIQUE</div>
          )}
        </div>
      ))}
    </div>
  );
}

function LegalPage({ title, updated, children, setPage }) {
  return (
    <div style={{ overflowY: "auto", height: "100vh" }} className="sig-scrollbar">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px 48px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
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

function PrivacyPage({ setPage }) {
  return (
    <LegalPage title="Privacy Policy" updated="30 August 2026" setPage={setPage}>
      <p><strong style={{ color: "#eae7e0" }}>What we collect.</strong> When you create an account, we store your email address, the name and username you choose, and any profile details you add (bio, links, avatar, cover image). When you publish artwork, we store the image file, title, description, category, tags, and any comments or likes tied to it.</p>
      <p><strong style={{ color: "#eae7e0" }}>How we use it.</strong> Your email is used only to send you sign-in links and, if applicable, notifications about activity on your account. We do not sell, rent, or share your data with advertisers. We do not run ads on Signature.</p>
      <p><strong style={{ color: "#eae7e0" }}>Where it's stored.</strong> Account data, artwork, and images are stored with Supabase, our database and hosting provider, on servers they operate. Data is protected by access rules that ensure only you can edit or delete your own account and uploads.</p>
      <p><strong style={{ color: "#eae7e0" }}>Public content.</strong> Artwork you publish, along with your name, username, and avatar, is visible to anyone who visits Signature, including people without an account. Comments and likes are attributed to your account and are also public.</p>
      <p><strong style={{ color: "#eae7e0" }}>Your choices.</strong> You can edit or delete any artwork you've published at any time. You can update your profile information in Settings. If you'd like your account and all associated data permanently deleted, contact us using the details below and we'll process the request.</p>
      <p><strong style={{ color: "#eae7e0" }}>Cookies and tracking.</strong> Signature uses only the minimum technical storage needed to keep you signed in. We do not use third-party advertising trackers.</p>
      <p><strong style={{ color: "#eae7e0" }}>Changes.</strong> If this policy changes in a meaningful way, we'll update the date above.</p>
      <p><strong style={{ color: "#eae7e0" }}>Contact.</strong> Questions about your data can be sent to the email address associated with the Signature account that sends your sign-in links.</p>
    </LegalPage>
  );
}

function TermsPage({ setPage }) {
  return (
    <LegalPage title="Terms of Service" updated="30 August 2026" setPage={setPage}>
      <p><strong style={{ color: "#eae7e0" }}>Using Signature.</strong> Signature is a free gallery and community for artists, illustrators, photographers, and creators to publish and discuss original work. By creating an account, you agree to these terms.</p>
      <p><strong style={{ color: "#eae7e0" }}>Your content.</strong> You retain full ownership of everything you upload. By publishing artwork, you grant Signature a license to display, resize, and store it so the platform can function — we never claim ownership of your work and never use it for anything beyond displaying it on the site.</p>
      <p><strong style={{ color: "#eae7e0" }}>Only upload what's yours.</strong> Don't publish artwork, photographs, or other content you don't have the rights to. Don't impersonate another artist or misattribute someone else's work as your own.</p>
      <p><strong style={{ color: "#eae7e0" }}>Community conduct.</strong> Critiques and comments should be honest but respectful. Harassment, hate speech, sexually explicit content, and content that endangers or exploits minors are never permitted and will result in immediate removal and account termination.</p>
      <p><strong style={{ color: "#eae7e0" }}>Reporting.</strong> If you see content that violates these terms, use the report option on the artwork or contact us directly.</p>
      <p><strong style={{ color: "#eae7e0" }}>Account termination.</strong> We may suspend or remove accounts that violate these terms. You may delete your own account and content at any time.</p>
      <p><strong style={{ color: "#eae7e0" }}>No warranty.</strong> Signature is provided free and as-is. We aim for reliability but can't guarantee the service will always be available or error-free.</p>
      <p><strong style={{ color: "#eae7e0" }}>Changes to these terms.</strong> We may update these terms as the platform evolves. Continued use after changes means you accept the updated terms.</p>
    </LegalPage>
  );
}


function LandingPage({ setPage, stats }) {
  return (
    <div style={{ overflowY: "auto", height: "100vh" }} className="sig-scrollbar">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px 48px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
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
          <div style={{ display: "flex", gap: 14, marginBottom: 60 }}>
            <button className="sig-btn-primary" onClick={() => setPage("signup")}>Start your portfolio →</button>
            <button className="sig-btn-outline" onClick={() => setPage("explore")}>Wander the gallery</button>
          </div>
          <div style={{ display: "flex", gap: 40 }}>
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
      <div style={{ padding: "60px 48px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
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
      <div style={{ display: "flex", justifyContent: "space-between", padding: "24px 48px", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 12, color: "rgba(234,231,224,0.4)" }}>
        <div className="sig-serif" style={{ fontSize: 16, color: "#eae7e0" }}>Signature</div>
        <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <span style={{ cursor: "pointer" }} onClick={() => setPage("privacy")}>Privacy</span>
          <span style={{ cursor: "pointer" }} onClick={() => setPage("terms")}>Terms</span>
          <span>© 2026 · FREE FOREVER · MADE WITH CARE</span>
        </div>
      </div>
    </div>
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

  return (
    <div className="sig-auth-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", height: "100vh" }}>
      {!isSignup && (
        <div className="sig-auth-hero-panel" style={{ position: "relative", background: heroCopy.bg }}>
          <div style={{ position: "absolute", top: 24, left: 40 }} className="sig-serif">Signature</div>
          <div style={{ position: "absolute", bottom: 40, left: 40, right: 40 }}>
            <div className="sig-serif" style={{ fontSize: 28, marginBottom: 10 }}>{heroCopy.title}</div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.7)" }}>{heroCopy.sub}</div>
          </div>
        </div>
      )}
      <div style={{ padding: 48, display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 460, margin: "0 auto", width: "100%" }}>
        {linkSent ? (
          <>
            <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "rgba(234,231,224,0.45)", marginBottom: 8 }}>ALMOST THERE</div>
            <div className="sig-serif" style={{ fontSize: 30, marginBottom: 14 }}>Check your inbox.</div>
            <div style={{ fontSize: 14, color: "rgba(234,231,224,0.65)", lineHeight: 1.6, marginBottom: 22 }}>
              We sent a sign-in link to <strong style={{ color: "#eae7e0" }}>{email.trim()}</strong>. Open it on this device and you'll be signed in automatically — no code to type.
            </div>
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
            <div style={{ marginBottom: 20 }}><label className="sig-label">Email</label><input className="sig-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendLink()} /></div>
            {error && <div style={{ color: "#e8746a", fontSize: 13, marginBottom: 14 }}>{error}</div>}
            <button className="sig-btn-primary" style={{ marginBottom: 14 }} disabled={busy} onClick={sendLink}>{busy ? "Sending…" : "Send sign-in link"}</button>
            <div style={{ textAlign: "center", fontSize: 13, color: "rgba(234,231,224,0.5)" }}>
              {isSignup ? <>Already have one? <span style={{ color: "#eae7e0", cursor: "pointer", textDecoration: "underline" }} onClick={() => setPage("signin")}>Sign in</span></>
                : <>New here? <span style={{ color: "#eae7e0", cursor: "pointer", textDecoration: "underline" }} onClick={() => setPage("signup")}>Create an account</span></>}
            </div>
            {isSignup && (
              <div style={{ textAlign: "center", fontSize: 12, color: "rgba(234,231,224,0.4)", marginTop: 14 }}>
                By creating an account you agree to our <span style={{ textDecoration: "underline", cursor: "pointer" }} onClick={() => setPage("terms")}>Terms</span> and <span style={{ textDecoration: "underline", cursor: "pointer" }} onClick={() => setPage("privacy")}>Privacy Policy</span>.
              </div>
            )}
          </>
        )}
      </div>
      {isSignup && (
        <div className="sig-auth-hero-panel" style={{ position: "relative", background: heroCopy.bg }}>
          <div style={{ position: "absolute", top: 24, right: 32 }} className="sig-serif">Signature</div>
          <div style={{ position: "absolute", bottom: 40, left: 40, right: 40 }}>
            <div className="sig-serif" style={{ fontSize: 28, marginBottom: 10 }}>{heroCopy.title}</div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.7)" }}>{heroCopy.sub}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function UploadModal({ userId, onClose, onPublished }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [medium, setMedium] = useState("");
  const [tags, setTags] = useState("");
  const [critiqueRequested, setCritiqueRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);

  function handleFile(f) {
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) { setErr("File is over 25MB."); return; }
    setErr("");
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function publish() {
    if (!file) { setErr("Add an image first."); return; }
    if (!title.trim()) { setErr("Give your work a title."); return; }
    if (!description.trim()) { setErr("Add a description — tell the story of this piece."); return; }
    if (!category) { setErr("Choose a category."); return; }
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (tagList.length === 0) { setErr("Add at least one tag."); return; }
    setBusy(true);
    setErr("");
    try {
      const ext = file.name.split(".").pop();
      const path = `${userId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("artwork").upload(path, file);
      if (uploadError) throw uploadError;
      const { data: pub } = supabase.storage.from("artwork").getPublicUrl(path);
      const { error: insertError } = await supabase.from("works").insert({
        user_id: userId,
        title: title.trim(),
        description: description.trim(),
        category: category,
        medium: medium.trim(),
        tags: tagList,
        image_url: pub.publicUrl,
        critique_requested: critiqueRequested,
      });
      if (insertError) throw insertError;
      onPublished();
    } catch (e) {
      console.error("Publish failed:", e);
      setErr(e.message || "Upload failed. Check the browser console for details.");
    }
    setBusy(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 12 }} onClick={onClose}>
      <div className="sig-fade-in sig-scrollbar" style={{ width: 760, maxWidth: "100%", maxHeight: "94vh", overflowY: "auto", background: "#141414", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="sig-serif" style={{ fontSize: 19 }}>Publish new work</div>
          <div style={{ cursor: "pointer", color: "rgba(234,231,224,0.6)" }} onClick={onClose}>✕</div>
        </div>
        <div className="sig-upload-modal-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
          <div style={{ padding: 22, borderRight: "1px solid rgba(255,255,255,0.08)" }}>
            <div onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
              style={{ height: 260, border: "1px dashed rgba(255,255,255,0.2)", borderRadius: 8, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", overflow: "hidden" }}>
              {preview ? <img src={preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (
                <>
                  <Icon name="upload" />
                  <div style={{ marginTop: 10, fontSize: 14 }}>Drop an image or click to browse</div>
                  <div style={{ fontSize: 12, color: "rgba(234,231,224,0.4)", marginTop: 4 }}>JPG · PNG · WEBP · UP TO 25MB</div>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
          </div>
          <div style={{ padding: 22 }}>
            <div style={{ marginBottom: 14 }}><label className="sig-label">Title *</label><input className="sig-input" placeholder="Give it a name" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div style={{ marginBottom: 14 }}><label className="sig-label">Description *</label><textarea className="sig-input" rows={3} placeholder="Tell the story of this piece" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div><label className="sig-label">Category *</label>
                <select className="sig-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Select</option>
                  {CATEGORIES.filter((c) => c !== "All").map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div><label className="sig-label">Medium</label><input className="sig-input" placeholder="Oil on canvas" value={medium} onChange={(e) => setMedium(e.target.value)} /></div>
            </div>
            <div style={{ marginBottom: 14 }}><label className="sig-label">Tags * (comma separated)</label><input className="sig-input" placeholder="portrait, blue, dreamy" value={tags} onChange={(e) => setTags(e.target.value)} /></div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "rgba(234,231,224,0.7)", marginBottom: 16, cursor: "pointer" }}>
              <input type="checkbox" checked={critiqueRequested} onChange={(e) => setCritiqueRequested(e.target.checked)} />
              Open this piece for critique — invite structured, honest feedback
            </label>
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
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (tagList.length === 0) { setErr("Add at least one tag."); return; }
    setBusy(true);
    setErr("");
    const { error } = await supabase.from("works").update({
      title: title.trim(),
      description: description.trim(),
      category,
      medium: medium.trim(),
      tags: tagList,
      critique_requested: critiqueRequested,
    }).eq("id", work.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={onClose}>
      <div className="sig-fade-in" style={{ width: 480, maxWidth: "92vw", maxHeight: "94vh", overflowY: "auto", background: "#141414", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="sig-serif" style={{ fontSize: 19 }}>Edit work</div>
          <div style={{ cursor: "pointer", color: "rgba(234,231,224,0.6)" }} onClick={onClose}>✕</div>
        </div>
        <div style={{ padding: 22 }}>
          <div style={{ marginBottom: 14 }}><label className="sig-label">Title</label><input className="sig-input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div style={{ marginBottom: 14 }}><label className="sig-label">Description</label><textarea className="sig-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div><label className="sig-label">Category</label>
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

function ReportModal({ work, reporterId, onClose, onSubmitted }) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const REASONS = [
    "Not the poster's original work",
    "Sexually explicit or inappropriate content",
    "Harassment or hate speech",
    "Spam or scam",
    "Endangers or exploits a minor",
    "Other",
  ];

  async function submit() {
    if (!reason) { setErr("Choose a reason."); return; }
    setBusy(true);
    setErr("");
    const { error } = await supabase.from("reports").insert({
      reporter_id: reporterId,
      work_id: work.id,
      reason,
      details: details.trim(),
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSubmitted();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={onClose}>
      <div className="sig-fade-in" style={{ width: 440, maxWidth: "92vw", maxHeight: "94vh", overflowY: "auto", background: "#141414", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="sig-serif" style={{ fontSize: 19 }}>Report this work</div>
          <div style={{ cursor: "pointer", color: "rgba(234,231,224,0.6)" }} onClick={onClose}>✕</div>
        </div>
        <div style={{ padding: 22 }}>
          <div style={{ fontSize: 13, color: "rgba(234,231,224,0.6)", marginBottom: 18 }}>
            Reports are reviewed by Signature. This won't notify the artist directly.
          </div>
          <label className="sig-label">Reason</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {REASONS.map((r) => (
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

function WorkDetail({ work, profile, onBack, onDelete, onViewProfile, onEdit }) {
  const [comment, setComment] = useState("");
  const [likes, setLikes] = useState([]);
  const [comments, setComments] = useState([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isCritique, setIsCritique] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportSent, setReportSent] = useState(false);

  function copyShareLink() {
    const url = `${window.location.origin}${window.location.pathname}?work=${work.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1800);
    });
  }

  useEffect(() => {
    (async () => {
      const { data: likeRows } = await supabase.from("likes").select("user_id").eq("work_id", work.id);
      setLikes(likeRows || []);
      const { data: commentRows } = await supabase.from("comments").select("*, profiles!comments_user_id_fkey(name, username)").eq("work_id", work.id).order("created_at", { ascending: false });
      setComments(commentRows || []);
      if (profile && profile.id !== work.user_id) {
        const { data: followRow } = await supabase.from("follows").select("follower_id").eq("follower_id", profile.id).eq("following_id", work.user_id).maybeSingle();
        setIsFollowing(!!followRow);
      }
    })();
  }, [work.id, profile?.id]);

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

  const liked = profile && likes.some((l) => l.user_id === profile.id);

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
    const { data, error } = await supabase.from("comments").insert({ user_id: profile.id, work_id: work.id, text: comment.trim(), is_critique: isCritique }).select("*, profiles!comments_user_id_fkey(name, username)").single();
    if (!error && data) setComments([data, ...comments]);
    setComment("");
    setIsCritique(false);
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div className="sig-work-image-pane" style={{ flex: 1, background: "#050505", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <div style={{ position: "absolute", top: 20, left: 24, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "rgba(234,231,224,0.8)", fontSize: 14 }} onClick={onBack}>
          <Icon name="back" /> Back
        </div>
        <img src={work.image_url} alt={work.title} style={{ maxWidth: "100%", maxHeight: "100vh", objectFit: "contain" }} />
      </div>
      <div className="sig-work-side-pane sig-scrollbar" style={{ width: 340, flexShrink: 0, borderLeft: "1px solid rgba(255,255,255,0.08)", padding: "22px 24px", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "rgba(234,231,224,0.45)" }}>{(work.category || "").toUpperCase()}</div>
            {work.critique_requested && (
              <div style={{ fontSize: 10, letterSpacing: "0.06em", padding: "3px 8px", borderRadius: 999, background: "rgba(224,116,143,0.15)", color: "#e0748f", fontWeight: 600 }}>CRITIQUE REQUESTED</div>
            )}
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "rgba(234,231,224,0.5)" }}><Icon name="eye" /> {work.views || 0}</div>
            <div style={{ cursor: "pointer", color: "rgba(234,231,224,0.5)", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }} onClick={copyShareLink}><Icon name="share" /> {shareCopied ? "Copied" : "Share"}</div>
            {profile && profile.id !== work.user_id && (
              <div style={{ cursor: "pointer", color: "rgba(234,231,224,0.5)", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }} onClick={() => setShowReport(true)}><Icon name="flag" /> Report</div>
            )}
          </div>
        </div>
        <div className="sig-serif" style={{ fontSize: 26, margin: "8px 0 16px" }}>{work.title}</div>
        {profile?.id === work.user_id && (
          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            <button className="sig-btn-outline" style={{ flex: 1, padding: "8px 14px", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={() => onEdit(work)}>
              <Icon name="edit" /> Edit
            </button>
            <button
              className="sig-btn-outline"
              style={{ flex: 1, padding: "8px 14px", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, borderColor: "rgba(224,116,143,0.4)", color: "#e0748f" }}
              onClick={() => {
                if (window.confirm("Delete this artwork? This can't be undone.")) onDelete(work);
              }}
            >
              <Icon name="trash" /> Delete
            </button>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#2a2a2a", overflow: "hidden", cursor: "pointer" }} onClick={() => onViewProfile(work.user_id)}>{work.profiles?.avatar_url && <img src={work.profiles.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</div>
          <div style={{ flex: 1, cursor: "pointer" }} onClick={() => onViewProfile(work.user_id)}><div style={{ fontSize: 14, fontWeight: 500 }}>{work.profiles?.name || "Unknown"}</div><div style={{ fontSize: 12, color: "rgba(234,231,224,0.45)" }}>@{work.profiles?.username}</div></div>
          {profile && profile.id !== work.user_id && (
            <button className={isFollowing ? "sig-btn-outline" : "sig-btn-primary"} style={{ padding: "6px 16px", fontSize: 12 }} onClick={toggleFollow}>
              {isFollowing ? "Following" : "Follow"}
            </button>
          )}
        </div>
        {work.description && <div style={{ fontSize: 14, color: "rgba(234,231,224,0.7)", lineHeight: 1.6, marginBottom: 16 }}>{work.description}</div>}
        {work.tags?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
            {work.tags.map((t) => <div key={t} style={{ fontSize: 11, padding: "5px 10px", borderRadius: 999, background: "rgba(255,255,255,0.06)" }}>{t.toUpperCase()}</div>)}
          </div>
        )}
        <div style={{ display: "flex", gap: 18, alignItems: "center", paddingBottom: 16, borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: profile ? "pointer" : "default", color: liked ? "#e0748f" : "rgba(234,231,224,0.7)" }} onClick={toggleLike}>
            <Icon name="heart" /> {likes.length}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "rgba(234,231,224,0.7)" }}><Icon name="comment" /> {comments.length}</div>
        </div>
        {profile && (
          <div style={{ marginBottom: 16 }}>
            <textarea className="sig-input" rows={2} placeholder={work.critique_requested ? "Share honest, constructive feedback…" : "Leave a thoughtful comment…"} value={comment} onChange={(e) => setComment(e.target.value)} />
            {work.critique_requested && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgba(234,231,224,0.55)", marginTop: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={isCritique} onChange={(e) => setIsCritique(e.target.checked)} /> Mark as structured critique
              </label>
            )}
            <button className="sig-btn-primary" style={{ marginTop: 8, padding: "8px 18px", fontSize: 13 }} onClick={postComment}>Post</button>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {comments.map((c) => (
            <div key={c.id} style={{ fontSize: 13, padding: c.is_critique ? "10px 12px" : 0, background: c.is_critique ? "rgba(224,116,143,0.08)" : "transparent", borderRadius: c.is_critique ? 8 : 0, borderLeft: c.is_critique ? "2px solid #e0748f" : "none" }}>
              {c.is_critique && <div style={{ fontSize: 10, color: "#e0748f", fontWeight: 600, marginBottom: 3, letterSpacing: "0.04em" }}>CRITIQUE</div>}
              <span style={{ fontWeight: 500 }}>{c.profiles?.name || "Someone"}</span>
              <span style={{ color: "rgba(234,231,224,0.65)" }}> {c.text}</span>
            </div>
          ))}
        </div>
      </div>
      {showReport && (
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

function ProfilePage({ userId, currentProfile, onOpen, onFollowChanged }) {
  const [viewedProfile, setViewedProfile] = useState(null);
  const [works, setWorks] = useState([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const isOwn = currentProfile && userId === currentProfile.id;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: p } = await supabase.from("profiles").select("*").eq("id", userId).single();
      const { data: w } = await supabase.from("works").select("*, profiles!works_user_id_fkey(name, username, avatar_url), likes(count)").eq("user_id", userId).order("created_at", { ascending: false });
      const { count: followers } = await supabase.from("follows").select("*", { count: "exact", head: true }).eq("following_id", userId);
      let following = false;
      if (currentProfile && !isOwn) {
        const { data: f } = await supabase.from("follows").select("follower_id").eq("follower_id", currentProfile.id).eq("following_id", userId).maybeSingle();
        following = !!f;
      }
      if (!cancelled) {
        setViewedProfile(p);
        setWorks((w || []).map((x) => ({ ...x, like_count: x.likes?.[0]?.count || 0 })));
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
          <div className="sig-serif" style={{ fontSize: 24 }}>{viewedProfile.name}</div>
          <div style={{ fontSize: 13, color: "rgba(234,231,224,0.5)" }}>@{viewedProfile.username} · {works.length} works · {followerCount} followers</div>
        </div>
        {!isOwn && currentProfile && (
          <button className={isFollowing ? "sig-btn-outline" : "sig-btn-primary"} style={{ marginBottom: 6 }} onClick={toggleFollow}>
            {isFollowing ? "Following" : "Follow"}
          </button>
        )}
      </div>
      {viewedProfile.bio && <div style={{ padding: "18px 40px 0", fontSize: 14, color: "rgba(234,231,224,0.7)", maxWidth: 560 }}>{viewedProfile.bio}</div>}
      <div style={{ display: "flex", gap: 28, padding: "18px 40px 0" }}>
        <div><span className="sig-serif" style={{ fontSize: 18 }}>{totalViews}</span> <span style={{ fontSize: 12, color: "rgba(234,231,224,0.45)" }}>total views</span></div>
        <div><span className="sig-serif" style={{ fontSize: 18 }}>{totalLikes}</span> <span style={{ fontSize: 12, color: "rgba(234,231,224,0.45)" }}>total likes</span></div>
      </div>
      <div style={{ padding: "26px 40px 8px", fontSize: 11, letterSpacing: "0.1em", color: "rgba(234,231,224,0.45)", borderBottom: "1px solid rgba(255,255,255,0.08)", marginTop: 12 }}>
        {isOwn ? "YOUR WORKS" : "WORKS"}
      </div>
      {works.length === 0 ? (
        <EmptyState title={isOwn ? "Your studio is empty." : "No works yet."} sub={isOwn ? "Publish your first piece to start your gallery." : "Check back later."} />
      ) : <Grid works={works} onOpen={onOpen} />}
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

  function verb(type) {
    if (type === "like") return "liked your work";
    if (type === "comment") return "commented on your work";
    if (type === "follow") return "started following you";
    return "interacted with your work";
  }

  if (loading) return <div style={{ padding: 40, color: "rgba(234,231,224,0.5)" }}>Loading…</div>;

  return (
    <div>
      <TopBar eyebrow="SIGNALS" title="Notifications" />
      {items.length === 0 ? (
        <EmptyState title="A quiet studio." sub="Come back later." />
      ) : (
        <div style={{ padding: "20px 40px 60px", display: "flex", flexDirection: "column", gap: 2 }}>
          {items.map((n) => (
            <div
              key={n.id}
              onClick={() => n.work_id && onOpenWork?.(n.works, n.work_id)}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 8, cursor: n.work_id ? "pointer" : "default", background: n.read ? "transparent" : "rgba(255,255,255,0.03)" }}
            >
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#2a2a2a", flexShrink: 0, overflow: "hidden" }}>
                {n.actor?.avatar_url && <img src={n.actor.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
              </div>
              <div style={{ flex: 1, fontSize: 14 }}>
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

function CollectionsPage({ profile }) {
  const [collections, setCollections] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => { load(); }, [profile.id]);
  async function load() {
    const { data } = await supabase.from("collections").select("*").eq("user_id", profile.id).order("created_at", { ascending: false });
    setCollections(data || []);
  }
  async function create() {
    if (!name.trim()) return;
    await supabase.from("collections").insert({ user_id: profile.id, name: name.trim() });
    setName(""); setShowNew(false); load();
  }

  return (
    <div style={{ padding: "28px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 26 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "rgba(234,231,224,0.45)", marginBottom: 6 }}>YOUR STUDIO</div>
          <div className="sig-serif" style={{ fontSize: 34 }}>Collections</div>
        </div>
        <button className="sig-btn-primary" onClick={() => setShowNew(true)}>+ New collection</button>
      </div>
      {showNew && (
        <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
          <input className="sig-input" style={{ maxWidth: 320 }} placeholder="Collection name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="sig-btn-primary" onClick={create}>Create</button>
          <button className="sig-btn-outline" onClick={() => setShowNew(false)}>Cancel</button>
        </div>
      )}
      {collections.length === 0 ? <EmptyState title="No collections yet." sub="Group your works into a series or study." /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
          {collections.map((c) => (
            <div key={c.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 18 }}>
              <div style={{ fontWeight: 500 }}>{c.name}</div>
              <div style={{ fontSize: 12, color: "rgba(234,231,224,0.45)", marginTop: 4 }}>{(c.work_ids || []).length} works</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsPage({ profile, onSave }) {
  const [form, setForm] = useState(profile);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const avatarRef = useRef(null);
  const coverRef = useRef(null);

  useEffect(() => setForm(profile), [profile]);

  async function uploadTo(field, file) {
    if (!file) return;
    setBusy(true);
    const ext = file.name.split(".").pop();
    const path = `${profile.id}/${field}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("artwork").upload(path, file, { upsert: true });
    if (!error) {
      const { data: pub } = supabase.storage.from("artwork").getPublicUrl(path);
      setForm((f) => ({ ...f, [field]: pub.publicUrl }));
    }
    setBusy(false);
  }

  async function save() {
    setBusy(true);
    await onSave({ name: form.name, bio: form.bio, website: form.website, instagram: form.instagram, twitter: form.twitter, avatar_url: form.avatar_url, cover_url: form.cover_url });
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div style={{ padding: "28px 40px", maxWidth: 640 }}>
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
      <button className="sig-btn-primary" disabled={busy} onClick={save}>{saved ? "Saved" : busy ? "Saving…" : "Save changes"}</button>
    </div>
  );
}

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
  const [viewedUserId, setViewedUserId] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [editingWork, setEditingWork] = useState(null);

  const loadWorks = useCallback(async () => {
    const { data, error } = await supabase.from("works").select("*, profiles!works_user_id_fkey(name, username, avatar_url), likes(count)").order("created_at", { ascending: false });
    if (error) {
      console.error("loadWorks failed:", error.message, "| code:", error.code, "| details:", error.details, "| hint:", error.hint);
    }
    const withCounts = (data || []).map((w) => ({ ...w, like_count: w.likes?.[0]?.count || 0 }));
    setWorks(withCounts);
  }, []);

  async function loadFollowing(userId) {
    const { data } = await supabase.from("follows").select("following_id").eq("follower_id", userId);
    setFollowingIds((data || []).map((r) => r.following_id));
  }

  async function loadUnreadCount(userId) {
    const { count } = await supabase.from("notifications").select("*", { count: "exact", head: true }).eq("recipient_id", userId).eq("read", false);
    setUnreadCount(count || 0);
  }

  useEffect(() => {
    (async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      setSession(s);
      if (s) {
        const { data: p } = await supabase.from("profiles").select("*").eq("id", s.user.id).single();
        setProfile(p);
        await loadFollowing(s.user.id);
        await loadUnreadCount(s.user.id);
        setPage("explore");
      }
      await loadWorks();
      const { count } = await supabase.from("profiles").select("*", { count: "exact", head: true });
      setCreatorCount(count || 0);
      setReady(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, s) => {
      setSession(s);
      if (s) {
        const { data: p } = await supabase.from("profiles").select("*").eq("id", s.user.id).single();
        setProfile(p);
        await loadFollowing(s.user.id);
        await loadUnreadCount(s.user.id);
      } else {
        setProfile(null);
        setFollowingIds([]);
        setUnreadCount(0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadWorks]);

  useEffect(() => {
    if (session && !profile) return;
    if (session && profile && page === "landing") setPage("explore");
  }, [session, profile]);

  function viewProfile(userId) {
    setViewedUserId(userId);
    setActiveWork(null);
    setPage("profile");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setPage("landing");
  }

  async function handleOpen(work) {
    await supabase.from("works").update({ views: (work.views || 0) + 1 }).eq("id", work.id);
    setActiveWork({ ...work, views: (work.views || 0) + 1 });
  }

  async function handleDelete(work) {
    const path = work.image_url.split("/artwork/")[1];
    if (path) await supabase.storage.from("artwork").remove([path]);
    await supabase.from("works").delete().eq("id", work.id);
    setActiveWork(null);
    loadWorks();
  }

  async function handleSaveProfile(form) {
    await supabase.from("profiles").update(form).eq("id", profile.id);
    setProfile({ ...profile, ...form });
  }

  if (!ready) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}><GlobalStyle />Loading…</div>;

  if (page === "landing") return <><GlobalStyle /><LandingPage setPage={setPage} stats={{ works: works.length, creators: creatorCount }} /></>;
  if (page === "privacy") return <><GlobalStyle /><PrivacyPage setPage={setPage} /></>;
  if (page === "terms") return <><GlobalStyle /><TermsPage setPage={setPage} /></>;
  if (page === "signin" || page === "signup") return <><GlobalStyle /><AuthPage mode={page} setPage={setPage} onError={setAuthError} error={authError} /></>;

  let filtered = works.filter((w) => cat === "All" || w.category === cat);
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter((w) => w.title?.toLowerCase().includes(q) || w.tags?.some((t) => t.toLowerCase().includes(q)) || w.profiles?.name?.toLowerCase().includes(q));
  }
  filtered = filtered.slice().sort((a, b) => sort === "popular" ? (b.like_count || 0) - (a.like_count || 0) : new Date(b.created_at) - new Date(a.created_at));

  return (
    <>
      <GlobalStyle />
      {activeWork ? (
        <div className="sig-work-detail">
          <WorkDetail
            work={activeWork}
            profile={profile}
            onBack={() => { setActiveWork(null); loadWorks(); if (profile) loadFollowing(profile.id); }}
            onDelete={handleDelete}
            onViewProfile={(userId) => { setActiveWork(null); viewProfile(userId); }}
            onEdit={(w) => setEditingWork(w)}
          />
        </div>
      ) : (
        <div className="sig-app-shell">
          <div className="sig-sidebar-desktop">
            <Sidebar profile={profile} page={page} setPage={setPage} onUploadClick={() => profile ? setShowUpload(true) : setPage("signin")} onSignOut={handleSignOut} onMyProfile={() => viewProfile(profile.id)} unreadCount={unreadCount} />
          </div>
          <MobileTopBar profile={profile} setPage={setPage} onUploadClick={() => profile ? setShowUpload(true) : setPage("signin")} />
          <div className="sig-main-area sig-scrollbar">
            {page === "explore" && (
              <>
                <TopBar eyebrow="THE GALLERY" title="Explore" search={search} setSearch={setSearch} />
                <CategoryBar cat={cat} setCat={setCat} sort={sort} setSort={setSort} />
                <Grid works={filtered} onOpen={handleOpen} />
              </>
            )}
            {page === "following" && (
              <>
                <TopBar eyebrow="YOUR CIRCLE" title="Following" />
                {followingIds.length === 0 ? (
                  <EmptyState title="You're not following anyone yet." sub="Open a piece you like and follow the artist." />
                ) : (
                  <Grid works={filtered.filter((w) => followingIds.includes(w.user_id))} onOpen={handleOpen} />
                )}
              </>
            )}
            {page === "profile" && viewedUserId && (
              <ProfilePage userId={viewedUserId} currentProfile={profile} onOpen={handleOpen} onFollowChanged={() => profile && loadFollowing(profile.id)} />
            )}
            {page === "notifications" && profile && (
              <NotificationsPage profile={profile} onOpenWork={async (workStub, workId) => {
                const { data } = await supabase.from("works").select("*, profiles!works_user_id_fkey(name, username, avatar_url), likes(count)").eq("id", workId).single();
                if (data) handleOpen({ ...data, like_count: data.likes?.[0]?.count || 0 });
              }} onMarkAllRead={() => setUnreadCount(0)} />
            )}
            {page === "collections" && profile && <CollectionsPage profile={profile} />}
            {page === "settings" && profile && <SettingsPage profile={profile} onSave={handleSaveProfile} />}
          </div>
          <MobileBottomNav profile={profile} page={page} setPage={setPage} onMyProfile={() => viewProfile(profile.id)} unreadCount={unreadCount} />
        </div>
      )}
      {showUpload && <UploadModal userId={profile.id} onClose={() => setShowUpload(false)} onPublished={() => { setShowUpload(false); loadWorks(); }} />}
      {editingWork && <EditModal work={editingWork} onClose={() => setEditingWork(null)} onSaved={() => { setEditingWork(null); loadWorks(); }} />}
    </>
  );
}
