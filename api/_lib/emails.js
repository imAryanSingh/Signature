// Builds the notification emails. Pure functions: no network, no database.
// (The underscore in "_lib" tells Vercel this folder is not a public route.)

export const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Subjects must never contain line breaks (header injection) and should stay short.
export const cleanSubject = (value) => String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 150);

const clip = (value, max) => {
  const text = String(value ?? "").trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
};

function shell({ heading, bodyHtml, imageUrl, ctaLabel, ctaUrl, footer, siteUrl }) {
  const image = imageUrl
    ? `<p style="margin:18px 0;"><a href="${esc(ctaUrl)}"><img src="${esc(imageUrl)}" width="240" alt="" style="display:block;border-radius:8px;max-width:100%;" /></a></p>`
    : "";
  const button = ctaUrl
    ? `<p style="margin:22px 0;"><a href="${esc(ctaUrl)}" style="background:#D83995;color:#fff;text-decoration:none;padding:11px 22px;border-radius:999px;display:inline-block;font-weight:bold;">${esc(ctaLabel)}</a></p>`
    : "";
  return `
  <div style="max-width:520px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.6;">
    <h2 style="font-family:Georgia,serif;font-weight:normal;margin:0 0 14px;color:#0593C6;">${heading}</h2>
    ${bodyHtml}
    ${image}
    ${button}
    <hr style="border:none;border-top:1px solid #ddd;margin:26px 0 12px;" />
    <p style="font-size:12px;color:#888;">${footer} <a href="${esc(siteUrl)}" style="color:#888;">Signature</a></p>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Daily summary (one email a day, only when something happened)       */
/* ------------------------------------------------------------------ */

const MAX_COMMENTS_SHOWN = 8;
const MAX_WORKS_SHOWN = 8;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "Ana", "Ana and Raj", "Ana, Raj and Vee", "Ana, Raj, Vee and 4 others"
export function joinNames(names, max = 3) {
  const list = names.filter(Boolean);
  if (list.length === 0) return "Someone";
  if (list.length === 1) return list[0];
  if (list.length <= max) return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  const rest = list.length - max;
  return `${list.slice(0, max).join(", ")} and ${rest} other${rest === 1 ? "" : "s"}`;
}

// summary = {
//   followers: [names], comments: [{ title, workId, name, text, isCritique }],
//   likes: [{ title, workId, names }], shares: [{ title, workId, names }]
// }
export function buildDailySummaryEmail({ recipientName, summary, siteUrl }) {
  const followers = summary.followers || [];
  const comments = summary.comments || [];
  const likes = summary.likes || [];
  const shares = summary.shares || [];
  const likeCount = likes.reduce((n, l) => n + l.names.length, 0);
  const shareCount = shares.reduce((n, l) => n + l.names.length, 0);
  const workUrl = (id) => (id ? `${siteUrl}/?work=${id}` : siteUrl);

  const parts = [];
  if (comments.length) parts.push(plural(comments.length, "comment"));
  if (likeCount) parts.push(plural(likeCount, "like"));
  if (followers.length) parts.push(plural(followers.length, "new follower"));
  if (shareCount) parts.push(plural(shareCount, "share"));
  const subject = cleanSubject(`Your day on Signature: ${parts.join(", ")}`);

  const html = [];
  const text = [`Hi ${recipientName || "there"},`, "", "Here's what happened to your work on Signature in the last day:"];
  const sectionTitle = (label) => `<h3 style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#0593C6;margin:22px 0 8px;">${esc(label)}</h3>`;

  if (comments.length) {
    html.push(sectionTitle(plural(comments.length, "comment")));
    text.push("", `COMMENTS (${comments.length})`);
    for (const c of comments.slice(0, MAX_COMMENTS_SHOWN)) {
      const verb = c.isCritique ? "left a critique on" : "commented on";
      html.push(
        `<p style="margin:10px 0 2px;"><strong>${esc(c.name)}</strong> ${verb} <a href="${esc(workUrl(c.workId))}" style="color:#06283A;">“${esc(c.title)}”</a></p>` +
          (c.text ? `<blockquote style="margin:4px 0 12px;padding:6px 12px;border-left:3px solid #D83995;color:#3d5766;">${esc(clip(c.text, 300))}</blockquote>` : "")
      );
      text.push(`- ${c.name} ${verb} “${c.title}”${c.text ? `: ${clip(c.text, 300)}` : ""}`, `  ${workUrl(c.workId)}`);
    }
    if (comments.length > MAX_COMMENTS_SHOWN) {
      const more = comments.length - MAX_COMMENTS_SHOWN;
      html.push(`<p style="color:#6b8794;">…and ${plural(more, "more comment")} on Signature.</p>`);
      text.push(`…and ${plural(more, "more comment")} on Signature.`);
    }
  }

  const block = (label, rows, verb) => {
    html.push(sectionTitle(label));
    text.push("", label.toUpperCase());
    for (const r of rows.slice(0, MAX_WORKS_SHOWN)) {
      html.push(`<p style="margin:6px 0;">“<a href="${esc(workUrl(r.workId))}" style="color:#06283A;">${esc(r.title)}</a>” — ${verb} ${esc(joinNames(r.names))}</p>`);
      text.push(`- “${r.title}” — ${verb} ${joinNames(r.names)}`);
    }
    if (rows.length > MAX_WORKS_SHOWN) {
      html.push(`<p style="color:#6b8794;">…and ${plural(rows.length - MAX_WORKS_SHOWN, "more piece")}.</p>`);
      text.push(`…and ${plural(rows.length - MAX_WORKS_SHOWN, "more piece")}.`);
    }
  };
  if (likes.length) block(plural(likeCount, "like"), likes, "liked by");
  if (followers.length) {
    html.push(sectionTitle(plural(followers.length, "new follower")));
    html.push(`<p style="margin:6px 0;">${esc(joinNames(followers, 5))} started following you.</p>`);
    text.push("", `NEW FOLLOWERS (${followers.length})`, `${joinNames(followers, 5)} started following you.`);
  }
  if (shares.length) block(plural(shareCount, "share"), shares, "shared by");

  const body = `<p>Hi ${esc(recipientName || "there")},</p><p>Here's what happened to your work in the last day:</p>${html.join("")}`;
  const footer = "You get one summary a day, only when something happened. Choose what it includes in Settings on";
  text.push("", siteUrl, "", `${footer} ${siteUrl}`);

  return {
    subject,
    html: shell({ heading: "Your day on Signature", bodyHtml: body, ctaLabel: "Open Signature", ctaUrl: siteUrl, footer, siteUrl }),
    text: text.join("\n"),
  };
}

/* ------------------------------------------------------------------ */
/* Reports and test messages                                           */
/* ------------------------------------------------------------------ */

// Sent to admins. Includes who reported — this is for moderators only.
export function buildReportEmail({ report, reporterName, reporterUsername, work, ownerName, ownerUsername, siteUrl }) {
  const title = work?.title || "(removed)";
  const workUrl = work?.id ? `${siteUrl}/?work=${work.id}` : siteUrl;
  const details = report.details ? `<p><strong>Details:</strong> ${esc(clip(report.details, 600))}</p>` : "";
  const html = shell({
    heading: "An artwork was reported",
    bodyHtml: `
      <p><strong>${esc(reporterName || "Someone")}</strong> (@${esc(reporterUsername || "?")}) reported
      <strong>“${esc(title)}”</strong> by ${esc(ownerName || "an artist")} (@${esc(ownerUsername || "?")}).</p>
      <p><strong>Reason:</strong> ${esc(report.reason)}</p>
      ${details}
      <p style="font-size:13px;color:#555;">Review it in Signature → Moderation. You can remove the artwork or dismiss the report there.</p>`,
    imageUrl: work?.image_url,
    ctaLabel: "Open the artwork",
    ctaUrl: workUrl,
    footer: "Sent to Signature administrators.",
    siteUrl,
  });
  const text = [
    `${reporterName || "Someone"} (@${reporterUsername || "?"}) reported “${title}” by ${ownerName || "an artist"} (@${ownerUsername || "?"}).`,
    `Reason: ${report.reason}`,
    ...(report.details ? [`Details: ${clip(report.details, 600)}`] : []),
    "",
    `Open: ${workUrl}`,
    "Review it in Signature → Moderation.",
  ].join("\n");
  return { subject: cleanSubject(`[Signature] Report: “${title}” — ${report.reason}`), html, text };
}

// Optional notice to the artist (off by default). Never names the reporter.
export function buildOwnerReportNotice({ work, ownerName, siteUrl }) {
  const title = work?.title || "your artwork";
  const html = shell({
    heading: "Your artwork is being reviewed",
    bodyHtml: `<p>Hi ${esc(ownerName || "there")},</p>
      <p>Someone asked our moderators to take a look at <strong>“${esc(title)}”</strong>. Nothing has been removed.
      If it follows the Terms of Service, it stays up. We don't share who made a report.</p>`,
    imageUrl: work?.image_url,
    ctaLabel: "Open your artwork",
    ctaUrl: work?.id ? `${siteUrl}/?work=${work.id}` : siteUrl,
    footer: "This is a service message from",
    siteUrl,
  });
  const text = `Hi ${ownerName || "there"},\n\nSomeone asked our moderators to review “${title}”. Nothing has been removed. We don't share who made a report.\n\n${siteUrl}`;
  return { subject: cleanSubject(`Your artwork “${title}” is being reviewed`), html, text };
}

export function buildTestEmail({ siteUrl }) {
  return {
    subject: "Signature test email",
    html: shell({
      heading: "It works",
      bodyHtml: "<p>This is a test message from your Signature notification function. Email sending is set up correctly.</p>",
      footer: "Sent by",
      siteUrl,
    }),
    text: `This is a test message from your Signature notification function. Email sending is set up correctly.\n${siteUrl}`,
  };
}
