const { body } = require("express-validator");
const { isCurrencyCode, isTimeZoneName } = require("../services/organisation.service");

/**
 * The optional project defaults a new workspace may name (ENT-6, acceptance
 * §16): an ISO 4217 currency and an IANA time zone. POST /organisations and
 * sign-up accept the same pair, so both doors check it the same way; the
 * service checks again (organisation.service workspaceDefaults) for the
 * callers that are not routes.
 */
const workspaceDefaultValidators = [
  body("currency")
    .optional({ values: "falsy" })
    .custom((value) => isCurrencyCode(value))
    .withMessage("currency must be an ISO 4217 code such as USD")
    .customSanitizer((value) => String(value).trim().toUpperCase()),
  body("timezone")
    .optional({ values: "falsy" })
    .custom((value) => isTimeZoneName(value))
    .withMessage("timezone must be an IANA time zone such as Asia/Dubai")
    .customSanitizer((value) => String(value).trim()),
];

module.exports = { workspaceDefaultValidators };
