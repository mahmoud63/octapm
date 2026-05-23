const { prisma } = require('../config/db');
const { sendEmail, templates } = require('../services/email.service');

const DAY = 24 * 60 * 60 * 1000;

async function runBillingChecks(now = new Date()) {
  const trials = await prisma.subscription.findMany({
    where: { status: 'trialing', trialEndsAt: { not: null } },
    include: { org: true },
  });

  for (const sub of trials) {
    const msLeft = sub.trialEndsAt.getTime() - now.getTime();

    if (msLeft <= 0) {
      await prisma.subscription.update({
        where: { id: sub.id }, data: { status: 'expired' },
      });
      continue;
    }
    if (msLeft <= 2 * DAY && !sub.reminderDay5SentAt) {
      const tpl = templates.trialEndingIn2Days(sub.org?.name ?? 'there');
      await sendEmail({ to: await pmEmail(sub.orgId), ...tpl });
      await prisma.subscription.update({
        where: { id: sub.id }, data: { reminderDay5SentAt: now },
      });
    }
    if (msLeft <= 1 * DAY && !sub.reminderDay7SentAt) {
      const tpl = templates.trialEndsTomorrow(sub.org?.name ?? 'there');
      await sendEmail({ to: await pmEmail(sub.orgId), ...tpl });
      await prisma.subscription.update({
        where: { id: sub.id }, data: { reminderDay7SentAt: now },
      });
    }
  }

  await prisma.subscription.updateMany({
    where: { status: 'canceled', currentPeriodEnd: { lt: now } },
    data: { status: 'expired' },
  });
}

async function pmEmail(orgId) {
  const u = await prisma.user.findFirst({
    where: { orgId, role: 'pm' }, orderBy: { createdAt: 'asc' },
  });
  return u?.email ?? 'unknown@pmcopilots.local';
}

function startBillingScheduler() {
  runBillingChecks().catch((e) => console.error('[billing-scheduler]', e));
  setInterval(() => {
    runBillingChecks().catch((e) => console.error('[billing-scheduler]', e));
  }, DAY);
}

module.exports = { runBillingChecks, startBillingScheduler };
