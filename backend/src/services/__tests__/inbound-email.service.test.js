const crypto = require("crypto");
const os = require("os");

process.env.INBOUND_EMAIL_DOMAIN = "mail.octapm.test";
process.env.INBOUND_EMAIL_SECRET = "inbound-secret";
process.env.INBOUND_EMAIL_WEBHOOK_TOKEN = "hook-token";
process.env.INBOUND_MAILGUN_SIGNING_KEY = "mg-key";

const store = { emails: [], audits: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;
const PROJECTS = [
  { id: "p1", orgId: "org-1", name: "Tower", inboundEmailToken: "abc123def456", inboundEmailAutoLog: false },
  { id: "p2", orgId: "org-1", name: "Bridge", inboundEmailToken: "auto00000001", inboundEmailAutoLog: true },
];
const USERS = [
  { id: "u-eng", orgId: "org-1", name: "Amal Haddad", email: "amal@tower.test", role: "site_engineer", isCompanyAdmin: false, status: "active" },
  { id: "u-out", orgId: "org-1", name: "Omar Said", email: "omar@tower.test", role: "site_engineer", isCompanyAdmin: false, status: "active" },
];
const RFI_ID = "11111111-1111-4111-8111-111111111111";
const CONV_ID = "22222222-2222-4222-8222-222222222222";
const matches = (row, where = {}) => Object.entries(where).every(([key, condition]) => (key === "OR" ? condition.some((clause) => matches(row, clause)) : condition && typeof condition === "object" && "equals" in condition ? String(row[key]).toLowerCase() === String(condition.equals).toLowerCase() : condition && typeof condition === "object" && "contains" in condition ? String(row[key] || "").toLowerCase().includes(String(condition.contains).toLowerCase()) : row[key] === condition));

const mockPrisma = {
  project: {
    findFirst: jest.fn(async ({ where }) => PROJECTS.find((project) => (where.inboundEmailToken ? project.inboundEmailToken === where.inboundEmailToken : project.id === where.id && (!where.orgId || project.orgId === where.orgId))) || null),
    update: jest.fn(async ({ where, data }) => Object.assign(PROJECTS.find((project) => project.id === where.id), data)),
  },
  user: { findFirst: jest.fn(async ({ where }) => USERS.find((user) => user.orgId === where.orgId && user.status === "active" && user.email === where.email.equals.toLowerCase()) || null) },
  rfi: { findFirst: jest.fn(async ({ where }) => (where.id === RFI_ID ? { id: RFI_ID, projectId: "p1" } : null)) },
  conversation: { findFirst: jest.fn(async ({ where }) => (where.id === CONV_ID ? { id: CONV_ID, orgId: "org-1", projectId: "p1", archivedAt: null } : null)) },
  inboundEmail: {
    findFirst: jest.fn(async ({ where }) => store.emails.find((row) => matches(row, where)) || null),
    findMany: jest.fn(async ({ where }) => store.emails.filter((row) => matches(row, where))),
    create: jest.fn(async ({ data }) => {
      const row = { id: nextId("mail"), createdAt: new Date(), updatedAt: new Date(), ...data };
      store.emails.push(row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }) => Object.assign(store.emails.find((row) => row.id === where.id), data, { updatedAt: new Date() })),
    delete: jest.fn(async ({ where }) => {
      store.emails = store.emails.filter((row) => row.id !== where.id);
      return {};
    }),
  },
};
const mockComments = { RECORD_TYPES: ["rfi"], RECORD_SOURCES: { rfi: { model: "rfi" } }, MAX_BODY_LENGTH: 5000, createComment: jest.fn(async ({ body }) => ({ id: "cmt-1", body })) };
const mockConversations = { MAX_BODY_LENGTH: 10000, memberForEmail: jest.fn(async ({ userId }) => (userId === "u-eng" ? { id: "mem-1" } : null)), sendMessage: jest.fn(async ({ payload }) => ({ id: "msg-1", body: payload.body })), createConversation: jest.fn(async ({ payload }) => ({ id: "conv-new", title: payload.title, members: payload.memberUserIds })) };
const mockCorrespondence = { createCorrespondence: jest.fn(async ({ payload }) => ({ id: "cor-1", ref: "COR-001", ...payload })) };
const mockAttachments = { createAttachments: jest.fn(async ({ files = [], documentIds = [] }) => ({ items: files.length ? files.map((file, index) => ({ id: `att-${index}`, documentId: `doc-${index}` })) : documentIds.map((id) => ({ id: `link-${id}`, documentId: id })) })) };
const mockAudit = { ACTIONS: { CREATED: "created", UPDATED: "updated", STATUS_CHANGED: "status_changed", DELETED: "deleted" }, recordEvent: jest.fn(async (event) => store.audits.push(event)) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../comment.service", () => mockComments);
jest.mock("../conversation.service", () => mockConversations);
jest.mock("../correspondence.service", () => mockCorrespondence);
jest.mock("../attachment.service", () => mockAttachments);
jest.mock("../file-storage.service", () => ({ ensureTempUploadDirSync: () => require("os").tmpdir(), cleanupTempFiles: async () => null }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../project-authorization.service", () => ({
  assertProjectAccess: async ({ userId }) => {
    if (userId === "u-out") throw Object.assign(new Error("denied"), { code: "PROJECT_ACCESS_DENIED", status: 403 });
    return { id: "p1" };
  },
}));

const addresses = require("../../utils/inbound-addresses");
const service = require("../inbound-email.service");

const actor = { id: "u-pm", name: "Priya Nair", role: "pm", isCompanyAdmin: false, canModerate: true };
const rfiAddress = () => addresses.recordReplyAddress({ recordType: "rfi", recordId: RFI_ID });
const postmark = (overrides = {}) => ({ MessageID: "pm-1", FromFull: { Email: "Amal@tower.test", Name: "Amal Haddad" }, ToFull: [{ Email: rfiAddress(), Name: "" }], Subject: "Re: RFI-012 Rebar spacing", TextBody: "Spacing confirmed at 150 mm.\n\nOn Tue, Amal wrote:\n> old text", StrippedTextReply: "", Headers: [{ Name: "In-Reply-To", Value: "<n-1@octapm>" }], Attachments: [{ Name: "photo.jpg", ContentType: "image/jpeg", ContentLength: 3, Content: Buffer.from("abc").toString("base64") }], ...overrides });
const reset = () => {
  store.emails = [];
  store.audits = [];
  PROJECTS[0].inboundEmailAutoLog = false;
  jest.clearAllMocks();
};

describe("inbound email", () => {
  beforeEach(reset);

  it("builds signed addresses that parse back and rejects tampered ones; strips quoted replies", () => {
    const address = rfiAddress();
    expect(address).toMatch(new RegExp(`^r-rfi-${RFI_ID}-[0-9a-f]{12}@mail\\.octapm\\.test$`));
    const target = addresses.parseTarget(`"Reply" <${address.toUpperCase()}>`);
    expect(target).toMatchObject({ kind: "record", recordType: "rfi", recordId: RFI_ID });
    expect(addresses.verifyTargetSignature(target)).toBe(true);
    expect(addresses.verifyTargetSignature({ ...target, sig: "000000000000" })).toBe(false);
    expect(addresses.parseTarget(addresses.conversationReplyAddress(CONV_ID))).toMatchObject({ kind: "conversation", conversationId: CONV_ID });
    expect(addresses.parseTarget("p-abc123def456@mail.octapm.test")).toEqual({ kind: "project", token: "abc123def456", address: "p-abc123def456@mail.octapm.test" });
    expect(addresses.parseTarget("someone@elsewhere.test")).toBeNull();
    expect(addresses.parseAddress("Amal Haddad <AMAL@tower.test>")).toEqual({ email: "amal@tower.test", name: "Amal Haddad" });
    expect(addresses.splitAddresses('"Nair, Priya" <p@x.test>, b@y.test')).toEqual([{ email: "p@x.test", name: "Nair, Priya" }, { email: "b@y.test", name: null }]);
    expect(addresses.projectAddress(PROJECTS[0])).toBe("p-abc123def456@mail.octapm.test");
    expect(service.stripQuotedReply("Yes, go ahead.\n\nOn Mon, 14 Sep 2026, Priya wrote:\n> can we pour?")).toBe("Yes, go ahead.");
    expect(service.stripQuotedReply("Approved.\r\n\r\nFrom: Priya Nair\r\nSent: Monday\r\nTo: Amal\r\nSubject: pour")).toBe("Approved.");
    expect(service.stripQuotedReply("From: the site we can see the crane.\nIt is fine.")).toBe("From: the site we can see the crane.\nIt is fine.");
    expect(service.stripQuotedReply("Done\n-----Original Message-----\nblah")).toBe("Done");
  });

  it("authenticates webhooks: shared token by query, header or basic auth; Mailgun by HMAC", () => {
    expect(service.verifyWebhook({ provider: "postmark", query: { token: "hook-token" } })).toBe(true);
    expect(service.verifyWebhook({ provider: "generic", headers: { "x-inbound-token": "hook-token" } })).toBe(true);
    expect(service.verifyWebhook({ provider: "sendgrid", headers: { authorization: `Basic ${Buffer.from("octapm:hook-token").toString("base64")}` } })).toBe(true);
    expect(() => service.verifyWebhook({ provider: "postmark", query: { token: "nope" } })).toThrow(expect.objectContaining({ code: "INBOUND_EMAIL_UNAUTHORIZED" }));
    expect(() => service.verifyWebhook({ provider: "imap", query: { token: "hook-token" } })).toThrow(expect.objectContaining({ code: "INBOUND_EMAIL_PROVIDER_UNKNOWN" }));
    const timestamp = "1700000000";
    const token = "abcdef";
    const signature = crypto.createHmac("sha256", "mg-key").update(`${timestamp}${token}`).digest("hex");
    expect(service.verifyWebhook({ provider: "mailgun", body: { timestamp, token, signature } })).toBe(true);
    expect(() => service.verifyWebhook({ provider: "mailgun", body: { timestamp, token, signature: "bad" } })).toThrow(expect.objectContaining({ code: "INBOUND_EMAIL_UNAUTHORIZED" }));
    const saved = process.env.INBOUND_EMAIL_WEBHOOK_TOKEN;
    delete process.env.INBOUND_EMAIL_WEBHOOK_TOKEN;
    expect(() => service.verifyWebhook({ provider: "generic", query: { token: "x" } })).toThrow(expect.objectContaining({ code: "INBOUND_EMAIL_NOT_CONFIGURED" }));
    process.env.INBOUND_EMAIL_WEBHOOK_TOKEN = saved;
  });

  it("posts a reply to a record as a comment by the sender, stores the attachments on the record, and deduplicates by Message-ID", async () => {
    const parsed = service.parsePayload({ provider: "postmark", body: postmark() });
    expect(parsed).toMatchObject({ messageId: "pm-1", inReplyTo: "<n-1@octapm>", from: { email: "amal@tower.test", name: "Amal Haddad" }, subject: "Re: RFI-012 Rebar spacing" });
    const result = await service.receive({ provider: "postmark", parsed });
    expect(result).toMatchObject({ accepted: true, status: "posted", target: "record" });
    expect(mockComments.createComment).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", projectId: "p1", recordType: "rfi", recordId: RFI_ID, body: "Spacing confirmed at 150 mm.", actor: expect.objectContaining({ id: "u-eng" }) }));
    expect(mockAttachments.createAttachments).toHaveBeenCalledTimes(2);
    expect(mockAttachments.createAttachments.mock.calls[0][0]).toMatchObject({ recordType: "inbound_email", files: [expect.objectContaining({ originalname: "photo.jpg", mimetype: "image/jpeg", size: 3 })] });
    expect(mockAttachments.createAttachments.mock.calls[1][0]).toMatchObject({ recordType: "rfi", recordId: RFI_ID, documentIds: ["doc-0"] });
    const row = store.emails[0];
    expect(row).toMatchObject({ status: "posted", commentId: "cmt-1", senderUserId: "u-eng", replyText: "Spacing confirmed at 150 mm.", attachmentsJson: [expect.objectContaining({ name: "photo.jpg", stored: true, documentId: "doc-0" })] });
    expect(await service.receive({ provider: "postmark", parsed })).toMatchObject({ accepted: true, duplicate: true, id: row.id });
    expect(store.emails).toHaveLength(1);
    expect(await service.receive({ provider: "postmark", parsed: service.parsePayload({ provider: "postmark", body: postmark({ MessageID: "pm-2", ToFull: [{ Email: `r-rfi-${RFI_ID}-000000000000@mail.octapm.test` }] }) }) })).toEqual({ accepted: false, reason: "bad_signature" });
    expect(await service.receive({ provider: "postmark", parsed: service.parsePayload({ provider: "postmark", body: postmark({ MessageID: "pm-3", ToFull: [{ Email: "nobody@elsewhere.test" }] }) }) })).toEqual({ accepted: false, reason: "no_target" });
  });

  it("keeps mail from unknown senders or people without access as unmatched for triage", async () => {
    const stranger = await service.receive({ provider: "postmark", parsed: service.parsePayload({ provider: "postmark", body: postmark({ MessageID: "pm-4", FromFull: { Email: "vendor@steel.test", Name: "Vendor" } }) }) });
    expect(stranger).toMatchObject({ accepted: true, status: "unmatched" });
    expect(store.emails[0].error).toContain("vendor@steel.test is not a user");
    expect(mockComments.createComment).not.toHaveBeenCalled();
    const denied = await service.receive({ provider: "postmark", parsed: service.parsePayload({ provider: "postmark", body: postmark({ MessageID: "pm-5", FromFull: { Email: "omar@tower.test", Name: "Omar" } }) }) });
    expect(denied).toMatchObject({ status: "unmatched" });
    expect(store.emails[1].error).toContain("cannot open this project");
  });

  it("routes conversation replies to members and project-inbox mail to the inbox (auto-logged as correspondence when the project says so)", async () => {
    const reply = await service.receive({ provider: "generic", parsed: service.parsePayload({ provider: "generic", body: { messageId: "g-1", from: "Amal Haddad <amal@tower.test>", to: addresses.conversationReplyAddress(CONV_ID), subject: "Re: L1 slab pour", text: "On my way\n\n> earlier" } }) });
    expect(reply).toMatchObject({ status: "posted", target: "conversation" });
    expect(mockConversations.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: CONV_ID, kind: "email", payload: { body: "On my way" }, viewer: expect.objectContaining({ id: "u-eng" }) }));
    const outsider = await service.receive({ provider: "generic", parsed: service.parsePayload({ provider: "generic", body: { messageId: "g-2", from: "omar@tower.test", to: [addresses.conversationReplyAddress(CONV_ID)], subject: "hi", text: "let me in" } }) });
    expect(outsider).toMatchObject({ status: "unmatched" });

    const inbox = await service.receive({ provider: "generic", parsed: service.parsePayload({ provider: "generic", body: { messageId: "g-3", from: { email: "client@owner.test", name: "The Client" }, to: ["p-abc123def456@mail.octapm.test"], cc: "pm@tower.test", subject: "Site instruction 14", text: "Please stop work on level 3.", attachments: [{ name: "SI-14.pdf", contentType: "application/pdf", content: Buffer.from("%PDF").toString("base64") }] } }) });
    expect(inbox).toMatchObject({ status: "received", target: "project" });
    expect(store.emails[2]).toMatchObject({ projectId: "p1", fromEmail: "client@owner.test", fromName: "The Client", toJson: [{ email: "p-abc123def456@mail.octapm.test", name: null }], attachmentsJson: [expect.objectContaining({ name: "SI-14.pdf", stored: true })] });
    const auto = await service.receive({ provider: "generic", parsed: service.parsePayload({ provider: "generic", body: { messageId: "g-4", from: "client@owner.test", to: "p-auto00000001@mail.octapm.test", subject: "Notice of delay", text: "We notify you..." } }) });
    expect(auto).toMatchObject({ status: "logged" });
    expect(mockCorrespondence.createCorrespondence).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p2", payload: expect.objectContaining({ direction: "incoming", type: "email", subject: "Notice of delay", status: "open" }) }));
    expect(await service.receive({ provider: "generic", parsed: service.parsePayload({ provider: "generic", body: { messageId: "g-5", from: "x@y.test", to: "p-doesnotexist@mail.octapm.test", subject: "?", text: "?" } }) })).toEqual({ accepted: false, reason: "unknown_project" });

    const mailgun = service.parsePayload({ provider: "mailgun", body: { "Message-Id": "<mg-1@mg>", from: "Amal <amal@tower.test>", recipient: "p-abc123def456@mail.octapm.test", subject: "Delivery note", "body-plain": "See attached", "stripped-text": "See attached", timestamp: "1700000000" }, files: [{ originalname: "dn.pdf", mimetype: "application/pdf", size: 10, path: `${os.tmpdir()}/dn.pdf` }] });
    expect(mailgun).toMatchObject({ messageId: "<mg-1@mg>", from: { email: "amal@tower.test", name: "Amal" }, to: [{ email: "p-abc123def456@mail.octapm.test", name: null }], attachments: [expect.objectContaining({ name: "dn.pdf", path: `${os.tmpdir()}/dn.pdf` })] });
    expect(mailgun.receivedAt.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    const sendgrid = service.parsePayload({ provider: "sendgrid", body: { headers: "Received: x\nMessage-ID: <sg-1@sg>\nIn-Reply-To: <n-9@octapm>", from: "a@b.test", to: "p-abc123def456@mail.octapm.test", subject: "s", text: "t" } });
    expect(sendgrid).toMatchObject({ messageId: "<sg-1@sg>", inReplyTo: "<n-9@octapm>" });
    expect(() => service.parsePayload({ provider: "generic", body: { to: "p-x@mail.octapm.test", subject: "no sender" } })).toThrow(expect.objectContaining({ code: "INBOUND_EMAIL_FROM_REQUIRED" }));
  });

  it("lets the team triage the inbox: log as correspondence, post to a record, start a conversation, ignore, delete; and manage the project address", async () => {
    await service.receive({ provider: "generic", parsed: service.parsePayload({ provider: "generic", body: { messageId: "g-10", from: "Amal Haddad <amal@tower.test>", to: "p-abc123def456@mail.octapm.test", subject: "Pump booking", text: "Booked for 06:00.\n\n> quoted", attachments: [{ name: "booking.pdf", contentType: "application/pdf", content: Buffer.from("%PDF").toString("base64") }] } }) });
    const list = await service.listInbox({ orgId: "org-1", projectId: "p1", query: {} });
    expect(list.summary).toMatchObject({ count: 1, needsAttention: 1 });
    const [email] = list.items;
    expect(email).toMatchObject({ status: "received", preview: "Booked for 06:00.", attachmentCount: 1, senderUserId: "u-eng" });
    expect((await service.getEmail({ orgId: "org-1", projectId: "p1", emailId: email.id })).textBody).toContain("Booked for 06:00.");

    const logged = await service.logAsCorrespondence({ orgId: "org-1", projectId: "p1", emailId: email.id, payload: { contractualNotice: true }, actor });
    expect(logged).toMatchObject({ status: "logged", correspondenceId: "cor-1", correspondencePath: "/projects/p1/doc-control/correspondence?recordId=cor-1" });
    expect(mockCorrespondence.createCorrespondence).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ contractualNotice: true, ownerUserId: "u-pm", subject: "Pump booking" }) }));
    expect(mockAttachments.createAttachments).toHaveBeenLastCalledWith(expect.objectContaining({ recordType: "correspondence", recordId: "cor-1", documentIds: ["doc-0"] }));
    await expect(service.logAsCorrespondence({ orgId: "org-1", projectId: "p1", emailId: email.id, actor })).rejects.toMatchObject({ code: "INBOUND_EMAIL_ALREADY_LOGGED" });

    const posted = await service.postToRecord({ orgId: "org-1", projectId: "p1", emailId: email.id, payload: { recordType: "rfi", recordId: RFI_ID }, actor });
    expect(posted).toMatchObject({ status: "posted", recordType: "rfi", recordId: RFI_ID, commentId: "cmt-1", recordPath: `/projects/p1/doc-control/rfi?recordId=${RFI_ID}` });
    expect(mockComments.createComment.mock.calls[0][0].body).toMatch(/^📧 Email from Amal Haddad <amal@tower\.test> — Pump booking\n\nBooked for 06:00\./);
    await expect(service.postToRecord({ orgId: "org-1", projectId: "p1", emailId: email.id, payload: { recordType: "photo", recordId: "x" }, actor })).rejects.toMatchObject({ code: "INBOUND_EMAIL_RECORD_INVALID" });

    const started = await service.startConversation({ orgId: "org-1", projectId: "p1", emailId: email.id, payload: { memberUserIds: ["u-qs"] }, actor });
    expect(started.email).toMatchObject({ status: "linked", conversationId: "conv-new", conversationPath: "/messages?conversationId=conv-new" });
    expect(mockConversations.createConversation).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ kind: "group", projectId: "p1", title: "Pump booking", memberUserIds: ["u-qs", "u-eng"] }) }));
    expect((await service.ignoreEmail({ orgId: "org-1", projectId: "p1", emailId: email.id, actor })).status).toBe("ignored");
    expect(await service.deleteEmail({ orgId: "org-1", projectId: "p1", emailId: email.id, actor })).toEqual({ deleted: true });
    expect(store.emails).toHaveLength(0);

    const settings = await service.projectSettings({ orgId: "org-1", projectId: "p1" });
    expect(settings).toMatchObject({ configured: true, domain: "mail.octapm.test", address: "p-abc123def456@mail.octapm.test", autoLog: false, repliesToRecords: true });
    const rotated = await service.rotateProjectAddress({ orgId: "org-1", projectId: "p1", actor });
    expect(rotated.address).toMatch(/^p-[0-9a-f]{12}@mail\.octapm\.test$/);
    expect(rotated.address).not.toBe(settings.address);
    expect((await service.updateProjectSettings({ orgId: "org-1", projectId: "p1", payload: { autoLog: true }, actor })).autoLog).toBe(true);
  });
});
