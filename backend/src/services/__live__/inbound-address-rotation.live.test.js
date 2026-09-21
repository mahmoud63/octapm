/**
 * A reply-to address already sitting in someone's inbox keeps working after
 * INBOUND_EMAIL_SECRET is rotated, for as long as the old value is kept in
 * INBOUND_EMAIL_SECRET_PREVIOUS — and stops once it is removed.
 *
 * The address is signed under S1 exactly as the notification mailer signs it;
 * the replies then arrive at a real API process running with the rotated keys
 * (and a rotated JWT_SECRET, which must not matter), through the real inbound
 * webhook, and must land as a comment on a real record.
 */
const crypto = require("crypto");
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const DOMAIN = "in.octapm-live.test";
const S1 = `inbound-s1-${crypto.randomBytes(24).toString("hex")}`;
const S2 = `inbound-s2-${crypto.randomBytes(24).toString("hex")}`;
const WEBHOOK_TOKEN = `inbound-token-${crypto.randomBytes(12).toString("hex")}`;
const J2 = `jwt-rotated-${crypto.randomBytes(24).toString("hex")}`;

/** Signs the address the way the running app does, under the given secret. */
const replyAddressUnder = (secret, target) => {
  const saved = { domain: process.env.INBOUND_EMAIL_DOMAIN, secret: process.env.INBOUND_EMAIL_SECRET };
  process.env.INBOUND_EMAIL_DOMAIN = DOMAIN;
  process.env.INBOUND_EMAIL_SECRET = secret;
  try {
    return require("../../utils/inbound-addresses").recordReplyAddress(target);
  } finally {
    for (const [name, value] of [["INBOUND_EMAIL_DOMAIN", saved.domain], ["INBOUND_EMAIL_SECRET", saved.secret]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

liveDescribe("inbound reply addresses through a secret rotation", () => {
  let live;
  let risk;
  let address;

  const reply = (api, to) =>
    api.post(`/api/v1/public/inbound-email/generic?token=${WEBHOOK_TOKEN}`, {
      messageId: `<${crypto.randomUUID()}@mail.octapm-live.test>`,
      from: live.user.email,
      to,
      subject: "Re: risk",
      text: "Reply from the field",
    });

  const commentCount = () => prisma.comment.count({ where: { recordType: "risk", recordId: risk.id } });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    const project = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest inbound project" } });
    risk = await prisma.risk.create({ data: { projectId: project.id, ref: "R-LIVE-1", description: "Crane lift over the road" } });
    address = replyAddressUnder(S1, { recordType: "risk", recordId: risk.id });
    expect(address).toMatch(new RegExp(`^r-risk-${risk.id}-[0-9a-f]{12}@${DOMAIN.replace(/\./g, "\\.")}$`));
  });

  afterAll(async () => {
    if (live) await dropLiveOrg(prisma, live.org.id);
    await prisma.$disconnect();
  });

  const inboundEnv = { INBOUND_EMAIL_DOMAIN: DOMAIN, INBOUND_EMAIL_WEBHOOK_TOKEN: WEBHOOK_TOKEN, JWT_SECRET: J2 };

  it("routes a reply to an address signed under the old secret while it is PREVIOUS", async () => {
    const api = await startApi({ ...inboundEnv, INBOUND_EMAIL_SECRET: S2, INBOUND_EMAIL_SECRET_PREVIOUS: S1 });
    try {
      const before = await commentCount();
      const response = await reply(api, address);
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ accepted: true, status: "posted", target: "record" });
      expect(await commentCount()).toBe(before + 1);

      // A forged signature is refused whatever keys are configured.
      const forged = address.replace(/-([0-9a-f]{12})@/, (_match, sig) => `-${sig.startsWith("0") ? "1" : "0"}${sig.slice(1)}@`);
      const refused = await reply(api, forged);
      expect(refused.body.data).toMatchObject({ accepted: false, reason: "bad_signature" });
      expect(await commentCount()).toBe(before + 1);
    } finally {
      await api.stop();
    }
  });

  it("stops routing it once PREVIOUS is removed", async () => {
    const api = await startApi({ ...inboundEnv, INBOUND_EMAIL_SECRET: S2 });
    try {
      const before = await commentCount();
      const response = await reply(api, address);
      expect(response.body.data).toMatchObject({ accepted: false, reason: "bad_signature" });
      expect(await commentCount()).toBe(before);
    } finally {
      await api.stop();
    }
  });
});
