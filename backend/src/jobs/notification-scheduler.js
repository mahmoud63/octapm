const notificationService = require("../services/notification.service");

const HOUR_MS = 60 * 60 * 1000;

async function runNotificationChecks(now = new Date()) {
  const delivery = await notificationService.processPendingEmailDeliveries({
    now,
    limit: 100,
  });
  const push = await require("../services/push.service")
    .processPendingPushDeliveries({ now, limit: 200 })
    .catch((error) => {
      console.error("[push-scheduler]", error);
      return null;
    });
  return { delivery, push };
}

async function runDailyDueScan(now = new Date()) {
  const orgs = await require("../config/db").prisma.organisation.findMany({
    select: { id: true },
  });

  let created = 0;
  for (const org of orgs) {
    const result = await notificationService.runDueNotificationScan({
      orgId: org.id,
      now,
      horizonDays: 3,
    });
    created += result.created;
  }
  return { orgs: orgs.length, created };
}

function startNotificationScheduler() {
  runNotificationChecks().catch((error) =>
    console.error("[notification-scheduler]", error),
  );
  runDailyDueScan().catch((error) =>
    console.error("[notification-due-scan]", error),
  );

  const deliveryTimer = setInterval(() => {
    runNotificationChecks().catch((error) =>
      console.error("[notification-scheduler]", error),
    );
  }, HOUR_MS);

  const dueTimer = setInterval(() => {
    runDailyDueScan().catch((error) =>
      console.error("[notification-due-scan]", error),
    );
  }, 24 * HOUR_MS);

  deliveryTimer.unref?.();
  dueTimer.unref?.();
}

module.exports = {
  runDailyDueScan,
  runNotificationChecks,
  startNotificationScheduler,
};
