/**
 * Trial reminders under two leaders at once (a hand-over, a run started by
 * hand) and under a failing mail provider. The real billing checks, the real
 * local Postgres, and a fake email webhook on 127.0.0.1 that counts what it
 * is sent. Every run is narrowed to this test's own organisations.
 *
 *   npm run test:live -- src/jobs/__live__/billing-reminders.live.test.js
 */
const http = require("http");
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");

const HOUR = 60 * 60 * 1000;

liveDescribe("trial reminders", () => {
  const orgs = [];
  let mail;
  let mailPort;
  const received = [];
  let answer = 200;
  const savedEnv = {};

  const trialOrg = async (hoursLeft) => {
    const live = await createLiveOrg(prisma);
    orgs.push(live);
    await prisma.subscription.update({
      where: { orgId: live.org.id },
      data: { status: "trialing", trialEndsAt: new Date(Date.now() + hoursLeft * HOUR), reminderDay5SentAt: null, reminderDay7SentAt: null },
    });
    return live;
  };
  const subscriptionOf = (live) => prisma.subscription.findUnique({ where: { orgId: live.org.id } });
  const sentTo = (live) => received.filter((message) => message.to === live.user.email);

  beforeAll(async () => {
    mail = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        received.push(JSON.parse(body || "{}"));
        res.writeHead(answer);
        res.end();
      });
    });
    await new Promise((resolve) => mail.listen(0, "127.0.0.1", resolve));
    mailPort = mail.address().port;
    for (const name of ["EMAIL_WEBHOOK_URL", "EMAIL_PROVIDER"]) savedEnv[name] = process.env[name];
    process.env.EMAIL_WEBHOOK_URL = `http://127.0.0.1:${mailPort}/send`;
    delete process.env.EMAIL_PROVIDER;
  });

  afterAll(async () => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    mail?.close();
    for (const live of orgs) await dropLiveOrg(prisma, live.org.id);
    await prisma.$disconnect();
  });

  it("sends a reminder once when two runs overlap", async () => {
    const { runBillingChecks } = require("../billing-scheduler");
    const live = await trialOrg(36); // inside the two-day reminder, outside the one-day one
    answer = 200;

    await Promise.all([runBillingChecks(new Date(), { orgIds: [live.org.id] }), runBillingChecks(new Date(), { orgIds: [live.org.id] })]);

    expect(sentTo(live)).toHaveLength(1);
    expect((await subscriptionOf(live)).reminderDay5SentAt).not.toBeNull();
  });

  it("re-opens a reminder whose send failed, without stopping the others", async () => {
    const { runBillingChecks } = require("../billing-scheduler");
    const failing = await trialOrg(36);
    const next = await trialOrg(36);
    answer = 500;

    // The provider refuses everything: the run still finishes, and nothing is marked sent.
    await expect(runBillingChecks(new Date(), { orgIds: [failing.org.id, next.org.id] })).resolves.toBeUndefined();
    expect(sentTo(failing)).toHaveLength(1);
    expect(sentTo(next)).toHaveLength(1);
    expect((await subscriptionOf(failing)).reminderDay5SentAt).toBeNull();
    expect((await subscriptionOf(next)).reminderDay5SentAt).toBeNull();

    // The provider recovers; the next run sends them.
    answer = 200;
    await runBillingChecks(new Date(), { orgIds: [failing.org.id, next.org.id] });
    expect(sentTo(failing)).toHaveLength(2);
    expect((await subscriptionOf(failing)).reminderDay5SentAt).not.toBeNull();
    expect((await subscriptionOf(next)).reminderDay5SentAt).not.toBeNull();
  });
});
