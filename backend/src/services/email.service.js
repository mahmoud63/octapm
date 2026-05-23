// Stub email service. Logs instead of sending. Swap the body of `sendEmail`
// for a real provider (SendGrid / SES) later — the interface stays the same.
async function sendEmail({ to, subject, body }) {
  console.log(`[email] → ${to} | ${subject}\n${body}\n`);
  return { delivered: true, to, subject };
}

const templates = {
  trialEndingIn2Days: (orgName) => ({
    subject: 'Your trial ends in 2 days',
    body: `Hi ${orgName}, your PM Copilots free trial ends in 2 days. Add a plan to keep your projects active.`,
  }),
  trialEndsTomorrow: (orgName) => ({
    subject: 'Your trial ends tomorrow',
    body: `Hi ${orgName}, your PM Copilots free trial ends tomorrow. Subscribe now to avoid losing access.`,
  }),
  subscriptionCanceled: (orgName, planName, endDate) => ({
    subject: 'Your subscription has been canceled',
    body: `Hi ${orgName}, your ${planName} subscription is canceled and will stay active until ${endDate}. Your project data is retained for 90 days.`,
  }),
  invoicePaid: (orgName, description, amount) => ({
    subject: 'Payment receipt',
    body: `Hi ${orgName}, we received your payment of $${amount} for ${description}. Thank you.`,
  }),
};

module.exports = { sendEmail, templates };
