import test from "node:test";
import assert from "node:assert/strict";
import { createDailyHandler, makeDailyDb } from "../api/daily-activity.js";
import { buildDailySummaryEmail, joinNames } from "../api/_lib/emails.js";

const ENV = { CRON_SECRET: "cron", NOTIFY_SECRET: "n", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", SMTP_USER: "me@gmail.com", SMTP_PASS: "p", SITE_URL: "https://site.example/" };
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ADA, BEN, VEE, RAJ, ANA, W1, W2, C1, C2] = [ID(1), ID(2), ID(3), ID(4), ID(5), ID(11), ID(12), ID(21), ID(22)];
const NOW = Date.parse("2026-11-12T03:30:00Z");

let seq = 0;
const note = (recipient, actor, type, extra = {}) => ({ id: ID(100 + ++seq), recipient_id: recipient, actor_id: actor, type, work_id: null, comment_id: null, created_at: new Date(NOW - 3600e3).toISOString(), ...extra });

function fakeDb(rows, over = {}) {
  const state = {
    unsent: rows,
    profiles: { [ADA]: { id: ADA, name: "Ada" }, [BEN]: { id: BEN, name: "Ben" }, [VEE]: { id: VEE, name: "Vee" }, [RAJ]: { id: RAJ, name: "Raj" }, [ANA]: { id: ANA, name: "Ana" } },
    works: { [W1]: { id: W1, title: "Sunrise" }, [W2]: { id: W2, title: "Harbour" } },
    comments: { [C1]: { id: C1, text: "Love the colours", is_critique: false }, [C2]: { id: C2, text: "Fix the hands", is_critique: true } },
    emails: { [ADA]: "ada@example.com", [BEN]: "ben@example.com" },
    marked: [], since: null,
    ...over,
  };
  return {
    state,
    getUnsent: async (since) => { state.since = since; return state.unsent; },
    getProfiles: async (ids) => ids.map((i) => state.profiles[i]).filter(Boolean),
    getWorks: async (ids) => ids.map((i) => state.works[i]).filter(Boolean),
    getComments: async (ids) => ids.map((i) => state.comments[i]).filter(Boolean),
    getEmail: async (id) => state.emails[id] || null,
    markEmailed: async (ids) => { state.marked.push(...ids); },
  };
}

function setup({ db, env = {}, failFor } = {}) {
  const sent = [];
  const handler = createDailyHandler({
    db, env: { ...ENV, ...env }, now: () => NOW, pause: async () => {},
    send: async (mail) => { if (failFor && mail.to === failFor) throw new Error("smtp down"); sent.push(mail); },
  });
  const call = async ({ method = "GET", headers = { authorization: "Bearer cron" }, query = {}, body } = {}) => {
    let payload, code;
    const res = { status(c) { code = c; return this; }, json(j) { payload = j; return this; } };
    await handler({ method, headers, query, body }, res);
    return { code, body: payload };
  };
  return { call, sent };
}

/* ---------------- who may run it ---------------- */
test("only Vercel Cron (CRON_SECRET) or you (NOTIFY_SECRET) can run it", async () => {
  const { call, sent } = setup({ db: fakeDb([note(ADA, BEN, "like", { work_id: W1 })]) });
  assert.equal((await call({ headers: {} })).code, 401);
  assert.equal((await call({ headers: { authorization: "Bearer wrong" } })).code, 401);
  assert.equal((await call({ headers: { "x-notify-secret": "wrong" } })).code, 401);
  assert.equal((await call({ method: "DELETE" })).code, 405);
  assert.equal(sent.length, 0);
  assert.equal((await call({ headers: { authorization: "Bearer cron" } })).code, 200);
  assert.equal((await call({ method: "POST", headers: { "x-notify-secret": "n" } })).code, 200);
});

test("says plainly when it is not configured", async () => {
  const none = setup({ db: fakeDb([]), env: { CRON_SECRET: "", NOTIFY_SECRET: "" } });
  const r = await none.call();
  assert.equal(r.code, 500);
  assert.match(r.body.error, /CRON_SECRET/);
  const smtp = setup({ db: fakeDb([]), env: { SMTP_PASS: "" } });
  const s = await smtp.call();
  assert.equal(s.code, 500);
  assert.match(s.body.error, /SMTP_PASS/);
});

/* ---------------- one email per person, per day ---------------- */
test("many likes and comments on one day → exactly ONE email for that person", async () => {
  const rows = [
    note(ADA, BEN, "like", { work_id: W1 }), note(ADA, VEE, "like", { work_id: W1 }), note(ADA, RAJ, "like", { work_id: W1 }), note(ADA, ANA, "like", { work_id: W2 }),
    note(ADA, BEN, "comment", { work_id: W1, comment_id: C1 }), note(ADA, VEE, "comment", { work_id: W2, comment_id: C2 }),
    note(ADA, RAJ, "follow"), note(ADA, ANA, "share", { work_id: W1 }),
  ];
  const db = fakeDb(rows);
  const { call, sent } = setup({ db });
  const r = await call();
  assert.deepEqual([r.body.people, r.body.sent, r.body.failed], [1, 1, 0]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "ada@example.com");
  assert.match(sent[0].subject, /Your day on Signature: 2 comments, 4 likes, 1 new follower, 1 share/);
  assert.match(sent[0].text, /Ben commented on “Sunrise”: Love the colours/);
  assert.match(sent[0].text, /Vee left a critique on “Harbour”: Fix the hands/);
  assert.match(sent[0].text, /“Sunrise” — liked by Ben, Vee and Raj/);
  assert.match(sent[0].text, /Raj started following you/);
  assert.match(sent[0].text, /“Sunrise” — shared by Ana/);
  assert.equal(db.state.marked.length, rows.length); // every included notification is marked, so tomorrow's email is fresh
});

test("different people each get their own single email", async () => {
  const db = fakeDb([note(ADA, VEE, "like", { work_id: W1 }), note(BEN, VEE, "follow"), note(ADA, RAJ, "follow")]);
  const { call, sent } = setup({ db });
  assert.equal((await call()).body.sent, 2);
  assert.deepEqual(sent.map((m) => m.to).sort(), ["ada@example.com", "ben@example.com"]);
});

test("views are never emailed: nothing happened → no email", async () => {
  const db = fakeDb([]);
  const { call, sent } = setup({ db });
  const r = await call();
  assert.equal(r.body.sent, 0);
  assert.equal(sent.length, 0);
  // and a hypothetical 'view' row is ignored even if one ever appeared
  const odd = fakeDb([{ ...note(ADA, BEN, "view", { work_id: W1 }) }]);
  const o = setup({ db: odd });
  await o.call();
  assert.equal(o.sent.length, 0);
});

test("the same person liking the same piece twice counts once", async () => {
  const db = fakeDb([note(ADA, BEN, "like", { work_id: W1 }), note(ADA, BEN, "like", { work_id: W1 })]);
  const { call, sent } = setup({ db });
  await call();
  assert.match(sent[0].subject, /1 like$/);
  assert.match(sent[0].text, /liked by Ben$/m);
});

test("respects each person's choices, and sends nothing if everything is switched off", async () => {
  const rows = [note(ADA, BEN, "like", { work_id: W1 }), note(ADA, BEN, "comment", { work_id: W1, comment_id: C1 }), note(ADA, RAJ, "follow")];
  const db = fakeDb(rows, { profiles: { ...fakeDb([]).state.profiles, [ADA]: { id: ADA, name: "Ada", email_likes: false, email_follows: false } } });
  const { call, sent } = setup({ db });
  await call();
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /1 comment$/);
  assert.doesNotMatch(sent[0].text, /liked by|started following/);
  assert.equal(db.state.marked.length, 1, "only what was emailed is marked");

  const off = fakeDb(rows, { profiles: { ...fakeDb([]).state.profiles, [ADA]: { id: ADA, name: "Ada", email_likes: false, email_follows: false, email_comments: false } } });
  const o = setup({ db: off });
  await o.call();
  assert.equal(o.sent.length, 0);
  assert.equal(off.state.marked.length, 0);
});

test("skips people with no email address and notifications whose recipient is gone", async () => {
  const db = fakeDb([note(RAJ, BEN, "like", { work_id: W1 }), note(ID(99), BEN, "follow")]);
  const { call, sent } = setup({ db });
  await call();
  assert.equal(sent.length, 0);
});

/* ---------------- safety ---------------- */
test("a failed send is not marked (retried tomorrow) and doesn't stop the others", async () => {
  const db = fakeDb([note(ADA, VEE, "follow"), note(BEN, VEE, "follow")]);
  const { call, sent } = setup({ db, failFor: "ada@example.com" });
  const r = await call();
  assert.deepEqual([r.body.sent, r.body.failed], [1, 1]);
  assert.equal(sent[0].to, "ben@example.com");
  assert.equal(db.state.marked.length, 1);
});

test("a dry run lists who would get an email and sends and marks nothing", async () => {
  const db = fakeDb([note(ADA, VEE, "follow"), note(BEN, VEE, "follow")]);
  const { call, sent } = setup({ db });
  const r = await call({ query: { dry: "1" } });
  assert.deepEqual(r.body, { dry: true, wouldEmail: 2 });
  assert.equal(sent.length, 0);
  assert.equal(db.state.marked.length, 0);
  const viaBody = await setup({ db }).call({ method: "POST", headers: { "x-notify-secret": "n" }, body: { dry: true } });
  assert.equal(viaBody.body.dry, true);
});

test("a daily cap protects your email quota; the rest wait until tomorrow", async () => {
  const db = fakeDb([note(ADA, VEE, "follow"), note(BEN, VEE, "follow")]);
  const { call, sent } = setup({ db, env: { DAILY_MAX_EMAILS: "1" } });
  assert.equal((await call()).body.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(db.state.marked.length, 1);
});

test("only looks back 36 hours, so old backlog is never sent", async () => {
  const db = fakeDb([note(ADA, VEE, "follow")]);
  await setup({ db }).call();
  assert.equal(db.state.since, new Date(NOW - 36 * 3600e3).toISOString());
  const custom = fakeDb([]);
  await setup({ db: custom, env: { DAILY_WINDOW_HOURS: "12" } }).call();
  assert.equal(custom.state.since, new Date(NOW - 12 * 3600e3).toISOString());
});

/* ---------------- the email itself ---------------- */
test("joinNames reads naturally", () => {
  assert.equal(joinNames([]), "Someone");
  assert.equal(joinNames(["A"]), "A");
  assert.equal(joinNames(["A", "B"]), "A and B");
  assert.equal(joinNames(["A", "B", "C"]), "A, B and C");
  assert.equal(joinNames(["A", "B", "C", "D"]), "A, B, C and 1 other");
  assert.equal(joinNames(["A", "B", "C", "D", "E", "F"]), "A, B, C and 3 others");
});

test("summary email: long lists are trimmed, text is escaped, subject is clean", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ title: `Piece ${i}`, workId: W1, name: `P${i}`, text: "<script>x</script>", isCritique: false }));
  const mail = buildDailySummaryEmail({ recipientName: "A<b>", summary: { comments: many, likes: [], followers: [], shares: [] }, siteUrl: "https://s.example" });
  assert.match(mail.html, /and 4 more comments/);
  assert.doesNotMatch(mail.html, /<script>/);
  assert.doesNotMatch(mail.html, /A<b>/);
  assert.match(mail.subject, /12 comments/);
  assert.doesNotMatch(mail.subject, /[\r\n]/);
  assert.match(mail.html, /Choose what it includes in Settings/);
  assert.doesNotMatch(mail.html + mail.text, /\bviews?\b/i);
});

/* ---------------- database queries ---------------- */
function strictSupabase(handlers) {
  const real = new Set(["select", "is", "in", "gte", "order", "limit", "update", "eq", "maybeSingle"]);
  const log = [];
  const from = (table) => {
    const entry = { table, steps: [] }; log.push(entry);
    const proxy = new Proxy({}, { get(_, prop) {
      if (prop === "then") return (resolve) => resolve((handlers[table] || (() => ({ data: [], error: null })))(entry));
      if (!real.has(prop)) throw new Error(`supabase-js has no method "${String(prop)}"`);
      return (...args) => { entry.steps.push([prop, ...args]); return proxy; };
    } });
    return proxy;
  };
  return { from, log, auth: { admin: { getUserById: async (id) => ({ data: { user: { email: `${id}@u.com` } }, error: null }) } } };
}

test("makeDailyDb: unsent query is well-formed and falls back if migration 6 isn't run", async () => {
  let calls = 0;
  const sb = strictSupabase({ notifications: (entry) => { calls++; const sel = entry.steps.find((s) => s[0] === "select")[1]; return /comment_id/.test(sel) && calls === 1 ? { data: null, error: { message: "column notifications.comment_id does not exist" } } : { data: [{ id: "n1" }], error: null }; } });
  const db = makeDailyDb(sb);
  assert.deepEqual(await db.getUnsent("2026-01-01"), [{ id: "n1" }]);
  assert.equal(calls, 2);
  const q = sb.log[1].steps.map((s) => s[0]);
  for (const m of ["is", "in", "gte", "order", "limit"]) assert.ok(q.includes(m), m);
  assert.deepEqual(sb.log[1].steps.find((s) => s[0] === "is"), ["is", "emailed_at", null]);
});

test("makeDailyDb: big id lists are fetched in chunks, and marking is chunked too", async () => {
  const sb = strictSupabase({ profiles: () => ({ data: [{ id: "p" }], error: null }) });
  const db = makeDailyDb(sb);
  const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
  const out = await db.getProfiles([...ids, ...ids, null]);
  assert.equal(out.length, 3); // 250 unique ids → 3 requests
  await db.markEmailed(ids);
  const updates = sb.log.filter((l) => l.table === "notifications" && l.steps.some((s) => s[0] === "update"));
  assert.equal(updates.length, 3);
  assert.ok(updates[0].steps.find((s) => s[0] === "update")[1].emailed_at);
});

test("makeDailyDb: a database error becomes a thrown error", async () => {
  const db = makeDailyDb(strictSupabase({ notifications: () => ({ data: null, error: { message: "boom" } }) }));
  await assert.rejects(() => db.getUnsent("x"), /boom/);
});
