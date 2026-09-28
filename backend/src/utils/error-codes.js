const ERROR_CODE_CATALOG = Object.freeze({
  VALIDATION_ERROR: {
    status: 400,
    category: "validation",
    message: "Request validation failed",
  },
  AUTH_REQUIRED: {
    status: 401,
    category: "auth",
    message: "Authentication is required",
  },
  INVALID_TOKEN: {
    status: 401,
    category: "auth",
    message: "Access token is invalid",
  },
  PASSWORD_RESET_TOKEN_INVALID: {
    status: 400,
    category: "auth",
    message: "Password reset token is invalid, expired, or already used",
  },
  INVITATION_TOKEN_INVALID: {
    status: 400,
    category: "auth",
    message: "Invitation token is invalid, expired, or already used",
  },
  ALREADY_MEMBER: {
    status: 409,
    category: "auth",
    message: "This person is already a member of the workspace",
  },
  LAST_OWNER: {
    status: 409,
    category: "auth",
    message: "This workspace needs at least one active owner",
  },
  SELF_ELEVATION_FORBIDDEN: {
    status: 403,
    category: "auth",
    message: "You cannot change your own role or standing",
  },
  OWNER_REQUIRED: {
    status: 403,
    category: "auth",
    message: "Only a workspace owner can grant or revoke ownership or administration",
  },
  GUEST_FORBIDDEN: {
    status: 403,
    category: "auth",
    message: "Guests of this workspace cannot reach company-wide features",
  },
  WORKSPACE_REQUIRED: {
    status: 401,
    category: "auth",
    message: "Choose a workspace before using this token",
  },
  WORKSPACE_NOT_FOUND: {
    status: 404,
    category: "auth",
    message: "You are not a member of this workspace",
  },
  SSO_IDENTITY_CONFLICT: {
    status: 403,
    category: "auth",
    message: "This sign-in belongs to a different account",
  },
  INVITATION_PASSWORD_REQUIRED: {
    status: 400,
    category: "auth",
    message: "A password is required to accept this invitation",
  },
  INVITATION_SIGN_IN_REQUIRED: {
    status: 401,
    category: "auth",
    message: "Sign in as the invited account, or enter its password, to accept this invitation",
  },
  TOKEN_EXPIRED: {
    status: 401,
    category: "auth",
    message: "Access token has expired",
  },
  SUBSCRIPTION_REQUIRED: {
    status: 402,
    category: "billing",
    message: "Subscription access is required",
  },
  FORBIDDEN: {
    status: 403,
    category: "authz",
    message: "Permission denied",
  },
  PROJECT_ACCESS_DENIED: {
    status: 403,
    category: "authz",
    message: "Project access is denied",
  },
  ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED: {
    status: 403,
    category: "authz",
    message:
      "Progress can only be submitted by assigned activity users or PM/planning overrides",
  },
  NOT_FOUND: {
    status: 404,
    category: "routing",
    message: "Resource was not found",
  },
  PROJECT_NOT_FOUND: {
    status: 404,
    category: "project",
    message: "Project not found",
  },
  PROJECT_ARCHIVED: {
    status: 409,
    category: "project",
    message: "Archived projects cannot be updated",
  },
  PROJECT_ARCHIVE_ACTION_REQUIRED: {
    status: 400,
    category: "project",
    message: "Use the archive endpoint to archive a project",
  },
  ORG_NOT_FOUND: {
    status: 404,
    category: "org",
    message: "Organization not found",
  },
  CONFLICT: {
    status: 409,
    category: "conflict",
    message: "Request conflicts with current state",
  },
  UNPROCESSABLE_ENTITY: {
    status: 422,
    category: "validation",
    message: "Payload is semantically invalid",
  },
  RATE_LIMIT_EXCEEDED: {
    status: 429,
    category: "abuse_protection",
    message: "Rate limit exceeded",
  },
  LOGIN_BACKOFF: {
    status: 429,
    category: "abuse_protection",
    message: "Too many failed login attempts",
  },
  ACCOUNT_LOCKED: {
    status: 429,
    category: "abuse_protection",
    message: "Account is temporarily locked",
  },
  INTERNAL_ERROR: {
    status: 500,
    category: "system",
    message: "Unexpected server error",
  },
  CONFIG_ERROR: {
    status: 500,
    category: "system",
    message: "Server configuration error",
  },
  DUPLICATE_BOQ_ITEM_CODE: {
    status: 400,
    category: "boq",
    message: "BOQ item code already exists for this project",
  },
  DUPLICATE_ACTIVE_ALLOCATION: {
    status: 400,
    category: "boq",
    message:
      "An active allocation already exists for this BOQ item and activity",
  },
  EMAIL_MESSAGE_INVALID: {
    status: 400,
    category: "notification",
    message: "Email message payload is invalid",
  },
  EMAIL_DELIVERY_FAILED: {
    status: 502,
    category: "notification",
    message: "Email delivery failed",
  },
  NOTIFICATION_NOT_FOUND: {
    status: 404,
    category: "notification",
    message: "Notification not found",
  },
  NOTIFICATION_PREFERENCE_INVALID: {
    status: 400,
    category: "notification",
    message: "Notification preference is invalid",
  },
  ALLOCATION_AMOUNT_EXCEEDED: {
    status: 400,
    category: "boq",
    message: "Allocation totals cannot exceed the BOQ item amount",
  },
  ALLOCATION_QUANTITY_EXCEEDED: {
    status: 400,
    category: "boq",
    message: "Allocation totals cannot exceed the BOQ item quantity",
  },
  IPC_ALLOCATION_NOT_APPROVED: {
    status: 409,
    category: "ipc",
    message: "IPC certification can only use approved active BOQ allocations",
  },
  IPC_PM_OVERRIDE_REASON_REQUIRED: {
    status: 400,
    category: "ipc",
    message:
      "A PM override reason is required for over-limit IPC certification",
  },
  IPC_PM_OVERRIDE_REQUIRED: {
    status: 403,
    category: "ipc",
    message: "Only a Project Manager can override over-limit IPC certification",
  },
  EOT_WORKFLOW_ACTION_REQUIRED: {
    status: 400,
    category: "commercial",
    message: "EOT status changes must use workflow endpoints",
  },
  CHANGE_ORDER_WORKFLOW_ACTION_REQUIRED: {
    status: 400,
    category: "commercial",
    message: "Change order status changes must use workflow endpoints",
  },
  CHANGE_ORDER_IMPACT_SUMMARY_REQUIRED: {
    status: 400,
    category: "commercial",
    message:
      "Schedule and cost impact summaries are required before change order approval",
  },
  CHANGE_ORDER_APPROVED_LOCKED: {
    status: 409,
    category: "commercial",
    message: "Approved change order impacts are locked",
  },
  CHANGE_ORDER_ARCHIVED: {
    status: 409,
    category: "commercial",
    message: "Archived change orders cannot be updated",
  },
  NCR_WORKFLOW_ACTION_REQUIRED: {
    status: 400,
    category: "quality",
    message: "NCR closeout status changes must use workflow endpoints",
  },
  NCR_CLOSEOUT_REQUIRED_FIELDS: {
    status: 400,
    category: "quality",
    message:
      "NCR closeout requires a responsible party, due date, and closure comment",
  },
  NCR_CLOSEOUT_EVIDENCE_REQUIRED: {
    status: 400,
    category: "quality",
    message: "NCR closeout requires at least one evidence attachment",
  },
  NCR_NOT_READY_FOR_CLOSEOUT: {
    status: 409,
    category: "quality",
    message: "NCR is not ready for closeout submission",
  },
  NCR_NOT_READY_FOR_APPROVAL: {
    status: 409,
    category: "quality",
    message: "NCR closeout is not ready for approval",
  },
  NCR_NOT_READY_FOR_REJECTION: {
    status: 409,
    category: "quality",
    message: "NCR closeout is not ready for rejection",
  },
  NCR_REOPEN_REASON_REQUIRED: {
    status: 400,
    category: "quality",
    message: "A reason is required to reopen an NCR",
  },
  NCR_NOT_READY_FOR_REOPEN: {
    status: 409,
    category: "quality",
    message: "NCR is not ready to reopen",
  },
  SAFETY_WORKFLOW_ACTION_REQUIRED: {
    status: 400,
    category: "safety",
    message: "Safety closeout status changes must use workflow endpoints",
  },
  SAFETY_CLOSEOUT_REQUIRED_FIELDS: {
    status: 400,
    category: "safety",
    message:
      "Safety closeout requires a responsible party, due date, and closure comment",
  },
  SAFETY_CLOSEOUT_EVIDENCE_REQUIRED: {
    status: 400,
    category: "safety",
    message: "Safety closeout requires at least one evidence attachment",
  },
  SAFETY_INCIDENT_NOT_FOUND: {
    status: 404,
    category: "safety",
    message: "Safety incident not found",
  },
  SAFETY_INCIDENT_ARCHIVED: {
    status: 409,
    category: "safety",
    message: "Archived safety incidents cannot be updated",
  },
  SAFETY_NOT_READY_FOR_CLOSEOUT: {
    status: 409,
    category: "safety",
    message: "Safety incident is not ready for closeout submission",
  },
  SAFETY_INCIDENT_NOT_READY_FOR_APPROVAL: {
    status: 409,
    category: "safety",
    message: "Safety closeout is not ready for approval",
  },
  SAFETY_NOT_READY_FOR_REJECTION: {
    status: 409,
    category: "safety",
    message: "Safety closeout is not ready for rejection",
  },
  SAFETY_REOPEN_REASON_REQUIRED: {
    status: 400,
    category: "safety",
    message: "A reason is required to reopen a safety incident",
  },
  SAFETY_NOT_READY_FOR_REOPEN: {
    status: 409,
    category: "safety",
    message: "Safety incident is not ready to reopen",
  },
  RFI_ARCHIVED: {
    status: 409,
    category: "document_control",
    message: "Archived RFIs cannot be updated",
  },
  RFI_ARCHIVE_ACTION_REQUIRED: {
    status: 400,
    category: "document_control",
    message: "Use the archive endpoint to archive an RFI",
  },
  SUBMITTAL_ARCHIVED: {
    status: 409,
    category: "document_control",
    message: "Archived submittals cannot be updated",
  },
  SUBMITTAL_ARCHIVE_ACTION_REQUIRED: {
    status: 400,
    category: "document_control",
    message: "Use the archive endpoint to archive a submittal",
  },
  RISK_ARCHIVED: {
    status: 409,
    category: "risk",
    message: "Archived risks cannot be updated",
  },
  DAILY_REPORT_LINK_INVALID: {
    status: 400,
    category: "procurement",
    message: "Daily report link is invalid for this project activity",
  },
  EQUIPMENT_USAGE_LINK_INVALID: {
    status: 400,
    category: "equipment",
    message: "Daily report equipment usage must reference project equipment",
  },
  PROCUREMENT_ALERT_WORKFLOW_ENDPOINT_REQUIRED: {
    status: 400,
    category: "procurement",
    message: "Procurement alert status changes must use workflow endpoints",
  },
  PROCUREMENT_ALERT_ALREADY_RESOLVED: {
    status: 409,
    category: "procurement",
    message: "Procurement alert is already resolved",
  },
  // Running on AWS: several API tasks, a worker, S3 through task roles.
  PAYLOAD_TOO_LARGE: {
    status: 413,
    category: "validation",
    message: "The request is too large",
  },
  FILE_TOO_LARGE: {
    status: 413,
    category: "validation",
    message: "The file is too large",
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    category: "system",
    message: "The service is temporarily unavailable",
  },
  SERVICE_NOT_READY: {
    status: 503,
    category: "system",
    message: "The service is not ready to take requests",
  },
  FILE_STORAGE_UNAVAILABLE: {
    status: 503,
    category: "system",
    message: "File storage is temporarily unavailable",
  },
  AWS_CREDENTIALS_UNAVAILABLE: {
    status: 503,
    category: "system",
    message: "Cloud credentials are temporarily unavailable",
  },
  REGISTRATION_CLOSED: {
    status: 403,
    category: "auth",
    message: "New organisations are created by invitation only",
  },
  BOOTSTRAP_NOT_EMPTY: {
    status: 409,
    category: "system",
    message: "The first administrator can only be created in an empty database",
  },
  // Deliberate 5xx answers. In production a 5xx body carries the catalogue
  // message, never the thrower's text, so these say what happened without
  // naming hosts, keys or configuration.
  AI_NOT_CONFIGURED: {
    status: 503,
    category: "system",
    message: "AI features are not configured on this server",
  },
  AI_UNAVAILABLE: {
    status: 503,
    category: "system",
    message: "The AI provider did not answer. Try again shortly.",
  },
  AI_TRANSCRIPTION_NOT_CONFIGURED: {
    status: 503,
    category: "system",
    message: "Voice transcription is not configured on this server",
  },
  AI_TRANSCRIPTION_FAILED: {
    status: 503,
    category: "system",
    message: "Transcription failed. Try again shortly.",
  },
  ASSISTANT_UNAVAILABLE: {
    status: 503,
    category: "system",
    message: "The assistant is unavailable right now",
  },
  PUSH_NOT_CONFIGURED: {
    status: 503,
    category: "system",
    message: "Push notifications are not configured on this server",
  },
  INBOUND_EMAIL_NOT_CONFIGURED: {
    status: 503,
    category: "system",
    message: "Replying by email is not configured on this server",
  },
  WEATHER_FEED_UNAVAILABLE: {
    status: 502,
    category: "system",
    message: "The weather service could not be reached",
  },
  WEATHER_FEED_NO_DATA: {
    status: 502,
    category: "system",
    message: "The weather service returned no data for this site and day",
  },
  SSO_DISCOVERY_FAILED: {
    status: 502,
    category: "system",
    message: "The identity provider could not be reached",
  },
  SSO_DISCOVERY_INVALID: {
    status: 502,
    category: "system",
    message: "The identity provider's configuration could not be read",
  },
  SSO_JWKS_FAILED: {
    status: 502,
    category: "system",
    message: "The identity provider's signing keys could not be read",
  },
  // Project-controls structure (PC-1): WBS nodes and units of measure.
  WBS_NODE_NOT_FOUND: {
    status: 404,
    category: "not_found",
    message: "WBS node not found",
  },
  WBS_NODE_CODE_REQUIRED: {
    status: 400,
    category: "validation",
    message: "WBS code is required",
  },
  WBS_NODE_CODE_TOO_LONG: {
    status: 400,
    category: "validation",
    message: "WBS code must be 60 characters or fewer",
  },
  WBS_NODE_NAME_REQUIRED: {
    status: 400,
    category: "validation",
    message: "WBS node name is required",
  },
  WBS_NODE_NAME_TOO_LONG: {
    status: 400,
    category: "validation",
    message: "WBS node name must be 160 characters or fewer",
  },
  WBS_NODE_DUPLICATE_CODE: {
    status: 409,
    category: "conflict",
    message: "A WBS node with this code already exists in this project",
  },
  WBS_NODE_PARENT_INVALID: {
    status: 400,
    category: "validation",
    message: "Parent WBS node does not belong to this project",
  },
  WBS_NODE_PARENT_ARCHIVED: {
    status: 409,
    category: "conflict",
    message: "The parent WBS node is archived",
  },
  WBS_NODE_INVALID_PARENT: {
    status: 400,
    category: "validation",
    message: "A WBS node cannot be moved under itself or one of its descendants",
  },
  WBS_NODE_DEPTH_EXCEEDED: {
    status: 400,
    category: "validation",
    message: "The WBS tree depth limit would be exceeded",
  },
  WBS_NODE_ARCHIVED: {
    status: 409,
    category: "conflict",
    message: "Archived WBS nodes must be restored before they can be edited",
  },
  WBS_PACKAGE_OWNER_INVALID: {
    status: 400,
    category: "validation",
    message: "Owner party does not belong to this project",
  },
  WBS_PACKAGE_COMMITMENT_INVALID: {
    status: 400,
    category: "validation",
    message: "Commitment does not belong to this project",
  },
  UNIT_CODE_REQUIRED: {
    status: 400,
    category: "validation",
    message: "Unit code is required",
  },
  UNIT_CODE_TOO_LONG: {
    status: 400,
    category: "validation",
    message: "Unit code must be 16 characters or fewer",
  },
  UNIT_NAME_TOO_LONG: {
    status: 400,
    category: "validation",
    message: "Unit name must be 80 characters or fewer",
  },
  UNIT_DIMENSION_INVALID: {
    status: 400,
    category: "validation",
    message: "Unit dimension is not one of the supported dimensions",
  },
  UNIT_DUPLICATE_CODE: {
    status: 409,
    category: "conflict",
    message: "A unit with this code already exists for this organisation",
  },
  // Tenant hardening (ENT-3): a job's subject is loaded inside the job's
  // organisation. These land in a job's result rather than in a response.
  BOQ_JOB_PROJECT_NOT_FOUND: {
    status: 404,
    category: "boq",
    message: "The BOQ job's project does not exist in the job's organisation",
  },
  JOB_ORG_MISMATCH: {
    status: 400,
    category: "system",
    message: "The job's payload names an organisation other than the job's",
  },
  JOB_ORG_REQUIRED: {
    status: 400,
    category: "system",
    message: "The job carries no organisation",
  },
  // Owner decision 2026-09-28: in integrated Project Controls the schedule
  // baseline is locked only on a project with a BOQ (structure → BOQ →
  // schedule → mapping → validation → baseline lock).
  BOQ_REQUIRED_FOR_BASELINE: {
    status: 400,
    category: "boq",
    message:
      "BOQ required before baseline lock: upload the BOQ (BOQ page), then map it to the schedule and lock the baseline.",
  },
  // Owner decision E2 (2026-09-28): its siblings, one per missing step. A
  // bill exists but no row of it is priced (every amount is 0), so there is
  // no value to map: the rows are priced first.
  BOQ_VALUE_REQUIRED_FOR_BASELINE: {
    status: 400,
    category: "boq",
    message:
      "BOQ required before baseline lock: the bill has no value to map; price its rows (BOQ page), map them to the schedule, then lock the baseline.",
  },
  // ... or it is priced, but none of its priced rows is in scope for mapping
  // (every one is not applicable or optional), so there is nothing to map
  // and nothing to lock.
  BOQ_SCOPE_REQUIRED_FOR_BASELINE: {
    status: 400,
    category: "boq",
    message:
      "BOQ required before baseline lock: the bill has no in-scope value to map; mark the rows that belong to the schedule as required (Project Controls › Mapping), map them, then lock the baseline.",
  },
  // BOQ ↔ activity mapping (PC-3).
  MAPPING_NOT_APPLICABLE: {
    status: 409,
    category: "conflict",
    message:
      "This BOQ item is marked not applicable for scheduling and cannot be allocated",
  },
  MAPPING_RULE_HAS_APPROVED_ALLOCATION: {
    status: 409,
    category: "conflict",
    message:
      "An item with an approved allocation cannot be marked not applicable until the allocation is rejected",
  },
  INVALID_MAPPING_RULE: {
    status: 400,
    category: "validation",
    message: "mappingRule must be required, optional or not_applicable",
  },
  INVALID_ALLOCATION_BASIS: {
    status: 400,
    category: "validation",
    message: "Allocation basis must be quantity, amount or weight",
  },
  INVALID_SUGGESTION_SOURCE: {
    status: 400,
    category: "validation",
    message: "suggestedBy names a source the mapping service does not know",
  },
  INVALID_SUGGESTION_CONFIDENCE: {
    status: 400,
    category: "validation",
    message: "confidence must be a number between 0 and 1",
  },
  LOCATION_OUTSIDE_SUBTREE: {
    status: 422,
    category: "validation",
    message:
      "The allocation's location must be the BOQ item's (and the activity's) location or a descendant of it",
  },
  MAPPING_IMPORT_INVALID: {
    status: 400,
    category: "validation",
    message:
      "The mapping file needs boq_code and activity_code columns and one of quantity, amount or weight",
  },
  MAPPING_IMPORT_BATCH_NOT_FOUND: {
    status: 404,
    category: "not_found",
    message: "No allocations carry this import batch id",
  },
  // ENT-6 personal workspaces and conversion
  PERSONAL_WORKSPACE_CONVERT_REQUIRED: {
    status: 409,
    category: "conflict",
    message: "A personal workspace has one member. Convert it to a company workspace to invite people.",
  },
  WORKSPACE_ALREADY_COMPANY: {
    status: 409,
    category: "conflict",
    message: "This workspace is already a company workspace",
  },
});

const DEFAULT_CODE_BY_STATUS = Object.freeze({
  400: "VALIDATION_ERROR",
  401: "AUTH_REQUIRED",
  402: "SUBSCRIPTION_REQUIRED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE_ENTITY",
  413: "PAYLOAD_TOO_LARGE",
  429: "RATE_LIMIT_EXCEEDED",
  500: "INTERNAL_ERROR",
  503: "SERVICE_UNAVAILABLE",
});

const normalizeStatus = (status) => {
  const parsed = Number(status);
  if (Number.isInteger(parsed) && parsed >= 400 && parsed <= 599) {
    return parsed;
  }
  return 500;
};

const defaultCodeForStatus = (status) =>
  DEFAULT_CODE_BY_STATUS[normalizeStatus(status)] || "INTERNAL_ERROR";

const catalogEntryFor = (code) => ERROR_CODE_CATALOG[code] || null;

const normalizeErrorCode = (code, status) => {
  if (typeof code === "string" && code.trim()) {
    return code.trim();
  }
  return defaultCodeForStatus(status);
};

module.exports = {
  ERROR_CODE_CATALOG,
  DEFAULT_CODE_BY_STATUS,
  catalogEntryFor,
  defaultCodeForStatus,
  normalizeErrorCode,
  normalizeStatus,
};
