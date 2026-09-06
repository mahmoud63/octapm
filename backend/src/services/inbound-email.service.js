const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const addresses = require("../utils/inbound-addresses");
const { recordWorkspacePath } = require("../utils/record-links");
const auditService = require("./audit.service");
const commentService = require("./comment.service");
const conversationService = require("./conversation.service");
const correspondenceService = require("./correspondence.service");
const attachmentService = require("./attachment.service");
const fileStorageService = require("./file-storage.service");
const { assertProjectAccess } = require("./project-authorization.service");

/**
 * Inbound email (OCTA-COMM-CONV-042).
 *
 * A mail provider (Postmark, Mailgun, SendGrid inbound parse, or anything that
 * can POST JSON) delivers every message sent to INBOUND_EMAIL_DOMAIN to
 * POST /api/v1/public/inbound-email/:provider. The recipient address says
 * where it goes:
 *
 *   - r-<type>-<id>-<sig>@…  a reply to a notification about a record → a
 *     comment on that record by the sender (who must be a user with access);
 *   - c-<conversation>-<sig>@…  a reply to a conversation notification → a
 *     message in that conversation by the sender (who must be a member);
 *   - p-<token>@…  the project's inbox → an Emails row the team can log as
 *     correspondence, post to a record or turn into a conversation
 *     (automatically logged when the project says so).
 *
 * Every accepted message is stored as an InboundEmail (deduplicated by the
 * provider's Message-ID); attachments are saved as project documents.
 * Unknown senders are kept as `unmatched` for the team to triage.
 */

const PROVIDERS = Object.freeze(["postmark", "mailgun", "sendgrid", "generic"]);
const STATUS = Object.freeze({ RECEIVED: "received", POSTED: "posted", LOGGED: "logged", LINKED: "linked", IGNORED: "ignored", UNMATCHED: "unmatched", REJECTED: "rejected" });
const MAX_ATTACHMENTS = 20;
const MAX_BODY = 200_000;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const parseDate = (value) => {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};
const header = (headers, name) => {
  if (!Array.isArray(headers)) return null;
  const hit = headers.find((item) => String(item?.Name || item?.name || "").toLowerCase() === name.toLowerCase());
  return trimOrNull(hit?.Value ?? hit?.value);
};
const headerFromText = (text, name) => {
  const match = String(text || "").match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
  return match ? match[1].trim() : null;
};
const splitReferences = (value) => String(value || "").split(/\s+/).map((item) => item.trim()).filter(Boolean);
const clip = (text) => String(text || "").slice(0, MAX_BODY);

// ─── Quoted replies ───────────────────────────────────────────────────────

/** The new text of a reply: everything before the quoted thread. */
const stripQuotedReply = (text) => {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const kept = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const t = line.trim();
    if (/^>/.test(t)) break;
    if (/^On .{3,}wrote:?$/i.test(t) || /^Le .{3,}a écrit ?:$/i.test(t) || /^Am .{3,}schrieb .*:$/i.test(t)) break;
    if (/^-{2,}\s*(Original|Forwarded) Message\s*-{2,}$/i.test(t) || /^_{5,}$/.test(t) || /^-{5,}$/.test(t)) break;
    if (/^Sent from my /i.test(t) || /^Get Outlook for /i.test(t)) break;
    if (/^From:\s*\S/i.test(t)) {
      const next = lines.slice(index + 1, index + 5).map((item) => item.trim());
      if (next.some((item) => /^(Sent|To|Subject|Date):\s/i.test(item))) break;
    }
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

// ─── Provider payloads ────────────────────────────────────────────────────

const attachmentMeta = (item) => ({ name: trimOrNull(item?.name) || "attachment", contentType: trimOrNull(item?.contentType) || "application/octet-stream", size: Number(item?.size) || null, content: item?.content || null, path: item?.path || null });

const parsePostmark = (body = {}) => ({
  messageId: trimOrNull(body.MessageID) || header(body.Headers, "Message-ID"),
  inReplyTo: header(body.Headers, "In-Reply-To"),
  references: splitReferences(header(body.Headers, "References")),
  from: body.FromFull?.Email ? { email: String(body.FromFull.Email).toLowerCase(), name: trimOrNull(body.FromFull.Name) } : addresses.parseAddress(body.From),
  to: Array.isArray(body.ToFull) && body.ToFull.length ? body.ToFull.map((item) => ({ email: String(item.Email || "").toLowerCase(), name: trimOrNull(item.Name) })) : addresses.splitAddresses(body.To),
  cc: Array.isArray(body.CcFull) && body.CcFull.length ? body.CcFull.map((item) => ({ email: String(item.Email || "").toLowerCase(), name: trimOrNull(item.Name) })) : addresses.splitAddresses(body.Cc),
  subject: trimOrNull(body.Subject) || "(no subject)",
  text: body.TextBody || "",
  html: body.HtmlBody || null,
  strippedText: trimOrNull(body.StrippedTextReply),
  receivedAt: parseDate(body.Date),
  attachments: (Array.isArray(body.Attachments) ? body.Attachments : []).map((item) => attachmentMeta({ name: item.Name, contentType: item.ContentType, size: item.ContentLength, content: item.Content })),
});

const parseMailgun = (body = {}, files = []) => ({
  messageId: trimOrNull(body["Message-Id"] || body["message-id"] || body["Message-ID"]),
  inReplyTo: trimOrNull(body["In-Reply-To"]),
  references: splitReferences(body.References),
  from: addresses.parseAddress(body.from || body.From || body.sender),
  to: addresses.splitAddresses(body.recipient || body.To || body.to),
  cc: addresses.splitAddresses(body.Cc || body.cc),
  subject: trimOrNull(body.subject || body.Subject) || "(no subject)",
  text: body["body-plain"] || "",
  html: body["body-html"] || null,
  strippedText: trimOrNull(body["stripped-text"]),
  receivedAt: body.timestamp ? new Date(Number(body.timestamp) * 1000) : new Date(),
  attachments: (files || []).map((file) => attachmentMeta({ name: file.originalname, contentType: file.mimetype, size: file.size, path: file.path })),
});

const parseSendgrid = (body = {}, files = []) => ({
  messageId: headerFromText(body.headers, "Message-ID"),
  inReplyTo: headerFromText(body.headers, "In-Reply-To"),
  references: splitReferences(headerFromText(body.headers, "References")),
  from: addresses.parseAddress(body.from),
  to: addresses.splitAddresses(body.to),
  cc: addresses.splitAddresses(body.cc),
  subject: trimOrNull(body.subject) || "(no subject)",
  text: body.text || "",
  html: body.html || null,
  strippedText: null,
  receivedAt: new Date(),
  attachments: (files || []).map((file) => attachmentMeta({ name: file.originalname, contentType: file.mimetype, size: file.size, path: file.path })),
});

const parseGeneric = (body = {}, files = []) => ({
  messageId: trimOrNull(body.messageId || body.message_id),
  inReplyTo: trimOrNull(body.inReplyTo || body.in_reply_to),
  references: Array.isArray(body.references) ? body.references.map(String) : splitReferences(body.references),
  from: typeof body.from === "string" ? addresses.parseAddress(body.from) : body.from?.email ? { email: String(body.from.email).toLowerCase(), name: trimOrNull(body.from.name) } : null,
  to: addresses.splitAddresses(body.to),
  cc: addresses.splitAddresses(body.cc),
  subject: trimOrNull(body.subject) || "(no subject)",
  text: body.text || body.textBody || "",
  html: body.html || body.htmlBody || null,
  strippedText: trimOrNull(body.strippedText),
  receivedAt: parseDate(body.receivedAt || body.date),
  attachments: [...(Array.isArray(body.attachments) ? body.attachments : []).map((item) => attachmentMeta({ name: item.name || item.filename, contentType: item.contentType || item.type, size: item.size, content: item.content })), ...(files || []).map((file) => attachmentMeta({ name: file.originalname, contentType: file.mimetype, size: file.size, path: file.path }))],
});

const PARSERS = { postmark: parsePostmark, mailgun: parseMailgun, sendgrid: parseSendgrid, generic: parseGeneric };

const parsePayload = ({ provider, body, files = [] }) => {
  const parser = PARSERS[provider];
  if (!parser) throw new HttpError(404, "INBOUND_EMAIL_PROVIDER_UNKNOWN", `Unknown provider: ${provider}`);
  const parsed = parser(body || {}, files);
  if (!parsed.from?.email) throw new HttpError(400, "INBOUND_EMAIL_FROM_REQUIRED", "The message has no sender");
  parsed.text = clip(parsed.text);
  parsed.html = parsed.html ? clip(parsed.html) : null;
  parsed.attachments = parsed.attachments.slice(0, MAX_ATTACHMENTS);
  return parsed;
};

// ─── Webhook authentication ───────────────────────────────────────────────

const basicAuthPassword = (headers = {}) => {
  const raw = headers.authorization || headers.Authorization;
  if (!raw || !/^basic /i.test(raw)) return null;
  try {
    const decoded = Buffer.from(raw.slice(6), "base64").toString("utf8");
    const at = decoded.indexOf(":");
    return at >= 0 ? decoded.slice(at + 1) : decoded;
  } catch {
    return null;
  }
};

/** Shared token for Postmark / SendGrid / generic; Mailgun's HMAC signature. */
const verifyWebhook = ({ provider, headers = {}, query = {}, body = {} }) => {
  if (!PROVIDERS.includes(provider)) throw new HttpError(404, "INBOUND_EMAIL_PROVIDER_UNKNOWN", `Unknown provider: ${provider}`);
  if (provider === "mailgun") {
    const key = trimOrNull(process.env.INBOUND_MAILGUN_SIGNING_KEY) || trimOrNull(process.env.INBOUND_EMAIL_WEBHOOK_TOKEN);
    const source = body.signature && typeof body.signature === "object" ? body.signature : body;
    const { timestamp, token, signature } = source;
    if (!key) throw new HttpError(503, "INBOUND_EMAIL_NOT_CONFIGURED", "Set INBOUND_MAILGUN_SIGNING_KEY");
    if (!timestamp || !token || !signature) throw new HttpError(401, "INBOUND_EMAIL_UNAUTHORIZED", "Missing Mailgun signature");
    const digest = crypto.createHmac("sha256", key).update(`${timestamp}${token}`).digest("hex");
    if (!addresses.safeEqual(digest, signature)) throw new HttpError(401, "INBOUND_EMAIL_UNAUTHORIZED", "Bad Mailgun signature");
    return true;
  }
  const expected = trimOrNull(process.env.INBOUND_EMAIL_WEBHOOK_TOKEN);
  if (!expected) throw new HttpError(503, "INBOUND_EMAIL_NOT_CONFIGURED", "Set INBOUND_EMAIL_WEBHOOK_TOKEN");
  const provided = trimOrNull(query.token) || trimOrNull(headers["x-inbound-token"] || headers["X-Inbound-Token"]) || basicAuthPassword(headers);
  if (!provided || !addresses.safeEqual(provided, expected)) throw new HttpError(401, "INBOUND_EMAIL_UNAUTHORIZED", "Bad inbound token");
  return true;
};

// ─── Serialisation ────────────────────────────────────────────────────────

const out = (row, { detail = false } = {}) => ({
  id: row.id,
  projectId: row.projectId || null,
  provider: row.provider,
  messageId: row.messageId || null,
  from: { email: row.fromEmail, name: row.fromName || null },
  to: Array.isArray(row.toJson) ? row.toJson : [],
  cc: Array.isArray(row.ccJson) ? row.ccJson : [],
  subject: row.subject,
  preview: String(row.replyText || row.textBody || "").replace(/\s+/g, " ").trim().slice(0, 160),
  textBody: detail ? row.textBody : undefined,
  htmlBody: detail ? row.htmlBody || null : undefined,
  replyText: detail ? row.replyText || null : undefined,
  attachments: Array.isArray(row.attachmentsJson) ? row.attachmentsJson.map((item) => ({ name: item.name, contentType: item.contentType, size: item.size ?? null, stored: Boolean(item.stored), attachmentId: item.attachmentId || null, documentId: item.documentId || null })) : [],
  attachmentCount: Array.isArray(row.attachmentsJson) ? row.attachmentsJson.length : 0,
  receivedAt: toIso(row.receivedAt),
  status: row.status,
  target: row.target || null,
  recordType: row.recordType || null,
  recordId: row.recordId || null,
  recordPath: row.recordType && row.recordId && row.projectId ? recordWorkspacePath({ projectId: row.projectId, recordType: row.recordType, recordId: row.recordId }) : null,
  conversationId: row.conversationId || null,
  conversationPath: row.conversationId ? recordWorkspacePath({ projectId: null, recordType: "conversation", recordId: row.conversationId }) : null,
  commentId: row.commentId || null,
  correspondenceId: row.correspondenceId || null,
  correspondencePath: row.correspondenceId && row.projectId ? recordWorkspacePath({ projectId: row.projectId, recordType: "correspondence", recordId: row.correspondenceId }) : null,
  senderUserId: row.senderUserId || null,
  error: row.error || null,
  processedAt: toIso(row.processedAt),
  createdAt: toIso(row.createdAt),
});

// ─── Attachments ──────────────────────────────────────────────────────────

/** Saves the message's files as project documents attached to `recordType/recordId`. */
const storeAttachments = async ({ orgId, projectId, userId, recordType, recordId, attachments }) => {
  const results = [];
  const files = [];
  const temporary = [];
  if (!projectId || !attachments?.length) return results;
  const dir = fileStorageService.ensureTempUploadDirSync();
  for (const item of attachments.slice(0, MAX_ATTACHMENTS)) {
    const meta = { name: item.name || "attachment", contentType: item.contentType || "application/octet-stream", size: item.size || null, stored: false };
    if (item.path) files.push({ path: item.path, originalname: meta.name, mimetype: meta.contentType, size: item.size || 0, index: results.length });
    else if (item.content) {
      try {
        const buffer = Buffer.from(String(item.content), "base64");
        const tmp = path.join(dir, `${crypto.randomUUID()}${path.extname(meta.name).slice(0, 12)}`);
        await fs.writeFile(tmp, buffer);
        temporary.push(tmp);
        meta.size = buffer.length;
        files.push({ path: tmp, originalname: meta.name, mimetype: meta.contentType, size: buffer.length, index: results.length });
      } catch (error) {
        meta.error = error.message;
      }
    }
    results.push(meta);
  }
  if (files.length) {
    try {
      const created = await attachmentService.createAttachments({ orgId, projectId, userId: userId || null, recordType, recordId, role: "attachment", files: files.map(({ index, ...file }) => file) });
      (created?.items || []).forEach((attachment, position) => {
        const meta = results[files[position]?.index];
        if (!meta) return;
        meta.stored = true;
        meta.attachmentId = attachment.id || null;
        meta.documentId = attachment.documentId || attachment.document?.id || null;
      });
    } catch (error) {
      files.forEach((file) => {
        results[file.index].error = error.message;
      });
    } finally {
      await Promise.all(temporary.map((file) => fs.unlink(file).catch(() => null)));
    }
  }
  return results;
};

const relinkAttachments = async ({ orgId, projectId, userId, recordType, recordId, row }) => {
  const documentIds = (Array.isArray(row.attachmentsJson) ? row.attachmentsJson : []).map((item) => item.documentId).filter(Boolean);
  if (!documentIds.length) return;
  await attachmentService.createAttachments({ orgId, projectId, userId: userId || null, recordType, recordId, role: "attachment", documentIds }).catch(() => null);
};

// ─── Routing ──────────────────────────────────────────────────────────────

const findSender = ({ orgId, email }) => prisma.user.findFirst({ where: { orgId, status: "active", email: { equals: String(email || "").toLowerCase(), mode: "insensitive" } }, select: { id: true, name: true, email: true, role: true, isCompanyAdmin: true } });

const locateRecord = async ({ recordType, recordId }) => {
  const source = commentService.RECORD_SOURCES[recordType];
  if (!source || !prisma[source.model]?.findFirst) return null;
  const record = await prisma[source.model].findFirst({ where: { id: recordId }, select: { id: true, projectId: true } });
  if (!record?.projectId) return null;
  const project = await prisma.project.findFirst({ where: { id: record.projectId }, select: { id: true, orgId: true, name: true } });
  return project ? { record, project } : null;
};

const bodyForPosting = (parsed) => {
  const reply = parsed.strippedText || stripQuotedReply(parsed.text);
  return reply || parsed.text.trim() || parsed.subject;
};

const emailIntro = (row) => `📧 Email from ${row.fromName ? `${row.fromName} <${row.fromEmail}>` : row.fromEmail} — ${row.subject}`;

/** Handles one delivered message. Never throws for content problems: the answer says what happened. */
const receive = async ({ provider, parsed }) => {
  const recipients = [...(parsed.to || []), ...(parsed.cc || [])];
  const targets = recipients.map((item) => addresses.parseTarget(item.email)).filter(Boolean);
  if (!targets.length) return { accepted: false, reason: "no_target" };
  const target = targets.find((item) => item.kind === "record") || targets.find((item) => item.kind === "conversation") || targets[0];
  if (!addresses.verifyTargetSignature(target)) return { accepted: false, reason: "bad_signature" };

  let orgId = null;
  let projectId = null;
  let project = null;
  let conversation = null;
  if (target.kind === "project") {
    project = await prisma.project.findFirst({ where: { inboundEmailToken: target.token }, select: { id: true, orgId: true, name: true, inboundEmailAutoLog: true } });
    if (!project) return { accepted: false, reason: "unknown_project" };
    orgId = project.orgId;
    projectId = project.id;
  } else if (target.kind === "record") {
    const located = await locateRecord({ recordType: target.recordType, recordId: target.recordId });
    if (!located) return { accepted: false, reason: "unknown_record" };
    project = located.project;
    orgId = project.orgId;
    projectId = project.id;
  } else {
    conversation = await prisma.conversation.findFirst({ where: { id: target.conversationId }, select: { id: true, orgId: true, projectId: true, archivedAt: true } });
    if (!conversation) return { accepted: false, reason: "unknown_conversation" };
    orgId = conversation.orgId;
    projectId = conversation.projectId || null;
  }

  if (parsed.messageId) {
    const duplicate = await prisma.inboundEmail.findFirst({ where: { orgId, provider, messageId: parsed.messageId }, select: { id: true, status: true } });
    if (duplicate) return { accepted: true, duplicate: true, id: duplicate.id, status: duplicate.status };
  }

  const sender = await findSender({ orgId, email: parsed.from.email });
  const replyText = parsed.strippedText || stripQuotedReply(parsed.text) || null;
  const row = await prisma.inboundEmail.create({
    data: { orgId, projectId, provider, messageId: parsed.messageId || null, inReplyTo: parsed.inReplyTo || null, referencesJson: parsed.references || [], fromEmail: parsed.from.email, fromName: parsed.from.name || null, toJson: parsed.to || [], ccJson: parsed.cc || [], subject: parsed.subject, textBody: parsed.text || "", htmlBody: parsed.html || null, replyText, attachmentsJson: [], receivedAt: parsed.receivedAt || new Date(), status: STATUS.RECEIVED, target: target.kind, recordType: target.kind === "record" ? target.recordType : null, recordId: target.kind === "record" ? target.recordId : null, conversationId: conversation?.id || null, senderUserId: sender?.id || null },
  });

  const stored = await storeAttachments({ orgId, projectId, userId: sender?.id || null, recordType: "inbound_email", recordId: row.id, attachments: parsed.attachments });
  const data = { attachmentsJson: stored, processedAt: new Date() };
  const actor = sender ? { id: sender.id, name: sender.name, role: sender.role, isCompanyAdmin: sender.isCompanyAdmin } : null;

  try {
    if (target.kind === "record") {
      if (!sender) {
        Object.assign(data, { status: STATUS.UNMATCHED, error: `${parsed.from.email} is not a user of this organisation — post it to the record by hand` });
      } else {
        await assertProjectAccess({ orgId, projectId, userId: sender.id, role: sender.role, isCompanyAdmin: sender.isCompanyAdmin });
        const comment = await commentService.createComment({ orgId, projectId, recordType: target.recordType, recordId: target.recordId, body: bodyForPosting(parsed), actor });
        await relinkAttachments({ orgId, projectId, userId: sender.id, recordType: target.recordType, recordId: target.recordId, row: { attachmentsJson: stored } });
        Object.assign(data, { status: STATUS.POSTED, commentId: comment.id });
      }
    } else if (target.kind === "conversation") {
      if (!sender) Object.assign(data, { status: STATUS.UNMATCHED, error: `${parsed.from.email} is not a user of this organisation` });
      else if (!(await conversationService.memberForEmail({ orgId, conversationId: conversation.id, userId: sender.id }))) Object.assign(data, { status: STATUS.UNMATCHED, error: `${sender.name} is not in this conversation` });
      else {
        const message = await conversationService.sendMessage({ orgId, viewer: actor, conversationId: conversation.id, payload: { body: bodyForPosting(parsed) }, kind: "email", inboundEmailId: row.id });
        Object.assign(data, { status: STATUS.POSTED, messageRowId: message.id });
      }
    } else if (project?.inboundEmailAutoLog) {
      const correspondence = await createCorrespondenceFrom({ orgId, projectId, row: { ...row, attachmentsJson: stored }, actor, payload: {} });
      Object.assign(data, { status: STATUS.LOGGED, correspondenceId: correspondence.id });
    }
  } catch (error) {
    if (error?.code === "PROJECT_ACCESS_DENIED") Object.assign(data, { status: STATUS.UNMATCHED, error: `${sender?.name || parsed.from.email} cannot open this project` });
    else Object.assign(data, { status: STATUS.REJECTED, error: error?.message || "Could not process the message" });
  }

  const updated = await prisma.inboundEmail.update({ where: { id: row.id }, data });
  await auditService.recordEvent({ orgId, projectId, entityType: "inbound_email", entityId: row.id, action: auditService.ACTIONS.CREATED, actorId: sender?.id || null, summary: { from: parsed.from.email, subject: parsed.subject, target: target.kind, status: updated.status, attachments: stored.length } }).catch(() => null);
  return { accepted: true, id: updated.id, status: updated.status, target: target.kind };
};

// ─── Inbox ────────────────────────────────────────────────────────────────

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true, name: true, inboundEmailToken: true, inboundEmailAutoLog: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

const load = async ({ orgId, projectId, emailId }) => {
  const row = await prisma.inboundEmail.findFirst({ where: { id: emailId, orgId, projectId } });
  if (!row) throw new HttpError(404, "INBOUND_EMAIL_NOT_FOUND", "Email not found");
  return row;
};

const listInbox = async ({ orgId, projectId, query = {} }) => {
  await ensureProject({ orgId, projectId });
  const where = { orgId, projectId };
  if (query.status) where.status = query.status;
  if (query.target) where.target = query.target;
  const text = trimOrNull(query.q);
  if (text) where.OR = [{ subject: { contains: text, mode: "insensitive" } }, { fromEmail: { contains: text, mode: "insensitive" } }, { fromName: { contains: text, mode: "insensitive" } }, { textBody: { contains: text, mode: "insensitive" } }];
  const rows = await prisma.inboundEmail.findMany({ where, orderBy: { receivedAt: "desc" }, take: 300 });
  const items = rows.map((row) => out(row));
  return { items, summary: { count: items.length, byStatus: Object.fromEntries(Object.values(STATUS).map((status) => [status, items.filter((item) => item.status === status).length])), needsAttention: items.filter((item) => [STATUS.RECEIVED, STATUS.UNMATCHED, STATUS.REJECTED].includes(item.status)).length } };
};

const getEmail = async ({ orgId, projectId, emailId }) => out(await load({ orgId, projectId, emailId }), { detail: true });

const createCorrespondenceFrom = async ({ orgId, projectId, row, actor, payload = {} }) => {
  const correspondence = await correspondenceService.createCorrespondence({
    orgId,
    projectId,
    payload: { direction: "incoming", type: payload.type || "email", subject: row.subject, body: [`From: ${row.fromName ? `${row.fromName} <${row.fromEmail}>` : row.fromEmail}`, `Received: ${new Date(row.receivedAt).toISOString()}`, "", row.textBody || ""].join("\n"), contractualNotice: Boolean(payload.contractualNotice), date: row.receivedAt, status: "open", ownerUserId: actor?.id || null, responseRequiredBy: payload.responseRequiredBy || null },
  });
  await relinkAttachments({ orgId, projectId, userId: actor?.id || null, recordType: "correspondence", recordId: correspondence.id, row });
  return correspondence;
};

const logAsCorrespondence = async ({ orgId, projectId, emailId, payload = {}, actor }) => {
  await ensureProject({ orgId, projectId });
  const row = await load({ orgId, projectId, emailId });
  if (row.correspondenceId) throw new HttpError(409, "INBOUND_EMAIL_ALREADY_LOGGED", "This email is already logged as correspondence");
  const correspondence = await createCorrespondenceFrom({ orgId, projectId, row, actor, payload });
  const updated = await prisma.inboundEmail.update({ where: { id: emailId }, data: { status: STATUS.LOGGED, correspondenceId: correspondence.id, error: null, processedAt: new Date() } });
  await auditService.recordEvent({ orgId, projectId, entityType: "inbound_email", entityId: emailId, action: auditService.ACTIONS.STATUS_CHANGED, actorId: actor?.id || null, summary: { to: STATUS.LOGGED, correspondence: correspondence.ref } }).catch(() => null);
  return out(updated, { detail: true });
};

const postToRecord = async ({ orgId, projectId, emailId, payload = {}, actor }) => {
  await ensureProject({ orgId, projectId });
  const row = await load({ orgId, projectId, emailId });
  const recordType = trimOrNull(payload.recordType);
  const recordId = trimOrNull(payload.recordId);
  if (!recordType || !recordId || !commentService.RECORD_TYPES.includes(recordType)) throw new HttpError(400, "INBOUND_EMAIL_RECORD_INVALID", "Choose a record to post the email on");
  const body = `${emailIntro(row)}\n\n${row.replyText || row.textBody || ""}`.trim();
  const comment = await commentService.createComment({ orgId, projectId, recordType, recordId, body: body.slice(0, commentService.MAX_BODY_LENGTH), actor: { id: actor.id, name: actor.name, role: actor.role } });
  await relinkAttachments({ orgId, projectId, userId: actor?.id || null, recordType, recordId, row });
  const updated = await prisma.inboundEmail.update({ where: { id: emailId }, data: { status: STATUS.POSTED, recordType, recordId, commentId: comment.id, error: null, processedAt: new Date() } });
  await auditService.recordEvent({ orgId, projectId, entityType: "inbound_email", entityId: emailId, action: auditService.ACTIONS.STATUS_CHANGED, actorId: actor?.id || null, summary: { to: STATUS.POSTED, recordType, recordId } }).catch(() => null);
  return out(updated, { detail: true });
};

const startConversation = async ({ orgId, projectId, emailId, payload = {}, actor }) => {
  await ensureProject({ orgId, projectId });
  const row = await load({ orgId, projectId, emailId });
  const memberUserIds = Array.isArray(payload.memberUserIds) ? payload.memberUserIds : [];
  if (row.senderUserId && !memberUserIds.includes(row.senderUserId)) memberUserIds.push(row.senderUserId);
  const conversation = await conversationService.createConversation({ orgId, viewer: actor, payload: { kind: "group", projectId, title: trimOrNull(payload.title) || row.subject, memberUserIds, message: `${emailIntro(row)}\n\n${row.replyText || row.textBody || ""}`.trim().slice(0, conversationService.MAX_BODY_LENGTH) } });
  const updated = await prisma.inboundEmail.update({ where: { id: emailId }, data: { status: STATUS.LINKED, conversationId: conversation.id, error: null, processedAt: new Date() } });
  await auditService.recordEvent({ orgId, projectId, entityType: "inbound_email", entityId: emailId, action: auditService.ACTIONS.STATUS_CHANGED, actorId: actor?.id || null, summary: { to: STATUS.LINKED, conversationId: conversation.id } }).catch(() => null);
  return { email: out(updated, { detail: true }), conversation };
};

const ignoreEmail = async ({ orgId, projectId, emailId, actor }) => {
  await ensureProject({ orgId, projectId });
  await load({ orgId, projectId, emailId });
  const updated = await prisma.inboundEmail.update({ where: { id: emailId }, data: { status: STATUS.IGNORED, processedAt: new Date() } });
  await auditService.recordEvent({ orgId, projectId, entityType: "inbound_email", entityId: emailId, action: auditService.ACTIONS.STATUS_CHANGED, actorId: actor?.id || null, summary: { to: STATUS.IGNORED } }).catch(() => null);
  return out(updated, { detail: true });
};

const deleteEmail = async ({ orgId, projectId, emailId, actor }) => {
  await ensureProject({ orgId, projectId });
  const row = await load({ orgId, projectId, emailId });
  await prisma.inboundEmail.delete({ where: { id: emailId } });
  await auditService.recordEvent({ orgId, projectId, entityType: "inbound_email", entityId: emailId, action: auditService.ACTIONS.DELETED, actorId: actor?.id || null, summary: { subject: row.subject, from: row.fromEmail } }).catch(() => null);
  return { deleted: true };
};

// ─── Project settings ─────────────────────────────────────────────────────

const settingsOut = (project) => ({
  configured: addresses.isInboundConfigured(),
  domain: addresses.inboundDomain(),
  address: addresses.projectAddress(project),
  autoLog: Boolean(project.inboundEmailAutoLog),
  repliesToRecords: addresses.isInboundConfigured(),
  providers: PROVIDERS,
  webhookPath: "/api/v1/public/inbound-email/{provider}",
});

const projectSettings = async ({ orgId, projectId }) => settingsOut(await ensureProject({ orgId, projectId }));

const rotateProjectAddress = async ({ orgId, projectId, actor }) => {
  await ensureProject({ orgId, projectId });
  const project = await prisma.project.update({ where: { id: projectId }, data: { inboundEmailToken: addresses.newProjectToken() }, select: { id: true, name: true, inboundEmailToken: true, inboundEmailAutoLog: true } });
  await auditService.recordEvent({ orgId, projectId, entityType: "project", entityId: projectId, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { inboundEmailAddress: addresses.projectAddress(project) } }).catch(() => null);
  return settingsOut(project);
};

const updateProjectSettings = async ({ orgId, projectId, payload = {}, actor }) => {
  await ensureProject({ orgId, projectId });
  const data = {};
  if (payload.autoLog !== undefined) data.inboundEmailAutoLog = Boolean(payload.autoLog);
  const project = await prisma.project.update({ where: { id: projectId }, data, select: { id: true, name: true, inboundEmailToken: true, inboundEmailAutoLog: true } });
  await auditService.recordEvent({ orgId, projectId, entityType: "project", entityId: projectId, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { inboundEmailAutoLog: project.inboundEmailAutoLog } }).catch(() => null);
  return settingsOut(project);
};

module.exports = {
  PROVIDERS,
  STATUS,
  stripQuotedReply,
  parsePayload,
  verifyWebhook,
  receive,
  listInbox,
  getEmail,
  logAsCorrespondence,
  postToRecord,
  startConversation,
  ignoreEmail,
  deleteEmail,
  projectSettings,
  rotateProjectAddress,
  updateProjectSettings,
};
