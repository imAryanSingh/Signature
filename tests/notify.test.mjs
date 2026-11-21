import test from "node:test";
import assert from "node:assert/strict";
import { createHandler, makeDb } from "../api/notify.js";
import { buildReportEmail, cleanSubject } from "../api/_lib/emails.js";

const ENV = { NOTIFY_SECRET: "s3cret", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", SMTP_USER: "me@gmail.com", SMTP_PASS: "pass", SITE_URL: "https://site.example/" };
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ARTIST, FAN, ADMIN, REPORT, WORK] = [ID(1), ID(2), ID(3), ID(5), ID(6)];

function fakeDb(overrides = {}) {
  const state = {
    profiles: { [ARTIST]: { id: ARTIST, name: "Ada", username: "ada" }, [FAN]: { id: FAN, name: "Fan <b>", username: "fan" }, [ADMIN]: { id: ADMIN, name: "Boss", username: "boss", is_admin: true } },
    work: { id: WORK, title: "Sunrise", image_url: "https://img/x.jpg", user_id: ARTIST },
    report: { id: REPORT, reporter_id: FAN, work_id: WORK, reason: "Spam or scam", details: "looks fake" },
    emails: { [ARTIST]: "ada@example.com", [ADMIN]: "boss@example.com" },
    ...overrides,
  };
  return {
    state,
    getProfile: async (id) => state.profiles[id] || null,
    getWork: async () => state.work,
    getReport: async () => state.report,
    getAdminProfiles: async () => Object.values(state.profiles).filter((p) => p.is_admin),
    getEmail: async (id) => state.emails[id] || null,
  };
}

function setup({ env = {}, db = fakeDb() } = {}) {
  const sent = [];
  const handler = createHandler({ db, send: async (mail) => sent.push(mail), env: { ...ENV, ...env } });
  const call = async ({ method = "POST", headers = { "x-notify-secret": "s3cret" }, body }) => {
    let payload, code;
    const res = { status(c) { code = c; return this; }, json(j) { payload = j; return this; } };
    await handler({ method, headers, body }, res);
    return { code, body: payload };
  };
  return { sent, call };
}

test("rejects non-POST, wrong secret, bad ids and unknown kinds", async () => {
  const { call, sent } = setup();
  assert.equal((await call({ method: "GET" })).code, 405);
  assert.equal((await call({ headers: { "x-notify-secret": "nope" }, body: { kind: "report", id: REPORT } })).code, 401);
  assert.equal((await call({ headers: {}, body: { kind: "report", id: REPORT } })).code, 401);
  assert.equal((await call({ body: { kind: "report", id: "not-a-uuid" } })).code, 400);
  assert.equal((await call({ body: { kind: "dance", id: REPORT } })).code, 400);
  assert.equal(sent.length, 0);
});

test("per-like / per-comment emails are gone from this function", async () => {
  const { call, sent } = setup();
  assert.equal((await call({ body: { kind: "notification", id: ID(4) } })).code, 400);
  assert.equal(sent.length, 0);
});

test("reports that the server is not configured, naming what is missing", async () => {
  const r = await setup({ env: { SMTP_PASS: "" } }).call({ body: { kind: "report", id: REPORT } });
  assert.equal(r.code, 500);
  assert.match(r.body.error, /SMTP_PASS/);
});

test("accepts a JSON string body", async () => {
  const { call, sent } = setup();
  assert.equal((await call({ body: JSON.stringify({ kind: "report", id: REPORT }) })).code, 200);
  assert.equal(sent.length, 1);
});

test("report → emails the admins with who reported and why", async () => {
  const { call, sent } = setup();
  const r = await call({ body: { kind: "report", id: REPORT } });
  assert.equal(r.body.sent, true);
  assert.equal(sent[0].to, "boss@example.com");
  assert.match(sent[0].subject, /Report: “Sunrise” — Spam or scam/);
  assert.match(sent[0].text, /Fan <b> \(@fan\) reported “Sunrise”/);
  assert.match(sent[0].text, /looks fake/);
  assert.match(sent[0].text, /https:\/\/site\.example\/\?work=/);
});

test("report → the artist is NOT emailed by default", async () => {
  const { call, sent } = setup();
  await call({ body: { kind: "report", id: REPORT } });
  assert.ok(sent.every((m) => !m.to.includes("ada@example.com")));
});

test("report → optional artist notice never names the reporter or the reason", async () => {
  const { call, sent } = setup({ env: { OWNER_REPORT_NOTICE: "true" } });
  await call({ body: { kind: "report", id: REPORT } });
  assert.equal(sent.length, 2);
  const notice = sent.find((m) => m.to === "ada@example.com");
  assert.doesNotMatch(notice.html + notice.text + notice.subject, /Fan|fan|Spam or scam|looks fake/);
});

test("report → falls back to ADMIN_EMAIL, and says so when nobody can be emailed", async () => {
  const db = fakeDb(); delete db.state.profiles[ADMIN];
  const withFallback = setup({ db, env: { ADMIN_EMAIL: "owner@site.com" } });
  await withFallback.call({ body: { kind: "report", id: REPORT } });
  assert.equal(withFallback.sent[0].to, "owner@site.com");
  const none = setup({ db });
  assert.match((await none.call({ body: { kind: "report", id: REPORT } })).body.skipped, /no admin email/);
});

test("test kind sends only to a valid address", async () => {
  const { call, sent } = setup();
  assert.equal((await call({ body: { kind: "test", to: "nope" } })).code, 400);
  assert.equal((await call({ body: { kind: "test", to: "me@example.com" } })).code, 200);
  assert.equal(sent[0].to, "me@example.com");
});

test("user text is HTML-escaped and subjects can't carry line breaks", () => {
  const mail = buildReportEmail({ report: { reason: "R\r\nBcc: evil@x.com", details: "<img src=x onerror=alert(1)>" }, reporterName: "<script>x</script>", work: { id: WORK, title: 'T"\r\nBcc: e@x.com', image_url: "https://i/x.jpg" }, siteUrl: "https://s.example" });
  assert.doesNotMatch(mail.html, /<script>|<img src=x/);
  assert.doesNotMatch(mail.subject, /[\r\n]/);
  assert.equal(cleanSubject("a\r\nb"), "a b");
});

test("makeDb: queries use real supabase-js methods", async () => {
  const real = new Set(["select", "eq", "maybeSingle"]);
  const sb = { from: () => new Proxy({}, { get(_, p) { if (p === "then") return (r) => r({ data: [{ id: ADMIN }], error: null }); if (!real.has(p)) throw new Error(`no method ${String(p)}`); return () => new Proxy({}, this); } }), auth: { admin: { getUserById: async () => ({ data: { user: { email: "a@b.c" } }, error: null }) } } };
  const db = makeDb(sb);
  assert.deepEqual(await db.getAdminProfiles(), [{ id: ADMIN }]);
  assert.equal(await db.getEmail(ADMIN), "a@b.c");
});
