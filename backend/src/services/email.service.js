const { HttpError } = require("../utils/http-error");

const getEmailProviderUrl = () =>
  process.env.EMAIL_WEBHOOK_URL || process.env.NOTIFICATION_EMAIL_WEBHOOK_URL;

const buildProviderHeaders = () => {
  const headers = { "content-type": "application/json" };
  const token =
    process.env.EMAIL_WEBHOOK_TOKEN ||
    process.env.NOTIFICATION_EMAIL_WEBHOOK_TOKEN;

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  return headers;
};

async function sendViaWebhook({ to, subject, body, html, metadata }) {
  const response = await fetch(getEmailProviderUrl(), {
    method: "POST",
    headers: buildProviderHeaders(),
    body: JSON.stringify({
      to,
      subject,
      text: body,
      html: html || null,
      metadata: metadata || {},
    }),
  });

  if (!response.ok) {
    throw new HttpError(
      502,
      "EMAIL_DELIVERY_FAILED",
      "Email delivery provider rejected the message",
      { status: response.status },
    );
  }

  return { delivered: true, provider: "webhook", to, subject };
}

async function sendEmail({ to, subject, body, html, metadata = {} }) {
  if (!to || !subject || !body) {
    throw new HttpError(
      400,
      "EMAIL_MESSAGE_INVALID",
      "Email delivery requires a recipient, subject, and body",
    );
  }

  if (getEmailProviderUrl()) {
    return sendViaWebhook({ to, subject, body, html, metadata });
  }

  if (process.env.NODE_ENV === "production") {
    throw new HttpError(
      500,
      "CONFIG_ERROR",
      "Production email delivery provider is not configured",
    );
  }

  // Local/test fallback keeps development usable while production fails closed.
  console.log(`[email:local] -> ${to} | ${subject}\n${body}\n`);
  return { delivered: true, provider: "local-log", to, subject };
}

const formatExpiry = (expiresAt) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(expiresAt));

const templates = {
  passwordReset: ({ name, resetUrl, expiresAt }) => ({
    subject: "Reset your Octa PM password",
    body: [
      `Hi ${name || "there"},`,
      "",
      "We received a request to reset your Octa PM password.",
      `Use this one-time link before ${formatExpiry(expiresAt)} UTC:`,
      resetUrl,
      "",
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
  }),
  invitation: ({
    orgName,
    inviterName,
    acceptUrl,
    role,
    projectName,
    note,
    expiresAt,
  }) => ({
    subject: `You're invited to ${orgName} on Octa PM`,
    body: [
      `Hi there,`,
      "",
      `${inviterName || "An administrator"} invited you to join ${orgName} as ${role}.`,
      projectName ? `Project access: ${projectName}.` : null,
      note ? `Message: ${note}` : null,
      `Accept this invitation before ${formatExpiry(expiresAt)} UTC:`,
      acceptUrl,
      "",
      "If you were not expecting this invitation, you can ignore this email.",
    ]
      .filter(Boolean)
      .join("\n"),
  }),
  trialEndingIn2Days: (orgName) => ({
    subject: "Your trial ends in 2 days",
    body: `Hi ${orgName}, your PM Copilots free trial ends in 2 days. Add a plan to keep your projects active.`,
  }),
  trialEndsTomorrow: (orgName) => ({
    subject: "Your trial ends tomorrow",
    body: `Hi ${orgName}, your PM Copilots free trial ends tomorrow. Subscribe now to avoid losing access.`,
  }),
  subscriptionCanceled: (orgName, planName, endDate) => ({
    subject: "Your subscription has been canceled",
    body: `Hi ${orgName}, your ${planName} subscription is canceled and will stay active until ${endDate}. Your project data is retained for 90 days.`,
  }),
  invoicePaid: (orgName, description, amount) => ({
    subject: "Payment receipt",
    body: `Hi ${orgName}, we received your payment of $${amount} for ${description}. Thank you.`,
  }),
};

module.exports = { sendEmail, templates };
