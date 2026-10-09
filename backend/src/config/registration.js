/**
 * Whether anyone may create a new organisation through POST /auth/register.
 *
 * Self-service sign-up proves nothing about the mailbox, so anyone could
 * register somebody else's address with a password of their choosing. Until
 * sign-up verifies the mailbox first (D-REG-1), it is closed in production
 * whatever the environment says (owner decision D-ID-1 Q8): the first
 * administrator is created with `npm run admin:bootstrap` and everyone after
 * that joins by invitation. The production preflight refuses to start with
 * PUBLIC_REGISTRATION=true, so the setting cannot silently appear to work.
 *
 * It is open only where NODE_ENV says development or test (local development,
 * the tests and the QA/UAT harnesses, as always); any other value —
 * `staging`, a typo, nothing at all on a deployed host — is closed, and
 * PUBLIC_REGISTRATION cannot open it there (lead L103). PUBLIC_REGISTRATION=false
 * closes it in development and test too.
 *
 * Read on every request rather than once at start-up, so the answer can never
 * disagree with what the environment says now.
 */

const OPEN_BY_DEFAULT = new Set(["development", "test"]);

const isPublicRegistrationOpen = (env = process.env) => {
  // Only development and test may ever open it; anything else — production,
  // staging, a typo, nothing at all — is closed whatever PUBLIC_REGISTRATION says.
  if (!OPEN_BY_DEFAULT.has(String(env.NODE_ENV ?? "").trim().toLowerCase())) return false;
  const setting = String(env.PUBLIC_REGISTRATION ?? "").trim().toLowerCase();
  return !(setting === "false" || setting === "0");
};

/** Whether the environment asks for something production refuses (the preflight's check). */
const registrationMisconfigured = (env = process.env) => {
  if (env.NODE_ENV !== "production") return null;
  const setting = String(env.PUBLIC_REGISTRATION ?? "").trim().toLowerCase();
  if (setting === "true" || setting === "1") {
    return "PUBLIC_REGISTRATION=true is refused in production until sign-up verifies the mailbox (D-REG-1)";
  }
  return null;
};

/** What the web app is told, unauthenticated: only whether sign-up is open. */
const getPublicConfig = (env = process.env) => ({
  registration: isPublicRegistrationOpen(env) ? "open" : "closed",
});

module.exports = { getPublicConfig, isPublicRegistrationOpen, registrationMisconfigured };
