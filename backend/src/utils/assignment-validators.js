const { body } = require("express-validator");

/**
 * Request validators for the accountability references added by
 * OCTA-DATA-REFS-004. Append to any create/update validator array.
 */
const assignmentReferenceValidators = () => [
  body("ownerUserId").optional({ nullable: true }).isUUID(),
  body("reviewerUserId").optional({ nullable: true }).isUUID(),
  body("approverUserId").optional({ nullable: true }).isUUID(),
  body("assigneeUserId").optional({ nullable: true }).isUUID(),
  body("assigneeCompanyId").optional({ nullable: true }).isUUID(),
  body("ballInCourtUserId").optional({ nullable: true }).isUUID(),
];

module.exports = { assignmentReferenceValidators };
