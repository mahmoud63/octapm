const { body } = require("express-validator");

/**
 * Request validators for the accountability references added by
 * OCTA-DATA-REFS-004. Append to any create/update validator array.
 */
const assignmentReferenceValidators = () => [
  body("ownerUserId").optional({ nullable: true }).isString().isUUID(),
  body("reviewerUserId").optional({ nullable: true }).isString().isUUID(),
  body("approverUserId").optional({ nullable: true }).isString().isUUID(),
  body("assigneeUserId").optional({ nullable: true }).isString().isUUID(),
  body("assigneeCompanyId").optional({ nullable: true }).isString().isUUID(),
  body("ballInCourtUserId").optional({ nullable: true }).isString().isUUID(),
];

module.exports = { assignmentReferenceValidators };
