const { prisma } = require('../config/db');
const { sendEmail, templates } = require('../services/email.service');

const DAY = 24 * 60 * 60 * 1000;

/**
 * A trial reminder is claimed before it is sent: the flag is set only where
 * it is still empty, so if two processes run the checks at once (a leader
 * hand-over, or a run started by hand) only the one that set it sends. When
 * the send fails the flag is cleared again, so the next run retries it, and
 * the failure is logged rather than thrown: one organisation's bad address
 * must not stop the reminders, expiries and cancellations after it.
 */
async function sendReminderOnce({ sub, field, template, now }) {
  const claim = await prisma.subscription.updateMany({
    where: { id: sub.id, [field]: null },
    data: { [field]: now },
  });
  if (claim.count === 0) return false;

  try {
    await sendEmail({ to: await pmEmail(sub.orgId), ...template });
    return true;
  } catch (error) {
    console.error(
      `[billing-scheduler] ${field} reminder for org ${sub.orgId} failed; it will be retried on the next run`,
      error?.message || error,
    );
    await prisma.subscription
      .updateMany({ where: { id: sub.id, [field]: now }, data: { [field]: null } })
      .catch((revertError) => console.error('[billing-scheduler] could not re-open the reminder', revertError?.message || revertError));
    return false;
  }
}

/**
 * `orgIds` narrows the run to some organisations; the scheduler never passes
 * it (it checks every subscription), and a test uses it to keep to its own.
 */
async function runBillingChecks(now = new Date(), { orgIds = null } = {}) {
  const scope = Array.isArray(orgIds) ? { orgId: { in: orgIds } } : {};
  const trials = await prisma.subscription.findMany({
    where: { ...scope, status: 'trialing', trialEndsAt: { not: null } },
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
      await sendReminderOnce({
        sub,
        field: 'reminderDay5SentAt',
        template: templates.trialEndingIn2Days(sub.org?.name ?? 'there'),
        now,
      });
    }
    if (msLeft <= 1 * DAY && !sub.reminderDay7SentAt) {
      await sendReminderOnce({
        sub,
        field: 'reminderDay7SentAt',
        template: templates.trialEndsTomorrow(sub.org?.name ?? 'there'),
        now,
      });
    }
  }

  await prisma.subscription.updateMany({
    where: { ...scope, status: 'canceled', currentPeriodEnd: { lt: now } },
    data: { status: 'expired' },
  });
}

async function pmEmail(orgId) {
  const u = await prisma.user.findFirst({
    where: { orgId, role: 'pm' }, orderBy: { createdAt: 'asc' },
  });
  return u?.email ?? 'unknown@pmcopilots.local';
}

let timer = null;

function startBillingScheduler() {
  if (timer) return timer;
  if (String(process.env.BILLING_SCHEDULER_ENABLED ?? 'true').toLowerCase() === 'false') {
    console.log('[billing-scheduler] disabled by BILLING_SCHEDULER_ENABLED=false');
    return null;
  }
  runBillingChecks().catch((e) => console.error('[billing-scheduler]', e));
  timer = setInterval(() => {
    runBillingChecks().catch((e) => console.error('[billing-scheduler]', e));
  }, DAY);
  // Like every other scheduler, the daily timer must not hold a finished process open.
  timer.unref?.();
  return timer;
}

function stopBillingScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { runBillingChecks, sendReminderOnce, startBillingScheduler, stopBillingScheduler };
