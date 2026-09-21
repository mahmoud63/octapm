/**
 * Which transport sends email: `ses`, `webhook` or `log`.
 *
 * One answer, read by both the sender (email.service) and the production
 * boot check (security.js), so the check can never approve a configuration
 * the sender would then refuse.
 *
 * An explicit EMAIL_PROVIDER wins. Left unset, it is `webhook` when a webhook
 * URL is configured and `log` otherwise — exactly what development and the
 * tests did before this existed, with no new variable to set.
 */

const PROVIDERS = Object.freeze(["ses", "webhook", "log"]);

const trimOrNull = (value) => {
  const text = String(value ?? "").trim();
  return text || null;
};

const emailWebhookUrl = (env = process.env) =>
  trimOrNull(env.EMAIL_WEBHOOK_URL) || trimOrNull(env.NOTIFICATION_EMAIL_WEBHOOK_URL);

/**
 * @returns {{ provider: string|null, explicit: boolean, invalid: string|null }}
 *   `provider` is null only when EMAIL_PROVIDER names something unknown, in
 *   which case `invalid` holds what was given.
 */
const resolveEmailProvider = (env = process.env) => {
  const requested = trimOrNull(env.EMAIL_PROVIDER);
  if (requested) {
    const provider = requested.toLowerCase();
    return PROVIDERS.includes(provider)
      ? { provider, explicit: true, invalid: null }
      : { provider: null, explicit: true, invalid: requested };
  }
  return { provider: emailWebhookUrl(env) ? "webhook" : "log", explicit: false, invalid: null };
};

module.exports = { PROVIDERS, emailWebhookUrl, resolveEmailProvider };
