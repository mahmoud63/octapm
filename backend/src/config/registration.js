/**
 * Whether anyone may create a new organisation through POST /auth/register.
 *
 * Open everywhere except production, so local development, the tests and the
 * QA/UAT harnesses behave exactly as they always have with nothing to set. In
 * production (staging included — it runs NODE_ENV=production) registration is
 * closed: the first administrator is created with `npm run admin:bootstrap`
 * and everyone after that joins by invitation. PUBLIC_REGISTRATION=true opens
 * it deliberately (a self-serve sign-up funnel); PUBLIC_REGISTRATION=false
 * closes it anywhere.
 *
 * Read on every request rather than once at start-up, so the answer can never
 * disagree with what the environment says now.
 */

const isPublicRegistrationOpen = (env = process.env) => {
  const setting = String(env.PUBLIC_REGISTRATION ?? "").trim().toLowerCase();
  if (setting === "true" || setting === "1") return true;
  if (setting === "false" || setting === "0") return false;
  return env.NODE_ENV !== "production";
};

/** What the web app is told, unauthenticated: only whether sign-up is open. */
const getPublicConfig = (env = process.env) => ({
  registration: isPublicRegistrationOpen(env) ? "open" : "closed",
});

module.exports = { getPublicConfig, isPublicRegistrationOpen };
