const { HttpError } = require("../utils/http-error");
const { resolveEmailProvider } = require("../config/email-provider");
const { getAwsCredentials } = require("../utils/aws-credentials");
const { sha256Hex, signHeaders } = require("../utils/aws-sigv4");

// A provider that never answers must not hold a request (or the delivery
// loop) open: ten seconds, then the send counts as failed and is retried.
const EMAIL_SEND_TIMEOUT_MS = 10_000;
const SES_SEND_PATH = "/v2/email/outbound-emails";

const getEmailProviderUrl = () =>
  process.env.EMAIL_WEBHOOK_URL || process.env.NOTIFICATION_EMAIL_WEBHOOK_URL;

const configError = (message) => new HttpError(500, "CONFIG_ERROR", message);

const deliveryFailed = (details) =>
  new HttpError(
    502,
    "EMAIL_DELIVERY_FAILED",
    "Email delivery provider rejected the message",
    details,
  );

/**
 * The SES v2 SendEmail body. Metadata is not sent: SES message tags only
 * accept [A-Za-z0-9_-], and nothing downstream reads them.
 */
const buildSesMessage = ({ to, subject, body, html, replyTo }) => {
  const content = {
    Subject: { Data: subject, Charset: "UTF-8" },
    Body: { Text: { Data: body, Charset: "UTF-8" } },
  };
  if (html) content.Body.Html = { Data: html, Charset: "UTF-8" };
  const message = {
    FromEmailAddress: process.env.EMAIL_FROM.trim(),
    Destination: { ToAddresses: [].concat(to) },
    Content: { Simple: content },
  };
  if (replyTo) message.ReplyToAddresses = [].concat(replyTo);
  const configurationSet = String(process.env.SES_CONFIGURATION_SET || "").trim();
  if (configurationSet) message.ConfigurationSetName = configurationSet;
  return message;
};

/** AWS names the failure in x-amzn-ErrorType ("MessageRejected:http://…"). */
const awsErrorType = async (response) => {
  const header = response.headers.get("x-amzn-errortype");
  if (header) return header.split(":")[0];
  try {
    const payload = await response.json();
    return payload?.__type || payload?.code || payload?.Code || null;
  } catch {
    return null;
  }
};

/**
 * Amazon SES v2 SendEmail, signed with the task role's credentials. The body
 * is signed (SES refuses UNSIGNED-PAYLOAD), and SES_ENDPOINT exists only so a
 * test can stand a fake SES on 127.0.0.1 — production refuses it.
 */
async function sendViaSes({ to, subject, body, html, replyTo }) {
  const region =
    String(process.env.SES_REGION || "").trim() ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION;
  if (!region) {
    throw configError("SES_REGION (or AWS_REGION) is required for EMAIL_PROVIDER=ses");
  }
  if (!String(process.env.EMAIL_FROM || "").trim()) {
    throw configError("EMAIL_FROM is required for EMAIL_PROVIDER=ses");
  }

  const endpoint = new URL(
    String(process.env.SES_ENDPOINT || "").trim() || `https://email.${region}.amazonaws.com`,
  );
  const payload = JSON.stringify(buildSesMessage({ to, subject, body, html, replyTo }));

  let credentials;
  try {
    credentials = await getAwsCredentials();
  } catch (error) {
    console.error(`[email:ses] no AWS credentials: ${error.message}`);
    throw deliveryFailed({ status: null, awsError: "CredentialsUnavailable" });
  }

  // Host is signed as fetch will send it (the URL's host, port included).
  const { host, ...headers } = signHeaders({
    method: "POST",
    host: endpoint.host,
    path: SES_SEND_PATH,
    headers: { "content-type": "application/json" },
    payloadHash: sha256Hex(payload),
    service: "ses",
    region,
    credentials,
  });

  let response;
  try {
    response = await fetch(`${endpoint.origin}${SES_SEND_PATH}`, {
      method: "POST",
      headers,
      body: payload,
      signal: AbortSignal.timeout(EMAIL_SEND_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    console.error(`[email:ses] request failed: ${error?.message || error}`);
    throw deliveryFailed({ status: null, awsError: timedOut ? "Timeout" : "NetworkError" });
  }

  if (!response.ok) {
    const awsError = await awsErrorType(response);
    console.error(`[email:ses] SendEmail answered ${response.status} ${awsError || ""}`.trim());
    throw deliveryFailed({ status: response.status, awsError });
  }

  let messageId = null;
  try {
    messageId = (await response.json())?.MessageId || null;
  } catch {
    // Delivered is delivered; a body we cannot read only loses the id.
  }
  return { delivered: true, provider: "ses", messageId, to, subject };
}

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

async function sendViaWebhook({ to, subject, body, html, metadata, replyTo }) {
  const response = await fetch(getEmailProviderUrl(), {
    method: "POST",
    headers: buildProviderHeaders(),
    body: JSON.stringify({
      to,
      subject,
      text: body,
      html: html || null,
      ...(replyTo ? { replyTo } : {}),
      metadata: metadata || {},
    }),
    signal: AbortSignal.timeout(EMAIL_SEND_TIMEOUT_MS),
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

/** `replyTo` (optional) lets a reply land back in OctaPM — see inbound-email.service. */
async function sendEmail({ to, subject, body, html, metadata = {}, replyTo = null }) {
  if (!to || !subject || !body) {
    throw new HttpError(
      400,
      "EMAIL_MESSAGE_INVALID",
      "Email delivery requires a recipient, subject, and body",
    );
  }

  // One answer shared with the production boot check (config/email-provider).
  // Nothing set is `log` locally, or `webhook` when a webhook URL is — as before.
  const { provider, invalid } = resolveEmailProvider(process.env);
  if (invalid) {
    throw configError(`EMAIL_PROVIDER "${invalid}" is not one of ses, webhook, log`);
  }

  if (provider === "ses") {
    return sendViaSes({ to, subject, body, html, replyTo });
  }

  if (provider === "webhook") {
    if (!getEmailProviderUrl()) {
      throw configError("EMAIL_PROVIDER=webhook needs EMAIL_WEBHOOK_URL");
    }
    return sendViaWebhook({ to, subject, body, html, metadata, replyTo });
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
