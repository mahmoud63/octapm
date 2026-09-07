const { getAllowedRoles, permissionPolicy } = require("../config/permissions");

const ROLE_IDS = permissionPolicy.roles.map((role) => role.id);

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

const objectSchema = (properties = {}, required = []) => ({
  type: "object",
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
});

const freeObject = (description) => ({
  type: "object",
  description,
  additionalProperties: true,
});

const arrayOf = (schema) => ({ type: "array", items: schema });
const nullableRef = (name) => ({ nullable: true, allOf: [ref(name)] });

const successEnvelope = (dataSchema = ref("GenericObject")) =>
  objectSchema(
    {
      success: { type: "boolean", enum: [true] },
      data: dataSchema,
    },
    ["success", "data"],
  );

const jsonResponse = (description, dataSchema = ref("GenericObject")) => ({
  description,
  content: {
    "application/json": {
      schema: successEnvelope(dataSchema),
    },
  },
});

const authSessionResponse = (
  description,
  dataSchema = ref("AuthTokenResponse"),
) => ({
  ...jsonResponse(description, dataSchema),
  headers: {
    "Set-Cookie": {
      description:
        "Sets or rotates the httpOnly pmc_refresh_token cookie. The refresh token is not returned in the JSON body.",
      schema: { type: "string" },
    },
  },
});

const errorResponse = (description) => ({
  description,
  content: {
    "application/json": {
      schema: ref("ErrorEnvelope"),
    },
  },
});

const binaryResponse = (description, contentType) => ({
  description,
  content: {
    [contentType]: {
      schema: { type: "string", format: "binary" },
    },
  },
});

const redirectResponse = (description) => ({
  description,
  headers: {
    Location: {
      description: "Short-lived private object storage URL.",
      schema: { type: "string", format: "uri" },
    },
  },
});

const jsonBody = (schema, description, required = true) => ({
  description,
  required,
  content: {
    "application/json": { schema },
  },
});

const fileUploadBody = ({
  fieldName = "file",
  description,
  accepted,
  extraProperties = {},
  required = [fieldName],
  multiple = false,
}) => ({
  description,
  required: true,
  content: {
    "multipart/form-data": {
      schema: objectSchema(
        {
          [fieldName]: multiple
            ? {
                type: "array",
                items: { type: "string", format: "binary" },
                description: accepted,
              }
            : { type: "string", format: "binary", description: accepted },
          ...extraProperties,
        },
        required,
      ),
    },
  },
});

const pathParam = (name, description, format = "uuid") => ({
  name,
  in: "path",
  required: true,
  description,
  schema: { type: "string", ...(format ? { format } : {}) },
});

// `required` matters: a query parameter the route's validator insists on has to
// say so, or a client written against this document gets a 400 it cannot
// explain. Pass `{ required: true }` wherever the express-validator chain has no
// `.optional()`.
const queryParam = (name, description, schema, { required = false } = {}) => ({
  name,
  in: "query",
  required,
  description,
  schema,
});

const projectIdParam = pathParam(
  "projectId",
  "Project UUID scoped to the authenticated organization and, for non-PM roles, an assigned ProjectAssignment or active ProjectParty membership.",
);
const activityIdParam = pathParam("activityId", "Activity UUID.");
const idParam = pathParam("id", "Record UUID.");
const partyIdParam = pathParam(
  "partyId",
  "ProjectParty UUID scoped to the project.",
);
const userIdParam = pathParam(
  "userId",
  "User UUID scoped to the organization.",
);

const cursorParams = [
  queryParam("cursor", "Opaque cursor returned by the previous page.", {
    type: "string",
    format: "uuid",
  }),
  queryParam("limit", "Maximum records to return.", {
    type: "integer",
    minimum: 1,
    maximum: 100,
    default: 25,
  }),
];

const authenticatedOnly = {
  auth: "bearer",
  roles: ROLE_IDS,
  note: "Authenticated users are tenant-scoped by org_id middleware/service filters. Project routes also require an assigned ProjectAssignment, active ProjectParty membership, or org-wide PM access.",
};

const rolesPermission = (...roles) => ({
  auth: "bearer",
  roles,
});

const modulePermission = (moduleName, action, transition = null) => ({
  auth: "bearer",
  module: moduleName,
  action,
  ...(transition ? { transition } : {}),
  roles: getAllowedRoles({ module: moduleName, action, transition }),
});

const commonErrorResponses = {
  400: errorResponse("Bad request or validation failure."),
  401: errorResponse("Missing, invalid, or expired bearer token."),
  402: errorResponse(
    "Subscription, trial, plan limit, payment method, or card state blocks the request.",
  ),
  403: errorResponse(
    "Authenticated user lacks the required role, module/action permission, project assignment, or project-party access.",
  ),
  404: errorResponse("Record, route, or async job was not found."),
  409: errorResponse(
    "Business rule conflict, such as duplicate or capacity violations.",
  ),
  422: errorResponse("Semantically invalid payload."),
  429: errorResponse(
    "Rate limit, login backoff, account lockout, or abuse-protection quota exceeded. Responses may include Retry-After and RateLimit-* headers.",
  ),
  500: errorResponse("Unexpected server error."),
  502: errorResponse("Upstream provider failure, such as email delivery."),
};

const operation = ({
  tag,
  summary,
  description,
  operationId,
  parameters = [],
  requestBody,
  responses,
  responseDescription,
  responseSchema,
  status = 200,
  security = true,
  permissions = authenticatedOnly,
}) => {
  const spec = {
    tags: [tag],
    summary,
    operationId,
    parameters,
    responses: {
      ...(responses || {
        [status]: jsonResponse(
          responseDescription || "Successful response.",
          responseSchema,
        ),
      }),
      ...commonErrorResponses,
    },
  };

  if (description) spec.description = description;
  if (requestBody) spec.requestBody = requestBody;
  if (security) {
    spec.security = [{ bearerAuth: [] }];
    spec["x-permissions"] = permissions;
  } else {
    spec.security = [];
    spec["x-permissions"] = { auth: "none" };
  }

  return spec;
};

const paths = {};

const add = (path, method, spec) => {
  paths[path] = { ...(paths[path] || {}), [method]: spec };
};

const projectParams = [projectIdParam];
const projectRecordParams = [projectIdParam, idParam];
const includeArchivedParam = queryParam(
  "includeArchived",
  "Include archived records in list results. Defaults to false.",
  { type: "boolean", default: false },
);

const dateString = { type: "string", format: "date-time" };
const nullableDateString = {
  type: "string",
  format: "date-time",
  nullable: true,
};
const uuid = { type: "string", format: "uuid" };
const nullableUuid = { type: "string", format: "uuid", nullable: true };
const money = {
  type: "number",
  minimum: 0,
  multipleOf: 0.01,
  description:
    "Monetary value stored as Decimal(18,2); API accepts at most two decimal places.",
};
const signedMoney = {
  type: "number",
  multipleOf: 0.01,
  description:
    "Signed monetary value stored or computed at Decimal(18,2) precision.",
};
const nonNegativeNumber = { type: "number", minimum: 0 };
const percent = { type: "number", minimum: 0, maximum: 100 };

const components = {
  securitySchemes: {
    bearerAuth: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description:
        "Use the accessToken returned by /auth/login or /auth/register.",
    },
    refreshCookie: {
      type: "apiKey",
      in: "cookie",
      name: "pmc_refresh_token",
      description:
        "HttpOnly refresh-session cookie issued by /auth/register or /auth/login and rotated by /auth/refresh.",
    },
  },
  schemas: {
    GenericObject: freeObject(
      "Module-specific response object. See endpoint summary and source route for current fields.",
    ),
    GlobalSearchResult: objectSchema(
      {
        id: uuid,
        type: {
          type: "string",
          enum: [
            "project",
            "activity",
            "boq",
            "rfi",
            "submittal",
            "drawing",
            "document",
            "change_order",
            "ipc",
            "risk",
            "procurement",
            "long_lead",
            "meeting",
            "task",
          ],
        },
        typeLabel: { type: "string" },
        module: { type: "string" },
        projectId: uuid,
        projectName: { type: "string" },
        title: { type: "string" },
        subtitle: { type: "string", nullable: true },
        identifier: { type: "string", nullable: true },
        status: { type: "string", nullable: true },
        date: nullableDateString,
        url: { type: "string" },
        score: { type: "number" },
        metadata: freeObject("Entity-specific lightweight metadata."),
      },
      [
        "id",
        "type",
        "typeLabel",
        "module",
        "projectId",
        "projectName",
        "title",
        "url",
        "score",
      ],
    ),
    GlobalSearchResponse: objectSchema(
      {
        query: { type: "string", nullable: true },
        items: arrayOf(ref("GlobalSearchResult")),
        groups: arrayOf(
          objectSchema(
            {
              type: { type: "string" },
              label: { type: "string" },
              count: { type: "integer", minimum: 0 },
            },
            ["type", "label", "count"],
          ),
        ),
        filters: freeObject("Applied type, project, status, and date filters."),
        meta: objectSchema(
          {
            limit: { type: "integer", minimum: 1, maximum: 50 },
            total: { type: "integer", minimum: 0 },
            authorizedProjectCount: { type: "integer", minimum: 0 },
            searchableTypes: arrayOf(
              objectSchema(
                {
                  type: { type: "string" },
                  label: { type: "string" },
                },
                ["type", "label"],
              ),
            ),
          },
          ["limit", "total", "authorizedProjectCount", "searchableTypes"],
        ),
      },
      ["query", "items", "groups", "filters", "meta"],
    ),
    SuccessEnvelope: successEnvelope(),
    ErrorEnvelope: objectSchema(
      {
        success: { type: "boolean", enum: [false] },
        error: ref("ApiError"),
      },
      ["success", "error"],
    ),
    UserSummary: objectSchema({
      id: uuid,
      name: { type: "string" },
      email: { type: "string", format: "email" },
      role: { type: "string" },
    }),
    AuthUser: objectSchema(
      {
        id: uuid,
        orgId: uuid,
        name: { type: "string" },
        email: { type: "string", format: "email" },
        phone: { type: "string", nullable: true },
        role: { type: "string" },
        isCompanyAdmin: {
          type: "boolean",
          description:
            "Company admins see every project in the organisation and administer users and permission templates.",
        },
        status: { type: "string" },
        lastLogin: nullableDateString,
        createdAt: nullableDateString,
        updatedAt: nullableDateString,
      },
      ["id", "orgId", "name", "email", "role", "status"],
    ),
    UserSettingsProfile: objectSchema(
      {
        username: { type: "string", minLength: 2, maxLength: 30 },
        email: { type: "string", format: "email" },
        bio: { type: "string", maxLength: 160 },
        urls: arrayOf(
          objectSchema(
            {
              value: { type: "string", format: "uri", maxLength: 2048 },
            },
            ["value"],
          ),
        ),
      },
      ["username", "email", "bio", "urls"],
    ),
    UserSettingsAccount: objectSchema(
      {
        name: { type: "string", minLength: 2, maxLength: 30 },
        dob: nullableDateString,
        language: {
          type: "string",
          enum: ["en", "fr", "de", "es", "pt", "ru", "ja", "ko", "zh"],
        },
      },
      ["name", "language"],
    ),
    UserSettingsAppearance: objectSchema(
      {
        theme: { type: "string", enum: ["light", "dark", "system"] },
        font: { type: "string", enum: ["inter", "manrope", "system"] },
      },
      ["theme", "font"],
    ),
    UserSettingsDisplay: objectSchema(
      {
        items: arrayOf({
          type: "string",
          enum: [
            "dashboard",
            "projects",
            "tasks",
            "apps",
            "chats",
            "users",
            "help-center",
          ],
        }),
      },
      ["items"],
    ),
    UserSettingsResponse: objectSchema(
      {
        user: ref("AuthUser"),
        profile: ref("UserSettingsProfile"),
        account: ref("UserSettingsAccount"),
        appearance: ref("UserSettingsAppearance"),
        display: ref("UserSettingsDisplay"),
      },
      ["user", "profile", "account", "appearance", "display"],
    ),
    UserSettingsProfileUpdateRequest: objectSchema(
      {
        username: { type: "string", minLength: 2, maxLength: 30 },
        bio: { type: "string", nullable: true, maxLength: 160 },
        urls: arrayOf(
          objectSchema(
            {
              value: { type: "string", format: "uri", maxLength: 2048 },
            },
            ["value"],
          ),
        ),
      },
      ["username"],
    ),
    UserSettingsAccountUpdateRequest: objectSchema(
      {
        name: { type: "string", minLength: 2, maxLength: 30 },
        dob: nullableDateString,
        language: {
          type: "string",
          enum: ["en", "fr", "de", "es", "pt", "ru", "ja", "ko", "zh"],
        },
      },
      ["name", "language"],
    ),
    ArchiveResponse: objectSchema(
      {
        id: { type: "string" },
        status: { type: "string", enum: ["archived"] },
        archived: { type: "boolean", enum: [true] },
        deleted: { type: "boolean", enum: [false] },
        archivedAt: nullableDateString,
      },
      ["id", "status", "archived", "deleted", "archivedAt"],
    ),
    NotificationDeliveryAttempt: objectSchema(
      {
        id: uuid,
        notificationId: uuid,
        channel: { type: "string", enum: ["email"] },
        provider: { type: "string", nullable: true },
        status: {
          type: "string",
          enum: ["pending", "sent", "failed", "skipped"],
        },
        attemptNumber: { type: "integer", minimum: 1 },
        errorCode: { type: "string", nullable: true },
        errorMessage: { type: "string", nullable: true },
        nextAttemptAt: nullableDateString,
        sentAt: nullableDateString,
        metadata: freeObject("Provider response or retry metadata."),
        createdAt: dateString,
        updatedAt: dateString,
      },
      ["id", "notificationId", "channel", "status", "attemptNumber"],
    ),
    Notification: objectSchema(
      {
        id: uuid,
        orgId: uuid,
        projectId: nullableUuid,
        recipientUserId: uuid,
        actorId: nullableUuid,
        type: { type: "string" },
        category: {
          type: "string",
          enum: [
            "assignment",
            "due",
            "overdue",
            "approval",
            "commercial",
            "quality",
            "safety",
            "task",
            "workflow",
          ],
        },
        event: { type: "string" },
        title: { type: "string" },
        message: { type: "string" },
        priority: {
          type: "string",
          enum: ["low", "normal", "high", "urgent"],
        },
        status: { type: "string", enum: ["unread", "read", "archived"] },
        readAt: nullableDateString,
        archivedAt: nullableDateString,
        dueAt: nullableDateString,
        actionUrl: { type: "string", nullable: true },
        entityType: { type: "string", nullable: true },
        entityId: { type: "string", nullable: true },
        metadata: freeObject("Workflow, source entity, and delivery context."),
        deliveryAttempts: arrayOf(ref("NotificationDeliveryAttempt")),
        createdAt: dateString,
        updatedAt: dateString,
      },
      [
        "id",
        "orgId",
        "recipientUserId",
        "type",
        "category",
        "event",
        "title",
        "message",
        "priority",
        "status",
      ],
    ),
    NotificationListResponse: objectSchema(
      {
        rows: arrayOf(ref("Notification")),
        pagination: objectSchema({
          limit: { type: "integer" },
          nextCursor: { type: "string", nullable: true },
        }),
      },
      ["rows", "pagination"],
    ),
    NotificationSummary: objectSchema(
      {
        unread: { type: "integer", minimum: 0 },
        read: { type: "integer", minimum: 0 },
        archived: { type: "integer", minimum: 0 },
        recent: arrayOf(ref("Notification")),
      },
      ["unread", "read", "archived", "recent"],
    ),
    NotificationPreference: objectSchema(
      {
        id: { type: "string", nullable: true },
        category: {
          type: "string",
          enum: [
            "assignment",
            "due",
            "overdue",
            "approval",
            "commercial",
            "quality",
            "safety",
            "task",
            "workflow",
          ],
        },
        inAppEnabled: { type: "boolean" },
        emailEnabled: { type: "boolean" },
        pushEnabled: { type: "boolean", description: "Web Push to the user's registered devices (default true)." },
        digestEnabled: { type: "boolean" },
        dueSoonDays: { type: "integer", minimum: 1, maximum: 30 },
        quietHoursStart: { type: "string", nullable: true },
        quietHoursEnd: { type: "string", nullable: true },
        updatedAt: nullableDateString,
      },
      [
        "category",
        "inAppEnabled",
        "emailEnabled",
        "digestEnabled",
        "dueSoonDays",
      ],
    ),
    NotificationPreferencesResponse: objectSchema(
      {
        preferences: arrayOf(ref("NotificationPreference")),
      },
      ["preferences"],
    ),
    NotificationPreferencesUpdateRequest: objectSchema(
      {
        preferences: arrayOf(ref("NotificationPreference")),
      },
      ["preferences"],
    ),
    NotificationMarkAllReadResponse: objectSchema(
      {
        updated: { type: "integer", minimum: 0 },
      },
      ["updated"],
    ),
    NotificationDeliveryRetryResponse: objectSchema(
      {
        sent: { type: "integer", minimum: 0 },
        failed: { type: "integer", minimum: 0 },
        skipped: { type: "integer", minimum: 0 },
        processed: { type: "integer", minimum: 0 },
      },
      ["sent", "failed", "skipped", "processed"],
    ),
    NotificationRetryResponse: objectSchema(
      {
        queued: { type: "boolean" },
        reason: { type: "string", nullable: true },
        delivery: ref("NotificationDeliveryRetryResponse"),
      },
      ["queued"],
    ),
    NotificationDueScanRequest: objectSchema({
      projectId: nullableUuid,
      horizonDays: { type: "integer", minimum: 1, maximum: 30, default: 3 },
    }),
    NotificationDueScanResponse: objectSchema(
      {
        projects: { type: "integer", minimum: 0 },
        created: { type: "integer", minimum: 0 },
      },
      ["projects", "created"],
    ),
    ApiError: objectSchema(
      {
        code: { $ref: "#/components/schemas/ErrorCode" },
        message: { type: "string" },
        details: freeObject(
          "Optional validation or internal details. Hidden in production for unexpected errors.",
        ),
      },
      ["code", "message"],
    ),
    ErrorCode: {
      type: "string",
      enum: [
        "ACTIVITY_NOT_FOUND",
        "ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED",
        "AI_LIMIT_REACHED",
        "ALLOCATION_NOT_EDITABLE",
        "ALLOCATION_AMOUNT_EXCEEDED",
        "ALLOCATION_NOT_FOUND",
        "ALLOCATION_QUANTITY_EXCEEDED",
        "ALREADY_ACTIVE",
        "ALREADY_INACTIVE",
        "ACCOUNT_LOCKED",
        "AUTH_REQUIRED",
        "BOQ_ITEM_CODE_REQUIRED",
        "BOQ_BASELINE_LOCKED",
        "BOQ_ITEM_HAS_LINKED_ALLOCATIONS",
        "BOQ_ITEM_INACTIVE",
        "BOQ_ITEM_NOT_DELETABLE",
        "BOQ_ITEM_NOT_FOUND",
        "BOQ_VALIDATION_FAILED",
        "CARD_DECLINED",
        "CHANGE_ORDER_APPROVED_LOCKED",
        "CHANGE_ORDER_ARCHIVED",
        "CHANGE_ORDER_IMPACT_SUMMARY_REQUIRED",
        "CHANGE_ORDER_WORKFLOW_ACTION_REQUIRED",
        "COMPANY_EXISTS",
        "COMPANY_NAME_REQUIRED",
        "COMPANY_NOT_FOUND",
        "COMPANY_REQUIRED",
        "CONFIG_ERROR",
        "CONFLICT",
        "COST_RECORD_NOT_FOUND",
        "CPM_DEPENDENCY_CYCLE",
        "DAILY_REPORT_LINK_INVALID",
        "DAILY_REPORT_NOT_FOUND",
        "DEFECT_NOT_FOUND",
        "DOCUMENT_RECORD_NOT_FOUND",
        "DOCUMENT_RECORD_TYPE_UNSUPPORTED",
        "DOCUMENT_REVISION_EXISTS",
        "DOCUMENT_REVISION_FILE_REQUIRED",
        "DOCUMENT_REVISION_NOT_FOUND",
        "DOCUMENT_REVISION_REQUIRED",
        "DOCUMENT_REVISION_SUPERSEDE_REASON_REQUIRED",
        "DOCUMENT_REVISION_SUPERSEDED_READ_ONLY",
        "DOWNGRADE_NOT_ALLOWED",
        "DRAWING_NOT_FOUND",
        "DUPLICATE_BOQ_ITEM_CODE",
        "DUPLICATE_ACTIVE_ALLOCATION",
        "EMAIL_DELIVERY_FAILED",
        "EMAIL_EXISTS",
        "EMAIL_MESSAGE_INVALID",
        "EMPTY_FILE",
        "ENTERPRISE_VIA_SALES",
        "EOT_CLAIM_NOT_FOUND",
        "EOT_WORKFLOW_ACTION_REQUIRED",
        "EQUIPMENT_NOT_FOUND",
        "EQUIPMENT_USAGE_LINK_INVALID",
        "FILE_NOT_AVAILABLE",
        "FILE_NOT_FOUND",
        "FILE_PARSE_ERROR",
        "FILE_TOO_LARGE",
        "FILE_TYPE_MISMATCH",
        "FILE_VIRUS_DETECTED",
        "FORBIDDEN",
        "INTERNAL_ERROR",
        "INVALID_ALLOCATION_VALUES",
        "INVALID_ALLOCATION_SOURCE",
        "INVALID_ALLOCATION_STATUS",
        "INVALID_CYCLE",
        "INVALID_DATE",
        "INVALID_DEPENDENCY_ACTIVITY",
        "INVALID_DEPENDENCY_PREDECESSOR",
        "INVALID_DEPENDENCY_RELATIONSHIP",
        "INVALID_DEPENDENCY_SELF_LINK",
        "INVALID_DEPENDENCY_SUCCESSOR",
        "INVALID_FILE_KEY",
        "INVALID_FORMAT",
        "INVALID_SHIFT",
        "INVALID_SITE_PHOTO_REFERENCE",
        "INVALID_PLAN",
        "INVITATION_EMAIL_IN_OTHER_ORG",
        "INVITATION_PASSWORD_REQUIRED",
        "INVITATION_TOKEN_INVALID",
        "INVALID_REFRESH_TOKEN",
        "INVALID_ROLE",
        "INVALID_PROJECT_PARTY_ACCESS_LEVEL",
        "INVALID_PROJECT_PARTY_ROLE",
        "INVALID_SEATS_BAND",
        "INVALID_TOKEN",
        "INVALID_UNIT",
        "IPC_ITEM_NOT_FOUND",
        "IPC_ALLOCATION_AMOUNT_EXCEEDED",
        "IPC_ALLOCATION_NOT_APPROVED",
        "IPC_ALLOCATION_QTY_EXCEEDED",
        "IPC_APPROVED_PROGRESS_EXCEEDED",
        "IPC_APPROVED_PROGRESS_REQUIRED",
        "IPC_CERTIFICATE_NOT_CERTIFIED",
        "IPC_INVALID_CERTIFICATION_STATE",
        "IPC_INVALID_SUBMISSION_STATE",
        "IPC_INVOICE_ALREADY_ISSUED",
        "IPC_INVOICE_REQUIRED",
        "IPC_ITEM_STATUS_DIRECT_UPDATE_FORBIDDEN",
        "IPC_PAYMENT_AMOUNT_REQUIRED",
        "IPC_PAYMENT_EXCEEDS_PAYABLE_BALANCE",
        "IPC_PERIOD_EXISTS",
        "IPC_PERIOD_NOT_FOUND",
        "IPC_PERIOD_NOT_EDITABLE",
        "IPC_PM_OVERRIDE_REASON_REQUIRED",
        "IPC_PM_OVERRIDE_REQUIRED",
        "IPC_RETENTION_RELEASE_AMOUNT_REQUIRED",
        "IPC_RETENTION_RELEASE_EXCEEDS_HELD",
        "ISSUED_QTY_EXCEEDS_RECEIVED",
        "ITP_NOT_FOUND",
        "JOB_ACCESS_DENIED",
        "JOB_NOT_FOUND",
        "LOGIN_BACKOFF",
        "LONG_LEAD_NOT_FOUND",
        "MATERIAL_HAS_PROCUREMENT_ACTIVITY",
        "MATERIAL_NOT_FOUND",
        "MATERIAL_USAGE_EXCEEDS_ISSUED_QTY",
        "MISSING_FIELDS",
        "NCR_CLOSEOUT_EVIDENCE_REQUIRED",
        "NCR_CLOSEOUT_REQUIRED_FIELDS",
        "NCR_NOT_READY_FOR_APPROVAL",
        "NCR_NOT_READY_FOR_CLOSEOUT",
        "NCR_NOT_READY_FOR_REJECTION",
        "NCR_NOT_READY_FOR_REOPEN",
        "NCR_NOT_FOUND",
        "NCR_REOPEN_REASON_REQUIRED",
        "NCR_WORKFLOW_ACTION_REQUIRED",
        "NOTIFICATION_NOT_FOUND",
        "NOTIFICATION_PREFERENCE_INVALID",
        "NO_ACTIVE_SUBSCRIPTION",
        "NO_FILE",
        "NOT_FOUND",
        "PARSE_ERROR",
        "PAYMENT_METHOD_REQUIRED",
        "PASSWORD_RESET_TOKEN_INVALID",
        "PROJECT_LIMIT_REACHED",
        "ORG_NOT_FOUND",
        "PROJECT_ACCESS_DENIED",
        "PROJECT_ARCHIVED",
        "PROJECT_ARCHIVE_ACTION_REQUIRED",
        "PROJECT_NOT_FOUND",
        "PROJECT_PARTY_MEMBER_NOT_FOUND",
        "PROJECT_PARTY_NOT_FOUND",
        "PROJECT_PARTY_PROJECT_REQUIRED",
        "PROJECT_PARTY_RECORD_ACCESS_DENIED",
        "PO_LINE_NOT_FOUND",
        "PO_LINES_REQUIRED",
        "PROCUREMENT_ACTIVITY_REQUIRED",
        "PROCUREMENT_ALERT_ALREADY_RESOLVED",
        "PROCUREMENT_ALERT_NOT_FOUND",
        "PROCUREMENT_ALERT_WORKFLOW_ENDPOINT_REQUIRED",
        "PROCUREMENT_ORDER_NOT_FOUND",
        "PROCUREMENT_PACKAGE_NOT_FOUND",
        "SAFETY_CLOSEOUT_EVIDENCE_REQUIRED",
        "SAFETY_CLOSEOUT_REQUIRED_FIELDS",
        "SAFETY_INCIDENT_ARCHIVED",
        "SAFETY_INCIDENT_NOT_FOUND",
        "SAFETY_INCIDENT_NOT_READY_FOR_APPROVAL",
        "SAFETY_NOT_READY_FOR_CLOSEOUT",
        "SAFETY_NOT_READY_FOR_REJECTION",
        "SAFETY_NOT_READY_FOR_REOPEN",
        "SAFETY_REOPEN_REASON_REQUIRED",
        "SAFETY_WORKFLOW_ACTION_REQUIRED",
        "REVISION_NOT_FOUND",
        "RECEIPT_LINE_NOT_FOUND",
        "RECEIPT_LINES_REQUIRED",
        "RECEIPT_QTY_EXCEEDS_ORDERED",
        "REFRESH_SESSION_REQUIRED",
        "REFRESH_TOKEN_EXPIRED",
        "REFRESH_TOKEN_REUSED",
        "RFI_ALREADY_CLOSED",
        "RFI_ALREADY_OPEN",
        "RFI_ARCHIVED",
        "RFI_ARCHIVE_ACTION_REQUIRED",
        "RFI_CLOSE_COMMENT_REQUIRED",
        "RFI_NOT_FOUND",
        "RFI_REOPEN_REASON_REQUIRED",
        "RFI_RESPONSE_REQUIRED",
        "RATE_LIMIT_EXCEEDED",
        "RISK_ARCHIVED",
        "RISK_NOT_FOUND",
        "SITE_DIARY_NOT_FOUND",
        "SUBMITTAL_ALREADY_DECIDED",
        "SUBMITTAL_ARCHIVED",
        "SUBMITTAL_ARCHIVE_ACTION_REQUIRED",
        "SUBMITTAL_DECISION_COMMENT_REQUIRED",
        "SUBMITTAL_DECISION_INVALID",
        "SUBMITTAL_IN_ANOTHER_PACKAGE",
        "SUBMITTAL_NO_ACTIVE_STEP",
        "SUBMITTAL_NOT_ASSIGNED",
        "SUBMITTAL_PACKAGE_NAME_REQUIRED",
        "SUBMITTAL_PACKAGE_NOT_FOUND",
        "SUBMITTAL_RESPONSE_CODE_INVALID",
        "SUBMITTAL_RESPONSE_CODE_LABEL_REQUIRED",
        "SUBMITTAL_STEP_UNASSIGNED",
        "SUBMITTAL_TEMPLATE_ASSIGNEE_INVALID",
        "SUBMITTAL_TEMPLATE_ASSIGNEE_REQUIRED",
        "SUBMITTAL_TEMPLATE_COMPANY_SCOPED",
        "SUBMITTAL_TEMPLATE_DAYS_INVALID",
        "SUBMITTAL_TEMPLATE_NAME_REQUIRED",
        "SUBMITTAL_TEMPLATE_NOT_FOUND",
        "SUBMITTAL_TEMPLATE_STATUS_INVALID",
        "SUBMITTAL_TEMPLATE_STEP_NAME_REQUIRED",
        "SUBMITTAL_TEMPLATE_STEPS_REQUIRED",
        "SUBMITTAL_TEMPLATE_TOO_MANY_ASSIGNEES",
        "SUBMITTAL_TEMPLATE_TOO_MANY_STEPS",
        "SUBMITTAL_NOT_READY_FOR_APPROVAL",
        "SUBMITTAL_NOT_READY_FOR_REJECTION",
        "SUBMITTAL_NOT_READY_FOR_RESUBMISSION",
        "SUBMITTAL_NOT_READY_FOR_SUBMISSION",
        "SUBMITTAL_NOT_UNDER_REVIEW",
        "SUBMITTAL_NOT_FOUND",
        "SUBMITTAL_RESUBMIT_REASON_REQUIRED",
        "SUBMITTAL_REVIEW_COMMENT_REQUIRED",
        "SUBMITTAL_REVISION_REQUIRED",
        "SUBSCRIPTION_REQUIRED",
        "SUPPLIER_NOT_FOUND",
        "TOKEN_EXPIRED",
        "TRANSMITTAL_NOT_FOUND",
        "TRIAL_NOT_AVAILABLE",
        "UNSUPPORTED_FORMAT",
        "UNSUPPORTED_DOCUMENT_TYPE",
        "UNSUPPORTED_SITE_PHOTO",
        "UNSUPPORTED_WORKFLOW_ATTACHMENT",
        "UNPROCESSABLE_ENTITY",
        "USER_INACTIVE",
        "USER_NOT_FOUND",
        "VALIDATION_ERROR",
        "WORKFLOW_ACTIVITY_NOT_FOUND",
        "WORKFLOW_PROJECT_PARTY_NOT_FOUND",
      ],
    },
    CursorPage: objectSchema({
      items: arrayOf(ref("GenericObject")),
      nextCursor: { type: "string", nullable: true },
      hasMore: { type: "boolean" },
      limit: { type: "integer" },
    }),
    AuditEvent: objectSchema(
      {
        id: { type: "string" },
        orgId: { type: "string" },
        projectId: { type: "string" },
        entityType: {
          type: "string",
          enum: [
            "schedule_revision",
            "progress_submission",
            "daily_report",
            "site_diary",
            "ipc_certificate",
            "ipc_item",
            "change_order",
            "sub_valuation",
            "eot_claim",
            "weather_delay",
            "boq_item",
            "boq_revision",
            "cost_record",
            "burn_rate_entry",
            "activity_boq_allocation",
            "procurement_supplier",
            "procurement_package",
            "procurement_order",
            "delivery_receipt",
            "activity_material_usage",
            "activity_equipment_usage",
            "procurement_alert",
            "project",
            "rfi",
            "submittal",
            "document_revision",
            "ncr",
            "safety_incident",
            "project_setup_readiness",
          ],
        },
        entityId: { type: "string" },
        recordType: { type: "string" },
        recordId: { type: "string" },
        source: {
          type: "string",
          enum: ["audit", "approval", "status"],
          description:
            "History source: central audit event, approval workflow event, or workflow status-history row.",
        },
        rawId: { type: "string" },
        workflowType: { type: "string", nullable: true },
        action: {
          type: "string",
          enum: [
            "created",
            "updated",
            "status_changed",
            "submitted",
            "answered",
            "reviewed",
            "approved",
            "rejected",
            "resubmit_required",
            "baseline_locked",
            "certified",
            "paid",
            "closed",
            "reopened",
            "archived",
            "deleted",
            "superseded",
            "imported",
            "overridden",
          ],
        },
        decision: { type: "string", nullable: true },
        actorId: { type: "string", nullable: true },
        actorRole: { type: "string", nullable: true },
        occurredAt: dateString,
        oldStatus: { type: "string", nullable: true },
        newStatus: { type: "string", nullable: true },
        fromStatus: { type: "string", nullable: true },
        toStatus: { type: "string", nullable: true },
        reason: { type: "string", nullable: true },
        comment: { type: "string", nullable: true },
        oldSummary: {
          type: "object",
          nullable: true,
          additionalProperties: true,
          description:
            "Compact redacted before-state snapshot persisted to RecordHistorySnapshot.previousSnapshotJson.",
        },
        newSummary: {
          type: "object",
          nullable: true,
          additionalProperties: true,
          description:
            "Compact redacted after-state snapshot persisted to RecordHistorySnapshot.snapshotJson.",
        },
        summary: freeObject("Compact event summary for timeline display."),
        attachments: arrayOf(ref("GenericObject")),
        metadata: freeObject("Compact redacted audit metadata."),
        createdAt: dateString,
      },
      [
        "id",
        "orgId",
        "projectId",
        "entityType",
        "entityId",
        "recordType",
        "recordId",
        "source",
        "rawId",
        "action",
        "occurredAt",
        "summary",
        "attachments",
        "metadata",
        "createdAt",
      ],
    ),
    AuditEventsResponse: objectSchema(
      {
        events: arrayOf(ref("AuditEvent")),
        nextCursor: { type: "string", nullable: true },
      },
      ["events", "nextCursor"],
    ),
    CursorPagination: objectSchema(
      {
        limit: { type: "integer", minimum: 1, maximum: 100 },
        nextCursor: { type: "string", nullable: true },
      },
      ["limit", "nextCursor"],
    ),
    RowsCursorPage: objectSchema(
      {
        rows: arrayOf(ref("GenericObject")),
        summary: ref("GenericObject"),
        pagination: ref("CursorPagination"),
      },
      ["rows", "pagination"],
    ),
    AuthRegisterRequest: objectSchema(
      {
        orgName: { type: "string" },
        name: { type: "string" },
        email: { type: "string", format: "email" },
        password: { type: "string", format: "password", minLength: 8 },
        phone: { type: "string" },
      },
      ["name", "email", "password"],
    ),
    AuthLoginRequest: objectSchema(
      {
        email: { type: "string", format: "email" },
        password: { type: "string", format: "password" },
      },
      ["email", "password"],
    ),
    AuthForgotPasswordRequest: objectSchema(
      {
        email: { type: "string", format: "email" },
      },
      ["email"],
    ),
    AuthForgotPasswordResponse: objectSchema(
      {
        sent: { type: "boolean" },
      },
      ["sent"],
    ),
    AuthResetPasswordRequest: objectSchema(
      {
        token: { type: "string" },
        password: { type: "string", format: "password", minLength: 8 },
      },
      ["token", "password"],
    ),
    AuthResetPasswordResponse: objectSchema(
      {
        reset: { type: "boolean" },
      },
      ["reset"],
    ),
    InvitationPreview: objectSchema(
      {
        email: { type: "string", format: "email" },
        role: { type: "string", enum: ROLE_IDS },
        org: objectSchema({
          id: uuid,
          name: { type: "string" },
        }),
        project: {
          nullable: true,
          oneOf: [
            objectSchema({
              id: uuid,
              name: { type: "string" },
            }),
          ],
        },
        company: {
          nullable: true,
          oneOf: [
            objectSchema({
              id: uuid,
              name: { type: "string" },
            }),
          ],
        },
        projectParty: {
          nullable: true,
          oneOf: [
            objectSchema({
              id: uuid,
              role: {
                type: "string",
                enum: ["owner", "consultant", "contractor", "subcontractor"],
              },
              company: objectSchema({
                id: uuid,
                name: { type: "string" },
              }),
            }),
          ],
        },
        expiresAt: dateString,
        existingUser: { type: "boolean" },
        requiresPassword: { type: "boolean" },
      },
      [
        "email",
        "role",
        "org",
        "project",
        "expiresAt",
        "existingUser",
        "requiresPassword",
      ],
    ),
    InvitationAcceptRequest: objectSchema(
      {
        token: { type: "string" },
        name: { type: "string" },
        password: { type: "string", format: "password", minLength: 8 },
        phone: { type: "string" },
      },
      ["token", "name"],
    ),
    UserInvitationRequest: objectSchema(
      {
        email: { type: "string", format: "email" },
        role: { type: "string", enum: ROLE_IDS },
        projectId: nullableUuid,
        companyId: nullableUuid,
        projectPartyId: nullableUuid,
        note: { type: "string", maxLength: 1000 },
      },
      ["email", "role"],
    ),
    UserInvitationResponse: objectSchema(
      {
        id: uuid,
        email: { type: "string", format: "email" },
        role: { type: "string", enum: ROLE_IDS },
        status: { type: "string", enum: ["pending", "accepted", "revoked"] },
        projectId: nullableUuid,
        companyId: nullableUuid,
        projectPartyId: nullableUuid,
        invitedById: nullableUuid,
        expiresAt: dateString,
        createdAt: dateString,
      },
      [
        "id",
        "email",
        "role",
        "status",
        "projectId",
        "invitedById",
        "expiresAt",
        "createdAt",
      ],
    ),
    AuthTokens: objectSchema(
      {
        accessToken: { type: "string" },
        tokenType: { type: "string", enum: ["Bearer"] },
        expiresIn: {
          type: "integer",
          description: "Access-token lifetime in seconds; defaults to 900.",
        },
      },
      ["accessToken", "tokenType", "expiresIn"],
    ),
    AuthTokenResponse: objectSchema(
      {
        user: ref("GenericObject"),
        tokens: ref("AuthTokens"),
      },
      ["user", "tokens"],
    ),
    LogoutResponse: objectSchema(
      {
        revoked: { type: "boolean" },
      },
      ["revoked"],
    ),
    BillingPaymentMethod: objectSchema({
      brand: { type: "string", nullable: true },
      last4: { type: "string", nullable: true },
      expMonth: { type: "integer", nullable: true },
      expYear: { type: "integer", nullable: true },
    }),
    BillingSubscription: objectSchema(
      {
        id: uuid,
        plan: {
          type: "string",
          enum: ["trial", "individual", "business", "enterprise"],
        },
        planName: { type: "string" },
        billingCycle: {
          type: "string",
          enum: ["monthly", "annual"],
          nullable: true,
        },
        status: {
          type: "string",
          enum: [
            "incomplete",
            "trialing",
            "active",
            "past_due",
            "canceled",
            "expired",
          ],
        },
        hasAccess: { type: "boolean" },
        seats: { type: "integer", minimum: 1 },
        projectLimit: { type: "integer", minimum: 1, nullable: true },
        aiLimit: { type: "integer", minimum: 1, nullable: true },
        aiGenerationsUsed: { type: "integer", minimum: 0 },
        trialEndsAt: nullableDateString,
        currentPeriodEnd: nullableDateString,
        cancelAtPeriodEnd: { type: "boolean" },
        paymentMethod: { ...ref("BillingPaymentMethod"), nullable: true },
      },
      ["id", "plan", "planName", "status", "hasAccess"],
    ),
    BillingPlan: objectSchema(
      {
        id: { type: "string", enum: ["individual", "business", "enterprise"] },
        name: { type: "string" },
        projectLimit: { type: "integer", nullable: true },
        aiLimit: { type: "integer", nullable: true },
        seats: { type: "integer", nullable: true },
        monthly: { type: "integer", nullable: true },
        annual: { type: "integer", nullable: true },
        isCurrent: { type: "boolean" },
        isEnterprise: { type: "boolean" },
      },
      ["id", "name", "isCurrent", "isEnterprise"],
    ),
    BillingPlansResponse: objectSchema(
      {
        currentPlan: { type: "string", nullable: true },
        plans: arrayOf(ref("BillingPlan")),
      },
      ["plans"],
    ),
    BillingTransaction: objectSchema(
      {
        id: uuid,
        date: dateString,
        description: { type: "string" },
        amount: money,
        currency: { type: "string" },
        status: { type: "string" },
      },
      ["id", "date", "description", "amount", "currency", "status"],
    ),
    BillingTrialStartResponse: objectSchema(
      {
        clientSecret: { type: "string" },
      },
      ["clientSecret"],
    ),
    BillingTrialConfirmRequest: objectSchema(
      {
        paymentMethodId: { type: "string" },
      },
      ["paymentMethodId"],
    ),
    BillingSubscribeRequest: objectSchema(
      {
        plan: { type: "string", enum: ["individual", "business"] },
        billingCycle: { type: "string", enum: ["monthly", "annual"] },
        paymentMethodId: { type: "string" },
      },
      ["plan", "billingCycle"],
    ),
    BillingEnterpriseLeadRequest: objectSchema(
      {
        seatsBand: { type: "string", enum: ["lte_100", "gt_100"] },
      },
      ["seatsBand"],
    ),
    BillingEnterpriseLeadResponse: objectSchema(
      {
        id: uuid,
        seatsBand: { type: "string", enum: ["lte_100", "gt_100"] },
        status: { type: "string" },
      },
      ["id", "seatsBand", "status"],
    ),
    StripeWebhookAck: objectSchema(
      {
        received: { type: "boolean", enum: [true] },
      },
      ["received"],
    ),
    Company: objectSchema(
      {
        id: uuid,
        orgId: uuid,
        name: { type: "string" },
        legalName: { type: "string", nullable: true },
        tradeName: { type: "string", nullable: true },
        registrationNumber: { type: "string", nullable: true },
        taxNumber: { type: "string", nullable: true },
        type: { type: "string", enum: ["internal", "external"] },
        email: { type: "string", format: "email", nullable: true },
        phone: { type: "string", nullable: true },
        website: { type: "string", nullable: true },
        address: { type: "string", nullable: true },
        status: { type: "string", enum: ["active", "inactive"] },
        createdAt: dateString,
        updatedAt: dateString,
      },
      ["id", "orgId", "name", "type", "status"],
    ),
    CompanyMutation: objectSchema(
      {
        name: { type: "string", maxLength: 255 },
        legalName: { type: "string", nullable: true, maxLength: 255 },
        tradeName: { type: "string", nullable: true, maxLength: 255 },
        registrationNumber: { type: "string", nullable: true, maxLength: 120 },
        taxNumber: { type: "string", nullable: true, maxLength: 120 },
        type: { type: "string", enum: ["internal", "external"] },
        email: { type: "string", format: "email", nullable: true },
        phone: { type: "string", nullable: true, maxLength: 80 },
        website: { type: "string", nullable: true, maxLength: 255 },
        address: { type: "string", nullable: true, maxLength: 1000 },
        status: { type: "string", enum: ["active", "inactive"] },
      },
      ["name"],
    ),
    CompaniesResponse: objectSchema(
      {
        items: arrayOf(ref("Company")),
        pagination: ref("CursorPagination"),
      },
      ["items", "pagination"],
    ),
    ProjectPartyMember: objectSchema(
      {
        id: uuid,
        userId: uuid,
        companyMembershipId: nullableUuid,
        role: { type: "string" },
        status: { type: "string", enum: ["active", "inactive", "pending"] },
        invitedAt: nullableDateString,
        acceptedAt: nullableDateString,
        user: {
          nullable: true,
          oneOf: [
            objectSchema({
              id: uuid,
              name: { type: "string", nullable: true },
              email: { type: "string", format: "email" },
              role: { type: "string", enum: ROLE_IDS },
              status: { type: "string", enum: ["active", "inactive"] },
            }),
          ],
        },
      },
      ["id", "userId", "role", "status"],
    ),
    ProjectParty: objectSchema(
      {
        id: uuid,
        projectId: uuid,
        companyId: uuid,
        role: {
          type: "string",
          enum: ["owner", "consultant", "contractor", "subcontractor"],
        },
        roleLabel: { type: "string", nullable: true },
        contactName: { type: "string", nullable: true },
        contactEmail: { type: "string", format: "email", nullable: true },
        contactPhone: { type: "string", nullable: true },
        accessLevel: {
          type: "string",
          enum: ["read_only", "collaborator", "reviewer", "admin"],
        },
        permissionProfile: { type: "string", nullable: true },
        permissionPolicy: ref("GenericObject"),
        permissionTemplateId: nullableUuid,
        permissionTemplate: {
          allOf: [ref("PermissionTemplateRef")],
          nullable: true,
        },
        status: { type: "string", enum: ["active", "inactive"] },
        company: { allOf: [ref("Company")], nullable: true },
        members: arrayOf(ref("ProjectPartyMember")),
        createdAt: dateString,
        updatedAt: dateString,
      },
      ["id", "projectId", "companyId", "role", "accessLevel", "status"],
    ),
    ProjectPartyMutation: objectSchema({
      partyId: nullableUuid,
      role: {
        type: "string",
        enum: ["owner", "consultant", "contractor", "subcontractor"],
      },
      companyId: nullableUuid,
      companyName: { type: "string", nullable: true, maxLength: 255 },
      name: { type: "string", nullable: true, maxLength: 255 },
      contactName: { type: "string", nullable: true, maxLength: 255 },
      contactEmail: { type: "string", format: "email", nullable: true },
      contactPhone: { type: "string", nullable: true, maxLength: 80 },
      accessLevel: {
        type: "string",
        enum: ["read_only", "collaborator", "reviewer", "admin"],
      },
      permissionProfile: { type: "string", nullable: true, maxLength: 120 },
      status: { type: "string", enum: ["active", "inactive"] },
    }),
    ProjectPartiesResponse: objectSchema(
      {
        items: arrayOf(ref("ProjectParty")),
      },
      ["items"],
    ),
    ProjectPartyMemberMutation: objectSchema(
      {
        userId: uuid,
        role: { type: "string", default: "member" },
        invitedAt: nullableDateString,
        acceptedAt: nullableDateString,
      },
      ["userId"],
    ),
    ProjectMutation: objectSchema({
      name: { type: "string" },
      type: { type: "string", nullable: true },
      location: { type: "string", nullable: true },
      clientName: { type: "string", nullable: true },
      consultantName: { type: "string", nullable: true },
      contractorName: { type: "string", nullable: true },
      contractType: {
        type: "string",
        nullable: true,
        enum: [
          "lump_sum",
          "unit_rate",
          "remeasurement",
          "cost_plus",
          "design_build",
          "epc",
          "other",
        ],
      },
      contractNumber: { type: "string", nullable: true },
      startDate: nullableDateString,
      endDate: nullableDateString,
      completionDate: nullableDateString,
      baselineDate: nullableDateString,
      dataDate: nullableDateString,
      revisedCompletionDate: nullableDateString,
      duration: { type: "integer", minimum: 0, nullable: true },
      durationUnit: { type: "string", enum: ["days", "weeks", "months"] },
      contractValue: { ...money, nullable: true },
      defaultRetentionRate: { ...percent, nullable: true },
      ldRatePerDay: money,
      weatherAllowanceDays: { type: "integer", minimum: 0 },
      projectCalendar: {
        type: "string",
        enum: ["five_day", "six_day", "seven_day", "custom"],
        nullable: true,
      },
      reportingCutoffDay: {
        type: "integer",
        minimum: 1,
        maximum: 31,
        nullable: true,
      },
      currency: { type: "string", minLength: 3, maxLength: 3 },
      status: {
        type: "string",
        enum: ["active", "on_hold", "completed", "cancelled"],
      },
      parties: arrayOf(ref("ProjectPartyMutation")),
    }),
    BoqItemMutation: objectSchema(
      {
        code: { type: "string" },
        description: { type: "string" },
        quantity: nonNegativeNumber,
        unit: { type: "string" },
        rate: money,
        activityName: { type: "string" },
      },
      ["code", "description", "quantity", "unit", "rate", "activityName"],
    ),
    BoqActivityMutation: objectSchema(
      {
        activityName: {
          type: "string",
          description:
            "Draft helper label for an official schedule Activity. Legacy BoqActivity records are suggestion/history only.",
        },
        unit: { type: "string" },
        quantity: nonNegativeNumber,
        rate: money,
        dependencyType: { type: "string", enum: ["FS", "SS"], nullable: true },
        predecessorCode: { type: "string", nullable: true },
      },
      ["activityName", "unit", "quantity", "rate"],
    ),
    ActivityBoqAllocationMutation: objectSchema(
      {
        boqItemId: uuid,
        activityId: uuid,
        quantity: nonNegativeNumber,
        amount: money,
        weight: percent,
        source: {
          type: "string",
          enum: ["manual", "import", "ai", "migration"],
        },
        notes: { type: "string", nullable: true },
      },
      ["boqItemId", "activityId", "quantity"],
    ),
    ProjectDocumentUpload: objectSchema(
      {
        documentId: uuid,
        key: uuid,
        storageKey: uuid,
        url: { type: "string" },
        fileUrl: { type: "string" },
        downloadUrl: { type: "string" },
        filename: { type: "string" },
        fileName: { type: "string" },
        originalName: { type: "string" },
        mimeType: { type: "string" },
        size: { type: "integer", minimum: 1 },
        sizeBytes: { type: "integer", minimum: 1 },
        storage: { type: "string", enum: ["local", "s3"] },
        scanStatus: { type: "string", enum: ["clean"] },
        retentionExpiresAt: nullableDateString,
        uploadedBy: nullableUuid,
        uploadedAt: dateString,
      },
      [
        "documentId",
        "key",
        "storageKey",
        "downloadUrl",
        "filename",
        "originalName",
        "mimeType",
        "sizeBytes",
        "storage",
        "scanStatus",
      ],
    ),
    BoqRevisionSummary: objectSchema({
      id: uuid,
      projectId: uuid,
      revisionNumber: { type: "integer", minimum: 1 },
      label: { type: "string", nullable: true },
      status: {
        type: "string",
        enum: ["imported", "comparison_only", "baselined", "superseded"],
      },
      baselineLocked: { type: "boolean" },
      lockedAt: nullableDateString,
      itemCount: { type: "integer", minimum: 0 },
      addedCount: { type: "integer", minimum: 0 },
      updatedCount: { type: "integer", minimum: 0 },
      removedCount: { type: "integer", minimum: 0 },
      unchangedCount: { type: "integer", minimum: 0 },
      blockedCount: { type: "integer", minimum: 0 },
      totalAmount: money,
      sourceDocumentId: nullableUuid,
      createdAt: dateString,
      updatedAt: dateString,
    }),
    BoqBaselineState: objectSchema({
      locked: { type: "boolean" },
      source: {
        type: "string",
        enum: ["schedule_baseline", "boq_revision"],
        nullable: true,
      },
      scheduleRevisionId: nullableUuid,
      boqRevisionId: nullableUuid,
      revisionNumber: { type: "integer", nullable: true },
      label: { type: "string", nullable: true },
      lockedAt: nullableDateString,
    }),
    BoqRevisionComparisonSummary: objectSchema({
      added: { type: "integer", minimum: 0 },
      updated: { type: "integer", minimum: 0 },
      unchanged: { type: "integer", minimum: 0 },
      removed: { type: "integer", minimum: 0 },
      blocked: { type: "integer", minimum: 0 },
    }),
    BoqUploadResponse: objectSchema(
      {
        jobId: uuid,
        revisionId: uuid,
        mode: { type: "string", enum: ["imported", "comparison_only"] },
        baselineLocked: { type: "boolean" },
        comparison: ref("BoqRevisionComparisonSummary"),
        document: ref("ProjectDocumentUpload"),
      },
      ["jobId", "revisionId", "mode", "baselineLocked", "document"],
    ),
    ScheduleGenerateResponse: objectSchema(
      {
        jobId: { type: "string" },
        document: ref("ProjectDocumentUpload"),
      },
      ["jobId", "document"],
    ),
    ImportResponse: objectSchema({
      staged: { type: "boolean" },
      revisionId: uuid,
      imported: { type: "integer", minimum: 0 },
      updated: { type: "integer", minimum: 0 },
      notMatched: { type: "integer", minimum: 0 },
      message: { type: "string" },
      document: ref("ProjectDocumentUpload"),
    }),
    ActivityDependencyInput: objectSchema({
      predecessorId: uuid,
      predecessorActivityId: uuid,
      predecessorRef: { type: "string" },
      relationshipType: { type: "string", enum: ["FS", "SS", "FF", "SF"] },
      lagDays: { type: "integer" },
    }),
    ActivityDependency: objectSchema({
      id: uuid,
      projectId: uuid,
      predecessorId: uuid,
      successorId: uuid,
      relationshipType: { type: "string", enum: ["FS", "SS", "FF", "SF"] },
      lagDays: {
        type: "integer",
        description: "Working-day lag; negative values represent lead.",
      },
      source: {
        type: "string",
        enum: ["manual", "import", "ai", "migration"],
        nullable: true,
      },
      importSource: { type: "string", nullable: true },
      externalPredecessorRef: { type: "string", nullable: true },
      externalSuccessorRef: { type: "string", nullable: true },
      importMetadata: freeObject("Import-specific relationship metadata."),
      predecessor: {
        ...objectSchema({
          id: uuid,
          name: { type: "string" },
          activityCode: { type: "string", nullable: true },
          wbsCode: { type: "string", nullable: true },
          p6ActivityId: { type: "string", nullable: true },
        }),
        nullable: true,
      },
    }),
    ScheduleProcurementRiskItem: objectSchema({
      id: uuid,
      status: {
        type: "string",
        enum: ["open", "acknowledged", "resolved"],
      },
      severity: {
        type: "string",
        enum: ["none", "low", "medium", "high", "critical"],
      },
      reason: { type: "string" },
      daysAtRisk: { type: "integer", minimum: 0 },
      needDate: nullableDateString,
      orderByDate: nullableDateString,
      expectedDeliveryDate: nullableDateString,
      source: { type: "string" },
      item: { type: "string" },
      ref: { type: "string", nullable: true },
    }),
    ScheduleProcurementRiskSummary: objectSchema({
      atRiskCount: { type: "integer", minimum: 0 },
      openCount: { type: "integer", minimum: 0 },
      acknowledgedCount: { type: "integer", minimum: 0 },
      highestSeverity: {
        type: "string",
        enum: ["none", "low", "medium", "high", "critical"],
      },
      reason: { type: "string" },
      daysAtRisk: { type: "integer", minimum: 0 },
      needDate: nullableDateString,
      orderByDate: nullableDateString,
      expectedDeliveryDate: nullableDateString,
      items: arrayOf(ref("ScheduleProcurementRiskItem")),
    }),
    ScheduleRiskItem: objectSchema({
      id: uuid,
      linkId: uuid,
      ref: { type: "string" },
      description: { type: "string" },
      severity: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
      status: { type: "string", enum: ["open", "monitoring", "submitted"] },
      owner: { type: "string", nullable: true },
      dueDate: nullableDateString,
      escalationLevel: { type: "string", enum: ["none", "watch", "escalated"] },
      relationType: { type: "string" },
      scheduleImpactDays: { type: "integer" },
      costImpact: money,
      notes: { type: "string", nullable: true },
      isOverdue: { type: "boolean" },
    }),
    ScheduleRiskSummary: objectSchema({
      count: { type: "integer", minimum: 0 },
      openCount: { type: "integer", minimum: 0 },
      monitoringCount: { type: "integer", minimum: 0 },
      submittedCount: { type: "integer", minimum: 0 },
      overdueCount: { type: "integer", minimum: 0 },
      highestSeverity: {
        type: "string",
        enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      },
      escalationLevel: { type: "string", enum: ["none", "watch", "escalated"] },
      dueDate: nullableDateString,
      items: arrayOf(ref("ScheduleRiskItem")),
    }),
    RiskActivityLink: objectSchema({
      id: uuid,
      projectId: uuid,
      riskId: uuid,
      activityId: uuid,
      relationType: { type: "string" },
      scheduleImpactDays: { type: "integer" },
      costImpact: money,
      notes: { type: "string", nullable: true },
      activity: ref("GenericObject"),
      createdAt: nullableDateString,
      updatedAt: nullableDateString,
    }),
    RiskMutation: objectSchema({
      description: { type: "string" },
      probability: { type: "string", enum: ["low", "medium", "high"] },
      impact: { type: "string", enum: ["low", "medium", "high"] },
      severity: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
      mitigation: { type: "string", nullable: true },
      responsePlan: { type: "string", nullable: true },
      residualProbability: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
      residualImpact: { type: "string", enum: ["low", "medium", "high"] },
      residualSeverity: {
        type: "string",
        enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      },
      residualDescription: { type: "string", nullable: true },
      phase: { type: "string", nullable: true },
      owner: { type: "string", nullable: true },
      dueDate: nullableDateString,
      escalationLevel: { type: "string", enum: ["none", "watch", "escalated"] },
      escalationNotes: { type: "string", nullable: true },
      status: { type: "string", enum: ["open", "monitoring"] },
      activityId: nullableUuid,
      activityIds: arrayOf(uuid),
      activityLinks: arrayOf(ref("ActivityLinkInput")),
      comment: { type: "string", nullable: true },
    }),
    RiskCloseoutPayload: objectSchema({
      dueDate: nullableDateString,
      responsePlan: { type: "string", nullable: true },
      closeoutComment: { type: "string", nullable: true },
      comment: { type: "string", nullable: true },
      reason: { type: "string", nullable: true },
    }),
    RiskRecord: objectSchema({
      id: uuid,
      projectId: uuid,
      ref: { type: "string" },
      description: { type: "string" },
      probability: { type: "string", enum: ["low", "medium", "high"] },
      impact: { type: "string", enum: ["low", "medium", "high"] },
      severity: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
      mitigation: { type: "string", nullable: true },
      responsePlan: { type: "string", nullable: true },
      residualProbability: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
      residualImpact: { type: "string", enum: ["low", "medium", "high"] },
      residualSeverity: {
        type: "string",
        enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      },
      residualDescription: { type: "string", nullable: true },
      phase: { type: "string", nullable: true },
      owner: { type: "string", nullable: true },
      dueDate: nullableDateString,
      escalationLevel: { type: "string", enum: ["none", "watch", "escalated"] },
      escalationNotes: { type: "string", nullable: true },
      status: {
        type: "string",
        enum: ["open", "monitoring", "submitted", "closed", "archived"],
      },
      closeoutComment: { type: "string", nullable: true },
      closeoutSubmittedBy: { type: "string", nullable: true },
      closeoutSubmittedAt: nullableDateString,
      closedBy: { type: "string", nullable: true },
      closedAt: nullableDateString,
      rejectedBy: { type: "string", nullable: true },
      rejectedAt: nullableDateString,
      rejectionReason: { type: "string", nullable: true },
      reopenedBy: { type: "string", nullable: true },
      reopenedAt: nullableDateString,
      archivedAt: nullableDateString,
      archivedBy: { type: "string", nullable: true },
      activityLinks: arrayOf(ref("RiskActivityLink")),
      activityIds: arrayOf(uuid),
      approvalHistory: arrayOf(ref("GenericObject")),
      createdAt: nullableDateString,
      updatedAt: nullableDateString,
    }),
    LocationRecord: objectSchema({
      id: uuid,
      projectId: uuid,
      parentId: { type: "string", format: "uuid", nullable: true },
      name: { type: "string" },
      code: { type: "string", nullable: true },
      kind: {
        type: "string",
        enum: ["site", "building", "level", "zone", "room", "area", "external"],
      },
      path: {
        type: "string",
        description: "Materialized path of location ids from the root.",
      },
      pathNames: arrayOf({ type: "string" }),
      fullName: { type: "string" },
      depth: { type: "integer" },
      sortOrder: { type: "integer" },
      status: { type: "string", enum: ["active", "archived"] },
      description: { type: "string", nullable: true },
      childCount: { type: "integer" },
      createdBy: { type: "string", nullable: true },
      updatedBy: { type: "string", nullable: true },
      archivedAt: nullableDateString,
      archivedBy: { type: "string", nullable: true },
      createdAt: nullableDateString,
      updatedAt: nullableDateString,
    }),
    LocationTreeNode: {
      allOf: [
        ref("LocationRecord"),
        objectSchema({ children: arrayOf(ref("GenericObject")) }),
      ],
    },
    LocationListResponse: objectSchema({
      items: arrayOf(ref("LocationRecord")),
      tree: arrayOf(ref("LocationTreeNode")),
      summary: objectSchema({
        total: { type: "integer" },
        active: { type: "integer" },
        archived: { type: "integer" },
        roots: { type: "integer" },
        maxDepth: { type: "integer" },
      }),
    }),
    LocationMutation: objectSchema({
      name: { type: "string", maxLength: 120 },
      code: { type: "string", maxLength: 40, nullable: true },
      kind: {
        type: "string",
        enum: ["site", "building", "level", "zone", "room", "area", "external"],
      },
      parentId: { type: "string", format: "uuid", nullable: true },
      description: { type: "string", maxLength: 1000, nullable: true },
      sortOrder: { type: "integer", minimum: 0, nullable: true },
    }),
    LocationReorderPayload: objectSchema(
      {
        parentId: { type: "string", format: "uuid", nullable: true },
        orderedIds: arrayOf(uuid),
      },
      ["orderedIds"],
    ),
    LocationReasonPayload: objectSchema({
      reason: { type: "string", maxLength: 500, nullable: true },
    }),
    LocationArchiveResponse: objectSchema({
      id: uuid,
      status: { type: "string", enum: ["archived"] },
      archived: { type: "boolean" },
      deleted: { type: "boolean" },
      affectedCount: { type: "integer" },
      affectedIds: arrayOf(uuid),
    }),
    BackgroundJob: objectSchema({
      id: uuid,
      orgId: uuid,
      projectId: { type: "string", format: "uuid", nullable: true },
      type: {
        type: "string",
        enum: [
          "boq.parse",
          "schedule.generate",
          "schedule.import",
          "document.extract",
          "report.render",
          "notification.deliver",
        ],
      },
      status: {
        type: "string",
        enum: ["queued", "running", "succeeded", "failed", "cancelled"],
      },
      priority: { type: "integer" },
      attempts: { type: "integer" },
      maxAttempts: { type: "integer" },
      payload: freeObject("Job input; never contains secrets."),
      progress: freeObject(
        "Progress fields: step, currentStep, totalSteps, steps, progress (0-100), message.",
      ),
      result: { ...freeObject("Handler result merged over enqueue context."), nullable: true },
      error: {
        ...objectSchema({
          code: { type: "string" },
          message: { type: "string" },
          details: freeObject("Optional structured details."),
        }),
        nullable: true,
      },
      requestedBy: { type: "string", nullable: true },
      lockedBy: { type: "string", nullable: true },
      runAfter: nullableDateString,
      startedAt: nullableDateString,
      finishedAt: nullableDateString,
      heartbeatAt: nullableDateString,
      expiresAt: nullableDateString,
      createdAt: nullableDateString,
      updatedAt: nullableDateString,
      canRetry: { type: "boolean" },
      isTerminal: { type: "boolean" },
    }),
    BackgroundJobListResponse: objectSchema({
      items: arrayOf(ref("BackgroundJob")),
      summary: objectSchema({
        queued: { type: "integer" },
        running: { type: "integer" },
        failed: { type: "integer" },
        succeeded: { type: "integer" },
      }),
    }),
    PermissionLevel: {
      type: "string",
      enum: ["none", "read_only", "standard", "admin"],
      description:
        "none hides the module; read_only allows read/export; standard is what the template's base role can do; admin is every action and transition.",
    },
    PermissionTemplateRef: objectSchema(
      { id: uuid, name: { type: "string" } },
      ["id", "name"],
    ),
    PermissionTemplateTool: objectSchema(
      { module: { type: "string" }, level: ref("PermissionLevel") },
      ["module", "level"],
    ),
    PermissionTemplateGrant: objectSchema(
      {
        module: { type: "string" },
        action: { type: "string", nullable: true },
        transition: { type: "string", nullable: true },
        key: {
          type: "string",
          description:
            '"<module>|action:<action>" or "<module>|transition:<transition>".',
        },
      },
      ["module"],
    ),
    PermissionTemplate: objectSchema(
      {
        id: uuid,
        orgId: uuid,
        name: { type: "string" },
        description: { type: "string", nullable: true },
        kind: { type: "string", enum: ["internal", "external"] },
        clientType: {
          type: "string",
          enum: ["gc", "owner", "consultant", "subcontractor"],
          nullable: true,
        },
        baseRole: { type: "string", nullable: true },
        basePartyRole: { type: "string", nullable: true },
        isDefault: { type: "boolean" },
        isSystem: { type: "boolean" },
        status: { type: "string", enum: ["active", "archived"] },
        tools: arrayOf(ref("PermissionTemplateTool")),
        grants: arrayOf(ref("PermissionTemplateGrant")),
        usage: objectSchema({
          projectUsers: { type: "integer" },
          parties: { type: "integer" },
        }),
        createdBy: nullableUuid,
        updatedBy: nullableUuid,
        createdAt: nullableDateString,
        updatedAt: nullableDateString,
      },
      ["id", "orgId", "name", "kind", "status", "tools", "grants"],
    ),
    PermissionTemplateListResponse: objectSchema({
      items: arrayOf(ref("PermissionTemplate")),
    }),
    PermissionTemplateMutationRequest: objectSchema({
      name: { type: "string", maxLength: 120 },
      description: { type: "string", maxLength: 1000, nullable: true },
      kind: { type: "string", enum: ["internal", "external"] },
      clientType: {
        type: "string",
        enum: ["gc", "owner", "consultant", "subcontractor"],
        nullable: true,
      },
      baseRole: { type: "string", nullable: true },
      basePartyRole: { type: "string", nullable: true },
      status: { type: "string", enum: ["active", "archived"] },
      tools: arrayOf(ref("PermissionTemplateTool")),
      grants: arrayOf(
        objectSchema({
          module: { type: "string" },
          action: { type: "string", nullable: true },
          transition: { type: "string", nullable: true },
        }),
      ),
    }),
    PermissionCatalog: objectSchema({
      levels: arrayOf(
        objectSchema({
          id: ref("PermissionLevel"),
          label: { type: "string" },
          description: { type: "string" },
        }),
      ),
      actions: arrayOf({ type: "string" }),
      roles: arrayOf(ref("GenericObject")),
      partyRoles: arrayOf(ref("GenericObject")),
      kinds: arrayOf({ type: "string" }),
      clientTypes: arrayOf({ type: "string" }),
      modules: arrayOf(
        objectSchema({
          id: { type: "string" },
          label: { type: "string" },
          actions: arrayOf({ type: "string" }),
          transitions: arrayOf({ type: "string" }),
        }),
      ),
    }),
    PermissionModuleAccess: objectSchema({
      label: { type: "string" },
      level: ref("PermissionLevel"),
      visible: { type: "boolean" },
      actions: arrayOf({ type: "string" }),
      transitions: arrayOf({ type: "string" }),
    }),
    PermissionMatrix: objectSchema(
      {
        orgId: nullableUuid,
        projectId: nullableUuid,
        userId: nullableUuid,
        isCompanyAdmin: { type: "boolean" },
        source: {
          type: "string",
          enum: ["template", "party_template", "assignment", "party", "org"],
        },
        role: { type: "string", nullable: true },
        partyRoles: arrayOf({ type: "string" }),
        template: { allOf: [ref("PermissionTemplateRef")], nullable: true },
        modules: {
          type: "object",
          additionalProperties: ref("PermissionModuleAccess"),
        },
      },
      ["isCompanyAdmin", "source", "modules"],
    ),
    ProjectTeamMember: objectSchema({
      userId: uuid,
      name: { type: "string" },
      email: { type: "string", format: "email" },
      orgRole: { type: "string", nullable: true },
      isCompanyAdmin: { type: "boolean" },
      status: { type: "string" },
      assignmentRole: { type: "string", nullable: true },
      party: {
        allOf: [
          objectSchema({
            id: uuid,
            role: { type: "string" },
            companyId: nullableUuid,
            companyName: { type: "string", nullable: true },
            template: {
              allOf: [ref("PermissionTemplateRef")],
              nullable: true,
            },
          }),
        ],
        nullable: true,
      },
      template: { allOf: [ref("PermissionTemplateRef")], nullable: true },
      overrides: ref("GenericObject"),
      source: {
        type: "string",
        enum: ["template", "party_template", "assignment", "party", "org"],
      },
    }),
    ProjectTeamResponse: objectSchema({
      items: arrayOf(ref("ProjectTeamMember")),
      parties: arrayOf(
        objectSchema({
          id: uuid,
          role: { type: "string" },
          companyName: { type: "string", nullable: true },
          memberCount: { type: "integer" },
          template: { allOf: [ref("PermissionTemplateRef")], nullable: true },
        }),
      ),
    }),
    ProjectUserPermissionRequest: objectSchema({
      templateId: nullableUuid,
      overrides: objectSchema({
        tools: {
          type: "object",
          additionalProperties: ref("PermissionLevel"),
        },
        grants: arrayOf({ type: "string" }),
      }),
    }),
    ProjectUserPermission: objectSchema({
      id: uuid,
      projectId: uuid,
      userId: uuid,
      template: { allOf: [ref("PermissionTemplateRef")], nullable: true },
      overrides: ref("GenericObject"),
      assignedBy: nullableUuid,
      updatedAt: nullableDateString,
    }),
    ProjectPartyPermissionRequest: objectSchema({
      templateId: nullableUuid,
    }),
    UserReference: objectSchema(
      {
        id: uuid,
        name: { type: "string", nullable: true },
        email: { type: "string", nullable: true },
      },
      ["id"],
    ),
    CompanyReference: objectSchema(
      { id: uuid, name: { type: "string", nullable: true } },
      ["id"],
    ),
    AssignmentReferences: {
      type: "object",
      description:
        "Accountability references present on every workflow record (OCTA-DATA-REFS-004). Legacy text fields (owner, reviewer, approver, assignee, responsible) remain readable for one release.",
      properties: {
        ownerUserId: nullableUuid,
        reviewerUserId: nullableUuid,
        approverUserId: nullableUuid,
        assigneeUserId: nullableUuid,
        assigneeCompanyId: nullableUuid,
        ballInCourtUserId: nullableUuid,
        ownerUser: { allOf: [ref("UserReference")], nullable: true },
        reviewerUser: { allOf: [ref("UserReference")], nullable: true },
        approverUser: { allOf: [ref("UserReference")], nullable: true },
        assigneeUser: { allOf: [ref("UserReference")], nullable: true },
        ballInCourtUser: { allOf: [ref("UserReference")], nullable: true },
        assigneeCompany: { allOf: [ref("CompanyReference")], nullable: true },
      },
    },
    AssignmentRecordType: {
      type: "string",
      enum: [
        "risk",
        "ncr",
        "itp",
        "defect",
        "safety_incident",
        "material_test",
        "rfi",
        "submittal",
        "drawing",
        "transmittal",
        "correspondence",
      ],
    },
    UnresolvedAssignmentReport: objectSchema({
      projectId: uuid,
      projectName: { type: "string" },
      total: { type: "integer" },
      byType: { type: "object", additionalProperties: { type: "integer" } },
      items: arrayOf(
        objectSchema({
          recordType: ref("AssignmentRecordType"),
          recordId: uuid,
          ref: { type: "string" },
          title: { type: "string", nullable: true },
          status: { type: "string", nullable: true },
          field: { type: "string" },
          textField: { type: "string" },
          value: { type: "string" },
          label: { type: "string" },
        }),
      ),
    }),
    ResolveAssignmentRequest: objectSchema(
      {
        recordType: ref("AssignmentRecordType"),
        recordId: uuid,
        field: {
          type: "string",
          enum: [
            "ownerUserId",
            "reviewerUserId",
            "approverUserId",
            "assigneeUserId",
            "ballInCourtUserId",
            "assigneeCompanyId",
          ],
        },
        userId: nullableUuid,
        companyId: nullableUuid,
      },
      ["recordType", "recordId", "field"],
    ),
    ResolveAssignmentResponse: objectSchema({
      recordType: ref("AssignmentRecordType"),
      recordId: uuid,
      field: { type: "string" },
      value: { type: "string", nullable: true },
      ballInCourtUserId: nullableUuid,
    }),
    MyOpenItem: objectSchema({
      recordType: ref("AssignmentRecordType"),
      label: { type: "string" },
      recordId: uuid,
      ref: { type: "string" },
      title: { type: "string", nullable: true },
      status: { type: "string", nullable: true },
      projectId: uuid,
      projectName: { type: "string", nullable: true },
      roles: arrayOf({
        type: "string",
        enum: ["owner", "reviewer", "approver", "assignee", "ballInCourt"],
      }),
      ballInCourt: { type: "boolean" },
      dueDate: nullableDateString,
      overdue: { type: "boolean" },
      updatedAt: nullableDateString,
      target: freeObject("Workspace navigation target."),
    }),
    MyOpenItemsResponse: objectSchema({
      items: arrayOf(ref("MyOpenItem")),
      summary: objectSchema({
        total: { type: "integer" },
        overdue: { type: "integer" },
        ballInCourt: { type: "integer" },
        byType: { type: "object", additionalProperties: { type: "integer" } },
      }),
    }),
    AttachmentRecordType: {
      type: "string",
      description: "Record type an attachment belongs to; permission follows the record's module.",
      enum: [
        "risk",
        "ncr",
        "itp",
        "defect",
        "material_test",
        "safety_incident",
        "rfi",
        "submittal",
        "drawing",
        "transmittal",
        "correspondence",
        "document",
        "task",
        "daily_report",
        "site_diary",
        "progress_submission",
        "activity",
        "change_order",
        "ipc",
        "ipc_certificate",
        "sub_valuation",
        "eot",
        "weather_delay",
        "meeting",
        "meeting_action",
        "procurement_order",
        "procurement_package",
        "delivery_receipt",
        "cost_record",
        "boq_item",
        "location",
        "project",
      ],
    },
    AttachmentDocument: objectSchema({
      id: uuid,
      fileName: { type: "string" },
      originalName: { type: "string", nullable: true },
      mimeType: { type: "string" },
      sizeBytes: { type: "integer" },
      documentType: { type: "string" },
      uploadedBy: nullableUuid,
      uploadedAt: nullableDateString,
      url: { type: "string" },
    }),
    Photo: objectSchema({
      id: uuid,
      documentId: uuid,
      locationId: nullableUuid,
      location: {
        allOf: [
          objectSchema({
            id: uuid,
            name: { type: "string" },
            fullName: { type: "string", nullable: true },
            path: { type: "string" },
          }),
        ],
        nullable: true,
      },
      caption: { type: "string", nullable: true },
      tags: arrayOf({ type: "string" }),
      takenAt: nullableDateString,
      latitude: { type: "number", nullable: true },
      longitude: { type: "number", nullable: true },
      altitude: { type: "number", nullable: true },
      cameraMake: { type: "string", nullable: true },
      cameraModel: { type: "string", nullable: true },
      width: { type: "integer", nullable: true },
      height: { type: "integer", nullable: true },
      orientation: { type: "integer", nullable: true },
      thumbnailStatus: {
        type: "string",
        enum: ["pending", "ready", "unavailable", "failed"],
      },
      url: { type: "string" },
      thumbnailUrl: { type: "string" },
      uploadedBy: nullableUuid,
      createdAt: nullableDateString,
      updatedAt: nullableDateString,
      document: { allOf: [ref("AttachmentDocument")], nullable: true },
      records: arrayOf(
        objectSchema({
          recordType: ref("AttachmentRecordType"),
          recordId: { type: "string" },
          role: { type: "string" },
        }),
      ),
    }),
    Attachment: objectSchema({
      id: uuid,
      projectId: uuid,
      recordType: ref("AttachmentRecordType"),
      recordId: { type: "string" },
      documentId: uuid,
      role: {
        type: "string",
        enum: ["attachment", "evidence", "photo", "reference"],
      },
      caption: { type: "string", nullable: true },
      sortOrder: { type: "integer" },
      source: { type: "string" },
      uploadedBy: nullableUuid,
      createdAt: nullableDateString,
      document: { allOf: [ref("AttachmentDocument")], nullable: true },
      photo: { allOf: [ref("Photo")], nullable: true },
      fileName: { type: "string", nullable: true },
      fileUrl: { type: "string", nullable: true },
      mimeType: { type: "string", nullable: true },
      sizeBytes: { type: "integer", nullable: true },
    }),
    AttachmentListResponse: objectSchema({
      items: arrayOf(ref("Attachment")),
    }),
    PhotoListResponse: objectSchema({
      items: arrayOf(ref("Photo")),
      pagination: objectSchema({
        limit: { type: "integer" },
        nextCursor: nullableUuid,
      }),
      summary: objectSchema({
        total: { type: "integer" },
        tags: arrayOf(
          objectSchema({ tag: { type: "string" }, count: { type: "integer" } }),
        ),
      }),
    }),
    PhotoUpdateRequest: objectSchema({
      caption: { type: "string", nullable: true, maxLength: 500 },
      tags: {
        oneOf: [arrayOf({ type: "string" }), { type: "string" }],
        description: "Array or comma-separated list; lower-cased and de-duplicated.",
      },
      locationId: nullableUuid,
      takenAt: nullableDateString,
    }),
    CommentAuthor: objectSchema({
      id: uuid,
      name: { type: "string" },
      email: { type: "string", nullable: true },
    }),
    CommentMention: objectSchema({
      userId: uuid,
      name: { type: "string", nullable: true },
      email: { type: "string", nullable: true },
    }),
    Comment: objectSchema({
      id: uuid,
      projectId: uuid,
      recordType: ref("AttachmentRecordType"),
      recordId: { type: "string" },
      parentId: nullableUuid,
      body: { type: "string", description: "Empty when the comment was removed." },
      author: { ...ref("CommentAuthor"), nullable: true },
      authorId: nullableUuid,
      mentions: arrayOf(ref("CommentMention")),
      editedAt: nullableDateString,
      deletedAt: nullableDateString,
      createdAt: dateString,
      updatedAt: dateString,
      canEdit: { type: "boolean", description: "True for the author of a live comment." },
      canDelete: {
        type: "boolean",
        description: "True for the author, project managers and company admins.",
      },
    }),
    CommentListResponse: objectSchema({
      items: arrayOf(ref("Comment")),
      pagination: objectSchema({
        limit: { type: "integer" },
        nextCursor: nullableUuid,
      }),
    }),
    CommentCreateRequest: objectSchema(
      {
        recordType: ref("AttachmentRecordType"),
        recordId: { type: "string" },
        body: { type: "string", minLength: 1, maxLength: 5000 },
        mentionUserIds: {
          ...arrayOf(uuid),
          maxItems: 20,
          description:
            "Users to @mention. Each must be an active member with access to the project; they are notified and start following the record.",
        },
        parentId: { ...nullableUuid, description: "Comment being replied to." },
      },
      ["recordType", "recordId", "body"],
    ),
    CommentUpdateRequest: objectSchema({
      body: { type: "string", minLength: 1, maxLength: 5000 },
      mentionUserIds: {
        ...arrayOf(uuid),
        maxItems: 20,
        description: "Replaces the mention list; newly mentioned users are notified.",
      },
    }),
    RecordSubscription: objectSchema({
      id: uuid,
      projectId: uuid,
      recordType: ref("AttachmentRecordType"),
      recordId: { type: "string" },
      userId: uuid,
      user: { ...ref("CommentAuthor"), nullable: true },
      reason: {
        type: "string",
        enum: ["manual", "created", "commented", "mentioned", "assigned"],
      },
      muted: { type: "boolean", description: "Explicit unfollow." },
      path: {
        type: "string",
        nullable: true,
        description: "App path that opens the record in its workspace module.",
      },
      createdAt: dateString,
      updatedAt: dateString,
    }),
    RecordSubscriptionState: objectSchema({
      recordType: ref("AttachmentRecordType"),
      recordId: { type: "string" },
      following: { type: "boolean" },
      subscription: { ...ref("RecordSubscription"), nullable: true },
      subscribers: arrayOf(ref("RecordSubscription")),
      count: { type: "integer" },
    }),
    RecordSubscriptionRequest: objectSchema(
      {
        recordType: ref("AttachmentRecordType"),
        recordId: { type: "string" },
        follow: { type: "boolean" },
      },
      ["recordType", "recordId", "follow"],
    ),
    MySubscriptionsResponse: objectSchema({
      items: arrayOf({
        allOf: [
          ref("RecordSubscription"),
          objectSchema({ label: { type: "string" } }),
        ],
      }),
    }),
    DocumentTextSummary: objectSchema({
      status: { type: "string", enum: ["pending", "ready", "unsupported", "failed"] },
      extractor: { type: "string", nullable: true },
      wordCount: { type: "integer" },
      pageCount: { type: "integer", nullable: true },
      embeddingStatus: {
        type: "string",
        enum: ["none", "pending", "ready", "failed", "disabled"],
      },
    }),
    DocumentSearchHit: objectSchema({
      documentId: uuid,
      projectId: uuid,
      title: { type: "string" },
      fileName: { type: "string" },
      originalName: { type: "string", nullable: true },
      documentNumber: { type: "string", nullable: true },
      mimeType: { type: "string" },
      sizeBytes: { type: "integer" },
      documentType: { type: "string" },
      folderPath: { type: "string", nullable: true },
      uploadedAt: nullableDateString,
      rank: { type: "number", description: "Postgres ts_rank_cd score (relative)." },
      semanticScore: {
        type: "number",
        nullable: true,
        description: "Cosine similarity of the best chunk when embeddings are enabled.",
      },
      score: { type: "number", description: "Combined 0-1 score used for ordering." },
      snippet: {
        type: "string",
        nullable: true,
        description: "Headline with matches wrapped in [[ and ]].",
      },
      snippetText: { type: "string", nullable: true },
      matchedChunk: { type: "string", nullable: true },
      text: { ...ref("DocumentTextSummary"), nullable: true },
      revision: {
        nullable: true,
        ...objectSchema({
          id: uuid,
          recordType: { type: "string" },
          recordId: { type: "string" },
          revision: { type: "string" },
          status: { type: "string", nullable: true },
          isLatest: { type: "boolean" },
        }),
      },
      records: arrayOf(
        objectSchema({
          recordType: { type: "string" },
          recordId: { type: "string" },
          role: { type: "string" },
          path: { type: "string", nullable: true },
        }),
      ),
      path: {
        type: "string",
        nullable: true,
        description: "Workspace path that opens the linked record.",
      },
      fileUrl: { type: "string" },
    }),
    DocumentSearchResponse: objectSchema({
      query: { type: "string", nullable: true },
      items: arrayOf(ref("DocumentSearchHit")),
      meta: objectSchema({
        limit: { type: "integer" },
        total: { type: "integer" },
        mode: { type: "string", enum: ["text", "hybrid"] },
        embeddings: objectSchema({
          enabled: { type: "boolean" },
          provider: { type: "string", nullable: true },
          model: { type: "string", nullable: true },
        }),
      }),
    }),
    DocumentTextResponse: objectSchema({
      document: ref("DocumentSearchHit"),
      text: {
        nullable: true,
        ...objectSchema({
          documentId: uuid,
          status: { type: "string" },
          extractor: { type: "string", nullable: true },
          excerpt: { type: "string", nullable: true },
          wordCount: { type: "integer" },
          pageCount: { type: "integer", nullable: true },
          chunkCount: { type: "integer" },
          embeddingStatus: { type: "string" },
          embeddingModel: { type: "string", nullable: true },
          error: { type: "string", nullable: true },
          extractedAt: nullableDateString,
          text: { type: "string" },
          truncated: { type: "boolean" },
          totalChars: { type: "integer" },
        }),
      },
      extractable: { type: "boolean" },
    }),
    DocumentIndexStatus: objectSchema({
      documents: { type: "integer" },
      indexed: { type: "integer" },
      notIndexed: { type: "integer" },
      counts: objectSchema({
        pending: { type: "integer" },
        ready: { type: "integer" },
        unsupported: { type: "integer" },
        failed: { type: "integer" },
      }),
      embeddings: objectSchema({
        enabled: { type: "boolean" },
        provider: { type: "string", nullable: true },
        model: { type: "string", nullable: true },
      }),
    }),
    DocumentReindexResponse: objectSchema({
      total: { type: "integer" },
      queued: { type: "integer" },
      skipped: { type: "integer" },
      unsupported: { type: "integer" },
    }),
    DocumentExtractResponse: objectSchema({
      queued: { type: "boolean" },
      status: { type: "string" },
      jobId: nullableUuid,
    }),
    SheetRevision: objectSchema({
      id: uuid,
      projectId: uuid,
      sheetId: nullableUuid,
      setId: nullableUuid,
      documentId: uuid,
      pageNumber: { type: "integer", description: "Page inside the stored PDF." },
      number: { type: "string", nullable: true },
      title: { type: "string", nullable: true },
      revision: { type: "string", nullable: true },
      discipline: { type: "string", nullable: true },
      status: { type: "string", enum: ["pending_review", "published", "superseded", "rejected"] },
      detected: objectSchema({
        number: { type: "string", nullable: true },
        title: { type: "string", nullable: true },
        revision: { type: "string", nullable: true },
        discipline: { type: "string", nullable: true },
      }),
      confidence: { type: "number", description: "0-1 average of number and title confidence." },
      fields: { type: "object", nullable: true, description: "Per-field confidence and source." },
      textStatus: { type: "string", enum: ["none", "ready", "no_text"] },
      width: { type: "number", nullable: true, description: "Page width in PDF points." },
      height: { type: "number", nullable: true },
      rotation: { type: "integer" },
      reviewedBy: nullableUuid,
      reviewedAt: nullableDateString,
      publishedBy: nullableUuid,
      publishedAt: nullableDateString,
      supersededById: nullableUuid,
      supersededAt: nullableDateString,
      createdBy: nullableUuid,
      createdAt: dateString,
      updatedAt: dateString,
      fileUrl: { type: "string", nullable: true },
      fileName: { type: "string", nullable: true },
      sizeBytes: { type: "integer", nullable: true },
      path: { type: "string", nullable: true, description: "Workspace path that opens the sheet." },
    }),
    Sheet: objectSchema({
      id: uuid,
      projectId: uuid,
      number: { type: "string" },
      title: { type: "string" },
      discipline: { type: "string", nullable: true },
      locationId: nullableUuid,
      location: {
        nullable: true,
        ...objectSchema({ id: uuid, name: { type: "string" }, code: { type: "string", nullable: true }, path: { type: "string" } }),
      },
      status: { type: "string", enum: ["current", "obsolete"] },
      obsoleteReason: { type: "string", nullable: true },
      scaleRatio: { type: "number", nullable: true },
      currentRevisionId: nullableUuid,
      currentRevision: { ...ref("SheetRevision"), nullable: true },
      revisionCount: { type: "integer", nullable: true },
      revisions: arrayOf(ref("SheetRevision")),
      drawingRecordId: nullableUuid,
      hasFile: { type: "boolean" },
      path: { type: "string", nullable: true },
      createdAt: dateString,
      updatedAt: dateString,
    }),
    DrawingSet: objectSchema({
      id: uuid,
      projectId: uuid,
      setNumber: { type: "string" },
      name: { type: "string" },
      description: { type: "string", nullable: true },
      discipline: { type: "string", nullable: true },
      purpose: { type: "string", nullable: true, enum: ["IFC", "IFT", "IFA", "AS_BUILT", "TENDER", "SHOP", "RECORD", "OTHER", null] },
      status: { type: "string", enum: ["draft", "processing", "review", "published", "archived", "failed"] },
      sourceDocumentId: nullableUuid,
      fileUrl: { type: "string", nullable: true },
      fileName: { type: "string", nullable: true },
      sizeBytes: { type: "integer", nullable: true },
      pageCount: { type: "integer", nullable: true },
      processedPages: { type: "integer" },
      progress: { type: "integer", description: "0-100 while processing." },
      detectionSummary: { type: "object", nullable: true },
      counts: {
        nullable: true,
        ...objectSchema({
          total: { type: "integer" },
          pending: { type: "integer" },
          published: { type: "integer" },
          superseded: { type: "integer" },
          rejected: { type: "integer" },
        }),
      },
      receivedAt: nullableDateString,
      issuedAt: nullableDateString,
      uploadedBy: nullableUuid,
      publishedAt: nullableDateString,
      publishedBy: nullableUuid,
      jobId: nullableUuid,
      error: { type: "string", nullable: true },
      path: { type: "string", nullable: true },
      revisions: arrayOf(ref("SheetRevision")),
      createdAt: dateString,
      updatedAt: dateString,
    }),
    DrawingSetListResponse: objectSchema({ items: arrayOf(ref("DrawingSet")) }),
    DrawingSetUpdateRequest: objectSchema({
      name: { type: "string", maxLength: 160 },
      description: { type: "string", nullable: true, maxLength: 2000 },
      discipline: { type: "string", nullable: true, maxLength: 80 },
      purpose: { type: "string", nullable: true },
      receivedAt: nullableDateString,
      issuedAt: nullableDateString,
      status: { type: "string", enum: ["archived", "review", "published"] },
    }),
    SheetRevisionReviewRequest: objectSchema(
      {
        updates: arrayOf(
          objectSchema(
            {
              id: uuid,
              number: { type: "string", nullable: true, maxLength: 40 },
              title: { type: "string", nullable: true, maxLength: 200 },
              revision: { type: "string", nullable: true, maxLength: 20 },
              discipline: { type: "string", nullable: true, maxLength: 80 },
              status: { type: "string", enum: ["pending_review", "rejected"] },
            },
            ["id"],
          ),
        ),
      },
      ["updates"],
    ),
    SheetRevisionListResponse: objectSchema({
      items: arrayOf(ref("SheetRevision")),
      counts: { type: "object", nullable: true },
      currentRevisionId: nullableUuid,
    }),
    DrawingSetPublishRequest: objectSchema({
      revisionIds: { ...arrayOf(uuid), description: "Subset to publish; defaults to every reviewed page with a number." },
    }),
    SheetPublishResult: objectSchema({
      sheetId: uuid,
      number: { type: "string" },
      title: { type: "string" },
      revisionId: uuid,
      revision: { type: "string" },
      supersededRevisionId: nullableUuid,
      isNewSheet: { type: "boolean" },
    }),
    DrawingSetPublishResponse: objectSchema({
      published: { type: "integer" },
      skipped: { type: "integer", description: "Pending pages without a sheet number." },
      remaining: { type: "integer" },
      results: arrayOf(ref("SheetPublishResult")),
      set: ref("DrawingSet"),
    }),
    SheetListResponse: objectSchema({
      items: arrayOf(ref("Sheet")),
      summary: objectSchema({
        total: { type: "integer" },
        current: { type: "integer" },
        obsolete: { type: "integer" },
        disciplines: arrayOf(objectSchema({ discipline: { type: "string" }, count: { type: "integer" } })),
      }),
    }),
    SheetUpdateRequest: objectSchema({
      title: { type: "string", maxLength: 200 },
      discipline: { type: "string", nullable: true, maxLength: 80 },
      locationId: nullableUuid,
      status: { type: "string", enum: ["current", "obsolete"] },
      obsoleteReason: { type: "string", nullable: true, maxLength: 500 },
      scaleRatio: { type: "number", nullable: true, description: "Drawing scale denominator (100 for 1:100) used by the measure tool." },
    }),
    SheetRevisionUploadResponse: objectSchema({
      revision: ref("SheetRevision"),
      published: { ...ref("SheetPublishResult"), nullable: true },
    }),
    MarkupShape: {
      type: "object",
      description:
        "Vector shape with 0..1 normalised coordinates. `rect`/`ellipse`/`highlight`/`cloud`/`text` use x,y,w,h; `line`/`arrow`/`measure` use two points; `polyline` any number.",
      properties: {
        id: { type: "string" },
        type: { type: "string", enum: ["rect", "ellipse", "line", "arrow", "polyline", "cloud", "text", "measure", "highlight"] },
        color: { type: "string", description: "Hex colour." },
        strokeWidth: { type: "number" },
        x: { type: "number" },
        y: { type: "number" },
        w: { type: "number" },
        h: { type: "number" },
        points: arrayOf(objectSchema({ x: { type: "number" }, y: { type: "number" } })),
        text: { type: "string", maxLength: 500 },
        fontSize: { type: "number" },
        label: { type: "string", nullable: true },
        fill: { type: "boolean" },
      },
      required: ["type"],
    },
    Markup: objectSchema({
      id: uuid,
      projectId: uuid,
      sheetId: uuid,
      sheetRevisionId: nullableUuid,
      authorId: nullableUuid,
      authorName: { type: "string", nullable: true },
      visibility: { type: "string", enum: ["personal", "published"] },
      name: { type: "string", nullable: true },
      shapes: arrayOf(ref("MarkupShape")),
      shapeCount: { type: "integer" },
      publishedAt: nullableDateString,
      createdAt: dateString,
      updatedAt: dateString,
      isMine: { type: "boolean" },
      canEdit: { type: "boolean" },
    }),
    MarkupListResponse: objectSchema({ items: arrayOf(ref("Markup")) }),
    MarkupSaveRequest: objectSchema({
      shapes: { ...arrayOf(ref("MarkupShape")), maxItems: 500 },
      name: { type: "string", nullable: true, maxLength: 120 },
      sheetRevisionId: nullableUuid,
    }),
    Pin: objectSchema({
      id: uuid,
      projectId: uuid,
      sheetId: uuid,
      sheetRevisionId: nullableUuid,
      x: { type: "number", description: "0..1 of page width." },
      y: { type: "number", description: "0..1 of page height." },
      recordType: { type: "string", enum: ["rfi", "defect", "photo", "ncr", "submittal", "task", "safety_incident", "itp", "correspondence"] },
      recordId: { type: "string" },
      recordLabel: { type: "string" },
      label: { type: "string", nullable: true },
      color: { type: "string", nullable: true },
      createdBy: nullableUuid,
      createdByName: { type: "string", nullable: true },
      createdAt: dateString,
      record: {
        nullable: true,
        ...objectSchema({
          display: { type: "string" },
          status: { type: "string", nullable: true },
          exists: { type: "boolean" },
          ref: { type: "string", nullable: true },
          thumbnailUrl: { type: "string", nullable: true },
          fileUrl: { type: "string", nullable: true },
        }),
      },
      recordPath: { type: "string", nullable: true },
      sheet: { nullable: true, ...objectSchema({ id: uuid, number: { type: "string" }, title: { type: "string" } }) },
      sheetPath: { type: "string" },
    }),
    PinListResponse: objectSchema({ items: arrayOf(ref("Pin")) }),
    PinCreateRequest: objectSchema(
      {
        x: { type: "number", minimum: 0, maximum: 1 },
        y: { type: "number", minimum: 0, maximum: 1 },
        recordType: { type: "string", enum: ["rfi", "defect", "photo", "ncr", "submittal", "task", "safety_incident", "itp", "correspondence"] },
        recordId: { type: "string", nullable: true, description: "Link an existing record." },
        create: {
          type: "object",
          nullable: true,
          description: "Create the record first (rfi: subject, question, priority, discipline, dueDate; defect: title, severity, trade, location, dueDate, assigneeUserId).",
        },
        sheetRevisionId: nullableUuid,
        label: { type: "string", nullable: true, maxLength: 80 },
        color: { type: "string", nullable: true },
      },
      ["x", "y", "recordType"],
    ),
    PinCreateResponse: objectSchema({
      pin: ref("Pin"),
      created: { nullable: true, ...objectSchema({ id: uuid, ref: { type: "string", nullable: true } }) },
    }),
    FormItem: objectSchema({
      id: uuid,
      sectionId: uuid,
      sortOrder: { type: "integer" },
      label: { type: "string" },
      description: { type: "string", nullable: true },
      responseType: { type: "string", enum: ["pass_fail", "yes_no", "checkbox", "text", "number", "choice", "date", "photo", "signature"] },
      required: { type: "boolean" },
      photoRequired: { type: "boolean" },
      isHoldPoint: { type: "boolean", description: "ITP hold point: blocks progress approval on the activity until it passes." },
      inspectionPointType: { type: "string", nullable: true, enum: ["hold", "witness", "review", null] },
      options: { nullable: true, description: "choice: string[]; number: { min, max, unit }." },
      reference: { type: "string", nullable: true },
    }),
    FormSection: objectSchema({ id: uuid, title: { type: "string" }, description: { type: "string", nullable: true }, sortOrder: { type: "integer" }, items: arrayOf(ref("FormItem")) }),
    FormTemplate: objectSchema({
      id: uuid,
      orgId: uuid,
      projectId: nullableUuid,
      scope: { type: "string", enum: ["company", "project"] },
      sourceTemplateId: nullableUuid,
      type: { type: "string", enum: ["inspection", "itp", "form", "talk"] },
      typeLabel: { type: "string" },
      name: { type: "string" },
      description: { type: "string", nullable: true },
      trade: { type: "string", nullable: true },
      version: { type: "integer" },
      status: { type: "string", enum: ["draft", "active", "archived"] },
      isSystem: { type: "boolean" },
      settings: objectSchema({ requireSignatures: arrayOf({ type: "string" }), deficiencyTarget: { type: "string" }, instructions: { type: "string", nullable: true } }),
      sectionCount: { type: "integer" },
      itemCount: { type: "integer" },
      holdPointCount: { type: "integer" },
      instanceCount: { type: "integer" },
      sections: arrayOf(ref("FormSection")),
      editable: { type: "boolean" },
      createdAt: dateString,
      updatedAt: dateString,
    }),
    FormTemplateInput: objectSchema({
      name: { type: "string", maxLength: 200 },
      description: { type: "string", nullable: true },
      trade: { type: "string", nullable: true },
      type: { type: "string", enum: ["inspection", "itp", "form", "talk"] },
      status: { type: "string", enum: ["draft", "active", "archived"] },
      settings: objectSchema({ requireSignatures: arrayOf({ type: "string", enum: ["inspector", "approver", "subcontractor", "witness", "attendee"] }), deficiencyTarget: { type: "string", enum: ["punch_item", "observation"] }, instructions: { type: "string", nullable: true } }),
      sections: {
        ...arrayOf(
          objectSchema({
            id: { ...uuid, description: "Existing section id to keep; omit for new." },
            title: { type: "string" },
            description: { type: "string", nullable: true },
            items: arrayOf(
              objectSchema({
                id: { ...uuid, description: "Existing item id to keep; omit for new. Items with answers cannot be removed." },
                label: { type: "string" },
                description: { type: "string", nullable: true },
                responseType: { type: "string" },
                required: { type: "boolean" },
                photoRequired: { type: "boolean" },
                isHoldPoint: { type: "boolean" },
                inspectionPointType: { type: "string", nullable: true },
                options: { nullable: true },
                reference: { type: "string", nullable: true },
              }),
            ),
          }),
        ),
        description: "Full structure; sending it replaces the sections and bumps the version.",
      },
    }),
    FormHoldPoint: objectSchema({
      instanceId: uuid,
      ref: { type: "string" },
      title: { type: "string" },
      itemId: uuid,
      label: { type: "string" },
      state: { type: "string", enum: ["pending", "failed", "passed"] },
      status: { type: "string" },
    }),
    FormSignature: objectSchema({
      id: uuid,
      role: { type: "string" },
      itemId: nullableUuid,
      userId: nullableUuid,
      userName: { type: "string", nullable: true },
      signerName: { type: "string" },
      signerCompany: { type: "string", nullable: true },
      documentId: nullableUuid,
      imageUrl: { type: "string", nullable: true },
      signedAt: dateString,
    }),
    FormItemResponse: objectSchema({
      id: uuid,
      value: { type: "string", nullable: true },
      numberValue: { type: "number", nullable: true },
      note: { type: "string", nullable: true },
      isDeficient: { type: "boolean" },
      deficiencyRecordType: { type: "string", nullable: true },
      deficiencyRecordId: nullableUuid,
      deficiencyPath: { type: "string", nullable: true },
      answeredBy: nullableUuid,
      answeredAt: nullableDateString,
      photoCount: { type: "integer" },
    }),
    FormInstance: objectSchema({
      id: uuid,
      projectId: uuid,
      templateId: uuid,
      templateVersion: { type: "integer" },
      template: { nullable: true, ...objectSchema({ id: uuid, name: { type: "string" }, type: { type: "string" }, version: { type: "integer" }, settings: { type: "object" }, isSystem: { type: "boolean" } }) },
      number: { type: "integer" },
      ref: { type: "string", description: "INS-001 / ITP-001 / FRM-001 / TBT-001" },
      type: { type: "string", enum: ["inspection", "itp", "form", "talk"] },
      typeLabel: { type: "string" },
      title: { type: "string" },
      status: { type: "string", enum: ["scheduled", "in_progress", "complete", "closed", "void"] },
      outcome: { type: "string", nullable: true, enum: ["pass", "fail", null] },
      activityId: nullableUuid,
      activity: { nullable: true, ...objectSchema({ id: uuid, name: { type: "string" } }) },
      locationId: nullableUuid,
      location: { nullable: true, ...objectSchema({ id: uuid, name: { type: "string" }, code: { type: "string", nullable: true }, path: { type: "string" } }) },
      sheetId: nullableUuid,
      sheet: { nullable: true, ...objectSchema({ id: uuid, number: { type: "string" }, title: { type: "string" } }) },
      assigneeUserId: nullableUuid,
      assigneeUser: { ...ref("PunchPerson"), nullable: true },
      assigneeCompanyId: nullableUuid,
      assigneeCompany: { nullable: true, ...objectSchema({ id: uuid, name: { type: "string" } }) },
      inspectorUserId: nullableUuid,
      inspectorUser: { ...ref("PunchPerson"), nullable: true },
      approverUserId: nullableUuid,
      approverUser: { ...ref("PunchPerson"), nullable: true },
      ballInCourtUserId: nullableUuid,
      ballInCourtUser: { nullable: true, ...objectSchema({ id: uuid, name: { type: "string" } }) },
      scheduledFor: nullableDateString,
      dueDate: nullableDateString,
      isOverdue: { type: "boolean" },
      recurrence: { nullable: true, ...objectSchema({ every: { type: "string", enum: ["day", "week", "month"] }, interval: { type: "integer" }, until: nullableDateString }) },
      startedAt: nullableDateString,
      completedAt: nullableDateString,
      completedBy: nullableUuid,
      closedAt: nullableDateString,
      closedBy: nullableUuid,
      reopenReason: { type: "string", nullable: true },
      summary: { nullable: true, ...objectSchema({ total: { type: "integer" }, required: { type: "integer" }, answered: { type: "integer" }, passed: { type: "integer" }, failed: { type: "integer" }, na: { type: "integer" }, deficient: { type: "integer" }, holdPoints: { type: "integer" }, holdPointsOpen: { type: "integer" } }) },
      clientRequestId: { type: "string", nullable: true },
      legacyItpId: nullableUuid,
      createdBy: nullableUuid,
      createdAt: dateString,
      updatedAt: dateString,
      path: { type: "string", nullable: true },
      sections: { ...arrayOf(objectSchema({ id: uuid, title: { type: "string" }, description: { type: "string", nullable: true }, items: arrayOf({ allOf: [ref("FormItem"), objectSchema({ response: { ...ref("FormItemResponse"), nullable: true }, signature: { ...ref("FormSignature"), nullable: true } })] }) })), description: "Detail responses only." },
      signatures: arrayOf(ref("FormSignature")),
      holdPoints: { ...arrayOf(ref("FormHoldPoint")), description: "Open hold points (ITP instances, detail only)." },
      nextInstance: { ...ref("FormInstance"), nullable: true, description: "Set by complete when a recurring copy was scheduled." },
    }),
    FormInstanceInput: objectSchema({
      templateId: { ...uuid, description: "Create only." },
      title: { type: "string", nullable: true, maxLength: 200, description: "Defaults to the template name." },
      activityId: nullableUuid,
      locationId: nullableUuid,
      sheetId: nullableUuid,
      assigneeUserId: nullableUuid,
      assigneeCompanyId: nullableUuid,
      inspectorUserId: nullableUuid,
      approverUserId: nullableUuid,
      scheduledFor: nullableDateString,
      dueDate: nullableDateString,
      recurrence: { nullable: true, ...objectSchema({ every: { type: "string", enum: ["day", "week", "month"] }, interval: { type: "integer", minimum: 1, maximum: 52 }, until: nullableDateString }) },
      startNow: { type: "boolean" },
      clientRequestId: { type: "string", nullable: true, description: "Offline idempotency key (per project)." },
      clientCreatedAt: nullableDateString,
      deviceId: { type: "string", nullable: true },
    }),
    FormResponsesRequest: objectSchema(
      {
        responses: arrayOf(
          objectSchema({
            itemId: uuid,
            value: { nullable: true, description: "pass|fail|na, yes|no|na, checked|unchecked, text, number, choice, ISO date, 'provided' (photo). Empty clears the answer." },
            note: { type: "string", nullable: true, maxLength: 2000 },
          }),
        ),
      },
      ["responses"],
    ),
    FormSignatureRequest: objectSchema(
      {
        role: { type: "string", enum: ["inspector", "approver", "subcontractor", "witness", "attendee"] },
        image: { type: "string", description: "PNG data URL (data:image/png;base64,…), ≤ 400 KB." },
        signerName: { type: "string", nullable: true, description: "Defaults to the caller's name." },
        signerCompany: { type: "string", nullable: true },
        itemId: { ...nullableUuid, description: "Signature-type item this answers, if any." },
      },
      ["role", "image"],
    ),
    FormDeficiencyRequest: objectSchema({
      target: { type: "string", enum: ["punch_item", "observation"], description: "Punch item (default) or observation (type defaults to safety for toolbox talks, quality otherwise)." },
      observationType: { type: "string", nullable: true, enum: ["safety", "quality", "commissioning", "work_to_complete", "environmental", null] },
      hazard: { type: "string", nullable: true },
      contributingCondition: { type: "string", nullable: true },
      title: { type: "string", nullable: true },
      priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
      trade: { type: "string", nullable: true },
      locationText: { type: "string", nullable: true },
      assigneeCompanyId: nullableUuid,
      assigneeUserId: nullableUuid,
      managerUserId: nullableUuid,
      finalApproverUserId: nullableUuid,
      dueDate: nullableDateString,
    }),
    FormTemplateListResponse: objectSchema({ items: arrayOf(ref("FormTemplate")), summary: objectSchema({ total: { type: "integer" }, byType: { type: "object" }, company: { type: "integer" }, project: { type: "integer" } }) }),
    FormInstanceListResponse: objectSchema({
      items: arrayOf(ref("FormInstance")),
      summary: objectSchema({ total: { type: "integer" }, open: { type: "integer" }, overdue: { type: "integer" }, failed: { type: "integer" }, awaitingClose: { type: "integer" }, holdPointsOpen: { type: "integer" }, byStatus: { type: "object" }, byType: { type: "object" } }),
    }),
    PunchPerson: objectSchema({ id: uuid, name: { type: "string" }, email: { type: "string", nullable: true } }),
    PunchItem: objectSchema({
      id: uuid,
      projectId: uuid,
      number: { type: "integer" },
      ref: { type: "string", description: "PL-001 …" },
      title: { type: "string" },
      description: { type: "string", nullable: true },
      status: { type: "string", enum: ["draft", "open", "ready_for_review", "closed", "in_dispute", "void"] },
      priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
      trade: { type: "string", nullable: true },
      activityId: nullableUuid,
      activity: { nullable: true, ...objectSchema({ id: uuid, name: { type: "string" }, code: { type: "string", nullable: true } }) },
      locationId: nullableUuid,
      location: { nullable: true, ...objectSchema({ id: uuid, name: { type: "string" }, code: { type: "string", nullable: true }, path: { type: "string" } }) },
      locationText: { type: "string", nullable: true },
      sheetId: nullableUuid,
      sheet: { nullable: true, ...objectSchema({ id: uuid, number: { type: "string" }, title: { type: "string" } }) },
      assigneeCompanyId: nullableUuid,
      assigneeCompany: { nullable: true, ...objectSchema({ id: uuid, name: { type: "string" } }) },
      assigneeUserId: nullableUuid,
      assigneeUser: { ...ref("PunchPerson"), nullable: true },
      managerUserId: nullableUuid,
      managerUser: { ...ref("PunchPerson"), nullable: true },
      finalApproverUserId: nullableUuid,
      finalApproverUser: { ...ref("PunchPerson"), nullable: true },
      ballInCourtUserId: nullableUuid,
      ballInCourtUser: { nullable: true, ...objectSchema({ id: uuid, name: { type: "string" } }) },
      dueDate: nullableDateString,
      isOverdue: { type: "boolean" },
      daysOverdue: { type: "integer" },
      openedAt: nullableDateString,
      readyAt: nullableDateString,
      closedAt: nullableDateString,
      closedBy: nullableUuid,
      reopenCount: { type: "integer" },
      disputeReason: { type: "string", nullable: true },
      distributedAt: nullableDateString,
      legacyDefectId: nullableUuid,
      kind: { type: "string", enum: ["punch", "observation"], description: "Observations share the engine (OCTA-QA-OBS-015) with their own OBS-001 numbering." },
      observationType: { type: "string", nullable: true, enum: ["safety", "quality", "commissioning", "work_to_complete", "environmental", null] },
      observationTypeLabel: { type: "string", nullable: true },
      hazard: { type: "string", nullable: true },
      contributingCondition: { type: "string", nullable: true },
      sourceRecordType: { type: "string", nullable: true, description: "Where it was raised from: form_instance, sheet, photo…" },
      sourceRecordId: { type: "string", nullable: true },
      sourcePath: { type: "string", nullable: true },
      createdBy: nullableUuid,
      createdAt: dateString,
      updatedAt: dateString,
      path: { type: "string", nullable: true },
      attachments: arrayOf(ref("GenericObject")),
      activityLinks: arrayOf(ref("GenericObject")),
      history: arrayOf(ref("GenericObject")),
      events: arrayOf(
        objectSchema({
          id: uuid,
          action: { type: "string" },
          fromStatus: { type: "string", nullable: true },
          toStatus: { type: "string", nullable: true },
          reason: { type: "string", nullable: true },
          actorId: nullableUuid,
          actorName: { type: "string", nullable: true },
          actorRole: { type: "string", nullable: true },
          metadata: { type: "object", nullable: true },
          createdAt: dateString,
        }),
      ),
    }),
    PunchItemInput: objectSchema({
      title: { type: "string", maxLength: 200 },
      clientRequestId: { type: "string", nullable: true, maxLength: 120, description: "Offline idempotency key (unique per project). Replays return the original item with `replayed: true`." },
      description: { type: "string", nullable: true, maxLength: 4000 },
      priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
      trade: { type: "string", nullable: true, maxLength: 80 },
      locationText: { type: "string", nullable: true, maxLength: 200 },
      locationId: nullableUuid,
      sheetId: nullableUuid,
      activityId: nullableUuid,
      assigneeCompanyId: nullableUuid,
      assigneeUserId: nullableUuid,
      managerUserId: nullableUuid,
      finalApproverUserId: nullableUuid,
      dueDate: nullableDateString,
      status: { type: "string", enum: ["draft", "open"], description: "Create as draft (default) or open straight away." },
      kind: { type: "string", enum: ["punch", "observation"], description: "Create only; defaults to punch." },
      observationType: { type: "string", nullable: true, enum: ["safety", "quality", "commissioning", "work_to_complete", "environmental", null], description: "Observations only; defaults to quality." },
      hazard: { type: "string", nullable: true, maxLength: 120 },
      contributingCondition: { type: "string", nullable: true, maxLength: 2000 },
      sourceRecordType: { type: "string", nullable: true, description: "Create only." },
      sourceRecordId: { type: "string", nullable: true, description: "Create only." },
      activityIds: arrayOf(uuid),
      attachmentRefs: arrayOf(ref("GenericObject")),
    }),
    PunchListResponse: objectSchema({
      items: arrayOf(ref("PunchItem")),
      summary: objectSchema({
        total: { type: "integer" },
        open: { type: "integer" },
        overdue: { type: "integer" },
        byStatus: { type: "object" },
        byCompany: arrayOf(objectSchema({ company: { type: "string" }, total: { type: "integer" }, open: { type: "integer" }, overdue: { type: "integer" } })),
        byTrade: arrayOf(objectSchema({ trade: { type: "string" }, count: { type: "integer" } })),
        byType: { ...arrayOf(objectSchema({ type: { type: "string" }, label: { type: "string" }, total: { type: "integer" }, open: { type: "integer" } })), description: "Observations by type." },
      }),
    }),
    PunchBulkRequest: objectSchema(
      {
        items: { ...arrayOf(ref("PunchItemInput")), minItems: 1, maxItems: 100 },
        defaults: { ...ref("PunchItemInput"), description: "Applied to every item unless the item sets the field." },
      },
      ["items"],
    ),
    PunchTransitionRequest: objectSchema(
      {
        action: { type: "string", enum: ["open", "ready_for_review", "close", "reopen", "dispute", "resolve_dispute", "void"] },
        reason: { type: "string", nullable: true, maxLength: 2000, description: "Required for reopen, dispute and void." },
      },
      ["action"],
    ),
    PunchDistributeRequest: objectSchema({
      kind: { type: "string", enum: ["punch", "observation"], description: "Which list to send when itemIds is empty (default punch)." },
      itemIds: { ...arrayOf(uuid), description: "Specific items; defaults to every open item for the companies." },
      companyIds: arrayOf(uuid),
      userIds: arrayOf(uuid),
      message: { type: "string", nullable: true, maxLength: 2000 },
    }),
    PunchDistributeResponse: objectSchema({
      items: { type: "integer" },
      recipients: arrayOf(objectSchema({ userId: uuid, email: { type: "string" }, delivered: { type: "boolean" }, error: { type: "string", nullable: true } })),
      distributedAt: dateString,
    }),
    SheetOfflineManifest: objectSchema({
      generatedAt: dateString,
      items: arrayOf(
        objectSchema({
          sheetId: uuid,
          number: { type: "string" },
          title: { type: "string" },
          discipline: { type: "string", nullable: true },
          revisionId: uuid,
          revision: { type: "string", nullable: true },
          documentId: uuid,
          pageNumber: { type: "integer" },
          fileUrl: { type: "string" },
          fileName: { type: "string", nullable: true },
          sizeBytes: { type: "integer", nullable: true },
          sha256: { type: "string", nullable: true },
          publishedAt: nullableDateString,
        }),
      ),
      totals: objectSchema({ sheets: { type: "integer" }, documents: { type: "integer" }, bytes: { type: "integer" } }),
    }),
    CompanyDirectoryEntry: objectSchema({
      id: uuid,
      orgId: uuid,
      name: { type: "string" },
      legalName: { type: "string", nullable: true },
      tradeName: { type: "string", nullable: true },
      registrationNumber: { type: "string", nullable: true },
      taxNumber: { type: "string", nullable: true },
      type: { type: "string" },
      email: { type: "string", nullable: true },
      phone: { type: "string", nullable: true },
      website: { type: "string", nullable: true },
      address: { type: "string", nullable: true },
      contactName: { type: "string", nullable: true },
      isVendor: { type: "boolean" },
      trades: arrayOf({ type: "string" }),
      vendorProfile: freeObject("Vendor profile (leadTimeReliability, paymentTerms, notes, …)."),
      status: { type: "string", enum: ["active", "inactive"] },
      memberCount: { type: "integer" },
      projectCount: { type: "integer" },
      supplierCount: { type: "integer" },
      createdAt: nullableDateString,
      updatedAt: nullableDateString,
    }),
    CompanyDirectoryResponse: objectSchema({
      items: arrayOf(ref("CompanyDirectoryEntry")),
      summary: objectSchema({
        companies: { type: "integer" },
        vendors: { type: "integer" },
        users: { type: "integer" },
        activeUsers: { type: "integer" },
      }),
    }),
    VendorListResponse: objectSchema({
      items: arrayOf(ref("CompanyDirectoryEntry")),
      summary: objectSchema({
        total: { type: "integer" },
        trades: arrayOf(objectSchema({ trade: { type: "string" }, count: { type: "integer" } })),
      }),
    }),
    VendorMutationRequest: objectSchema({
      name: { type: "string", maxLength: 255 },
      legalName: { type: "string", nullable: true },
      tradeName: { type: "string", nullable: true },
      registrationNumber: { type: "string", nullable: true },
      taxNumber: { type: "string", nullable: true },
      email: { type: "string", nullable: true },
      phone: { type: "string", nullable: true },
      website: { type: "string", nullable: true },
      address: { type: "string", nullable: true },
      contactName: { type: "string", nullable: true },
      trades: { oneOf: [arrayOf({ type: "string" }), { type: "string" }] },
      vendorProfile: freeObject("Free-form vendor profile."),
      leadTimeReliability: { type: "number", nullable: true },
      paymentTerms: { type: "string", nullable: true },
      notes: { type: "string", nullable: true },
      status: { type: "string", enum: ["active", "inactive"] },
      isVendor: { type: "boolean" },
    }),
    VendorMigrationReport: objectSchema({
      summary: objectSchema({
        suppliers: { type: "integer" },
        linked: { type: "integer" },
        unlinked: { type: "integer" },
        vendors: { type: "integer" },
        mergedVendors: { type: "integer" },
      }),
      merged: arrayOf(
        objectSchema({
          companyId: uuid,
          name: { type: "string" },
          suppliers: arrayOf(
            objectSchema({
              supplierId: uuid,
              name: { type: "string" },
              projectId: uuid,
              projectName: { type: "string", nullable: true },
              status: { type: "string" },
            }),
          ),
        }),
      ),
      unlinked: arrayOf(
        objectSchema({
          supplierId: uuid,
          name: { type: "string" },
          projectId: uuid,
          projectName: { type: "string", nullable: true },
        }),
      ),
    }),
    CostCode: objectSchema({
      id: uuid,
      orgId: uuid,
      code: { type: "string" },
      name: { type: "string" },
      description: { type: "string", nullable: true },
      category: {
        type: "string",
        enum: ["labour", "material", "equipment", "subcontract", "indirect", "overhead", "contingency", "other"],
      },
      parentId: nullableUuid,
      sortOrder: { type: "integer" },
      status: { type: "string", enum: ["active", "archived"] },
      childCount: { type: "integer" },
      createdAt: nullableDateString,
      updatedAt: nullableDateString,
    }),
    CostCodeListResponse: objectSchema({
      items: arrayOf(ref("CostCode")),
      summary: objectSchema({ total: { type: "integer" } }),
    }),
    CostCodeMutationRequest: objectSchema({
      code: { type: "string", maxLength: 40 },
      name: { type: "string", maxLength: 255 },
      description: { type: "string", nullable: true },
      category: { type: "string" },
      parentId: nullableUuid,
      sortOrder: { type: "integer" },
      status: { type: "string", enum: ["active", "archived"] },
    }),
    CostCodeImportRequest: objectSchema(
      {
        rows: arrayOf(
          objectSchema(
            {
              code: { type: "string" },
              name: { type: "string" },
              description: { type: "string", nullable: true },
              category: { type: "string" },
              parentCode: { type: "string", nullable: true },
              sortOrder: { type: "integer" },
            },
            ["code", "name"],
          ),
        ),
      },
      ["rows"],
    ),
    CompanyEquipment: objectSchema({
      id: uuid,
      orgId: uuid,
      name: { type: "string" },
      category: { type: "string", nullable: true },
      rateType: { type: "string", enum: ["hourly", "daily"] },
      rate: { type: "number" },
      notes: { type: "string", nullable: true },
      status: { type: "string", enum: ["active", "archived"] },
      projectCount: { type: "integer" },
      createdAt: nullableDateString,
      updatedAt: nullableDateString,
    }),
    CompanyEquipmentListResponse: objectSchema({
      items: arrayOf(ref("CompanyEquipment")),
      summary: objectSchema({ total: { type: "integer" } }),
    }),
    CompanyEquipmentMutationRequest: objectSchema({
      name: { type: "string", maxLength: 255 },
      category: { type: "string", nullable: true },
      rateType: { type: "string", enum: ["hourly", "daily"] },
      rate: { type: "number", minimum: 0 },
      notes: { type: "string", nullable: true },
      status: { type: "string", enum: ["active", "archived"] },
    }),
    ProjectTemplate: objectSchema({
      id: uuid,
      orgId: uuid,
      name: { type: "string" },
      description: { type: "string", nullable: true },
      settings: freeObject("Project field defaults (type, contractType, currency, projectCalendar, retention, …)."),
      parties: arrayOf(
        objectSchema({
          role: { type: "string", enum: ["owner", "consultant", "contractor", "subcontractor"] },
          companyId: nullableUuid,
          companyName: { type: "string", nullable: true },
          accessLevel: { type: "string" },
          permissionTemplateId: nullableUuid,
          contactName: { type: "string", nullable: true },
          contactEmail: { type: "string", nullable: true },
        }),
      ),
      folders: arrayOf({ type: "string" }),
      locations: arrayOf(freeObject("{ name, kind, code?, children[] }")),
      assignments: arrayOf(
        objectSchema({
          userId: uuid,
          role: { type: "string" },
          permissionTemplateId: nullableUuid,
        }),
      ),
      isDefault: { type: "boolean" },
      status: { type: "string", enum: ["active", "archived"] },
      usage: objectSchema({ projects: { type: "integer" } }),
      summary: objectSchema({
        parties: { type: "integer" },
        folders: { type: "integer" },
        locations: { type: "integer" },
        assignments: { type: "integer" },
      }),
      createdBy: nullableUuid,
      updatedBy: nullableUuid,
      createdAt: nullableDateString,
      updatedAt: nullableDateString,
    }),
    ProjectTemplateListResponse: objectSchema({
      items: arrayOf(ref("ProjectTemplate")),
    }),
    ProjectTemplateMutationRequest: objectSchema({
      name: { type: "string", maxLength: 120 },
      description: { type: "string", nullable: true },
      settings: freeObject("Project field defaults."),
      parties: arrayOf(freeObject("{ role, companyId? | companyName, accessLevel?, permissionTemplateId? }")),
      folders: arrayOf({ type: "string" }),
      locations: arrayOf(freeObject("{ name, kind, code?, children[] }")),
      assignments: arrayOf(freeObject("{ userId, role?, permissionTemplateId? }")),
      isDefault: { type: "boolean" },
      status: { type: "string", enum: ["active", "archived"] },
    }),
    CreateProjectFromTemplateResponse: objectSchema({
      project: ref("GenericObject"),
      template: ref("PermissionTemplateRef"),
      applied: objectSchema({
        parties: { type: "integer" },
        folders: { type: "integer" },
        locations: { type: "integer" },
        assignments: { type: "integer" },
      }),
    }),
    JobStatusView: {
      type: "object",
      additionalProperties: true,
      description:
        "Legacy poller shape for BOQ/schedule jobs. Result fields (mode, revision, comparison, baseline, revisionId) are spread at the top level.",
      properties: {
        id: uuid,
        jobId: uuid,
        type: { type: "string" },
        status: {
          type: "string",
          enum: ["processing", "running", "done", "error"],
        },
        jobStatus: {
          type: "string",
          enum: ["queued", "running", "succeeded", "failed", "cancelled"],
        },
        step: { type: "string", nullable: true },
        currentStep: { type: "integer", nullable: true },
        totalSteps: { type: "integer", nullable: true },
        steps: { ...arrayOf(ref("GenericObject")), nullable: true },
        progress: { type: "number" },
        message: { type: "string", nullable: true },
        error: { type: "string", nullable: true },
        errorCode: { type: "string", nullable: true },
        projectId: { type: "string", format: "uuid", nullable: true },
        attempts: { type: "integer" },
        maxAttempts: { type: "integer" },
        canRetry: { type: "boolean" },
        queuedAt: nullableDateString,
        startedAt: nullableDateString,
        finishedAt: nullableDateString,
        updatedAt: nullableDateString,
      },
    },
    ActivityMutation: objectSchema({
      name: { type: "string" },
      activityCode: { type: "string", nullable: true },
      category: {
        type: "string",
        enum: [
          "civil",
          "structural",
          "mechanical",
          "electrical",
          "plumbing",
          "finishing",
          "landscaping",
          "demolition",
          "inspection",
          "other",
        ],
      },
      wbsCode: { type: "string" },
      startDate: dateString,
      endDate: dateString,
      earlyStart: { type: "integer", minimum: 0 },
      earlyFinish: { type: "integer", minimum: 0 },
      lateStart: { type: "integer", minimum: 0 },
      lateFinish: { type: "integer", minimum: 0 },
      totalFloat: { type: "integer", minimum: 0 },
      duration: { type: "integer", minimum: 0 },
      predecessors: { type: "string" },
      dependencies: arrayOf(ref("ActivityDependencyInput")),
      isCritical: { type: "boolean" },
      budget: money,
      isMilestone: { type: "boolean" },
      sortOrder: { type: "integer", minimum: 0 },
      engineerIds: arrayOf(uuid),
    }),
    Activity: objectSchema({
      id: uuid,
      projectId: uuid,
      name: { type: "string" },
      activityCode: { type: "string", nullable: true },
      p6ActivityId: { type: "string", nullable: true },
      wbsCode: { type: "string", nullable: true },
      calendarId: { type: "string", nullable: true },
      category: { type: "string", nullable: true },
      startDate: nullableDateString,
      endDate: nullableDateString,
      duration: { type: "integer", minimum: 0 },
      earlyStart: { type: "integer", nullable: true },
      earlyFinish: { type: "integer", nullable: true },
      lateStart: { type: "integer", nullable: true },
      lateFinish: { type: "integer", nullable: true },
      totalFloat: { type: "integer", nullable: true },
      earlyStartDate: nullableDateString,
      earlyFinishDate: nullableDateString,
      lateStartDate: nullableDateString,
      lateFinishDate: nullableDateString,
      baselineStart: { type: "integer", nullable: true },
      baselineFinish: { type: "integer", nullable: true },
      baselineStartDate: nullableDateString,
      baselineFinishDate: nullableDateString,
      predecessors: { type: "string", nullable: true },
      dependencies: arrayOf(ref("ActivityDependency")),
      budget: money,
      generatedBudget: money,
      allocatedBoqQuantity: nonNegativeNumber,
      allocatedBoqAmount: money,
      allocatedBoqWeight: nonNegativeNumber,
      approvedAllocationCount: { type: "integer", minimum: 0 },
      procurementRiskSummary: {
        ...ref("ScheduleProcurementRiskSummary"),
        nullable: true,
      },
      projectRiskSummary: {
        ...ref("ScheduleRiskSummary"),
        nullable: true,
      },
      isMilestone: { type: "boolean" },
      isCritical: { type: "boolean" },
      pctComplete: percent,
      status: {
        type: "string",
        enum: ["todo", "in_progress", "complete", "delayed"],
      },
      sortOrder: { type: "integer", minimum: 0 },
      createdAt: dateString,
    }),
    ProjectSchedule: objectSchema({
      dataDate: nullableDateString,
      revision: ref("GenericObject"),
      activities: arrayOf(ref("Activity")),
    }),
    ProgressPayload: objectSchema({
      pctComplete: percent,
      actualCost: money,
      actualStart: dateString,
      actualFinish: dateString,
      progressMethod: { $ref: "#/components/schemas/ProgressMethodName" },
      method: { $ref: "#/components/schemas/ProgressMethodName" },
      status: { type: "string", enum: ["draft", "submitted"] },
      source: {
        type: "string",
        enum: ["manual", "import", "mobile", "daily_report"],
      },
      quantityComplete: nonNegativeNumber,
      quantityPlanned: nonNegativeNumber,
      quantityUnit: { type: "string" },
      milestones: arrayOf(ref("GenericObject")),
      inspectionStatus: { type: "string" },
      evidence: ref("GenericObject"),
      notes: { type: "string" },
    }),
    BulkProgressRequest: objectSchema(
      {
        updates: arrayOf(
          objectSchema({
            activityId: uuid,
            pctComplete: percent,
            actualCost: money,
            progressMethod: { $ref: "#/components/schemas/ProgressMethodName" },
            method: { $ref: "#/components/schemas/ProgressMethodName" },
            status: { type: "string", enum: ["draft", "submitted"] },
            source: {
              type: "string",
              enum: ["manual", "import", "mobile", "daily_report"],
            },
            quantityComplete: nonNegativeNumber,
            quantityPlanned: nonNegativeNumber,
            quantityUnit: { type: "string" },
            inspectionStatus: { type: "string" },
            evidence: ref("GenericObject"),
            notes: { type: "string" },
            milestones: arrayOf(ref("GenericObject")),
          }),
        ),
      },
      ["updates"],
    ),
    ProgressMethodName: {
      type: "string",
      enum: [
        "percent",
        "quantity",
        "weighted_milestone",
        "inspection",
        "manual",
        "percent_complete",
        "physical_percent",
        "duration",
        "milestone",
      ],
    },
    ProgressMethodRequest: objectSchema(
      {
        method: { $ref: "#/components/schemas/ProgressMethodName" },
        plannedQuantity: { ...nonNegativeNumber, nullable: true },
        quantityUnit: { type: "string", nullable: true },
        milestoneWeights: arrayOf(ref("GenericObject")),
        inspectionRequired: { type: "boolean" },
        evidenceRequired: { type: "boolean" },
        notes: { type: "string", nullable: true },
      },
      ["method"],
    ),
    CommentRequest: objectSchema({
      comment: { type: "string", maxLength: 2000, nullable: true },
    }),
    IpcCertifyRequest: objectSchema({
      comment: { type: "string", maxLength: 2000, nullable: true },
      overrideReason: { type: "string", maxLength: 2000, nullable: true },
    }),
    RejectRequest: objectSchema(
      {
        reason: { type: "string", maxLength: 2000 },
      },
      ["reason"],
    ),
    RevisionActivationRequest: objectSchema(
      {
        mappings: arrayOf(
          objectSchema(
            {
              oldActivityId: { type: "string" },
              newActivityKey: { type: "string" },
            },
            ["oldActivityId", "newActivityKey"],
          ),
        ),
        unmappedRemovals: arrayOf(
          objectSchema({
            oldActivityId: { type: "string" },
            reason: { type: "string", maxLength: 2000 },
          }),
        ),
        comment: { type: "string", maxLength: 2000, nullable: true },
      },
      ["mappings"],
    ),
    ReportingPeriodRequest: objectSchema(
      {
        code: { type: "string", maxLength: 40 },
        label: { type: "string", maxLength: 120 },
        periodStart: dateString,
        periodEnd: dateString,
        cutoffDate: dateString,
      },
      ["periodStart", "periodEnd"],
    ),
    ReportingPeriodLockRequest: objectSchema({
      overrideReason: {
        type: "string",
        maxLength: 2000,
        description:
          "Required from a Project Manager when official reporting readiness blockers are still open.",
      },
    }),
    CostLoadingRequest: objectSchema(
      {
        activityId: uuid,
        reportingPeriodId: nullableUuid,
        plannedDate: dateString,
        plannedValue: money,
        source: {
          type: "string",
          enum: ["manual", "import", "ai", "migration", "budget_revision"],
        },
        baselineVersion: { type: "string", maxLength: 80 },
        status: {
          type: "string",
          enum: ["draft", "submitted"],
        },
        notes: { type: "string" },
      },
      ["activityId", "plannedDate", "plannedValue"],
    ),
    CostLoadingResponse: objectSchema({
      id: uuid,
      projectId: uuid,
      activityId: uuid,
      reportingPeriodId: nullableUuid,
      plannedDate: dateString,
      plannedValue: money,
      source: { type: "string" },
      baselineVersion: { type: "string", nullable: true },
      status: {
        type: "string",
        enum: ["draft", "submitted", "approved", "rejected", "superseded"],
      },
      notes: { type: "string", nullable: true },
      submittedBy: { type: "string", nullable: true },
      submittedAt: nullableDateString,
      approvedBy: { type: "string", nullable: true },
      approvedAt: nullableDateString,
      rejectedBy: { type: "string", nullable: true },
      rejectedAt: nullableDateString,
      rejectedReason: { type: "string", nullable: true },
      approvalHistory: arrayOf(ref("ApprovalWorkflowEvent")),
      createdBy: { type: "string", nullable: true },
      updatedBy: { type: "string", nullable: true },
      createdAt: dateString,
      updatedAt: dateString,
    }),
    CostRecordRequest: objectSchema({
      labour: money,
      material: money,
      equipment: money,
      subcontract: money,
      indirect: money,
      overhead: money,
      contingency: money,
      budget: money,
      committed: money,
      actual: money,
      actualThroughDate: {
        ...nullableDateString,
        description:
          "Accounting cutoff date for the cumulative actual amount. Official EV AC includes only cost records whose actualThroughDate is on or before the selected reporting cutoff.",
      },
      forecast: money,
    }),
    ActivityEquipmentUsage: objectSchema({
      id: uuid,
      projectId: uuid,
      activityId: uuid,
      equipmentId: nullableUuid,
      dailyReportId: nullableUuid,
      sourceLineIndex: { type: "integer", nullable: true },
      equipmentName: { type: "string" },
      hours: { type: "number", minimum: 0 },
      rateType: {
        type: "string",
        enum: ["hourly", "daily"],
        nullable: true,
      },
      rate: money,
      costAmount: money,
      usageDate: dateString,
      status: { type: "string", enum: ["approved"] },
      recordedBy: { type: "string", nullable: true },
      approvedBy: { type: "string", nullable: true },
      approvedAt: nullableDateString,
      notes: { type: "string", nullable: true },
      activity: ref("GenericObject"),
      equipment: ref("GenericObject"),
      dailyReport: ref("GenericObject"),
    }),
    EquipmentUtilizationReport: objectSchema({
      totals: objectSchema({
        hours: { type: "number", minimum: 0 },
        costAmount: money,
        unpricedHours: { type: "number", minimum: 0 },
        pricedHours: { type: "number", minimum: 0 },
        usageCount: { type: "integer", minimum: 0 },
        activityCount: { type: "integer", minimum: 0 },
        equipmentCount: { type: "integer", minimum: 0 },
      }),
      byActivity: arrayOf(ref("GenericObject")),
      byEquipment: arrayOf(ref("GenericObject")),
      recentUsage: arrayOf(ref("ActivityEquipmentUsage")),
    }),
    EarnedValueActivityBreakdown: objectSchema({
      activityId: { type: "string" },
      name: { type: "string" },
      budget: money,
      pv: money,
      ev: money,
      ac: money,
      actualCostSource: { type: "string" },
      officialActualThroughDate: nullableDateString,
      estimatedActualCost: money,
      estimatedActualCostSource: { type: "string" },
      pct: percent,
      status: { type: "string" },
      progressMethod: { type: "string" },
      progressStatus: { type: "string" },
      isCritical: { type: "boolean" },
    }),
    EarnedValueReport: objectSchema(
      {
        totalBudget: money,
        pv: money,
        ev: money,
        ac: money,
        spi: { type: "number", nullable: true },
        cpi: { type: "number", nullable: true },
        eac: money,
        sv: signedMoney,
        cv: signedMoney,
        etc: signedMoney,
        reporting: ref("GenericObject"),
        basis: ref("GenericObject"),
        sourceSummary: ref("GenericObject"),
        estimates: ref("GenericObject"),
        basisWarnings: arrayOf({ type: "string" }),
        readinessGate: ref("GenericObject"),
        readinessOverride: {
          ...ref("GenericObject"),
          nullable: true,
        },
        officialDataInputs: arrayOf(ref("GenericObject")),
        unallocatedBoqAmount: money,
        approvedAllocatedAmount: money,
        approvedBudgetRevisionDelta: signedMoney,
        sCurve: arrayOf(ref("GenericObject")),
        activityBreakdown: arrayOf(ref("EarnedValueActivityBreakdown")),
        alerts: ref("GenericObject"),
        official: { type: "boolean", enum: [true] },
      },
      [
        "totalBudget",
        "pv",
        "ev",
        "ac",
        "spi",
        "cpi",
        "eac",
        "sv",
        "cv",
        "etc",
        "reporting",
        "sourceSummary",
        "basisWarnings",
        "officialDataInputs",
        "activityBreakdown",
        "alerts",
        "official",
      ],
    ),
    SiteWeather: objectSchema({
      summary: { type: "string", nullable: true },
      temperatureC: { type: "number", nullable: true },
      condition: { type: "string", nullable: true },
      wind: { type: "string", nullable: true },
      rainfallMm: { type: "number", minimum: 0, nullable: true },
      delayImpact: { type: "boolean" },
    }),
    SiteIssue: objectSchema({
      description: { type: "string" },
      title: { type: "string" },
      severity: { type: "string", default: "medium" },
      owner: { type: "string", nullable: true },
      status: { type: "string", default: "open" },
    }),
    SiteLineSummary: objectSchema({
      totalWorkers: { type: "number", minimum: 0 },
      totalManHours: { type: "number", minimum: 0 },
      equipmentHours: { type: "number", minimum: 0 },
      materialLines: { type: "integer", minimum: 0 },
      photoCount: { type: "integer", minimum: 0 },
      issueCount: { type: "integer", minimum: 0 },
    }),
    DailyReportRequest: objectSchema({
      activityId: uuid,
      engineerId: uuid,
      date: dateString,
      shift: {
        type: "string",
        enum: ["day", "night", "swing"],
        default: "day",
      },
      pctProgress: percent,
      weather: ref("SiteWeather"),
      manpower: arrayOf(ref("GenericObject")),
      materials: arrayOf(ref("GenericObject")),
      equipment: arrayOf(ref("GenericObject")),
      issues: arrayOf(ref("SiteIssue")),
      photos: arrayOf(ref("WorkflowAttachmentRef")),
      notes: { type: "string" },
      clientRequestId: {
        type: "string",
        maxLength: 100,
        description:
          "Stable offline/mobile idempotency key. Replays with the same projectId/clientRequestId return the original record.",
      },
      clientCreatedAt: dateString,
      deviceId: { type: "string", maxLength: 100 },
      status: { type: "string", enum: ["draft", "submitted"] },
      progress: ref("ProgressPayload"),
    }),
    SiteDiaryRequest: objectSchema({
      engineerId: uuid,
      date: dateString,
      shift: {
        type: "string",
        enum: ["day", "night", "swing"],
        default: "day",
      },
      weather: { type: "string", nullable: true },
      weatherDetails: ref("SiteWeather"),
      workers: { type: "integer", minimum: 0, nullable: true },
      visitors: { type: "string", nullable: true },
      workDone: { type: "string", nullable: true },
      issues: { type: "string", nullable: true },
      issueItems: arrayOf(ref("SiteIssue")),
      instructions: { type: "string", nullable: true },
      manpower: arrayOf(ref("GenericObject")),
      materials: arrayOf(ref("GenericObject")),
      equipment: arrayOf(ref("GenericObject")),
      photos: arrayOf(ref("WorkflowAttachmentRef")),
      notes: { type: "string" },
      clientRequestId: {
        type: "string",
        maxLength: 100,
        description:
          "Stable offline/mobile idempotency key. Replays with the same projectId/clientRequestId return the original record.",
      },
      clientCreatedAt: dateString,
      deviceId: { type: "string", maxLength: 100 },
      status: { type: "string", enum: ["draft", "submitted"] },
    }),
    WorkflowAttachmentRef: objectSchema({
      documentId: uuid,
      projectDocumentId: uuid,
      key: { type: "string" },
      url: { type: "string" },
      fileUrl: { type: "string" },
      filename: { type: "string" },
      fileName: { type: "string" },
      originalName: { type: "string" },
      mimeType: { type: "string" },
      size: { type: "integer", minimum: 0 },
      sizeBytes: { type: "integer", minimum: 0 },
      scanStatus: { type: "string" },
      storage: { type: "string" },
      caption: { type: "string" },
      description: { type: "string" },
      uploadedAt: dateString,
    }),
    DocumentRevision: objectSchema({
      id: uuid,
      projectId: uuid,
      projectDocumentId: nullableUuid,
      recordType: {
        type: "string",
        enum: ["rfi", "submittal", "drawing", "transmittal", "correspondence"],
      },
      recordId: uuid,
      revision: { type: "string" },
      status: {
        type: "string",
        enum: ["uploaded", "submitted", "approved", "superseded", "rejected"],
        nullable: true,
      },
      title: { type: "string", nullable: true },
      documentNumber: { type: "string", nullable: true },
      category: { type: "string", nullable: true },
      folderPath: { type: "string", nullable: true },
      folderKey: { type: "string", nullable: true },
      discipline: { type: "string", nullable: true },
      mimeType: { type: "string", nullable: true },
      sizeBytes: { type: "integer", minimum: 0, nullable: true },
      fileName: { type: "string", nullable: true },
      fileUrl: { type: "string", nullable: true },
      downloadUrl: { type: "string", nullable: true },
      previewUrl: { type: "string", nullable: true },
      storageKey: { type: "string", nullable: true },
      isLatest: { type: "boolean" },
      issuedBy: { type: "string", nullable: true },
      issuedAt: dateString,
      submittedBy: { type: "string", nullable: true },
      submittedAt: nullableDateString,
      reviewDueAt: nullableDateString,
      approvedBy: { type: "string", nullable: true },
      approvedAt: nullableDateString,
      supersededBy: { type: "string", nullable: true },
      supersededAt: nullableDateString,
      notes: { type: "string", nullable: true },
      readOnly: { type: "boolean" },
      createdAt: dateString,
      updatedAt: dateString,
    }),
    DocumentRegisterRow: objectSchema({
      id: { type: "string" },
      recordType: {
        type: "string",
        enum: ["rfi", "submittal", "drawing", "transmittal", "correspondence"],
      },
      recordId: uuid,
      ref: { type: "string" },
      title: { type: "string" },
      documentNumber: { type: "string", nullable: true },
      category: { type: "string", nullable: true },
      folderPath: { type: "string", nullable: true },
      folderKey: { type: "string", nullable: true },
      restrictedToCurrentRevision: { type: "boolean" },
      status: { type: "string", nullable: true },
      currentRevision: { type: "string", nullable: true },
      latestRevision: { allOf: [ref("DocumentRevision")], nullable: true },
      revisions: arrayOf(ref("DocumentRevision")),
      revisionCount: { type: "integer", minimum: 0 },
      supersededRevisionCount: { type: "integer", minimum: 0 },
      dueDate: nullableDateString,
      dueAlert: ref("GenericObject"),
      activityId: nullableUuid,
      activityLinks: arrayOf(ref("GenericObject")),
      attachments: arrayOf(ref("WorkflowAttachmentRef")),
      attachmentCount: { type: "integer", minimum: 0 },
      owner: { type: "string", nullable: true },
      reviewer: { type: "string", nullable: true },
      approver: { type: "string", nullable: true },
      ownerParty: { allOf: [ref("ProjectParty")], nullable: true },
      reviewerParty: { allOf: [ref("ProjectParty")], nullable: true },
      approverParty: { allOf: [ref("ProjectParty")], nullable: true },
      linkedEntities: ref("GenericObject"),
      updatedAt: nullableDateString,
    }),
    DocumentRegisterFolder: objectSchema({
      key: { type: "string" },
      label: { type: "string" },
      recordTypes: arrayOf({ type: "string" }),
      count: { type: "integer", minimum: 0 },
    }),
    DocumentRegisterResponse: objectSchema(
      {
        rows: arrayOf(ref("DocumentRegisterRow")),
        folders: arrayOf(ref("DocumentRegisterFolder")),
        summary: ref("GenericObject"),
      },
      ["rows", "folders", "summary"],
    ),
    DocumentRevisionUploadRequest: objectSchema(
      {
        revision: { type: "string", maxLength: 40 },
        projectDocumentId: nullableUuid,
        documentId: nullableUuid,
        storageKey: { type: "string" },
        key: { type: "string" },
        title: { type: "string", nullable: true, maxLength: 255 },
        fileName: { type: "string", nullable: true, maxLength: 255 },
        documentNumber: { type: "string", nullable: true, maxLength: 120 },
        category: { type: "string", nullable: true, maxLength: 120 },
        folderPath: { type: "string", nullable: true, maxLength: 255 },
        discipline: { type: "string", nullable: true, maxLength: 120 },
        confidentiality: { type: "string", nullable: true, maxLength: 80 },
        reviewDueAt: nullableDateString,
        status: { type: "string", enum: ["uploaded", "submitted", "approved"] },
        issuedBy: { type: "string", nullable: true, maxLength: 120 },
        issuedAt: nullableDateString,
        notes: { type: "string", nullable: true, maxLength: 2000 },
      },
      ["revision"],
    ),
    DocumentRevisionUploadResponse: objectSchema(
      {
        revision: ref("DocumentRevision"),
        document: ref("WorkflowAttachmentRef"),
      },
      ["revision", "document"],
    ),
    DocumentRevisionSubmitReviewRequest: objectSchema({
      comment: { type: "string", nullable: true, maxLength: 2000 },
      reviewDueAt: nullableDateString,
    }),
    SupersedeRevisionRequest: objectSchema(
      {
        reason: { type: "string", maxLength: 2000 },
      },
      ["reason"],
    ),
    ApprovalWorkflowEvent: objectSchema({
      id: { type: "string", nullable: true },
      orgId: { type: "string" },
      projectId: { type: "string" },
      recordType: { type: "string" },
      recordId: { type: "string" },
      workflowType: { type: "string" },
      action: { type: "string" },
      decision: { type: "string", nullable: true },
      fromStatus: { type: "string", nullable: true },
      toStatus: { type: "string", nullable: true },
      oldStatus: { type: "string", nullable: true },
      newStatus: { type: "string", nullable: true },
      actorId: { type: "string", nullable: true },
      actorRole: { type: "string", nullable: true },
      reason: { type: "string", nullable: true },
      comment: { type: "string", nullable: true },
      metadata: ref("GenericObject"),
      createdAt: dateString,
      occurredAt: dateString,
    }),
    ApprovalDecisionRequest: objectSchema({
      comment: { type: "string", nullable: true },
    }),
    RejectionDecisionRequest: objectSchema(
      {
        reason: { type: "string" },
      },
      ["reason"],
    ),
    MeetingAttendee: objectSchema({
      id: uuid,
      meetingId: uuid,
      activityId: nullableUuid,
      activity: { allOf: [ref("Activity")], nullable: true },
      userId: nullableUuid,
      user: { allOf: [ref("UserSummary")], nullable: true },
      projectPartyId: nullableUuid,
      projectParty: { allOf: [ref("GenericObject")], nullable: true },
      name: { type: "string", nullable: true },
      email: { type: "string", nullable: true },
      companyName: { type: "string", nullable: true },
      role: { type: "string" },
      attendanceStatus: {
        type: "string",
        enum: ["invited", "attended", "absent", "apology"],
      },
      distributionRequired: { type: "boolean" },
      attendedAt: nullableDateString,
      createdAt: dateString,
      updatedAt: dateString,
    }),
    MeetingAgendaItem: objectSchema({
      id: uuid,
      meetingId: uuid,
      activityId: nullableUuid,
      activity: { allOf: [ref("Activity")], nullable: true },
      presenterId: nullableUuid,
      presenter: { allOf: [ref("UserSummary")], nullable: true },
      sortOrder: { type: "integer" },
      title: { type: "string" },
      notes: { type: "string", nullable: true },
      status: { type: "string", enum: ["open", "covered", "deferred"] },
      createdAt: dateString,
      updatedAt: dateString,
    }),
    MeetingDecision: objectSchema({
      id: uuid,
      meetingId: uuid,
      activityId: nullableUuid,
      activity: { allOf: [ref("Activity")], nullable: true },
      decidedById: nullableUuid,
      decidedBy: { allOf: [ref("UserSummary")], nullable: true },
      title: { type: "string" },
      decision: { type: "string" },
      impact: { type: "string", nullable: true },
      decidedAt: dateString,
      createdAt: dateString,
      updatedAt: dateString,
    }),
    MeetingActionItem: objectSchema({
      id: uuid,
      meetingId: uuid,
      activityId: nullableUuid,
      activity: { allOf: [ref("Activity")], nullable: true },
      taskId: nullableUuid,
      task: { allOf: [ref("GenericObject")], nullable: true },
      itemNumber: { type: "string" },
      title: { type: "string" },
      description: { type: "string", nullable: true },
      ownerId: nullableUuid,
      owner: { allOf: [ref("UserSummary")], nullable: true },
      ownerName: { type: "string", nullable: true },
      ownerEmail: { type: "string", nullable: true },
      dueDate: dateString,
      priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
      status: {
        type: "string",
        enum: ["open", "in_progress", "closed", "canceled"],
      },
      createdAt: dateString,
      updatedAt: dateString,
    }),
    MeetingDistribution: objectSchema({
      id: uuid,
      meetingId: uuid,
      activityId: nullableUuid,
      activity: { allOf: [ref("Activity")], nullable: true },
      recipientUserId: nullableUuid,
      recipientUser: { allOf: [ref("UserSummary")], nullable: true },
      projectPartyId: nullableUuid,
      projectParty: { allOf: [ref("GenericObject")], nullable: true },
      recipientName: { type: "string", nullable: true },
      recipientEmail: { type: "string", nullable: true },
      companyName: { type: "string", nullable: true },
      channel: { type: "string" },
      status: { type: "string" },
      message: { type: "string", nullable: true },
      sentById: nullableUuid,
      sentBy: { allOf: [ref("UserSummary")], nullable: true },
      sentAt: dateString,
      metadata: ref("GenericObject"),
      createdAt: dateString,
      updatedAt: dateString,
    }),
    MeetingComment: objectSchema({
      id: uuid,
      meetingId: uuid,
      activityId: nullableUuid,
      activity: { allOf: [ref("Activity")], nullable: true },
      authorId: nullableUuid,
      author: { allOf: [ref("UserSummary")], nullable: true },
      body: { type: "string" },
      createdAt: dateString,
      updatedAt: dateString,
    }),
    MeetingRecord: objectSchema(
      {
        id: uuid,
        orgId: uuid,
        projectId: uuid,
        project: ref("GenericObject"),
        activityId: nullableUuid,
        activity: { allOf: [ref("Activity")], nullable: true },
        meetingNumber: { type: "string" },
        title: { type: "string" },
        meetingType: {
          type: "string",
          enum: [
            "coordination",
            "progress",
            "commercial",
            "quality",
            "safety",
            "design",
            "client",
            "other",
          ],
        },
        location: { type: "string", nullable: true },
        scheduledAt: nullableDateString,
        startedAt: nullableDateString,
        endedAt: nullableDateString,
        status: {
          type: "string",
          enum: ["draft", "finalized", "distributed", "archived"],
        },
        objective: { type: "string", nullable: true },
        minutesText: { type: "string", nullable: true },
        nextMeetingAt: nullableDateString,
        chairId: nullableUuid,
        chair: { allOf: [ref("UserSummary")], nullable: true },
        distributedAt: nullableDateString,
        distributedById: nullableUuid,
        distributedBy: { allOf: [ref("UserSummary")], nullable: true },
        attendees: arrayOf(ref("MeetingAttendee")),
        agendaItems: arrayOf(ref("MeetingAgendaItem")),
        decisions: arrayOf(ref("MeetingDecision")),
        actionItems: arrayOf(ref("MeetingActionItem")),
        distributions: arrayOf(ref("MeetingDistribution")),
        comments: arrayOf(ref("MeetingComment")),
        attendeeCount: { type: "integer", minimum: 0 },
        decisionCount: { type: "integer", minimum: 0 },
        actionItemCount: { type: "integer", minimum: 0 },
        openActionItemCount: { type: "integer", minimum: 0 },
        distributionCount: { type: "integer", minimum: 0 },
        createdAt: dateString,
        updatedAt: dateString,
      },
      ["id", "projectId", "meetingNumber", "title", "meetingType", "status"],
    ),
    MeetingListResponse: objectSchema(
      {
        rows: arrayOf(ref("MeetingRecord")),
        pagination: objectSchema({
          limit: { type: "integer" },
          nextCursor: { type: "string", nullable: true },
        }),
        summary: objectSchema({
          total: { type: "integer", minimum: 0 },
          draft: { type: "integer", minimum: 0 },
          distributed: { type: "integer", minimum: 0 },
          openActionItems: { type: "integer", minimum: 0 },
        }),
      },
      ["rows", "pagination", "summary"],
    ),
    MeetingAttendeeInput: objectSchema({
      activityId: nullableUuid,
      userId: nullableUuid,
      projectPartyId: nullableUuid,
      name: { type: "string", nullable: true, maxLength: 255 },
      email: { type: "string", nullable: true, format: "email" },
      companyName: { type: "string", nullable: true, maxLength: 255 },
      role: { type: "string", maxLength: 80 },
      attendanceStatus: {
        type: "string",
        enum: ["invited", "attended", "absent", "apology"],
      },
      distributionRequired: { type: "boolean" },
      attendedAt: nullableDateString,
    }),
    MeetingAgendaItemInput: objectSchema({
      activityId: nullableUuid,
      presenterId: nullableUuid,
      sortOrder: { type: "integer", minimum: 0 },
      title: { type: "string", maxLength: 500 },
      notes: { type: "string", nullable: true, maxLength: 4000 },
      status: { type: "string", enum: ["open", "covered", "deferred"] },
    }),
    MeetingDecisionInput: objectSchema({
      activityId: nullableUuid,
      decidedById: nullableUuid,
      title: { type: "string", maxLength: 500 },
      decision: { type: "string", maxLength: 6000 },
      impact: { type: "string", nullable: true, maxLength: 4000 },
      decidedAt: nullableDateString,
    }),
    MeetingActionItemInput: objectSchema({
      activityId: nullableUuid,
      taskId: nullableUuid,
      itemNumber: { type: "string", nullable: true, maxLength: 50 },
      title: { type: "string", maxLength: 500 },
      description: { type: "string", nullable: true, maxLength: 4000 },
      ownerId: nullableUuid,
      ownerName: { type: "string", nullable: true, maxLength: 255 },
      ownerEmail: { type: "string", nullable: true, format: "email" },
      dueDate: dateString,
      priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
      status: {
        type: "string",
        enum: ["open", "in_progress", "closed", "canceled"],
      },
      createTask: { type: "boolean", default: true },
    }),
    MeetingMutation: objectSchema(
      {
        activityId: nullableUuid,
        chairId: nullableUuid,
        title: { type: "string", maxLength: 255 },
        meetingType: {
          type: "string",
          enum: [
            "coordination",
            "progress",
            "commercial",
            "quality",
            "safety",
            "design",
            "client",
            "other",
          ],
        },
        status: {
          type: "string",
          enum: ["draft", "finalized", "distributed"],
        },
        location: { type: "string", nullable: true, maxLength: 500 },
        objective: { type: "string", nullable: true, maxLength: 4000 },
        minutesText: { type: "string", nullable: true, maxLength: 20000 },
        scheduledAt: nullableDateString,
        startedAt: nullableDateString,
        endedAt: nullableDateString,
        nextMeetingAt: nullableDateString,
        attendees: arrayOf(ref("MeetingAttendeeInput")),
        agendaItems: arrayOf(ref("MeetingAgendaItemInput")),
        decisions: arrayOf(ref("MeetingDecisionInput")),
        actionItems: arrayOf(ref("MeetingActionItemInput")),
      },
      ["title"],
    ),
    MeetingPatch: objectSchema({
      activityId: nullableUuid,
      chairId: nullableUuid,
      title: { type: "string", maxLength: 255 },
      meetingType: {
        type: "string",
        enum: [
          "coordination",
          "progress",
          "commercial",
          "quality",
          "safety",
          "design",
          "client",
          "other",
        ],
      },
      status: { type: "string", enum: ["draft", "finalized", "distributed"] },
      location: { type: "string", nullable: true, maxLength: 500 },
      objective: { type: "string", nullable: true, maxLength: 4000 },
      minutesText: { type: "string", nullable: true, maxLength: 20000 },
      scheduledAt: nullableDateString,
      startedAt: nullableDateString,
      endedAt: nullableDateString,
      nextMeetingAt: nullableDateString,
      attendees: arrayOf(ref("MeetingAttendeeInput")),
      agendaItems: arrayOf(ref("MeetingAgendaItemInput")),
      decisions: arrayOf(ref("MeetingDecisionInput")),
      actionItems: arrayOf(ref("MeetingActionItemInput")),
    }),
    MeetingDistributionRecipientInput: objectSchema({
      name: { type: "string", nullable: true, maxLength: 255 },
      email: { type: "string", nullable: true, format: "email" },
      companyName: { type: "string", nullable: true, maxLength: 255 },
    }),
    MeetingDistributionRequest: objectSchema({
      message: { type: "string", nullable: true, maxLength: 4000 },
      includeAttendees: { type: "boolean", default: true },
      recipientUserIds: arrayOf(uuid),
      projectPartyIds: arrayOf(uuid),
      recipients: arrayOf(ref("MeetingDistributionRecipientInput")),
    }),
    MeetingDistributionResponse: objectSchema(
      {
        meeting: ref("MeetingRecord"),
        distributionCount: { type: "integer", minimum: 0 },
      },
      ["meeting", "distributionCount"],
    ),
    MeetingCommentRequest: objectSchema(
      {
        body: { type: "string", maxLength: 4000 },
        activityId: nullableUuid,
      },
      ["body"],
    ),
    TaskAttachment: objectSchema({
      id: uuid,
      projectDocumentId: nullableUuid,
      fileName: { type: "string", nullable: true },
      fileUrl: { type: "string", nullable: true },
      storageKey: { type: "string", nullable: true },
      mimeType: { type: "string", nullable: true },
      uploadedById: nullableUuid,
      uploadedBy: { allOf: [ref("UserSummary")], nullable: true },
      createdAt: dateString,
    }),
    TaskComment: objectSchema({
      id: uuid,
      taskId: uuid,
      body: { type: "string" },
      authorId: nullableUuid,
      author: { allOf: [ref("UserSummary")], nullable: true },
      createdAt: dateString,
      updatedAt: dateString,
    }),
    TaskHistory: objectSchema({
      id: uuid,
      taskId: uuid,
      action: { type: "string" },
      actorId: nullableUuid,
      actorRole: { type: "string", nullable: true },
      actor: { allOf: [ref("UserSummary")], nullable: true },
      fromStatus: { type: "string", nullable: true },
      toStatus: { type: "string", nullable: true },
      comment: { type: "string", nullable: true },
      metadata: ref("GenericObject"),
      createdAt: dateString,
    }),
    TaskRecord: objectSchema(
      {
        id: uuid,
        orgId: uuid,
        projectId: uuid,
        project: ref("GenericObject"),
        activityId: nullableUuid,
        activity: { allOf: [ref("Activity")], nullable: true },
        taskNumber: { type: "string" },
        title: { type: "string" },
        description: { type: "string", nullable: true },
        label: {
          type: "string",
          enum: [
            "action",
            "field",
            "procurement",
            "quality",
            "safety",
            "commercial",
            "document",
          ],
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
        },
        status: {
          type: "string",
          enum: ["todo", "in_progress", "blocked", "done", "canceled"],
        },
        dueDate: nullableDateString,
        isOverdue: { type: "boolean" },
        assigneeId: nullableUuid,
        assignee: { allOf: [ref("UserSummary")], nullable: true },
        assigneeName: { type: "string", nullable: true },
        comments: arrayOf(ref("TaskComment")),
        commentCount: { type: "integer", minimum: 0 },
        attachments: arrayOf(ref("TaskAttachment")),
        attachmentCount: { type: "integer", minimum: 0 },
        history: arrayOf(ref("TaskHistory")),
        closedAt: nullableDateString,
        archivedAt: nullableDateString,
        createdAt: dateString,
        updatedAt: dateString,
      },
      [
        "id",
        "projectId",
        "taskNumber",
        "title",
        "label",
        "priority",
        "status",
        "isOverdue",
      ],
    ),
    TaskListResponse: objectSchema(
      {
        rows: arrayOf(ref("TaskRecord")),
        pagination: objectSchema({
          limit: { type: "integer" },
          nextCursor: { type: "string", nullable: true },
        }),
        summary: objectSchema({
          open: { type: "integer", minimum: 0 },
          overdue: { type: "integer", minimum: 0 },
        }),
      },
      ["rows", "pagination", "summary"],
    ),
    TaskAttachmentInput: objectSchema({
      projectDocumentId: nullableUuid,
      documentId: nullableUuid,
      fileName: { type: "string", nullable: true, maxLength: 255 },
      fileUrl: { type: "string", nullable: true, maxLength: 2000 },
      storageKey: { type: "string", nullable: true, maxLength: 1000 },
    }),
    TaskMutation: objectSchema(
      {
        projectId: nullableUuid,
        activityId: nullableUuid,
        assigneeId: nullableUuid,
        title: { type: "string", maxLength: 255 },
        description: { type: "string", nullable: true, maxLength: 4000 },
        label: {
          type: "string",
          enum: [
            "action",
            "field",
            "procurement",
            "quality",
            "safety",
            "commercial",
            "document",
          ],
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
        },
        status: {
          type: "string",
          enum: ["todo", "in_progress", "blocked", "done", "canceled"],
        },
        dueDate: nullableDateString,
        comment: { type: "string", nullable: true, maxLength: 4000 },
        attachments: arrayOf(ref("TaskAttachmentInput")),
      },
      ["title"],
    ),
    TaskPatch: objectSchema({
      projectId: nullableUuid,
      activityId: nullableUuid,
      assigneeId: nullableUuid,
      title: { type: "string", maxLength: 255 },
      description: { type: "string", nullable: true, maxLength: 4000 },
      label: {
        type: "string",
        enum: [
          "action",
          "field",
          "procurement",
          "quality",
          "safety",
          "commercial",
          "document",
        ],
      },
      priority: {
        type: "string",
        enum: ["low", "medium", "high", "critical"],
      },
      status: {
        type: "string",
        enum: ["todo", "in_progress", "blocked", "done", "canceled"],
      },
      dueDate: nullableDateString,
      comment: { type: "string", nullable: true, maxLength: 4000 },
      attachments: arrayOf(ref("TaskAttachmentInput")),
    }),
    TaskCommentRequest: objectSchema(
      {
        body: { type: "string", maxLength: 4000 },
      },
      ["body"],
    ),
    TaskAttachmentRequest: objectSchema(
      {
        attachments: arrayOf(ref("TaskAttachmentInput")),
      },
      ["attachments"],
    ),
    RfiSubmitRequest: objectSchema({
      comment: { type: "string", nullable: true },
    }),
    RfiAnswerRequest: objectSchema(
      {
        response: { type: "string" },
        answeredBy: { type: "string", nullable: true },
        answeredDate: nullableDateString,
        activityId: nullableUuid,
        activityIds: arrayOf(uuid),
        activityLinks: arrayOf(ref("ActivityLinkInput")),
        attachments: arrayOf(ref("WorkflowAttachmentRef")),
        attachmentRefs: arrayOf(ref("WorkflowAttachmentRef")),
        revisions: arrayOf(ref("GenericObject")),
        revision: { type: "string" },
        projectDocumentId: nullableUuid,
        documentId: nullableUuid,
        storageKey: { type: "string" },
        comment: { type: "string", nullable: true },
        ownerPartyId: nullableUuid,
        reviewerPartyId: nullableUuid,
        approverPartyId: nullableUuid,
      },
      ["response"],
    ),
    RfiCloseRequest: objectSchema(
      {
        comment: { type: "string" },
      },
      ["comment"],
    ),
    SubmittalWorkflowRequest: objectSchema({
      activityId: nullableUuid,
      activityIds: arrayOf(uuid),
      activityLinks: arrayOf(ref("ActivityLinkInput")),
      attachments: arrayOf(ref("WorkflowAttachmentRef")),
      attachmentRefs: arrayOf(ref("WorkflowAttachmentRef")),
      revisions: arrayOf(ref("GenericObject")),
      revision: { type: "string" },
      projectDocumentId: nullableUuid,
      documentId: nullableUuid,
      storageKey: { type: "string" },
      remarks: { type: "string", nullable: true },
      comment: { type: "string", nullable: true },
      reason: { type: "string", nullable: true },
      submittedOn: nullableDateString,
      reviewedOn: nullableDateString,
      ownerPartyId: nullableUuid,
      reviewerPartyId: nullableUuid,
      approverPartyId: nullableUuid,
    }),
    ActivityLinkInput: objectSchema({
      activityId: uuid,
      relationType: { type: "string" },
      scheduleImpactDays: { type: "integer" },
      approvedScheduleImpactDays: { type: "integer" },
      costImpact: money,
      approvedCostImpact: money,
      delayStart: nullableDateString,
      delayEnd: nullableDateString,
      delayDays: nonNegativeNumber,
      baselineStart: nullableDateString,
      baselineFinish: nullableDateString,
      impactedStart: nullableDateString,
      impactedFinish: nullableDateString,
      impactBasis: { type: "string", nullable: true },
      quantity: nonNegativeNumber,
      amount: money,
      notes: { type: "string", nullable: true },
    }),
    AllocationLinkInput: objectSchema({
      allocationId: nullableUuid,
      boqItemId: nullableUuid,
      quantity: nonNegativeNumber,
      amount: money,
      workDoneAmount: money,
      materialsOnSiteAmount: money,
      notes: { type: "string", nullable: true },
    }),
    ChangeOrderRequest: objectSchema(
      {
        description: { type: "string" },
        activityId: nullableUuid,
        activityLinks: arrayOf(ref("ActivityLinkInput")),
        affectedActivityIds: arrayOf(uuid),
        allocationLinks: arrayOf(ref("AllocationLinkInput")),
        correspondenceIds: arrayOf(uuid),
        correspondenceLinks: arrayOf(ref("GenericObject")),
        attachmentRefs: arrayOf(ref("WorkflowAttachmentRef")),
        supportingDocumentIds: arrayOf(uuid),
        documentIds: arrayOf(uuid),
        category: { type: "string" },
        value: money,
        status: { type: "string", enum: ["draft"] },
        scheduleImpact: { type: "integer" },
        scheduleImpactSummary: {
          type: "string",
          nullable: true,
          maxLength: 4000,
        },
        costImpactSummary: { type: "string", nullable: true, maxLength: 4000 },
        submittedDate: dateString,
        raisedBy: { type: "string" },
        rejectedReason: { type: "string" },
        approvalComment: { type: "string", nullable: true, maxLength: 2000 },
      },
      ["description"],
    ),
    IpcCreateRequest: objectSchema({
      period: { type: "string" },
    }),
    IpcItemPatchRequest: objectSchema({
      qty: nonNegativeNumber,
      rate: money,
      retentionRate: percent,
    }),
    IpcInvoiceIssueRequest: objectSchema({
      invoiceNumber: { type: "string", maxLength: 100 },
      invoiceDate: nullableDateString,
      dueDate: nullableDateString,
    }),
    IpcPaymentRequest: objectSchema(
      {
        amount: money,
        paymentReference: { type: "string", maxLength: 120 },
        paymentDate: nullableDateString,
        paymentMethod: { type: "string", nullable: true, maxLength: 80 },
        notes: { type: "string", nullable: true, maxLength: 2000 },
      },
      ["amount"],
    ),
    IpcRetentionReleaseRequest: objectSchema(
      {
        amount: money,
        releaseReference: { type: "string", maxLength: 120 },
        releaseDate: nullableDateString,
        reason: { type: "string", nullable: true, maxLength: 2000 },
      },
      ["amount"],
    ),
    CashFlowEntryRequest: objectSchema(
      {
        period: { type: "string", pattern: "^\\d{4}-\\d{2}$" },
        inflow: money,
        outflow: money,
      },
      ["period"],
    ),
    EotClaimRequest: objectSchema(
      {
        eventName: { type: "string" },
        eventType: { type: "string" },
        delayDays: nonNegativeNumber,
        eotDaysGranted: nonNegativeNumber,
        ldRatePerDay: money,
        affectedActivityIds: arrayOf(uuid),
        activityLinks: arrayOf(ref("ActivityLinkInput")),
        weatherDelayIds: arrayOf(uuid),
        weatherDelayLinks: arrayOf(ref("GenericObject")),
        correspondenceIds: arrayOf(uuid),
        correspondenceLinks: arrayOf(ref("GenericObject")),
        attachmentRefs: arrayOf(ref("WorkflowAttachmentRef")),
        supportingDocumentIds: arrayOf(uuid),
        documentIds: arrayOf(uuid),
        analysis: { type: "string", nullable: true },
        claimLetter: { type: "string", nullable: true },
        status: {
          type: "string",
          enum: ["draft", "submitted"],
        },
      },
      ["eventName", "delayDays"],
    ),
    SubValuationRequest: objectSchema(
      {
        subcontractor: { type: "string" },
        period: { type: "string" },
        workDone: money,
        materialsOnSite: money,
        retentionRate: percent,
        backCharges: money,
        activityLinks: arrayOf(ref("ActivityLinkInput")),
        allocationLinks: arrayOf(ref("AllocationLinkInput")),
        correspondenceIds: arrayOf(uuid),
        correspondenceLinks: arrayOf(ref("GenericObject")),
        attachmentRefs: arrayOf(ref("WorkflowAttachmentRef")),
        status: {
          type: "string",
          enum: ["draft", "submitted", "certified", "paid"],
        },
      },
      ["subcontractor", "period"],
    ),
    WeatherDelayRequest: objectSchema(
      {
        description: { type: "string" },
        date: dateString,
        delayDays: nonNegativeNumber,
        contractual: { type: "boolean" },
        affectedActivityIds: arrayOf(uuid),
        activityLinks: arrayOf(ref("GenericObject")),
        correspondenceIds: arrayOf(uuid),
        correspondenceLinks: arrayOf(ref("GenericObject")),
        attachmentRefs: arrayOf(ref("WorkflowAttachmentRef")),
      },
      ["description", "delayDays"],
    ),
    ProcurementSupplierRequest: objectSchema(
      {
        name: { type: "string" },
        code: { type: "string", nullable: true },
        contactName: { type: "string", nullable: true },
        email: { type: "string", format: "email", nullable: true },
        phone: { type: "string", nullable: true },
        address: { type: "string", nullable: true },
        tradeCategories: arrayOf({ type: "string" }),
        status: {
          type: "string",
          enum: ["approved", "pending", "on_hold", "blocked"],
        },
        leadTimeReliability: { type: "number", minimum: 0, maximum: 100 },
        notes: { type: "string", nullable: true },
      },
      ["name"],
    ),
    ProcurementPackageRequest: objectSchema(
      {
        packageNumber: { type: "string" },
        title: { type: "string" },
        description: { type: "string", nullable: true },
        supplierId: nullableUuid,
        activityId: nullableUuid,
        status: {
          type: "string",
          enum: [
            "planning",
            "tendering",
            "awarded",
            "in_delivery",
            "closed",
            "cancelled",
          ],
        },
        buyer: { type: "string", nullable: true },
        plannedAwardDate: nullableDateString,
        requiredOnSiteDate: nullableDateString,
        requiredTiming: {
          type: "string",
          enum: ["activity_start", "activity_finish"],
        },
        needOffsetDays: { type: "integer", minimum: 0 },
        leadWeeks: { type: "integer", minimum: 0 },
        bufferDays: { type: "integer", minimum: 0 },
        latestOrderDate: nullableDateString,
        notes: { type: "string", nullable: true },
      },
      ["packageNumber", "title"],
    ),
    ProcurementPoLineRequest: objectSchema(
      {
        lineNumber: { type: "integer", minimum: 1 },
        activityId: uuid,
        activityMaterialId: nullableUuid,
        materialMasterId: nullableUuid,
        packageId: nullableUuid,
        supplierId: nullableUuid,
        itemCode: { type: "string", nullable: true },
        description: { type: "string" },
        spec: { type: "string", nullable: true },
        unit: { type: "string" },
        orderedQty: { type: "number", minimum: 0.001 },
        unitCost: money,
        leadWeeks: { type: "integer", minimum: 0 },
        requiredTiming: {
          type: "string",
          enum: ["activity_start", "activity_finish"],
        },
        needOffsetDays: { type: "integer", minimum: 0 },
        bufferDays: { type: "integer", minimum: 0 },
        requiredDate: nullableDateString,
        promisedDate: nullableDateString,
        notes: { type: "string", nullable: true },
      },
      ["activityId", "description", "unit", "orderedQty"],
    ),
    ProcurementPurchaseOrderRequest: objectSchema(
      {
        ref: { type: "string" },
        item: { type: "string", nullable: true },
        activityId: nullableUuid,
        packageId: nullableUuid,
        supplierId: nullableUuid,
        supplier: { type: "string", nullable: true },
        status: {
          type: "string",
          enum: [
            "planned",
            "draft",
            "issued",
            "partial",
            "received",
            "closed",
            "cancelled",
          ],
        },
        leadWeeks: { type: "integer", minimum: 0 },
        requiredTiming: {
          type: "string",
          enum: ["activity_start", "activity_finish"],
        },
        needOffsetDays: { type: "integer", minimum: 0 },
        bufferDays: { type: "integer", minimum: 0 },
        currency: { type: "string", minLength: 3, maxLength: 3 },
        orderDate: nullableDateString,
        requiredBy: nullableDateString,
        promisedDate: nullableDateString,
        deliveryDate: nullableDateString,
        buyer: { type: "string", nullable: true },
        notes: { type: "string", nullable: true },
        lines: arrayOf(ref("ProcurementPoLineRequest")),
      },
      ["ref", "lines"],
    ),
    DeliveryReceiptLineRequest: objectSchema(
      {
        poLineId: uuid,
        dailyReportId: nullableUuid,
        acceptedQty: { type: "number", minimum: 0.001 },
        rejectedQty: nonNegativeNumber,
        issuedQty: nonNegativeNumber,
        notes: { type: "string", nullable: true },
      },
      ["poLineId", "acceptedQty"],
    ),
    DeliveryReceiptRequest: objectSchema(
      {
        receiptNumber: { type: "string" },
        receivedAt: nullableDateString,
        receivedBy: { type: "string", nullable: true },
        warehouseLocation: { type: "string", nullable: true },
        deliveryNote: { type: "string", nullable: true },
        dailyReportId: nullableUuid,
        issueToActivity: { type: "boolean" },
        notes: { type: "string", nullable: true },
        lines: arrayOf(ref("DeliveryReceiptLineRequest")),
      },
      ["receiptNumber", "lines"],
    ),
    ActivityMaterialRequest: objectSchema(
      {
        name: { type: "string" },
        code: { type: "string", nullable: true },
        spec: { type: "string", nullable: true },
        unit: { type: "string" },
        qty: { type: "number", minimum: 0.001 },
        plannedQty: { type: "number", minimum: 0.001 },
        supplierId: nullableUuid,
        supplierName: { type: "string", nullable: true },
        supplierContact: { type: "string", nullable: true },
        procurementPackageId: nullableUuid,
        requiredDate: nullableDateString,
        requiredTiming: {
          type: "string",
          enum: ["activity_start", "activity_finish"],
        },
        needOffsetDays: { type: "integer", minimum: 0 },
        leadWeeks: { type: "integer", minimum: 0 },
        bufferDays: { type: "integer", minimum: 0 },
        orderByDate: nullableDateString,
        status: {
          type: "string",
          enum: [
            "planned",
            "ordered",
            "partial",
            "received",
            "issued",
            "consumed",
            "cancelled",
          ],
        },
        notes: { type: "string", nullable: true },
      },
      ["name", "unit", "qty"],
    ),
    ActivityMaterialUsageRequest: objectSchema(
      {
        usedQty: { type: "number", minimum: 0.001 },
        wasteQty: nonNegativeNumber,
        usageDate: nullableDateString,
        poLineId: nullableUuid,
        receiptLineId: nullableUuid,
        dailyReportId: nullableUuid,
        installedLocation: { type: "string", nullable: true },
        notes: { type: "string", nullable: true },
      },
      ["usedQty"],
    ),
    ProcurementLeadTimeAlertWorkflowRequest: objectSchema({
      note: { type: "string", nullable: true },
    }),
    ProcurementLeadTimeAlertUpdateRequest: objectSchema(
      {
        status: {
          type: "string",
          enum: ["acknowledged"],
        },
      },
      ["status"],
    ),
    LongLeadRequest: objectSchema(
      {
        item: { type: "string" },
        activityId: nullableUuid,
        leadWeeks: { type: "integer", minimum: 0 },
        requiredTiming: {
          type: "string",
          enum: ["activity_start", "activity_finish"],
        },
        needOffsetDays: { type: "integer", minimum: 0 },
        bufferDays: { type: "integer", minimum: 0 },
        orderBy: { type: "string" },
        expectedDeliveryDate: nullableDateString,
        deliveredAt: nullableDateString,
        warehouseStatus: {
          type: "string",
          enum: ["not_received", "partial", "received", "issued"],
        },
        criticality: { type: "string" },
        risk: { type: "string" },
        status: {
          type: "string",
          enum: ["not_ordered", "ordered", "delivered"],
        },
        supplier: { type: "string" },
      },
      ["item"],
    ),
    NcrRequest: objectSchema({
      severity: { type: "string", enum: ["major", "minor"] },
      status: { type: "string", enum: ["open"] },
      owner: { type: "string" },
      reviewer: { type: "string" },
      approver: { type: "string" },
      responsible: { type: "string" },
      activityId: nullableUuid,
      activityIds: arrayOf(uuid),
      activityLinks: arrayOf(ref("ActivityLinkInput")),
      attachments: arrayOf(ref("WorkflowAttachmentRef")),
      attachmentRefs: arrayOf(ref("WorkflowAttachmentRef")),
      comment: { type: "string" },
      closureComment: { type: "string" },
      statusComment: { type: "string" },
      dueDate: nullableDateString,
      closedDate: nullableDateString,
    }),
    QaCloseoutRequest: objectSchema({
      responsible: { type: "string" },
      owner: { type: "string" },
      dueDate: nullableDateString,
      closureComment: { type: "string" },
      comment: { type: "string" },
      statusComment: { type: "string" },
      activityId: nullableUuid,
      activityIds: arrayOf(uuid),
      activityLinks: arrayOf(ref("ActivityLinkInput")),
      attachments: arrayOf(ref("WorkflowAttachmentRef")),
      attachmentRefs: arrayOf(ref("WorkflowAttachmentRef")),
    }),
    RfiPerson: objectSchema({ id: uuid, name: { type: "string" }, email: { type: "string", nullable: true } }),
    RfiListedPerson: objectSchema({ userId: uuid, id: uuid, name: { type: "string" }, email: { type: "string", nullable: true }, sortOrder: { type: "integer" } }),
    RfiResponse: objectSchema({
      id: uuid,
      rfiId: uuid,
      body: { type: "string" },
      isOfficial: { type: "boolean" },
      revision: { type: "integer" },
      authorId: nullableUuid,
      author: { ...ref("RfiPerson"), nullable: true },
      createdAt: dateString,
      updatedAt: dateString,
    }),
    RfiDetail: objectSchema({
      id: uuid,
      ref: { type: "string" },
      subject: { type: "string" },
      question: { type: "string", nullable: true },
      response: { type: "string", nullable: true, description: "Mirror of the official response." },
      status: { type: "string", enum: ["draft", "open", "answered", "closed", "archived"] },
      priority: { type: "string" },
      revision: { type: "integer", description: "Bumped on every reopen; the official answer belongs to the current revision." },
      managerUserId: nullableUuid,
      manager: { ...ref("RfiPerson"), nullable: true },
      createdBy: nullableUuid,
      ballInCourtUserId: nullableUuid,
      assignees: arrayOf(ref("RfiListedPerson")),
      distribution: arrayOf(ref("RfiListedPerson")),
      responses: arrayOf(ref("RfiResponse")),
      officialResponse: { ...ref("RfiResponse"), nullable: true },
      officialResponseId: nullableUuid,
      specSection: { type: "string", nullable: true },
      locationId: nullableUuid,
      location: { nullable: true, ...objectSchema({ id: uuid, name: { type: "string" }, code: { type: "string", nullable: true }, path: { type: "string" } }) },
      activity: { nullable: true, ...objectSchema({ id: uuid, name: { type: "string" } }) },
      costImpact: { type: "boolean" },
      costImpactAmount: { type: "number", nullable: true },
      scheduleImpactFlag: { type: "boolean" },
      scheduleImpact: { type: "integer", description: "Days; written to the activity link when the RFI closes with the flag set." },
      changeOrderId: nullableUuid,
      isOverdue: { type: "boolean" },
      responseRequiredBy: nullableDateString,
      dueDate: nullableDateString,
      answeredDate: nullableDateString,
      path: { type: "string", nullable: true },
      attachments: arrayOf(ref("GenericObject")),
      activityLinks: arrayOf(ref("GenericObject")),
      history: arrayOf(ref("GenericObject")),
    }),
    RfiPeopleRequest: objectSchema({
      managerUserId: { ...nullableUuid, description: "Reviews answers and closes; holds the ball once answered." },
      assigneeUserIds: { ...arrayOf(uuid), description: "Replace the assignee list (first assignee holds the ball while open). Omit to leave unchanged." },
      distributionUserIds: { ...arrayOf(uuid), description: "Replace the distribution list. Omit to leave unchanged." },
    }),
    RfiResponseRequest: objectSchema(
      {
        body: { type: "string", maxLength: 20000 },
        isOfficial: { type: "boolean", description: "true answers the RFI (needs `rfi.answer`); false adds to the thread." },
      },
      ["body"],
    ),
    RfiConvertRequest: objectSchema({
      description: { type: "string", nullable: true, description: "Defaults to the RFI subject, question and official response." },
      category: { type: "string", nullable: true },
      value: { type: "number", nullable: true, description: "Defaults to the RFI cost impact amount." },
    }),
    RfiRequest: objectSchema(
      {
        subject: { type: "string" },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        status: { type: "string", enum: ["draft", "open", "answered", "closed"], description: "draft is private to its creator and manager until submitted." },
        managerUserId: nullableUuid,
        assigneeUserIds: arrayOf(uuid),
        distributionUserIds: arrayOf(uuid),
        specSection: { type: "string", nullable: true },
        locationId: nullableUuid,
        costImpact: { type: "boolean" },
        costImpactAmount: { type: "number", nullable: true },
        scheduleImpactFlag: { type: "boolean" },
        scheduleImpact: { type: "integer", description: "Days." },
        question: { type: "string", nullable: true },
        discipline: { type: "string", nullable: true },
        owner: { type: "string" },
        reviewer: { type: "string" },
        approver: { type: "string" },
        ownerPartyId: nullableUuid,
        reviewerPartyId: nullableUuid,
        approverPartyId: nullableUuid,
        responsible: { type: "string" },
        activityId: nullableUuid,
        activityIds: arrayOf(uuid),
        activityLinks: arrayOf(ref("ActivityLinkInput")),
        attachments: arrayOf(ref("WorkflowAttachmentRef")),
        attachmentRefs: arrayOf(ref("WorkflowAttachmentRef")),
        revisions: arrayOf(ref("GenericObject")),
        comment: { type: "string" },
        statusComment: { type: "string" },
        raisedDate: nullableDateString,
        dueDate: nullableDateString,
        responseRequiredBy: nullableDateString,
        answeredDate: nullableDateString,
      },
      ["subject"],
    ),
    SubmittalRequest: objectSchema(
      {
        title: { type: "string" },
        status: {
          type: "string",
          enum: ["pending", "under_review", "approved", "resubmit", "rejected"],
        },
        owner: { type: "string" },
        reviewer: { type: "string" },
        approver: { type: "string" },
        ownerPartyId: nullableUuid,
        reviewerPartyId: nullableUuid,
        approverPartyId: nullableUuid,
        activityId: nullableUuid,
        activityIds: arrayOf(uuid),
        activityLinks: arrayOf(ref("ActivityLinkInput")),
        attachments: arrayOf(ref("WorkflowAttachmentRef")),
        attachmentRefs: arrayOf(ref("WorkflowAttachmentRef")),
        revisions: arrayOf(ref("GenericObject")),
        comment: { type: "string" },
        statusComment: { type: "string" },
        submittedOn: nullableDateString,
        dueDate: nullableDateString,
        reviewedOn: nullableDateString,
        discipline: { type: "string", nullable: true },
        specRef: { type: "string", nullable: true },
        revision: { type: "string", nullable: true },
        packageId: nullableUuid,
        workflowTemplateId: nullableUuid,
        leadTimeWeeks: { type: "integer", minimum: 0, maximum: 104, nullable: true, description: "Lead time after approval before the material is on site." },
        reviewDays: { type: "integer", minimum: 0, maximum: 365, nullable: true, description: "Overrides the workflow template's review days when computing submitBy." },
        requiredOnSite: { ...nullableDateString, description: "Need date; defaults to the linked activity's start." },
        managerUserId: nullableUuid,
        distributionUserIds: arrayOf(uuid),
      },
      ["title"],
    ),
    SubmittalStepAssignee: objectSchema({
      type: { type: "string", enum: ["user", "party_role", "role"] },
      userId: nullableUuid,
      role: { type: "string", nullable: true, description: "Party role (owner, consultant, contractor, subcontractor) or project role id." },
    }),
    SubmittalWorkflowStep: objectSchema({
      name: { type: "string" },
      mode: { type: "string", enum: ["sequential", "parallel"], description: "Parallel steps need every reviewer; sequential steps close on the first approval." },
      days: { type: "integer", minimum: 0, maximum: 365 },
      assignees: arrayOf(ref("SubmittalStepAssignee")),
    }),
    SubmittalWorkflowTemplate: objectSchema({
      id: uuid,
      projectId: nullableUuid,
      scope: { type: "string", enum: ["company", "project"] },
      name: { type: "string" },
      description: { type: "string", nullable: true },
      isDefault: { type: "boolean" },
      status: { type: "string", enum: ["active", "archived"] },
      steps: arrayOf(ref("SubmittalWorkflowStep")),
      reviewDays: { type: "integer" },
      editable: { type: "boolean" },
      createdAt: nullableDateString,
      updatedAt: nullableDateString,
    }),
    SubmittalWorkflowTemplateRequest: objectSchema({
      name: { type: "string" },
      description: { type: "string", nullable: true },
      isDefault: { type: "boolean" },
      status: { type: "string", enum: ["active", "archived"] },
      steps: arrayOf(ref("SubmittalWorkflowStep")),
    }),
    SubmittalStepAssignment: objectSchema({
      id: uuid,
      userId: uuid,
      user: nullableRef("RfiPerson"),
      role: { type: "string" },
      status: { type: "string", enum: ["pending", "approved", "rejected", "skipped"] },
      responseCode: { type: "string", nullable: true },
      responseCodeLabel: { type: "string", nullable: true },
      comment: { type: "string", nullable: true },
      decidedAt: nullableDateString,
    }),
    SubmittalStep: objectSchema({
      id: uuid,
      revisionNumber: { type: "integer" },
      sortOrder: { type: "integer" },
      name: { type: "string" },
      mode: { type: "string", enum: ["sequential", "parallel"] },
      days: { type: "integer" },
      status: { type: "string", enum: ["pending", "active", "approved", "rejected", "skipped"] },
      startedAt: nullableDateString,
      dueAt: nullableDateString,
      completedAt: nullableDateString,
      isLate: { type: "boolean" },
      assignments: arrayOf(ref("SubmittalStepAssignment")),
    }),
    SubmittalDetail: objectSchema({
      id: uuid,
      ref: { type: "string" },
      title: { type: "string" },
      status: { type: "string" },
      revision: { type: "string", nullable: true },
      revisionNumber: { type: "integer", description: "Review cycle counter; bumps each time a returned submittal goes back under review." },
      responseCode: { type: "string", nullable: true, enum: ["approved", "approved_as_noted", "revise_resubmit", "rejected", "custom", null] },
      responseCodeLabel: { type: "string", nullable: true },
      package: nullableRef("GenericObject"),
      workflowTemplate: nullableRef("GenericObject"),
      manager: nullableRef("RfiPerson"),
      activity: nullableRef("GenericObject"),
      distribution: arrayOf(ref("RfiPerson")),
      distributionUserIds: arrayOf(uuid),
      reviewSteps: arrayOf(ref("SubmittalStep")),
      currentRevisionSteps: arrayOf(ref("SubmittalStep")),
      activeStep: nullableRef("SubmittalStep"),
      lateSteps: { type: "integer" },
      leadTimeWeeks: { type: "integer", nullable: true },
      requiredOnSite: nullableDateString,
      submitBy: nullableDateString,
      isLate: { type: "boolean", description: "Not yet submitted and past submitBy." },
      scheduleImpactDays: { type: "integer" },
      distributedAt: nullableDateString,
      path: { type: "string" },
    }),
    SubmittalDecisionRequest: objectSchema(
      {
        decision: { type: "string", enum: ["approve", "reject"] },
        responseCode: { type: "string", enum: ["approved", "approved_as_noted", "revise_resubmit", "rejected", "custom"], description: "Approve accepts approved / approved_as_noted / custom; reject accepts revise_resubmit / rejected / custom." },
        responseCodeLabel: { type: "string", nullable: true, description: "Required with the custom code." },
        comment: { type: "string", nullable: true, description: "Required on reject." },
      },
      ["decision"],
    ),
    SubmittalPeopleRequest: objectSchema({ managerUserId: nullableUuid, distributionUserIds: arrayOf(uuid) }),
    SubmittalPackageItem: objectSchema({
      id: uuid,
      ref: { type: "string" },
      title: { type: "string" },
      status: { type: "string" },
      revision: { type: "string", nullable: true },
      revisionNumber: { type: "integer" },
      responseCode: { type: "string", nullable: true },
      responseCodeLabel: { type: "string", nullable: true },
      currentStepId: nullableUuid,
      ballInCourtUserId: nullableUuid,
      dueDate: nullableDateString,
    }),
    SubmittalPackage: objectSchema({
      id: uuid,
      projectId: uuid,
      number: { type: "integer" },
      ref: { type: "string", example: "PKG-001" },
      name: { type: "string" },
      description: { type: "string", nullable: true },
      status: { type: "string", enum: ["open", "submitted", "closed"], description: "Derived: closed when every item is approved, submitted while any item is under review." },
      activityId: nullableUuid,
      activity: nullableRef("GenericObject"),
      requiredOnSite: nullableDateString,
      managerUserId: nullableUuid,
      manager: nullableRef("RfiPerson"),
      items: arrayOf(ref("SubmittalPackageItem")),
      summary: objectSchema({ total: { type: "integer" }, underReview: { type: "integer" }, approved: { type: "integer" }, returned: { type: "integer" } }),
      createdAt: nullableDateString,
      updatedAt: nullableDateString,
    }),
    SubmittalPackageRequest: objectSchema({
      name: { type: "string" },
      description: { type: "string", nullable: true },
      activityId: nullableUuid,
      requiredOnSite: nullableDateString,
      managerUserId: nullableUuid,
      submittalIds: arrayOf(uuid),
    }),
    SubmittalPackageActionResult: objectSchema({
      package: ref("SubmittalPackage"),
      results: arrayOf(objectSchema({ submittalId: uuid, ref: { type: "string" }, submitted: { type: "boolean" }, decided: { type: "boolean" }, skipped: { type: "boolean" }, reason: { type: "string", nullable: true }, error: { type: "string", nullable: true } })),
    }),
    SafetyIncidentRequest: objectSchema(
      {
        incidentType: {
          type: "string",
          enum: ["near_miss", "first_aid", "lti", "fatality"],
        },
        title: { type: "string" },
        owner: { type: "string" },
        reviewer: { type: "string" },
        approver: { type: "string" },
        activityId: nullableUuid,
        activityIds: arrayOf(uuid),
        activityLinks: arrayOf(ref("ActivityLinkInput")),
        attachments: arrayOf(ref("WorkflowAttachmentRef")),
        attachmentRefs: arrayOf(ref("WorkflowAttachmentRef")),
        comment: { type: "string" },
        closureComment: { type: "string" },
        statusComment: { type: "string" },
        date: nullableDateString,
        dueDate: nullableDateString,
        closedDate: nullableDateString,
        lostDays: { type: "integer", minimum: 0 },
        status: { type: "string", enum: ["open", "investigating"] },
      },
      ["incidentType", "title"],
    ),
  },
};

add(
  "/auth/register",
  "post",
  operation({
    tag: "Auth",
    summary: "Register an organization user.",
    description:
      "Creates a server-side refresh session, sets it as an httpOnly cookie, and returns a short-lived access token.",
    operationId: "register",
    security: false,
    requestBody: jsonBody(ref("AuthRegisterRequest"), "Registration payload."),
    responses: {
      201: authSessionResponse("Registered and authenticated."),
    },
    status: 201,
  }),
);

add(
  "/auth/login",
  "post",
  operation({
    tag: "Auth",
    summary: "Exchange email and password for an access token.",
    description:
      "Creates a server-side refresh session, sets it as an httpOnly cookie, and returns a short-lived access token.",
    operationId: "login",
    security: false,
    requestBody: jsonBody(ref("AuthLoginRequest"), "Login credentials."),
    responses: {
      200: authSessionResponse("Authenticated."),
    },
  }),
);

add(
  "/auth/forgot-password",
  "post",
  operation({
    tag: "Auth",
    summary: "Request a password reset email.",
    description:
      "Always returns a neutral success payload. When the email belongs to an active user, a hashed one-time reset token is stored and a reset link is sent by the configured email provider.",
    operationId: "requestPasswordReset",
    security: false,
    requestBody: jsonBody(
      ref("AuthForgotPasswordRequest"),
      "Password reset request payload.",
    ),
    responseSchema: ref("AuthForgotPasswordResponse"),
  }),
);

add(
  "/auth/reset-password",
  "post",
  operation({
    tag: "Auth",
    summary: "Complete a password reset with a one-time token.",
    description:
      "Validates the hashed reset token, enforces expiry and single-use, updates the password, revokes other reset tokens, and revokes active refresh sessions for the user.",
    operationId: "resetPassword",
    security: false,
    requestBody: jsonBody(
      ref("AuthResetPasswordRequest"),
      "Password reset completion payload.",
    ),
    responseSchema: ref("AuthResetPasswordResponse"),
  }),
);

add(
  "/auth/invitations/{token}",
  "get",
  operation({
    tag: "Auth",
    summary: "Preview a pending invitation.",
    description:
      "Validates an invitation token without accepting it and returns the invited org, project, role, expiry, and whether the user needs to choose a password.",
    operationId: "getInvitationPreview",
    security: false,
    parameters: [
      pathParam("token", "Opaque invitation token from the email link.", null),
    ],
    responseSchema: ref("InvitationPreview"),
  }),
);

add(
  "/auth/invitations/accept",
  "post",
  operation({
    tag: "Auth",
    summary: "Accept an invitation and start a session.",
    description:
      "Creates a user or links an existing same-organization user, assigns the invitation role/project, marks the token accepted, audits the event, and issues the normal refresh cookie plus access token response.",
    operationId: "acceptInvitation",
    security: false,
    requestBody: jsonBody(
      ref("InvitationAcceptRequest"),
      "Invitation acceptance payload.",
    ),
    responses: {
      200: authSessionResponse("Invitation accepted and authenticated."),
    },
  }),
);

const refreshAccessTokenOperation = operation({
  tag: "Auth",
  summary: "Rotate the refresh session and return a new access token.",
  description:
    "Requires the httpOnly pmc_refresh_token cookie. Body refresh tokens are not accepted. The old refresh session is revoked and replaced.",
  operationId: "refreshAccessToken",
  security: false,
  responses: {
    200: authSessionResponse("Refresh session rotated."),
  },
});
refreshAccessTokenOperation.security = [{ refreshCookie: [] }];
refreshAccessTokenOperation["x-permissions"] = { auth: "refresh-cookie" };

add("/auth/refresh", "post", refreshAccessTokenOperation);

add(
  "/auth/logout",
  "post",
  operation({
    tag: "Auth",
    summary: "Revoke the current refresh session.",
    description:
      "Revokes the refresh session identified by the httpOnly pmc_refresh_token cookie when present and clears the cookie.",
    operationId: "logout",
    security: false,
    responses: {
      200: {
        ...jsonResponse("Refresh session revoked.", ref("LogoutResponse")),
        headers: {
          "Set-Cookie": {
            description: "Clears the httpOnly pmc_refresh_token cookie.",
            schema: { type: "string" },
          },
        },
      },
    },
  }),
);

add(
  "/auth/me",
  "get",
  operation({
    tag: "Auth",
    summary: "Return the authenticated user profile.",
    operationId: "getCurrentUser",
    responseSchema: ref("AuthUser"),
  }),
);

add(
  "/auth/me/settings",
  "get",
  operation({
    tag: "Auth",
    summary: "Return persisted settings for the authenticated user.",
    operationId: "getCurrentUserSettings",
    responseSchema: ref("UserSettingsResponse"),
  }),
);

add(
  "/auth/me/permissions",
  "get",
  operation({
    tag: "Auth",
    summary:
      "Return the caller's effective permission matrix (module → level, actions, transitions).",
    description:
      "Without projectId the matrix reflects the org role. With projectId it is resolved through the permission template chain: project user template → party template → assignment role → org role. Company admins are always admin on user_management and project_parties.",
    operationId: "getCurrentUserPermissions",
    parameters: [
      queryParam("projectId", "Project UUID to resolve against.", uuid),
    ],
    responseSchema: ref("PermissionMatrix"),
  }),
);

add(
  "/auth/me/profile",
  "patch",
  operation({
    tag: "Auth",
    summary: "Update the authenticated user's profile settings.",
    operationId: "updateCurrentUserProfileSettings",
    requestBody: jsonBody(
      ref("UserSettingsProfileUpdateRequest"),
      "Profile settings payload.",
    ),
    responseSchema: ref("UserSettingsResponse"),
  }),
);

add(
  "/auth/me/account",
  "patch",
  operation({
    tag: "Auth",
    summary: "Update the authenticated user's account settings.",
    operationId: "updateCurrentUserAccountSettings",
    requestBody: jsonBody(
      ref("UserSettingsAccountUpdateRequest"),
      "Account settings payload.",
    ),
    responseSchema: ref("UserSettingsResponse"),
  }),
);

add(
  "/auth/me/appearance",
  "patch",
  operation({
    tag: "Auth",
    summary: "Update the authenticated user's appearance preferences.",
    operationId: "updateCurrentUserAppearanceSettings",
    requestBody: jsonBody(
      ref("UserSettingsAppearance"),
      "Appearance settings payload.",
    ),
    responseSchema: ref("UserSettingsResponse"),
  }),
);

add(
  "/auth/me/display",
  "patch",
  operation({
    tag: "Auth",
    summary: "Update the authenticated user's top-navigation preferences.",
    operationId: "updateCurrentUserDisplaySettings",
    requestBody: jsonBody(
      ref("UserSettingsDisplay"),
      "Display settings payload.",
    ),
    responseSchema: ref("UserSettingsResponse"),
  }),
);

add(
  "/billing/subscription",
  "get",
  operation({
    tag: "Billing",
    summary: "Get the current organization subscription.",
    operationId: "getBillingSubscription",
    responseSchema: ref("BillingSubscription"),
  }),
);

add(
  "/billing/plans",
  "get",
  operation({
    tag: "Billing",
    summary: "List visible subscription plans for the organization.",
    operationId: "listBillingPlans",
    responseSchema: ref("BillingPlansResponse"),
  }),
);

add(
  "/billing/transactions",
  "get",
  operation({
    tag: "Billing",
    summary: "List subscription invoice transactions.",
    operationId: "listBillingTransactions",
    responseSchema: arrayOf(ref("BillingTransaction")),
  }),
);

add(
  "/billing/trial/start",
  "post",
  operation({
    tag: "Billing",
    summary: "Create a Stripe SetupIntent for the trial card-on-file flow.",
    description:
      "PM-only. Requires backend Stripe secret, webhook secret, and price configuration to be valid in production.",
    operationId: "startBillingTrial",
    permissions: rolesPermission("pm"),
    responseSchema: ref("BillingTrialStartResponse"),
  }),
);

add(
  "/billing/trial/confirm",
  "post",
  operation({
    tag: "Billing",
    summary: "Confirm a trial after Stripe returns a payment method.",
    operationId: "confirmBillingTrial",
    permissions: rolesPermission("pm"),
    requestBody: jsonBody(
      ref("BillingTrialConfirmRequest"),
      "Stripe payment method confirmation payload.",
    ),
    responseSchema: ref("BillingSubscription"),
  }),
);

add(
  "/billing/subscribe",
  "post",
  operation({
    tag: "Billing",
    summary: "Create or update a paid Stripe subscription.",
    operationId: "subscribeBillingPlan",
    permissions: rolesPermission("pm"),
    requestBody: jsonBody(
      ref("BillingSubscribeRequest"),
      "Paid plan selection and optional Stripe payment method.",
    ),
    responseSchema: ref("BillingSubscription"),
  }),
);

add(
  "/billing/cancel",
  "post",
  operation({
    tag: "Billing",
    summary: "Cancel the active subscription at period end.",
    operationId: "cancelBillingSubscription",
    permissions: rolesPermission("pm"),
    responseSchema: ref("BillingSubscription"),
  }),
);

add(
  "/billing/enterprise-lead",
  "post",
  operation({
    tag: "Billing",
    summary: "Create an enterprise plan lead.",
    operationId: "createBillingEnterpriseLead",
    permissions: rolesPermission("pm"),
    requestBody: jsonBody(
      ref("BillingEnterpriseLeadRequest"),
      "Enterprise seat-band qualification payload.",
    ),
    responseSchema: ref("BillingEnterpriseLeadResponse"),
    status: 201,
  }),
);

add(
  "/webhooks/stripe",
  "post",
  operation({
    tag: "Webhooks",
    summary: "Receive Stripe subscription lifecycle events.",
    description:
      "Unauthenticated endpoint verified exclusively with the Stripe-Signature header and STRIPE_WEBHOOK_SECRET. Unsigned or incorrectly signed requests are rejected and must not mutate billing state.",
    operationId: "receiveStripeWebhook",
    security: false,
    responseSchema: ref("StripeWebhookAck"),
  }),
);

add(
  "/search",
  "get",
  operation({
    tag: "Search",
    summary: "Search authorized records across projects and modules.",
    description:
      "Returns lightweight grouped results for the command menu. The service first scopes projects to the authenticated user's organization and project assignments or active project-party memberships, then applies each module's read permission and record-level visibility rules before returning titles.",
    operationId: "globalSearch",
    parameters: [
      queryParam("q", "Search text matched against entity identifiers, titles, and short descriptions.", {
        type: "string",
        maxLength: 120,
      }),
      queryParam("type", "Comma-separated result types. Examples: rfi, submittal, document, drawing, change_order, task.", {
        type: "string",
      }),
      queryParam("projectId", "Restrict results to one accessible project.", uuid),
      queryParam("status", "Comma-separated status values matched against result types that support status filtering.", {
        type: "string",
      }),
      queryParam("dateFrom", "Return records updated on or after this date.", dateString),
      queryParam("dateTo", "Return records updated on or before this date.", dateString),
      queryParam("includeArchived", "Include archived records where the entity supports archive visibility.", {
        type: "boolean",
        default: false,
      }),
      queryParam("limit", "Maximum global results to return.", {
        type: "integer",
        minimum: 1,
        maximum: 50,
        default: 20,
      }),
    ],
    permissions: authenticatedOnly,
    responseSchema: ref("GlobalSearchResponse"),
  }),
);

add(
  "/companies",
  "get",
  operation({
    tag: "Companies",
    summary: "List managed companies in the authenticated organization.",
    description:
      "Returns reusable company records for owners, consultants, contractors, subcontractors, and internal organizations.",
    operationId: "listCompanies",
    parameters: [
      ...cursorParams,
      queryParam("status", "Filter companies by status.", {
        type: "string",
        enum: ["active", "inactive"],
      }),
      queryParam("search", "Search company name or registration fields.", {
        type: "string",
      }),
    ],
    permissions: modulePermission("project_parties", "read"),
    responseSchema: ref("CompaniesResponse"),
  }),
);

add(
  "/companies",
  "post",
  operation({
    tag: "Companies",
    summary: "Create a managed company.",
    operationId: "createCompany",
    permissions: modulePermission("project_parties", "create"),
    requestBody: jsonBody(ref("CompanyMutation"), "Company payload."),
    responseSchema: ref("Company"),
    status: 201,
  }),
);

add(
  "/projects",
  "get",
  operation({
    tag: "Projects",
    summary: "List projects accessible to the authenticated user.",
    description:
      "PM users receive all projects in their organization. Other roles receive projects where they have a ProjectAssignment row or active ProjectParty membership.",
    operationId: "listProjects",
    parameters: [
      ...cursorParams,
      queryParam("status", "Filter by project status.", { type: "string" }),
      includeArchivedParam,
      queryParam("search", "Search project name or metadata.", {
        type: "string",
      }),
    ],
    responseSchema: ref("CursorPage"),
  }),
);

add(
  "/projects",
  "post",
  operation({
    tag: "Projects",
    summary: "Create a project.",
    operationId: "createProject",
    permissions: rolesPermission("pm", "planning_eng"),
    requestBody: jsonBody(
      ref("ProjectMutation"),
      "Project metadata. name is required on create.",
    ),
    status: 201,
  }),
);

add(
  "/projects/workspace-dashboard",
  "get",
  operation({
    tag: "Projects",
    summary: "Get workspace-level construction health and workflow queues.",
    description:
      "Aggregates all organization projects for PM users and only assigned projects for non-PM users. Returns officialKpis with sourceRule, sourceStatus, cutoffDate, and drill-through targets. Draft/rejected/cancelled records are excluded from official KPI cards; submitted/pending workflow values are returned separately under pendingReview.",
    operationId: "getWorkspaceDashboard",
    responseSchema: ref("GenericObject"),
  }),
);

add(
  "/projects/{projectId}",
  "get",
  operation({
    tag: "Projects",
    summary: "Get a project by id.",
    operationId: "getProject",
    parameters: projectParams,
  }),
);

add(
  "/projects/{projectId}",
  "patch",
  operation({
    tag: "Projects",
    summary: "Update project metadata.",
    operationId: "updateProject",
    parameters: projectParams,
    permissions: rolesPermission("pm", "planning_eng"),
    requestBody: jsonBody(
      ref("ProjectMutation"),
      "Partial project metadata.",
      false,
    ),
  }),
);

add(
  "/projects/{projectId}",
  "delete",
  operation({
    tag: "Projects",
    summary: "Archive a project while retaining project history.",
    operationId: "deleteProject",
    parameters: projectParams,
    permissions: rolesPermission("pm", "planning_eng"),
    responseSchema: ref("ArchiveResponse"),
  }),
);

add(
  "/projects/{projectId}/parties",
  "get",
  operation({
    tag: "Project Parties",
    summary: "List companies assigned to a project by contractual role.",
    operationId: "listProjectParties",
    parameters: [
      ...projectParams,
      queryParam("role", "Filter by project party role.", {
        type: "string",
        enum: ["owner", "consultant", "contractor", "subcontractor", "all"],
      }),
      queryParam("status", "Filter by active/inactive status.", {
        type: "string",
        enum: ["active", "inactive", "all"],
      }),
    ],
    permissions: modulePermission("project_parties", "read"),
    responseSchema: ref("ProjectPartiesResponse"),
  }),
);

add(
  "/projects/{projectId}/parties",
  "post",
  operation({
    tag: "Project Parties",
    summary: "Assign or upsert a company as a project party.",
    description:
      "Creates a reusable company when companyName is supplied, links it to the project with a party role, and syncs legacy project party name fields for backward compatibility.",
    operationId: "upsertProjectParty",
    parameters: projectParams,
    permissions: modulePermission("project_parties", "create"),
    requestBody: jsonBody(
      ref("ProjectPartyMutation"),
      "Project party payload.",
    ),
    responseSchema: ref("ProjectParty"),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/parties/{partyId}",
  "patch",
  operation({
    tag: "Project Parties",
    summary: "Update a project party relationship.",
    operationId: "updateProjectParty",
    parameters: [...projectParams, partyIdParam],
    permissions: modulePermission("project_parties", "update"),
    requestBody: jsonBody(
      ref("ProjectPartyMutation"),
      "Partial project party payload.",
      false,
    ),
    responseSchema: ref("ProjectParty"),
  }),
);

add(
  "/projects/{projectId}/parties/{partyId}",
  "delete",
  operation({
    tag: "Project Parties",
    summary: "Deactivate a project party relationship.",
    operationId: "removeProjectParty",
    parameters: [...projectParams, partyIdParam],
    permissions: modulePermission("project_parties", "delete"),
    responseSchema: ref("ProjectParty"),
  }),
);

add(
  "/projects/{projectId}/parties/{partyId}/members",
  "post",
  operation({
    tag: "Project Parties",
    summary: "Add an existing organization user to a project party company.",
    operationId: "addProjectPartyMember",
    parameters: [...projectParams, partyIdParam],
    permissions: modulePermission("project_parties", "submit"),
    requestBody: jsonBody(
      ref("ProjectPartyMemberMutation"),
      "Project party member payload.",
    ),
    responseSchema: ref("GenericObject"),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/parties/{partyId}/members/{userId}",
  "delete",
  operation({
    tag: "Project Parties",
    summary: "Remove a user from a project party company.",
    operationId: "removeProjectPartyMember",
    parameters: [...projectParams, partyIdParam, userIdParam],
    permissions: modulePermission("project_parties", "delete"),
    responseSchema: ref("GenericObject"),
  }),
);

add(
  "/projects/{projectId}/setup-readiness",
  "get",
  operation({
    tag: "Projects",
    summary:
      "Get setup readiness gates for BOQ, schedule, allocations, baseline, and progress.",
    operationId: "getProjectSetupReadiness",
    parameters: projectParams,
  }),
);

add(
  "/projects/{projectId}/boq",
  "get",
  operation({
    tag: "BOQ",
    summary: "Get BOQ items and value-state rollups for a project.",
    operationId: "getProjectBoq",
    parameters: projectParams,
  }),
);

add(
  "/projects/{projectId}/boq/upload",
  "post",
  operation({
    tag: "BOQ",
    summary: "Upload and process an Excel BOQ revision file.",
    description:
      "Scans and type-checks the workbook, stores the original upload as private project document metadata, creates a BOQ revision, and compares it with current active BOQ rows. Unlocked projects import changed/new rows without deleting omitted rows. Baseline-locked projects save a comparison-only revision and do not mutate current BOQ rows, allocations, progress, IPC, or reporting basis.",
    operationId: "uploadBoq",
    parameters: projectParams,
    permissions: rolesPermission("pm", "planning_eng", "qs"),
    requestBody: fileUploadBody({
      description:
        "Excel BOQ upload. Files with more than 60 items are chunked by section.",
      accepted: ".xlsx or .xls workbook, maximum 50 MB.",
      extraProperties: { label: { type: "string" } },
    }),
    responseSchema: ref("BoqUploadResponse"),
  }),
);

add(
  "/projects/{projectId}/boq/uploads/{documentId}",
  "get",
  operation({
    tag: "BOQ",
    summary: "Download an original BOQ upload source workbook.",
    operationId: "downloadBoqUploadSource",
    parameters: [
      ...projectParams,
      pathParam(
        "documentId",
        "ProjectDocument UUID for the uploaded BOQ workbook.",
      ),
    ],
    permissions: rolesPermission("pm", "planning_eng", "qs"),
    responses: {
      200: binaryResponse(
        "BOQ upload workbook stream when local storage is used.",
        "application/octet-stream",
      ),
      302: redirectResponse(
        "Redirects to a short-lived private S3 presigned URL when object storage is used.",
      ),
    },
  }),
);

add(
  "/projects/{projectId}/boq/template",
  "get",
  operation({
    tag: "BOQ",
    summary: "Download the BOQ upload template workbook.",
    operationId: "downloadBoqTemplate",
    parameters: projectParams,
    permissions: rolesPermission("pm", "planning_eng", "qs"),
    responses: {
      200: binaryResponse(
        "BOQ template workbook.",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    },
  }),
);

add(
  "/projects/{projectId}/boq/job/{jobId}",
  "get",
  operation({
    tag: "BOQ",
    summary: "Poll BOQ upload job status.",
    operationId: "getBoqJob",
    parameters: [
      ...projectParams,
      pathParam("jobId", "Async BOQ job id.", null),
    ],
  }),
);

add(
  "/projects/{projectId}/boq/items",
  "post",
  operation({
    tag: "BOQ",
    summary:
      "Create a manual BOQ item, schedule activity, and draft BOQ allocation.",
    description:
      "Creates a BOQ item, an official schedule Activity with a generated activityCode, and a draft ActivityBoqAllocation. The allocation must be approved before it contributes to official EV, IPC, and reporting value.",
    operationId: "createBoqItem",
    parameters: projectParams,
    permissions: rolesPermission("pm", "planning_eng", "qs"),
    requestBody: jsonBody(ref("BoqItemMutation"), "Manual BOQ item payload."),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/boq/items/{id}",
  "patch",
  operation({
    tag: "BOQ",
    summary: "Update a BOQ item.",
    operationId: "updateBoqItem",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm", "planning_eng", "qs"),
    requestBody: jsonBody(
      ref("BoqItemMutation"),
      "Partial BOQ item payload.",
      false,
    ),
  }),
);

add(
  "/projects/{projectId}/boq/items/{id}",
  "delete",
  operation({
    tag: "BOQ",
    summary: "Delete a BOQ item.",
    operationId: "deleteBoqItem",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm", "planning_eng", "qs"),
  }),
);

add(
  "/projects/{projectId}/boq/items/{id}/activities",
  "post",
  operation({
    tag: "BOQ",
    summary: "Create a schedule activity with a draft BOQ allocation.",
    description:
      "Adds an official schedule Activity for the BOQ item and creates a draft ActivityBoqAllocation. This replaces the legacy live BoqActivity workflow; BoqActivity rows are suggestion/history records only.",
    operationId: "createBoqActivity",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm", "planning_eng", "qs"),
    requestBody: jsonBody(
      ref("BoqActivityMutation"),
      "Linked activity payload.",
    ),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/boq/activities/{activityId}",
  "patch",
  operation({
    tag: "BOQ",
    summary: "Update a BOQ-created draft schedule activity allocation.",
    description:
      "Updates the official schedule Activity name/dependency display and its draft ActivityBoqAllocation quantity/value. Submitted or approved allocations return ALLOCATION_NOT_EDITABLE and must use the allocation workflow.",
    operationId: "updateBoqActivity",
    parameters: [projectIdParam, activityIdParam],
    permissions: rolesPermission("pm", "planning_eng", "qs"),
    requestBody: jsonBody(
      ref("BoqActivityMutation"),
      "Partial linked activity/allocation payload.",
      false,
    ),
  }),
);

add(
  "/projects/{projectId}/boq/activities/{activityId}",
  "delete",
  operation({
    tag: "BOQ",
    summary: "Retire a BOQ-created draft schedule activity allocation.",
    description:
      "Rejects the draft ActivityBoqAllocation and retires the official schedule Activity. Submitted or approved allocations must be rejected or revised through the allocation workflow first.",
    operationId: "deleteBoqActivity",
    parameters: [projectIdParam, activityIdParam],
    permissions: rolesPermission("pm", "planning_eng", "qs"),
  }),
);

add(
  "/projects/{projectId}/schedule",
  "get",
  operation({
    tag: "Schedule",
    summary:
      "Get active project schedule, CPM rollups, and critical path explanations.",
    operationId: "getProjectSchedule",
    parameters: projectParams,
    permissions: modulePermission("schedule", "read"),
    responseSchema: ref("ProjectSchedule"),
  }),
);

add(
  "/projects/{projectId}/schedule/generate",
  "post",
  operation({
    tag: "Schedule",
    summary: "Start AI schedule generation from an uploaded BOQ/schedule file.",
    operationId: "generateSchedule",
    parameters: projectParams,
    permissions: modulePermission("schedule", "create"),
    requestBody: fileUploadBody({
      description: "AI schedule-generation upload.",
      accepted: ".xlsx, .xls, or .csv, maximum 50 MB.",
      extraProperties: { label: { type: "string" } },
    }),
    responseSchema: ref("ScheduleGenerateResponse"),
    status: 202,
  }),
);

add(
  "/projects/{projectId}/schedule/uploads/{documentId}",
  "get",
  operation({
    tag: "Schedule",
    summary: "Download a stored schedule-generation source upload.",
    operationId: "downloadScheduleGenerationSource",
    parameters: [
      ...projectParams,
      pathParam("documentId", "ProjectDocument UUID for the source upload."),
    ],
    permissions: modulePermission("schedule", "read"),
    responses: {
      200: binaryResponse(
        "Schedule source upload stream when local storage is used.",
        "application/octet-stream",
      ),
      302: redirectResponse(
        "Redirects to a short-lived private S3 presigned URL when object storage is used.",
      ),
    },
  }),
);

add(
  "/projects/{projectId}/schedule/job/{jobId}",
  "get",
  operation({
    tag: "Schedule",
    summary: "Poll schedule generation job status.",
    operationId: "getScheduleJob",
    parameters: [
      ...projectParams,
      pathParam("jobId", "Async schedule job id.", null),
    ],
    permissions: modulePermission("schedule", "read"),
  }),
);

add(
  "/projects/{projectId}/schedule/resources",
  "get",
  operation({
    tag: "Schedule",
    summary: "Get schedule resource plan.",
    operationId: "getScheduleResources",
    parameters: projectParams,
    permissions: modulePermission("schedule", "read"),
  }),
);

// Saved Gantt layouts. A layout is a view of the schedule, not schedule data,
// so reading the schedule is permission enough to keep one and to share it.
const ganttLayoutSchema = objectSchema({
  timeScale: { type: "string", enum: ["day", "week", "month", "quarter"] },
  pxPerDay: { type: "number", minimum: 1, maximum: 24 },
  gridWidth: { type: "number", nullable: true },
  showBaseline: { type: "boolean" },
  showHistogram: { type: "boolean" },
  histogramGroup: { type: "string", enum: ["type", "resource"] },
  collapsed: { type: "array", items: { type: "string" } },
});

add(
  "/projects/{projectId}/schedule/layouts",
  "get",
  operation({
    tag: "Schedule",
    summary: "List saved Gantt layouts visible to the caller.",
    operationId: "listGanttLayouts",
    parameters: projectParams,
    permissions: modulePermission("schedule", "read"),
  }),
);

add(
  "/projects/{projectId}/schedule/layouts",
  "post",
  operation({
    tag: "Schedule",
    summary: "Save a Gantt layout under a name.",
    operationId: "saveGanttLayout",
    parameters: projectParams,
    permissions: modulePermission("schedule", "read"),
    requestBody: jsonBody(
      objectSchema({
        name: { type: "string", minLength: 1, maxLength: 60 },
        visibility: { type: "string", enum: ["private", "project"] },
        layout: ganttLayoutSchema,
      }),
      "Layout name, who can see it, and the arrangement itself.",
    ),
  }),
);

add(
  "/projects/{projectId}/schedule/layouts/{layoutId}",
  "patch",
  operation({
    tag: "Schedule",
    summary: "Rename a Gantt layout, reshare it, or replace its arrangement.",
    operationId: "updateGanttLayout",
    parameters: [
      ...projectParams,
      pathParam("layoutId", "Saved layout id.", null),
    ],
    permissions: modulePermission("schedule", "read"),
    requestBody: jsonBody(
      objectSchema({
        name: { type: "string", minLength: 1, maxLength: 60 },
        visibility: { type: "string", enum: ["private", "project"] },
        layout: ganttLayoutSchema,
      }),
      "Any subset of the layout's fields.",
      false,
    ),
  }),
);

add(
  "/projects/{projectId}/schedule/layouts/{layoutId}",
  "delete",
  operation({
    tag: "Schedule",
    summary: "Delete a saved Gantt layout.",
    operationId: "deleteGanttLayout",
    parameters: [
      ...projectParams,
      pathParam("layoutId", "Saved layout id.", null),
    ],
    permissions: modulePermission("schedule", "read"),
  }),
);

add(
  "/projects/{projectId}/schedule/baseline",
  "post",
  operation({
    tag: "Schedule",
    summary: "Lock the approved current schedule as baseline.",
    operationId: "baselineCurrentSchedule",
    parameters: projectParams,
    permissions: modulePermission("schedule", "baseline", "revision.baseline"),
    requestBody: jsonBody(
      objectSchema({
        revisionId: nullableUuid,
        comment: { type: "string", nullable: true, maxLength: 2000 },
      }),
      "Optional revision id and comment.",
      false,
    ),
  }),
);

add(
  "/projects/{projectId}/schedule/revisions",
  "get",
  operation({
    tag: "Schedule Revisions",
    summary: "List staged schedule revisions.",
    operationId: "listScheduleRevisions",
    parameters: projectParams,
    permissions: modulePermission("schedule", "read"),
  }),
);

[
  [
    "readiness",
    "getScheduleRevisionReadiness",
    "Get schedule revision readiness.",
  ],
  [
    "mapping",
    "getScheduleRevisionMapping",
    "Get staged-to-active activity mapping suggestions.",
  ],
].forEach(([suffix, operationId, summary]) => {
  add(
    `/projects/{projectId}/schedule/revisions/{revisionId}/${suffix}`,
    "get",
    operation({
      tag: "Schedule Revisions",
      summary,
      operationId,
      parameters: [
        ...projectParams,
        pathParam("revisionId", "Schedule revision UUID."),
      ],
      permissions: modulePermission("schedule", "read"),
    }),
  );
});

add(
  "/projects/{projectId}/schedule/revisions/{revisionId}",
  "get",
  operation({
    tag: "Schedule Revisions",
    summary: "Get a schedule revision.",
    operationId: "getScheduleRevision",
    parameters: [
      ...projectParams,
      pathParam("revisionId", "Schedule revision UUID."),
    ],
    permissions: modulePermission("schedule", "read"),
  }),
);

[
  [
    "submit-review",
    "submitScheduleRevisionReview",
    "Submit a schedule revision for review.",
    "submit",
    "revision.submit_review",
    ref("CommentRequest"),
  ],
  [
    "approve",
    "approveScheduleRevision",
    "Approve a schedule revision.",
    "approve",
    "revision.approve",
    ref("CommentRequest"),
  ],
  [
    "reject",
    "rejectScheduleRevision",
    "Reject a schedule revision.",
    "approve",
    "revision.reject",
    ref("RejectRequest"),
  ],
  [
    "baseline",
    "baselineScheduleRevision",
    "Baseline an approved schedule revision.",
    "baseline",
    "revision.baseline",
    ref("CommentRequest"),
  ],
  [
    "rollback",
    "rollbackScheduleRevision",
    "Rollback an active schedule revision.",
    "approve",
    "revision.rollback",
    ref("RejectRequest"),
  ],
].forEach(([suffix, operationId, summary, action, transition, bodySchema]) => {
  add(
    `/projects/{projectId}/schedule/revisions/{revisionId}/${suffix}`,
    "post",
    operation({
      tag: "Schedule Revisions",
      summary,
      operationId,
      parameters: [
        ...projectParams,
        pathParam("revisionId", "Schedule revision UUID."),
      ],
      permissions: modulePermission("schedule", action, transition),
      requestBody: jsonBody(bodySchema, "Workflow transition payload.", false),
    }),
  );
});

add(
  "/projects/{projectId}/schedule/revisions/{revisionId}/activate",
  "post",
  operation({
    tag: "Schedule Revisions",
    summary: "Activate an approved staged schedule revision.",
    operationId: "activateScheduleRevision",
    parameters: [
      ...projectParams,
      pathParam("revisionId", "Schedule revision UUID."),
    ],
    permissions: modulePermission("schedule", "approve", "revision.activate"),
    requestBody: jsonBody(
      ref("RevisionActivationRequest"),
      "Activity mapping and removal rationale.",
    ),
  }),
);

add(
  "/projects/{projectId}/activities",
  "get",
  operation({
    tag: "Activities",
    summary: "List project activities.",
    operationId: "listActivities",
    parameters: projectParams,
    permissions: modulePermission("schedule", "read"),
    responseSchema: arrayOf(ref("Activity")),
  }),
);

add(
  "/projects/{projectId}/activities",
  "post",
  operation({
    tag: "Activities",
    summary: "Create a schedule activity with structured dependencies.",
    operationId: "createActivity",
    parameters: projectParams,
    permissions: modulePermission("schedule", "create"),
    requestBody: jsonBody(
      ref("ActivityMutation"),
      "Activity payload. name and at least one engineerId are required.",
    ),
    responseSchema: ref("Activity"),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/activities/{id}",
  "get",
  operation({
    tag: "Activities",
    summary: "Get an activity by id.",
    operationId: "getActivity",
    parameters: projectRecordParams,
    permissions: modulePermission("schedule", "read"),
    responseSchema: ref("Activity"),
  }),
);

add(
  "/projects/{projectId}/activities/{id}",
  "patch",
  operation({
    tag: "Activities",
    summary: "Update an activity.",
    operationId: "updateActivity",
    parameters: projectRecordParams,
    permissions: modulePermission("schedule", "update"),
    requestBody: jsonBody(
      ref("ActivityMutation"),
      "Partial activity payload.",
      false,
    ),
    responseSchema: ref("Activity"),
  }),
);

add(
  "/projects/{projectId}/activities/{id}",
  "delete",
  operation({
    tag: "Activities",
    summary: "Delete an activity.",
    operationId: "deleteActivity",
    parameters: projectRecordParams,
    permissions: modulePermission("schedule", "delete"),
  }),
);

add(
  "/projects/{projectId}/activities/bulk-progress",
  "post",
  operation({
    tag: "Progress",
    summary: "Submit progress updates for multiple activities.",
    description:
      "Submits draft/submitted progress rows for several activities. Non-PM/planning users must be assigned to every activity in the batch; otherwise the API returns 403 ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED with the blocked activityIds. PM and Planning Engineer project roles may override assignment.",
    operationId: "submitBulkProgress",
    parameters: projectParams,
    permissions: modulePermission("progress", "submit", "submission.submit"),
    requestBody: jsonBody(
      ref("BulkProgressRequest"),
      "Bulk progress submission payload.",
    ),
  }),
);

add(
  "/projects/{projectId}/activities/progress-submissions",
  "get",
  operation({
    tag: "Progress",
    summary: "List project progress submissions.",
    operationId: "listProgressSubmissions",
    parameters: [
      ...projectParams,
      queryParam("status", "Filter by submission workflow status.", {
        type: "string",
        enum: ["draft", "submitted", "approved", "rejected"],
      }),
    ],
    permissions: modulePermission("progress", "read"),
  }),
);

add(
  "/projects/{projectId}/activities/{id}/progress",
  "post",
  operation({
    tag: "Progress",
    summary: "Submit progress for an activity. EV updates only after approval.",
    description:
      "Creates a progress submission for one activity. Site and field users must be assigned to the activity before submitting; PM and Planning Engineer project roles may override assignment. Unassigned users receive 403 ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED and EV remains unchanged until an authorized submission is approved.",
    operationId: "submitActivityProgress",
    parameters: projectRecordParams,
    permissions: modulePermission("progress", "submit", "submission.submit"),
    requestBody: jsonBody(
      ref("ProgressPayload"),
      "Progress submission payload.",
    ),
  }),
);

add(
  "/projects/{projectId}/activities/{id}/progress-method",
  "get",
  operation({
    tag: "Progress",
    summary: "Get progress method configuration for an activity.",
    operationId: "getActivityProgressMethod",
    parameters: projectRecordParams,
    permissions: modulePermission("progress", "read"),
  }),
);

add(
  "/projects/{projectId}/activities/{id}/progress-method",
  "put",
  operation({
    tag: "Progress",
    summary: "Configure progress method for an activity.",
    operationId: "configureActivityProgressMethod",
    parameters: projectRecordParams,
    permissions: modulePermission("progress", "update", "method.configure"),
    requestBody: jsonBody(
      ref("ProgressMethodRequest"),
      "Progress method configuration.",
    ),
  }),
);

add(
  "/projects/{projectId}/activities/{id}/progress-submissions",
  "get",
  operation({
    tag: "Progress",
    summary: "List progress submissions for one activity.",
    operationId: "listActivityProgressSubmissions",
    parameters: [
      ...projectRecordParams,
      queryParam("status", "Filter by submission workflow status.", {
        type: "string",
        enum: ["draft", "submitted", "approved", "rejected"],
      }),
    ],
    permissions: modulePermission("progress", "read"),
  }),
);

[
  [
    "approve",
    "approveProgressSubmission",
    "Approve an activity progress submission.",
    "submission.approve",
    undefined,
  ],
  [
    "reject",
    "rejectProgressSubmission",
    "Reject an activity progress submission.",
    "submission.reject",
    ref("RejectRequest"),
  ],
].forEach(([suffix, operationId, summary, transition, bodySchema]) => {
  add(
    `/projects/{projectId}/activities/{id}/progress-submissions/{submissionId}/${suffix}`,
    "post",
    operation({
      tag: "Progress",
      summary,
      operationId,
      parameters: [
        ...projectRecordParams,
        pathParam("submissionId", "Progress submission UUID."),
      ],
      permissions: modulePermission("progress", "approve", transition),
      requestBody: bodySchema
        ? jsonBody(bodySchema, "Review payload.")
        : undefined,
    }),
  );
});

[
  [
    "xer",
    "importXerSchedule",
    "Import a Primavera P6 XER file.",
    ".xer file, maximum 50 MB.",
  ],
  [
    "p6xml",
    "importP6XmlSchedule",
    "Import a Primavera P6 XML file.",
    ".xml file, maximum 50 MB.",
  ],
  [
    "msp",
    "importMspSchedule",
    "Import a Microsoft Project XML file.",
    ".xml file, maximum 50 MB.",
  ],
].forEach(([suffix, operationId, summary, accepted]) => {
  add(
    `/projects/{projectId}/import/${suffix}`,
    "post",
    operation({
      tag: "Imports",
      summary,
      operationId,
      parameters: projectParams,
      permissions: modulePermission("schedule", "create"),
      requestBody: fileUploadBody({
        description: summary,
        accepted,
        extraProperties: {
          replaceExisting: { type: "boolean", default: false },
        },
      }),
      responseSchema: ref("ImportResponse"),
      status: 201,
    }),
  );
});

add(
  "/projects/{projectId}/import/progress",
  "post",
  operation({
    tag: "Imports",
    summary: "Import activity progress from an uploaded file.",
    operationId: "importProgress",
    parameters: projectParams,
    permissions: modulePermission("progress", "submit", "submission.submit"),
    requestBody: fileUploadBody({
      description: "Progress import upload.",
      accepted: ".xer or .xml file, maximum 50 MB.",
      extraProperties: { format: { type: "string" } },
      required: ["file", "format"],
    }),
    responseSchema: ref("ImportResponse"),
  }),
);

add(
  "/projects/{projectId}/import/uploads/{documentId}",
  "get",
  operation({
    tag: "Imports",
    summary: "Download a stored schedule/progress import source file.",
    operationId: "downloadImportSource",
    parameters: [
      ...projectParams,
      pathParam("documentId", "ProjectDocument UUID for the import source."),
    ],
    permissions: modulePermission("schedule", "read"),
    responses: {
      200: binaryResponse(
        "Import source file stream when local storage is used.",
        "application/octet-stream",
      ),
      302: redirectResponse(
        "Redirects to a short-lived private S3 presigned URL when object storage is used.",
      ),
    },
  }),
);

[
  [
    "recalculate-cpm",
    "recalculateProjectCpm",
    "Recalculate project CPM from structured dependencies.",
  ],
  [
    "seed-linked-modules",
    "seedLinkedModules",
    "Seed linked module records from schedule data.",
  ],
].forEach(([suffix, operationId, summary]) => {
  add(
    `/projects/{projectId}/import/${suffix}`,
    "post",
    operation({
      tag: "Imports",
      summary,
      operationId,
      parameters: projectParams,
      permissions: modulePermission("schedule", "update"),
    }),
  );
});

add(
  "/projects/{projectId}/reports/periods",
  "get",
  operation({
    tag: "Reports",
    summary: "List earned value reporting periods.",
    operationId: "listReportingPeriods",
    parameters: projectParams,
    permissions: modulePermission("cost", "read"),
  }),
);

add(
  "/projects/{projectId}/reports/periods",
  "post",
  operation({
    tag: "Reports",
    summary: "Create an earned value reporting period.",
    operationId: "createReportingPeriod",
    parameters: projectParams,
    permissions: modulePermission("cost", "create"),
    requestBody: jsonBody(
      ref("ReportingPeriodRequest"),
      "Reporting period payload.",
    ),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/reports/periods/{periodId}/lock",
  "post",
  operation({
    tag: "Reports",
    summary: "Lock a reporting period EV snapshot.",
    operationId: "lockReportingPeriod",
    parameters: [
      ...projectParams,
      pathParam("periodId", "Reporting period UUID."),
    ],
    permissions: modulePermission("cost", "approve", "reporting_period.lock"),
    requestBody: jsonBody(
      ref("ReportingPeriodLockRequest"),
      "Optional PM override reason for unresolved official-reporting readiness blockers.",
      false,
    ),
  }),
);

add(
  "/projects/{projectId}/reports/cost-loading",
  "get",
  operation({
    tag: "Reports",
    summary: "List approved or draft activity cost-loading rows.",
    operationId: "listCostLoadings",
    parameters: [
      ...projectParams,
      queryParam("status", "Filter by cost-loading workflow status.", {
        type: "string",
        enum: ["draft", "submitted", "approved", "rejected", "superseded"],
      }),
    ],
    permissions: modulePermission("cost", "read"),
    responseSchema: arrayOf(ref("CostLoadingResponse")),
  }),
);

add(
  "/projects/{projectId}/reports/cost-loading",
  "post",
  operation({
    tag: "Reports",
    summary: "Create an activity cost-loading row.",
    operationId: "createCostLoading",
    parameters: projectParams,
    permissions: modulePermission("cost", "create"),
    requestBody: jsonBody(ref("CostLoadingRequest"), "Cost-loading payload."),
    responseSchema: ref("CostLoadingResponse"),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/reports/cost-loading/{id}",
  "patch",
  operation({
    tag: "Reports",
    summary: "Update an activity cost-loading row.",
    operationId: "updateCostLoading",
    parameters: projectRecordParams,
    permissions: modulePermission("cost", "update"),
    requestBody: jsonBody(
      ref("CostLoadingRequest"),
      "Partial cost-loading payload.",
      false,
    ),
    responseSchema: ref("CostLoadingResponse"),
  }),
);

add(
  "/projects/{projectId}/reports/cost-loading/{id}/submit",
  "post",
  operation({
    tag: "Reports",
    summary: "Submit an activity cost-loading row for approval.",
    operationId: "submitCostLoading",
    parameters: projectRecordParams,
    permissions: modulePermission("cost", "submit"),
    responseSchema: ref("CostLoadingResponse"),
  }),
);

add(
  "/projects/{projectId}/reports/cost-loading/{id}/approve",
  "post",
  operation({
    tag: "Reports",
    summary: "Approve an activity cost-loading row.",
    operationId: "approveCostLoading",
    parameters: projectRecordParams,
    permissions: modulePermission("cost", "approve"),
    responseSchema: ref("CostLoadingResponse"),
  }),
);

add(
  "/projects/{projectId}/reports/cost-loading/{id}/reject",
  "post",
  operation({
    tag: "Reports",
    summary: "Reject a submitted activity cost-loading row with a reason.",
    operationId: "rejectCostLoading",
    parameters: projectRecordParams,
    permissions: modulePermission("cost", "approve"),
    requestBody: jsonBody(ref("RejectRequest"), "Rejection reason."),
    responseSchema: ref("CostLoadingResponse"),
  }),
);

add(
  "/projects/{projectId}/reports/ev",
  "get",
  operation({
    tag: "Reports",
    summary:
      "Build official earned value report for a reporting period or cutoff date.",
    operationId: "getEarnedValueReport",
    parameters: [
      ...projectParams,
      queryParam("periodId", "Optional reporting period UUID.", uuid),
      queryParam("cutoffDate", "Optional ISO cutoff date.", dateString),
    ],
    permissions: modulePermission("cost", "read"),
  }),
);

add(
  "/projects/{projectId}/change-orders",
  "get",
  operation({
    tag: "Commercial",
    summary:
      "List change orders with activity, BOQ allocation, correspondence, and attachment traceability.",
    operationId: "listChangeOrders",
    parameters: [
      ...projectParams,
      queryParam("status", "Filter by change order status.", {
        type: "string",
        enum: ["draft", "pending", "approved", "rejected", "archived"],
      }),
      includeArchivedParam,
    ],
    permissions: modulePermission("change_order", "read"),
  }),
);

add(
  "/projects/{projectId}/change-orders",
  "post",
  operation({
    tag: "Commercial",
    summary: "Create a change order.",
    operationId: "createChangeOrder",
    parameters: projectParams,
    permissions: rolesPermission("pm", "qs"),
    requestBody: jsonBody(ref("ChangeOrderRequest"), "Change order payload."),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/change-orders/{id}",
  "patch",
  operation({
    tag: "Commercial",
    summary: "Update a change order.",
    operationId: "updateChangeOrder",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm", "qs"),
    requestBody: jsonBody(
      ref("ChangeOrderRequest"),
      "Partial change order payload.",
      false,
    ),
  }),
);

add(
  "/projects/{projectId}/change-orders/{id}/submit",
  "post",
  operation({
    tag: "Commercial",
    summary:
      "Submit a draft change order for PM approval after impact proof is complete.",
    operationId: "submitChangeOrder",
    parameters: projectRecordParams,
    permissions: modulePermission(
      "change_order",
      "submit",
      "change_order.submit",
    ),
    requestBody: jsonBody(
      ref("ApprovalDecisionRequest"),
      "Optional submission comment.",
      false,
    ),
  }),
);

add(
  "/projects/{projectId}/change-orders/{id}/approve",
  "post",
  operation({
    tag: "Commercial",
    summary: "Approve a change order through the canonical PM workflow.",
    operationId: "approveChangeOrder",
    parameters: projectRecordParams,
    permissions: modulePermission(
      "change_order",
      "approve",
      "change_order.approve",
    ),
    requestBody: jsonBody(
      ref("ApprovalDecisionRequest"),
      "Optional approval comment.",
      false,
    ),
  }),
);

add(
  "/projects/{projectId}/change-orders/{id}/reject",
  "post",
  operation({
    tag: "Commercial",
    summary: "Reject a change order through the canonical PM workflow.",
    operationId: "rejectChangeOrder",
    parameters: projectRecordParams,
    permissions: modulePermission(
      "change_order",
      "approve",
      "change_order.reject",
    ),
    requestBody: jsonBody(
      ref("RejectionDecisionRequest"),
      "Required rejection reason.",
    ),
  }),
);

add(
  "/projects/{projectId}/change-orders/{id}/disapprove",
  "post",
  operation({
    tag: "Commercial",
    summary: "Disapprove a change order through the canonical PM workflow.",
    operationId: "disapproveChangeOrder",
    parameters: projectRecordParams,
    permissions: modulePermission(
      "change_order",
      "approve",
      "change_order.reject",
    ),
    requestBody: jsonBody(
      ref("RejectionDecisionRequest"),
      "Required disapproval reason.",
    ),
  }),
);

add(
  "/projects/{projectId}/change-orders/{id}/reopen",
  "post",
  operation({
    tag: "Commercial",
    summary: "Reopen a rejected change order to draft for rework.",
    operationId: "reopenChangeOrder",
    parameters: projectRecordParams,
    permissions: modulePermission(
      "change_order",
      "submit",
      "change_order.reopen",
    ),
    requestBody: jsonBody(
      ref("ApprovalDecisionRequest"),
      "Optional reopen comment.",
      false,
    ),
  }),
);

add(
  "/projects/{projectId}/change-orders/{id}",
  "delete",
  operation({
    tag: "Commercial",
    summary: "Archive a non-approved change order while retaining history.",
    operationId: "deleteChangeOrder",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm"),
    responseSchema: ref("ArchiveResponse"),
  }),
);

// ─── the client contract (OCTA-COM-PRIME-051) ──────────────────────────────

add(
  "/projects/{projectId}/prime-contract",
  "get",
  operation({
    tag: "Commercial",
    summary:
      "The client contract: original value, approved and pending change orders, revised value, and the terms that turn certified work into money.",
    description:
      "Created on first read from the project's own contract metadata and BOQ total, so nothing has to be re-keyed.",
    operationId: "getPrimeContract",
    parameters: projectParams,
    permissions: modulePermission("ipc", "read"),
  }),
);

add(
  "/projects/{projectId}/prime-contract",
  "patch",
  operation({
    tag: "Commercial",
    summary: "Update the client contract's value and terms.",
    operationId: "updatePrimeContract",
    parameters: projectParams,
    permissions: modulePermission("ipc", "update", "contract.manage"),
    requestBody: jsonBody(
      objectSchema({
        title: { type: "string" },
        contractType: {
          type: "string",
          enum: ["lump_sum", "remeasured", "cost_plus", "gmp"],
        },
        status: { type: "string", enum: ["draft", "active", "closed"] },
        currency: { type: "string" },
        clientCompanyId: { type: "string", format: "uuid", nullable: true },
        originalValue: { type: "number", minimum: 0 },
        retentionRate: { type: "number", minimum: 0, maximum: 100 },
        retentionCapRate: { type: "number", minimum: 0, maximum: 100, nullable: true },
        advanceRate: { type: "number", minimum: 0, maximum: 100 },
        advanceAmount: { type: "number", minimum: 0 },
        advanceRecoveryRate: { type: "number", minimum: 0, maximum: 100 },
        materialsOnSiteRate: { type: "number", minimum: 0, maximum: 100 },
        taxRate: { type: "number", minimum: 0, maximum: 100 },
        paymentTermsDays: { type: "integer", minimum: 0, maximum: 365 },
        startDate: { type: "string", format: "date-time", nullable: true },
        completionDate: { type: "string", format: "date-time", nullable: true },
        notes: { type: "string", nullable: true },
      }),
      "Contract fields to change. The advance amount follows the advance rate unless it is given explicitly.",
      false,
    ),
  }),
);

add(
  "/projects/{projectId}/prime-contract/statement",
  "get",
  operation({
    tag: "Commercial",
    summary:
      "The client billing statement: contract, approved changes, previously certified, this period, retention, advance recovery, deductions, tax, total due — and the same story per BOQ line.",
    operationId: "getClientBillingStatement",
    parameters: [
      ...projectParams,
      queryParam("period", "Report this period rather than the latest open one.", {
        type: "string",
      }),
    ],
    permissions: modulePermission("ipc", "read"),
  }),
);

add(
  "/projects/{projectId}/prime-contract/receivables",
  "get",
  operation({
    tag: "Commercial",
    summary: "What the client owes, aged by invoice due date.",
    description:
      "An invoice with no due date is aged from the contract's payment terms rather than left out.",
    operationId: "getClientReceivables",
    parameters: projectParams,
    permissions: modulePermission("ipc", "read"),
  }),
);

add(
  "/projects/{projectId}/prime-contract/advances",
  "get",
  operation({
    tag: "Commercial",
    summary: "The advance-payment ledger and what is still outstanding.",
    operationId: "listContractAdvances",
    parameters: projectParams,
    permissions: modulePermission("ipc", "read"),
  }),
);

add(
  "/projects/{projectId}/prime-contract/advances",
  "post",
  operation({
    tag: "Commercial",
    summary: "Record an advance payment received from the client.",
    operationId: "recordContractAdvance",
    parameters: projectParams,
    permissions: modulePermission("ipc", "create", "advance.record"),
    requestBody: jsonBody(
      objectSchema({
        amount: { type: "number", minimum: 0 },
        reference: { type: "string", nullable: true },
        occurredAt: { type: "string", format: "date-time", nullable: true },
        note: { type: "string", nullable: true },
      }),
      "The advance received. Refused if it takes the total past the agreed advance.",
    ),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/ipc",
  "get",
  operation({
    tag: "Commercial",
    summary: "List IPC certificates.",
    operationId: "listIpcCertificates",
    parameters: projectParams,
    permissions: modulePermission("ipc", "read"),
  }),
);

add(
  "/projects/{projectId}/ipc",
  "post",
  operation({
    tag: "Commercial",
    summary: "Create an IPC period.",
    operationId: "createIpcPeriod",
    parameters: projectParams,
    permissions: modulePermission("ipc", "create", "period.create"),
    requestBody: jsonBody(
      ref("IpcCreateRequest"),
      "Optional IPC period label.",
      false,
    ),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/ipc/{period}",
  "get",
  operation({
    tag: "Commercial",
    summary: "Get an IPC period with certification items.",
    operationId: "getIpcPeriod",
    parameters: [
      ...projectParams,
      pathParam("period", "IPC period label.", null),
    ],
    permissions: modulePermission("ipc", "read"),
  }),
);

add(
  "/projects/{projectId}/ipc/{period}/items/{id}",
  "patch",
  operation({
    tag: "Commercial",
    summary: "Update an IPC item.",
    operationId: "updateIpcItem",
    parameters: [
      ...projectParams,
      pathParam("period", "IPC period label.", null),
      idParam,
    ],
    permissions: modulePermission("ipc", "update", "item.update"),
    requestBody: jsonBody(
      ref("IpcItemPatchRequest"),
      "Partial IPC item payload.",
      false,
    ),
  }),
);

add(
  "/projects/{projectId}/ipc/{period}/adjustments",
  "patch",
  operation({
    tag: "Commercial",
    summary: "Set stored materials and deductions on a certificate.",
    description:
      "Neither is measured work, so neither sits on a BOQ line — but both move what the client owes, and a deduction must say what it is for.",
    operationId: "updateIpcAdjustments",
    parameters: [
      ...projectParams,
      pathParam("period", "IPC period label.", null),
    ],
    permissions: modulePermission("ipc", "update", "item.update"),
    requestBody: jsonBody(
      objectSchema({
        materialsOnSite: { type: "number", minimum: 0 },
        materialsAtCost: {
          type: "number",
          minimum: 0,
          description:
            "Delivered value, used to check the contract's stored-material percentage.",
        },
        deductions: { type: "number", minimum: 0 },
        deductionsNote: { type: "string", nullable: true },
      }),
      "The adjustments to apply. Certified periods are refused.",
      false,
    ),
  }),
);

[
  [
    "submit",
    "submitIpcPeriod",
    "Submit an IPC period for certification.",
    "submit",
    "period.submit",
    undefined,
  ],
  [
    "certify",
    "certifyIpcPeriod",
    "Certify an IPC period.",
    "certify",
    "period.certify",
    ref("IpcCertifyRequest"),
  ],
].forEach(([suffix, operationId, summary, action, transition, bodySchema]) => {
  add(
    `/projects/{projectId}/ipc/{period}/${suffix}`,
    "post",
    operation({
      tag: "Commercial",
      summary,
      operationId,
      parameters: [
        ...projectParams,
        pathParam("period", "IPC period label.", null),
      ],
      permissions: modulePermission("ipc", action, transition),
      requestBody: bodySchema
        ? jsonBody(bodySchema, "Workflow payload.", false)
        : undefined,
    }),
  );
});

add(
  "/projects/{projectId}/ipc/{period}/invoice/issue",
  "post",
  operation({
    tag: "Commercial",
    summary: "Issue a receivable invoice for a certified IPC period.",
    operationId: "issueIpcInvoice",
    parameters: [
      ...projectParams,
      pathParam("period", "IPC period label.", null),
    ],
    permissions: modulePermission("ipc", "approve", "invoice.issue"),
    requestBody: jsonBody(
      ref("IpcInvoiceIssueRequest"),
      "Invoice number and optional invoice/due dates.",
      false,
    ),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/ipc/{period}/payments",
  "post",
  operation({
    tag: "Commercial",
    summary: "Record a client payment against an issued IPC invoice.",
    operationId: "recordIpcPayment",
    parameters: [
      ...projectParams,
      pathParam("period", "IPC period label.", null),
    ],
    permissions: modulePermission("ipc", "approve", "payment.record"),
    requestBody: jsonBody(ref("IpcPaymentRequest"), "Payment receipt payload."),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/ipc/{period}/retention-release",
  "post",
  operation({
    tag: "Commercial",
    summary: "Release held retention for an issued IPC invoice.",
    operationId: "releaseIpcRetention",
    parameters: [
      ...projectParams,
      pathParam("period", "IPC period label.", null),
    ],
    permissions: modulePermission("ipc", "approve", "retention.release"),
    requestBody: jsonBody(
      ref("IpcRetentionReleaseRequest"),
      "Retention release payload.",
    ),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/sub-valuations",
  "get",
  operation({
    tag: "Commercial",
    summary: "List subcontractor valuations.",
    operationId: "listSubValuations",
    parameters: projectParams,
  }),
);

add(
  "/projects/{projectId}/sub-valuations",
  "post",
  operation({
    tag: "Commercial",
    summary: "Create a subcontractor valuation.",
    operationId: "createSubValuation",
    parameters: projectParams,
    requestBody: jsonBody(ref("SubValuationRequest"), "Sub valuation payload."),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/sub-valuations/{id}",
  "patch",
  operation({
    tag: "Commercial",
    summary: "Update a subcontractor valuation.",
    operationId: "updateSubValuation",
    parameters: projectRecordParams,
    requestBody: jsonBody(
      ref("SubValuationRequest"),
      "Partial sub valuation payload.",
      false,
    ),
  }),
);

add(
  "/projects/{projectId}/cash-flow",
  "get",
  operation({
    tag: "Commercial",
    summary: "List project cash-flow periods.",
    operationId: "listCashFlow",
    parameters: projectParams,
  }),
);

add(
  "/projects/{projectId}/cash-flow",
  "post",
  operation({
    tag: "Commercial",
    summary: "Create a manual cash-flow entry.",
    operationId: "createCashFlowEntry",
    parameters: projectParams,
    requestBody: jsonBody(
      ref("CashFlowEntryRequest"),
      "Cash-flow period payload.",
    ),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/cash-flow/rebuild",
  "post",
  operation({
    tag: "Commercial",
    summary: "Rebuild cash flow from current commercial data.",
    operationId: "rebuildCashFlow",
    parameters: projectParams,
  }),
);

add(
  "/projects/{projectId}/eot",
  "get",
  operation({
    tag: "Commercial",
    summary: "List EOT claims.",
    operationId: "listEotClaims",
    parameters: projectParams,
    permissions: modulePermission("eot", "read"),
  }),
);

add(
  "/projects/{projectId}/eot/calculate",
  "post",
  operation({
    tag: "Commercial",
    summary: "Calculate EOT and LD impact without creating a claim.",
    operationId: "calculateEot",
    parameters: projectParams,
    permissions: rolesPermission("pm", "planning_eng", "qs"),
    requestBody: jsonBody(ref("EotClaimRequest"), "EOT calculation payload."),
  }),
);

add(
  "/projects/{projectId}/eot",
  "post",
  operation({
    tag: "Commercial",
    summary: "Create an EOT claim.",
    operationId: "createEotClaim",
    parameters: projectParams,
    permissions: rolesPermission("pm", "planning_eng", "qs"),
    requestBody: jsonBody(ref("EotClaimRequest"), "EOT claim payload."),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/eot/{id}",
  "patch",
  operation({
    tag: "Commercial",
    summary: "Update an EOT claim.",
    operationId: "updateEotClaim",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm", "planning_eng", "qs"),
    requestBody: jsonBody(
      ref("EotClaimRequest"),
      "Partial EOT claim payload.",
      false,
    ),
  }),
);

add(
  "/projects/{projectId}/eot/{id}/submit",
  "post",
  operation({
    tag: "Commercial",
    summary: "Submit an EOT claim for PM approval.",
    operationId: "submitEotClaim",
    parameters: [...projectParams, idParam],
    permissions: modulePermission("eot", "submit", "eot.submit"),
    requestBody: jsonBody(ref("CommentRequest"), "Submission comment.", false),
  }),
);

add(
  "/projects/{projectId}/eot/{id}/approve",
  "post",
  operation({
    tag: "Commercial",
    summary: "Approve an EOT claim through the canonical PM workflow.",
    operationId: "approveEotClaim",
    parameters: projectRecordParams,
    permissions: modulePermission("eot", "approve", "eot.approve"),
    requestBody: jsonBody(
      ref("ApprovalDecisionRequest"),
      "Optional approval comment.",
      false,
    ),
  }),
);

add(
  "/projects/{projectId}/eot/{id}/reject",
  "post",
  operation({
    tag: "Commercial",
    summary: "Reject an EOT claim through the canonical PM workflow.",
    operationId: "rejectEotClaim",
    parameters: projectRecordParams,
    permissions: modulePermission("eot", "approve", "eot.reject"),
    requestBody: jsonBody(
      ref("RejectionDecisionRequest"),
      "Required rejection reason.",
    ),
  }),
);

add(
  "/projects/{projectId}/eot/{id}/disapprove",
  "post",
  operation({
    tag: "Commercial",
    summary: "Disapprove an EOT claim through the canonical PM workflow.",
    operationId: "disapproveEotClaim",
    parameters: projectRecordParams,
    permissions: modulePermission("eot", "approve", "eot.reject"),
    requestBody: jsonBody(
      ref("RejectionDecisionRequest"),
      "Required disapproval reason.",
    ),
  }),
);

add(
  "/projects/{projectId}/weather-delays",
  "get",
  operation({
    tag: "Commercial",
    summary: "List weather delays and contractual allowance consumption.",
    operationId: "listWeatherDelays",
    parameters: projectParams,
  }),
);

add(
  "/projects/{projectId}/weather-delays",
  "post",
  operation({
    tag: "Commercial",
    summary: "Create a weather delay record.",
    operationId: "createWeatherDelay",
    parameters: projectParams,
    requestBody: jsonBody(ref("WeatherDelayRequest"), "Weather delay payload."),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/long-lead",
  "get",
  operation({
    tag: "Procurement",
    summary:
      "List long-lead items with schedule-driven need dates and risk alerts.",
    operationId: "listLongLeadItems",
    parameters: projectParams,
  }),
);

add(
  "/projects/{projectId}/long-lead",
  "post",
  operation({
    tag: "Procurement",
    summary: "Create a long-lead procurement item.",
    operationId: "createLongLeadItem",
    parameters: projectParams,
    permissions: rolesPermission("pm", "planning_eng", "procurement"),
    requestBody: jsonBody(ref("LongLeadRequest"), "Long-lead item payload."),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/long-lead/{id}",
  "patch",
  operation({
    tag: "Procurement",
    summary: "Update a long-lead procurement item or warehouse receipt state.",
    operationId: "updateLongLeadItem",
    parameters: projectRecordParams,
    permissions: rolesPermission(
      "pm",
      "planning_eng",
      "procurement",
      "warehouse",
    ),
    requestBody: jsonBody(
      ref("LongLeadRequest"),
      "Partial long-lead payload.",
      false,
    ),
  }),
);

add(
  "/projects/{projectId}/long-lead/{id}",
  "delete",
  operation({
    tag: "Procurement",
    summary: "Delete a long-lead procurement item.",
    operationId: "deleteLongLeadItem",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm", "planning_eng"),
  }),
);

add(
  "/projects/{projectId}/procurement",
  "get",
  operation({
    tag: "Procurement",
    summary:
      "Get procurement overview with suppliers, packages, purchase orders, and open lead-time alerts.",
    operationId: "getProcurementOverview",
    parameters: projectParams,
    permissions: modulePermission("procurement", "read"),
  }),
);

add(
  "/projects/{projectId}/procurement/suppliers",
  "get",
  operation({
    tag: "Procurement",
    summary: "List project suppliers.",
    operationId: "listProcurementSuppliers",
    parameters: projectParams,
    permissions: modulePermission("procurement", "read"),
  }),
);

add(
  "/projects/{projectId}/procurement/suppliers",
  "post",
  operation({
    tag: "Procurement",
    summary: "Create or reuse a project supplier.",
    operationId: "createProcurementSupplier",
    parameters: projectParams,
    permissions: modulePermission("procurement", "create", "supplier.manage"),
    requestBody: jsonBody(
      ref("ProcurementSupplierRequest"),
      "Supplier payload.",
    ),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/procurement/packages",
  "get",
  operation({
    tag: "Procurement",
    summary: "List procurement packages.",
    operationId: "listProcurementPackages",
    parameters: projectParams,
    permissions: modulePermission("procurement", "read"),
  }),
);

add(
  "/projects/{projectId}/procurement/packages",
  "post",
  operation({
    tag: "Procurement",
    summary: "Create a procurement package.",
    operationId: "createProcurementPackage",
    parameters: projectParams,
    permissions: modulePermission("procurement", "create", "package.manage"),
    requestBody: jsonBody(
      ref("ProcurementPackageRequest"),
      "Procurement package payload.",
    ),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/procurement/purchase-orders",
  "get",
  operation({
    tag: "Procurement",
    summary: "List purchase orders with activity-linked PO lines.",
    operationId: "listProcurementPurchaseOrders",
    parameters: projectParams,
    permissions: modulePermission("procurement", "read"),
  }),
);

// ─── the purchase order lifecycle (OCTA-COM-PO-053) ────────────────────────

const poStatuses = [
  "planned",
  "draft",
  "pending_approval",
  "approved",
  "issued",
  "acknowledged",
  "closed",
  "cancelled",
];
const poOrderIdParam = pathParam("orderId", "Purchase order UUID.");

add(
  "/projects/{projectId}/purchase-orders",
  "get",
  operation({
    tag: "Procurement",
    summary:
      "Purchase orders with their three states — commercial status, delivery, and billing — plus a derived lifecycleStatus of draft / pending_approval / approved / issued / acknowledged / partially_delivered / delivered / partially_invoiced / fully_invoiced / closed / cancelled.",
    description:
      "An order that is fully delivered and half invoiced cannot pick one word, so the three facts are stored separately and the single name is computed from them.",
    operationId: "listPurchaseOrders",
    parameters: [
      ...projectParams,
      queryParam("status", "Filter by commercial status.", {
        type: "string",
        enum: poStatuses,
      }),
      queryParam("supplierId", "Filter by supplier.", uuid),
    ],
    permissions: modulePermission("procurement", "read"),
  }),
);

add(
  "/projects/{projectId}/purchase-orders/{orderId}",
  "get",
  operation({
    tag: "Procurement",
    summary: "One purchase order with its lines, delivery receipts and supplier invoices.",
    operationId: "getPurchaseOrder",
    parameters: [...projectParams, poOrderIdParam],
    permissions: modulePermission("procurement", "read"),
  }),
);

add(
  "/projects/{projectId}/purchase-orders/{orderId}",
  "patch",
  operation({
    tag: "Procurement",
    summary:
      "Edit the order header while it is planned, draft or pending approval. The value is never sent: it is recomputed from the lines and the tax rate.",
    operationId: "updatePurchaseOrder",
    parameters: [...projectParams, poOrderIdParam],
    permissions: modulePermission("procurement", "update", "po.issue"),
    requestBody: jsonBody(
      objectSchema({
        item: { type: "string" },
        supplierId: nullableUuid,
        supplier: { type: "string", nullable: true },
        buyer: { type: "string", nullable: true },
        deliveryLocationId: nullableUuid,
        deliveryAddress: { type: "string", nullable: true },
        deliveryTerms: { type: "string", nullable: true },
        paymentTerms: { type: "string", nullable: true },
        taxRate: { type: "number", minimum: 0, maximum: 100 },
        requiredBy: nullableDateString,
        promisedDate: nullableDateString,
        notes: { type: "string", nullable: true },
      }),
      "Header fields to change.",
      false,
    ),
  }),
);

[
  [
    "submit",
    "submitPurchaseOrder",
    "Send the order for approval. Refused without lines, a supplier, and a required-on-site date.",
    "submit",
    "po.submit",
  ],
  ["approve", "approvePurchaseOrder", "Approve the order.", "approve", "po.approve"],
  [
    "reject",
    "rejectPurchaseOrder",
    "Send the order back to draft with a reason saying what needs to change.",
    "approve",
    "po.approve",
  ],
  ["issue", "issuePurchaseOrder", "Issue the approved order to the supplier.", "update", "po.issue"],
  [
    "acknowledge",
    "acknowledgePurchaseOrder",
    "Record the supplier confirming the order, optionally under their own reference.",
    "update",
    "po.acknowledge",
  ],
  [
    "cancel",
    "cancelPurchaseOrder",
    "Cancel the order with a reason. Refused once any of it has been delivered — close it instead.",
    "delete",
    "po.cancel",
  ],
  [
    "close",
    "closePurchaseOrder",
    "Close the order. Refused while deliveries are outstanding unless force is set and a reason is given.",
    "update",
    "po.close",
  ],
].forEach(([suffix, operationId, summary, action, transition]) => {
  add(
    `/projects/{projectId}/purchase-orders/{orderId}/${suffix}`,
    "post",
    operation({
      tag: "Procurement",
      summary,
      operationId,
      parameters: [...projectParams, poOrderIdParam],
      permissions: modulePermission("procurement", action, transition),
      requestBody: jsonBody(
        objectSchema({
          reason: { type: "string", nullable: true },
          ...(suffix === "acknowledge"
            ? { acknowledgedRef: { type: "string", nullable: true } }
            : {}),
          ...(suffix === "close" ? { force: { type: "boolean" } } : {}),
        }),
        "Transition payload.",
        false,
      ),
    }),
  );
});

add(
  "/projects/{projectId}/procurement/purchase-orders",
  "post",
  operation({
    tag: "Procurement",
    summary: "Issue a purchase order with activity-linked PO lines.",
    operationId: "createProcurementPurchaseOrder",
    parameters: projectParams,
    permissions: modulePermission("procurement", "create", "po.issue"),
    requestBody: jsonBody(
      ref("ProcurementPurchaseOrderRequest"),
      "Purchase order payload.",
    ),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/procurement/purchase-orders/{orderId}/receipts",
  "post",
  operation({
    tag: "Procurement",
    summary:
      "Post a delivery receipt and optionally issue received quantities to activities.",
    operationId: "postProcurementDeliveryReceipt",
    parameters: [
      ...projectParams,
      pathParam("orderId", "Purchase order UUID."),
    ],
    permissions: modulePermission("procurement", "submit", "receipt.post"),
    requestBody: jsonBody(
      ref("DeliveryReceiptRequest"),
      "Delivery receipt payload.",
    ),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/procurement/lead-time-alerts",
  "get",
  operation({
    tag: "Procurement",
    summary:
      "List lead-time alerts generated from activity need dates and delivery commitments.",
    operationId: "listProcurementLeadTimeAlerts",
    parameters: [
      ...projectParams,
      queryParam("status", "Filter lead-time alerts by workflow status.", {
        type: "string",
        enum: ["open", "acknowledged", "resolved"],
      }),
    ],
    permissions: modulePermission("procurement", "read"),
  }),
);

add(
  "/projects/{projectId}/procurement/lead-time-alerts/{alertId}",
  "patch",
  operation({
    tag: "Procurement",
    summary: "Legacy acknowledgement update for a procurement lead-time alert.",
    operationId: "updateProcurementLeadTimeAlert",
    parameters: [
      ...projectParams,
      pathParam("alertId", "Procurement lead-time alert UUID."),
    ],
    permissions: modulePermission("procurement", "update", "alert.acknowledge"),
    requestBody: jsonBody(
      ref("ProcurementLeadTimeAlertUpdateRequest"),
      "Lead-time alert status payload.",
    ),
  }),
);

add(
  "/projects/{projectId}/procurement/lead-time-alerts/{alertId}/acknowledge",
  "patch",
  operation({
    tag: "Procurement",
    summary: "Acknowledge a procurement lead-time alert with audit history.",
    operationId: "acknowledgeProcurementLeadTimeAlert",
    parameters: [
      ...projectParams,
      pathParam("alertId", "Procurement lead-time alert UUID."),
    ],
    permissions: modulePermission("procurement", "update", "alert.acknowledge"),
    requestBody: jsonBody(
      ref("ProcurementLeadTimeAlertWorkflowRequest"),
      "Optional acknowledgement note.",
      false,
    ),
  }),
);

add(
  "/projects/{projectId}/procurement/lead-time-alerts/{alertId}/resolve",
  "patch",
  operation({
    tag: "Procurement",
    summary: "Resolve a procurement lead-time alert with audit history.",
    operationId: "resolveProcurementLeadTimeAlert",
    parameters: [
      ...projectParams,
      pathParam("alertId", "Procurement lead-time alert UUID."),
    ],
    permissions: modulePermission("procurement", "update", "alert.resolve"),
    requestBody: jsonBody(
      ref("ProcurementLeadTimeAlertWorkflowRequest"),
      "Optional resolution note.",
      false,
    ),
  }),
);

[
  ["daily-reports", "Daily Reports", "DailyReportRequest", "reportId"],
  ["site-diaries", "Site Diaries", "SiteDiaryRequest", "diaryId"],
].forEach(([base, tag, schemaName, idName]) => {
  add(
    `/projects/{projectId}/${base}`,
    "get",
    operation({
      tag,
      summary: `List ${tag.toLowerCase()}.`,
      operationId: `list${tag.replace(/\s/g, "")}`,
      parameters: [
        ...projectParams,
        queryParam("status", "Filter by workflow status.", { type: "string" }),
        queryParam("date", "Filter by exact ISO date.", dateString),
        queryParam("from", "Filter start date.", dateString),
        queryParam("to", "Filter end date.", dateString),
      ],
      permissions: modulePermission("progress", "read"),
    }),
  );

  add(
    `/projects/{projectId}/${base}`,
    "post",
    operation({
      tag,
      summary: `Create a ${tag.toLowerCase().slice(0, -1)}.`,
      operationId: `create${tag.replace(/\s/g, "").slice(0, -1)}`,
      parameters: projectParams,
      permissions: modulePermission(
        "progress",
        "submit",
        base === "daily-reports" ? "daily_report.submit" : "site_diary.submit",
      ),
      requestBody: jsonBody(ref(schemaName), `${tag} payload.`),
      status: 201,
    }),
  );

  add(
    `/projects/{projectId}/${base}/{${idName}}`,
    "get",
    operation({
      tag,
      summary: `Get one ${tag.toLowerCase().slice(0, -1)}.`,
      operationId: `get${tag.replace(/\s/g, "").slice(0, -1)}`,
      parameters: [
        ...projectParams,
        pathParam(idName, `${tag.slice(0, -1)} UUID.`),
      ],
      permissions: modulePermission("progress", "read"),
    }),
  );

  add(
    `/projects/{projectId}/${base}/{${idName}}`,
    "patch",
    operation({
      tag,
      summary: `Update one ${tag.toLowerCase().slice(0, -1)}.`,
      operationId: `update${tag.replace(/\s/g, "").slice(0, -1)}`,
      parameters: [
        ...projectParams,
        pathParam(idName, `${tag.slice(0, -1)} UUID.`),
      ],
      permissions: modulePermission(
        "progress",
        "update",
        base === "daily-reports" ? "daily_report.update" : "site_diary.update",
      ),
      requestBody: jsonBody(ref(schemaName), `Partial ${tag} payload.`, false),
    }),
  );

  [
    ["submit", "submit", "submit"],
    ["approve", "approve", "approve"],
    ["reject", "approve", "reject"],
  ].forEach(([suffix, action, transitionSuffix]) => {
    add(
      `/projects/{projectId}/${base}/{${idName}}/${suffix}`,
      "post",
      operation({
        tag,
        summary: `${suffix[0].toUpperCase()}${suffix.slice(1)} a ${tag.toLowerCase().slice(0, -1)}.`,
        operationId: `${suffix}${tag.replace(/\s/g, "").slice(0, -1)}`,
        parameters: [
          ...projectParams,
          pathParam(idName, `${tag.slice(0, -1)} UUID.`),
        ],
        permissions: modulePermission(
          "progress",
          action,
          `${base === "daily-reports" ? "daily_report" : "site_diary"}.${transitionSuffix}`,
        ),
        requestBody:
          suffix === "reject"
            ? jsonBody(ref("RejectRequest"), "Rejection payload.")
            : undefined,
      }),
    );
  });
});

add(
  "/projects/{projectId}/quality/dashboard",
  "get",
  operation({
    tag: "Quality",
    summary:
      "Get quality dashboard, NCR/ITP/defect/safety/material-test metrics, due alerts, and score.",
    operationId: "getQualityDashboard",
    parameters: projectParams,
  }),
);

const rfiListParams = [
  ...projectParams,
  ...cursorParams,
  queryParam("status", "Filter by RFI status.", {
    type: "string",
    enum: ["open", "answered", "closed", "archived"],
  }),
  includeArchivedParam,
  queryParam("priority", "Filter by RFI priority.", {
    type: "string",
    enum: ["low", "normal", "high", "urgent"],
  }),
  queryParam("activityId", "Filter RFIs linked to an activity.", uuid),
  queryParam("owner", "Filter by owner text.", { type: "string" }),
  queryParam("ownerPartyId", "Filter RFIs owned by a project party.", uuid),
  queryParam(
    "partyId",
    "Filter RFIs routed to a project party as owner, reviewer, or approver.",
    uuid,
  ),
  queryParam(
    "search",
    "Search ref, subject, question, response, discipline, or assignees.",
    {
      type: "string",
    },
  ),
  queryParam("dueAfter", "Filter RFIs due on or after this date.", dateString),
  queryParam(
    "dueBefore",
    "Filter RFIs due on or before this date.",
    dateString,
  ),
  queryParam("sortBy", "Sort field.", {
    type: "string",
    enum: [
      "created",
      "updated",
      "dueDate",
      "raisedDate",
      "responseRequiredBy",
      "answeredDate",
      "priority",
      "status",
      "ref",
    ],
    default: "created",
  }),
  queryParam("sortDir", "Sort direction.", {
    type: "string",
    enum: ["asc", "desc"],
    default: "desc",
  }),
];

const submittalListParams = [
  ...projectParams,
  ...cursorParams,
  queryParam("status", "Filter by submittal status.", {
    type: "string",
    enum: [
      "pending",
      "under_review",
      "approved",
      "resubmit",
      "rejected",
      "archived",
    ],
  }),
  includeArchivedParam,
  queryParam("activityId", "Filter submittals linked to an activity.", uuid),
  queryParam("owner", "Filter by owner text.", { type: "string" }),
  queryParam(
    "ownerPartyId",
    "Filter submittals owned by a project party.",
    uuid,
  ),
  queryParam(
    "partyId",
    "Filter submittals routed to a project party as owner, reviewer, or approver.",
    uuid,
  ),
  queryParam(
    "search",
    "Search ref, title, discipline, spec ref, remarks, or assignees.",
    {
      type: "string",
    },
  ),
  queryParam(
    "dueAfter",
    "Filter submittals due on or after this date.",
    dateString,
  ),
  queryParam(
    "dueBefore",
    "Filter submittals due on or before this date.",
    dateString,
  ),
  queryParam("packageId", "Filter submittals in a package.", uuid),
  queryParam("managerUserId", "Filter by submittal manager.", uuid),
  queryParam("workflowTemplateId", "Filter by review workflow.", uuid),
  queryParam("ballInCourtUserId", "User whose action is awaited; `me` for the caller.", { type: "string" }),
  queryParam("responseCode", "Filter by response code.", { type: "string", enum: ["approved", "approved_as_noted", "revise_resubmit", "rejected", "custom"] }),
  queryParam("overdue", "Only late items: under review past the step due date, or not yet submitted past submitBy.", { type: "boolean" }),
  queryParam("sortBy", "Sort field.", {
    type: "string",
    enum: [
      "created",
      "updated",
      "dueDate",
      "submittedOn",
      "reviewedOn",
      "status",
      "ref",
      "title",
    ],
    default: "created",
  }),
  queryParam("sortDir", "Sort direction.", {
    type: "string",
    enum: ["asc", "desc"],
    default: "desc",
  }),
];

const safetyListParams = [
  ...projectParams,
  queryParam("status", "Filter by safety incident status.", {
    type: "string",
    enum: ["open", "investigating", "submitted", "closed", "archived"],
  }),
  includeArchivedParam,
];

[
  ["ncr", "Quality", "NCR", "NcrRequest", "ncrId", "ncr", "Ncr"],
  [
    "safety",
    "Quality",
    "Safety incident",
    "SafetyIncidentRequest",
    "incidentId",
    "safety",
    "SafetyIncident",
  ],
  ["rfi", "Document Control", "RFI", "RfiRequest", "rfiId", "rfi", "Rfi"],
  [
    "submittals",
    "Document Control",
    "Submittal",
    "SubmittalRequest",
    "submittalId",
    "submittal",
    "Submittal",
  ],
].forEach(
  ([base, apiTag, label, schemaName, idName, moduleName, operationBase]) => {
    add(
      `/projects/{projectId}/${base}`,
      "get",
      operation({
        tag: apiTag,
        summary: `List ${label} records.`,
        operationId: `list${operationBase}Records`,
        parameters:
          base === "rfi"
            ? rfiListParams
            : base === "submittals"
              ? submittalListParams
              : base === "safety"
                ? safetyListParams
                : projectParams,
        permissions: modulePermission(moduleName, "read"),
        responseSchema:
          base === "rfi" || base === "submittals"
            ? ref("RowsCursorPage")
            : undefined,
      }),
    );
    add(
      `/projects/{projectId}/${base}`,
      "post",
      operation({
        tag: apiTag,
        summary: `Create a ${label} record.`,
        operationId: `create${operationBase}Record`,
        parameters: projectParams,
        permissions: modulePermission(moduleName, "create"),
        requestBody: jsonBody(ref(schemaName), `${label} payload.`),
        status: 201,
      }),
    );
    add(
      `/projects/{projectId}/${base}/{${idName}}`,
      "patch",
      operation({
        tag: apiTag,
        summary: `Update a ${label} record.`,
        operationId: `update${operationBase}Record`,
        parameters: [...projectParams, pathParam(idName, `${label} UUID.`)],
        permissions: modulePermission(moduleName, "update"),
        requestBody: jsonBody(
          ref(schemaName),
          `Partial ${label} payload.`,
          false,
        ),
      }),
    );
    add(
      `/projects/{projectId}/${base}/{${idName}}/approve`,
      "post",
      operation({
        tag: apiTag,
        summary: `Approve a ${label} record through the canonical PM workflow.`,
        operationId: `approve${operationBase}Record`,
        parameters: [...projectParams, pathParam(idName, `${label} UUID.`)],
        permissions: modulePermission(
          moduleName,
          "approve",
          `${moduleName}.approve`,
        ),
        requestBody: jsonBody(
          ref("ApprovalDecisionRequest"),
          "Optional approval comment.",
          false,
        ),
      }),
    );
    add(
      `/projects/{projectId}/${base}/{${idName}}/reject`,
      "post",
      operation({
        tag: apiTag,
        summary: `Reject a ${label} record through the canonical PM workflow.`,
        operationId: `reject${operationBase}Record`,
        parameters: [...projectParams, pathParam(idName, `${label} UUID.`)],
        permissions: modulePermission(
          moduleName,
          "approve",
          `${moduleName}.reject`,
        ),
        requestBody: jsonBody(
          ref("RejectionDecisionRequest"),
          "Required rejection reason.",
        ),
      }),
    );
    add(
      `/projects/{projectId}/${base}/{${idName}}/disapprove`,
      "post",
      operation({
        tag: apiTag,
        summary: `Disapprove a ${label} record through the canonical PM workflow.`,
        operationId: `disapprove${operationBase}Record`,
        parameters: [...projectParams, pathParam(idName, `${label} UUID.`)],
        permissions: modulePermission(
          moduleName,
          "approve",
          `${moduleName}.reject`,
        ),
        requestBody: jsonBody(
          ref("RejectionDecisionRequest"),
          "Required disapproval reason.",
        ),
      }),
    );
    add(
      `/projects/{projectId}/${base}/{${idName}}`,
      "delete",
      operation({
        tag: apiTag,
        summary: ["rfi", "submittals", "safety"].includes(base)
          ? `Archive a ${label} record while retaining audit history.`
          : `Delete a ${label} record.`,
        operationId: `delete${operationBase}Record`,
        parameters: [...projectParams, pathParam(idName, `${label} UUID.`)],
        permissions: modulePermission(moduleName, "delete"),
        responseSchema: ["rfi", "submittals", "safety"].includes(base)
          ? ref("ArchiveResponse")
          : undefined,
      }),
    );
  },
);

[
  ["ncr", "NCR", "ncrId", "ncr", "Ncr"],
  ["safety", "Safety incident", "incidentId", "safety", "SafetyIncident"],
].forEach(([base, label, idName, moduleName, operationBase]) => {
  [
    [
      "submit",
      "submit",
      `Submit a ${label} closeout for PM approval.`,
      "QaCloseoutRequest",
    ],
    [
      "close",
      "submit",
      `Submit a ${label} closeout package with required evidence.`,
      "QaCloseoutRequest",
    ],
    [
      "reopen",
      "approve",
      `Reopen a closed ${label} record with a required reason.`,
      "RejectionDecisionRequest",
    ],
  ].forEach(([suffix, action, summary, schemaName]) => {
    add(
      `/projects/{projectId}/${base}/{${idName}}/${suffix}`,
      "post",
      operation({
        tag: "Quality",
        summary,
        operationId: `${suffix}${operationBase}Record`,
        parameters: [...projectParams, pathParam(idName, `${label} UUID.`)],
        permissions: modulePermission(
          moduleName,
          action,
          `${moduleName}.${suffix}`,
        ),
        requestBody: jsonBody(
          ref(schemaName),
          suffix === "reopen"
            ? "Required reopen reason."
            : "Closeout payload with responsible party, due date, closure comment, and evidence.",
        ),
      }),
    );
  });
});

[
  [
    "submit",
    "submitRfiRecord",
    "Submit an RFI for response and record the submit event.",
    "submit",
    "rfi.submit",
    "RfiSubmitRequest",
  ],
  [
    "answer",
    "answerRfiRecord",
    "Answer an RFI with a required response, optional files, and activity links.",
    "submit",
    "rfi.answer",
    "RfiAnswerRequest",
  ],
  [
    "close",
    "closeRfiRecord",
    "Close an RFI with a required PM close comment.",
    "approve",
    "rfi.close",
    "RfiCloseRequest",
  ],
  [
    "reopen",
    "reopenRfiRecord",
    "Reopen a closed or answered RFI with a required reason.",
    "approve",
    "rfi.reopen",
    "RejectionDecisionRequest",
  ],
].forEach(([suffix, operationId, summary, action, transition, schemaName]) => {
  add(
    `/projects/{projectId}/rfi/{rfiId}/${suffix}`,
    "post",
    operation({
      tag: "Document Control",
      summary,
      operationId,
      parameters: [...projectParams, pathParam("rfiId", "RFI UUID.")],
      permissions: modulePermission("rfi", action, transition),
      requestBody: jsonBody(
        ref(schemaName),
        `${summary} payload.`,
        suffix === "submit" ? false : true,
      ),
    }),
  );
});

[
  [
    "submit",
    "submitSubmittalRecord",
    "Submit a submittal revision for consultant/PM review.",
    "submittal.submit",
  ],
  [
    "review",
    "reviewSubmittalRecord",
    "Record consultant or PM review comments while keeping the submittal under review.",
    "submittal.review",
  ],
  [
    "resubmit",
    "resubmitSubmittalRecord",
    "Request resubmission or submit a revised submittal package.",
    "submittal.resubmit",
  ],
].forEach(([suffix, operationId, summary, transition]) => {
  add(
    `/projects/{projectId}/submittals/{submittalId}/${suffix}`,
    "post",
    operation({
      tag: "Document Control",
      summary,
      operationId,
      parameters: [
        ...projectParams,
        pathParam("submittalId", "Submittal UUID."),
      ],
      permissions: modulePermission("submittal", "submit", transition),
      requestBody: jsonBody(
        ref("SubmittalWorkflowRequest"),
        `${summary} payload.`,
        suffix !== "review",
      ),
    }),
  );
});

add(
  "/projects/{projectId}/doc-control/dashboard",
  "get",
  operation({
    tag: "Document Control",
    summary:
      "Get document-control dashboard, RFI/submittal/drawing/transmittal/correspondence metrics, due alerts, and revisions.",
    operationId: "getDocControlDashboard",
    parameters: projectParams,
    permissions: modulePermission("document_control", "read"),
  }),
);

add(
  "/projects/{projectId}/doc-control/register",
  "get",
  operation({
    tag: "Document Control",
    summary:
      "List the document register with latest approved revisions, superseded history, attachments, activity links, and linked RFI/submittal/drawing/transmittal records.",
    operationId: "listDocumentRegister",
    parameters: [
      ...projectParams,
      queryParam("recordType", "Filter by document-control record type.", {
        type: "string",
        enum: ["rfi", "submittal", "drawing", "transmittal", "correspondence"],
      }),
      queryParam("folder", "Filter by document-library folder key.", {
        type: "string",
      }),
      queryParam("category", "Filter by document category.", {
        type: "string",
      }),
      queryParam("status", "Filter by record or latest revision status.", {
        type: "string",
      }),
      queryParam(
        "search",
        "Search register references, titles, revisions, and files.",
        {
          type: "string",
        },
      ),
    ],
    permissions: modulePermission("document_control", "read"),
    responseSchema: ref("DocumentRegisterResponse"),
  }),
);

add(
  "/projects/{projectId}/doc-control/{recordType}/{recordId}/revisions",
  "post",
  operation({
    tag: "Document Control",
    summary:
      "Upload/link a private project document as a new record revision. The uploaded file must already exist as a ProjectDocument from workflow uploads.",
    operationId: "uploadDocumentRevision",
    parameters: [
      ...projectParams,
      pathParam("recordType", "Document-control record type.", null),
      pathParam("recordId", "RFI, submittal, drawing, or transmittal UUID."),
    ],
    permissions: modulePermission(
      "document_control",
      "submit",
      "document.revision.upload",
    ),
    requestBody: jsonBody(
      ref("DocumentRevisionUploadRequest"),
      "Revision upload/link payload.",
    ),
    responseSchema: ref("DocumentRevision"),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/doc-control/{recordType}/{recordId}/revisions/upload",
  "post",
  operation({
    tag: "Document Control",
    summary:
      "Upload a file and create a document-control revision with folder/category metadata in one request.",
    operationId: "uploadDocumentRevisionFile",
    parameters: [
      ...projectParams,
      pathParam("recordType", "Document-control record type.", null),
      pathParam("recordId", "RFI, submittal, drawing, or transmittal UUID."),
    ],
    permissions: modulePermission(
      "document_control",
      "submit",
      "document.revision.upload",
    ),
    requestBody: fileUploadBody({
      fieldName: "file",
      description: "Document-control revision upload.",
      accepted: "PDF, images, Word, Excel, CSV, or text files up to 25 MB.",
      extraProperties: {
        revision: { type: "string", maxLength: 40 },
        title: { type: "string", maxLength: 255 },
        documentNumber: { type: "string", maxLength: 120 },
        category: { type: "string", maxLength: 120 },
        folderPath: { type: "string", maxLength: 255 },
        discipline: { type: "string", maxLength: 120 },
        reviewDueAt: { type: "string", format: "date-time" },
        status: { type: "string", enum: ["uploaded", "submitted"] },
        notes: { type: "string", maxLength: 2000 },
      },
      required: ["file", "revision"],
    }),
    responseSchema: ref("DocumentRevisionUploadResponse"),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/doc-control/revisions/{revisionId}/submit-review",
  "post",
  operation({
    tag: "Document Control",
    summary: "Submit an uploaded document revision for review.",
    operationId: "submitDocumentRevisionForReview",
    parameters: [
      ...projectParams,
      pathParam("revisionId", "DocumentRevision UUID."),
    ],
    permissions: modulePermission(
      "document_control",
      "submit",
      "document.revision.submit_review",
    ),
    requestBody: jsonBody(
      ref("DocumentRevisionSubmitReviewRequest"),
      "Optional review submission comment and due date.",
      false,
    ),
    responseSchema: ref("DocumentRevision"),
  }),
);

add(
  "/projects/{projectId}/doc-control/revisions/{revisionId}/approve",
  "post",
  operation({
    tag: "Document Control",
    summary:
      "Approve a document revision, mark it as the latest, and supersede the prior latest revision.",
    operationId: "approveDocumentRevision",
    parameters: [
      ...projectParams,
      pathParam("revisionId", "DocumentRevision UUID."),
    ],
    permissions: modulePermission(
      "document_control",
      "approve",
      "document.revision.approve",
    ),
    requestBody: jsonBody(
      ref("ApprovalDecisionRequest"),
      "Optional approval comment.",
      false,
    ),
    responseSchema: ref("DocumentRevision"),
  }),
);

add(
  "/projects/{projectId}/doc-control/revisions/{revisionId}/supersede",
  "post",
  operation({
    tag: "Document Control",
    summary:
      "Supersede a document revision and keep it read-only with an audit reason.",
    operationId: "supersedeDocumentRevision",
    parameters: [
      ...projectParams,
      pathParam("revisionId", "DocumentRevision UUID."),
    ],
    permissions: modulePermission(
      "document_control",
      "approve",
      "document.revision.supersede",
    ),
    requestBody: jsonBody(
      ref("SupersedeRevisionRequest"),
      "Required supersede reason.",
    ),
    responseSchema: ref("DocumentRevision"),
  }),
);

add(
  "/projects/{projectId}/doc-control/revisions/{revisionId}/download",
  "get",
  operation({
    tag: "Document Control",
    summary: "Permission-check and download a private document revision file.",
    operationId: "downloadDocumentRevision",
    parameters: [
      ...projectParams,
      pathParam("revisionId", "DocumentRevision UUID."),
    ],
    permissions: modulePermission("document_control", "read"),
    responses: {
      200: binaryResponse(
        "Document revision stream when local storage is used.",
        "application/octet-stream",
      ),
      302: redirectResponse(
        "Redirects to a short-lived private S3 presigned URL when object storage is used.",
      ),
    },
  }),
);

add(
  "/projects/{projectId}/doc-control/revisions/{revisionId}/preview",
  "get",
  operation({
    tag: "Document Control",
    summary:
      "Permission-check and stream a private document revision file inline for browser preview.",
    operationId: "previewDocumentRevision",
    parameters: [
      ...projectParams,
      pathParam("revisionId", "DocumentRevision UUID."),
    ],
    permissions: modulePermission("document_control", "read"),
    responses: {
      200: binaryResponse(
        "Document revision inline stream when local storage is used.",
        "application/octet-stream",
      ),
      302: redirectResponse(
        "Redirects to a short-lived private S3 presigned URL when object storage is used.",
      ),
    },
  }),
);

add(
  "/projects/{projectId}/workflow/uploads",
  "post",
  operation({
    tag: "Workflow Uploads",
    summary: "Upload workflow evidence attachments.",
    operationId: "uploadWorkflowFiles",
    parameters: projectParams,
    requestBody: fileUploadBody({
      fieldName: "files",
      description: "Workflow evidence upload. Up to 10 files, 25 MB each.",
      accepted: "Images, PDF, Word, Excel, CSV, and text files.",
      multiple: true,
      required: ["files"],
    }),
    responseSchema: arrayOf(ref("ProjectDocumentUpload")),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/workflow/uploads/{key}",
  "get",
  operation({
    tag: "Workflow Uploads",
    summary: "Download a workflow evidence attachment by storage key.",
    operationId: "downloadWorkflowFile",
    parameters: [
      ...projectParams,
      pathParam("key", "Workflow file storage key.", null),
    ],
    responses: {
      200: binaryResponse(
        "Workflow attachment stream when local storage is used.",
        "application/octet-stream",
      ),
      302: redirectResponse(
        "Redirects to a short-lived private S3 presigned URL when object storage is used.",
      ),
    },
  }),
);

const genericPayloadBody = (description, required = false) =>
  jsonBody(ref("GenericObject"), description, required);

const addGenericRoute = ({
  path,
  method,
  tag,
  summary,
  operationId,
  parameters = projectParams,
  permissions = authenticatedOnly,
  requestBody,
  responses,
  responseDescription,
  responseSchema,
  status = 200,
}) => {
  add(
    path,
    method,
    operation({
      tag,
      summary,
      operationId,
      parameters,
      permissions,
      requestBody,
      responses,
      responseDescription,
      responseSchema,
      status,
    }),
  );
};

const activityMaterialParams = [...projectParams, activityIdParam];
const activityMaterialRecordParams = [
  ...activityMaterialParams,
  pathParam("materialId", "Material UUID."),
];

[
  {
    method: "get",
    path: "/projects/{projectId}/activity-boq-allocations",
    summary: "List BOQ-to-activity allocation workflow records.",
    description:
      "Returns draft, submitted, approved, and rejected BOQ-to-activity allocation records. Only approved active allocations are official EV, IPC, dashboard, and reporting basis; draft/submitted values are pending and rejected/inactive values are excluded.",
    operationId: "listActivityBoqAllocations",
    parameters: [
      ...projectParams,
      queryParam("status", "Filter by workflow status.", {
        type: "string",
        enum: ["draft", "submitted", "approved", "rejected"],
      }),
      queryParam("boqItemId", "Filter by BOQ item UUID.", uuid),
      queryParam("activityId", "Filter by activity UUID.", uuid),
      queryParam("includeInactive", "Include inactive allocations.", {
        type: "boolean",
      }),
    ],
  },
  {
    method: "post",
    path: "/projects/{projectId}/activity-boq-allocations",
    summary: "Create a draft activity BOQ allocation.",
    description:
      "Creates a draft allocation for a BOQ item and official schedule Activity. The API and database reject duplicate active BOQ item/activity pairs; the allocation must be submitted and approved before EV or IPC can use it.",
    operationId: "createActivityBoqAllocation",
    permissions: rolesPermission("pm", "planning_eng", "qs"),
    requestBody: jsonBody(
      ref("ActivityBoqAllocationMutation"),
      "Draft allocation payload.",
    ),
    status: 201,
  },
  {
    method: "patch",
    path: "/projects/{projectId}/activity-boq-allocations/{id}",
    summary: "Update a draft activity BOQ allocation.",
    description:
      "Updates draft-only allocation quantity/value/linkage. Submitted, approved, rejected, or inactive allocations must move through the allocation lifecycle instead of direct edits.",
    operationId: "updateActivityBoqAllocation",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm", "planning_eng", "qs"),
    requestBody: jsonBody(
      ref("ActivityBoqAllocationMutation"),
      "Partial allocation payload.",
      false,
    ),
  },
  {
    method: "post",
    path: "/projects/{projectId}/activity-boq-allocations/{id}/submit",
    summary: "Submit an activity BOQ allocation for approval.",
    description:
      "Moves a draft allocation to submitted. Submitted rows are pending only and remain excluded from official EV and IPC until approved.",
    operationId: "submitActivityBoqAllocation",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm", "planning_eng", "qs"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/activity-boq-allocations/{id}/approve",
    summary: "Approve an activity BOQ allocation.",
    description:
      "Approves a submitted allocation after duplicate active-pair and BOQ item capacity checks. Approved active allocations are the only allocation rows used by official EV and IPC.",
    operationId: "approveActivityBoqAllocation",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm", "qs"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/activity-boq-allocations/{id}/reject",
    summary: "Reject an activity BOQ allocation.",
    description:
      "Rejects a submitted allocation, marks it inactive, and excludes it from official EV, IPC, dashboards, and allocation capacity totals.",
    operationId: "rejectActivityBoqAllocation",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm", "qs"),
    requestBody: jsonBody(ref("RejectRequest"), "Rejection payload."),
  },
].forEach((route) =>
  addGenericRoute({
    tag: "Activity BOQ Allocations",
    ...route,
  }),
);

[
  {
    method: "get",
    path: "/projects/{projectId}/activities/{activityId}/materials",
    summary:
      "List activity material requirements with supplier, PO, receipt, usage, and lead-time risk state.",
    operationId: "listActivityMaterials",
    parameters: activityMaterialParams,
    permissions: modulePermission("procurement", "read"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/activities/{activityId}/materials",
    summary:
      "Create an activity material requirement with need-date and supplier context.",
    operationId: "createActivityMaterial",
    parameters: activityMaterialParams,
    permissions: modulePermission("procurement", "create", "material.plan"),
    requestBody: jsonBody(
      ref("ActivityMaterialRequest"),
      "Activity material payload.",
    ),
    status: 201,
  },
  {
    method: "patch",
    path: "/projects/{projectId}/activities/{activityId}/materials/{materialId}",
    summary: "Update an activity material requirement.",
    operationId: "updateActivityMaterial",
    parameters: activityMaterialRecordParams,
    permissions: modulePermission("procurement", "update", "material.plan"),
    requestBody: jsonBody(
      ref("ActivityMaterialRequest"),
      "Partial activity material payload.",
      false,
    ),
  },
  {
    method: "post",
    path: "/projects/{projectId}/activities/{activityId}/materials/{materialId}/usage",
    summary:
      "Record activity material usage or waste against issued quantities.",
    operationId: "recordActivityMaterialUsage",
    parameters: activityMaterialRecordParams,
    permissions: modulePermission("procurement", "submit", "material.use"),
    requestBody: jsonBody(
      ref("ActivityMaterialUsageRequest"),
      "Activity material usage payload.",
    ),
    status: 201,
  },
  {
    method: "delete",
    path: "/projects/{projectId}/activities/{activityId}/materials/{materialId}",
    summary: "Delete an activity material requirement.",
    operationId: "deleteActivityMaterial",
    parameters: activityMaterialRecordParams,
    permissions: modulePermission("procurement", "delete"),
  },
].forEach((route) =>
  addGenericRoute({
    tag: "Materials",
    ...route,
  }),
);

addGenericRoute({
  path: "/projects/{projectId}/daily-reports/{reportId}/review",
  method: "post",
  tag: "Daily Reports",
  summary: "Review and approve a daily report through the legacy review alias.",
  operationId: "reviewDailyReport",
  parameters: [...projectParams, pathParam("reportId", "Daily report UUID.")],
  permissions: modulePermission("progress", "approve", "daily_report.review"),
});

addGenericRoute({
  path: "/projects/{projectId}/site-reporting/uploads",
  method: "post",
  tag: "Site Reporting",
  summary: "Upload mobile site-reporting photos.",
  operationId: "uploadSiteReportingPhotos",
  requestBody: fileUploadBody({
    fieldName: "files",
    description: "Site-reporting photo upload. Up to 10 images, 8 MB each.",
    accepted: "JPEG, PNG, WebP, HEIC, and HEIF photos.",
    multiple: true,
    required: ["files"],
  }),
  responseSchema: arrayOf(ref("ProjectDocumentUpload")),
  permissions: modulePermission("progress", "submit", "site_reporting.upload"),
  status: 201,
});

addGenericRoute({
  path: "/projects/{projectId}/site-reporting/uploads/{key}",
  method: "get",
  tag: "Site Reporting",
  summary: "Download a mobile site-reporting photo by storage key.",
  operationId: "downloadSiteReportingPhoto",
  parameters: [
    ...projectParams,
    pathParam("key", "Site-reporting file storage key.", null),
  ],
  permissions: modulePermission("progress", "read"),
  responses: {
    200: binaryResponse(
      "Site-reporting photo stream when local storage is used.",
      "application/octet-stream",
    ),
    302: redirectResponse(
      "Redirects to a short-lived private S3 presigned URL when object storage is used.",
    ),
  },
});

[
  {
    method: "get",
    path: "/projects/{projectId}/equipment",
    summary: "List project equipment.",
    operationId: "listEquipment",
  },
  {
    method: "get",
    path: "/projects/{projectId}/equipment/usage",
    summary: "Get approved equipment utilization by activity and equipment.",
    description:
      "Returns approved-only equipment usage posted from daily-report approval, including cost impact and traceability back to source daily-report lines.",
    operationId: "getEquipmentUtilization",
    parameters: [
      ...projectParams,
      queryParam(
        "activityId",
        "Filter utilization to one activity UUID.",
        uuid,
      ),
      queryParam(
        "equipmentId",
        "Filter utilization to one equipment UUID.",
        uuid,
      ),
      queryParam("from", "Usage start date.", dateString),
      queryParam("to", "Usage end date.", dateString),
    ],
    permissions: modulePermission("cost", "read"),
    responseSchema: ref("EquipmentUtilizationReport"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/equipment",
    summary: "Create project equipment.",
    operationId: "createEquipment",
    permissions: rolesPermission("pm", "planning_eng"),
    requestBody: genericPayloadBody("Equipment payload.", true),
    status: 201,
  },
  {
    method: "patch",
    path: "/projects/{projectId}/equipment/{equipmentId}",
    summary: "Update project equipment.",
    operationId: "updateEquipment",
    parameters: [...projectParams, pathParam("equipmentId", "Equipment UUID.")],
    permissions: rolesPermission("pm", "planning_eng"),
    requestBody: genericPayloadBody("Partial equipment payload."),
  },
  {
    method: "delete",
    path: "/projects/{projectId}/equipment/{equipmentId}",
    summary: "Delete project equipment.",
    operationId: "deleteEquipment",
    parameters: [...projectParams, pathParam("equipmentId", "Equipment UUID.")],
    permissions: rolesPermission("pm", "planning_eng"),
  },
].forEach((route) =>
  addGenericRoute({
    tag: "Equipment",
    ...route,
  }),
);

addGenericRoute({
  path: "/projects/{projectId}/audit",
  method: "get",
  tag: "Audit",
  summary: "List project audit events.",
  description:
    "Returns tenant-scoped centralized audit events. Each write also persists a compact redacted RecordHistorySnapshot row for contractual record history reconstruction.",
  operationId: "listProjectAuditEvents",
  parameters: [
    ...projectParams,
    queryParam("entityType", "Filter by audited entity type.", {
      type: "string",
    }),
    queryParam("entityId", "Filter by audited entity id.", { type: "string" }),
    queryParam("action", "Filter by audit action.", { type: "string" }),
    queryParam("source", "Filter by history source.", {
      type: "string",
      enum: ["all", "audit", "approval", "status"],
      default: "all",
    }),
    queryParam("cursor", "Opaque cursor returned by the previous page.", {
      type: "string",
    }),
    queryParam("limit", "Maximum records to return.", {
      type: "integer",
      minimum: 1,
      maximum: 100,
      default: 50,
    }),
    queryParam("order", "Sort direction.", {
      type: "string",
      enum: ["asc", "desc"],
      default: "asc",
    }),
  ],
  permissions: modulePermission("audit", "read"),
  responseSchema: ref("AuditEventsResponse"),
});

const meetingListQueryParams = [
  ...cursorParams,
  queryParam("status", "Filter by comma-separated meeting status values.", {
    type: "string",
  }),
  queryParam("meetingType", "Filter by meeting type.", {
    type: "string",
    enum: [
      "coordination",
      "progress",
      "commercial",
      "quality",
      "safety",
      "design",
      "client",
      "other",
    ],
  }),
  queryParam("activityId", "Filter by linked activity UUID.", uuid),
  includeArchivedParam,
  queryParam(
    "search",
    "Search meeting number, title, objective, minutes, or location.",
    { type: "string" },
  ),
  queryParam("sortBy", "Sort field.", {
    type: "string",
    enum: ["created", "updated", "scheduled", "status", "type"],
  }),
  queryParam("sortDir", "Sort direction.", {
    type: "string",
    enum: ["asc", "desc"],
  }),
];

[
  {
    method: "get",
    path: "/projects/{projectId}/meetings",
    summary: "List project meeting minutes.",
    description:
      "Lists project-scoped meeting minutes with agenda, attendee, decision, action-item, distribution, and comment counts. Action items are activity-linked and can be backed by persisted project tasks.",
    operationId: "listProjectMeetings",
    parameters: [...projectParams, ...meetingListQueryParams],
    permissions: modulePermission("meeting", "read"),
    responseSchema: ref("MeetingListResponse"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/meetings",
    summary: "Create meeting minutes.",
    description:
      "Creates meeting minutes with attendees, agenda items, decisions, and action items. Action items with owners and due dates create linked project tasks unless createTask is false.",
    operationId: "createProjectMeeting",
    parameters: projectParams,
    permissions: modulePermission("meeting", "create"),
    requestBody: jsonBody(
      ref("MeetingMutation"),
      "Meeting minutes payload.",
      true,
    ),
    responseSchema: ref("MeetingRecord"),
    status: 201,
  },
  {
    method: "get",
    path: "/projects/{projectId}/meetings/{id}",
    summary: "Get meeting minutes detail.",
    operationId: "getProjectMeeting",
    parameters: projectRecordParams,
    permissions: modulePermission("meeting", "read"),
    responseSchema: ref("MeetingRecord"),
  },
  {
    method: "patch",
    path: "/projects/{projectId}/meetings/{id}",
    summary: "Update meeting minutes detail.",
    description:
      "Updates meeting header fields and, when provided, replaces attendees, agenda items, decisions, or action items as complete minutes sections.",
    operationId: "updateProjectMeeting",
    parameters: projectRecordParams,
    permissions: modulePermission("meeting", "update"),
    requestBody: jsonBody(ref("MeetingPatch"), "Partial meeting payload."),
    responseSchema: ref("MeetingRecord"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/meetings/{id}/distribute",
    summary: "Distribute meeting minutes.",
    description:
      "Creates distribution-history rows, marks the meeting distributed, sends durable notifications to user recipients, and writes a central audit event.",
    operationId: "distributeProjectMeeting",
    parameters: projectRecordParams,
    permissions: modulePermission("meeting", "submit", "meeting.distribute"),
    requestBody: jsonBody(
      ref("MeetingDistributionRequest"),
      "Distribution recipients and message.",
      false,
    ),
    responseSchema: ref("MeetingDistributionResponse"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/meetings/{id}/comments",
    summary: "Comment on meeting minutes.",
    operationId: "commentProjectMeeting",
    parameters: projectRecordParams,
    permissions: modulePermission("meeting", "submit", "meeting.comment"),
    requestBody: jsonBody(
      ref("MeetingCommentRequest"),
      "Comment payload.",
      true,
    ),
    responseSchema: ref("MeetingComment"),
    status: 201,
  },
  {
    method: "delete",
    path: "/projects/{projectId}/meetings/{id}",
    summary: "Archive meeting minutes.",
    operationId: "archiveProjectMeeting",
    parameters: projectRecordParams,
    permissions: modulePermission("meeting", "delete"),
    responseSchema: ref("ArchiveResponse"),
  },
].forEach((route) =>
  addGenericRoute({
    tag: "Meetings",
    ...route,
  }),
);

[
  {
    method: "get",
    path: "/projects/{projectId}/weekly-reports",
    summary: "List weekly progress reports.",
    operationId: "listWeeklyReports",
  },
  {
    method: "get",
    path: "/projects/{projectId}/weekly-reports/current",
    summary: "Get or create the current weekly progress report.",
    operationId: "getCurrentWeeklyReport",
  },
  {
    method: "post",
    path: "/projects/{projectId}/weekly-reports",
    summary: "Create a weekly progress report.",
    operationId: "createWeeklyReport",
    permissions: rolesPermission("pm", "planning_eng", "site_engineer"),
    requestBody: genericPayloadBody("Weekly report payload.", true),
    status: 201,
  },
  {
    method: "patch",
    path: "/projects/{projectId}/weekly-reports/{id}",
    summary: "Update a weekly progress report.",
    operationId: "updateWeeklyReport",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm", "planning_eng", "site_engineer"),
    requestBody: genericPayloadBody("Partial weekly report payload."),
  },
  {
    method: "delete",
    path: "/projects/{projectId}/weekly-reports/{id}",
    summary: "Delete a weekly progress report.",
    operationId: "deleteWeeklyReport",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm"),
  },
].forEach((route) =>
  addGenericRoute({
    tag: "Weekly Reports",
    ...route,
  }),
);

addGenericRoute({
  path: "/projects/{projectId}/health",
  method: "get",
  tag: "Health",
  summary: "Get seven-dimension project health scoring.",
  description:
    "Returns official project health dimensions with sourceRule, cutoffDate, and drill-through targets, plus a separate pendingReview block for submitted progress, IPC, change orders, and submittals that do not feed official scores.",
  operationId: "getProjectHealth",
});

const taskListQueryParams = [
  ...cursorParams,
  queryParam("status", "Filter by comma-separated task status values.", {
    type: "string",
  }),
  queryParam("priority", "Filter by comma-separated priority values.", {
    type: "string",
  }),
  queryParam("assignee", "Filter to the authenticated user's assignments.", {
    type: "string",
    enum: ["me"],
  }),
  queryParam("assigneeId", "Filter by assignee user UUID.", uuid),
  queryParam("overdue", "Only return open tasks past due date.", {
    type: "boolean",
  }),
  includeArchivedParam,
  queryParam(
    "search",
    "Search task number, title, description, project, or activity.",
    {
      type: "string",
    },
  ),
  queryParam("sortBy", "Sort field.", {
    type: "string",
    enum: ["created", "updated", "due", "priority", "status"],
  }),
  queryParam("sortDir", "Sort direction.", {
    type: "string",
    enum: ["asc", "desc"],
  }),
];

const addTaskRoutes = ({ basePath, idParameters, prefix }) => {
  add(
    basePath,
    "get",
    operation({
      tag: "Tasks",
      summary:
        prefix === "project"
          ? "List persisted project tasks."
          : "List persisted tasks across visible projects.",
      operationId:
        prefix === "project" ? "listProjectTasks" : "listWorkspaceTasks",
      parameters: [
        ...(prefix === "project" ? projectParams : []),
        ...taskListQueryParams,
      ],
      permissions: modulePermission("task", "read"),
      responseSchema: ref("TaskListResponse"),
    }),
  );
  add(
    basePath,
    "post",
    operation({
      tag: "Tasks",
      summary:
        prefix === "project"
          ? "Create a persisted project task."
          : "Create a persisted task in a visible project.",
      operationId:
        prefix === "project" ? "createProjectTask" : "createWorkspaceTask",
      parameters: prefix === "project" ? projectParams : [],
      permissions: modulePermission("task", "create", "task.assign"),
      requestBody: jsonBody(ref("TaskMutation"), "Task payload.", true),
      responseSchema: ref("TaskRecord"),
      status: 201,
    }),
  );
  add(
    `${basePath}/{id}`,
    "get",
    operation({
      tag: "Tasks",
      summary:
        "Get one persisted task with comments, attachments, and history.",
      operationId: prefix === "project" ? "getProjectTask" : "getWorkspaceTask",
      parameters: idParameters,
      permissions: modulePermission("task", "read"),
      responseSchema: ref("TaskRecord"),
    }),
  );
  add(
    `${basePath}/{id}`,
    "patch",
    operation({
      tag: "Tasks",
      summary:
        "Update task status, assignment, due date, activity, or details.",
      operationId:
        prefix === "project" ? "updateProjectTask" : "updateWorkspaceTask",
      parameters: idParameters,
      permissions: modulePermission("task", "update"),
      requestBody: jsonBody(ref("TaskPatch"), "Partial task payload."),
      responseSchema: ref("TaskRecord"),
    }),
  );
  add(
    `${basePath}/{id}/close`,
    "post",
    operation({
      tag: "Tasks",
      summary: "Close a task as done and record optional closeout comment.",
      operationId:
        prefix === "project" ? "closeProjectTask" : "closeWorkspaceTask",
      parameters: idParameters,
      permissions: modulePermission("task", "update", "task.close"),
      requestBody: jsonBody(
        objectSchema({
          comment: { type: "string", nullable: true, maxLength: 4000 },
        }),
        "Optional closeout comment.",
        false,
      ),
      responseSchema: ref("TaskRecord"),
    }),
  );
  add(
    `${basePath}/{id}/comments`,
    "post",
    operation({
      tag: "Tasks",
      summary: "Add a comment to a visible task.",
      operationId:
        prefix === "project"
          ? "addProjectTaskComment"
          : "addWorkspaceTaskComment",
      parameters: idParameters,
      permissions: modulePermission("task", "submit", "task.comment"),
      requestBody: jsonBody(
        ref("TaskCommentRequest"),
        "Comment payload.",
        true,
      ),
      responseSchema: ref("TaskComment"),
      status: 201,
    }),
  );
  add(
    `${basePath}/{id}/attachments`,
    "post",
    operation({
      tag: "Tasks",
      summary: "Attach existing project document references to a task.",
      operationId:
        prefix === "project"
          ? "addProjectTaskAttachment"
          : "addWorkspaceTaskAttachment",
      parameters: idParameters,
      permissions: modulePermission("task", "update"),
      requestBody: jsonBody(
        ref("TaskAttachmentRequest"),
        "Task attachment references.",
        true,
      ),
      responseSchema: ref("TaskRecord"),
      status: 201,
    }),
  );
  add(
    `${basePath}/{id}`,
    "delete",
    operation({
      tag: "Tasks",
      summary:
        "Archive a task while retaining comments, attachments, and history.",
      operationId:
        prefix === "project" ? "deleteProjectTask" : "deleteWorkspaceTask",
      parameters: idParameters,
      permissions: modulePermission("task", "delete"),
      responseSchema: ref("ArchiveResponse"),
    }),
  );
};

addTaskRoutes({
  basePath: "/tasks",
  idParameters: [idParam],
  prefix: "workspace",
});

addTaskRoutes({
  basePath: "/projects/{projectId}/tasks",
  idParameters: projectRecordParams,
  prefix: "project",
});

[
  {
    method: "get",
    path: "/projects/{projectId}/risks",
    summary:
      "List project risks with activity impact links and closeout history.",
    operationId: "listRisks",
    parameters: [
      ...projectParams,
      queryParam("status", "Filter by risk status.", {
        type: "string",
        enum: ["open", "monitoring", "submitted", "closed", "archived"],
      }),
      includeArchivedParam,
    ],
    permissions: modulePermission("risk", "read"),
    responseSchema: arrayOf(ref("RiskRecord")),
  },
  {
    method: "post",
    path: "/projects/{projectId}/risks",
    summary: "Create a project risk with optional linked activities.",
    operationId: "createRisk",
    permissions: modulePermission("risk", "create"),
    requestBody: jsonBody(ref("RiskMutation"), "Risk payload.", true),
    responseSchema: ref("RiskRecord"),
    status: 201,
  },
  {
    method: "post",
    path: "/projects/{projectId}/risks/{id}/submit",
    summary: "Submit a risk mitigation closeout for PM review.",
    operationId: "submitRiskCloseout",
    parameters: projectRecordParams,
    permissions: modulePermission("risk", "submit", "risk.submit"),
    requestBody: jsonBody(
      ref("RiskCloseoutPayload"),
      "Mitigation closeout payload.",
    ),
    responseSchema: ref("RiskRecord"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/risks/{id}/close",
    summary: "Alias for submitting a risk mitigation closeout.",
    operationId: "closeRisk",
    parameters: projectRecordParams,
    permissions: modulePermission("risk", "submit", "risk.submit"),
    requestBody: jsonBody(
      ref("RiskCloseoutPayload"),
      "Mitigation closeout payload.",
    ),
    responseSchema: ref("RiskRecord"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/risks/{id}/approve",
    summary: "Approve a submitted risk closeout.",
    operationId: "approveRiskCloseout",
    parameters: projectRecordParams,
    permissions: modulePermission("risk", "approve", "risk.approve"),
    requestBody: jsonBody(
      ref("RiskCloseoutPayload"),
      "Optional PM closeout approval comment.",
      false,
    ),
    responseSchema: ref("RiskRecord"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/risks/{id}/reject",
    summary: "Reject a submitted risk closeout.",
    operationId: "rejectRiskCloseout",
    parameters: projectRecordParams,
    permissions: modulePermission("risk", "approve", "risk.reject"),
    requestBody: jsonBody(ref("RiskCloseoutPayload"), "PM rejection reason."),
    responseSchema: ref("RiskRecord"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/risks/{id}/disapprove",
    summary: "Alias for rejecting a submitted risk closeout.",
    operationId: "disapproveRiskCloseout",
    parameters: projectRecordParams,
    permissions: modulePermission("risk", "approve", "risk.reject"),
    requestBody: jsonBody(ref("RiskCloseoutPayload"), "PM rejection reason."),
    responseSchema: ref("RiskRecord"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/risks/{id}/reopen",
    summary: "Reopen a closed risk into monitoring.",
    operationId: "reopenRisk",
    parameters: projectRecordParams,
    permissions: modulePermission("risk", "approve", "risk.reopen"),
    requestBody: jsonBody(ref("RiskCloseoutPayload"), "Reopen reason."),
    responseSchema: ref("RiskRecord"),
  },
  {
    method: "patch",
    path: "/projects/{projectId}/risks/{id}",
    summary: "Update a project risk.",
    operationId: "updateRisk",
    parameters: projectRecordParams,
    permissions: modulePermission("risk", "update"),
    requestBody: jsonBody(ref("RiskMutation"), "Partial risk payload."),
    responseSchema: ref("RiskRecord"),
  },
  {
    method: "delete",
    path: "/projects/{projectId}/risks/{id}",
    summary: "Archive a project risk while retaining history.",
    operationId: "deleteRisk",
    parameters: projectRecordParams,
    permissions: modulePermission("risk", "delete"),
    responseSchema: ref("ArchiveResponse"),
  },
].forEach((route) =>
  addGenericRoute({
    tag: "Risks",
    ...route,
  }),
);

const costRecordListParams = [
  ...projectParams,
  ...cursorParams,
  queryParam("activityId", "Filter by linked activity UUID.", uuid),
  queryParam("category", "Filter by activity phase/category.", {
    type: "string",
  }),
  queryParam("search", "Search linked activity name, WBS code, or category.", {
    type: "string",
  }),
  queryParam("sortBy", "Sort field.", {
    type: "string",
    enum: [
      "activity",
      "phase",
      "updated",
      "labour",
      "material",
      "equipment",
      "subcontract",
      "committed",
      "actual",
      "forecast",
    ],
    default: "activity",
  }),
  queryParam("sortDir", "Sort direction.", {
    type: "string",
    enum: ["asc", "desc"],
    default: "asc",
  }),
];

[
  {
    method: "get",
    path: "/projects/{projectId}/cost",
    summary: "List activity cost records.",
    operationId: "listCostRecords",
    parameters: costRecordListParams,
    permissions: modulePermission("cost", "read"),
    responseSchema: ref("RowsCursorPage"),
  },
  {
    method: "get",
    path: "/projects/{projectId}/cost/summary",
    summary: "Get project cost summary.",
    operationId: "getCostSummary",
    permissions: modulePermission("cost", "read"),
  },
  {
    method: "get",
    path: "/projects/{projectId}/cost/burn-rate",
    summary: "Get cost burn-rate entries.",
    operationId: "getBurnRate",
    permissions: modulePermission("cost", "read"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/cost/burn-rate",
    summary: "Create a burn-rate entry.",
    operationId: "createBurnRateEntry",
    permissions: modulePermission("cost", "create", "burn_rate.create"),
    requestBody: genericPayloadBody("Burn-rate payload.", true),
    status: 201,
  },
  {
    method: "post",
    path: "/projects/{projectId}/cost/activity/{activityId}",
    summary: "Create or update a cost record for an activity.",
    operationId: "upsertActivityCostRecord",
    parameters: [...projectParams, activityIdParam],
    permissions: modulePermission("cost", "create", "activity_cost.upsert"),
    requestBody: jsonBody(ref("CostRecordRequest"), "Activity cost payload."),
    status: 201,
  },
  {
    method: "patch",
    path: "/projects/{projectId}/cost/{id}",
    summary: "Update an activity cost record.",
    operationId: "updateCostRecord",
    parameters: projectRecordParams,
    permissions: modulePermission("cost", "update", "activity_cost.update"),
    requestBody: jsonBody(
      ref("CostRecordRequest"),
      "Partial cost payload.",
      false,
    ),
  },
].forEach((route) =>
  addGenericRoute({
    tag: "Cost Control",
    ...route,
  }),
);

addGenericRoute({
  path: "/projects/{projectId}/sub-valuations/{id}",
  method: "delete",
  tag: "Commercial",
  summary: "Delete a subcontractor valuation.",
  operationId: "deleteSubValuation",
  parameters: projectRecordParams,
});

[
  {
    method: "get",
    path: "/projects/{projectId}/budget-revisions",
    summary: "List budget revisions.",
    operationId: "listBudgetRevisions",
  },
  {
    method: "post",
    path: "/projects/{projectId}/budget-revisions",
    summary: "Create a budget revision.",
    operationId: "createBudgetRevision",
    requestBody: genericPayloadBody("Budget revision payload.", true),
    status: 201,
  },
  {
    method: "patch",
    path: "/projects/{projectId}/budget-revisions/{revisionId}",
    summary: "Update a budget revision.",
    operationId: "updateBudgetRevision",
    parameters: [
      ...projectParams,
      pathParam("revisionId", "Budget revision UUID."),
    ],
    requestBody: genericPayloadBody("Partial budget revision payload."),
  },
  {
    method: "delete",
    path: "/projects/{projectId}/budget-revisions/{revisionId}",
    summary: "Delete a budget revision.",
    operationId: "deleteBudgetRevision",
    parameters: [
      ...projectParams,
      pathParam("revisionId", "Budget revision UUID."),
    ],
  },
].forEach((route) =>
  addGenericRoute({
    tag: "Commercial",
    ...route,
  }),
);

addGenericRoute({
  path: "/projects/{projectId}/cash-flow/{id}",
  method: "delete",
  tag: "Commercial",
  summary: "Delete a cash-flow entry.",
  operationId: "deleteCashFlowEntry",
  parameters: projectRecordParams,
});

[
  {
    method: "patch",
    path: "/projects/{projectId}/weather-delays/{id}",
    summary: "Update a weather delay record.",
    operationId: "updateWeatherDelay",
    requestBody: genericPayloadBody("Partial weather delay payload."),
  },
  {
    method: "delete",
    path: "/projects/{projectId}/weather-delays/{id}",
    summary: "Delete a weather delay record.",
    operationId: "deleteWeatherDelay",
  },
].forEach((route) =>
  addGenericRoute({
    tag: "Commercial",
    parameters: projectRecordParams,
    ...route,
  }),
);

[
  ["itp", "Quality", "ITP", "itpId", "Itp"],
  ["defects", "Quality", "Defect", "defectId", "Defect"],
  ["material-tests", "Quality", "Material test", "testId", "MaterialTest"],
  ["drawings", "Document Control", "Drawing", "drawingId", "Drawing"],
  [
    "transmittals",
    "Document Control",
    "Transmittal",
    "transmittalId",
    "Transmittal",
  ],
  [
    "correspondence",
    "Document Control",
    "Correspondence",
    "correspondenceId",
    "Correspondence",
  ],
].forEach(([base, tag, label, idName, operationBase]) => {
  const recordParams = [...projectParams, pathParam(idName, `${label} UUID.`)];

  addGenericRoute({
    path: `/projects/{projectId}/${base}`,
    method: "get",
    tag,
    summary: `List ${label.toLowerCase()} records.`,
    operationId: `list${operationBase}Records`,
  });
  addGenericRoute({
    path: `/projects/{projectId}/${base}`,
    method: "post",
    tag,
    summary: `Create a ${label.toLowerCase()} record.`,
    operationId: `create${operationBase}Record`,
    requestBody: genericPayloadBody(`${label} payload.`, true),
    status: 201,
  });
  addGenericRoute({
    path: `/projects/{projectId}/${base}/{${idName}}`,
    method: "patch",
    tag,
    summary: `Update a ${label.toLowerCase()} record.`,
    operationId: `update${operationBase}Record`,
    parameters: recordParams,
    requestBody: genericPayloadBody(`Partial ${label} payload.`),
  });
  addGenericRoute({
    path: `/projects/{projectId}/${base}/{${idName}}`,
    method: "delete",
    tag,
    summary: `Delete a ${label.toLowerCase()} record.`,
    operationId: `delete${operationBase}Record`,
    parameters: recordParams,
  });
});

add(
  "/projects/{projectId}/export/xlsx",
  "get",
  operation({
    tag: "Exports",
    summary: "Download a multi-sheet XLSX project export.",
    operationId: "exportProjectXlsx",
    parameters: projectParams,
    permissions: modulePermission("cost", "export"),
    responses: {
      200: binaryResponse(
        "Project XLSX export.",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    },
  }),
);

add(
  "/users",
  "get",
  operation({
    tag: "Users",
    summary: "List organization users.",
    operationId: "listUsers",
    parameters: [
      ...cursorParams,
      queryParam("status", "Filter by active/inactive status.", {
        type: "string",
        enum: ["active", "inactive"],
      }),
      queryParam("role", "Filter by role id.", { type: "string" }),
      queryParam("search", "Search name or email.", { type: "string" }),
      queryParam("sortBy", "Sort field.", {
        type: "string",
        enum: ["name", "email", "projects", "created"],
      }),
      queryParam("sortDir", "Sort direction.", {
        type: "string",
        enum: ["asc", "desc"],
      }),
    ],
    permissions: modulePermission("user_management", "read"),
    responseSchema: ref("CursorPage"),
  }),
);

add(
  "/users/invitations",
  "post",
  operation({
    tag: "Users",
    summary: "Invite a user to the organization or a project.",
    description:
      "PM-only onboarding flow. Stores a hashed invitation token, sends an email invite, and audits the invitation. The invite can optionally assign a project role when accepted.",
    operationId: "inviteUser",
    permissions: modulePermission("user_management", "submit", "user.invite"),
    requestBody: jsonBody(ref("UserInvitationRequest"), "Invitation payload."),
    responseSchema: ref("UserInvitationResponse"),
    status: 201,
  }),
);

[
  {
    method: "post",
    path: "/users",
    summary: "Create an organization user.",
    operationId: "createUser",
    permissions: modulePermission("user_management", "create"),
    requestBody: genericPayloadBody("User creation payload.", true),
    status: 201,
    parameters: [],
  },
  {
    method: "get",
    path: "/users/{id}",
    summary: "Get an organization user.",
    operationId: "getUser",
    permissions: modulePermission("user_management", "read"),
    parameters: [idParam],
  },
  {
    method: "patch",
    path: "/users/{id}",
    summary: "Update an organization user.",
    operationId: "updateUser",
    permissions: modulePermission(
      "user_management",
      "update",
      "user.assign_role",
    ),
    parameters: [idParam],
    requestBody: genericPayloadBody("Partial user payload."),
  },
  {
    method: "post",
    path: "/users/{id}/reset-password",
    summary: "Reset a user password.",
    operationId: "resetUserPassword",
    permissions: modulePermission(
      "user_management",
      "update",
      "user.reset_password",
    ),
    parameters: [idParam],
    requestBody: genericPayloadBody("Password reset payload.", true),
  },
  {
    method: "patch",
    path: "/users/{id}/deactivate",
    summary: "Deactivate a user.",
    operationId: "deactivateUser",
    permissions: modulePermission(
      "user_management",
      "update",
      "user.deactivate",
    ),
    parameters: [idParam],
  },
  {
    method: "patch",
    path: "/users/{id}/activate",
    summary: "Activate a user.",
    operationId: "activateUser",
    permissions: modulePermission("user_management", "update", "user.activate"),
    parameters: [idParam],
  },
].forEach((route) =>
  addGenericRoute({
    tag: "Users",
    ...route,
  }),
);

const notificationIdParam = pathParam(
  "notificationId",
  "Notification UUID scoped to the authenticated user.",
);

add(
  "/notifications/summary",
  "get",
  operation({
    tag: "Notifications",
    summary: "Get notification counts and recent items.",
    operationId: "getNotificationSummary",
    responseSchema: ref("NotificationSummary"),
    permissions: authenticatedOnly,
  }),
);

// ─── Web Push (OCTA-MOB-PWA-018) ───────────────────────────────────────────
const pushSubscriptionSchema = objectSchema({
  id: uuid,
  endpoint: { type: "string" },
  userAgent: { type: "string", nullable: true },
  platform: { type: "string", nullable: true, enum: ["ios", "android", "windows", "macos", "linux", null] },
  failureCount: { type: "integer" },
  lastUsedAt: nullableDateString,
  createdAt: nullableDateString,
});

add(
  "/notifications/push/public-key",
  "get",
  operation({
    tag: "Notifications",
    summary: "VAPID public key for `PushManager.subscribe`; `configured` is false when the server has no keys.",
    operationId: "getPushPublicKey",
    responseSchema: objectSchema({ configured: { type: "boolean" }, publicKey: { type: "string", nullable: true } }),
    permissions: authenticatedOnly,
  }),
);

add(
  "/notifications/push/subscriptions",
  "get",
  operation({
    tag: "Notifications",
    summary: "The caller's registered push devices.",
    operationId: "listPushSubscriptions",
    responseSchema: objectSchema({ configured: { type: "boolean" }, publicKey: { type: "string", nullable: true }, items: arrayOf(pushSubscriptionSchema) }),
    permissions: authenticatedOnly,
  }),
);

add(
  "/notifications/push/subscriptions",
  "post",
  operation({
    tag: "Notifications",
    summary: "Register (or refresh) this browser's push subscription. Upserts on endpoint.",
    operationId: "createPushSubscription",
    requestBody: jsonBody(
      objectSchema({ endpoint: { type: "string" }, keys: objectSchema({ p256dh: { type: "string" }, auth: { type: "string" } }, ["p256dh", "auth"]) }, ["endpoint", "keys"]),
      "The `PushSubscription.toJSON()` of the browser.",
    ),
    responseSchema: pushSubscriptionSchema,
    permissions: authenticatedOnly,
    status: 201,
  }),
);

add(
  "/notifications/push/subscriptions",
  "delete",
  operation({
    tag: "Notifications",
    summary: "Forget a push subscription by endpoint.",
    operationId: "deletePushSubscription",
    requestBody: jsonBody(objectSchema({ endpoint: { type: "string" } }, ["endpoint"]), "Endpoint to remove."),
    responseSchema: objectSchema({ removed: { type: "integer" } }),
    permissions: authenticatedOnly,
  }),
);

add(
  "/notifications/push/test",
  "post",
  operation({
    tag: "Notifications",
    summary: "Send a test push to every device of the caller (503 when push is not configured).",
    operationId: "sendPushTest",
    responseSchema: objectSchema({ sent: { type: "integer" }, failed: { type: "integer" }, removed: { type: "integer" } }),
    permissions: authenticatedOnly,
  }),
);

add(
  "/notifications/preferences",
  "get",
  operation({
    tag: "Notifications",
    summary: "Get the authenticated user's notification preferences.",
    operationId: "getNotificationPreferences",
    responseSchema: ref("NotificationPreferencesResponse"),
    permissions: authenticatedOnly,
  }),
);

add(
  "/notifications/preferences",
  "put",
  operation({
    tag: "Notifications",
    summary: "Update notification channel preferences.",
    operationId: "updateNotificationPreferences",
    requestBody: jsonBody(
      ref("NotificationPreferencesUpdateRequest"),
      "Preference rows to upsert.",
    ),
    responseSchema: ref("NotificationPreferencesResponse"),
    permissions: authenticatedOnly,
  }),
);

add(
  "/notifications",
  "get",
  operation({
    tag: "Notifications",
    summary: "List in-app notifications for the authenticated user.",
    operationId: "listNotifications",
    parameters: [
      ...cursorParams,
      queryParam("status", "Notification read/archive filter.", {
        type: "string",
        enum: ["active", "all", "unread", "read", "archived"],
      }),
      queryParam("category", "Notification category filter.", {
        type: "string",
        enum: [
          "assignment",
          "due",
          "overdue",
          "approval",
          "commercial",
          "quality",
          "safety",
          "task",
          "workflow",
        ],
      }),
      queryParam("projectId", "Optional project UUID filter.", uuid),
    ],
    responseSchema: ref("NotificationListResponse"),
    permissions: authenticatedOnly,
  }),
);

add(
  "/notifications/mark-read",
  "post",
  operation({
    tag: "Notifications",
    summary: "Mark all visible notifications as read.",
    operationId: "markAllNotificationsRead",
    responseSchema: ref("NotificationMarkAllReadResponse"),
    permissions: authenticatedOnly,
  }),
);

add(
  "/notifications/deliveries/retry",
  "post",
  operation({
    tag: "Notifications",
    summary:
      "Retry pending email delivery attempts for the authenticated user.",
    operationId: "retryOwnNotificationDeliveries",
    requestBody: jsonBody(
      objectSchema({
        limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      }),
      "Optional delivery retry limit.",
      false,
    ),
    responseSchema: ref("NotificationDeliveryRetryResponse"),
    permissions: authenticatedOnly,
  }),
);

add(
  "/notifications/scan-due",
  "post",
  operation({
    tag: "Notifications",
    summary: "Create due and overdue notifications for open workflow records.",
    operationId: "scanDueNotifications",
    requestBody: jsonBody(
      ref("NotificationDueScanRequest"),
      "Optional project and horizon filters.",
      false,
    ),
    responseSchema: ref("NotificationDueScanResponse"),
    status: 201,
    permissions: rolesPermission("pm", "planning_eng"),
  }),
);

add(
  "/notifications/{notificationId}",
  "get",
  operation({
    tag: "Notifications",
    summary: "Get a notification and delivery audit attempts.",
    operationId: "getNotification",
    parameters: [notificationIdParam],
    responseSchema: ref("Notification"),
    permissions: authenticatedOnly,
  }),
);

add(
  "/notifications/{notificationId}/read",
  "patch",
  operation({
    tag: "Notifications",
    summary: "Mark one notification read or unread.",
    operationId: "markNotificationRead",
    parameters: [notificationIdParam],
    requestBody: jsonBody(
      objectSchema({
        read: { type: "boolean", default: true },
      }),
      "Read state update.",
      false,
    ),
    responseSchema: ref("Notification"),
    permissions: authenticatedOnly,
  }),
);

add(
  "/notifications/{notificationId}/archive",
  "patch",
  operation({
    tag: "Notifications",
    summary: "Archive one notification.",
    operationId: "archiveNotification",
    parameters: [notificationIdParam],
    responseSchema: ref("Notification"),
    permissions: authenticatedOnly,
  }),
);

add(
  "/notifications/{notificationId}/retry-email",
  "post",
  operation({
    tag: "Notifications",
    summary: "Queue and process an email retry for one notification.",
    operationId: "retryNotificationEmail",
    parameters: [notificationIdParam],
    responseSchema: ref("NotificationRetryResponse"),
    status: 202,
    permissions: authenticatedOnly,
  }),
);

add(
  "/config/extra-services",
  "get",
  operation({
    tag: "Config",
    summary: "List configurable extra BOQ services.",
    operationId: "getExtraServices",
    permissions: authenticatedOnly,
  }),
);

[
  {
    method: "get",
    path: "/projects/{projectId}/locations",
    summary:
      "List the project location tree (flat ordered rows plus nested tree).",
    operationId: "listLocations",
    parameters: [...projectParams, includeArchivedParam],
    permissions: modulePermission("location", "read"),
    responseSchema: ref("LocationListResponse"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/locations",
    summary: "Create a location under an optional parent.",
    operationId: "createLocation",
    permissions: modulePermission("location", "create"),
    requestBody: jsonBody(ref("LocationMutation"), "Location payload.", true),
    responseSchema: ref("LocationRecord"),
    status: 201,
  },
  {
    method: "post",
    path: "/projects/{projectId}/locations/reorder",
    summary: "Reorder direct children of one parent.",
    operationId: "reorderLocations",
    permissions: modulePermission("location", "update"),
    requestBody: jsonBody(
      ref("LocationReorderPayload"),
      "Ordered sibling ids.",
      true,
    ),
    responseSchema: arrayOf(ref("LocationRecord")),
  },
  {
    method: "patch",
    path: "/projects/{projectId}/locations/{id}",
    summary: "Rename, recode, describe, reorder, or move a location.",
    operationId: "updateLocation",
    parameters: projectRecordParams,
    permissions: modulePermission("location", "update"),
    requestBody: jsonBody(ref("LocationMutation"), "Partial location payload."),
    responseSchema: ref("LocationRecord"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/locations/{id}/archive",
    summary: "Archive a location and its whole subtree.",
    operationId: "archiveLocation",
    parameters: projectRecordParams,
    permissions: modulePermission("location", "delete", "location.archive"),
    requestBody: jsonBody(ref("LocationReasonPayload"), "Optional reason.", false),
    responseSchema: ref("LocationArchiveResponse"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/locations/{id}/restore",
    summary: "Restore an archived location (parent must be active).",
    operationId: "restoreLocation",
    parameters: projectRecordParams,
    permissions: modulePermission("location", "delete", "location.restore"),
    requestBody: jsonBody(ref("LocationReasonPayload"), "Optional reason.", false),
    responseSchema: ref("LocationRecord"),
  },
  {
    method: "delete",
    path: "/projects/{projectId}/locations/{id}",
    summary: "Alias for archiving a location subtree.",
    operationId: "deleteLocation",
    parameters: projectRecordParams,
    permissions: modulePermission("location", "delete", "location.archive"),
    responseSchema: ref("LocationArchiveResponse"),
  },
].forEach((route) =>
  addGenericRoute({
    tag: "Locations",
    ...route,
  }),
);

const backgroundJobIdParam = pathParam("jobId", "Background job UUID.");
const projectJobParams = [projectIdParam, backgroundJobIdParam];

[
  {
    method: "get",
    path: "/projects/{projectId}/jobs",
    summary: "List durable background jobs for a project (newest first).",
    operationId: "listProjectJobs",
    parameters: [
      ...projectParams,
      queryParam("status", "Filter by job status.", {
        type: "string",
        enum: ["queued", "running", "succeeded", "failed", "cancelled"],
      }),
      queryParam("type", "Filter by job type.", {
        type: "string",
        enum: [
          "boq.parse",
          "schedule.generate",
          "schedule.import",
          "document.extract",
          "report.render",
          "notification.deliver",
        ],
      }),
      queryParam("limit", "Maximum rows (1-100, default 25).", {
        type: "integer",
        minimum: 1,
        maximum: 100,
      }),
    ],
    permissions: authenticatedOnly,
    responseSchema: ref("BackgroundJobListResponse"),
  },
  {
    method: "get",
    path: "/projects/{projectId}/jobs/{jobId}",
    summary: "Read one background job.",
    operationId: "getProjectJob",
    parameters: projectJobParams,
    permissions: authenticatedOnly,
    responseSchema: ref("BackgroundJob"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/jobs/{jobId}/retry",
    summary:
      "Re-queue a failed or cancelled job. Requires update permission on the job's module (boq or schedule).",
    operationId: "retryProjectJob",
    parameters: projectJobParams,
    permissions: authenticatedOnly,
    responseSchema: ref("BackgroundJob"),
    status: 202,
  },
  {
    method: "post",
    path: "/projects/{projectId}/jobs/{jobId}/cancel",
    summary:
      "Cancel a queued job. Requires update permission on the job's module.",
    operationId: "cancelProjectJob",
    parameters: projectJobParams,
    permissions: authenticatedOnly,
    responseSchema: ref("BackgroundJob"),
  },
].forEach((route) =>
  addGenericRoute({
    tag: "Jobs",
    ...route,
  }),
);

add(
  "/projects/{projectId}/schedule/job/{jobId}/retry",
  "post",
  operation({
    tag: "Schedule",
    summary: "Re-queue a failed AI schedule generation job.",
    operationId: "retryScheduleGenerationJob",
    parameters: projectJobParams,
    permissions: modulePermission("schedule", "update"),
    responseSchema: ref("JobStatusView"),
    status: 202,
  }),
);

add(
  "/projects/{projectId}/boq/job/{jobId}/retry",
  "post",
  operation({
    tag: "BOQ",
    summary: "Re-queue a failed BOQ AI activity job.",
    operationId: "retryBoqJob",
    parameters: projectJobParams,
    permissions: rolesPermission("pm", "planning_eng", "qs"),
    responseSchema: ref("JobStatusView"),
    status: 202,
  }),
);

// ─── Permission templates & project team ────────────────────────────────
const companyAdminPermission = {
  auth: "bearer",
  roles: ["pm"],
  note: "Company admins (User.isCompanyAdmin) and project managers.",
};
const permissionTemplateIdParam = pathParam("id", "Permission template UUID.");

add(
  "/permissions/catalog",
  "get",
  operation({
    tag: "Permissions",
    summary:
      "List the modules, actions, transitions, levels, roles and party roles a template can reference.",
    operationId: "getPermissionCatalog",
    responseSchema: ref("PermissionCatalog"),
  }),
);

[
  {
    method: "get",
    path: "/permissions/templates",
    summary: "List the organisation's permission templates.",
    operationId: "listPermissionTemplates",
    parameters: [
      queryParam("status", "Filter by status (defaults to active).", {
        type: "string",
        enum: ["active", "archived"],
      }),
      queryParam("kind", "Filter by kind.", {
        type: "string",
        enum: ["internal", "external"],
      }),
      queryParam("includeArchived", "Include archived templates.", {
        type: "boolean",
      }),
    ],
    responseSchema: ref("PermissionTemplateListResponse"),
  },
  {
    method: "post",
    path: "/permissions/templates",
    summary: "Create a permission template.",
    operationId: "createPermissionTemplate",
    parameters: [],
    requestBody: jsonBody(
      ref("PermissionTemplateMutationRequest"),
      "Template definition.",
    ),
    responseSchema: ref("PermissionTemplate"),
    status: 201,
  },
  {
    method: "get",
    path: "/permissions/templates/{id}",
    summary: "Read one permission template.",
    operationId: "getPermissionTemplate",
    parameters: [permissionTemplateIdParam],
    responseSchema: ref("PermissionTemplate"),
  },
  {
    method: "patch",
    path: "/permissions/templates/{id}",
    summary:
      "Update a permission template. Passing tools or grants replaces the full set.",
    operationId: "updatePermissionTemplate",
    parameters: [permissionTemplateIdParam],
    requestBody: jsonBody(
      ref("PermissionTemplateMutationRequest"),
      "Fields to change.",
    ),
    responseSchema: ref("PermissionTemplate"),
  },
  {
    method: "post",
    path: "/permissions/templates/{id}/duplicate",
    summary: "Copy a template (system defaults included) into an editable one.",
    operationId: "duplicatePermissionTemplate",
    parameters: [permissionTemplateIdParam],
    requestBody: jsonBody(
      objectSchema({
        name: { type: "string", maxLength: 120 },
        description: { type: "string", maxLength: 1000, nullable: true },
      }),
      "Optional name/description for the copy.",
      false,
    ),
    responseSchema: ref("PermissionTemplate"),
    status: 201,
  },
  {
    method: "delete",
    path: "/permissions/templates/{id}",
    summary:
      "Archive a template. Fails with 409 while it is assigned to project users or parties; system defaults cannot be archived.",
    operationId: "archivePermissionTemplate",
    parameters: [permissionTemplateIdParam],
    responseSchema: ref("PermissionTemplate"),
  },
].forEach((route) =>
  addGenericRoute({
    tag: "Permissions",
    permissions: companyAdminPermission,
    ...route,
  }),
);

[
  {
    method: "get",
    path: "/projects/{projectId}/team",
    summary:
      "List project team members (assignments and party members) with the template governing each.",
    operationId: "listProjectTeam",
    parameters: projectParams,
    permissions: authenticatedOnly,
    responseSchema: ref("ProjectTeamResponse"),
  },
  {
    method: "put",
    path: "/projects/{projectId}/team/{userId}/permissions",
    summary:
      "Assign a permission template (with optional per-module overrides) to a project member.",
    operationId: "setProjectUserPermission",
    parameters: [projectIdParam, userIdParam],
    permissions: companyAdminPermission,
    requestBody: jsonBody(
      ref("ProjectUserPermissionRequest"),
      "Template assignment.",
    ),
    responseSchema: ref("ProjectUserPermission"),
  },
  {
    method: "delete",
    path: "/projects/{projectId}/team/{userId}/permissions",
    summary:
      "Remove the template assignment so the member falls back to role/party permissions.",
    operationId: "removeProjectUserPermission",
    parameters: [projectIdParam, userIdParam],
    permissions: companyAdminPermission,
    responseSchema: objectSchema({
      removed: { type: "boolean" },
      projectId: uuid,
      userId: uuid,
    }),
  },
  {
    method: "put",
    path: "/projects/{projectId}/team/parties/{partyId}/permissions",
    summary: "Set the external template applied to every member of a project party.",
    operationId: "setProjectPartyPermissionTemplate",
    parameters: [projectIdParam, partyIdParam],
    permissions: companyAdminPermission,
    requestBody: jsonBody(
      ref("ProjectPartyPermissionRequest"),
      "Template assignment.",
    ),
    responseSchema: objectSchema({
      id: uuid,
      projectId: uuid,
      template: { allOf: [ref("PermissionTemplateRef")], nullable: true },
    }),
  },
].forEach((route) =>
  addGenericRoute({
    tag: "Permissions",
    ...route,
  }),
);

// ─── Accountability references ──────────────────────────────────────────
[
  {
    method: "get",
    path: "/projects/{projectId}/assignments/mine",
    summary:
      "Open records where the caller is owner, reviewer, approver, assignee, or ball in court.",
    operationId: "listMyProjectAssignments",
    parameters: [
      ...projectParams,
      queryParam("limit", "Maximum items (1-500, default 200).", {
        type: "integer",
        minimum: 1,
        maximum: 500,
      }),
    ],
    permissions: authenticatedOnly,
    responseSchema: ref("MyOpenItemsResponse"),
  },
  {
    method: "get",
    path: "/projects/{projectId}/assignments/unresolved",
    summary:
      "Backfill report: legacy text assignments that could not be matched to a user.",
    operationId: "listUnresolvedAssignments",
    parameters: projectParams,
    permissions: companyAdminPermission,
    responseSchema: ref("UnresolvedAssignmentReport"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/assignments/resolve",
    summary:
      "Manually map one record field to a user or company and recompute ball in court.",
    operationId: "resolveAssignment",
    parameters: projectParams,
    permissions: companyAdminPermission,
    requestBody: jsonBody(ref("ResolveAssignmentRequest"), "Mapping."),
    responseSchema: ref("ResolveAssignmentResponse"),
  },
].forEach((route) =>
  addGenericRoute({
    tag: "Assignments",
    ...route,
  }),
);

// ─── Unified attachments and photos ─────────────────────────────────────
const attachmentRecordPermission = {
  auth: "bearer",
  roles: ROLE_IDS,
  note: "Permission follows the record's module: read needs `read`; adding or removing attachments needs `update`, `submit` or `create` on that module (or a permission template granting it).",
};
const attachmentIdParam = pathParam("attachmentId", "Attachment UUID.");
const photoIdParam = pathParam("photoId", "Photo UUID.");
const documentIdParam = pathParam("documentId", "ProjectDocument UUID.");

add(
  "/projects/{projectId}/attachments",
  "get",
  operation({
    tag: "Attachments",
    summary: "List attachments on one record (or every record of a type).",
    operationId: "listAttachments",
    parameters: [
      ...projectParams,
      queryParam("recordType", "Record type.", ref("AttachmentRecordType"), { required: true }),
      queryParam("recordId", "Record id. Omit to list every record of the type.", { type: "string" }),
    ],
    permissions: attachmentRecordPermission,
    responseSchema: ref("AttachmentListResponse"),
  }),
);

add(
  "/projects/{projectId}/attachments",
  "post",
  operation({
    tag: "Attachments",
    summary:
      "Attach uploaded files and/or existing documents to any record. Images become Photos (EXIF, GPS) and get a background thumbnail.",
    operationId: "createAttachments",
    parameters: projectParams,
    permissions: attachmentRecordPermission,
    requestBody: fileUploadBody({
      fieldName: "files",
      multiple: true,
      required: ["recordType", "recordId"],
      description:
        "Multipart form. `files` may be omitted when `documentIds` links existing documents.",
      accepted: "Images, PDF, Word, Excel, CSV, text (max 25 MB each, 20 files).",
      extraProperties: {
        recordType: ref("AttachmentRecordType"),
        recordId: { type: "string" },
        role: {
          type: "string",
          enum: ["attachment", "evidence", "photo", "reference"],
        },
        caption: { type: "string", maxLength: 500 },
        locationId: { type: "string", format: "uuid" },
        tags: { type: "string", description: "Comma-separated tags for photos." },
        clientRequestId: { type: "string", maxLength: 120, description: "Offline idempotency key for the whole upload; a replay returns the attachments already created." },
        documentIds: {
          type: "string",
          description: "JSON array or comma-separated ProjectDocument ids to link.",
        },
      },
    }),
    responseSchema: ref("AttachmentListResponse"),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/attachments/documents/{documentId}",
  "get",
  operation({
    tag: "Attachments",
    summary: "Download or redirect to any document attached on the project.",
    operationId: "getAttachedDocumentFile",
    parameters: [projectIdParam, documentIdParam],
    responses: {
      200: binaryResponse("File contents.", "application/octet-stream"),
      302: redirectResponse("Redirect to a short-lived presigned URL when stored in S3."),
    },
  }),
);

add(
  "/projects/{projectId}/attachments/{attachmentId}",
  "delete",
  operation({
    tag: "Attachments",
    summary: "Unlink a document from a record. The document and its photo remain.",
    operationId: "deleteAttachment",
    parameters: [projectIdParam, attachmentIdParam],
    permissions: attachmentRecordPermission,
    responseSchema: objectSchema({
      deleted: { type: "boolean" },
      id: uuid,
      recordType: ref("AttachmentRecordType"),
      recordId: { type: "string" },
    }),
  }),
);

[
  {
    method: "get",
    path: "/projects/{projectId}/photos",
    summary:
      "Photo gallery: every image attached on the project, filterable by date, location subtree, tag, record type and caption.",
    operationId: "listPhotos",
    parameters: [
      ...projectParams,
      queryParam("from", "Taken on or after (ISO-8601).", dateString),
      queryParam("to", "Taken on or before (ISO-8601).", dateString),
      queryParam("locationId", "Location id; includes descendants.", uuid),
      queryParam("tag", "Tag filter.", { type: "string" }),
      queryParam("recordType", "Only photos attached to this record type.", ref("AttachmentRecordType")),
      queryParam("recordId", "Only photos attached to this record.", { type: "string" }),
      queryParam("search", "Caption or file name contains.", { type: "string" }),
      queryParam("cursor", "Photo id cursor.", uuid),
      queryParam("limit", "Page size (1-200, default 60).", {
        type: "integer",
        minimum: 1,
        maximum: 200,
      }),
    ],
    permissions: modulePermission("document_control", "read"),
    responseSchema: ref("PhotoListResponse"),
  },
  {
    method: "patch",
    path: "/projects/{projectId}/photos/{photoId}",
    summary: "Update a photo's caption, tags, location or capture time.",
    operationId: "updatePhoto",
    parameters: [projectIdParam, photoIdParam],
    permissions: modulePermission("document_control", "create"),
    requestBody: jsonBody(ref("PhotoUpdateRequest"), "Fields to change."),
    responseSchema: ref("Photo"),
  },
].forEach((route) =>
  addGenericRoute({
    tag: "Attachments",
    ...route,
  }),
);

add(
  "/projects/{projectId}/photos/{photoId}/file",
  "get",
  operation({
    tag: "Attachments",
    summary: "Original photo file.",
    operationId: "getPhotoFile",
    parameters: [projectIdParam, photoIdParam],
    permissions: modulePermission("document_control", "read"),
    responses: {
      200: binaryResponse("Image bytes.", "image/*"),
      302: redirectResponse("Redirect to a short-lived presigned URL when stored in S3."),
    },
  }),
);

add(
  "/projects/{projectId}/photos/{photoId}/thumbnail",
  "get",
  operation({
    tag: "Attachments",
    summary:
      "Thumbnail generated by the photo.thumbnail job; falls back to the original until ready.",
    operationId: "getPhotoThumbnail",
    parameters: [projectIdParam, photoIdParam],
    permissions: modulePermission("document_control", "read"),
    responses: {
      200: binaryResponse("Image bytes.", "image/jpeg"),
      302: redirectResponse("Redirect to a short-lived presigned URL when stored in S3."),
    },
  }),
);

// ─── Comments, mentions and record subscriptions ───────────────────────
const commentRecordPermission = {
  auth: "bearer",
  roles: ROLE_IDS,
  note: "Permission follows the record's module: anyone who can `read` it can read comments, comment, and follow the record. Editing is author-only; removal is author, project manager or company admin.",
};
const commentIdParam = pathParam("commentId", "Comment UUID.");
// Comments and subscriptions are always read against one record: both routes
// validate recordType and recordId, so both are required here.
const commentRecordParams = [
  ...projectParams,
  queryParam("recordType", "Record type.", ref("AttachmentRecordType"), { required: true }),
  queryParam("recordId", "Record id.", { type: "string" }, { required: true }),
];

add(
  "/projects/{projectId}/comments",
  "get",
  operation({
    tag: "Comments",
    summary: "List comments on one record, oldest first by default.",
    operationId: "listComments",
    parameters: [
      ...commentRecordParams,
      queryParam("cursor", "Comment id cursor.", uuid),
      queryParam("limit", "Page size (1-200, default 50).", {
        type: "integer",
        minimum: 1,
        maximum: 200,
      }),
      queryParam("order", "Sort order.", { type: "string", enum: ["asc", "desc"] }),
    ],
    permissions: commentRecordPermission,
    responseSchema: ref("CommentListResponse"),
  }),
);

add(
  "/projects/{projectId}/comments",
  "post",
  operation({
    tag: "Comments",
    summary:
      "Comment on any record. @mentions notify the named users (category `mention`); other followers get a `comment` notification. The author and mentioned users start following the record.",
    operationId: "createComment",
    parameters: projectParams,
    permissions: commentRecordPermission,
    requestBody: jsonBody(ref("CommentCreateRequest"), "Comment to add."),
    responseSchema: ref("Comment"),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/comments/{commentId}",
  "patch",
  operation({
    tag: "Comments",
    summary: "Edit your own comment (marks it edited; newly mentioned users are notified).",
    operationId: "updateComment",
    parameters: [projectIdParam, commentIdParam],
    permissions: commentRecordPermission,
    requestBody: jsonBody(ref("CommentUpdateRequest"), "Fields to change."),
    responseSchema: ref("Comment"),
  }),
);

add(
  "/projects/{projectId}/comments/{commentId}",
  "delete",
  operation({
    tag: "Comments",
    summary: "Remove a comment (soft delete; the row stays for audit).",
    operationId: "deleteComment",
    parameters: [projectIdParam, commentIdParam],
    permissions: commentRecordPermission,
    responseSchema: objectSchema({ deleted: { type: "boolean" }, id: uuid }),
  }),
);

add(
  "/projects/{projectId}/subscriptions",
  "get",
  operation({
    tag: "Comments",
    summary: "Who follows a record, and whether the caller does.",
    operationId: "getRecordSubscription",
    parameters: commentRecordParams,
    permissions: commentRecordPermission,
    responseSchema: ref("RecordSubscriptionState"),
  }),
);

add(
  "/projects/{projectId}/subscriptions",
  "put",
  operation({
    tag: "Comments",
    summary:
      "Follow or unfollow a record. Unfollowing mutes the subscription so automatic rules (created, commented, mentioned, assigned) never re-follow it.",
    operationId: "setRecordSubscription",
    parameters: projectParams,
    permissions: commentRecordPermission,
    requestBody: jsonBody(ref("RecordSubscriptionRequest"), "Follow state."),
    responseSchema: ref("RecordSubscriptionState"),
  }),
);

add(
  "/projects/{projectId}/subscriptions/mine",
  "get",
  operation({
    tag: "Comments",
    summary: "Records the caller follows on this project.",
    operationId: "listMySubscriptions",
    parameters: [
      ...projectParams,
      queryParam("limit", "Maximum rows (1-500, default 100).", {
        type: "integer",
        minimum: 1,
        maximum: 500,
      }),
    ],
    responseSchema: ref("MySubscriptionsResponse"),
  }),
);

// ─── Document text and search ──────────────────────────────────────────
const documentSearchIdParam = pathParam("documentId", "ProjectDocument UUID.");

add(
  "/projects/{projectId}/documents/search",
  "get",
  operation({
    tag: "Document Search",
    summary:
      "Search inside document contents (PDF text layers, Word, Excel, PowerPoint, text). Postgres full-text ranking with highlighted snippets; `semantic=true` adds embedding similarity when a provider is configured.",
    operationId: "searchDocumentContent",
    parameters: [
      ...projectParams,
      queryParam("q", "Search terms (websearch syntax: quotes, OR, -exclude).", {
        type: "string",
        minLength: 1,
        maxLength: 200,
      }),
      queryParam("limit", "Maximum hits (1-50, default 20).", { type: "integer", minimum: 1, maximum: 50 }),
      queryParam("semantic", "Also rank by embedding similarity.", { type: "boolean" }),
    ],
    permissions: {
      auth: "bearer",
      roles: ROLE_IDS,
      note: "Needs document_control.read. Each hit is also filtered by the modules the document is linked from (e.g. an IPC attachment needs ipc.read).",
    },
    responseSchema: ref("DocumentSearchResponse"),
  }),
);

add(
  "/projects/{projectId}/documents/index-status",
  "get",
  operation({
    tag: "Document Search",
    summary: "How much of the project's document set is text-indexed, and whether embeddings are enabled.",
    operationId: "getDocumentIndexStatus",
    parameters: projectParams,
    permissions: modulePermission("document_control", "read"),
    responseSchema: ref("DocumentIndexStatus"),
  }),
);

add(
  "/projects/{projectId}/documents/reindex",
  "post",
  operation({
    tag: "Document Search",
    summary: "Queue text extraction for every document that is not indexed yet (or every document with `force`).",
    operationId: "reindexDocuments",
    parameters: projectParams,
    permissions: modulePermission("document_control", "update"),
    requestBody: jsonBody(objectSchema({ force: { type: "boolean" } }), "Options.", false),
    responseSchema: ref("DocumentReindexResponse"),
    status: 202,
  }),
);

add(
  "/projects/{projectId}/documents/{documentId}/text",
  "get",
  operation({
    tag: "Document Search",
    summary: "Extraction status and (truncated) extracted text of one document.",
    operationId: "getDocumentText",
    parameters: [
      projectIdParam,
      documentSearchIdParam,
      queryParam("maxChars", "Characters of text to return (200-200000, default 20000).", {
        type: "integer",
        minimum: 200,
        maximum: 200000,
      }),
    ],
    permissions: modulePermission("document_control", "read"),
    responseSchema: ref("DocumentTextResponse"),
  }),
);

add(
  "/projects/{projectId}/documents/{documentId}/extract",
  "post",
  operation({
    tag: "Document Search",
    summary: "Re-run text extraction for one document through the document.extract job.",
    operationId: "extractDocumentText",
    parameters: [projectIdParam, documentSearchIdParam],
    permissions: modulePermission("document_control", "update"),
    responseSchema: ref("DocumentExtractResponse"),
    status: 202,
  }),
);

// ─── Drawings: sets, sheets, revisions ─────────────────────────────────
const drawingSetIdParam = pathParam("setId", "Drawing set UUID.");
const sheetIdParam = pathParam("sheetId", "Sheet UUID.");
const sheetRevisionIdParam = pathParam("revisionId", "Sheet revision UUID.");
const drawingUploadPermission = {
  auth: "bearer",
  roles: ROLE_IDS,
  note: "Transition `document.revision.upload` on document_control (PM, planning engineer, site engineer).",
};
const drawingPublishPermission = {
  auth: "bearer",
  roles: ROLE_IDS,
  note: "Transition `drawing.publish` on document_control (PM, planning engineer, or a permission template granting it).",
};
const drawingSetFields = {
  name: { type: "string", maxLength: 160, description: "Defaults to the file name." },
  description: { type: "string", maxLength: 2000 },
  discipline: { type: "string", maxLength: 80, description: "Fallback discipline for pages whose number has no recognisable prefix." },
  purpose: { type: "string", enum: ["IFC", "IFT", "IFA", "AS_BUILT", "TENDER", "SHOP", "RECORD", "OTHER"] },
  receivedAt: dateString,
  issuedAt: dateString,
};

add(
  "/projects/{projectId}/drawings/sets",
  "get",
  operation({
    tag: "Drawings",
    summary: "Drawing sets with per-status revision counts (archived sets hidden unless `status=all`).",
    operationId: "listDrawingSets",
    parameters: [...projectParams, queryParam("status", "Filter by set status, or `all`.", { type: "string" })],
    permissions: modulePermission("document_control", "read"),
    responseSchema: ref("DrawingSetListResponse"),
  }),
);

add(
  "/projects/{projectId}/drawings/sets",
  "post",
  operation({
    tag: "Drawings",
    summary:
      "Upload a multi-page PDF as a drawing set. Returns 202: the drawing.set_process job reads every page's text layer and pre-fills sheet numbers, titles, revisions and disciplines with confidences.",
    operationId: "createDrawingSet",
    parameters: projectParams,
    permissions: drawingUploadPermission,
    requestBody: fileUploadBody({
      fieldName: "file",
      required: ["file"],
      description: "Multipart form with the set PDF (max 250 MB, 1 500 pages).",
      accepted: "PDF only.",
      extraProperties: drawingSetFields,
    }),
    responseSchema: ref("DrawingSet"),
    status: 202,
  }),
);

[
  {
    method: "get",
    path: "/projects/{projectId}/drawings/sets/{setId}",
    summary: "One set with every page revision (detected values, confidence, review state).",
    operationId: "getDrawingSet",
    parameters: [projectIdParam, drawingSetIdParam],
    permissions: modulePermission("document_control", "read"),
    responseSchema: ref("DrawingSet"),
  },
  {
    method: "patch",
    path: "/projects/{projectId}/drawings/sets/{setId}",
    summary: "Rename, re-describe or archive a set.",
    operationId: "updateDrawingSet",
    parameters: [projectIdParam, drawingSetIdParam],
    permissions: modulePermission("document_control", "update"),
    requestBody: jsonBody(ref("DrawingSetUpdateRequest"), "Fields to change."),
    responseSchema: ref("DrawingSet"),
  },
  {
    method: "delete",
    path: "/projects/{projectId}/drawings/sets/{setId}",
    summary: "Delete a set that has not published any sheet (otherwise archive it).",
    operationId: "deleteDrawingSet",
    parameters: [projectIdParam, drawingSetIdParam],
    permissions: modulePermission("document_control", "update"),
    responseSchema: objectSchema({ deleted: { type: "boolean" }, id: uuid }),
  },
  {
    method: "post",
    path: "/projects/{projectId}/drawings/sets/{setId}/reprocess",
    summary: "Re-run title-block detection on pending pages (published pages are kept).",
    operationId: "reprocessDrawingSet",
    parameters: [projectIdParam, drawingSetIdParam],
    permissions: modulePermission("document_control", "update"),
    responseSchema: objectSchema({ queued: { type: "boolean" }, jobId: uuid, setId: uuid }),
    status: 202,
  },
  {
    method: "get",
    path: "/projects/{projectId}/drawings/sets/{setId}/revisions",
    summary: "Page revisions of a set, in page order.",
    operationId: "listDrawingSetRevisions",
    parameters: [projectIdParam, drawingSetIdParam],
    permissions: modulePermission("document_control", "read"),
    responseSchema: ref("SheetRevisionListResponse"),
  },
  {
    method: "patch",
    path: "/projects/{projectId}/drawings/sets/{setId}/revisions",
    summary: "Review grid: correct numbers, titles, revisions, disciplines; reject pages that are not sheets.",
    operationId: "reviewDrawingSetRevisions",
    parameters: [projectIdParam, drawingSetIdParam],
    permissions: drawingUploadPermission,
    requestBody: jsonBody(ref("SheetRevisionReviewRequest"), "Up to 500 page updates."),
    responseSchema: ref("SheetRevisionListResponse"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/drawings/sets/{setId}/publish",
    summary:
      "Publish reviewed pages: each becomes the current revision of its sheet (matched by number), the previous current revision is superseded, followers and site roles are notified, every step is audited. All-or-nothing.",
    operationId: "publishDrawingSet",
    parameters: [projectIdParam, drawingSetIdParam],
    permissions: drawingPublishPermission,
    requestBody: jsonBody(ref("DrawingSetPublishRequest"), "Optional subset.", false),
    responseSchema: ref("DrawingSetPublishResponse"),
  },
].forEach((route) => addGenericRoute({ tag: "Drawings", ...route }));

add(
  "/projects/{projectId}/drawings/sheets",
  "get",
  operation({
    tag: "Drawings",
    summary: "The current sheet set as the site sees it, with filters. Superseded revisions are never listed here.",
    operationId: "listSheets",
    parameters: [
      ...projectParams,
      queryParam("discipline", "Discipline filter.", { type: "string" }),
      queryParam("locationId", "Location id; includes descendants.", uuid),
      queryParam("search", "Number or title contains.", { type: "string" }),
      queryParam("status", "current (default), obsolete or all.", { type: "string", enum: ["current", "obsolete", "all"] }),
      queryParam("setId", "Only sheets with a revision from this set.", uuid),
    ],
    permissions: modulePermission("document_control", "read"),
    responseSchema: ref("SheetListResponse"),
  }),
);

add(
  "/projects/{projectId}/drawings/sheets/offline-manifest",
  "get",
  operation({
    tag: "Drawings",
    summary: "Current sheets with file URLs, sizes and hashes for offline caching on site devices.",
    operationId: "getSheetOfflineManifest",
    parameters: projectParams,
    permissions: modulePermission("document_control", "read"),
    responseSchema: ref("SheetOfflineManifest"),
  }),
);

add(
  "/projects/{projectId}/drawings/sheets/revisions/{revisionId}/publish",
  "post",
  operation({
    tag: "Drawings",
    summary: "Publish one pending sheet revision (single-sheet upload flow).",
    operationId: "publishSheetRevision",
    parameters: [projectIdParam, sheetRevisionIdParam],
    permissions: drawingPublishPermission,
    responseSchema: {
      allOf: [ref("SheetPublishResult"), objectSchema({ revision: ref("SheetRevision") })],
    },
  }),
);

[
  {
    method: "get",
    path: "/projects/{projectId}/drawings/sheets/{sheetId}",
    summary: "One sheet with its revision history. Superseded revisions are included only for users who can update document control.",
    operationId: "getSheet",
    parameters: [projectIdParam, sheetIdParam],
    permissions: modulePermission("document_control", "read"),
    responseSchema: ref("Sheet"),
  },
  {
    method: "patch",
    path: "/projects/{projectId}/drawings/sheets/{sheetId}",
    summary: "Edit title, discipline, area, or mark the sheet obsolete / current again.",
    operationId: "updateSheet",
    parameters: [projectIdParam, sheetIdParam],
    permissions: modulePermission("document_control", "update"),
    requestBody: jsonBody(ref("SheetUpdateRequest"), "Fields to change."),
    responseSchema: ref("Sheet"),
  },
  {
    method: "get",
    path: "/projects/{projectId}/drawings/sheets/{sheetId}/revisions",
    summary: "Revision history of a sheet (superseded only for document_control.update).",
    operationId: "listSheetRevisions",
    parameters: [projectIdParam, sheetIdParam],
    permissions: modulePermission("document_control", "read"),
    responseSchema: ref("SheetRevisionListResponse"),
  },
].forEach((route) => addGenericRoute({ tag: "Drawings", ...route }));

add(
  "/projects/{projectId}/drawings/sheets/{sheetId}/revisions",
  "post",
  operation({
    tag: "Drawings",
    summary: "Upload a new revision of one sheet as a PDF; `publish=true` publishes it immediately (needs drawing.publish).",
    operationId: "uploadSheetRevision",
    parameters: [projectIdParam, sheetIdParam],
    permissions: drawingUploadPermission,
    requestBody: fileUploadBody({
      fieldName: "file",
      required: ["file", "revision"],
      description: "Multipart form.",
      accepted: "PDF only (max 100 MB).",
      extraProperties: {
        revision: { type: "string", maxLength: 20 },
        title: { type: "string", maxLength: 200 },
        pageNumber: { type: "integer", minimum: 1, description: "Page inside the PDF that is the sheet (default 1)." },
        publish: { type: "boolean" },
      },
    }),
    responseSchema: ref("SheetRevisionUploadResponse"),
    status: 201,
  }),
);

// ─── RFI upgrade (manager, assignees, thread, change event, PDF) ────────
const rfiUpgradeIdParam = pathParam("rfiId", "RFI UUID.");
const rfiResponseIdParam = pathParam("responseId", "Response UUID.");
[
  {
    method: "get",
    path: "/projects/{projectId}/rfi/{rfiId}",
    summary: "One RFI with manager, assignees, distribution, the response thread, the official answer, references and impacts. Drafts are only visible to their creator and manager.",
    operationId: "getRfiDetail",
    parameters: [projectIdParam, rfiUpgradeIdParam],
    permissions: modulePermission("rfi", "read"),
    responseSchema: ref("RfiDetail"),
  },
  {
    method: "get",
    path: "/projects/{projectId}/rfi/{rfiId}/export.pdf",
    summary: "RFI as PDF: question, official response, discussion thread, people, references and impacts.",
    operationId: "exportRfiPdf",
    parameters: [projectIdParam, rfiUpgradeIdParam],
    permissions: modulePermission("rfi", "export"),
    responses: { 200: binaryResponse("PDF file.", "application/pdf") },
  },
  {
    method: "put",
    path: "/projects/{projectId}/rfi/{rfiId}/people",
    summary: "Set the manager, assignees and distribution. New assignees are notified; the ball in court moves to the first assignee while open.",
    operationId: "updateRfiPeople",
    parameters: [projectIdParam, rfiUpgradeIdParam],
    permissions: modulePermission("rfi", "update"),
    requestBody: jsonBody(ref("RfiPeopleRequest"), "People."),
    responseSchema: ref("RfiDetail"),
  },
  {
    method: "get",
    path: "/projects/{projectId}/rfi/{rfiId}/responses",
    summary: "The response thread.",
    operationId: "listRfiResponses",
    parameters: [projectIdParam, rfiUpgradeIdParam],
    permissions: modulePermission("rfi", "read"),
    responseSchema: objectSchema({ items: arrayOf(ref("RfiResponse")), officialResponseId: nullableUuid, revision: { type: "integer" } }),
  },
  {
    method: "post",
    path: "/projects/{projectId}/rfi/{rfiId}/responses",
    summary: "Add a response. `isOfficial: true` answers the RFI (status answered, ball to the manager, requires `rfi.answer`); otherwise the thread grows and the people on the RFI are notified.",
    operationId: "addRfiResponse",
    parameters: [projectIdParam, rfiUpgradeIdParam],
    permissions: modulePermission("rfi", "submit"),
    requestBody: jsonBody(ref("RfiResponseRequest"), "Response."),
    responseSchema: ref("RfiDetail"),
    status: 201,
  },
  {
    method: "patch",
    path: "/projects/{projectId}/rfi/{rfiId}/responses/{responseId}",
    summary: "Edit a response (author or PM).",
    operationId: "updateRfiResponse",
    parameters: [projectIdParam, rfiUpgradeIdParam, rfiResponseIdParam],
    permissions: modulePermission("rfi", "submit"),
    requestBody: jsonBody(objectSchema({ body: { type: "string" } }, ["body"]), "New text."),
    responseSchema: ref("RfiDetail"),
  },
  {
    method: "delete",
    path: "/projects/{projectId}/rfi/{rfiId}/responses/{responseId}",
    summary: "Remove a non-official response (author or PM).",
    operationId: "deleteRfiResponse",
    parameters: [projectIdParam, rfiUpgradeIdParam, rfiResponseIdParam],
    permissions: modulePermission("rfi", "submit"),
    responseSchema: objectSchema({ deleted: { type: "boolean" }, id: uuid }),
  },
  {
    method: "post",
    path: "/projects/{projectId}/rfi/{rfiId}/responses/{responseId}/official",
    summary: "Make a thread response the official answer (answers the RFI when it is open).",
    operationId: "setOfficialRfiResponse",
    parameters: [projectIdParam, rfiUpgradeIdParam, rfiResponseIdParam],
    permissions: modulePermission("rfi", "submit", "rfi.answer"),
    responseSchema: ref("RfiDetail"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/rfi/{rfiId}/convert-to-change",
    summary: "Create a draft change order from the RFI (subject, question, official response, activity, cost / schedule impact) and link it back.",
    operationId: "convertRfiToChangeEvent",
    parameters: [projectIdParam, rfiUpgradeIdParam],
    permissions: modulePermission("change_order", "create"),
    requestBody: jsonBody(ref("RfiConvertRequest"), "Overrides."),
    responseSchema: objectSchema({ changeOrder: ref("GenericObject"), rfi: ref("RfiDetail") }),
    status: 201,
  },
].forEach((route) => addGenericRoute({ tag: "Document Control", ...route }));

// ─── Inspections & forms (checklist / template engine) ─────────────────
const formInstanceIdParam = pathParam("instanceId", "Inspection / form instance UUID.");
const formTemplateIdParam = pathParam("templateId", "Template UUID.");
const formItemIdParam = pathParam("itemId", "Template item UUID.");
const formCompanyTemplateIdParam = pathParam("id", "Company template UUID.");
const formTemplateAdmin = modulePermission("inspection", "update", "inspection.template_admin");
const formScopedNote = "Users who join through a project party only see instances assigned to their company or people.";
const templateQueryParams = [
  queryParam("type", "Template type.", { type: "string", enum: ["inspection", "itp", "form", "talk"] }),
  queryParam("status", "Template status.", { type: "string", enum: ["draft", "active", "archived"] }),
  queryParam("includeArchived", "Include archived templates.", { type: "boolean" }),
  queryParam("search", "Name contains.", { type: "string" }),
];

add(
  "/projects/{projectId}/forms/templates",
  "get",
  operation({
    tag: "Inspections & Forms",
    summary: "Templates usable on this project: the project's own plus the company library (`scope=all`, default).",
    operationId: "listProjectFormTemplates",
    parameters: [...projectParams, queryParam("scope", "all (default), project or company.", { type: "string", enum: ["all", "project", "company"] }), ...templateQueryParams],
    permissions: modulePermission("inspection", "read"),
    responseSchema: ref("FormTemplateListResponse"),
  }),
);

add(
  "/projects/{projectId}/forms/templates",
  "post",
  operation({
    tag: "Inspections & Forms",
    summary: "Create a project template (sections → items; item types pass/fail, yes/no, checkbox, text, number, choice, date, photo, signature; ITP hold points).",
    operationId: "createProjectFormTemplate",
    parameters: projectParams,
    permissions: formTemplateAdmin,
    requestBody: jsonBody(ref("FormTemplateInput"), "Template."),
    responseSchema: ref("FormTemplate"),
    status: 201,
  }),
);

[
  {
    method: "get",
    path: "/projects/{projectId}/forms/templates/{templateId}",
    summary: "One template with its sections and items.",
    operationId: "getProjectFormTemplate",
    parameters: [projectIdParam, formTemplateIdParam],
    permissions: modulePermission("inspection", "read"),
    responseSchema: ref("FormTemplate"),
  },
  {
    method: "patch",
    path: "/projects/{projectId}/forms/templates/{templateId}",
    summary: "Edit a project template. Sending `sections` replaces the structure and bumps the version; items that already have answers cannot be removed (409 FORM_ITEM_IN_USE). Company templates are edited under /company (403 FORM_TEMPLATE_COMPANY_SCOPED).",
    operationId: "updateProjectFormTemplate",
    parameters: [projectIdParam, formTemplateIdParam],
    permissions: formTemplateAdmin,
    requestBody: jsonBody(ref("FormTemplateInput"), "Fields to change."),
    responseSchema: ref("FormTemplate"),
  },
  {
    method: "delete",
    path: "/projects/{projectId}/forms/templates/{templateId}",
    summary: "Archive a project template (existing instances keep working).",
    operationId: "archiveProjectFormTemplate",
    parameters: [projectIdParam, formTemplateIdParam],
    permissions: formTemplateAdmin,
    responseSchema: objectSchema({ id: uuid, status: { type: "string" } }),
  },
  {
    method: "post",
    path: "/projects/{projectId}/forms/templates/{templateId}/duplicate",
    summary: "Copy a template (company or project) into this project so it can be edited here.",
    operationId: "duplicateFormTemplateIntoProject",
    parameters: [projectIdParam, formTemplateIdParam],
    permissions: formTemplateAdmin,
    requestBody: jsonBody(objectSchema({ name: { type: "string", nullable: true } }), "Optional new name."),
    responseSchema: ref("FormTemplate"),
    status: 201,
  },
].forEach((route) => addGenericRoute({ tag: "Inspections & Forms", ...route }));

const formFilterParams = [
  queryParam("status", "Status, comma list, or `all` (void hidden by default).", { type: "string" }),
  queryParam("type", "Instance type.", { type: "string", enum: ["inspection", "itp", "form", "talk"] }),
  queryParam("templateId", "Template.", uuid),
  queryParam("activityId", "Activity.", uuid),
  queryParam("locationId", "Location id; includes descendants.", uuid),
  queryParam("sheetId", "Drawing sheet.", uuid),
  queryParam("assigneeUserId", "Assignee.", uuid),
  queryParam("assigneeCompanyId", "Responsible company.", uuid),
  queryParam("ballInCourtUserId", "Ball in court user id, or `me`.", { type: "string" }),
  queryParam("outcome", "pass or fail.", { type: "string", enum: ["pass", "fail"] }),
  queryParam("overdue", "Only open instances past their due / scheduled date.", { type: "boolean" }),
  queryParam("from", "Scheduled on or after.", { type: "string", format: "date-time" }),
  queryParam("to", "Scheduled on or before.", { type: "string", format: "date-time" }),
  queryParam("search", "Ref, title or location contains.", { type: "string" }),
  queryParam("limit", "Maximum rows (default 1000).", { type: "integer", minimum: 1, maximum: 1000 }),
];

add(
  "/projects/{projectId}/forms",
  "get",
  operation({
    tag: "Inspections & Forms",
    summary: "Inspections, ITPs, forms and toolbox talks with a summary (open, overdue, failed, awaiting close, open hold points).",
    operationId: "listFormInstances",
    parameters: [...projectParams, ...formFilterParams],
    permissions: { ...modulePermission("inspection", "read"), note: formScopedNote },
    responseSchema: ref("FormInstanceListResponse"),
  }),
);

add(
  "/projects/{projectId}/forms",
  "post",
  operation({
    tag: "Inspections & Forms",
    summary: "Schedule an instance of a template (idempotent on `clientRequestId` for offline capture). Numbered per type: INS/ITP/FRM/TBT-001.",
    operationId: "createFormInstance",
    parameters: projectParams,
    permissions: modulePermission("inspection", "create"),
    requestBody: jsonBody(ref("FormInstanceInput"), "Instance."),
    responseSchema: ref("FormInstance"),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/forms/hold-points",
  "get",
  operation({
    tag: "Inspections & Forms",
    summary: "Open ITP hold points on an activity — the same check progress approval makes (409 ITP_HOLD_POINT_OPEN).",
    operationId: "listActivityHoldPoints",
    parameters: [...projectParams, queryParam("activityId", "Activity.", uuid, { required: true })],
    permissions: modulePermission("inspection", "read"),
    responseSchema: objectSchema({ activityId: uuid, open: { type: "integer" }, holdPoints: arrayOf(ref("FormHoldPoint")) }),
  }),
);

add(
  "/projects/{projectId}/forms/{instanceId}/export.pdf",
  "get",
  operation({
    tag: "Inspections & Forms",
    summary: "Filled-in form as PDF (items with results and notes, deficiencies, signatures; JPEG photos optional).",
    operationId: "exportFormInstancePdf",
    parameters: [projectIdParam, formInstanceIdParam, queryParam("includePhotos", "Embed JPEG evidence (max 40).", { type: "boolean" })],
    permissions: modulePermission("inspection", "export"),
    responses: { 200: binaryResponse("PDF file.", "application/pdf") },
  }),
);

[
  {
    method: "get",
    path: "/projects/{projectId}/forms/{instanceId}",
    summary: "One instance with its sections, items, answers, photo counts, signatures and open hold points.",
    operationId: "getFormInstance",
    parameters: [projectIdParam, formInstanceIdParam],
    permissions: { ...modulePermission("inspection", "read"), note: formScopedNote },
    responseSchema: ref("FormInstance"),
  },
  {
    method: "patch",
    path: "/projects/{projectId}/forms/{instanceId}",
    summary: "Reschedule or reassign an open instance (complete / closed / void are locked).",
    operationId: "updateFormInstance",
    parameters: [projectIdParam, formInstanceIdParam],
    permissions: modulePermission("inspection", "update"),
    requestBody: jsonBody(ref("FormInstanceInput"), "Fields to change (templateId not allowed)."),
    responseSchema: ref("FormInstance"),
  },
  {
    method: "delete",
    path: "/projects/{projectId}/forms/{instanceId}",
    summary: "Delete a scheduled instance that has no answers; void the rest.",
    operationId: "deleteFormInstance",
    parameters: [projectIdParam, formInstanceIdParam],
    permissions: modulePermission("inspection", "delete"),
    responseSchema: objectSchema({ deleted: { type: "boolean" }, id: uuid }),
  },
  {
    method: "post",
    path: "/projects/{projectId}/forms/{instanceId}/start",
    summary: "Mark a scheduled instance as in progress.",
    operationId: "startFormInstance",
    parameters: [projectIdParam, formInstanceIdParam],
    permissions: modulePermission("inspection", "submit", "inspection.start"),
    responseSchema: ref("FormInstance"),
  },
  {
    method: "put",
    path: "/projects/{projectId}/forms/{instanceId}/responses",
    summary: "Save answers (bulk upsert, validated per item type; fail / no / out-of-range numbers are deficient). A scheduled instance moves to in_progress on the first answer.",
    operationId: "saveFormResponses",
    parameters: [projectIdParam, formInstanceIdParam],
    permissions: modulePermission("inspection", "submit", "inspection.start"),
    requestBody: jsonBody(ref("FormResponsesRequest"), "Answers."),
    responseSchema: ref("FormInstance"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/forms/{instanceId}/complete",
    summary: "Complete: every required item answered, required photos attached (recordType form_response), required signatures present — else 400 FORM_INCOMPLETE with `details.problems`. Outcome pass/fail; recurring instances schedule the next copy.",
    operationId: "completeFormInstance",
    parameters: [projectIdParam, formInstanceIdParam],
    permissions: modulePermission("inspection", "submit", "inspection.complete"),
    responseSchema: ref("FormInstance"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/forms/{instanceId}/close",
    summary: "Approver closes a completed instance.",
    operationId: "closeFormInstance",
    parameters: [projectIdParam, formInstanceIdParam],
    permissions: modulePermission("inspection", "approve", "inspection.close"),
    requestBody: jsonBody(objectSchema({ reason: { type: "string", nullable: true } }), "Optional note."),
    responseSchema: ref("FormInstance"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/forms/{instanceId}/reopen",
    summary: "Reopen a completed or closed instance for more answers (reason required).",
    operationId: "reopenFormInstance",
    parameters: [projectIdParam, formInstanceIdParam],
    permissions: modulePermission("inspection", "approve", "inspection.reopen"),
    requestBody: jsonBody(objectSchema({ reason: { type: "string" } }, ["reason"]), "Why."),
    responseSchema: ref("FormInstance"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/forms/{instanceId}/void",
    summary: "Void an instance that is not closed (reason required).",
    operationId: "voidFormInstance",
    parameters: [projectIdParam, formInstanceIdParam],
    permissions: modulePermission("inspection", "approve", "inspection.void"),
    requestBody: jsonBody(objectSchema({ reason: { type: "string" } }, ["reason"]), "Why."),
    responseSchema: ref("FormInstance"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/forms/{instanceId}/signatures",
    summary: "Add a drawn signature (PNG data URL) for a role or a signature item; stored as a project document + attachment role `signature`.",
    operationId: "signFormInstance",
    parameters: [projectIdParam, formInstanceIdParam],
    permissions: modulePermission("inspection", "submit", "inspection.sign"),
    requestBody: jsonBody(ref("FormSignatureRequest"), "Signature."),
    responseSchema: objectSchema({ signature: ref("FormSignature"), instance: ref("FormInstance") }),
    status: 201,
  },
  {
    method: "post",
    path: "/projects/{projectId}/forms/{instanceId}/items/{itemId}/deficiency",
    summary: "Raise a punch item from a deficient answer (activity, location, drawing, company and approver carried over) and link it to the answer. Also needs `punch.create`.",
    operationId: "raiseFormDeficiency",
    parameters: [projectIdParam, formInstanceIdParam, formItemIdParam],
    permissions: modulePermission("inspection", "submit", "inspection.complete"),
    requestBody: jsonBody(ref("FormDeficiencyRequest"), "Punch item fields."),
    responseSchema: objectSchema({ record: ref("PunchItem"), instance: ref("FormInstance") }),
    status: 201,
  },
].forEach((route) => addGenericRoute({ tag: "Inspections & Forms", ...route }));

[
  {
    method: "get",
    path: "/company/form-templates",
    summary: "Company checklist / form template library (reused on every project).",
    operationId: "listCompanyFormTemplates",
    parameters: templateQueryParams,
    permissions: { auth: "bearer", roles: ROLE_IDS, note: "Any authenticated user." },
    responseSchema: ref("FormTemplateListResponse"),
  },
  {
    method: "post",
    path: "/company/form-templates",
    summary: "Create a company template.",
    operationId: "createCompanyFormTemplate",
    permissions: companyAdminPermission,
    requestBody: jsonBody(ref("FormTemplateInput"), "Template."),
    responseSchema: ref("FormTemplate"),
    status: 201,
  },
  {
    method: "post",
    path: "/company/form-templates/starters",
    summary: "Add the starter templates (concrete pour ITP, weekly safety walk, toolbox talk) that are not in the library yet.",
    operationId: "seedCompanyFormTemplates",
    permissions: companyAdminPermission,
    responseSchema: objectSchema({ created: { type: "integer" }, items: arrayOf(ref("FormTemplate")) }),
    status: 201,
  },
  {
    method: "get",
    path: "/company/form-templates/{id}",
    summary: "One company template.",
    operationId: "getCompanyFormTemplate",
    parameters: [formCompanyTemplateIdParam],
    permissions: { auth: "bearer", roles: ROLE_IDS, note: "Any authenticated user." },
    responseSchema: ref("FormTemplate"),
  },
  {
    method: "patch",
    path: "/company/form-templates/{id}",
    summary: "Edit a company template.",
    operationId: "updateCompanyFormTemplate",
    parameters: [formCompanyTemplateIdParam],
    permissions: companyAdminPermission,
    requestBody: jsonBody(ref("FormTemplateInput"), "Fields to change."),
    responseSchema: ref("FormTemplate"),
  },
  {
    method: "delete",
    path: "/company/form-templates/{id}",
    summary: "Archive a company template.",
    operationId: "archiveCompanyFormTemplate",
    parameters: [formCompanyTemplateIdParam],
    permissions: companyAdminPermission,
    responseSchema: objectSchema({ id: uuid, status: { type: "string" } }),
  },
  {
    method: "post",
    path: "/company/form-templates/{id}/duplicate",
    summary: "Copy a template into a project (`targetProjectId`) or, without one, as a new company template.",
    operationId: "duplicateCompanyFormTemplate",
    parameters: [formCompanyTemplateIdParam],
    permissions: companyAdminPermission,
    requestBody: jsonBody(objectSchema({ targetProjectId: nullableUuid, name: { type: "string", nullable: true } }), "Destination."),
    responseSchema: ref("FormTemplate"),
    status: 201,
  },
].forEach((route) => addGenericRoute({ tag: "Inspections & Forms", ...route }));

// ─── Submittal workflow, packages and templates (OCTA-PM-SUB-017) ─────────
const submittalDetailIdParam = pathParam("submittalId", "Submittal UUID.");
const submittalPackageIdParam = pathParam("packageId", "Package UUID.");
const submittalTemplateIdParam = pathParam("templateId", "Workflow template UUID.");
const submittalReadPermission = modulePermission("submittal", "read");
const submittalUpdatePermission = modulePermission("submittal", "update");
const submittalReviewPermission = modulePermission("submittal", "submit", "submittal.review");
const submittalTemplateScopeParams = [
  queryParam("scope", "all (default: project + company), project, or company.", { type: "string", enum: ["all", "project", "company"] }),
  queryParam("includeArchived", "Include archived templates.", { type: "boolean" }),
];
[
  {
    method: "get",
    path: "/projects/{projectId}/submittals/packages",
    summary: "Packages with their items, derived status and counts.",
    operationId: "listSubmittalPackages",
    parameters: [...projectParams, queryParam("status", "Filter by package status.", { type: "string", enum: ["open", "submitted", "closed"] })],
    permissions: submittalReadPermission,
    responseSchema: objectSchema({ items: arrayOf(ref("SubmittalPackage")) }),
  },
  {
    method: "post",
    path: "/projects/{projectId}/submittals/packages",
    summary: "Create a package (PKG-nnn) and optionally add submittals to it. A submittal belongs to one package at most.",
    operationId: "createSubmittalPackage",
    parameters: projectParams,
    permissions: modulePermission("submittal", "create"),
    requestBody: jsonBody(ref("SubmittalPackageRequest"), "Package."),
    responseSchema: ref("SubmittalPackage"),
    status: 201,
  },
  {
    method: "get",
    path: "/projects/{projectId}/submittals/packages/{packageId}",
    summary: "One package.",
    operationId: "getSubmittalPackage",
    parameters: [...projectParams, submittalPackageIdParam],
    permissions: submittalReadPermission,
    responseSchema: ref("SubmittalPackage"),
  },
  {
    method: "patch",
    path: "/projects/{projectId}/submittals/packages/{packageId}",
    summary: "Edit package details.",
    operationId: "updateSubmittalPackage",
    parameters: [...projectParams, submittalPackageIdParam],
    permissions: submittalUpdatePermission,
    requestBody: jsonBody(ref("SubmittalPackageRequest"), "Fields to change."),
    responseSchema: ref("SubmittalPackage"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/submittals/packages/{packageId}/items",
    summary: "Add submittals to the package.",
    operationId: "addSubmittalPackageItems",
    parameters: [...projectParams, submittalPackageIdParam],
    permissions: submittalUpdatePermission,
    requestBody: jsonBody(objectSchema({ submittalIds: arrayOf(uuid) }, ["submittalIds"]), "Submittals to add."),
    responseSchema: ref("SubmittalPackage"),
  },
  {
    method: "delete",
    path: "/projects/{projectId}/submittals/packages/{packageId}/items/{submittalId}",
    summary: "Take a submittal out of the package.",
    operationId: "removeSubmittalPackageItem",
    parameters: [...projectParams, submittalPackageIdParam, submittalDetailIdParam],
    permissions: submittalUpdatePermission,
    responseSchema: ref("SubmittalPackage"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/submittals/packages/{packageId}/submit",
    summary: "Send every pending / returned item in the package for review in one go. Items without revision evidence are reported, not submitted.",
    operationId: "submitSubmittalPackage",
    parameters: [...projectParams, submittalPackageIdParam],
    permissions: modulePermission("submittal", "submit", "submittal.submit"),
    requestBody: jsonBody(objectSchema({ comment: { type: "string", nullable: true } }), "Optional note recorded on each item."),
    responseSchema: ref("SubmittalPackageActionResult"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/submittals/packages/{packageId}/decide",
    summary: "Apply one decision to every item under review whose active step is waiting on the caller.",
    operationId: "decideSubmittalPackage",
    parameters: [...projectParams, submittalPackageIdParam],
    permissions: submittalReviewPermission,
    requestBody: jsonBody(ref("SubmittalDecisionRequest"), "Decision."),
    responseSchema: ref("SubmittalPackageActionResult"),
  },
  {
    method: "get",
    path: "/projects/{projectId}/submittals/workflow-templates",
    summary: "Review workflows available to the project (project-scoped plus the company library).",
    operationId: "listSubmittalWorkflowTemplates",
    parameters: [...projectParams, ...submittalTemplateScopeParams],
    permissions: submittalReadPermission,
    responseSchema: objectSchema({ items: arrayOf(ref("SubmittalWorkflowTemplate")) }),
  },
  {
    method: "post",
    path: "/projects/{projectId}/submittals/workflow-templates",
    summary: "Create a project-scoped review workflow.",
    operationId: "createSubmittalWorkflowTemplate",
    parameters: projectParams,
    permissions: submittalUpdatePermission,
    requestBody: jsonBody(ref("SubmittalWorkflowTemplateRequest"), "Workflow."),
    responseSchema: ref("SubmittalWorkflowTemplate"),
    status: 201,
  },
  {
    method: "patch",
    path: "/projects/{projectId}/submittals/workflow-templates/{templateId}",
    summary: "Edit a project-scoped workflow (company workflows are edited from the company workspace).",
    operationId: "updateSubmittalWorkflowTemplate",
    parameters: [...projectParams, submittalTemplateIdParam],
    permissions: submittalUpdatePermission,
    requestBody: jsonBody(ref("SubmittalWorkflowTemplateRequest"), "Fields to change."),
    responseSchema: ref("SubmittalWorkflowTemplate"),
  },
  {
    method: "delete",
    path: "/projects/{projectId}/submittals/workflow-templates/{templateId}",
    summary: "Archive a project-scoped workflow.",
    operationId: "archiveSubmittalWorkflowTemplate",
    parameters: [...projectParams, submittalTemplateIdParam],
    permissions: submittalUpdatePermission,
    responseSchema: ref("SubmittalWorkflowTemplate"),
  },
  {
    method: "get",
    path: "/projects/{projectId}/submittals/{submittalId}",
    summary: "Submittal detail with review steps per revision, active step, package, workflow, manager, distribution, submit-by and late flags.",
    operationId: "getSubmittalDetail",
    parameters: [...projectParams, submittalDetailIdParam],
    permissions: submittalReadPermission,
    responseSchema: ref("SubmittalDetail"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/submittals/{submittalId}/decide",
    summary: "Decide on the active review step. Parallel steps need every reviewer; the first rejection returns the submittal with the response code. The PM may decide on a step they are not assigned to.",
    operationId: "decideSubmittalStep",
    parameters: [...projectParams, submittalDetailIdParam],
    permissions: submittalReviewPermission,
    requestBody: jsonBody(ref("SubmittalDecisionRequest"), "Decision."),
    responseSchema: ref("SubmittalDetail"),
  },
  {
    method: "put",
    path: "/projects/{projectId}/submittals/{submittalId}/people",
    summary: "Set the submittal manager and distribution list.",
    operationId: "updateSubmittalPeople",
    parameters: [...projectParams, submittalDetailIdParam],
    permissions: submittalUpdatePermission,
    requestBody: jsonBody(ref("SubmittalPeopleRequest"), "People."),
    responseSchema: ref("SubmittalDetail"),
  },
].forEach((route) => addGenericRoute({ tag: "Document Control", ...route }));

const companySubmittalTemplateIdParam = pathParam("id", "Company workflow template UUID.");
[
  {
    method: "get",
    path: "/company/submittal-workflow-templates",
    summary: "Company library of submittal review workflows.",
    operationId: "listCompanySubmittalWorkflowTemplates",
    parameters: [queryParam("includeArchived", "Include archived templates.", { type: "boolean" })],
    permissions: { auth: "bearer", roles: ROLE_IDS, note: "Any authenticated user." },
    responseSchema: objectSchema({ items: arrayOf(ref("SubmittalWorkflowTemplate")) }),
  },
  {
    method: "post",
    path: "/company/submittal-workflow-templates",
    summary: "Create a company workflow.",
    operationId: "createCompanySubmittalWorkflowTemplate",
    permissions: companyAdminPermission,
    requestBody: jsonBody(ref("SubmittalWorkflowTemplateRequest"), "Workflow."),
    responseSchema: ref("SubmittalWorkflowTemplate"),
    status: 201,
  },
  {
    method: "post",
    path: "/company/submittal-workflow-templates/starters",
    summary: "Add the starter workflows (contractor check then consultant review; parallel consultant and planning review) not yet in the library.",
    operationId: "seedCompanySubmittalWorkflowTemplates",
    permissions: companyAdminPermission,
    responseSchema: objectSchema({ created: { type: "integer" }, items: arrayOf(ref("SubmittalWorkflowTemplate")) }),
    status: 201,
  },
  {
    method: "patch",
    path: "/company/submittal-workflow-templates/{id}",
    summary: "Edit a company workflow.",
    operationId: "updateCompanySubmittalWorkflowTemplate",
    parameters: [companySubmittalTemplateIdParam],
    permissions: companyAdminPermission,
    requestBody: jsonBody(ref("SubmittalWorkflowTemplateRequest"), "Fields to change."),
    responseSchema: ref("SubmittalWorkflowTemplate"),
  },
  {
    method: "delete",
    path: "/company/submittal-workflow-templates/{id}",
    summary: "Archive a company workflow.",
    operationId: "archiveCompanySubmittalWorkflowTemplate",
    parameters: [companySubmittalTemplateIdParam],
    permissions: companyAdminPermission,
    responseSchema: ref("SubmittalWorkflowTemplate"),
  },
].forEach((route) => addGenericRoute({ tag: "Company Workspace", ...route }));

// ─── Budget by cost code (OCTA-FIN-COSTCODE-019) ──────────────────────────
const budgetLineIdParam = pathParam("lineId", "Budget line UUID.");
const budgetCostTypes = ["labour", "material", "equipment", "subcontract", "indirect", "overhead", "contingency", "other"];
const budgetMoney = { type: "number", description: "Money, 2 decimals." };
const budgetAllocationSchema = objectSchema({
  id: uuid,
  activityId: uuid,
  activity: nullableRef("GenericObject"),
  weight: { type: "number", description: "Share of the line, 0–100." },
  amount: budgetMoney,
  source: { type: "string", enum: ["manual", "boq", "even"] },
});
const budgetLineSchema = objectSchema({
  id: uuid,
  projectId: uuid,
  costCodeId: uuid,
  costCode: nullableRef("GenericObject"),
  costType: { type: "string", enum: budgetCostTypes },
  description: { type: "string", nullable: true },
  status: { type: "string", enum: ["active", "archived"] },
  sortOrder: { type: "integer" },
  originalBudget: budgetMoney,
  approvedChanges: { ...budgetMoney, description: "Σ approved change orders on the line." },
  revisions: { ...budgetMoney, description: "Σ revisions and transfers." },
  revisedBudget: { ...budgetMoney, description: "original + approvedChanges + revisions." },
  committed: budgetMoney,
  actual: budgetMoney,
  forecast: { ...budgetMoney, description: "Manual forecast, else max(revised, actual, committed)." },
  forecastIsManual: { type: "boolean" },
  variance: { ...budgetMoney, description: "revised − forecast." },
  allocatedWeight: { type: "number" },
  allocatedAmount: budgetMoney,
  unallocatedAmount: budgetMoney,
  allocations: arrayOf(budgetAllocationSchema),
  changes: arrayOf(objectSchema({ id: uuid, kind: { type: "string", enum: ["change_order", "revision", "transfer_in", "transfer_out"] }, amount: budgetMoney, changeOrderId: nullableUuid, counterpartLineId: nullableUuid, note: { type: "string", nullable: true }, createdAt: nullableDateString })),
  createdAt: nullableDateString,
  updatedAt: nullableDateString,
});
const budgetTotalsSchema = objectSchema({
  originalBudget: budgetMoney,
  approvedChanges: budgetMoney,
  revisions: budgetMoney,
  revisedBudget: budgetMoney,
  committed: budgetMoney,
  actual: budgetMoney,
  forecast: budgetMoney,
  variance: budgetMoney,
  allocatedAmount: budgetMoney,
  unallocatedAmount: budgetMoney,
});
const budgetLinesResponse = objectSchema({
  items: arrayOf(budgetLineSchema),
  summary: objectSchema({ totals: budgetTotalsSchema, byType: arrayOf(ref("GenericObject")), lines: { type: "integer" }, underAllocated: { type: "integer" } }),
});
const budgetLineRequest = objectSchema({
  costCodeId: uuid,
  costType: { type: "string", enum: budgetCostTypes },
  description: { type: "string", nullable: true, maxLength: 500 },
  originalBudget: budgetMoney,
  committed: budgetMoney,
  actual: budgetMoney,
  forecast: { ...budgetMoney, nullable: true },
  sortOrder: { type: "integer" },
  status: { type: "string", enum: ["active", "archived"] },
});
const budgetReconciliationSchema = objectSchema({
  generatedAt: dateString,
  balanced: { type: "boolean", description: "Σ activity budgets = Σ budget lines and every activity matches its line allocations (±0.01)." },
  totals: objectSchema({ activityBudget: budgetMoney, budgetLines: budgetMoney, allocatedToActivities: budgetMoney, unallocatedLines: budgetMoney, difference: budgetMoney }),
  activities: arrayOf(objectSchema({ activityId: uuid, name: { type: "string" }, code: { type: "string", nullable: true }, boqBudget: budgetMoney, approvedChanges: budgetMoney, activityBudget: budgetMoney, budgetFromLines: budgetMoney, difference: budgetMoney })),
  mismatches: arrayOf(ref("GenericObject")),
  underAllocatedLines: arrayOf(ref("GenericObject")),
  activitiesWithoutLines: arrayOf(ref("GenericObject")),
});
const budgetSnapshotSchema = objectSchema({
  id: uuid,
  projectId: uuid,
  reportingPeriodId: nullableUuid,
  reportingPeriod: nullableRef("GenericObject"),
  label: { type: "string" },
  takenBy: nullableUuid,
  takenAt: nullableDateString,
  totals: ref("GenericObject"),
  reconciliation: ref("GenericObject"),
  lineCount: { type: "integer" },
  lines: arrayOf(budgetLineSchema),
});
const budgetSnapshotIdParam = pathParam("snapshotId", "Snapshot UUID.");
const budgetChangeOrderIdParam = pathParam("changeOrderId", "Change order UUID.");
[
  {
    method: "get",
    path: "/projects/{projectId}/budget/cost-codes",
    summary: "Cost codes the project budgets against, plus the organisation's library with a `selected` flag.",
    operationId: "listProjectCostCodes",
    parameters: [...projectParams, queryParam("includeArchived", "Include codes removed from the project.", { type: "boolean" })],
    permissions: modulePermission("cost", "read"),
    responseSchema: objectSchema({ items: arrayOf(ref("GenericObject")), available: arrayOf(ref("GenericObject")) }),
  },
  {
    method: "put",
    path: "/projects/{projectId}/budget/cost-codes",
    summary: "Select org cost codes for the project (`importAll` copies the library); codes with active lines cannot be removed.",
    operationId: "selectProjectCostCodes",
    parameters: projectParams,
    permissions: modulePermission("cost", "update"),
    requestBody: jsonBody(objectSchema({ costCodeIds: arrayOf(uuid), removeCostCodeIds: arrayOf(uuid), importAll: { type: "boolean" } }), "Selection."),
    responseSchema: objectSchema({ items: arrayOf(ref("GenericObject")), available: arrayOf(ref("GenericObject")) }),
  },
  {
    method: "get",
    path: "/projects/{projectId}/budget/lines",
    summary: "Budget lines (cost code × cost type) with derived revised budget, variance, allocations and ledger, plus totals by cost type.",
    operationId: "listBudgetLines",
    parameters: [
      ...projectParams,
      queryParam("includeArchived", "Include archived lines.", { type: "boolean" }),
      queryParam("costType", "Filter by cost type.", { type: "string", enum: budgetCostTypes }),
      queryParam("costCodeId", "Filter by cost code.", uuid),
      queryParam("search", "Code, name or description.", { type: "string" }),
    ],
    permissions: modulePermission("cost", "read"),
    responseSchema: budgetLinesResponse,
  },
  {
    method: "post",
    path: "/projects/{projectId}/budget/lines",
    summary: "Create a budget line (selects the cost code for the project when needed). One line per cost code and cost type.",
    operationId: "createBudgetLine",
    parameters: projectParams,
    permissions: modulePermission("cost", "create"),
    requestBody: jsonBody(budgetLineRequest, "Line."),
    responseSchema: budgetLineSchema,
    status: 201,
  },
  {
    method: "post",
    path: "/projects/{projectId}/budget/lines/import",
    summary: "Import lines as rows of { code, name?, costType, originalBudget, description }. Unknown codes with a name are created in the organisation; existing lines are updated.",
    operationId: "importBudgetLines",
    parameters: projectParams,
    permissions: modulePermission("cost", "create"),
    requestBody: jsonBody(objectSchema({ rows: arrayOf(objectSchema({ code: { type: "string" }, name: { type: "string", nullable: true }, costType: { type: "string", enum: budgetCostTypes }, originalBudget: budgetMoney, description: { type: "string", nullable: true } })) }, ["rows"]), "Rows."),
    responseSchema: objectSchema({ created: { type: "integer" }, updated: { type: "integer" }, missingCodes: arrayOf({ type: "string" }) }),
    status: 201,
  },
  {
    method: "post",
    path: "/projects/{projectId}/budget/transfers",
    summary: "Move budget between two lines (ledger rows transfer_out / transfer_in).",
    operationId: "transferBudget",
    parameters: projectParams,
    permissions: modulePermission("cost", "approve"),
    requestBody: jsonBody(objectSchema({ fromLineId: uuid, toLineId: uuid, amount: budgetMoney, note: { type: "string", nullable: true } }, ["fromLineId", "toLineId", "amount"]), "Transfer."),
    responseSchema: budgetLinesResponse,
  },
  {
    method: "get",
    path: "/projects/{projectId}/budget/reconciliation",
    summary: "Σ activity budgets (approved BOQ allocations + approved change-order impacts) against Σ budget lines and their activity allocations.",
    operationId: "getBudgetReconciliation",
    parameters: projectParams,
    permissions: modulePermission("cost", "read"),
    responseSchema: budgetReconciliationSchema,
  },
  {
    method: "get",
    path: "/projects/{projectId}/budget/snapshots",
    summary: "Budget snapshots, newest first.",
    operationId: "listBudgetSnapshots",
    parameters: projectParams,
    permissions: modulePermission("cost", "read"),
    responseSchema: objectSchema({ items: arrayOf(budgetSnapshotSchema) }),
  },
  {
    method: "post",
    path: "/projects/{projectId}/budget/snapshots",
    summary: "Freeze the budget (lines, allocations, reconciliation); with `reportingPeriodId` it is the period's one snapshot. Locking a period takes one automatically.",
    operationId: "createBudgetSnapshot",
    parameters: projectParams,
    permissions: modulePermission("cost", "approve"),
    requestBody: jsonBody(objectSchema({ label: { type: "string", nullable: true }, reportingPeriodId: nullableUuid }), "Snapshot."),
    responseSchema: budgetSnapshotSchema,
    status: 201,
  },
  {
    method: "get",
    path: "/projects/{projectId}/budget/snapshots/{snapshotId}",
    summary: "One snapshot with its frozen lines.",
    operationId: "getBudgetSnapshot",
    parameters: [...projectParams, budgetSnapshotIdParam],
    permissions: modulePermission("cost", "read"),
    responseSchema: budgetSnapshotSchema,
  },
  {
    method: "put",
    path: "/projects/{projectId}/budget/change-orders/{changeOrderId}/line",
    summary: "Point a change order at a budget line; an approved order is re-applied to the ledger.",
    operationId: "setChangeOrderBudgetLine",
    parameters: [...projectParams, budgetChangeOrderIdParam],
    permissions: modulePermission("cost", "update"),
    requestBody: jsonBody(objectSchema({ lineId: nullableUuid }), "Target line (null clears it)."),
    responseSchema: objectSchema({ changeOrderId: uuid, budgetLineId: nullableUuid, applied: nullableRef("GenericObject") }),
  },
  {
    method: "get",
    path: "/projects/{projectId}/budget/lines/{lineId}",
    summary: "One budget line.",
    operationId: "getBudgetLine",
    parameters: [...projectParams, budgetLineIdParam],
    permissions: modulePermission("cost", "read"),
    responseSchema: budgetLineSchema,
  },
  {
    method: "patch",
    path: "/projects/{projectId}/budget/lines/{lineId}",
    summary: "Edit a line (original budget, committed, actual, forecast, description, cost type, status). Allocation amounts follow the revised budget.",
    operationId: "updateBudgetLine",
    parameters: [...projectParams, budgetLineIdParam],
    permissions: modulePermission("cost", "update"),
    requestBody: jsonBody(budgetLineRequest, "Fields to change.", false),
    responseSchema: budgetLineSchema,
  },
  {
    method: "delete",
    path: "/projects/{projectId}/budget/lines/{lineId}",
    summary: "Archive a line.",
    operationId: "archiveBudgetLine",
    parameters: [...projectParams, budgetLineIdParam],
    permissions: modulePermission("cost", "delete"),
    responseSchema: budgetLineSchema,
  },
  {
    method: "put",
    path: "/projects/{projectId}/budget/lines/{lineId}/allocations",
    summary: "Replace the line's activity allocations (weights in %, at most 100 in total).",
    operationId: "setBudgetLineAllocations",
    parameters: [...projectParams, budgetLineIdParam],
    permissions: modulePermission("cost", "update"),
    requestBody: jsonBody(objectSchema({ allocations: arrayOf(objectSchema({ activityId: uuid, weight: { type: "number" }, source: { type: "string", enum: ["manual", "boq", "even"] } })) }, ["allocations"]), "Allocations."),
    responseSchema: budgetLineSchema,
  },
  {
    method: "get",
    path: "/projects/{projectId}/budget/lines/{lineId}/allocations/suggest",
    summary: "Suggested weights from approved BOQ allocations (items whose code starts with the cost code; else every allocated activity by approved budget).",
    operationId: "suggestBudgetLineAllocations",
    parameters: [...projectParams, budgetLineIdParam],
    permissions: modulePermission("cost", "read"),
    responseSchema: objectSchema({ lineId: uuid, basis: { type: "string", enum: ["boq", "even"] }, items: arrayOf(objectSchema({ activityId: uuid, activity: nullableRef("GenericObject"), basisAmount: budgetMoney, weight: { type: "number" }, source: { type: "string" } })) }),
  },
  {
    method: "post",
    path: "/projects/{projectId}/budget/lines/{lineId}/revisions",
    summary: "Add a signed revision to a line with a reason.",
    operationId: "addBudgetLineRevision",
    parameters: [...projectParams, budgetLineIdParam],
    permissions: modulePermission("cost", "approve"),
    requestBody: jsonBody(objectSchema({ amount: budgetMoney, note: { type: "string" } }, ["amount", "note"]), "Revision."),
    responseSchema: budgetLineSchema,
    status: 201,
  },
].forEach((route) => addGenericRoute({ tag: "Cost Control", ...route }));

// ─── Commitments (OCTA-FIN-COMMIT-020) ────────────────────────────────────
const commitmentIdParam = pathParam("commitmentId", "Commitment UUID.");
const commitmentCoIdParam = pathParam("changeOrderId", "Commitment change order UUID.");
const commitmentTypes = ["subcontract", "purchase_order"];
const commitmentStatuses = ["draft", "pending", "approved", "executed", "closed", "void"];
const commitmentLineInput = objectSchema({
  lineNumber: { type: "integer" },
  description: { type: "string" },
  costCodeId: nullableUuid,
  budgetLineId: nullableUuid,
  boqItemId: nullableUuid,
  activityId: nullableUuid,
  unit: { type: "string", nullable: true },
  qty: { type: "number" },
  rate: { type: "number", nullable: true },
  amount: { type: "number", nullable: true, description: "Overrides qty × rate when given." },
  notes: { type: "string", nullable: true },
});
const commitmentInsuranceInput = objectSchema({
  type: { type: "string", enum: ["general_liability", "workers_compensation", "auto", "umbrella", "professional", "builders_risk", "bond", "other"] },
  label: { type: "string", nullable: true },
  required: { type: "boolean" },
  documentId: nullableUuid,
  expiresAt: nullableDateString,
  note: { type: "string", nullable: true },
});
const commitmentSchema = objectSchema({
  id: uuid,
  projectId: uuid,
  number: { type: "integer" },
  ref: { type: "string", example: "SC-001" },
  type: { type: "string", enum: commitmentTypes },
  title: { type: "string" },
  description: { type: "string", nullable: true },
  status: { type: "string", enum: commitmentStatuses },
  currency: { type: "string" },
  vendorCompanyId: nullableUuid,
  vendor: nullableRef("GenericObject"),
  projectPartyId: nullableUuid,
  supplierId: nullableUuid,
  retentionRate: { type: "number" },
  paymentTerms: { type: "string", nullable: true },
  startDate: nullableDateString,
  endDate: nullableDateString,
  insurance: arrayOf(objectSchema({ type: { type: "string" }, label: { type: "string", nullable: true }, required: { type: "boolean" }, documentId: nullableUuid, expiresAt: nullableDateString, status: { type: "string", enum: ["ok", "missing", "expired", "optional"] } })),
  insuranceReady: { type: "boolean" },
  executedDocument: nullableRef("GenericObject"),
  executedAt: nullableDateString,
  submittedAt: nullableDateString,
  approvedAt: nullableDateString,
  closedAt: nullableDateString,
  original: { type: "number", description: "Σ schedule-of-values lines." },
  approvedChanges: { type: "number" },
  pendingChanges: { type: "number" },
  revised: { type: "number", description: "original + approved change orders." },
  retentionOnRevised: { type: "number" },
  drawnDown: { type: "number", description: "Σ linked procurement orders." },
  lines: arrayOf(ref("GenericObject")),
  changeOrders: arrayOf(ref("GenericObject")),
  procurementOrders: arrayOf(ref("GenericObject")),
  path: { type: "string" },
});
const commitmentRequest = objectSchema({
  type: { type: "string", enum: commitmentTypes },
  title: { type: "string" },
  description: { type: "string", nullable: true },
  vendorCompanyId: nullableUuid,
  supplierId: nullableUuid,
  retentionRate: { type: "number", nullable: true },
  paymentTerms: { type: "string", nullable: true },
  currency: { type: "string", nullable: true },
  startDate: nullableDateString,
  endDate: nullableDateString,
  notes: { type: "string", nullable: true },
  insurance: arrayOf(commitmentInsuranceInput),
  lines: arrayOf(commitmentLineInput),
});
const commitmentCoSchema = objectSchema({
  id: uuid,
  commitmentId: uuid,
  number: { type: "integer" },
  ref: { type: "string", example: "SC-001-CO01" },
  title: { type: "string" },
  status: { type: "string", enum: ["draft", "pending", "approved", "rejected", "void"] },
  value: { type: "number" },
  primeChangeOrderId: nullableUuid,
  lines: arrayOf(ref("GenericObject")),
});
const commitmentCoRequest = objectSchema({
  title: { type: "string" },
  description: { type: "string", nullable: true },
  value: { type: "number", nullable: true, description: "Used when no lines are given." },
  primeChangeOrderId: nullableUuid,
  lines: arrayOf(objectSchema({ description: { type: "string" }, costCodeId: nullableUuid, budgetLineId: nullableUuid, activityId: nullableUuid, amount: { type: "number" } })),
});
const reasonBody = jsonBody(objectSchema({ reason: { type: "string" } }), "Reason.", false);
const commitmentPermission = (action, transition = null) => modulePermission("commitment", action, transition);
[
  { method: "get", path: "/projects/{projectId}/commitments", summary: "Commitments with derived values; subcontractor party users see only their company's.", operationId: "listCommitments", parameters: [...projectParams, queryParam("type", "Filter by type.", { type: "string", enum: commitmentTypes }), queryParam("status", "Filter by status.", { type: "string", enum: commitmentStatuses }), queryParam("vendorCompanyId", "Filter by vendor.", uuid), queryParam("search", "Ref, title or vendor.", { type: "string" }), queryParam("includeVoid", "Include void commitments.", { type: "boolean" })], permissions: commitmentPermission("read"), responseSchema: objectSchema({ items: arrayOf(commitmentSchema), summary: ref("GenericObject") }) },
  { method: "post", path: "/projects/{projectId}/commitments", summary: "Create a draft commitment (SC-nnn subcontract or PC-nnn purchase-order commitment) with its schedule of values.", operationId: "createCommitment", parameters: projectParams, permissions: commitmentPermission("create"), requestBody: jsonBody(commitmentRequest, "Commitment."), responseSchema: commitmentSchema, status: 201 },
  { method: "post", path: "/projects/{projectId}/commitments/change-orders/from-prime", summary: "A prime change order spawns draft change orders on the chosen commitments.", operationId: "spawnCommitmentChangeOrders", parameters: projectParams, permissions: commitmentPermission("create"), requestBody: jsonBody(objectSchema({ primeChangeOrderId: uuid, items: arrayOf(objectSchema({ commitmentId: uuid, title: { type: "string", nullable: true }, value: { type: "number", nullable: true }, lines: arrayOf(ref("GenericObject")) })) }, ["primeChangeOrderId", "items"]), "Targets."), responseSchema: objectSchema({ primeChangeOrder: ref("GenericObject"), items: arrayOf(commitmentCoSchema) }), status: 201 },
  { method: "patch", path: "/projects/{projectId}/commitments/change-orders/{changeOrderId}", summary: "Edit a draft or pending commitment change order.", operationId: "updateCommitmentChangeOrder", parameters: [...projectParams, commitmentCoIdParam], permissions: commitmentPermission("update"), requestBody: jsonBody(commitmentCoRequest, "Fields to change.", false), responseSchema: commitmentCoSchema },
  { method: "post", path: "/projects/{projectId}/commitments/change-orders/{changeOrderId}/submit", summary: "Submit a commitment change order.", operationId: "submitCommitmentChangeOrder", parameters: [...projectParams, commitmentCoIdParam], permissions: commitmentPermission("submit", "commitment_co.submit"), responseSchema: commitmentCoSchema },
  { method: "post", path: "/projects/{projectId}/commitments/change-orders/{changeOrderId}/approve", summary: "Approve a commitment change order; on an executed commitment the value posts to committed cost.", operationId: "approveCommitmentChangeOrder", parameters: [...projectParams, commitmentCoIdParam], permissions: commitmentPermission("approve", "commitment_co.approve"), responseSchema: commitmentCoSchema },
  { method: "post", path: "/projects/{projectId}/commitments/change-orders/{changeOrderId}/reject", summary: "Reject a commitment change order with a reason.", operationId: "rejectCommitmentChangeOrder", parameters: [...projectParams, commitmentCoIdParam], permissions: commitmentPermission("approve", "commitment_co.approve"), requestBody: reasonBody, responseSchema: commitmentCoSchema },
  { method: "post", path: "/projects/{projectId}/commitments/change-orders/{changeOrderId}/void", summary: "Void a draft or pending commitment change order.", operationId: "voidCommitmentChangeOrder", parameters: [...projectParams, commitmentCoIdParam], permissions: commitmentPermission("update"), requestBody: reasonBody, responseSchema: commitmentCoSchema },
  { method: "get", path: "/projects/{projectId}/commitments/{commitmentId}", summary: "One commitment with lines, change orders, insurance and linked purchase orders.", operationId: "getCommitment", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("read"), responseSchema: commitmentSchema },
  { method: "patch", path: "/projects/{projectId}/commitments/{commitmentId}", summary: "Edit a commitment; title, retention and currency lock once approved.", operationId: "updateCommitment", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("update"), requestBody: jsonBody(commitmentRequest, "Fields to change.", false), responseSchema: commitmentSchema },
  { method: "delete", path: "/projects/{projectId}/commitments/{commitmentId}", summary: "Void a commitment that is not yet executed.", operationId: "voidCommitment", parameters: [...projectParams, commitmentIdParam, queryParam("reason", "Reason.", { type: "string" })], permissions: commitmentPermission("delete", "commitment.void"), responseSchema: commitmentSchema },
  { method: "put", path: "/projects/{projectId}/commitments/{commitmentId}/lines", summary: "Replace the schedule of values (draft / pending only).", operationId: "replaceCommitmentLines", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("update"), requestBody: jsonBody(objectSchema({ lines: arrayOf(commitmentLineInput) }, ["lines"]), "Lines."), responseSchema: commitmentSchema },
  { method: "put", path: "/projects/{projectId}/commitments/{commitmentId}/insurance", summary: "Set insurance requirements (document + expiry per cover).", operationId: "setCommitmentInsurance", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("update"), requestBody: jsonBody(objectSchema({ insurance: arrayOf(commitmentInsuranceInput) }, ["insurance"]), "Requirements."), responseSchema: commitmentSchema },
  { method: "post", path: "/projects/{projectId}/commitments/{commitmentId}/submit", summary: "Submit for approval (needs lines and a vendor).", operationId: "submitCommitment", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("submit", "commitment.submit"), responseSchema: commitmentSchema },
  { method: "post", path: "/projects/{projectId}/commitments/{commitmentId}/approve", summary: "Approve a pending commitment.", operationId: "approveCommitment", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("approve", "commitment.approve"), responseSchema: commitmentSchema },
  { method: "post", path: "/projects/{projectId}/commitments/{commitmentId}/return", summary: "Return a pending or approved commitment to draft with a reason.", operationId: "returnCommitment", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("approve", "commitment.approve"), requestBody: jsonBody(objectSchema({ reason: { type: "string" } }, ["reason"]), "Reason."), responseSchema: commitmentSchema },
  { method: "post", path: "/projects/{projectId}/commitments/{commitmentId}/execute", summary: "Execute an approved commitment: attach the signed agreement (`file` upload or `documentId`); required insurance must be present and unexpired unless a PM overrides with a reason. Posts committed cost to budget lines and activities.", operationId: "executeCommitment", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("approve", "commitment.execute"), requestBody: fileUploadBody({ fieldName: "file", multiple: false, required: [], description: "Multipart form; `file` may be omitted when `documentId` names an existing document.", accepted: "PDF, Word, Excel, images, text (max 25 MB).", extraProperties: { documentId: { type: "string", format: "uuid" }, override: { type: "boolean" }, overrideReason: { type: "string" } } }), responseSchema: commitmentSchema },
  { method: "post", path: "/projects/{projectId}/commitments/{commitmentId}/close", summary: "Close an executed commitment.", operationId: "closeCommitment", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("approve", "commitment.close"), responseSchema: commitmentSchema },
  { method: "get", path: "/projects/{projectId}/commitments/{commitmentId}/change-orders", summary: "Change orders of a commitment.", operationId: "listCommitmentChangeOrders", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("read"), responseSchema: objectSchema({ items: arrayOf(commitmentCoSchema) }) },
  { method: "post", path: "/projects/{projectId}/commitments/{commitmentId}/change-orders", summary: "Create a draft change order on a commitment (optionally linked to a prime change order).", operationId: "createCommitmentChangeOrder", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("create"), requestBody: jsonBody(commitmentCoRequest, "Change order."), responseSchema: commitmentCoSchema, status: 201 },
  { method: "get", path: "/projects/{projectId}/commitments/{commitmentId}/export.pdf", summary: "Commitment statement PDF (values, schedule of values, change orders, insurance).", operationId: "exportCommitmentPdf", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("export"), responseSchema: { type: "string", format: "binary" } },
  // Scope and responsibility (OCTA-SUB-SCOPE-054).
  { method: "get", path: "/projects/{projectId}/commitments/{commitmentId}/scope", summary: "The scope and responsibility matrix, created on first read and seeded with the rows that cause arguments — crane, cleanup, waste, inspection requests — left unallocated so the questions are asked rather than assumed.", operationId: "getCommitmentScope", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("read") },
  { method: "put", path: "/projects/{projectId}/commitments/{commitmentId}/scope", summary: "Replace the matrix rows. The whole list is sent, so a row removed on screen is removed here. Refused once the matrix is agreed (409 SCOPE_MATRIX_AGREED).", operationId: "updateCommitmentScope", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("update", "scope.manage"), requestBody: jsonBody(objectSchema({ title: { type: "string" }, notes: { type: "string", nullable: true }, items: arrayOf(objectSchema({ kind: { type: "string", enum: ["scope", "responsibility", "inclusion", "exclusion", "clarification", "interface"] }, section: { type: "string", nullable: true }, description: { type: "string" }, responsibility: { type: "string", nullable: true, enum: ["gc", "subcontractor", "by_others", "shared", "not_applicable", null] }, notes: { type: "string", nullable: true }, sortOrder: { type: "integer" } }, ["description"])) }, ["items"]), "The full list of rows.") },
  { method: "post", path: "/projects/{projectId}/commitments/{commitmentId}/scope/agree", summary: "Agree the matrix. Refused while any scope or responsibility row has nobody against it (409 SCOPE_MATRIX_INCOMPLETE), and the rows are named in the error.", operationId: "agreeCommitmentScope", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("approve", "scope.agree") },
  { method: "post", path: "/projects/{projectId}/commitments/{commitmentId}/scope/reopen", summary: "Reopen an agreed matrix with a reason, because the signed contract quotes it.", operationId: "reopenCommitmentScope", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("approve", "scope.agree"), requestBody: jsonBody(objectSchema({ reason: { type: "string" } }, ["reason"]), "Why the agreed scope is being reopened.") },
  // The subcontract agreement (OCTA-SUB-DOC-055).
  { method: "get", path: "/projects/{projectId}/commitments/{commitmentId}/agreement", summary: "Everything the subcontract agreement will say, assembled from the company, the vendor profile, the project, the schedule of values, the scope matrix, the programme and the insurance requirements — plus a named list of what is still missing before it should be signed.", operationId: "getSubcontractAgreement", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("read") },
  { method: "get", path: "/projects/{projectId}/commitments/{commitmentId}/agreement.pdf", summary: "The subcontract agreement as a PDF for review and signature. An agreement with outstanding gaps is stamped DRAFT — not for signature, and lists them on its face.", operationId: "exportSubcontractAgreementPdf", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("export"), responseSchema: { type: "string", format: "binary" } },
].forEach((route) => addGenericRoute({ tag: "Commercial", ...route }));

// ─── Configurable workflow engine (OCTA-PLAT-WF-024) ───────────────────────
const workflowTemplateIdParam = pathParam("templateId", "Workflow template UUID.");
const workflowInstanceIdParam = pathParam("instanceId", "Workflow instance UUID.");
const workflowTools = ["change_order", "commitment", "sub_pay_app", "ipc_certificate", "budget_revision", "submittal", "correspondence", "document_revision"];
const workflowAssigneeSchema = objectSchema({ type: { type: "string", enum: ["user", "role", "party_role", "permission_template"] }, userId: nullableUuid, role: { type: "string", nullable: true }, templateId: nullableUuid });
const workflowConditionSchema = objectSchema({ field: { type: "string" }, op: { type: "string", enum: ["eq", "neq", "gt", "gte", "lt", "lte", "in", "nin", "contains", "is_true", "is_false", "empty", "not_empty"] }, value: { description: "Compared with the record context (amount, type…)." } });
const workflowStepSchema = objectSchema({
  key: { type: "string" },
  name: { type: "string" },
  type: { type: "string", enum: ["response", "condition", "action"] },
  description: { type: "string", nullable: true },
  assignees: arrayOf(workflowAssigneeSchema),
  requireAll: { type: "boolean", description: "Every assignee must give a positive response; one negative response ends the step." },
  days: { type: "integer", nullable: true, description: "SLA; escalation after this many days." },
  escalateRoles: arrayOf({ type: "string" }),
  responses: arrayOf(objectSchema({ key: { type: "string" }, label: { type: "string" }, next: { type: "string", description: "A step key, end_success or end_fail." }, tone: { type: "string", enum: ["positive", "negative", "neutral"] }, requireComment: { type: "boolean" } })),
  condition: { ...workflowConditionSchema, nullable: true },
  whenTrue: { type: "string", nullable: true },
  whenFalse: { type: "string", nullable: true },
  action: objectSchema({ type: { type: "string", enum: ["notify"] }, roles: arrayOf({ type: "string" }), userIds: arrayOf(uuid), message: { type: "string", nullable: true } }),
  next: { type: "string", nullable: true },
});
const workflowTemplateInput = objectSchema({
  tool: { type: "string", enum: workflowTools },
  name: { type: "string" },
  description: { type: "string", nullable: true },
  isDefault: { type: "boolean", description: "Used when no rule-bearing template matches." },
  priority: { type: "integer" },
  status: { type: "string", enum: ["active", "archived"] },
  rules: arrayOf(workflowConditionSchema),
  steps: arrayOf(workflowStepSchema),
  startStep: { type: "string", nullable: true },
});
const workflowTemplateSchema = objectSchema({ id: uuid, projectId: nullableUuid, scope: { type: "string", enum: ["company", "project"] }, tool: { type: "string" }, toolLabel: { type: "string" }, name: { type: "string" }, description: { type: "string", nullable: true }, isDefault: { type: "boolean" }, priority: { type: "integer" }, status: { type: "string" }, rules: arrayOf(workflowConditionSchema), steps: arrayOf(workflowStepSchema), startStep: { type: "string", nullable: true }, isSystem: { type: "boolean" }, instanceCount: { type: "integer", nullable: true }, createdBy: nullableUuid, createdAt: nullableDateString, updatedAt: nullableDateString });
const workflowInstanceSchema = objectSchema({
  id: uuid,
  projectId: uuid,
  project: nullableRef("GenericObject"),
  tool: { type: "string" },
  toolLabel: { type: "string" },
  recordId: uuid,
  recordRef: { type: "string", nullable: true },
  recordTitle: { type: "string", nullable: true },
  path: { type: "string", nullable: true },
  template: ref("GenericObject"),
  status: { type: "string", enum: ["running", "succeeded", "failed", "cancelled"] },
  outcome: { type: "string", nullable: true, enum: ["success", "fail", null] },
  currentStepKey: { type: "string", nullable: true },
  currentStep: nullableRef("GenericObject"),
  steps: arrayOf(ref("GenericObject")),
  context: ref("GenericObject"),
  applyStatus: { type: "string", nullable: true, description: "applied, failed (outcome could not be written to the record) or skipped." },
  applyError: { type: "string", nullable: true },
  escalationLevel: { type: "integer" },
  startedAt: nullableDateString,
  startedBy: nullableUuid,
  completedAt: nullableDateString,
  cancelledAt: nullableDateString,
  cancelReason: { type: "string", nullable: true },
  myAssignment: nullableRef("GenericObject"),
  updatedAt: nullableDateString,
});
const workflowToolsResponse = objectSchema({ tools: arrayOf(objectSchema({ key: { type: "string" }, label: { type: "string" }, module: { type: "string" }, triggerStatus: { type: "string", nullable: true }, outcomes: ref("GenericObject"), contextFields: arrayOf(ref("GenericObject")) })) });
const workflowPermission = (action, transition = null) => modulePermission("workflow", action, transition);
const workflowTemplateQuery = [queryParam("tool", "Only templates for this tool.", { type: "string", enum: workflowTools }), queryParam("includeArchived", "Include archived templates.", { type: "boolean" })];
[
  { method: "get", path: "/company/workflow-tools", summary: "Tools a workflow can run on, with the context fields templates may test and the status that starts a run automatically.", operationId: "listCompanyWorkflowTools", parameters: [], permissions: { auth: "bearer", roles: ROLE_IDS, note: "Any authenticated user." }, responseSchema: workflowToolsResponse },
  { method: "get", path: "/company/workflow-templates", summary: "Company workflow templates.", operationId: "listCompanyWorkflowTemplates", parameters: workflowTemplateQuery, permissions: { auth: "bearer", roles: ROLE_IDS, note: "Any authenticated user." }, responseSchema: objectSchema({ items: arrayOf(workflowTemplateSchema) }) },
  { method: "post", path: "/company/workflow-templates", summary: "Create a company workflow template (company admin). Steps: response (assignees, days, responses → next / end), condition (branch on the record context) or action (notify).", operationId: "createCompanyWorkflowTemplate", parameters: [], permissions: companyAdminPermission, requestBody: jsonBody(workflowTemplateInput, "Template.", true), responseSchema: workflowTemplateSchema, status: 201 },
  { method: "post", path: "/company/workflow-templates/defaults", summary: "Seed one default template per tool that mirrors the built-in approval, plus a worked example with a rule and a condition (change orders ≥ 50,000).", operationId: "seedCompanyWorkflowDefaults", parameters: [], permissions: companyAdminPermission, responseSchema: objectSchema({ created: { type: "integer" }, templates: arrayOf(workflowTemplateSchema) }), status: 201 },
  { method: "patch", path: "/company/workflow-templates/{id}", summary: "Update or archive a company workflow template (company admin).", operationId: "updateCompanyWorkflowTemplate", parameters: [idParam], permissions: companyAdminPermission, requestBody: jsonBody(workflowTemplateInput, "Fields to change.", false), responseSchema: workflowTemplateSchema },
  { method: "delete", path: "/company/workflow-templates/{id}", summary: "Archive a company workflow template (company admin).", operationId: "archiveCompanyWorkflowTemplate", parameters: [idParam], permissions: companyAdminPermission, responseSchema: workflowTemplateSchema },
  { method: "get", path: "/workflows/my-steps", summary: "Workflow steps waiting on the caller across every project.", operationId: "listMyWorkflowSteps", parameters: [], permissions: workflowPermission("read"), responseSchema: objectSchema({ items: arrayOf(ref("GenericObject")) }) },
  { method: "get", path: "/projects/{projectId}/workflows/tools", summary: "Workflow tools catalogue.", operationId: "listWorkflowTools", parameters: projectParams, permissions: workflowPermission("read"), responseSchema: workflowToolsResponse },
  { method: "get", path: "/projects/{projectId}/workflows/templates", summary: "Templates that apply on this project (project-level and company).", operationId: "listWorkflowTemplates", parameters: [...projectParams, ...workflowTemplateQuery], permissions: workflowPermission("read"), responseSchema: objectSchema({ items: arrayOf(workflowTemplateSchema) }) },
  { method: "post", path: "/projects/{projectId}/workflows/templates", summary: "Create a project-level workflow template (PM).", operationId: "createWorkflowTemplate", parameters: projectParams, permissions: workflowPermission("update", "workflow.manage"), requestBody: jsonBody(workflowTemplateInput, "Template.", true), responseSchema: workflowTemplateSchema, status: 201 },
  { method: "patch", path: "/projects/{projectId}/workflows/templates/{templateId}", summary: "Update a project-level workflow template (PM).", operationId: "updateWorkflowTemplate", parameters: [...projectParams, workflowTemplateIdParam], permissions: workflowPermission("update", "workflow.manage"), requestBody: jsonBody(workflowTemplateInput, "Fields to change.", false), responseSchema: workflowTemplateSchema },
  { method: "delete", path: "/projects/{projectId}/workflows/templates/{templateId}", summary: "Archive a project-level workflow template (PM).", operationId: "archiveWorkflowTemplate", parameters: [...projectParams, workflowTemplateIdParam], permissions: workflowPermission("update", "workflow.manage"), responseSchema: workflowTemplateSchema },
  { method: "get", path: "/projects/{projectId}/workflows/my-steps", summary: "Workflow steps waiting on the caller in this project.", operationId: "listProjectWorkflowSteps", parameters: projectParams, permissions: workflowPermission("read"), responseSchema: objectSchema({ items: arrayOf(ref("GenericObject")) }) },
  { method: "get", path: "/projects/{projectId}/workflows/instances", summary: "Workflow runs on this project.", operationId: "listWorkflowInstances", parameters: [...projectParams, queryParam("tool", "Filter by tool.", { type: "string", enum: workflowTools }), queryParam("recordId", "Filter by record.", uuid), queryParam("status", "Filter by status.", { type: "string", enum: ["running", "succeeded", "failed", "cancelled"] }), queryParam("limit", "Max rows (default 50).", { type: "integer" })], permissions: workflowPermission("read"), responseSchema: objectSchema({ items: arrayOf(workflowInstanceSchema) }) },
  { method: "post", path: "/projects/{projectId}/workflows/instances", summary: "Start a workflow on a record by hand (PM). Without `templateId` the first template whose rules match the record's context is used, else the tool's default. 409 WORKFLOW_ALREADY_RUNNING / 404 WORKFLOW_NO_TEMPLATE / 409 WORKFLOW_STEP_UNASSIGNED.", operationId: "startWorkflowInstance", parameters: projectParams, permissions: workflowPermission("update", "workflow.manage"), requestBody: jsonBody(objectSchema({ tool: { type: "string", enum: workflowTools }, recordId: uuid, templateId: nullableUuid }, ["tool", "recordId"]), "Record."), responseSchema: workflowInstanceSchema, status: 201 },
  { method: "get", path: "/projects/{projectId}/workflows/instances/{instanceId}", summary: "One workflow run with its steps and assignments.", operationId: "getWorkflowInstance", parameters: [...projectParams, workflowInstanceIdParam], permissions: workflowPermission("read"), responseSchema: workflowInstanceSchema },
  { method: "post", path: "/projects/{projectId}/workflows/instances/{instanceId}/respond", summary: "Give your response on the current step. A negative response ends the step at once; with `requireAll` the step waits for every assignee otherwise. Reaching an end applies the outcome to the record through its own service.", operationId: "respondWorkflowInstance", parameters: [...projectParams, workflowInstanceIdParam], permissions: workflowPermission("submit", "workflow.respond"), requestBody: jsonBody(objectSchema({ response: { type: "string", description: "A response key of the current step." }, comment: { type: "string", nullable: true } }, ["response"]), "Response."), responseSchema: workflowInstanceSchema },
  { method: "post", path: "/projects/{projectId}/workflows/instances/{instanceId}/cancel", summary: "Cancel a running workflow (PM); the record's own approve / reject unlock.", operationId: "cancelWorkflowInstance", parameters: [...projectParams, workflowInstanceIdParam], permissions: workflowPermission("update", "workflow.manage"), requestBody: jsonBody(objectSchema({ reason: { type: "string", nullable: true } }), "Reason.", false), responseSchema: workflowInstanceSchema },
].forEach((route) => addGenericRoute({ tag: "Workflows", ...route }));

// ─── Project knowledge assistant (OCTA-AI-ASSIST-028) ─────────────────────
const assistantCitationSchema = objectSchema({ n: { type: "integer" }, id: { type: "string" }, type: { type: "string" }, typeLabel: { type: "string" }, title: { type: "string" }, ref: { type: "string", nullable: true }, projectId: nullableUuid, projectName: { type: "string", nullable: true }, url: { type: "string", nullable: true }, snippet: { type: "string", nullable: true } });
const assistantActionSchema = objectSchema({ type: { type: "string", enum: ["create_rfi", "create_task", "open"] }, label: { type: "string" }, sourceN: { type: "integer", nullable: true }, url: { type: "string", nullable: true }, subject: { type: "string", nullable: true }, question: { type: "string", nullable: true }, title: { type: "string", nullable: true }, description: { type: "string", nullable: true } });
const assistantMessageSchema = objectSchema({ id: uuid, role: { type: "string", enum: ["user", "assistant"] }, content: { type: "string", description: "Markdown; citations appear as [n]." }, citations: arrayOf(assistantCitationSchema), actions: arrayOf(assistantActionSchema), sources: arrayOf(ref("GenericObject")), usage: nullableRef("GenericObject"), provider: { type: "string", nullable: true }, model: { type: "string", nullable: true }, feedback: { type: "string", nullable: true, enum: ["up", "down", null] }, feedbackNote: { type: "string", nullable: true }, createdAt: nullableDateString });
const assistantConversationSchema = objectSchema({ id: uuid, projectId: nullableUuid, project: nullableRef("GenericObject"), title: { type: "string" }, lastMessageAt: nullableDateString, messageCount: { type: "integer", nullable: true }, createdAt: nullableDateString, updatedAt: nullableDateString, messages: arrayOf(assistantMessageSchema) });
const assistantAskResponse = objectSchema({ conversationId: uuid, projectId: nullableUuid, title: { type: "string" }, question: assistantMessageSchema, message: assistantMessageSchema, degraded: { type: "boolean", description: "True when no AI provider answered and the reply lists the matching sources instead." }, retrieval: objectSchema({ sources: { type: "integer" }, projects: arrayOf({ type: "string" }), mode: { type: "string", nullable: true } }) });
const assistantStatusSchema = objectSchema({ enabled: { type: "boolean" }, provider: { type: "string", nullable: true }, model: { type: "string", nullable: true }, embeddings: ref("GenericObject") });
const assistantPermission = modulePermission("assistant", "read");
const assistantRoutes = (prefix, params, { withActions }) => [
  { method: "get", path: `${prefix}/status`, summary: "Whether an AI provider (and embeddings) are configured; the assistant still answers from search results without one.", operationId: `${withActions ? "project" : "org"}AssistantStatus`, parameters: params, permissions: assistantPermission, responseSchema: assistantStatusSchema },
  { method: "post", path: `${prefix}/ask`, summary: "Ask a question. Sources are retrieved through the caller's own permissions (projects they can open, modules they can read, party visibility, document content with embeddings when configured); the model answers only from those sources with [n] citations and may suggest actions. 400 ASSISTANT_QUESTION_REQUIRED.", operationId: `${withActions ? "project" : "org"}AssistantAsk`, parameters: params, permissions: assistantPermission, requestBody: jsonBody(objectSchema({ question: { type: "string" }, conversationId: { ...uuid, nullable: true, description: "Continue a conversation." }, ...(withActions ? {} : { projectId: { ...uuid, nullable: true, description: "Limit to one project; otherwise every project the caller can open." } }) }, ["question"]), "Question."), responseSchema: assistantAskResponse },
  { method: "get", path: `${prefix}/conversations`, summary: "The caller's conversations (newest first).", operationId: `${withActions ? "project" : "org"}AssistantConversations`, parameters: [...params, queryParam("limit", "Max rows (default 30).", { type: "integer" })], permissions: assistantPermission, responseSchema: objectSchema({ items: arrayOf(assistantConversationSchema) }) },
  { method: "get", path: `${prefix}/conversations/{conversationId}`, summary: "One conversation with its messages, citations and actions.", operationId: `${withActions ? "project" : "org"}AssistantConversation`, parameters: [...params, pathParam("conversationId", "Conversation UUID.")], permissions: assistantPermission, responseSchema: assistantConversationSchema },
  { method: "delete", path: `${prefix}/conversations/{conversationId}`, summary: "Delete a conversation.", operationId: `${withActions ? "project" : "org"}AssistantDeleteConversation`, parameters: [...params, pathParam("conversationId", "Conversation UUID.")], permissions: assistantPermission, responseSchema: objectSchema({ deleted: { type: "boolean" } }) },
  { method: "post", path: `${prefix}/messages/{messageId}/feedback`, summary: "Rate an answer (up / down, optional note).", operationId: `${withActions ? "project" : "org"}AssistantFeedback`, parameters: [...params, pathParam("messageId", "Message UUID.")], permissions: assistantPermission, requestBody: jsonBody(objectSchema({ rating: { type: "string", nullable: true, enum: ["up", "down", null] }, note: { type: "string", nullable: true } }, ["rating"]), "Rating."), responseSchema: assistantMessageSchema },
  ...(withActions
    ? [{ method: "post", path: `${prefix}/actions`, summary: "Run a suggested action — create_rfi (a draft RFI) or create_task — through the record's own service; needs create permission on that module.", operationId: "projectAssistantAction", parameters: params, permissions: assistantPermission, requestBody: jsonBody(objectSchema({ action: assistantActionSchema }, ["action"]), "Action."), responseSchema: objectSchema({ type: { type: "string" }, record: ref("GenericObject"), url: { type: "string" } }), status: 201 }]
    : []),
];
[...assistantRoutes("/assistant", [], { withActions: false }), ...assistantRoutes("/projects/{projectId}/assistant", projectParams, { withActions: true })].forEach((route) => addGenericRoute({ tag: "Assistant", ...route }));

// ─── RFI drafting and response assistant (OCTA-AI-RFI-029) ────────────────
const rfiAiRunMessage = nullableRef("GenericObject");
const rfiSimilarSchema = objectSchema({ n: { type: "integer" }, id: uuid, ref: { type: "string", nullable: true }, subject: { type: "string" }, status: { type: "string", nullable: true }, projectId: nullableUuid, projectName: { type: "string", nullable: true }, url: { type: "string", nullable: true }, snippet: { type: "string", nullable: true }, sameProject: { type: "boolean" } });
const rfiDraftSchema = objectSchema({ subject: { type: "string" }, question: { type: "string", description: "Cites sources as [n]." }, questionPlain: { type: "string", description: "The same text with citations spelled out, ready for the form." }, discipline: { type: "string", nullable: true }, specSection: { type: "string", nullable: true }, priority: { type: "string", enum: ["low", "normal", "high", "urgent"] }, costImpact: { type: "boolean" }, scheduleImpactFlag: { type: "boolean" }, impactReason: { type: "string", nullable: true }, alreadyAnswered: arrayOf(ref("GenericObject")), citations: arrayOf(assistantCitationSchema) });
const rfiSuggestionSchema = objectSchema({ response: { type: "string", description: "Cites sources as [n]." }, responsePlain: { type: "string", description: "The same text with citations spelled out, ready to paste." }, confidence: { type: "string", enum: ["high", "medium", "low"] }, basis: arrayOf({ type: "string" }), conflicts: arrayOf(objectSchema({ description: { type: "string" }, sourceNs: arrayOf({ type: "integer" }) })), openPoints: arrayOf({ type: "string" }), impacts: objectSchema({ cost: { type: "string", enum: ["none", "possible", "likely"] }, schedule: { type: "string", enum: ["none", "possible", "likely"] }, reason: { type: "string", nullable: true } }), citations: arrayOf(assistantCitationSchema) });
const rfiSummarySchema = objectSchema({ summary: { type: "string" }, decisions: arrayOf({ type: "string" }), openPoints: arrayOf({ type: "string" }), suggestedNextStep: { type: "string", nullable: true }, suggestedStatus: { type: "string", nullable: true, enum: ["open", "answered", "closed", null] } });
[
  { method: "post", path: "/projects/{projectId}/rfi/ai/draft", summary: "Turn a rough note into a proposed RFI (subject, question citing the documents, discipline, spec section, priority, impact flags) and list prior RFIs that may already answer it. Nothing is created; `degraded` when no provider answers. 400 RFI_AI_PROMPT_REQUIRED.", operationId: "draftRfiWithAi", parameters: projectParams, permissions: modulePermission("rfi", "create"), requestBody: jsonBody(objectSchema({ prompt: { type: "string" }, specSection: { type: "string", nullable: true }, discipline: { type: "string", nullable: true }, activityId: nullableUuid, locationId: nullableUuid }, ["prompt"]), "Rough description and known references."), responseSchema: objectSchema({ degraded: { type: "boolean" }, reason: { type: "string", nullable: true }, draft: { ...rfiDraftSchema, nullable: true }, similar: arrayOf(rfiSimilarSchema), citations: arrayOf(assistantCitationSchema), message: rfiAiRunMessage }) },
  { method: "get", path: "/projects/{projectId}/rfi/ai/similar", summary: "Prior RFIs matching a subject or question across every project the caller can open (current project first) — a duplicate check while typing. Search only, no model call.", operationId: "findSimilarRfis", parameters: [...projectParams, queryParam("q", "Subject or question (3–300 characters).", { type: "string" }), queryParam("limit", "Max rows (default 5).", { type: "integer" }), queryParam("excludeRfiId", "Leave this RFI out.", uuid)], permissions: modulePermission("rfi", "read"), responseSchema: objectSchema({ query: { type: "string" }, items: arrayOf(rfiSimilarSchema) }) },
  { method: "post", path: "/projects/{projectId}/rfi/{rfiId}/ai/response", summary: "Draft an answer for the responder from the specifications, drawings, prior RFIs, submittals and change orders the caller can read, with confidence, basis, conflicts between sources, open points and impact hints. Nothing is posted. 409 RFI_ALREADY_CLOSED.", operationId: "suggestRfiResponseWithAi", parameters: [...projectParams, rfiUpgradeIdParam], permissions: modulePermission("rfi", "submit"), requestBody: jsonBody(objectSchema({ instructions: { type: "string", nullable: true, description: "Anything the answer must respect." } }), "Optional instructions.", false), responseSchema: objectSchema({ degraded: { type: "boolean" }, reason: { type: "string", nullable: true }, rfi: nullableRef("GenericObject"), suggestion: { ...rfiSuggestionSchema, nullable: true }, similar: arrayOf(rfiSimilarSchema), citations: arrayOf(assistantCitationSchema), message: rfiAiRunMessage }) },
  { method: "post", path: "/projects/{projectId}/rfi/{rfiId}/ai/summary", summary: "Summarise the RFI thread: what was asked, what was said, decisions, open points and a suggested next step. Without a provider a factual summary is built from the record.", operationId: "summarizeRfiWithAi", parameters: [...projectParams, rfiUpgradeIdParam], permissions: modulePermission("rfi", "read"), responseSchema: objectSchema({ degraded: { type: "boolean" }, reason: { type: "string", nullable: true }, rfi: nullableRef("GenericObject"), summary: rfiSummarySchema, message: rfiAiRunMessage }) },
].forEach((route) => addGenericRoute({ tag: "Assistant", ...route }));

// ─── Bid management & bidder portal (OCTA-PRE-BID-027) ────────────────────
const bidPackageParam = pathParam("packageId", "Bid package UUID.");
const bidTokenParam = pathParam("token", "Personal portal token from the invitation email.", null);
const bidLineSchema = objectSchema({ id: uuid, lineNumber: { type: "integer" }, boqItemId: nullableUuid, section: { type: "string", nullable: true }, code: { type: "string", nullable: true }, description: { type: "string" }, unit: { type: "string", nullable: true }, qty: { type: "number" }, estimateRate: { type: "number", nullable: true, description: "Internal; never sent to bidders." }, estimateAmount: { type: "number", nullable: true }, budgetLineId: nullableUuid, costCodeId: nullableUuid, activityId: nullableUuid, sortOrder: { type: "integer" } });
const bidLineInput = objectSchema({ description: { type: "string" }, section: { type: "string", nullable: true }, code: { type: "string", nullable: true }, unit: { type: "string", nullable: true }, qty: { type: "number" }, estimateRate: { type: "number", nullable: true }, budgetLineId: nullableUuid, costCodeId: nullableUuid, activityId: nullableUuid, boqItemId: nullableUuid });
const bidInvitationSchema = objectSchema({ id: uuid, vendorCompanyId: nullableUuid, companyName: { type: "string" }, contactName: { type: "string", nullable: true }, contactEmail: { type: "string" }, status: { type: "string", enum: ["invited", "viewed", "declined", "submitted", "withdrawn"] }, invitedAt: nullableDateString, viewedAt: nullableDateString, lastAccessAt: nullableDateString, expiresAt: nullableDateString, declinedReason: { type: "string", nullable: true }, remindersSent: { type: "integer" }, bidStatus: { type: "string", nullable: true }, bidTotal: { type: "number", nullable: true }, portalUrl: { type: "string", nullable: true, description: "Only on invite (open packages) and resend." } });
const bidAddendumSchema = objectSchema({ id: uuid, number: { type: "integer" }, title: { type: "string" }, body: { type: "string", nullable: true }, issuedAt: nullableDateString, issuedBy: nullableUuid });
const bidQuestionSchema = objectSchema({ id: uuid, question: { type: "string" }, askedAt: nullableDateString, askedBy: { type: "string", nullable: true }, invitationId: nullableUuid, companyName: { type: "string", nullable: true }, answer: { type: "string", nullable: true }, answeredAt: nullableDateString, shared: { type: "boolean" }, status: { type: "string", enum: ["open", "answered"] }, mine: { type: "boolean", nullable: true } });
const bidRecordLineSchema = objectSchema({ id: uuid, packageLineId: uuid, rate: { type: "number", nullable: true }, amount: { type: "number" }, included: { type: "boolean" }, note: { type: "string", nullable: true } });
const bidSchema = objectSchema({ id: uuid, invitationId: uuid, companyName: { type: "string", nullable: true }, contactName: { type: "string", nullable: true }, contactEmail: { type: "string", nullable: true }, vendorCompanyId: nullableUuid, version: { type: "integer" }, status: { type: "string", enum: ["draft", "submitted", "withdrawn", "awarded", "unsuccessful"] }, total: { type: "number" }, currency: { type: "string", nullable: true }, notes: { type: "string", nullable: true }, inclusions: { type: "string", nullable: true }, exclusions: { type: "string", nullable: true }, validityDays: { type: "integer", nullable: true }, leadTimeDays: { type: "integer", nullable: true }, documentId: nullableUuid, submittedAt: nullableDateString, submittedBy: { type: "string", nullable: true }, withdrawnAt: nullableDateString, awardedAt: nullableDateString, lines: arrayOf(bidRecordLineSchema), updatedAt: nullableDateString });
const bidPackageSchema = objectSchema({ id: uuid, projectId: uuid, number: { type: "integer" }, ref: { type: "string" }, title: { type: "string" }, description: { type: "string", nullable: true }, instructions: { type: "string", nullable: true }, status: { type: "string", enum: ["draft", "open", "closed", "awarded", "cancelled"] }, dueAt: nullableDateString, questionsDueAt: nullableDateString, currency: { type: "string" }, boqSections: arrayOf({ type: "string" }), commitmentType: { type: "string", enum: ["subcontract", "purchase_order"] }, publishedAt: nullableDateString, closedAt: nullableDateString, awardedAt: nullableDateString, awardedBidId: nullableUuid, awardedCommitmentId: nullableUuid, softAwardBidId: nullableUuid, isPastDue: { type: "boolean" }, counts: ref("GenericObject"), createdBy: nullableUuid, createdAt: nullableDateString, updatedAt: nullableDateString, lines: arrayOf(bidLineSchema), invitations: arrayOf(bidInvitationSchema), addenda: arrayOf(bidAddendumSchema), questions: arrayOf(bidQuestionSchema), bids: arrayOf(bidSchema) });
const bidPackageInput = objectSchema({ title: { type: "string" }, description: { type: "string", nullable: true }, instructions: { type: "string", nullable: true }, dueAt: nullableDateString, questionsDueAt: nullableDateString, currency: { type: "string" }, commitmentType: { type: "string", enum: ["subcontract", "purchase_order"] }, boqSections: arrayOf({ type: "string", description: "BOQ sections whose active items become bid lines (create only)." }) });
const bidLevelingSchema = objectSchema({ package: bidPackageSchema, lines: arrayOf(bidLineSchema), lineStats: { type: "object", additionalProperties: objectSchema({ low: { type: "number", nullable: true }, high: { type: "number", nullable: true }, avg: { type: "number", nullable: true }, priced: { type: "integer" }, spread: { type: "number", nullable: true }, plug: { type: "number" } }) }, bidders: arrayOf(objectSchema({ bidId: uuid, invitationId: uuid, companyName: { type: "string", nullable: true }, status: { type: "string" }, total: { type: "number" }, normalizedTotal: { type: "number", description: "Excluded / unpriced lines plugged with the average of the other bidders (or the estimate)." }, pluggedLines: { type: "integer" }, lowLines: { type: "integer" }, rank: { type: "integer" }, validityDays: { type: "integer", nullable: true }, leadTimeDays: { type: "integer", nullable: true }, inclusions: { type: "string", nullable: true }, exclusions: { type: "string", nullable: true }, notes: { type: "string", nullable: true }, documentId: nullableUuid, submittedAt: nullableDateString, isSoftAward: { type: "boolean" }, isAwarded: { type: "boolean" } })), cells: { type: "object", additionalProperties: { type: "object", additionalProperties: objectSchema({ rate: { type: "number", nullable: true }, amount: { type: "number", nullable: true }, included: { type: "boolean" }, note: { type: "string", nullable: true }, plugged: { type: "boolean" }, normalizedAmount: { type: "number", nullable: true }, isLow: { type: "boolean" } }) }, description: "bidId → packageLineId → cell" }, estimateTotal: { type: "number" } });
const bidPortalViewSchema = objectSchema({ invitation: objectSchema({ id: uuid, companyName: { type: "string" }, contactName: { type: "string", nullable: true }, contactEmail: { type: "string" }, status: { type: "string" }, expiresAt: nullableDateString, declinedReason: { type: "string", nullable: true } }), package: objectSchema({ ref: { type: "string" }, title: { type: "string" }, description: { type: "string", nullable: true }, instructions: { type: "string", nullable: true }, status: { type: "string" }, acceptingBids: { type: "boolean" }, dueAt: nullableDateString, questionsDueAt: nullableDateString, questionsOpen: { type: "boolean" }, currency: { type: "string" }, lines: arrayOf(bidLineSchema), addenda: arrayOf(bidAddendumSchema), questions: arrayOf(bidQuestionSchema), documents: arrayOf(objectSchema({ id: uuid, fileName: { type: "string" }, mimeType: { type: "string" }, sizeBytes: { type: "integer" }, caption: { type: "string", nullable: true }, uploadedAt: nullableDateString, downloadUrl: { type: "string" } })), awarded: { type: "string", nullable: true, enum: ["you", "other", null] } }), bid: { ...bidSchema, nullable: true } });
const bidPortalBidInput = objectSchema({ lines: arrayOf(objectSchema({ packageLineId: uuid, rate: { type: "number", nullable: true }, included: { type: "boolean" }, note: { type: "string", nullable: true } })), notes: { type: "string", nullable: true }, inclusions: { type: "string", nullable: true }, exclusions: { type: "string", nullable: true }, validityDays: { type: "integer", nullable: true }, leadTimeDays: { type: "integer", nullable: true } });
const bidPermission = (action, transition = null) => modulePermission("bid", action, transition);
const portalOperation = ({ path, method, summary, operationId, parameters, requestBody = undefined, responseSchema, status = 200, responses = undefined }) =>
  add(path, method, operation({ tag: "Bidder Portal", summary, operationId, parameters, requestBody, responseSchema, status, responses, permissions: { auth: "none", note: "The portal token in the path is the credential; every answer is scoped to that one invitation." }, security: false }));
portalOperation({ path: "/public/bids/{token}", method: "get", summary: "The invitation's view of a bid package: brief, lines (no estimates), documents, addenda, its own questions plus shared answers (asker never named), and its own bid. Marks the invitation viewed.", operationId: "bidPortalView", parameters: [bidTokenParam], responseSchema: bidPortalViewSchema });
portalOperation({ path: "/public/bids/{token}/documents/{documentId}", method: "get", summary: "Download a package document.", operationId: "bidPortalDocument", parameters: [bidTokenParam, pathParam("documentId", "Document UUID.")], responseSchema: { type: "string", format: "binary" } });
portalOperation({ path: "/public/bids/{token}/questions", method: "post", summary: "Ask a question (while the question period is open). The project team is notified; answers reach this bidder, or every bidder anonymously when shared.", operationId: "bidPortalAsk", parameters: [bidTokenParam], requestBody: jsonBody(objectSchema({ question: { type: "string" }, askedBy: { type: "string", nullable: true } }, ["question"]), "Question."), responseSchema: bidQuestionSchema, status: 201 });
portalOperation({ path: "/public/bids/{token}/bid", method: "put", summary: "Save the priced form as a draft (rate per line, or excluded with a note), with inclusions, exclusions, validity and lead time. 409 BID_ALREADY_SUBMITTED until withdrawn.", operationId: "bidPortalSave", parameters: [bidTokenParam], requestBody: jsonBody(bidPortalBidInput, "Bid."), responseSchema: bidSchema });
portalOperation({ path: "/public/bids/{token}/bid/submit", method: "post", summary: "Submit the bid. Every line must be priced or excluded unless a priced form was uploaded (400 BID_INCOMPLETE lists the lines); refused after the due date.", operationId: "bidPortalSubmit", parameters: [bidTokenParam], requestBody: jsonBody(objectSchema({ submittedBy: { type: "string", nullable: true } }), "Signature.", false), responseSchema: bidSchema });
portalOperation({ path: "/public/bids/{token}/bid/withdraw", method: "post", summary: "Withdraw a submitted bid (resubmission allowed until the due date).", operationId: "bidPortalWithdraw", parameters: [bidTokenParam], responseSchema: bidSchema });
portalOperation({ path: "/public/bids/{token}/decline", method: "post", summary: "Decline to bid.", operationId: "bidPortalDecline", parameters: [bidTokenParam], requestBody: jsonBody(objectSchema({ reason: { type: "string", nullable: true } }), "Reason.", false), responseSchema: objectSchema({ status: { type: "string" }, declinedReason: { type: "string", nullable: true } }) });
portalOperation({ path: "/public/bids/{token}/upload", method: "post", summary: "Upload a priced form (PDF, spreadsheet, document, ≤ 25 MB) attached to the bid.", operationId: "bidPortalUpload", parameters: [bidTokenParam], requestBody: fileUploadBody({ description: "Priced form.", accepted: "PDF, Word, Excel or image" }), responseSchema: bidSchema, status: 201 });
[
  { method: "get", path: "/projects/{projectId}/bids/boq-sections", summary: "BOQ sections with active items, to build bid form lines from.", operationId: "listBidBoqSections", parameters: projectParams, permissions: bidPermission("read"), responseSchema: objectSchema({ items: arrayOf(objectSchema({ section: { type: "string" }, key: { type: "string" }, items: { type: "integer" }, amount: { type: "number" } })) }) },
  { method: "get", path: "/projects/{projectId}/bids", summary: "Bid packages on the project.", operationId: "listBidPackages", parameters: [...projectParams, queryParam("status", "Filter by status.", { type: "string", enum: ["draft", "open", "closed", "awarded", "cancelled"] })], permissions: bidPermission("read"), responseSchema: objectSchema({ items: arrayOf(bidPackageSchema) }) },
  { method: "post", path: "/projects/{projectId}/bids", summary: "Create a bid package (BP-nnn); `boqSections` turns the sections' active BOQ items into lines with the internal estimate.", operationId: "createBidPackage", parameters: projectParams, permissions: bidPermission("create"), requestBody: jsonBody(bidPackageInput, "Package.", true), responseSchema: bidPackageSchema, status: 201 },
  { method: "get", path: "/projects/{projectId}/bids/{packageId}", summary: "One bid package with lines, bidders, addenda, questions and submitted bids.", operationId: "getBidPackage", parameters: [...projectParams, bidPackageParam], permissions: bidPermission("read"), responseSchema: bidPackageSchema },
  { method: "patch", path: "/projects/{projectId}/bids/{packageId}", summary: "Change the brief or dates (a due-date change on an open package emails the bidders).", operationId: "updateBidPackage", parameters: [...projectParams, bidPackageParam], permissions: bidPermission("update"), requestBody: jsonBody(bidPackageInput, "Fields to change.", false), responseSchema: bidPackageSchema },
  { method: "delete", path: "/projects/{projectId}/bids/{packageId}", summary: "Cancel a package (bidders are told when it was open).", operationId: "cancelBidPackage", parameters: [...projectParams, bidPackageParam], permissions: bidPermission("delete"), requestBody: jsonBody(objectSchema({ reason: { type: "string", nullable: true } }), "Reason.", false), responseSchema: bidPackageSchema },
  { method: "post", path: "/projects/{projectId}/bids/{packageId}/lines/from-boq", summary: "Add lines from BOQ sections or item ids (draft packages).", operationId: "addBidLinesFromBoq", parameters: [...projectParams, bidPackageParam], permissions: bidPermission("update"), requestBody: jsonBody(objectSchema({ sections: arrayOf({ type: "string" }), boqItemIds: arrayOf(uuid) }), "Source."), responseSchema: bidPackageSchema },
  { method: "post", path: "/projects/{projectId}/bids/{packageId}/lines", summary: "Add a line by hand.", operationId: "addBidLine", parameters: [...projectParams, bidPackageParam], permissions: bidPermission("update"), requestBody: jsonBody(bidLineInput, "Line.", true), responseSchema: bidPackageSchema, status: 201 },
  { method: "patch", path: "/projects/{projectId}/bids/{packageId}/lines/{lineId}", summary: "Change a line.", operationId: "updateBidLine", parameters: [...projectParams, bidPackageParam, pathParam("lineId", "Line UUID.")], permissions: bidPermission("update"), requestBody: jsonBody(bidLineInput, "Fields to change.", false), responseSchema: bidPackageSchema },
  { method: "delete", path: "/projects/{projectId}/bids/{packageId}/lines/{lineId}", summary: "Remove a line (draft packages).", operationId: "deleteBidLine", parameters: [...projectParams, bidPackageParam, pathParam("lineId", "Line UUID.")], permissions: bidPermission("update"), responseSchema: bidPackageSchema },
  { method: "post", path: "/projects/{projectId}/bids/{packageId}/invitations", summary: "Invite bidders — vendors from the company directory or an ad-hoc company + email. Open packages email the personal portal link at once.", operationId: "inviteBidders", parameters: [...projectParams, bidPackageParam], permissions: bidPermission("update"), requestBody: jsonBody(objectSchema({ invitations: arrayOf(objectSchema({ vendorCompanyId: nullableUuid, companyName: { type: "string", nullable: true }, contactName: { type: "string", nullable: true }, contactEmail: { type: "string", nullable: true } })) }, ["invitations"]), "Bidders."), responseSchema: objectSchema({ items: arrayOf(bidInvitationSchema) }), status: 201 },
  { method: "post", path: "/projects/{projectId}/bids/{packageId}/invitations/{invitationId}/resend", summary: "Email a fresh portal link (the previous one stops working).", operationId: "resendBidInvitation", parameters: [...projectParams, bidPackageParam, pathParam("invitationId", "Invitation UUID.")], permissions: bidPermission("update"), responseSchema: bidInvitationSchema },
  { method: "delete", path: "/projects/{projectId}/bids/{packageId}/invitations/{invitationId}", summary: "Remove a bidder that has not submitted.", operationId: "removeBidInvitation", parameters: [...projectParams, bidPackageParam, pathParam("invitationId", "Invitation UUID.")], permissions: bidPermission("update"), responseSchema: objectSchema({ deleted: { type: "boolean" } }) },
  { method: "post", path: "/projects/{projectId}/bids/{packageId}/publish", summary: "Open the package: needs lines, bidders and a future due date; every bidder gets a personal, expiring portal link by email.", operationId: "publishBidPackage", parameters: [...projectParams, bidPackageParam], permissions: bidPermission("submit", "bid.publish"), responseSchema: bidPackageSchema },
  { method: "post", path: "/projects/{projectId}/bids/{packageId}/close", summary: "Stop accepting bids.", operationId: "closeBidPackage", parameters: [...projectParams, bidPackageParam], permissions: bidPermission("submit", "bid.publish"), responseSchema: bidPackageSchema },
  { method: "post", path: "/projects/{projectId}/bids/{packageId}/reopen", summary: "Reopen a closed package with a new due date (bidders are emailed).", operationId: "reopenBidPackage", parameters: [...projectParams, bidPackageParam], permissions: bidPermission("submit", "bid.publish"), requestBody: jsonBody(objectSchema({ dueAt: dateString }, ["dueAt"]), "New due date."), responseSchema: bidPackageSchema },
  { method: "post", path: "/projects/{projectId}/bids/{packageId}/addenda", summary: "Issue an addendum; open packages email every bidder.", operationId: "issueBidAddendum", parameters: [...projectParams, bidPackageParam], permissions: bidPermission("update"), requestBody: jsonBody(objectSchema({ title: { type: "string" }, body: { type: "string", nullable: true } }, ["title"]), "Addendum."), responseSchema: bidAddendumSchema, status: 201 },
  { method: "post", path: "/projects/{projectId}/bids/{packageId}/questions/{questionId}/answer", summary: "Answer a bidder's question; `shared` sends the answer to every bidder without naming the asker.", operationId: "answerBidQuestion", parameters: [...projectParams, bidPackageParam, pathParam("questionId", "Question UUID.")], permissions: bidPermission("update", "bid.answer"), requestBody: jsonBody(objectSchema({ answer: { type: "string" }, shared: { type: "boolean" } }, ["answer"]), "Answer."), responseSchema: bidQuestionSchema },
  { method: "get", path: "/projects/{projectId}/bids/{packageId}/bids", summary: "Submitted (and withdrawn / decided) bids with their lines.", operationId: "listPackageBids", parameters: [...projectParams, bidPackageParam], permissions: bidPermission("read"), responseSchema: objectSchema({ items: arrayOf(bidSchema) }) },
  { method: "get", path: "/projects/{projectId}/bids/{packageId}/leveling", summary: "Leveling grid: lines × bidders with rates, amounts, low marks, per-line statistics and normalised totals (excluded / unpriced lines plugged with the average of the others, or the estimate).", operationId: "getBidLeveling", parameters: [...projectParams, bidPackageParam], permissions: bidPermission("read"), responseSchema: bidLevelingSchema },
  { method: "get", path: "/projects/{projectId}/bids/{packageId}/leveling.xlsx", summary: "Leveling grid as XLSX (Leveling, Summary and About sheets).", operationId: "exportBidLeveling", parameters: [...projectParams, bidPackageParam], permissions: bidPermission("export"), responseSchema: { type: "string", format: "binary" } },
  { method: "post", path: "/projects/{projectId}/bids/{packageId}/award", summary: "Soft award: select a submitted bid and close bidding; nothing is created yet.", operationId: "softAwardBid", parameters: [...projectParams, bidPackageParam], permissions: bidPermission("approve", "bid.award"), requestBody: jsonBody(objectSchema({ bidId: uuid }, ["bidId"]), "Bid."), responseSchema: bidPackageSchema },
  { method: "post", path: "/projects/{projectId}/bids/{packageId}/award/revoke", summary: "Clear the soft award.", operationId: "revokeBidSoftAward", parameters: [...projectParams, bidPackageParam], permissions: bidPermission("approve", "bid.award"), responseSchema: bidPackageSchema },
  { method: "post", path: "/projects/{projectId}/bids/{packageId}/award/confirm", summary: "Confirm the award: creates the commitment (vendor from the invitation, schedule of values from the priced lines with their BOQ / budget / cost-code / activity links), marks the other bids unsuccessful and emails every bidder.", operationId: "confirmBidAward", parameters: [...projectParams, bidPackageParam], permissions: bidPermission("approve", "bid.award"), requestBody: jsonBody(objectSchema({ bidId: nullableUuid, title: { type: "string", nullable: true }, retentionRate: { type: "number", nullable: true }, startDate: nullableDateString, endDate: nullableDateString }), "Commitment details.", false), responseSchema: objectSchema({ package: bidPackageSchema, commitment: nullableRef("GenericObject") }), status: 201 },
].forEach((route) => addGenericRoute({ tag: "Bid Management", ...route }));

// ─── Public API keys, webhooks & accounting connectors (OCTA-INT-API-026) ──
const accountingProviders = ["qbo", "xero"];
const providerParam = pathParam("provider", "Accounting provider: qbo (QuickBooks Online) or xero.");
const apiClientSchema = objectSchema({ id: uuid, name: { type: "string" }, description: { type: "string", nullable: true }, keyPrefix: { type: "string", description: "First characters of the key, for recognition." }, scopes: arrayOf({ type: "string" }), projectIds: arrayOf(uuid), status: { type: "string", enum: ["active", "revoked"] }, owner: objectSchema({ id: uuid, name: { type: "string", nullable: true }, email: { type: "string", nullable: true }, role: { type: "string", nullable: true } }), lastUsedAt: nullableDateString, expiresAt: nullableDateString, revokedAt: nullableDateString, createdAt: nullableDateString, updatedAt: nullableDateString, token: { type: "string", nullable: true, description: "The full key — returned once, on creation." } });
const apiClientInput = objectSchema({ name: { type: "string" }, description: { type: "string", nullable: true }, scopes: arrayOf({ type: "string", description: "<module>:read, <module>:write, *:read or *:write." }), projectIds: arrayOf(uuid), userId: { ...uuid, nullable: true, description: "Person the key acts as (default: the caller)." }, expiresAt: nullableDateString, status: { type: "string", enum: ["revoked"] } });
const webhookSchema = objectSchema({ id: uuid, projectId: nullableUuid, project: nullableRef("GenericObject"), name: { type: "string" }, description: { type: "string", nullable: true }, url: { type: "string" }, secret: { type: "string", nullable: true, description: "Returned on creation and rotation only." }, secretHint: { type: "string", nullable: true }, eventTypes: arrayOf({ type: "string" }), status: { type: "string", enum: ["active", "paused", "disabled"] }, failureCount: { type: "integer" }, lastDeliveryAt: nullableDateString, lastStatus: { type: "string", nullable: true }, lastError: { type: "string", nullable: true }, deliveryCount: { type: "integer", nullable: true }, createdAt: nullableDateString, updatedAt: nullableDateString });
const webhookInput = objectSchema({ name: { type: "string" }, url: { type: "string", description: "https endpoint." }, eventTypes: arrayOf({ type: "string", description: "*, record.changed, approval.decided, notification.created, job.progress, or <entity>.<action> such as rfi.status_changed / change_order.*" }), description: { type: "string", nullable: true }, projectId: { ...uuid, nullable: true, description: "Limit to one project." }, secret: { type: "string", nullable: true, description: "Your own signing secret (≥ 16 chars); generated when omitted." }, status: { type: "string", enum: ["active", "paused"] } });
const webhookDeliverySchema = objectSchema({ id: uuid, subscriptionId: uuid, eventId: { type: "string" }, eventType: { type: "string" }, attempt: { type: "integer" }, maxAttempts: { type: "integer" }, status: { type: "string", enum: ["pending", "delivered", "failed", "dead"] }, responseStatus: { type: "integer", nullable: true }, responseBody: { type: "string", nullable: true }, error: { type: "string", nullable: true }, durationMs: { type: "integer", nullable: true }, nextAttemptAt: nullableDateString, deliveredAt: nullableDateString, payload: ref("GenericObject"), createdAt: nullableDateString, updatedAt: nullableDateString });
const accountingConnectionSchema = objectSchema({ provider: { type: "string", enum: accountingProviders }, label: { type: "string" }, configured: { type: "boolean", description: "Client id / secret present on the server." }, encryptionReady: { type: "boolean", description: "INTEGRATION_SECRET_KEY set." }, status: { type: "string", enum: ["pending", "connected", "disconnected", "error"] }, externalOrgId: { type: "string", nullable: true }, externalOrgName: { type: "string", nullable: true }, autoSyncPayApps: { type: "boolean" }, connectedBy: nullableUuid, connectedAt: nullableDateString, lastSyncAt: nullableDateString, lastError: { type: "string", nullable: true } });
const accountingMappingSchema = objectSchema({ id: uuid, provider: { type: "string" }, costCode: { type: "string", description: "Cost code, or * for the default account; retention and back_charges are reserved codes." }, costCodeId: nullableUuid, externalAccountId: { type: "string", nullable: true }, externalAccountName: { type: "string", nullable: true }, updatedAt: nullableDateString });
const accountingSyncSchema = objectSchema({ id: uuid, projectId: uuid, project: nullableRef("GenericObject"), provider: { type: "string" }, providerLabel: { type: "string" }, recordType: { type: "string" }, recordId: uuid, externalId: { type: "string", nullable: true }, externalRef: { type: "string", nullable: true }, externalVendorId: { type: "string", nullable: true }, status: { type: "string", enum: ["pending", "synced", "paid", "failed"] }, amount: { type: "number" }, currency: { type: "string", nullable: true }, attempts: { type: "integer" }, lastError: { type: "string", nullable: true }, syncedAt: nullableDateString, paidAt: nullableDateString, paidAmount: { type: "number", nullable: true }, requestedBy: nullableUuid, createdAt: nullableDateString, updatedAt: nullableDateString });
const syncStatusQuery = queryParam("status", "Filter by status.", { type: "string", enum: ["pending", "synced", "paid", "failed"] });
const exportQuery = [queryParam("format", "xlsx (default) or csv.", { type: "string", enum: ["xlsx", "csv"] }), queryParam("provider", "Include this provider's account mapping.", { type: "string", enum: accountingProviders }), queryParam("from", "Approved on or after (date).", { type: "string", format: "date" }), queryParam("to", "Approved on or before (date).", { type: "string", format: "date" })];
const accountingApproverPermission = modulePermission("sub_pay_app", "update", "sub_pay_app.accounting_sync");
add(
  "/integrations/accounting/{provider}/callback",
  "get",
  operation({
    tag: "Integrations",
    summary: "OAuth callback the accounting system redirects the browser to; validates the state, stores encrypted tokens and redirects to Company › Integrations.",
    operationId: "accountingOAuthCallback",
    parameters: [providerParam, queryParam("code", "Authorisation code.", { type: "string" }), queryParam("state", "State issued by the connect call.", { type: "string" }, true), queryParam("realmId", "QuickBooks company id.", { type: "string" })],
    permissions: { auth: "none" },
    security: false,
    responses: { 302: { description: "Redirect to the web app." } },
  }),
);
[
  { method: "get", path: "/integrations/scopes", summary: "Scopes an API key can carry (<module>:read / <module>:write, *:read / *:write).", operationId: "listApiScopes", parameters: [], permissions: companyAdminPermission, responseSchema: objectSchema({ scopes: arrayOf(objectSchema({ scope: { type: "string" }, module: { type: "string" }, access: { type: "string" }, label: { type: "string" } })), prefix: { type: "string" } }) },
  { method: "get", path: "/integrations/api-clients", summary: "API keys of the organisation (never the key itself).", operationId: "listApiClients", parameters: [queryParam("includeRevoked", "Include revoked keys.", { type: "boolean" })], permissions: companyAdminPermission, responseSchema: objectSchema({ items: arrayOf(apiClientSchema) }) },
  { method: "post", path: "/integrations/api-clients", summary: "Create an API key. It acts as its owner (the caller by default), limited to the scopes and, optionally, projects given; the key is returned once. Use it as `Authorization: Bearer octapm_…`.", operationId: "createApiClient", parameters: [], permissions: companyAdminPermission, requestBody: jsonBody(apiClientInput, "Key.", true), responseSchema: apiClientSchema, status: 201 },
  { method: "patch", path: "/integrations/api-clients/{id}", summary: "Rename, re-scope, re-limit, set an expiry on or revoke (status = revoked) an API key.", operationId: "updateApiClient", parameters: [idParam], permissions: companyAdminPermission, requestBody: jsonBody(apiClientInput, "Fields to change.", false), responseSchema: apiClientSchema },
  { method: "delete", path: "/integrations/api-clients/{id}", summary: "Revoke an API key.", operationId: "revokeApiClient", parameters: [idParam], permissions: companyAdminPermission, responseSchema: apiClientSchema },
  { method: "get", path: "/integrations/webhooks/event-types", summary: "Event patterns a webhook can subscribe to, the signature header and the retry count.", operationId: "listWebhookEventTypes", parameters: [], permissions: companyAdminPermission, responseSchema: objectSchema({ eventTypes: arrayOf(objectSchema({ key: { type: "string" }, label: { type: "string" } })), signatureHeader: { type: "string" }, maxAttempts: { type: "integer" } }) },
  { method: "get", path: "/integrations/webhooks", summary: "Webhook subscriptions.", operationId: "listWebhooks", parameters: [], permissions: companyAdminPermission, responseSchema: objectSchema({ items: arrayOf(webhookSchema) }) },
  { method: "post", path: "/integrations/webhooks", summary: "Subscribe an https endpoint to events. Deliveries are POSTed as JSON with `X-OctaPM-Signature: t=<unix>,v1=<hex HMAC-SHA256 of \"<t>.<body>\">`, `X-OctaPM-Event` and `X-OctaPM-Delivery`; non-2xx answers are retried five times with backoff, then marked dead.", operationId: "createWebhook", parameters: [], permissions: companyAdminPermission, requestBody: jsonBody(webhookInput, "Subscription.", true), responseSchema: webhookSchema, status: 201 },
  { method: "get", path: "/integrations/webhooks/{id}", summary: "One webhook subscription.", operationId: "getWebhook", parameters: [idParam], permissions: companyAdminPermission, responseSchema: webhookSchema },
  { method: "patch", path: "/integrations/webhooks/{id}", summary: "Change, pause or re-enable a webhook (re-enabling resets its failure count).", operationId: "updateWebhook", parameters: [idParam], permissions: companyAdminPermission, requestBody: jsonBody(webhookInput, "Fields to change.", false), responseSchema: webhookSchema },
  { method: "delete", path: "/integrations/webhooks/{id}", summary: "Delete a webhook and its delivery log.", operationId: "deleteWebhook", parameters: [idParam], permissions: companyAdminPermission, responseSchema: objectSchema({ deleted: { type: "boolean" } }) },
  { method: "post", path: "/integrations/webhooks/{id}/rotate-secret", summary: "Issue a new signing secret (returned once).", operationId: "rotateWebhookSecret", parameters: [idParam], permissions: companyAdminPermission, responseSchema: webhookSchema },
  { method: "post", path: "/integrations/webhooks/{id}/test", summary: "Send a `webhook.test` event now and report the endpoint's answer.", operationId: "testWebhook", parameters: [idParam], permissions: companyAdminPermission, responseSchema: objectSchema({ ok: { type: "boolean" }, error: { type: "string", nullable: true }, delivery: webhookDeliverySchema }) },
  { method: "get", path: "/integrations/webhooks/{id}/deliveries", summary: "Delivery log of a webhook (latest first).", operationId: "listWebhookDeliveries", parameters: [idParam, queryParam("status", "Filter by status.", { type: "string", enum: ["pending", "delivered", "failed", "dead"] }), queryParam("limit", "Max rows (default 50).", { type: "integer" })], permissions: companyAdminPermission, responseSchema: objectSchema({ items: arrayOf(webhookDeliverySchema) }) },
  { method: "post", path: "/integrations/webhooks/deliveries/{deliveryId}/redeliver", summary: "Queue a fresh attempt series for a failed or dead delivery.", operationId: "redeliverWebhook", parameters: [pathParam("deliveryId", "Delivery UUID.")], permissions: companyAdminPermission, responseSchema: webhookDeliverySchema, status: 201 },
  { method: "get", path: "/integrations/accounting/connections", summary: "Accounting connections (QuickBooks Online, Xero) and whether the server is configured for them.", operationId: "listAccountingConnections", parameters: [], permissions: companyAdminPermission, responseSchema: objectSchema({ items: arrayOf(accountingConnectionSchema) }) },
  { method: "post", path: "/integrations/accounting/{provider}/connect", summary: "Start the OAuth connection: returns the provider's authorisation URL to open in the browser. Needs the provider's client id / secret and INTEGRATION_SECRET_KEY on the server.", operationId: "connectAccounting", parameters: [providerParam], permissions: companyAdminPermission, responseSchema: objectSchema({ provider: { type: "string" }, url: { type: "string" } }) },
  { method: "patch", path: "/integrations/accounting/{provider}", summary: "Connection settings (auto-post approved pay applications).", operationId: "updateAccountingConnection", parameters: [providerParam], permissions: companyAdminPermission, requestBody: jsonBody(objectSchema({ autoSyncPayApps: { type: "boolean" } }), "Settings.", false), responseSchema: accountingConnectionSchema },
  { method: "delete", path: "/integrations/accounting/{provider}", summary: "Disconnect and forget the tokens.", operationId: "disconnectAccounting", parameters: [providerParam], permissions: companyAdminPermission, responseSchema: accountingConnectionSchema },
  { method: "get", path: "/integrations/accounting/{provider}/accounts", summary: "Chart of accounts from the connected provider, for mapping cost codes.", operationId: "listAccountingAccounts", parameters: [providerParam], permissions: companyAdminPermission, responseSchema: objectSchema({ items: arrayOf(objectSchema({ id: { type: "string" }, code: { type: "string", nullable: true }, name: { type: "string" }, type: { type: "string", nullable: true } })) }) },
  { method: "get", path: "/integrations/accounting/mappings", summary: "Cost code → account mappings.", operationId: "listAccountingMappings", parameters: [queryParam("provider", "Only this provider.", { type: "string", enum: accountingProviders })], permissions: companyAdminPermission, responseSchema: objectSchema({ items: arrayOf(accountingMappingSchema) }) },
  { method: "put", path: "/integrations/accounting/mappings", summary: "Map a cost code (or * as the default, retention, back_charges) to an account.", operationId: "upsertAccountingMapping", parameters: [], permissions: companyAdminPermission, requestBody: jsonBody(objectSchema({ provider: { type: "string", enum: accountingProviders }, costCode: { type: "string" }, costCodeId: nullableUuid, externalAccountId: { type: "string" }, externalAccountName: { type: "string", nullable: true } }, ["provider", "costCode", "externalAccountId"]), "Mapping."), responseSchema: accountingMappingSchema },
  { method: "delete", path: "/integrations/accounting/mappings/{id}", summary: "Remove a mapping.", operationId: "deleteAccountingMapping", parameters: [idParam], permissions: companyAdminPermission, responseSchema: objectSchema({ deleted: { type: "boolean" } }) },
  { method: "get", path: "/integrations/accounting/syncs", summary: "Bills posted (or waiting / failed) across projects.", operationId: "listAccountingSyncs", parameters: [syncStatusQuery, queryParam("projectId", "Only this project.", uuid), queryParam("limit", "Max rows (default 100).", { type: "integer" })], permissions: companyAdminPermission, responseSchema: objectSchema({ items: arrayOf(accountingSyncSchema) }) },
  { method: "post", path: "/integrations/accounting/syncs/{id}/retry", summary: "Queue a failed sync again.", operationId: "retryAccountingSync", parameters: [idParam], permissions: companyAdminPermission, responseSchema: accountingSyncSchema },
  { method: "post", path: "/integrations/accounting/poll", summary: "Read bill payment status back now (the scheduler does this hourly); paid bills record a payment on their pay application.", operationId: "pollAccountingPayments", parameters: [], permissions: companyAdminPermission, responseSchema: objectSchema({ checked: { type: "integer" }, paid: { type: "integer" }, error: { type: "string", nullable: true } }) },
  { method: "get", path: "/integrations/accounting/export", summary: "Approved and paid pay applications as cost lines by cost code (Costs, By cost code and About sheets; CSV with `format=csv`).", operationId: "exportAccountingCosts", parameters: [...exportQuery, queryParam("projectId", "Only this project.", uuid)], permissions: companyAdminPermission, responseSchema: { type: "string", format: "binary" } },
  { method: "get", path: "/projects/{projectId}/accounting/connections", summary: "Connected accounting systems, as seen from a project.", operationId: "listProjectAccountingConnections", parameters: projectParams, permissions: modulePermission("sub_pay_app", "read"), responseSchema: objectSchema({ items: arrayOf(objectSchema({ provider: { type: "string" }, label: { type: "string" }, status: { type: "string" }, externalOrgName: { type: "string", nullable: true }, autoSyncPayApps: { type: "boolean" } })) }) },
  { method: "get", path: "/projects/{projectId}/accounting/syncs", summary: "Accounting syncs on this project.", operationId: "listProjectAccountingSyncs", parameters: [...projectParams, queryParam("recordId", "Only this record.", uuid), syncStatusQuery], permissions: modulePermission("sub_pay_app", "read"), responseSchema: objectSchema({ items: arrayOf(accountingSyncSchema) }) },
  { method: "post", path: "/projects/{projectId}/accounting/pay-apps/{payAppId}/sync", summary: "Post an approved pay application to accounting as a vendor bill (accounting approver). 409 ACCOUNTING_NOT_APPROVED / ACCOUNTING_NOT_CONNECTED.", operationId: "syncPayAppToAccounting", parameters: [...projectParams, pathParam("payAppId", "Pay application UUID."), queryParam("provider", "One provider only.", { type: "string", enum: accountingProviders })], permissions: accountingApproverPermission, responseSchema: objectSchema({ items: arrayOf(accountingSyncSchema) }), status: 202 },
  { method: "post", path: "/projects/{projectId}/accounting/syncs/{syncId}/retry", summary: "Queue a failed sync again (accounting approver).", operationId: "retryProjectAccountingSync", parameters: [...projectParams, pathParam("syncId", "Sync UUID.")], permissions: accountingApproverPermission, responseSchema: accountingSyncSchema },
  { method: "get", path: "/projects/{projectId}/accounting/export", summary: "This project's approved costs by cost code (XLSX or CSV).", operationId: "exportProjectAccountingCosts", parameters: [...projectParams, ...exportQuery], permissions: modulePermission("sub_pay_app", "export"), responseSchema: { type: "string", format: "binary" } },
].forEach((route) => addGenericRoute({ tag: "Integrations", ...route }));

// ─── Custom fields, fieldsets & record types (OCTA-PLAT-FIELDS-025) ───────
const customFieldRecordTypes = ["rfi", "submittal", "punch_item", "form_instance", "ncr", "material_test", "safety_incident", "drawing", "transmittal", "correspondence", "change_order", "commitment", "sub_pay_app", "ipc_certificate", "task", "risk", "procurement_order", "meeting", "daily_log", "activity"];
const customFieldTypes = ["text", "textarea", "number", "money", "date", "boolean", "select", "multi_select", "user", "company", "url"];
const customFieldConditionSchema = objectSchema({ field: { type: "string", description: "A standard record field or a custom key." }, op: { type: "string", enum: ["eq", "neq", "gt", "gte", "lt", "lte", "in", "nin", "contains", "is_true", "is_false", "empty", "not_empty"] }, value: {} });
const customFieldInput = objectSchema({
  recordType: { type: "string", enum: customFieldRecordTypes },
  key: { type: "string", nullable: true, description: "Slug; derived from the label when omitted. Immutable." },
  label: { type: "string" },
  description: { type: "string", nullable: true },
  type: { type: "string", enum: customFieldTypes },
  options: arrayOf(objectSchema({ value: { type: "string" }, label: { type: "string" } })),
  required: { type: "boolean" },
  hidden: { type: "boolean" },
  default: {},
  validation: objectSchema({ min: { type: "number", nullable: true }, max: { type: "number", nullable: true }, minLength: { type: "integer", nullable: true }, maxLength: { type: "integer", nullable: true }, pattern: { type: "string", nullable: true } }),
  condition: { ...customFieldConditionSchema, nullable: true, description: "Shown (and required) only when it holds." },
  position: { type: "integer" },
  status: { type: "string", enum: ["active", "archived"] },
});
const customFieldSchema = objectSchema({ id: uuid, projectId: nullableUuid, scope: { type: "string", enum: ["company", "project"] }, recordType: { type: "string" }, recordTypeLabel: { type: "string" }, key: { type: "string" }, label: { type: "string" }, description: { type: "string", nullable: true }, type: { type: "string", enum: customFieldTypes }, options: arrayOf(objectSchema({ value: { type: "string" }, label: { type: "string" } })), required: { type: "boolean" }, hidden: { type: "boolean" }, default: {}, validation: nullableRef("GenericObject"), condition: nullableRef("GenericObject"), position: { type: "integer" }, status: { type: "string" }, valueCount: { type: "integer", nullable: true }, createdAt: nullableDateString, updatedAt: nullableDateString });
const fieldsetEntrySchema = objectSchema({ fieldId: uuid, required: { type: "boolean", nullable: true, description: "Overrides the field's own flag when set." }, hidden: { type: "boolean", nullable: true }, position: { type: "integer" } });
const fieldsetInput = objectSchema({ recordType: { type: "string", enum: customFieldRecordTypes }, name: { type: "string" }, description: { type: "string", nullable: true }, isDefault: { type: "boolean", description: "Applies on projects without an assignment." }, fields: arrayOf(fieldsetEntrySchema), status: { type: "string", enum: ["active", "archived"] } });
const fieldsetSchema = objectSchema({ id: uuid, recordType: { type: "string" }, recordTypeLabel: { type: "string" }, name: { type: "string" }, description: { type: "string", nullable: true }, isDefault: { type: "boolean" }, fields: arrayOf(fieldsetEntrySchema), status: { type: "string" }, projectCount: { type: "integer", nullable: true }, createdAt: nullableDateString, updatedAt: nullableDateString });
const recordTypeInput = objectSchema({ tool: { type: "string", enum: ["correspondence"] }, key: { type: "string", nullable: true }, label: { type: "string" }, description: { type: "string", nullable: true }, fieldsetId: nullableUuid, settings: objectSchema({ defaults: ref("GenericObject") }), position: { type: "integer" }, status: { type: "string", enum: ["active", "archived"] } });
const recordTypeSchema = objectSchema({ id: uuid, tool: { type: "string" }, toolLabel: { type: "string" }, key: { type: "string" }, label: { type: "string" }, description: { type: "string", nullable: true }, fieldsetId: nullableUuid, fieldset: nullableRef("GenericObject"), settings: ref("GenericObject"), position: { type: "integer" }, status: { type: "string" }, createdAt: nullableDateString, updatedAt: nullableDateString });
const customFieldSchemaResponse = objectSchema({ recordType: { type: "string" }, recordTypeLabel: { type: "string" }, module: { type: "string", description: "Permission module the values follow." }, fields: arrayOf(objectSchema({ id: uuid, key: { type: "string" }, label: { type: "string" }, description: { type: "string", nullable: true }, type: { type: "string" }, options: arrayOf(ref("GenericObject")), required: { type: "boolean" }, hidden: { type: "boolean" }, default: {}, validation: nullableRef("GenericObject"), condition: nullableRef("GenericObject"), position: { type: "integer" }, scope: { type: "string" } })), fieldset: nullableRef("GenericObject"), recordTypeDefinition: nullableRef("GenericObject") });
const customFieldValuesResponse = objectSchema({ ...customFieldSchemaResponse.properties, values: { type: "object", additionalProperties: {}, description: "Field key → value (dates as YYYY-MM-DD, people and companies as ids)." } });
const customFieldRecordTypesResponse = objectSchema({ recordTypes: arrayOf(objectSchema({ key: { type: "string" }, label: { type: "string" }, module: { type: "string" }, supportsRecordTypes: { type: "boolean" }, fieldCount: { type: "integer" } })), fieldTypes: arrayOf({ type: "string" }), conditionOps: arrayOf({ type: "string" }), definitions: arrayOf(recordTypeSchema) });
const customFieldPermission = (action, transition = null) => modulePermission("custom_field", action, transition);
const recordModulePermission = (action) => ({ auth: "bearer", roles: ROLE_IDS, note: `Needs ${action} permission on the record's own module (an RFI's values follow the rfi module).` });
const recordTypeParam = pathParam("recordType", "Record type key (rfi, change_order …).");
const recordIdParam = pathParam("recordId", "Record UUID.");
const listQuery = [queryParam("recordType", "Only this record type.", { type: "string", enum: customFieldRecordTypes }), queryParam("includeArchived", "Include archived rows.", { type: "boolean" })];
[
  { method: "get", path: "/company/custom-fields/record-types", summary: "Record types that take custom fields, with active field counts, plus the field types and condition operators.", operationId: "listCustomFieldRecordTypes", parameters: [], permissions: { auth: "bearer", roles: ROLE_IDS, note: "Any authenticated user." }, responseSchema: customFieldRecordTypesResponse },
  { method: "get", path: "/company/custom-fields", summary: "Company custom fields (shown on every project).", operationId: "listCompanyCustomFields", parameters: listQuery, permissions: { auth: "bearer", roles: ROLE_IDS, note: "Any authenticated user." }, responseSchema: objectSchema({ items: arrayOf(customFieldSchema) }) },
  { method: "post", path: "/company/custom-fields", summary: "Add a company custom field (company admin). 409 CUSTOM_FIELD_KEY_EXISTS when the key is taken on that record type.", operationId: "createCompanyCustomField", parameters: [], permissions: companyAdminPermission, requestBody: jsonBody(customFieldInput, "Field.", true), responseSchema: customFieldSchema, status: 201 },
  { method: "patch", path: "/company/custom-fields/{id}", summary: "Change a company custom field (company admin). The type can change only while no record holds a value (409 CUSTOM_FIELD_IN_USE).", operationId: "updateCompanyCustomField", parameters: [idParam], permissions: companyAdminPermission, requestBody: jsonBody(customFieldInput, "Fields to change.", false), responseSchema: customFieldSchema },
  { method: "delete", path: "/company/custom-fields/{id}", summary: "Archive a company custom field (company admin); values are kept.", operationId: "archiveCompanyCustomField", parameters: [idParam], permissions: companyAdminPermission, responseSchema: customFieldSchema },
  { method: "get", path: "/company/custom-fieldsets", summary: "Fieldsets: which fields a project or record type shows, with required / hidden overrides.", operationId: "listCustomFieldsets", parameters: listQuery, permissions: { auth: "bearer", roles: ROLE_IDS, note: "Any authenticated user." }, responseSchema: objectSchema({ items: arrayOf(fieldsetSchema) }) },
  { method: "post", path: "/company/custom-fieldsets", summary: "Create a fieldset (company admin). Marking it default clears the previous default for that record type.", operationId: "createCustomFieldset", parameters: [], permissions: companyAdminPermission, requestBody: jsonBody(fieldsetInput, "Fieldset.", true), responseSchema: fieldsetSchema, status: 201 },
  { method: "patch", path: "/company/custom-fieldsets/{id}", summary: "Change a fieldset (company admin).", operationId: "updateCustomFieldset", parameters: [idParam], permissions: companyAdminPermission, requestBody: jsonBody(fieldsetInput, "Fields to change.", false), responseSchema: fieldsetSchema },
  { method: "delete", path: "/company/custom-fieldsets/{id}", summary: "Archive a fieldset (company admin); projects fall back to the default.", operationId: "archiveCustomFieldset", parameters: [idParam], permissions: companyAdminPermission, responseSchema: fieldsetSchema },
  { method: "get", path: "/company/record-types", summary: "Company-defined record types (e.g. a Site Instruction correspondence) with their fieldset and defaults.", operationId: "listRecordTypes", parameters: [queryParam("tool", "Only this tool.", { type: "string", enum: ["correspondence"] }), queryParam("includeArchived", "Include archived rows.", { type: "boolean" })], permissions: { auth: "bearer", roles: ROLE_IDS, note: "Any authenticated user." }, responseSchema: objectSchema({ items: arrayOf(recordTypeSchema), tools: arrayOf({ type: "string" }) }) },
  { method: "post", path: "/company/record-types", summary: "Create a record type (company admin).", operationId: "createRecordType", parameters: [], permissions: companyAdminPermission, requestBody: jsonBody(recordTypeInput, "Record type.", true), responseSchema: recordTypeSchema, status: 201 },
  { method: "patch", path: "/company/record-types/{id}", summary: "Change a record type (company admin).", operationId: "updateRecordType", parameters: [idParam], permissions: companyAdminPermission, requestBody: jsonBody(recordTypeInput, "Fields to change.", false), responseSchema: recordTypeSchema },
  { method: "delete", path: "/company/record-types/{id}", summary: "Archive a record type (company admin); existing records keep their key.", operationId: "archiveRecordType", parameters: [idParam], permissions: companyAdminPermission, responseSchema: recordTypeSchema },
  { method: "get", path: "/projects/{projectId}/custom-fields/record-types", summary: "Record types that take custom fields on this project, with the company's record-type definitions.", operationId: "listProjectCustomFieldRecordTypes", parameters: projectParams, permissions: customFieldPermission("read"), responseSchema: customFieldRecordTypesResponse },
  { method: "get", path: "/projects/{projectId}/custom-fields/schema", summary: "The fields a record of `recordType` shows here: the record type's fieldset, else the project's assigned fieldset, else the default fieldset, else every active field; project fields always included.", operationId: "getCustomFieldSchema", parameters: [...projectParams, queryParam("recordType", "Record type.", { type: "string", enum: customFieldRecordTypes }, true), queryParam("recordTypeKey", "Company record-type key (correspondence).", { type: "string" })], permissions: customFieldPermission("read"), responseSchema: customFieldSchemaResponse },
  { method: "get", path: "/projects/{projectId}/custom-fields/definitions", summary: "Company and project custom fields visible on this project.", operationId: "listProjectCustomFields", parameters: [...projectParams, ...listQuery], permissions: customFieldPermission("read"), responseSchema: objectSchema({ items: arrayOf(customFieldSchema) }) },
  { method: "post", path: "/projects/{projectId}/custom-fields/definitions", summary: "Add a project-only custom field (PM).", operationId: "createProjectCustomField", parameters: projectParams, permissions: customFieldPermission("update", "custom_field.manage"), requestBody: jsonBody(customFieldInput, "Field.", true), responseSchema: customFieldSchema, status: 201 },
  { method: "patch", path: "/projects/{projectId}/custom-fields/definitions/{id}", summary: "Change a project custom field (PM). Company fields answer 403 CUSTOM_FIELD_SCOPE.", operationId: "updateProjectCustomField", parameters: [...projectParams, idParam], permissions: customFieldPermission("update", "custom_field.manage"), requestBody: jsonBody(customFieldInput, "Fields to change.", false), responseSchema: customFieldSchema },
  { method: "delete", path: "/projects/{projectId}/custom-fields/definitions/{id}", summary: "Archive a project custom field (PM).", operationId: "archiveProjectCustomField", parameters: [...projectParams, idParam], permissions: customFieldPermission("update", "custom_field.manage"), responseSchema: customFieldSchema },
  { method: "get", path: "/projects/{projectId}/custom-fields/fieldsets", summary: "Company fieldsets available to assign.", operationId: "listProjectFieldsets", parameters: [...projectParams, queryParam("recordType", "Only this record type.", { type: "string", enum: customFieldRecordTypes })], permissions: customFieldPermission("read"), responseSchema: objectSchema({ items: arrayOf(fieldsetSchema) }) },
  { method: "get", path: "/projects/{projectId}/custom-fields/assignments", summary: "Fieldset assigned per record type on this project.", operationId: "getProjectFieldsetAssignments", parameters: projectParams, permissions: customFieldPermission("read"), responseSchema: objectSchema({ items: arrayOf(objectSchema({ recordType: { type: "string" }, recordTypeLabel: { type: "string" }, fieldsetId: uuid, fieldset: nullableRef("GenericObject") })) }) },
  { method: "put", path: "/projects/{projectId}/custom-fields/assignments", summary: "Assign (or clear with null) the fieldset a record type uses on this project (PM).", operationId: "setProjectFieldsetAssignment", parameters: projectParams, permissions: customFieldPermission("update", "custom_field.manage"), requestBody: jsonBody(objectSchema({ recordType: { type: "string", enum: customFieldRecordTypes }, fieldsetId: nullableUuid }, ["recordType"]), "Assignment."), responseSchema: objectSchema({ items: arrayOf(ref("GenericObject")) }) },
  { method: "get", path: "/projects/{projectId}/custom-fields/values", summary: "Custom values for many records at once (≤ 500 ids).", operationId: "listCustomFieldValues", parameters: [...projectParams, queryParam("recordType", "Record type.", { type: "string", enum: customFieldRecordTypes }, true), queryParam("recordIds", "Comma-separated record UUIDs.", { type: "string" }, true)], permissions: recordModulePermission("read"), responseSchema: objectSchema({ items: { type: "object", additionalProperties: ref("GenericObject"), description: "recordId → { key: value }" } }) },
  { method: "get", path: "/projects/{projectId}/custom-fields/values/{recordType}/{recordId}", summary: "One record's custom values with the schema that applies to it.", operationId: "getCustomFieldValues", parameters: [...projectParams, recordTypeParam, recordIdParam, queryParam("recordTypeKey", "Company record-type key (correspondence).", { type: "string" })], permissions: recordModulePermission("read"), responseSchema: customFieldValuesResponse },
  { method: "put", path: "/projects/{projectId}/custom-fields/values/{recordType}/{recordId}", summary: "Write a record's custom values (validated against the schema; null removes; `partial` keeps keys not sent). 400 CUSTOM_FIELD_INVALID lists every problem. Changes are audited on the record itself.", operationId: "setCustomFieldValues", parameters: [...projectParams, recordTypeParam, recordIdParam], permissions: recordModulePermission("update"), requestBody: jsonBody(objectSchema({ values: { type: "object", additionalProperties: {} }, recordTypeKey: { type: "string", nullable: true }, partial: { type: "boolean" }, context: { type: "object", additionalProperties: {}, description: "Standard record fields for conditional visibility (e.g. { type: 'notice' })." } }, ["values"]), "Values."), responseSchema: customFieldValuesResponse },
].forEach((route) => addGenericRoute({ tag: "Custom Fields", ...route }));

// ─── Report builder & portfolio (OCTA-RPT-BUILDER-023) ─────────────────────
const reportIdParam = pathParam("reportId", "Saved report UUID.");
const reportScheduleIdParam = pathParam("scheduleId", "Schedule UUID.");
const reportRunIdParam = pathParam("runId", "Report run UUID.");
const reportOperators = ["eq", "neq", "in", "nin", "contains", "gt", "gte", "lt", "lte", "between", "empty", "not_empty", "is_true", "is_false", "last_days", "next_days", "before_today", "after_today", "today"];
const reportFilterSchema = objectSchema({ field: { type: "string" }, op: { type: "string", enum: reportOperators }, value: { description: "Scalar, array (in / nin / between) or day count (last_days / next_days)." } }, ["field", "op"]);
const reportDefinitionInput = objectSchema({
  name: { type: "string" },
  description: { type: "string", nullable: true },
  source: { type: "string", description: "A source key from GET /reports/sources." },
  projectId: { ...nullableUuid, description: "null = every project the caller can open." },
  columns: arrayOf({ type: "string" }),
  filters: arrayOf(reportFilterSchema),
  sort: objectSchema({ field: { type: "string" }, dir: { type: "string", enum: ["asc", "desc"] } }),
  groupBy: { type: "string", nullable: true },
  aggregates: arrayOf(objectSchema({ fn: { type: "string", enum: ["count", "sum", "avg", "min", "max"] }, field: { type: "string", nullable: true } })),
  chart: objectSchema({ type: { type: "string", enum: ["bar", "line", "pie", "none"] }, metric: { type: "string", description: "count or an aggregate key such as sum_value." } }),
  visibility: { type: "string", enum: ["private", "project", "org"] },
});
const reportDefinitionSchema = objectSchema({
  id: uuid,
  projectId: nullableUuid,
  project: nullableRef("GenericObject"),
  name: { type: "string" },
  description: { type: "string", nullable: true },
  source: { type: "string" },
  sourceLabel: { type: "string" },
  columns: arrayOf({ type: "string" }),
  filters: arrayOf(reportFilterSchema),
  sort: nullableRef("GenericObject"),
  groupBy: { type: "string", nullable: true },
  aggregates: arrayOf(ref("GenericObject")),
  chart: nullableRef("GenericObject"),
  visibility: { type: "string", enum: ["private", "project", "org"] },
  createdBy: nullableUuid,
  isOwner: { type: "boolean" },
  scheduleCount: { type: "integer" },
  lastRunAt: nullableDateString,
  createdAt: nullableDateString,
  updatedAt: nullableDateString,
});
const reportResultSchema = objectSchema({
  source: objectSchema({ key: { type: "string" }, label: { type: "string" }, module: { type: "string" } }),
  columns: arrayOf(objectSchema({ key: { type: "string" }, label: { type: "string" }, type: { type: "string" } })),
  rows: arrayOf(ref("GenericObject")),
  rowCount: { type: "integer" },
  total: { type: "integer" },
  truncated: { type: "boolean" },
  groupBy: nullableRef("GenericObject"),
  aggregates: arrayOf(ref("GenericObject")),
  groups: { type: "array", nullable: true, items: ref("GenericObject") },
  totals: ref("GenericObject"),
  projects: objectSchema({ inScope: { type: "integer" }, queried: { type: "integer" }, denied: { type: "integer", description: "Projects skipped because the caller cannot read the source there." } }),
  generatedAt: dateString,
});
const reportScheduleInput = objectSchema({
  frequency: { type: "string", enum: ["daily", "weekly", "monthly"] },
  dayOfWeek: { type: "integer", minimum: 0, maximum: 6 },
  dayOfMonth: { type: "integer", minimum: 1, maximum: 31 },
  hour: { type: "integer", minimum: 0, maximum: 23 },
  minute: { type: "integer", minimum: 0, maximum: 59 },
  timezone: { type: "string" },
  format: { type: "string", enum: ["pdf", "xlsx", "both"] },
  recipients: objectSchema({ userIds: arrayOf(uuid), roles: arrayOf({ type: "string" }), emails: arrayOf({ type: "string" }) }),
  enabled: { type: "boolean" },
});
const reportScheduleSchema = objectSchema({ id: uuid, reportId: uuid, frequency: { type: "string" }, dayOfWeek: { type: "integer" }, dayOfMonth: { type: "integer" }, hour: { type: "integer" }, minute: { type: "integer" }, timezone: { type: "string" }, format: { type: "string" }, recipients: ref("GenericObject"), enabled: { type: "boolean" }, nextRunAt: nullableDateString, lastRunAt: nullableDateString, lastStatus: { type: "string", nullable: true }, lastError: { type: "string", nullable: true }, createdBy: nullableUuid, createdAt: nullableDateString, updatedAt: nullableDateString });
const reportRunSchema = objectSchema({ id: uuid, reportId: uuid, scheduleId: nullableUuid, status: { type: "string", enum: ["queued", "running", "succeeded", "failed"] }, trigger: { type: "string", enum: ["manual", "schedule"] }, format: { type: "string" }, rowCount: { type: "integer" }, truncated: { type: "boolean" }, hasPdf: { type: "boolean" }, hasXlsx: { type: "boolean" }, fileBase: { type: "string", nullable: true }, recipients: nullableRef("GenericObject"), delivery: nullableRef("GenericObject"), error: { type: "string", nullable: true }, requestedBy: nullableUuid, startedAt: nullableDateString, finishedAt: nullableDateString, createdAt: nullableDateString });
const reportPermission = (action, transition = null) => modulePermission("report", action, transition);
[
  { method: "get", path: "/reports/sources", summary: "Report sources: the record types a report can be built on, their columns (with types) and defaults.", operationId: "listReportSources", parameters: [], permissions: reportPermission("read"), responseSchema: objectSchema({ sources: arrayOf(ref("GenericObject")) }) },
  { method: "post", path: "/reports/preview", summary: "Run an unsaved definition as the caller. Projects where the caller cannot read the source's module are skipped and counted in `projects.denied`; party users see the rows the register would show them.", operationId: "previewReport", parameters: [], permissions: reportPermission("read"), requestBody: jsonBody(objectSchema({ ...reportDefinitionInput.properties, limit: { type: "integer", maximum: 1000 }, offset: { type: "integer" } }, ["source"]), "Definition."), responseSchema: reportResultSchema },
  { method: "post", path: "/reports/export", summary: "Render an unsaved definition to XLSX (default) or PDF — the 'export this view' behind every register.", operationId: "exportReportDefinition", parameters: [], permissions: reportPermission("export"), requestBody: jsonBody(objectSchema({ ...reportDefinitionInput.properties, format: { type: "string", enum: ["pdf", "xlsx"] } }, ["source"]), "Definition."), responseSchema: { type: "string", format: "binary" } },
  { method: "get", path: "/reports/runs/{runId}/download", summary: "Download a run's stored PDF or XLSX.", operationId: "downloadReportRun", parameters: [reportRunIdParam, queryParam("format", "pdf (default) or xlsx.", { type: "string", enum: ["pdf", "xlsx"] })], permissions: reportPermission("read"), responseSchema: { type: "string", format: "binary" } },
  { method: "get", path: "/reports", summary: "Saved reports visible to the caller (own, org-shared, project-shared on projects they can open) plus the source catalogue.", operationId: "listReports", parameters: [queryParam("projectId", "Only reports scoped to this project.", uuid), queryParam("source", "Only reports on this source.", { type: "string" })], permissions: reportPermission("read"), responseSchema: objectSchema({ items: arrayOf(reportDefinitionSchema), sources: arrayOf(ref("GenericObject")) }) },
  { method: "post", path: "/reports", summary: "Save a report definition.", operationId: "createReport", parameters: [], permissions: reportPermission("create"), requestBody: jsonBody(reportDefinitionInput, "Definition.", true), responseSchema: reportDefinitionSchema, status: 201 },
  { method: "get", path: "/reports/{reportId}", summary: "One saved report.", operationId: "getReport", parameters: [reportIdParam], permissions: reportPermission("read"), responseSchema: reportDefinitionSchema },
  { method: "put", path: "/reports/{reportId}", summary: "Update a saved report (owner or PM).", operationId: "updateReport", parameters: [reportIdParam], permissions: reportPermission("update"), requestBody: jsonBody(reportDefinitionInput, "Fields to change.", false), responseSchema: reportDefinitionSchema },
  { method: "delete", path: "/reports/{reportId}", summary: "Delete a saved report (owner or PM); its schedules and runs go with it.", operationId: "deleteReport", parameters: [reportIdParam], permissions: reportPermission("delete"), responseSchema: objectSchema({ deleted: { type: "boolean" } }) },
  { method: "post", path: "/reports/{reportId}/run", summary: "Run a saved report and return rows (paged).", operationId: "runReport", parameters: [reportIdParam], permissions: reportPermission("read"), requestBody: jsonBody(objectSchema({ limit: { type: "integer", maximum: 1000 }, offset: { type: "integer" } }), "Paging.", false), responseSchema: objectSchema({ ...reportResultSchema.properties, report: reportDefinitionSchema }) },
  { method: "get", path: "/reports/{reportId}/export.pdf", summary: "Saved report as PDF.", operationId: "exportReportPdf", parameters: [reportIdParam], permissions: reportPermission("export"), responseSchema: { type: "string", format: "binary" } },
  { method: "get", path: "/reports/{reportId}/export.xlsx", summary: "Saved report as XLSX (Data, Summary and About sheets).", operationId: "exportReportXlsx", parameters: [reportIdParam], permissions: reportPermission("export"), responseSchema: { type: "string", format: "binary" } },
  { method: "get", path: "/reports/{reportId}/runs", summary: "Run history (files are kept for the last 30 runs).", operationId: "listReportRuns", parameters: [reportIdParam, queryParam("limit", "Max runs (default 20).", { type: "integer" })], permissions: reportPermission("read"), responseSchema: objectSchema({ items: arrayOf(reportRunSchema) }) },
  { method: "post", path: "/reports/{reportId}/runs", summary: "Render now: stores the files on a run and, with `deliver`, sends them to the recipients (defaults to the caller).", operationId: "createReportRun", parameters: [reportIdParam], permissions: reportPermission("export"), requestBody: jsonBody(objectSchema({ format: { type: "string", enum: ["pdf", "xlsx", "both"] }, deliver: { type: "boolean" }, recipients: objectSchema({ userIds: arrayOf(uuid), roles: arrayOf({ type: "string" }), emails: arrayOf({ type: "string" }) }) }), "Options.", false), responseSchema: reportRunSchema, status: 201 },
  { method: "get", path: "/reports/{reportId}/schedules", summary: "Schedules on a report.", operationId: "listReportSchedules", parameters: [reportIdParam], permissions: reportPermission("read"), responseSchema: objectSchema({ items: arrayOf(reportScheduleSchema) }) },
  { method: "post", path: "/reports/{reportId}/schedules", summary: "Schedule the report (daily / weekly / monthly at a local time); runs render as the schedule's owner and deliver in-app + email to users and roles, email to external addresses.", operationId: "createReportSchedule", parameters: [reportIdParam], permissions: reportPermission("update", "report.schedule"), requestBody: jsonBody(reportScheduleInput, "Schedule.", false), responseSchema: reportScheduleSchema, status: 201 },
  { method: "patch", path: "/reports/{reportId}/schedules/{scheduleId}", summary: "Change or pause a schedule.", operationId: "updateReportSchedule", parameters: [reportIdParam, reportScheduleIdParam], permissions: reportPermission("update", "report.schedule"), requestBody: jsonBody(reportScheduleInput, "Fields to change.", false), responseSchema: reportScheduleSchema },
  { method: "delete", path: "/reports/{reportId}/schedules/{scheduleId}", summary: "Remove a schedule.", operationId: "deleteReportSchedule", parameters: [reportIdParam, reportScheduleIdParam], permissions: reportPermission("update", "report.schedule"), responseSchema: objectSchema({ deleted: { type: "boolean" } }) },
  { method: "get", path: "/portfolio", summary: "Portfolio: one row per project the caller can open, read from the latest health snapshot (health score + dimensions, SPI / CPI / EV / PV / AC / EAC, cash next 90 days, open and overdue items), with a summary and a `stale` flag when a snapshot is older than two hours.", operationId: "getPortfolio", parameters: [], permissions: modulePermission("portfolio", "read"), responseSchema: objectSchema({ generatedAt: dateString, computedAt: nullableDateString, refreshing: { type: "boolean" }, summary: ref("GenericObject"), rows: arrayOf(ref("GenericObject")) }) },
  { method: "post", path: "/portfolio/refresh", summary: "Queue a snapshot refresh for the organisation (returns the running job when one is already queued).", operationId: "refreshPortfolio", parameters: [], permissions: modulePermission("portfolio", "read"), responseSchema: objectSchema({ jobId: uuid, status: { type: "string" }, queued: { type: "boolean" } }), status: 202 },
  { method: "get", path: "/portfolio/export.xlsx", summary: "Portfolio table as XLSX.", operationId: "exportPortfolioXlsx", parameters: [], permissions: modulePermission("portfolio", "export"), responseSchema: { type: "string", format: "binary" } },
].forEach((route) => addGenericRoute({ tag: "Reports", ...route }));

// ─── Daily log (OCTA-FLD-DAILY-022) ────────────────────────────────────────
const dailyLogDateParam = pathParam("date", "Calendar day, YYYY-MM-DD.");
const dailyLogSectionParam = pathParam("section", "manpower, equipment, deliveries, visitors, delays or notes.");
const dailyLogEntryIdParam = pathParam("entryId", "Entry UUID.");
const dailyLogSections = ["manpower", "equipment", "deliveries", "visitors", "delays", "notes"];
const dailyLogEntryStatuses = ["draft", "submitted", "approved", "rejected"];
const dailyLogStatuses = ["open", "submitted", "approved"];
const dailyLogDateRangeParams = [queryParam("from", "First day (YYYY-MM-DD); defaults to 30 days before `to`.", { type: "string" }), queryParam("to", "Last day (YYYY-MM-DD); defaults to today.", { type: "string" })];
const dailyLogWeatherSchema = objectSchema({
  source: { type: "string", nullable: true, description: "open-meteo or manual" },
  date: { type: "string", nullable: true },
  code: { type: "integer", nullable: true, description: "WMO weather code" },
  condition: { type: "string", nullable: true },
  tempMinC: { type: "number", nullable: true },
  tempMaxC: { type: "number", nullable: true },
  precipitationMm: { type: "number", nullable: true },
  windMaxKph: { type: "number", nullable: true },
  windGustKph: { type: "number", nullable: true },
  summary: { type: "string", nullable: true },
  notes: { type: "string", nullable: true },
  alerts: arrayOf(objectSchema({ metric: { type: "string", enum: ["rain", "cold", "heat", "wind"] }, value: { type: "number" }, threshold: { type: "number" }, message: { type: "string" } })),
});
const dailyLogEntrySchema = objectSchema({
  id: uuid,
  section: { type: "string", enum: dailyLogSections },
  dailyLogId: uuid,
  partyId: nullableUuid,
  party: nullableRef("GenericObject"),
  status: { type: "string", enum: dailyLogEntryStatuses },
  createdBy: nullableUuid,
  submittedAt: nullableDateString,
  reviewedBy: nullableUuid,
  reviewedAt: nullableDateString,
  rejectionReason: { type: "string", nullable: true },
  clientRequestId: { type: "string", nullable: true },
  sortOrder: { type: "integer" },
  companyId: nullableUuid,
  companyName: { type: "string", nullable: true },
  trade: { type: "string", nullable: true },
  workers: { type: "integer", nullable: true },
  hours: { type: "number", nullable: true, description: "Hours per worker." },
  manHours: { type: "number", nullable: true },
  equipmentId: nullableUuid,
  equipment: nullableRef("GenericObject"),
  name: { type: "string", nullable: true },
  count: { type: "integer", nullable: true },
  hoursOperated: { type: "number", nullable: true },
  hoursIdle: { type: "number", nullable: true },
  supplierName: { type: "string", nullable: true },
  description: { type: "string", nullable: true },
  quantity: { type: "number", nullable: true },
  unit: { type: "string", nullable: true },
  poRef: { type: "string", nullable: true },
  receivedBy: { type: "string", nullable: true },
  deliveredAt: nullableDateString,
  company: { type: "string", nullable: true },
  purpose: { type: "string", nullable: true },
  arrivedAt: nullableDateString,
  leftAt: nullableDateString,
  type: { type: "string", nullable: true, description: "Delay type." },
  hoursLost: { type: "number", nullable: true },
  source: { type: "string", nullable: true, description: "manual or weather_feed" },
  weatherDelayId: nullableUuid,
  suggested: { type: "boolean", nullable: true, description: "Weather-feed suggestion not yet confirmed." },
  kind: { type: "string", nullable: true, description: "Note kind." },
  text: { type: "string", nullable: true },
  activityId: nullableUuid,
  activity: nullableRef("GenericObject"),
  locationId: nullableUuid,
  location: nullableRef("GenericObject"),
  notes: { type: "string", nullable: true },
  createdAt: nullableDateString,
  updatedAt: nullableDateString,
});
const dailyLogTotalsSchema = objectSchema({
  workers: { type: "integer" },
  manHours: { type: "number" },
  companies: { type: "integer" },
  equipmentCount: { type: "integer" },
  equipmentHours: { type: "number" },
  idleHours: { type: "number" },
  deliveries: { type: "integer" },
  visitors: { type: "integer" },
  hoursLost: { type: "number" },
  notes: { type: "integer" },
  entries: { type: "integer" },
  awaitingReview: { type: "integer" },
  suggestedDelays: { type: "integer" },
});
const dailyLogSchema = objectSchema({
  id: nullableUuid,
  exists: { type: "boolean", description: "false when nothing has been logged for the day yet (virtual, empty log)." },
  projectId: uuid,
  date: { type: "string", example: "2026-09-05" },
  status: { type: "string", enum: dailyLogStatuses },
  weather: { ...dailyLogWeatherSchema, nullable: true },
  weatherSource: { type: "string", nullable: true, enum: ["feed", "manual", null] },
  weatherFetchedAt: nullableDateString,
  summary: { type: "string", nullable: true },
  submittedAt: nullableDateString,
  submittedBy: nullableUuid,
  approvedAt: nullableDateString,
  approvedBy: nullableUuid,
  distributedAt: nullableDateString,
  distribution: nullableRef("GenericObject"),
  pdfDocumentId: nullableUuid,
  sections: objectSchema(Object.fromEntries(dailyLogSections.map((section) => [section, arrayOf(dailyLogEntrySchema)]))),
  totals: dailyLogTotalsSchema,
  path: { type: "string" },
  entryId: { type: "string", nullable: true, description: "Set on entry creation." },
  replayed: { type: "boolean", nullable: true, description: "true when a clientRequestId matched an earlier entry." },
  copy: nullableRef("GenericObject"),
  alerts: arrayOf(ref("GenericObject")),
  createdAt: nullableDateString,
  updatedAt: nullableDateString,
});
const dailyLogSettingsSchema = objectSchema({
  projectId: uuid,
  latitude: { type: "number", nullable: true },
  longitude: { type: "number", nullable: true },
  timezone: { type: "string", nullable: true, description: "IANA name." },
  weatherFeedAvailable: { type: "boolean", description: "Server-side feed switch (WEATHER_FEED_ENABLED)." },
  hasCoordinates: { type: "boolean" },
  weatherFeedEnabled: { type: "boolean" },
  thresholds: objectSchema({ rainMm: { type: "number", nullable: true }, tempMinC: { type: "number", nullable: true }, tempMaxC: { type: "number", nullable: true }, windKph: { type: "number", nullable: true } }),
  distributionRoles: arrayOf({ type: "string" }),
  distributionRoleOptions: arrayOf({ type: "string" }),
  distributionEmails: arrayOf({ type: "string" }),
  autoDistributeAt: { type: "string", nullable: true, example: "18:00" },
  copySections: arrayOf({ type: "string", enum: dailyLogSections }),
});
const dailyLogEntryInput = objectSchema({
  clientRequestId: { type: "string", nullable: true, description: "Offline idempotency key." },
  partyId: nullableUuid,
  companyId: nullableUuid,
  companyName: { type: "string", nullable: true },
  trade: { type: "string", nullable: true },
  workers: { type: "integer", nullable: true },
  hours: { type: "number", nullable: true },
  equipmentId: nullableUuid,
  name: { type: "string", nullable: true },
  count: { type: "integer", nullable: true },
  hoursOperated: { type: "number", nullable: true },
  hoursIdle: { type: "number", nullable: true },
  supplierName: { type: "string", nullable: true },
  description: { type: "string", nullable: true },
  quantity: { type: "number", nullable: true },
  unit: { type: "string", nullable: true },
  poRef: { type: "string", nullable: true },
  receivedBy: { type: "string", nullable: true },
  deliveredAt: { type: "string", nullable: true, description: "ISO timestamp or HH:mm." },
  company: { type: "string", nullable: true },
  purpose: { type: "string", nullable: true },
  arrivedAt: { type: "string", nullable: true },
  leftAt: { type: "string", nullable: true },
  type: { type: "string", nullable: true },
  hoursLost: { type: "number", nullable: true },
  kind: { type: "string", nullable: true },
  text: { type: "string", nullable: true },
  activityId: nullableUuid,
  locationId: nullableUuid,
  notes: { type: "string", nullable: true },
  status: { type: "string", nullable: true, enum: ["draft", "approved", null] },
});
const dailyLogPermission = (action, transition = null) => modulePermission("progress", action, transition);
[
  { method: "get", path: "/projects/{projectId}/daily-logs/settings", summary: "Daily log settings: site coordinates, time zone, weather thresholds, distribution list, send time.", operationId: "getDailyLogSettings", parameters: projectParams, permissions: dailyLogPermission("read"), responseSchema: dailyLogSettingsSchema },
  { method: "put", path: "/projects/{projectId}/daily-logs/settings", summary: "Update daily log settings (PM).", operationId: "updateDailyLogSettings", parameters: projectParams, permissions: dailyLogPermission("approve", "daily_log.configure"), requestBody: jsonBody(objectSchema({ latitude: { type: "number", nullable: true }, longitude: { type: "number", nullable: true }, timezone: { type: "string", nullable: true }, weatherFeedEnabled: { type: "boolean" }, thresholds: ref("GenericObject"), distributionRoles: arrayOf({ type: "string" }), distributionEmails: arrayOf({ type: "string" }), autoDistributeAt: { type: "string", nullable: true }, copySections: arrayOf({ type: "string" }) }), "Settings.", false), responseSchema: dailyLogSettingsSchema },
  { method: "get", path: "/projects/{projectId}/daily-logs/manpower-report", summary: "Manpower across days grouped by company, trade, company × trade or activity, with a per-day series.", operationId: "getDailyLogManpowerReport", parameters: [...projectParams, ...dailyLogDateRangeParams, queryParam("groupBy", "company (default), trade, company_trade or activity.", { type: "string", enum: ["company", "trade", "company_trade", "activity"] })], permissions: dailyLogPermission("read"), responseSchema: objectSchema({ from: { type: "string" }, to: { type: "string" }, groupBy: { type: "string" }, items: arrayOf(ref("GenericObject")), byDate: arrayOf(objectSchema({ date: { type: "string" }, workers: { type: "integer" }, manHours: { type: "number" } })), totals: ref("GenericObject") }) },
  { method: "get", path: "/projects/{projectId}/daily-logs", summary: "Days with a log in the range, with totals and weather headline.", operationId: "listDailyLogs", parameters: [...projectParams, ...dailyLogDateRangeParams], permissions: dailyLogPermission("read"), responseSchema: objectSchema({ from: { type: "string" }, to: { type: "string" }, items: arrayOf(ref("GenericObject")) }) },
  { method: "get", path: "/projects/{projectId}/daily-logs/{date}", summary: "The day's log with every section. Party users see their own company's entries only.", operationId: "getDailyLog", parameters: [...projectParams, dailyLogDateParam], permissions: dailyLogPermission("read"), responseSchema: dailyLogSchema },
  { method: "patch", path: "/projects/{projectId}/daily-logs/{date}", summary: "Set the day's summary and/or manual weather (`weather: null` clears it).", operationId: "updateDailyLog", parameters: [...projectParams, dailyLogDateParam], permissions: dailyLogPermission("update", "daily_log.update"), requestBody: jsonBody(objectSchema({ summary: { type: "string", nullable: true }, weather: { ...dailyLogWeatherSchema, nullable: true } }), "Fields.", false), responseSchema: dailyLogSchema },
  { method: "get", path: "/projects/{projectId}/daily-logs/{date}/export.pdf", summary: "The day's log as PDF (same content as the screen).", operationId: "exportDailyLogPdf", parameters: [...projectParams, dailyLogDateParam], permissions: dailyLogPermission("export"), responseSchema: { type: "string", format: "binary" } },
  { method: "post", path: "/projects/{projectId}/daily-logs/{date}/weather/refresh", summary: "Fetch the day's weather from the feed by project coordinates; threshold breaches add a suggested weather delay.", operationId: "refreshDailyLogWeather", parameters: [...projectParams, dailyLogDateParam], permissions: dailyLogPermission("update", "daily_log.update"), responseSchema: dailyLogSchema },
  { method: "post", path: "/projects/{projectId}/daily-logs/{date}/copy-previous", summary: "Copy manpower and/or equipment from the most recent earlier day (last two weeks) into this day; sections that already have entries are skipped.", operationId: "copyPreviousDailyLog", parameters: [...projectParams, dailyLogDateParam], permissions: dailyLogPermission("submit", "daily_log.submit"), requestBody: jsonBody(objectSchema({ sections: arrayOf({ type: "string", enum: ["manpower", "equipment"] }) }), "Sections to copy.", false), responseSchema: dailyLogSchema },
  { method: "post", path: "/projects/{projectId}/daily-logs/{date}/submit", summary: "Submit the day for approval.", operationId: "submitDailyLog", parameters: [...projectParams, dailyLogDateParam], permissions: dailyLogPermission("submit", "daily_log.submit"), responseSchema: dailyLogSchema },
  { method: "post", path: "/projects/{projectId}/daily-logs/{date}/approve", summary: "Approve the day; entries still awaiting review are approved with it.", operationId: "approveDailyLog", parameters: [...projectParams, dailyLogDateParam], permissions: dailyLogPermission("approve", "daily_log.approve"), responseSchema: dailyLogSchema },
  { method: "post", path: "/projects/{projectId}/daily-logs/{date}/reopen", summary: "Reopen a submitted or approved day.", operationId: "reopenDailyLog", parameters: [...projectParams, dailyLogDateParam], permissions: dailyLogPermission("approve", "daily_log.approve"), requestBody: jsonBody(objectSchema({ reason: { type: "string", nullable: true } }), "Reason.", false), responseSchema: dailyLogSchema },
  { method: "post", path: "/projects/{projectId}/daily-logs/{date}/distribute", summary: "Render the PDF, file it on the day and send it: in-app + email to the roles / users, plain-text digest to external addresses. Defaults to the project's distribution list.", operationId: "distributeDailyLog", parameters: [...projectParams, dailyLogDateParam], permissions: dailyLogPermission("submit", "daily_log.distribute"), requestBody: jsonBody(objectSchema({ roles: arrayOf({ type: "string" }), userIds: arrayOf(uuid), emails: arrayOf({ type: "string" }), note: { type: "string", nullable: true } }), "Recipients override.", false), responseSchema: dailyLogSchema },
  { method: "post", path: "/projects/{projectId}/daily-logs/{date}/entries/{section}", summary: "Add an entry. Staff entries are approved at once; party (collaborator) entries are submitted for review. Accepts `clientRequestId` for offline replay.", operationId: "addDailyLogEntry", parameters: [...projectParams, dailyLogDateParam, dailyLogSectionParam], permissions: dailyLogPermission("submit", "daily_log.submit"), requestBody: jsonBody(dailyLogEntryInput, "Entry; fields depend on the section."), responseSchema: dailyLogSchema, status: 201 },
  { method: "patch", path: "/projects/{projectId}/daily-logs/{date}/entries/{section}/{entryId}", summary: "Edit an entry (party users: their own company's only; edits resubmit).", operationId: "updateDailyLogEntry", parameters: [...projectParams, dailyLogDateParam, dailyLogSectionParam, dailyLogEntryIdParam], permissions: dailyLogPermission("submit", "daily_log.submit"), requestBody: jsonBody(dailyLogEntryInput, "Fields to change.", false), responseSchema: dailyLogSchema },
  { method: "delete", path: "/projects/{projectId}/daily-logs/{date}/entries/{section}/{entryId}", summary: "Remove an entry.", operationId: "deleteDailyLogEntry", parameters: [...projectParams, dailyLogDateParam, dailyLogSectionParam, dailyLogEntryIdParam], permissions: dailyLogPermission("submit", "daily_log.submit"), responseSchema: dailyLogSchema },
  { method: "post", path: "/projects/{projectId}/daily-logs/{date}/entries/{section}/{entryId}/review", summary: "Accept or return a collaborator's entry (also confirms a weather-feed suggestion).", operationId: "reviewDailyLogEntry", parameters: [...projectParams, dailyLogDateParam, dailyLogSectionParam, dailyLogEntryIdParam], permissions: dailyLogPermission("approve", "daily_log.entry_review"), requestBody: jsonBody(objectSchema({ decision: { type: "string", enum: ["approve", "reject"] }, reason: { type: "string", nullable: true } }, ["decision"]), "Decision."), responseSchema: dailyLogSchema },
  { method: "post", path: "/projects/{projectId}/daily-logs/{date}/entries/delays/{entryId}/weather-delay", summary: "Put a delay on the contractual weather-delay register (days default to hours lost ÷ 8).", operationId: "logDailyLogWeatherDelay", parameters: [...projectParams, dailyLogDateParam, dailyLogEntryIdParam], permissions: dailyLogPermission("update", "daily_log.update"), requestBody: jsonBody(objectSchema({ delayDays: { type: "number", nullable: true }, contractual: { type: "boolean" }, description: { type: "string", nullable: true }, activityIds: arrayOf(uuid) }), "Register details.", false), responseSchema: dailyLogSchema },
].forEach((route) => addGenericRoute({ tag: "Site Reporting", ...route }));

// ─── Daily report auto-draft (OCTA-AI-DAILY-030) ──────────────────────────
const dailyLogAiNote = objectSchema({ kind: { type: "string", enum: ["general", "safety", "instruction", "inspection", "issue"] }, text: { type: "string" } });
const dailyLogAiDelay = objectSchema({ type: { type: "string", enum: ["weather", "access", "design", "material", "labour", "equipment", "inspection", "utility", "other"] }, description: { type: "string" }, hoursLost: { type: "number" } });
const dailyLogAiDraftSchema = objectSchema({ summary: { type: "string" }, workPerformed: arrayOf(objectSchema({ text: { type: "string" }, activity: { type: "string", nullable: true }, sources: arrayOf({ type: "string" }) })), notes: arrayOf(dailyLogAiNote), delays: arrayOf(dailyLogAiDelay), photoCaptions: arrayOf(objectSchema({ photoId: uuid, ref: { type: "string" }, caption: { type: "string" }, existing: { type: "string", nullable: true } })), missing: arrayOf({ type: "string" }), confidence: { type: "string", enum: ["high", "medium", "low"] } });
const dailyLogAiPhotoSchema = objectSchema({ id: uuid, ref: { type: "string" }, caption: { type: "string", nullable: true }, takenAt: nullableDateString, thumbnailUrl: { type: "string" }, locationName: { type: "string", nullable: true }, tags: arrayOf({ type: "string" }), included: { type: "boolean", description: "Sent to the model as an image." } });
[
  { method: "get", path: "/projects/{projectId}/daily-logs/ai/status", summary: "Whether AI drafting, image reading (vision) and voice transcription are configured, and how many photos a draft may look at.", operationId: "dailyLogAiStatus", parameters: projectParams, permissions: dailyLogPermission("read"), responseSchema: objectSchema({ enabled: { type: "boolean" }, provider: { type: "string", nullable: true }, model: { type: "string", nullable: true }, vision: { type: "boolean" }, transcription: { type: "boolean" }, maxPhotos: { type: "integer" } }) },
  { method: "post", path: "/projects/{projectId}/daily-logs/ai/transcribe", summary: "Transcribe a voice note (webm / mp4 / ogg / wav, ≤ 25 MB) for the daily report. 503 AI_TRANSCRIPTION_NOT_CONFIGURED without OPENAI_API_KEY.", operationId: "transcribeDailyLogVoiceNote", parameters: projectParams, permissions: dailyLogPermission("submit", "daily_log.submit"), requestBody: fileUploadBody({ fieldName: "audio", description: "The recording.", accepted: "Audio recording.", extraProperties: { language: { type: "string", description: "ISO-639-1 hint, e.g. en." } } }), responseSchema: objectSchema({ text: { type: "string" }, provider: { type: "string" }, model: { type: "string" } }) },
  { method: "post", path: "/projects/{projectId}/daily-logs/{date}/ai/draft", summary: "Draft the day's report from what was logged, progress updates, inspections, punch items / observations, safety incidents, the day's photos (as images when the provider reads them) and the dictated notes. Nothing is written; without a provider a factual draft is built from the records (`degraded`).", operationId: "draftDailyLogWithAi", parameters: [...projectParams, dailyLogDateParam], permissions: dailyLogPermission("update", "daily_log.update"), requestBody: jsonBody(objectSchema({ notes: { type: "string", nullable: true, description: "Dictated or typed notes." }, includePhotos: { type: "boolean", description: "Send the day's photos as images (default true)." }, photoIds: arrayOf(uuid) }), "Inputs.", false), responseSchema: objectSchema({ degraded: { type: "boolean" }, reason: { type: "string", nullable: true }, date: { type: "string" }, draft: dailyLogAiDraftSchema, evidence: objectSchema({ photos: arrayOf(dailyLogAiPhotoSchema), counts: ref("GenericObject"), includedImages: { type: "integer" } }), message: nullableRef("GenericObject") }) },
  { method: "post", path: "/projects/{projectId}/daily-logs/{date}/ai/apply", summary: "Apply the parts of a draft the person kept: the summary, notes and delays as entries, captions on photos (existing captions only with `overwriteCaptions`). Every write goes through the daily log's own service.", operationId: "applyDailyLogAiDraft", parameters: [...projectParams, dailyLogDateParam], permissions: dailyLogPermission("update", "daily_log.update"), requestBody: jsonBody(objectSchema({ summary: { type: "string", nullable: true }, notes: arrayOf(dailyLogAiNote), delays: arrayOf(dailyLogAiDelay), photoCaptions: arrayOf(objectSchema({ photoId: uuid, caption: { type: "string" } })), overwriteCaptions: { type: "boolean" } }), "What to apply.", false), responseSchema: objectSchema({ applied: objectSchema({ summary: { type: "boolean" }, notes: { type: "integer" }, delays: { type: "integer" }, captions: { type: "integer" }, skippedCaptions: { type: "integer" } }), log: dailyLogSchema }) },
].forEach((route) => addGenericRoute({ tag: "Assistant", ...route }));

// ─── Schedule delay and cost overrun prediction (OCTA-AI-PREDICT-031) ─────
const forecastLevel = { type: "string", enum: ["high", "medium", "low"] };
const forecastBlockerSchema = objectSchema({ type: { type: "string", enum: ["rfi", "submittal", "long_lead"] }, id: uuid, ref: { type: "string", nullable: true }, title: { type: "string" }, status: { type: "string", nullable: true }, due: nullableDateString, overdue: { type: "boolean" } });
const forecastActivitySchema = objectSchema({ id: uuid, name: { type: "string" }, code: { type: "string", nullable: true }, isCritical: { type: "boolean" }, isMilestone: { type: "boolean" }, status: { type: "string" }, pct: { type: "number" }, expectedPct: { type: "number", nullable: true }, gap: { type: "number" }, velocity: { type: "number", nullable: true, description: "% per day from approved progress in the last 45 days." }, lastProgressAt: nullableDateString, plannedStart: { type: "string", nullable: true }, plannedFinish: { type: "string", nullable: true }, projectedFinish: { type: "string", nullable: true }, basis: { type: "string", enum: ["complete", "planned", "velocity", "pace", "overdue", "late_start"] }, slipDays: { type: "integer" }, impactDays: { type: "number" }, float: { type: "number", nullable: true }, floatBreached: { type: "boolean" }, stalledDays: { type: "integer" }, blockers: arrayOf(forecastBlockerSchema), score: { type: "integer" }, level: forecastLevel, reasons: arrayOf({ type: "string" }), cost: objectSchema({ budget: { type: "number" }, actual: { type: "number" }, committed: { type: "number" }, projected: { type: "number", nullable: true }, basis: { type: "string", nullable: true }, overrun: { type: "number" }, overrunPct: { type: "number" }, level: forecastLevel, reasons: arrayOf({ type: "string" }) }) });
const forecastSchema = objectSchema({ available: { type: "boolean" }, reason: { type: "string", nullable: true }, asOf: dateString, schedule: nullableRef("GenericObject"), cost: nullableRef("GenericObject"), summary: nullableRef("GenericObject"), dataQuality: arrayOf({ type: "string" }), activities: arrayOf(forecastActivitySchema) });
const forecastActionSchema = objectSchema({ type: { type: "string", enum: ["create_risk", "create_task", "open"] }, label: { type: "string" }, activityId: nullableUuid, activityName: { type: "string", nullable: true }, title: { type: "string", nullable: true }, description: { type: "string", nullable: true }, probability: { ...forecastLevel, nullable: true }, impact: { ...forecastLevel, nullable: true }, mitigation: { type: "string", nullable: true } });
[
  { method: "get", path: "/projects/{projectId}/forecast", summary: "Schedule and cost forecast from the project's own records: per-activity velocity from approved progress, projected finish vs plan, float and critical path, recorded impacts (RFI / submittal / risk / weather links), open items holding the activity, burn-rate cost projection, budget lines over; project finish = later of EV-based and activity-based, cost = higher of EAC and bottom-up. No model call.", operationId: "getProjectForecast", parameters: projectParams, permissions: modulePermission("schedule", "read"), responseSchema: forecastSchema },
  { method: "post", path: "/projects/{projectId}/forecast/explain", summary: "Plain-language narrative of the forecast with up to five draft actions (create_risk, create_task, open); built from the forecast itself when no provider answers (`degraded`). 409 FORECAST_UNAVAILABLE without a schedule.", operationId: "explainProjectForecast", parameters: projectParams, permissions: modulePermission("schedule", "read"), responseSchema: objectSchema({ degraded: { type: "boolean" }, reason: { type: "string", nullable: true }, forecast: forecastSchema, narrative: objectSchema({ headline: { type: "string" }, schedule: { type: "string" }, cost: { type: "string" }, watch: arrayOf({ type: "string" }), actions: arrayOf(forecastActionSchema) }), message: nullableRef("GenericObject") }) },
  { method: "post", path: "/projects/{projectId}/forecast/actions", summary: "Run a confirmed action: create_risk (risk register, linked to the activity; needs risk.create) or create_task (needs task.create).", operationId: "runProjectForecastAction", parameters: projectParams, permissions: modulePermission("schedule", "read"), requestBody: jsonBody(objectSchema({ action: forecastActionSchema }, ["action"]), "Action."), responseSchema: objectSchema({ type: { type: "string" }, record: ref("GenericObject"), url: { type: "string" } }), status: 201 },
].forEach((route) => addGenericRoute({ tag: "Assistant", ...route }));

// ─── Contract intelligence (OCTA-AI-CONTRACT-032) ─────────────────────────
const contractForms = ["fidic_1999", "fidic_2017", "nec4", "jct_2016", "aia_a201", "custom"];
const contractClauseCategories = ["notice", "eot", "variation", "payment", "ld", "retention", "defects", "suspension", "force_majeure", "dispute", "other"];
const contractClauseSchema = objectSchema({ id: { type: "string" }, category: { type: "string", enum: contractClauseCategories }, reference: { type: "string", nullable: true }, title: { type: "string" }, summary: { type: "string", nullable: true }, days: { type: "integer", nullable: true }, excerpt: { type: "string", nullable: true }, documentId: { type: "string", nullable: true }, status: { type: "string", enum: ["draft", "confirmed", "rejected"] }, source: { type: "string", enum: ["model", "heuristic", "manual"] } });
const contractPeriods = { delayNoticeDays: { type: "integer" }, claimParticularsDays: { type: "integer" }, variationNoticeDays: { type: "integer" }, responseDays: { type: "integer" }, paymentDays: { type: "integer", nullable: true }, defectsLiabilityDays: { type: "integer", nullable: true }, ldCapPct: { type: "number", nullable: true } };
const contractProfileSchema = objectSchema({ projectId: uuid, exists: { type: "boolean" }, form: { type: "string", enum: contractForms }, formLabel: { type: "string" }, ...contractPeriods, documentIds: arrayOf(uuid), clauses: arrayOf(contractClauseSchema), references: ref("GenericObject"), extractedAt: nullableDateString, extractedModel: { type: "string", nullable: true }, confirmedBy: nullableUuid, confirmedAt: nullableDateString, updatedAt: nullableDateString, presets: arrayOf(ref("GenericObject")) });
const contractEventRecordTypes = ["weather_delay", "change_order", "rfi", "eot_claim", "correspondence"];
const contractNoticeItemSchema = objectSchema({ recordType: { type: "string", enum: contractEventRecordTypes }, recordId: uuid, kind: { type: "string", enum: ["delay", "variation", "incoming_notice"] }, ref: { type: "string", nullable: true }, title: { type: "string" }, date: nullableDateString, days: { type: "number" }, activityIds: arrayOf(uuid), required: { type: "boolean" }, status: { type: "string", enum: ["missed", "due", "late", "served", "not_required"] }, periodDays: { type: "integer" }, clauseReference: { type: "string", nullable: true }, deadline: nullableDateString, daysLeft: { type: "integer" }, served: nullableRef("GenericObject"), url: { type: "string" } });
const contractNoticeDraftSchema = objectSchema({ subject: { type: "string" }, body: { type: "string" }, clauseRefs: arrayOf({ type: "string" }), deadline: nullableDateString, daysLeft: { type: "integer" } });
const eotAssessmentSchema = objectSchema({ entitlement: { type: "string", enum: ["likely", "partial", "unlikely"] }, recommendedDays: { type: "integer" }, basis: arrayOf({ type: "string" }), gaps: arrayOf({ type: "string" }), concurrency: arrayOf({ type: "string" }), noticeCompliance: { type: "string" }, narrative: { type: "string" }, claimLetter: { type: "string", nullable: true } });
const eotClaimAiParam = pathParam("claimId", "EOT claim UUID.");
[
  { method: "get", path: "/projects/{projectId}/contract", summary: "The project's contract profile: form, notice / particulars / response periods, contract documents, clauses (with the presets for every form). Defaults are returned before anything is saved.", operationId: "getContractProfile", parameters: projectParams, permissions: modulePermission("eot", "read"), responseSchema: contractProfileSchema },
  { method: "put", path: "/projects/{projectId}/contract", summary: "Save the contract profile. Changing `form` applies that form's periods unless given; `confirm: true` marks every draft clause confirmed.", operationId: "updateContractProfile", parameters: projectParams, permissions: modulePermission("eot", "update"), requestBody: jsonBody(objectSchema({ form: { type: "string", enum: contractForms }, ...contractPeriods, documentIds: arrayOf(uuid), clauses: arrayOf(contractClauseSchema), confirm: { type: "boolean" } }), "Fields to change.", false), responseSchema: contractProfileSchema },
  { method: "post", path: "/projects/{projectId}/contract/extract", summary: "Read the contract documents (text already extracted) window by window and propose clauses — notice, EOT, variation, payment, LD, retention, defects… — stored on the profile as drafts with suggested periods; a text scan stands in when no provider answers (`degraded`). 400 CONTRACT_DOCUMENTS_REQUIRED, 409 CONTRACT_TEXT_UNAVAILABLE.", operationId: "extractContractClauses", parameters: projectParams, permissions: modulePermission("eot", "update"), requestBody: jsonBody(objectSchema({ documentIds: arrayOf(uuid) }), "Documents to read (added to the profile).", false), responseSchema: objectSchema({ degraded: { type: "boolean" }, reason: { type: "string", nullable: true }, profile: contractProfileSchema, proposed: arrayOf(contractClauseSchema), suggestedPeriods: ref("GenericObject"), documents: arrayOf(ref("GenericObject")), windowsRead: { type: "integer" } }) },
  { method: "get", path: "/projects/{projectId}/contract/notices", summary: "Notice monitor: every event that may carry an entitlement (contractual weather delays, change orders, RFIs with a schedule impact, EOT claims, incoming contractual notices) with the period that applies, the deadline and the outgoing notice that served it — linked, or matched by reference / activity — as served, late, due, missed or not required.", operationId: "getContractNoticeMonitor", parameters: projectParams, permissions: modulePermission("eot", "read"), responseSchema: objectSchema({ asOf: dateString, profile: ref("GenericObject"), summary: ref("GenericObject"), items: arrayOf(contractNoticeItemSchema) }) },
  { method: "post", path: "/projects/{projectId}/contract/notices/draft", summary: "Draft the notice letter for one event from its facts and the clauses on record (the standard template when no provider answers). Nothing is created.", operationId: "draftContractNotice", parameters: projectParams, permissions: modulePermission("document_control", "create"), requestBody: jsonBody(objectSchema({ recordType: { type: "string", enum: contractEventRecordTypes }, recordId: uuid, instructions: { type: "string", nullable: true } }, ["recordType", "recordId"]), "Event."), responseSchema: objectSchema({ degraded: { type: "boolean" }, reason: { type: "string", nullable: true }, event: contractNoticeItemSchema, draft: contractNoticeDraftSchema, message: nullableRef("GenericObject") }) },
  { method: "post", path: "/projects/{projectId}/contract/notices", summary: "Create the notice as an outgoing contractual correspondence (type notice) linked to the event.", operationId: "createContractNotice", parameters: projectParams, permissions: modulePermission("document_control", "create"), requestBody: jsonBody(objectSchema({ recordType: { type: "string", enum: contractEventRecordTypes }, recordId: uuid, subject: { type: "string" }, body: { type: "string" }, activityId: nullableUuid, date: nullableDateString }, ["recordType", "recordId", "subject", "body"]), "Notice."), responseSchema: objectSchema({ correspondence: ref("GenericObject"), linked: { type: "boolean" }, url: { type: "string" } }), status: 201 },
  { method: "post", path: "/projects/{projectId}/eot/{claimId}/ai/assess", summary: "Assess an EOT claim's entitlement against the clauses, its notices, the critical-path impact and the evidence on record (daily-log delays, attachments, correspondence): entitlement, recommended days, basis, gaps, concurrency, notice compliance, narrative and a claim letter. Built from the record when no provider answers.", operationId: "assessEotClaimEntitlement", parameters: [...projectParams, eotClaimAiParam], permissions: modulePermission("eot", "read"), responseSchema: objectSchema({ degraded: { type: "boolean" }, reason: { type: "string", nullable: true }, claim: ref("GenericObject"), assessment: eotAssessmentSchema, notices: arrayOf(contractNoticeItemSchema), evidence: ref("GenericObject"), message: nullableRef("GenericObject") }) },
  { method: "post", path: "/projects/{projectId}/eot/{claimId}/ai/apply", summary: "Write the kept analysis and / or claim letter onto the claim through the EOT service (draft claims).", operationId: "applyEotClaimAssessment", parameters: [...projectParams, eotClaimAiParam], permissions: modulePermission("eot", "update"), requestBody: jsonBody(objectSchema({ analysis: { type: "string", nullable: true }, claimLetter: { type: "string", nullable: true } }), "What to apply.", false), responseSchema: objectSchema({ applied: objectSchema({ analysis: { type: "boolean" }, claimLetter: { type: "boolean" } }), claim: ref("GenericObject") }) },
].forEach((route) => addGenericRoute({ tag: "Contract", ...route }));

// ─── Natural-language reporting (OCTA-AI-NLREPORT-033) ────────────────────
const reportNlDefinitionSchema = objectSchema({ name: { type: "string" }, description: { type: "string", nullable: true }, source: { type: "string" }, projectId: nullableUuid, columns: arrayOf({ type: "string" }), filters: arrayOf(ref("GenericObject")), sort: nullableRef("GenericObject"), groupBy: { type: "string", nullable: true }, aggregates: arrayOf(ref("GenericObject")), chart: nullableRef("GenericObject"), visibility: { type: "string", enum: ["private"] } });
const reportNarrativeSchema = objectSchema({ headline: { type: "string" }, summary: { type: "string" }, highlights: arrayOf({ type: "string" }), caveats: arrayOf({ type: "string" }) });
[
  { method: "post", path: "/reports/ask", summary: "Turn a question in plain words into a report-builder definition chosen only from the source catalogue, validated by the builder (anything unknown is dropped and listed in `warnings`), previewed as the caller (50 rows) and ready to open in the builder. Without a provider the question is read by keywords (`degraded`). Nothing is saved.", operationId: "askForReport", parameters: [], permissions: modulePermission("report", "read"), requestBody: jsonBody(objectSchema({ question: { type: "string" }, projectId: { ...uuid, nullable: true, description: "Limit to one project." } }, ["question"]), "Question."), responseSchema: objectSchema({ degraded: { type: "boolean" }, reason: { type: "string", nullable: true }, question: { type: "string" }, definition: reportNlDefinitionSchema, explanation: { type: "string", nullable: true }, assumptions: arrayOf({ type: "string" }), warnings: arrayOf({ type: "string" }), preview: nullableRef("GenericObject"), message: nullableRef("GenericObject") }) },
  { method: "post", path: "/reports/narrate", summary: "Run a definition (same body as /reports/preview) and summarise the result in plain words: headline, summary, highlights with numbers, caveats (truncation, skipped projects). Built from the numbers alone without a provider.", operationId: "narrateReport", parameters: [], permissions: modulePermission("report", "read"), requestBody: jsonBody(objectSchema({ source: { type: "string" }, projectId: nullableUuid, columns: arrayOf({ type: "string" }), filters: arrayOf(ref("GenericObject")), sort: nullableRef("GenericObject"), groupBy: { type: "string", nullable: true }, aggregates: arrayOf(ref("GenericObject")) }, ["source"]), "Definition."), responseSchema: objectSchema({ degraded: { type: "boolean" }, reason: { type: "string", nullable: true }, narrative: reportNarrativeSchema, result: ref("GenericObject"), message: nullableRef("GenericObject") }) },
].forEach((route) => addGenericRoute({ tag: "Assistant", ...route }));

// ─── Photo and safety intelligence (OCTA-AI-PHOTO-034) ────────────────────
const photoAiLevel = { type: "string", enum: ["low", "medium", "high"] };
const photoAiAnalysisSchema = objectSchema({ caption: { type: "string", nullable: true }, tags: arrayOf({ type: "string" }), scene: { type: "string", nullable: true }, activity: { type: "string", nullable: true }, locationHint: { type: "string", nullable: true }, quality: arrayOf(objectSchema({ text: { type: "string" }, severity: photoAiLevel })), safety: arrayOf(objectSchema({ hazard: { type: "string" }, description: { type: "string", nullable: true }, severity: photoAiLevel, confidence: photoAiLevel })), confidence: photoAiLevel });
const photoAiPhotoSchema = objectSchema({ id: uuid, documentId: uuid, caption: { type: "string", nullable: true }, tags: arrayOf({ type: "string" }), takenAt: nullableDateString, locationId: nullableUuid, locationName: { type: "string", nullable: true }, url: { type: "string" }, thumbnailUrl: { type: "string" } });
const photoAiResultSchema = objectSchema({ degraded: { type: "boolean" }, reason: { type: "string", nullable: true }, cached: { type: "boolean" }, photo: { ...photoAiPhotoSchema, nullable: true }, analysis: { ...photoAiAnalysisSchema, nullable: true }, analyzedAt: nullableDateString, message: nullableRef("GenericObject") });
const photoAiIdParam = pathParam("photoId", "Photo UUID.");
[
  { method: "get", path: "/projects/{projectId}/photos/ai/status", summary: "Whether a vision-capable provider is configured, whether uploads are analysed automatically (AI_PHOTO_AUTO) and the batch limit.", operationId: "photoAiStatus", parameters: projectParams, permissions: modulePermission("document_control", "read"), responseSchema: objectSchema({ enabled: { type: "boolean" }, provider: { type: "string", nullable: true }, model: { type: "string", nullable: true }, autoOnUpload: { type: "boolean" }, batchLimit: { type: "integer" } }) },
  { method: "post", path: "/projects/{projectId}/photos/ai/analyze", summary: "Analyse several photos — by id, or the uncaptioned ones in a date range — up to AI_PHOTO_BATCH; fresh analyses (< 24 h) are reused unless `force`. Each result: caption, tags, scene, activity, quality notes and safety findings with severity and confidence.", operationId: "analyzePhotosWithAi", parameters: projectParams, permissions: modulePermission("document_control", "create"), requestBody: jsonBody(objectSchema({ photoIds: arrayOf(uuid), from: nullableDateString, to: nullableDateString, uncaptionedOnly: { type: "boolean" }, force: { type: "boolean" }, limit: { type: "integer" } }), "Selection.", false), responseSchema: objectSchema({ items: arrayOf({ ...photoAiResultSchema, properties: { ...photoAiResultSchema.properties, photoId: uuid } }), analyzed: { type: "integer" }, cached: { type: "integer" }, safetyFindings: { type: "integer" }, limit: { type: "integer" } }) },
  { method: "get", path: "/projects/{projectId}/photos/{photoId}/ai", summary: "The latest stored analysis of a photo, if any.", operationId: "getPhotoAiAnalysis", parameters: [...projectParams, photoAiIdParam], permissions: modulePermission("document_control", "read"), responseSchema: photoAiResultSchema },
  { method: "post", path: "/projects/{projectId}/photos/{photoId}/ai/analyze", summary: "Analyse one photo with the vision provider (the original when ≤ 6 MB, else the thumbnail) with its context — project, location, time, caption, tags, attached records. Nothing is written; `degraded` without a vision provider. 409 PHOTO_AI_UNREADABLE.", operationId: "analyzePhotoWithAi", parameters: [...projectParams, photoAiIdParam], permissions: modulePermission("document_control", "create"), requestBody: jsonBody(objectSchema({ force: { type: "boolean", description: "Re-run even when a fresh analysis exists." } }), "Options.", false), responseSchema: photoAiResultSchema },
  { method: "post", path: "/projects/{projectId}/photos/{photoId}/ai/apply", summary: "Apply the kept caption (only when the photo has none, unless `overwrite`), add tags and fill an empty location through the photo service (audited).", operationId: "applyPhotoAiAnalysis", parameters: [...projectParams, photoAiIdParam], permissions: modulePermission("document_control", "create"), requestBody: jsonBody(objectSchema({ caption: { type: "string", nullable: true }, tags: arrayOf({ type: "string" }), locationId: nullableUuid, overwrite: { type: "boolean" } }), "What to apply.", false), responseSchema: objectSchema({ applied: ref("GenericObject"), photo: photoAiPhotoSchema }) },
  { method: "post", path: "/projects/{projectId}/photos/{photoId}/ai/observation", summary: "Raise a safety observation from a finding through the punch engine (kind observation, type safety, priority from severity, source = the photo) with the photo attached as evidence.", operationId: "raisePhotoSafetyObservation", parameters: [...projectParams, photoAiIdParam], permissions: modulePermission("punch", "create"), requestBody: jsonBody(objectSchema({ hazard: { type: "string" }, description: { type: "string", nullable: true }, severity: { ...photoAiLevel, nullable: true }, contributingCondition: { type: "string", nullable: true }, trade: { type: "string", nullable: true }, locationId: nullableUuid, assigneeCompanyId: nullableUuid, dueDate: nullableDateString }, ["hazard"]), "Finding."), responseSchema: objectSchema({ item: ref("GenericObject"), attached: { type: "boolean" }, url: { type: "string" } }), status: 201 },
].forEach((route) => addGenericRoute({ tag: "Assistant", ...route }));

// ─── Drawing intelligence (OCTA-AI-DWG-035) ────────────────────────────────
const drawingAiLevel = { type: "string", enum: ["low", "medium", "high"] };
const drawingAiImage = { type: "string", description: "Rendered page as a JPEG/PNG/WebP data URL (≤ ~2 MB)." };
const drawingAiFieldSchema = objectSchema({ confidence: { type: "number" }, source: { type: "string", enum: ["vision"] } });
const drawingAiProposalSchema = objectSchema({ number: { type: "string", nullable: true }, title: { type: "string", nullable: true }, revision: { type: "string", nullable: true }, date: { type: "string", nullable: true }, discipline: { type: "string", nullable: true }, scale: { type: "string", nullable: true }, drawnBy: { type: "string", nullable: true }, references: arrayOf({ type: "string" }), fields: objectSchema({ number: drawingAiFieldSchema, title: drawingAiFieldSchema, revision: drawingAiFieldSchema }), notes: { type: "string", nullable: true } });
const drawingAiSheetSchema = objectSchema({ id: uuid, number: { type: "string" }, title: { type: "string", nullable: true }, discipline: { type: "string", nullable: true }, status: { type: "string" }, path: { type: "string" } });
const drawingAiReferenceSchema = objectSchema({ id: uuid, sheetId: uuid, revisionId: nullableUuid, targetNumber: { type: "string" }, targetSheet: { ...drawingAiSheetSchema, nullable: true }, sheet: { ...drawingAiSheetSchema, nullable: true }, count: { type: "integer" }, samples: arrayOf({ type: "string" }), source: { type: "string", enum: ["text", "vision", "manual"] }, updatedAt: nullableDateString });
const drawingAiReferencesSchema = objectSchema({ sheetId: uuid, outgoing: arrayOf(drawingAiReferenceSchema), incoming: arrayOf(drawingAiReferenceSchema), builtAt: nullableDateString, built: { type: "integer" }, textStatus: { type: "string", enum: ["ready", "no_text", "no_revision"] } });
const drawingAiSetIdParam = pathParam("setId", "Drawing set UUID.");
const drawingAiSheetIdParam = pathParam("sheetId", "Sheet UUID.");
[
  { method: "get", path: "/projects/{projectId}/drawings/ai/status", summary: "Whether a vision-capable provider is configured for title-block reading and revision comparison, and the per-call page limit (AI_DRAWING_PAGES).", operationId: "drawingAiStatus", parameters: projectParams, permissions: modulePermission("document_control", "read"), responseSchema: objectSchema({ vision: { type: "boolean" }, provider: { type: "string", nullable: true }, model: { type: "string", nullable: true }, pageLimit: { type: "integer" } }) },
  { method: "post", path: "/projects/{projectId}/drawings/ai/sets/{setId}/read", summary: "Read the title blocks of rendered pages of a set with the vision provider (for scans without a text layer, or low-confidence detections): number, title, revision, date, discipline, scale and the sheet numbers called out, with per-field confidence. Proposals only — with `apply`, empty fields of pending pages are filled (all fields with `overwrite`) through the review endpoint. `degraded` without a vision provider.", operationId: "readDrawingTitleBlocksWithAi", parameters: [...projectParams, drawingAiSetIdParam], permissions: modulePermission("document_control", "submit"), requestBody: jsonBody(objectSchema({ pages: arrayOf(objectSchema({ revisionId: uuid, image: drawingAiImage }, ["revisionId", "image"])), apply: { type: "boolean" }, overwrite: { type: "boolean" } }, ["pages"]), "Rendered pages (max AI_DRAWING_PAGES, default 8)."), responseSchema: objectSchema({ degraded: { type: "boolean" }, reason: { type: "string", nullable: true }, items: arrayOf(objectSchema({ revisionId: uuid, pageNumber: { type: "integer", nullable: true }, current: nullableRef("GenericObject"), proposal: { ...drawingAiProposalSchema, nullable: true }, error: { type: "string", nullable: true }, message: nullableRef("GenericObject") })), applied: { type: "integer" }, limit: { type: "integer" } }) },
  { method: "post", path: "/projects/{projectId}/drawings/ai/sets/{setId}/references", summary: "Build the cross-references of every published sheet of a set from the text layer (sheet numbers and detail callouts such as 3/A-501 that name another sheet of the project) — deterministic, one PDF parse per source document; stale text-sourced links are removed.", operationId: "buildDrawingSetReferences", parameters: [...projectParams, drawingAiSetIdParam], permissions: modulePermission("document_control", "submit"), responseSchema: objectSchema({ setId: uuid, sheetsBuilt: { type: "integer" }, references: { type: "integer" }, noText: { type: "integer" }, revisions: { type: "integer" } }) },
  { method: "get", path: "/projects/{projectId}/drawings/ai/sheets/{sheetId}/references", summary: "Outgoing links of a sheet (with the resolved target sheet and its workspace path) and the sheets that reference it.", operationId: "listSheetReferences", parameters: [...projectParams, drawingAiSheetIdParam], permissions: modulePermission("document_control", "read"), responseSchema: drawingAiReferencesSchema },
  { method: "post", path: "/projects/{projectId}/drawings/ai/sheets/{sheetId}/references", summary: "Rebuild one sheet's outgoing links from its current published revision's text layer.", operationId: "buildSheetReferences", parameters: [...projectParams, drawingAiSheetIdParam], permissions: modulePermission("document_control", "submit"), responseSchema: drawingAiReferencesSchema },
  { method: "post", path: "/projects/{projectId}/drawings/ai/sheets/{sheetId}/compare", summary: "Explain the differences between two rendered revisions of a sheet (A earlier, B later) with the vision provider: summary and a list of changes with area, kind (added/removed/modified) and site impact. Stored as a sheet_diff run; nothing is written to the sheet. `degraded` without a vision provider.", operationId: "compareSheetRevisionsWithAi", parameters: [...projectParams, drawingAiSheetIdParam], permissions: modulePermission("document_control", "read"), requestBody: jsonBody(objectSchema({ a: objectSchema({ revisionId: uuid, image: drawingAiImage }, ["revisionId", "image"]), b: objectSchema({ revisionId: uuid, image: drawingAiImage }, ["revisionId", "image"]) }, ["a", "b"]), "The two rendered revisions."), responseSchema: objectSchema({ degraded: { type: "boolean" }, reason: { type: "string", nullable: true }, sheet: nullableRef("GenericObject"), from: nullableRef("GenericObject"), to: nullableRef("GenericObject"), comparison: { ...objectSchema({ summary: { type: "string" }, changes: arrayOf(objectSchema({ area: { type: "string", nullable: true }, description: { type: "string" }, kind: { type: "string", enum: ["added", "removed", "modified"] }, impact: drawingAiLevel })), confidence: drawingAiLevel }), nullable: true }, message: nullableRef("GenericObject") }) },
].forEach((route) => addGenericRoute({ tag: "Assistant", ...route }));

// ─── Specifications and scope intelligence (OCTA-AI-SPEC-036) ─────────────
const specLevel = { type: "string", enum: ["low", "medium", "high"] };
const specBasis = { type: "string", enum: ["code", "title", "division", "discipline", "spec_section"] };
const specSectionSchema = objectSchema({ id: uuid, documentId: uuid, document: nullableRef("GenericObject"), code: { type: "string", example: "03 30 00" }, codeKey: { type: "string", example: "033000" }, division: { type: "string", nullable: true, example: "03" }, divisionLabel: { type: "string", nullable: true }, title: { type: "string" }, pageFrom: { type: "integer", nullable: true }, pageTo: { type: "integer", nullable: true }, wordCount: { type: "integer" }, sortOrder: { type: "integer" }, path: { type: "string" } });
const specRelatedSchema = objectSchema({ boqItems: arrayOf(objectSchema({ id: uuid, code: { type: "string", nullable: true }, description: { type: "string" }, unit: { type: "string", nullable: true }, qty: { type: "number" }, basis: specBasis, score: { type: "number" } })), sheets: arrayOf(objectSchema({ id: uuid, number: { type: "string" }, title: { type: "string" }, discipline: { type: "string", nullable: true }, currentRevisionId: nullableUuid, basis: specBasis, score: { type: "number" }, path: { type: "string" } })), activities: arrayOf(objectSchema({ id: uuid, name: { type: "string" }, activityCode: { type: "string", nullable: true }, wbsCode: { type: "string", nullable: true }, basis: specBasis, score: { type: "number" } })), rfis: arrayOf(objectSchema({ id: uuid, ref: { type: "string" }, subject: { type: "string" }, status: { type: "string" }, basis: specBasis, score: { type: "number" }, path: { type: "string" } })), keywords: arrayOf({ type: "string" }), disciplines: arrayOf({ type: "string" }) });
const specDocumentSchema = objectSchema({ id: uuid, title: { type: "string" }, originalName: { type: "string" }, documentNumber: { type: "string", nullable: true }, category: { type: "string", nullable: true }, discipline: { type: "string", nullable: true }, mimeType: { type: "string" }, uploadedAt: nullableDateString, wordCount: { type: "integer" }, pageCount: { type: "integer", nullable: true }, sections: { type: "integer" }, indexedAt: nullableDateString, likelySpec: { type: "boolean" } });
const specGapSchema = objectSchema({ sections: arrayOf({ ...specSectionSchema, properties: { ...specSectionSchema.properties, counts: objectSchema({ boq: { type: "integer" }, sheets: { type: "integer" }, sheetsByDiscipline: { type: "integer" }, activities: { type: "integer" }, rfis: { type: "integer" } }), gaps: arrayOf({ type: "string", enum: ["no_boq", "no_drawings", "no_activities"] }), keywords: arrayOf({ type: "string" }) } }), summary: objectSchema({ sections: { type: "integer" }, withGaps: { type: "integer" }, noBoq: { type: "integer" }, noDrawings: { type: "integer" }, noActivities: { type: "integer" }, boqItems: { type: "integer" }, uncoveredBoq: { type: "integer" }, sheets: { type: "integer" }, activities: { type: "integer" } }), uncoveredBoq: arrayOf(objectSchema({ id: uuid, code: { type: "string", nullable: true }, description: { type: "string" }, unit: { type: "string", nullable: true }, qty: { type: "number" } })), uncoveredDisciplines: arrayOf(objectSchema({ discipline: { type: "string" }, sheets: { type: "integer" } })), notes: arrayOf({ type: "string" }), computedAt: dateString });
const specSectionIdParam = pathParam("sectionId", "Specification section UUID.");
[
  { method: "get", path: "/projects/{projectId}/specifications/status", summary: "Whether an AI provider is configured for the scope review and conflict check, and the text limits (AI_SPEC_CHARS, AI_SPEC_SHEETS).", operationId: "specificationStatus", parameters: projectParams, permissions: modulePermission("document_control", "read"), responseSchema: objectSchema({ enabled: { type: "boolean" }, provider: { type: "string", nullable: true }, model: { type: "string", nullable: true }, sectionChars: { type: "integer" }, sheetLimit: { type: "integer" } }) },
  { method: "get", path: "/projects/{projectId}/specifications/documents", summary: "Every document with extracted text, with its indexed section count and whether it reads like a specification (CSI hints, name, category).", operationId: "listSpecificationDocuments", parameters: projectParams, permissions: modulePermission("document_control", "read"), responseSchema: objectSchema({ items: arrayOf(specDocumentSchema) }) },
  { method: "post", path: "/projects/{projectId}/specifications/index", summary: "Parse the given documents — or, without `documentIds`, every document whose text reads like a specification — into sections: CSI MasterFormat headings (SECTION 03 30 00 / 03 30 00 TITLE / five-digit codes), else generic SECTION n or numbered headings; table-of-contents repeats dropped; pages located in the PDF. Replaces earlier sections of each document.", operationId: "indexSpecifications", parameters: projectParams, permissions: modulePermission("document_control", "update"), requestBody: jsonBody(objectSchema({ documentIds: arrayOf(uuid) }), "Documents to index (optional).", false), responseSchema: objectSchema({ documents: arrayOf(objectSchema({ documentId: uuid, title: { type: "string", nullable: true }, sections: { type: "integer" }, dropped: { type: "integer" }, divisions: arrayOf({ type: "string" }), error: { type: "string", nullable: true } })), sections: { type: "integer" } }) },
  { method: "get", path: "/projects/{projectId}/specifications", summary: "Indexed sections with division counts; filter by text (`q` on code / title), `division` or `documentId`.", operationId: "listSpecificationSections", parameters: [...projectParams, queryParam("q", "Code or title text.", { type: "string" }), queryParam("division", "Two-digit division, e.g. 03.", { type: "string" }), queryParam("documentId", "Only sections of this document.", uuid)], permissions: modulePermission("document_control", "read"), responseSchema: objectSchema({ items: arrayOf(specSectionSchema), divisions: arrayOf(objectSchema({ division: { type: "string", nullable: true }, label: { type: "string", nullable: true }, count: { type: "integer" } })), total: { type: "integer" } }) },
  { method: "get", path: "/projects/{projectId}/specifications/scope-gaps", summary: "Scope coverage of every indexed section against the BOQ, the current sheets and the schedule (keyword, division vocabulary, CSI code prefix and discipline matching): per-section counts and gaps, BOQ items no section covers, disciplines with sheets but no specification, and notes on what could not be checked.", operationId: "specificationScopeGaps", parameters: projectParams, permissions: modulePermission("document_control", "read"), responseSchema: specGapSchema },
  { method: "post", path: "/projects/{projectId}/specifications/scope-gaps/explain", summary: "The scope-gap check reviewed by the model — headline, narrative and up to four draft actions (create_task / create_rfi) — stored as a scope_gap run; the computed review is returned without a provider.", operationId: "explainSpecificationScopeGaps", parameters: projectParams, permissions: modulePermission("document_control", "read"), responseSchema: objectSchema({ degraded: { type: "boolean" }, reason: { type: "string", nullable: true }, gaps: specGapSchema, review: objectSchema({ headline: { type: "string" }, narrative: { type: "string" }, actions: arrayOf(ref("GenericObject")) }), message: nullableRef("GenericObject") }) },
  { method: "get", path: "/projects/{projectId}/specifications/{sectionId}", summary: "One section with its text (`maxChars`, default 20,000) and the related BOQ items, sheets, activities and RFIs with the basis of each match.", operationId: "getSpecificationSection", parameters: [...projectParams, specSectionIdParam, queryParam("maxChars", "Characters of text to return (500–200,000).", { type: "integer", minimum: 500, maximum: 200000 })], permissions: modulePermission("document_control", "read"), responseSchema: { ...specSectionSchema, properties: { ...specSectionSchema.properties, text: { type: "string" }, truncated: { type: "boolean" }, totalChars: { type: "integer" }, related: specRelatedSchema } } },
  { method: "post", path: "/projects/{projectId}/specifications/{sectionId}/conflicts", summary: "Check the section against the text layers of its related sheets (or the given `sheetIds`, up to AI_SPEC_SHEETS) and its RFIs: conflicts (topic, what the specification says, what the drawing says, sheet, severity, recommendation) and gaps, stored as a spec_conflict run. Nothing is written to the records; `degraded` without a provider.", operationId: "checkSpecificationConflicts", parameters: [...projectParams, specSectionIdParam], permissions: modulePermission("document_control", "read"), requestBody: jsonBody(objectSchema({ sheetIds: arrayOf(uuid) }), "Sheets to check (optional).", false), responseSchema: objectSchema({ degraded: { type: "boolean" }, reason: { type: "string", nullable: true }, section: ref("GenericObject"), sheetsChecked: arrayOf(objectSchema({ id: uuid, number: { type: "string" }, title: { type: "string" }, revision: { type: "string", nullable: true }, basis: specBasis, chars: { type: "integer" } })), related: specRelatedSchema, result: { ...objectSchema({ summary: { type: "string" }, conflicts: arrayOf(objectSchema({ topic: { type: "string" }, specSays: { type: "string", nullable: true }, drawingSays: { type: "string", nullable: true }, sheetNumber: { type: "string", nullable: true }, severity: specLevel, recommendation: { type: "string", nullable: true } })), gaps: arrayOf(objectSchema({ topic: { type: "string" }, detail: { type: "string", nullable: true }, where: { type: "string", enum: ["specification", "drawings"] } })), confidence: specLevel }), nullable: true }, message: nullableRef("GenericObject") }) },
  { method: "post", path: "/projects/{projectId}/specifications/{sectionId}/rfi", summary: "Raise a draft RFI from a conflict or gap, tagged with the section code and the division's discipline (audited with source = specification).", operationId: "raiseSpecificationRfi", parameters: [...projectParams, specSectionIdParam], permissions: modulePermission("rfi", "create"), requestBody: jsonBody(objectSchema({ subject: { type: "string" }, question: { type: "string", nullable: true }, discipline: { type: "string", nullable: true }, priority: { type: "string", enum: ["low", "normal", "high", "urgent"] } }, ["subject"]), "RFI."), responseSchema: objectSchema({ record: objectSchema({ id: uuid, ref: { type: "string" }, status: { type: "string" } }), url: { type: "string" } }), status: 201 },
].forEach((route) => addGenericRoute({ tag: "Specifications", ...route }));

// ─── Timesheets and crews (OCTA-FLD-TIME-037) ─────────────────────────────
const timesheetStatus = { type: "string", enum: ["draft", "submitted", "approved", "rejected"] };
const timeType = { type: "string", enum: ["regular", "overtime", "double"] };
const workerSchema = objectSchema({ id: uuid, companyId: nullableUuid, companyName: { type: "string", nullable: true }, userId: nullableUuid, name: { type: "string" }, employeeNumber: { type: "string", nullable: true }, trade: { type: "string", nullable: true }, classification: { type: "string", nullable: true }, hourlyRate: { type: "number", nullable: true }, overtimeMultiplier: { type: "number" }, status: { type: "string", enum: ["active", "inactive"] }, notes: { type: "string", nullable: true }, crews: arrayOf(objectSchema({ id: uuid, name: { type: "string", nullable: true } })), createdAt: nullableDateString, updatedAt: nullableDateString });
const workerBody = objectSchema({ name: { type: "string" }, companyId: nullableUuid, userId: nullableUuid, employeeNumber: { type: "string", nullable: true }, trade: { type: "string", nullable: true }, classification: { type: "string", nullable: true }, hourlyRate: { type: "number", nullable: true }, overtimeMultiplier: { type: "number" }, status: { type: "string", enum: ["active", "inactive"] }, notes: { type: "string", nullable: true } });
const crewSchema = objectSchema({ id: uuid, projectId: uuid, name: { type: "string" }, companyId: nullableUuid, companyName: { type: "string", nullable: true }, partyId: nullableUuid, foremanUserId: nullableUuid, defaultCostCodeId: nullableUuid, defaultActivityId: nullableUuid, status: { type: "string", enum: ["active", "inactive"] }, members: arrayOf(objectSchema({ id: uuid, workerId: uuid, role: { type: "string" }, sortOrder: { type: "integer" }, worker: { ...workerSchema, nullable: true } })), memberCount: { type: "integer" }, createdAt: nullableDateString, updatedAt: nullableDateString });
const crewBody = objectSchema({ name: { type: "string" }, companyId: nullableUuid, partyId: nullableUuid, foremanUserId: nullableUuid, defaultCostCodeId: nullableUuid, defaultActivityId: nullableUuid, status: { type: "string", enum: ["active", "inactive"] }, workerIds: arrayOf(uuid) });
const timeEntrySchema = objectSchema({ id: uuid, workerId: uuid, worker: nullableRef("GenericObject"), activityId: nullableUuid, activity: nullableRef("GenericObject"), costCodeId: nullableUuid, costCode: nullableRef("GenericObject"), budgetLineId: nullableUuid, locationId: nullableUuid, location: nullableRef("GenericObject"), timeType, hours: { type: "number" }, startTime: { type: "string", nullable: true }, endTime: { type: "string", nullable: true }, rate: { type: "number", nullable: true }, amount: { type: "number" }, notes: { type: "string", nullable: true }, sortOrder: { type: "integer" } });
const timeEntryBody = objectSchema({ workerId: uuid, activityId: nullableUuid, costCodeId: nullableUuid, locationId: nullableUuid, timeType, hours: { type: "number" }, startTime: { type: "string", nullable: true }, endTime: { type: "string", nullable: true }, notes: { type: "string", nullable: true } }, ["workerId", "hours"]);
const timesheetSchema = objectSchema({ id: uuid, projectId: uuid, date: { type: "string", format: "date" }, crewId: nullableUuid, crew: nullableRef("GenericObject"), partyId: nullableUuid, companyId: nullableUuid, status: timesheetStatus, notes: { type: "string", nullable: true }, regularHours: { type: "number" }, overtimeHours: { type: "number" }, totalHours: { type: "number" }, totalCost: { type: "number" }, entryCount: { type: "integer", nullable: true }, workerCount: { type: "integer", nullable: true }, submittedBy: nullableUuid, submittedAt: nullableDateString, approvedBy: nullableUuid, approvedAt: nullableDateString, rejectedBy: nullableUuid, rejectedAt: nullableDateString, rejectionReason: { type: "string", nullable: true }, postedAt: nullableDateString, createdBy: nullableUuid, path: { type: "string" }, entries: arrayOf(timeEntrySchema), createdAt: nullableDateString, updatedAt: nullableDateString });
const timesheetIdParam = pathParam("timesheetId", "Timesheet UUID.");
const workerIdParam = pathParam("workerId", "Worker UUID.");
const crewIdParam = pathParam("crewId", "Crew UUID.");
const dateQueryParam = (name, description) => queryParam(name, description, { type: "string", format: "date" });
[
  { method: "get", path: "/projects/{projectId}/timesheets/workers", summary: "Workers of the organisation (party users: their company's), with the crews they belong to on this project.", operationId: "listWorkers", parameters: [...projectParams, queryParam("q", "Name, employee number or trade.", { type: "string" }), queryParam("companyId", "Only this company.", uuid), queryParam("status", "active | inactive.", { type: "string", enum: ["active", "inactive"] })], permissions: modulePermission("timesheet", "read"), responseSchema: objectSchema({ items: arrayOf(workerSchema), total: { type: "integer" } }) },
  { method: "post", path: "/projects/{projectId}/timesheets/workers", summary: "Add a worker (party users: to their own company). Employee numbers are unique per organisation (409 WORKER_NUMBER_EXISTS).", operationId: "createWorker", parameters: projectParams, permissions: modulePermission("timesheet", "create"), requestBody: jsonBody(workerBody, "Worker."), responseSchema: workerSchema, status: 201 },
  { method: "post", path: "/projects/{projectId}/timesheets/workers/import", summary: "Import workers from rows (name, employeeNumber, trade, classification, hourlyRate, companyName / companyId): matched on employee number, else on name + company; updates existing rows.", operationId: "importWorkers", parameters: projectParams, permissions: modulePermission("timesheet", "create"), requestBody: jsonBody(objectSchema({ rows: arrayOf(workerBody) }, ["rows"]), "Rows."), responseSchema: objectSchema({ created: { type: "integer" }, updated: { type: "integer" }, skipped: { type: "integer" }, errors: arrayOf(objectSchema({ row: { type: "integer" }, message: { type: "string" } })) }) },
  { method: "patch", path: "/projects/{projectId}/timesheets/workers/{workerId}", summary: "Edit a worker (rate, trade, status…). Party users can only edit their company's workers.", operationId: "updateWorker", parameters: [...projectParams, workerIdParam], permissions: modulePermission("timesheet", "update"), requestBody: jsonBody(workerBody, "Fields to change.", false), responseSchema: workerSchema },
  { method: "get", path: "/projects/{projectId}/timesheets/crews", summary: "Crews of the project with their members.", operationId: "listCrews", parameters: [...projectParams, queryParam("status", "active | inactive.", { type: "string", enum: ["active", "inactive"] })], permissions: modulePermission("timesheet", "read"), responseSchema: objectSchema({ items: arrayOf(crewSchema) }) },
  { method: "post", path: "/projects/{projectId}/timesheets/crews", summary: "Create a crew with optional members and defaults (cost code / activity applied to new timesheets). Party users' crews belong to their company.", operationId: "createCrew", parameters: projectParams, permissions: modulePermission("timesheet", "create"), requestBody: jsonBody(crewBody, "Crew."), responseSchema: crewSchema, status: 201 },
  { method: "patch", path: "/projects/{projectId}/timesheets/crews/{crewId}", summary: "Edit a crew; `workerIds` replaces the member list.", operationId: "updateCrew", parameters: [...projectParams, crewIdParam], permissions: modulePermission("timesheet", "update"), requestBody: jsonBody(crewBody, "Fields to change.", false), responseSchema: crewSchema },
  { method: "delete", path: "/projects/{projectId}/timesheets/crews/{crewId}", summary: "Delete a crew that has no timesheets (409 CREW_IN_USE otherwise — mark it inactive).", operationId: "deleteCrew", parameters: [...projectParams, crewIdParam], permissions: modulePermission("timesheet", "delete"), responseSchema: objectSchema({ deleted: { type: "boolean" } }) },
  { method: "get", path: "/projects/{projectId}/timesheets/week", summary: "Worker × day grid for the week starting `weekStart`, with totals by crew, activity and cost code, the week's timesheets and status counts.", operationId: "timesheetWeek", parameters: [...projectParams, dateQueryParam("weekStart", "First day of the week (YYYY-MM-DD).")], permissions: modulePermission("timesheet", "read"), responseSchema: objectSchema({ weekStart: { type: "string" }, weekEnd: { type: "string" }, days: arrayOf({ type: "string" }), workers: arrayOf(ref("GenericObject")), crews: arrayOf(ref("GenericObject")), activities: arrayOf(ref("GenericObject")), costCodes: arrayOf(ref("GenericObject")), timesheets: arrayOf(timesheetSchema), totals: ref("GenericObject") }) },
  { method: "get", path: "/projects/{projectId}/timesheets/productivity", summary: "Approved hours and labour cost per activity against its approved progress and labour budget: hours / cost per % complete, labour burn, warning when cost is ahead of progress.", operationId: "timesheetProductivity", parameters: [...projectParams, dateQueryParam("from", "From date."), dateQueryParam("to", "To date.")], permissions: modulePermission("timesheet", "read"), responseSchema: objectSchema({ items: arrayOf(objectSchema({ activityId: uuid, name: { type: "string" }, code: { type: "string", nullable: true }, hours: { type: "number" }, overtimeHours: { type: "number" }, cost: { type: "number" }, workers: { type: "integer" }, days: { type: "integer" }, hoursPerDay: { type: "number" }, pctComplete: { type: "number", nullable: true }, labourBudget: { type: "number", nullable: true }, earnedLabour: { type: "number", nullable: true }, labourBurnPct: { type: "number", nullable: true }, costPerPct: { type: "number", nullable: true }, hoursPerPct: { type: "number", nullable: true }, warning: { type: "string", nullable: true } })), totals: ref("GenericObject") }) },
  { method: "get", path: "/projects/{projectId}/timesheets/export.xlsx", summary: "XLSX of the entries in the range (Entries, By worker, About).", operationId: "exportTimesheets", parameters: [...projectParams, dateQueryParam("from", "From date."), dateQueryParam("to", "To date."), queryParam("status", "Only this status.", timesheetStatus)], permissions: modulePermission("timesheet", "export"), responses: { 200: { description: "Workbook.", content: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { schema: { type: "string", format: "binary" } } } } } },
  { method: "get", path: "/projects/{projectId}/timesheets", summary: "Timesheets in a date range with totals (party users: their company's and their own).", operationId: "listTimesheets", parameters: [...projectParams, dateQueryParam("from", "From date."), dateQueryParam("to", "To date."), queryParam("status", "Only this status.", timesheetStatus), queryParam("crewId", "Only this crew.", uuid), queryParam("companyId", "Only this company.", uuid)], permissions: modulePermission("timesheet", "read"), responseSchema: objectSchema({ items: arrayOf(timesheetSchema), summary: objectSchema({ count: { type: "integer" }, regularHours: { type: "number" }, overtimeHours: { type: "number" }, totalCost: { type: "number" }, byStatus: ref("GenericObject") }) }) },
  { method: "post", path: "/projects/{projectId}/timesheets", summary: "Create a day's timesheet. With a crew and no `entries`, the members are pre-filled with `defaultHours` (8) regular hours on the crew's default activity / cost code; one timesheet per crew per day (409 TIMESHEET_EXISTS). `clientRequestId` replays.", operationId: "createTimesheet", parameters: projectParams, permissions: modulePermission("timesheet", "create"), requestBody: jsonBody(objectSchema({ date: { type: "string", format: "date" }, crewId: nullableUuid, companyId: nullableUuid, notes: { type: "string", nullable: true }, defaultHours: { type: "number" }, clientRequestId: { type: "string", nullable: true }, entries: arrayOf(timeEntryBody) }, ["date"]), "Timesheet."), responseSchema: timesheetSchema, status: 201 },
  { method: "get", path: "/projects/{projectId}/timesheets/{timesheetId}", summary: "One timesheet with its entries.", operationId: "getTimesheet", parameters: [...projectParams, timesheetIdParam], permissions: modulePermission("timesheet", "read"), responseSchema: timesheetSchema },
  { method: "patch", path: "/projects/{projectId}/timesheets/{timesheetId}", summary: "Replace the entries / notes / date of a draft or rejected timesheet (409 TIMESHEET_LOCKED otherwise). Hours 0–24 per entry and ≤ 24 per worker per day (400 TIMESHEET_HOURS_EXCEEDED).", operationId: "updateTimesheet", parameters: [...projectParams, timesheetIdParam], permissions: modulePermission("timesheet", "update"), requestBody: jsonBody(objectSchema({ date: { type: "string", format: "date" }, notes: { type: "string", nullable: true }, entries: arrayOf(timeEntryBody) }), "Changes.", false), responseSchema: timesheetSchema },
  { method: "delete", path: "/projects/{projectId}/timesheets/{timesheetId}", summary: "Delete a draft timesheet.", operationId: "deleteTimesheet", parameters: [...projectParams, timesheetIdParam], permissions: modulePermission("timesheet", "delete"), responseSchema: objectSchema({ deleted: { type: "boolean" } }) },
  { method: "post", path: "/projects/{projectId}/timesheets/{timesheetId}/submit", summary: "Submit for approval: needs at least one entry and an activity on every entry (400 TIMESHEET_ENTRY_ACTIVITY_REQUIRED); PMs / cost controllers and the crew foreman are notified.", operationId: "submitTimesheet", parameters: [...projectParams, timesheetIdParam], permissions: modulePermission("timesheet", "submit"), responseSchema: timesheetSchema },
  { method: "post", path: "/projects/{projectId}/timesheets/{timesheetId}/approve", summary: "Approve and post labour cost: each entry's rate is snapshotted from the worker (× overtime multiplier / 2 for double time), the amount is added to the activity's cost record actual and to the cost code's labour budget line actual.", operationId: "approveTimesheet", parameters: [...projectParams, timesheetIdParam], permissions: modulePermission("timesheet", "approve"), responseSchema: timesheetSchema },
  { method: "post", path: "/projects/{projectId}/timesheets/{timesheetId}/reject", summary: "Return a submitted timesheet with a reason (it becomes editable again).", operationId: "rejectTimesheet", parameters: [...projectParams, timesheetIdParam], permissions: modulePermission("timesheet", "approve"), requestBody: jsonBody(objectSchema({ reason: { type: "string" } }, ["reason"]), "Reason."), responseSchema: timesheetSchema },
  { method: "post", path: "/projects/{projectId}/timesheets/{timesheetId}/reopen", summary: "Reopen a submitted or approved timesheet: the posted cost is reversed exactly and it returns to draft.", operationId: "reopenTimesheet", parameters: [...projectParams, timesheetIdParam], permissions: modulePermission("timesheet", "approve"), requestBody: jsonBody(objectSchema({ reason: { type: "string", nullable: true } }), "Reason.", false), responseSchema: timesheetSchema },
].forEach((route) => addGenericRoute({ tag: "Timesheets", ...route }));

// ─── Change events and RFQs (OCTA-COM-CE-038) ─────────────────────────────
const changeEventStatus = { type: "string", enum: ["open", "pricing", "priced", "converted", "closed", "void"] };
const changeEventType = { type: "string", enum: ["owner_change", "design_change", "site_condition", "error_omission", "allowance", "value_engineering", "other"] };
const changeEventOrigin = { type: "string", enum: ["manual", "rfi", "submittal", "daily_log", "observation", "meeting", "other"] };
const rfqStatus = { type: "string", enum: ["sent", "viewed", "quoted", "declined", "accepted", "rejected", "cancelled"] };
const changeEventLineSchema = objectSchema({ id: uuid, description: { type: "string" }, costCodeId: nullableUuid, costCode: nullableRef("GenericObject"), budgetLineId: nullableUuid, activityId: nullableUuid, activity: nullableRef("GenericObject"), commitmentId: nullableUuid, commitment: nullableRef("GenericObject"), quantity: { type: "number" }, unit: { type: "string", nullable: true }, unitCost: { type: "number" }, romAmount: { type: "number" }, quotedAmount: { type: "number", nullable: true }, quotedRfqId: nullableUuid, amount: { type: "number", description: "Quoted amount when accepted, else the ROM." }, notes: { type: "string", nullable: true }, sortOrder: { type: "integer" } });
const changeEventLineBody = objectSchema({ id: nullableUuid, description: { type: "string" }, costCodeId: nullableUuid, budgetLineId: nullableUuid, activityId: nullableUuid, commitmentId: nullableUuid, quantity: { type: "number" }, unit: { type: "string", nullable: true }, unitCost: { type: "number", nullable: true }, romAmount: { type: "number", nullable: true, description: "Defaults to quantity × unit cost." }, notes: { type: "string", nullable: true } }, ["description"]);
const rfqQuoteLineSchema = objectSchema({ lineId: uuid, amount: { type: "number", nullable: true }, note: { type: "string", nullable: true } });
const rfqSchema = objectSchema({ id: uuid, changeEventId: uuid, number: { type: "integer" }, ref: { type: "string", example: "CE-001-RFQ01" }, commitmentId: nullableUuid, commitment: nullableRef("GenericObject"), vendorCompanyId: nullableUuid, companyName: { type: "string" }, contactName: { type: "string", nullable: true }, contactEmail: { type: "string", nullable: true }, status: rfqStatus, dueDate: nullableDateString, expiresAt: nullableDateString, instructions: { type: "string", nullable: true }, lineIds: arrayOf(uuid), sentAt: nullableDateString, viewedAt: nullableDateString, quotedAt: nullableDateString, quoteTotal: { type: "number", nullable: true }, quoteLines: arrayOf(rfqQuoteLineSchema), quoteNotes: { type: "string", nullable: true }, quoteValidUntil: nullableDateString, quoteLeadTimeDays: { type: "integer", nullable: true }, quotedBy: { type: "string", nullable: true }, declinedReason: { type: "string", nullable: true }, acceptedAt: nullableDateString, rejectedAt: nullableDateString, rejectedReason: { type: "string", nullable: true }, commitmentChangeOrderId: nullableUuid, commitmentChangeOrder: nullableRef("GenericObject"), remindersSent: { type: "integer" }, portalUrl: { type: "string", nullable: true, description: "Only on send / remind responses." } });
const changeEventSchema = objectSchema({ id: uuid, projectId: uuid, number: { type: "integer" }, ref: { type: "string", example: "CE-001" }, title: { type: "string" }, description: { type: "string", nullable: true }, type: changeEventType, origin: changeEventOrigin, sourceRecordType: { type: "string", nullable: true }, sourceRecordId: nullableUuid, sourcePath: { type: "string", nullable: true }, status: changeEventStatus, activityId: nullableUuid, activity: nullableRef("GenericObject"), locationId: nullableUuid, location: nullableRef("GenericObject"), romAmount: { type: "number" }, scheduleImpactDays: { type: "integer" }, ownerChange: { type: "boolean" }, totals: objectSchema({ rom: { type: "number" }, quoted: { type: "number", nullable: true }, estimate: { type: "number" } }), changeOrderId: nullableUuid, changeOrder: nullableRef("GenericObject"), convertedAt: nullableDateString, closedAt: nullableDateString, voidReason: { type: "string", nullable: true }, notes: { type: "string", nullable: true }, lineCount: { type: "integer", nullable: true }, rfqCounts: objectSchema({ total: { type: "integer" }, quoted: { type: "integer" }, accepted: { type: "integer" }, open: { type: "integer" } }), lines: arrayOf(changeEventLineSchema), rfqs: arrayOf(rfqSchema), path: { type: "string" }, createdBy: nullableUuid, createdAt: nullableDateString, updatedAt: nullableDateString });
const changeEventBody = objectSchema({ title: { type: "string" }, description: { type: "string", nullable: true }, type: changeEventType, origin: changeEventOrigin, sourceRecordType: { type: "string", nullable: true }, sourceRecordId: nullableUuid, activityId: nullableUuid, locationId: nullableUuid, romAmount: { type: "number", nullable: true }, scheduleImpactDays: { type: "integer" }, ownerChange: { type: "boolean" }, notes: { type: "string", nullable: true }, lines: arrayOf(changeEventLineBody) });
const changeEventIdParam = pathParam("changeEventId", "Change event UUID.");
const rfqIdParam = pathParam("rfqId", "RFQ UUID.");
[
  { method: "get", path: "/projects/{projectId}/change-events", summary: "Change events with totals: count by status, ROM and quoted totals of live events, converted value, open RFQs and quotes waiting.", operationId: "listChangeEvents", parameters: [...projectParams, queryParam("status", "Only this status.", changeEventStatus), queryParam("type", "Only this type.", changeEventType), queryParam("origin", "Only this origin.", changeEventOrigin), queryParam("q", "Ref, title or description text.", { type: "string" })], permissions: modulePermission("change_event", "read"), responseSchema: objectSchema({ items: arrayOf(changeEventSchema), summary: objectSchema({ count: { type: "integer" }, byStatus: ref("GenericObject"), romTotal: { type: "number" }, quotedTotal: { type: "number" }, convertedValue: { type: "number" }, openRfqs: { type: "integer" }, quotesWaiting: { type: "integer" } }) }) },
  { method: "post", path: "/projects/{projectId}/change-events", summary: "Create a change event (CE-nnn) with its scope lines; each line's ROM defaults to quantity × unit cost. Origin and source record link it back to the RFI / observation / meeting it came from.", operationId: "createChangeEvent", parameters: projectParams, permissions: modulePermission("change_event", "create"), requestBody: jsonBody(changeEventBody, "Change event."), responseSchema: changeEventSchema, status: 201 },
  { method: "get", path: "/projects/{projectId}/change-events/{changeEventId}", summary: "One change event with its lines and RFQs (quotes included).", operationId: "getChangeEvent", parameters: [...projectParams, changeEventIdParam], permissions: modulePermission("change_event", "read"), responseSchema: changeEventSchema },
  { method: "patch", path: "/projects/{projectId}/change-events/{changeEventId}", summary: "Edit the header and, when `lines` is sent, replace the lines (existing line ids keep their accepted quote). 409 CHANGE_EVENT_LOCKED once converted / closed / void.", operationId: "updateChangeEvent", parameters: [...projectParams, changeEventIdParam], permissions: modulePermission("change_event", "update"), requestBody: jsonBody(changeEventBody, "Changes.", false), responseSchema: changeEventSchema },
  { method: "delete", path: "/projects/{projectId}/change-events/{changeEventId}", summary: "Delete an open change event that has no RFQs.", operationId: "deleteChangeEvent", parameters: [...projectParams, changeEventIdParam], permissions: modulePermission("change_event", "delete"), responseSchema: objectSchema({ deleted: { type: "boolean" } }) },
  { method: "post", path: "/projects/{projectId}/change-events/{changeEventId}/rfqs", summary: "Send RFQs: one per recipient — a commitment (its vendor's contact is used) or an ad-hoc company + email — each with a personal quotation link (WEB_APP_URL/rfq/{token}, RFQ_LINK_DAYS). Optional due date, instructions and the subset of lines to quote. The event moves to pricing. 409 RFQ_ALREADY_SENT for an open RFQ to the same email.", operationId: "sendChangeEventRfqs", parameters: [...projectParams, changeEventIdParam], permissions: modulePermission("change_event", "submit"), requestBody: jsonBody(objectSchema({ recipients: arrayOf(objectSchema({ commitmentId: nullableUuid, vendorCompanyId: nullableUuid, companyName: { type: "string", nullable: true }, contactName: { type: "string", nullable: true }, contactEmail: { type: "string", nullable: true } })), dueDate: nullableDateString, instructions: { type: "string", nullable: true }, lineIds: arrayOf(uuid) }, ["recipients"]), "Recipients."), responseSchema: objectSchema({ sent: { type: "integer" }, rfqs: arrayOf(rfqSchema), changeEvent: changeEventSchema }), status: 201 },
  { method: "post", path: "/projects/{projectId}/change-events/rfqs/{rfqId}/remind", summary: "Re-send the RFQ email with a fresh link.", operationId: "remindRfq", parameters: [...projectParams, rfqIdParam], permissions: modulePermission("change_event", "submit"), responseSchema: rfqSchema },
  { method: "post", path: "/projects/{projectId}/change-events/rfqs/{rfqId}/cancel", summary: "Withdraw an open RFQ (the link stops working).", operationId: "cancelRfq", parameters: [...projectParams, rfqIdParam], permissions: modulePermission("change_event", "submit"), responseSchema: rfqSchema },
  { method: "post", path: "/projects/{projectId}/change-events/rfqs/{rfqId}/accept", summary: "Accept a quote: the quoted amounts land on the event's lines and the event becomes priced; with `createCommitmentChangeOrder` and a commitment vendor, a draft commitment change order is created from the quoted lines.", operationId: "acceptRfqQuote", parameters: [...projectParams, rfqIdParam], permissions: modulePermission("change_event", "approve"), requestBody: jsonBody(objectSchema({ createCommitmentChangeOrder: { type: "boolean" } }), "Options.", false), responseSchema: objectSchema({ changeEvent: changeEventSchema, commitmentChangeOrder: nullableRef("GenericObject") }) },
  { method: "post", path: "/projects/{projectId}/change-events/rfqs/{rfqId}/reject", summary: "Reject a quote with an optional reason.", operationId: "rejectRfqQuote", parameters: [...projectParams, rfqIdParam], permissions: modulePermission("change_event", "approve"), requestBody: jsonBody(objectSchema({ reason: { type: "string", nullable: true } }), "Reason.", false), responseSchema: rfqSchema },
  { method: "post", path: "/projects/{projectId}/change-events/{changeEventId}/convert", summary: "Create the prime change order (draft VO) from the event: value = quoted where accepted else ROM (override with `value`), category = type, schedule impact, affected activities from the lines; accepted commitment quotes become commitment change orders linked to it (or existing ones are linked). The event becomes converted.", operationId: "convertChangeEvent", parameters: [...projectParams, changeEventIdParam], permissions: modulePermission("change_event", "approve"), requestBody: jsonBody(objectSchema({ value: { type: "number", nullable: true }, description: { type: "string", nullable: true }, includeCommitmentChangeOrders: { type: "boolean" } }), "Options.", false), responseSchema: objectSchema({ changeEvent: changeEventSchema, changeOrder: ref("GenericObject"), commitmentChangeOrders: arrayOf(ref("GenericObject")) }), status: 201 },
  { method: "post", path: "/projects/{projectId}/change-events/{changeEventId}/close", summary: "Close a change event without a change order (open RFQs are cancelled).", operationId: "closeChangeEvent", parameters: [...projectParams, changeEventIdParam], permissions: modulePermission("change_event", "approve"), requestBody: jsonBody(objectSchema({ reason: { type: "string", nullable: true } }), "Reason.", false), responseSchema: changeEventSchema },
  { method: "post", path: "/projects/{projectId}/change-events/{changeEventId}/void", summary: "Void a change event with a reason (not once converted).", operationId: "voidChangeEvent", parameters: [...projectParams, changeEventIdParam], permissions: modulePermission("change_event", "approve"), requestBody: jsonBody(objectSchema({ reason: { type: "string" } }, ["reason"]), "Reason."), responseSchema: changeEventSchema },
].forEach((route) => addGenericRoute({ tag: "Change Events", ...route }));
const rfqTokenParam = pathParam("token", "Personal RFQ token from the email.");
const rfqPortalViewSchema = objectSchema({ rfq: objectSchema({ ref: { type: "string" }, companyName: { type: "string" }, contactName: { type: "string", nullable: true }, status: rfqStatus, dueDate: nullableDateString, expiresAt: nullableDateString, instructions: { type: "string", nullable: true }, acceptingQuotes: { type: "boolean" }, declinedReason: { type: "string", nullable: true } }), changeEvent: objectSchema({ ref: { type: "string" }, title: { type: "string" }, description: { type: "string", nullable: true }, type: changeEventType, projectName: { type: "string", nullable: true }, currency: { type: "string", nullable: true }, lines: arrayOf(objectSchema({ id: uuid, description: { type: "string" }, quantity: { type: "number" }, unit: { type: "string", nullable: true }, activity: { type: "string", nullable: true }, notes: { type: "string", nullable: true } })) }), quote: objectSchema({ lines: arrayOf(rfqQuoteLineSchema), total: { type: "number", nullable: true }, notes: { type: "string", nullable: true }, validUntil: nullableDateString, leadTimeDays: { type: "integer", nullable: true }, quotedBy: { type: "string", nullable: true }, quotedAt: nullableDateString }) });
const rfqPortalOperation = ({ path, method, summary, operationId, requestBody = undefined, responseSchema }) =>
  add(path, method, operation({ tag: "Vendor Quotation Portal", summary, operationId, parameters: [rfqTokenParam], requestBody, responseSchema, permissions: { auth: "none", note: "The RFQ token in the path is the credential; every answer is scoped to that one request." }, security: false }));
rfqPortalOperation({ path: "/public/rfqs/{token}", method: "get", summary: "The vendor's view of the request: the change event's scope lines to quote, instructions and due date, and its own quote. Marks the RFQ viewed. 410 when expired or withdrawn.", operationId: "rfqPortalView", responseSchema: rfqPortalViewSchema });
rfqPortalOperation({ path: "/public/rfqs/{token}/quote", method: "put", summary: "Submit or replace the quotation: an amount per line (or a total), notes, validity and lead time. The project team is notified; re-quoting is allowed until the quote is accepted or rejected.", operationId: "rfqPortalQuote", requestBody: jsonBody(objectSchema({ lines: arrayOf(objectSchema({ lineId: uuid, amount: { type: "number", nullable: true }, note: { type: "string", nullable: true } }, ["lineId"])), total: { type: "number", nullable: true }, notes: { type: "string", nullable: true }, validUntil: nullableDateString, leadTimeDays: { type: "integer", nullable: true }, quotedBy: { type: "string", nullable: true } }), "Quotation."), responseSchema: rfqPortalViewSchema });
rfqPortalOperation({ path: "/public/rfqs/{token}/decline", method: "post", summary: "Decline to quote.", operationId: "rfqPortalDecline", requestBody: jsonBody(objectSchema({ reason: { type: "string", nullable: true } }), "Reason.", false), responseSchema: rfqPortalViewSchema });

// ─── Direct costs (OCTA-FIN-DIRECT-039) ───────────────────────────────────
const directCostStatus = { type: "string", enum: ["draft", "pending", "approved", "paid", "void"] };
const directCostType = { type: "string", enum: ["invoice", "expense", "payroll", "other"] };
const directCostCostType = { type: "string", enum: ["labour", "material", "equipment", "subcontract", "indirect", "overhead", "contingency", "other"], nullable: true };
const directCostLineSchema = objectSchema({ id: uuid, description: { type: "string" }, costCodeId: nullableUuid, costCode: nullableRef("GenericObject"), budgetLineId: nullableUuid, budgetLine: nullableRef("GenericObject"), activityId: nullableUuid, activity: nullableRef("GenericObject"), costType: directCostCostType, quantity: { type: "number" }, unit: { type: "string", nullable: true }, unitCost: { type: "number" }, amount: { type: "number" }, postedAmount: { type: "number" }, notes: { type: "string", nullable: true }, sortOrder: { type: "integer" } });
const directCostLineBody = objectSchema({ description: { type: "string" }, costCodeId: nullableUuid, budgetLineId: { ...nullableUuid, description: "Wins over costCodeId; its cost code and cost type are used." }, activityId: nullableUuid, costType: directCostCostType, quantity: { type: "number" }, unit: { type: "string", nullable: true }, unitCost: { type: "number", nullable: true }, amount: { type: "number", nullable: true, description: "Defaults to quantity × unit cost." }, notes: { type: "string", nullable: true } }, ["description"]);
const directCostPaymentSchema = objectSchema({ id: uuid, amount: { type: "number" }, paidAt: dateString, method: { type: "string", nullable: true }, reference: { type: "string", nullable: true }, note: { type: "string", nullable: true }, createdBy: nullableUuid, createdAt: nullableDateString });
const directCostSchema = objectSchema({ id: uuid, projectId: uuid, number: { type: "integer" }, ref: { type: "string", example: "DC-001" }, type: directCostType, vendorCompanyId: nullableUuid, vendorName: { type: "string", nullable: true }, invoiceNumber: { type: "string", nullable: true }, description: { type: "string" }, costDate: { type: "string", format: "date" }, dueDate: { type: "string", format: "date", nullable: true }, receivedDate: { type: "string", format: "date", nullable: true }, status: directCostStatus, subtotal: { type: "number" }, tax: { type: "number" }, total: { type: "number" }, paidTotal: { type: "number" }, balance: { type: "number" }, overdue: { type: "boolean" }, paymentTerms: { type: "string", nullable: true }, notes: { type: "string", nullable: true }, submittedBy: nullableUuid, submittedAt: nullableDateString, approvedBy: nullableUuid, approvedAt: nullableDateString, rejectedReason: { type: "string", nullable: true }, postedAt: nullableDateString, voidReason: { type: "string", nullable: true }, voidedAt: nullableDateString, lineCount: { type: "integer", nullable: true }, paymentCount: { type: "integer", nullable: true }, lines: arrayOf(directCostLineSchema), payments: arrayOf(directCostPaymentSchema), path: { type: "string" }, createdBy: nullableUuid, createdAt: nullableDateString, updatedAt: nullableDateString });
const directCostBody = objectSchema({ type: directCostType, description: { type: "string" }, vendorCompanyId: nullableUuid, vendorName: { type: "string", nullable: true }, invoiceNumber: { type: "string", nullable: true }, costDate: { type: "string", format: "date" }, dueDate: { type: "string", format: "date", nullable: true }, receivedDate: { type: "string", format: "date", nullable: true }, tax: { type: "number", nullable: true }, paymentTerms: { type: "string", nullable: true }, notes: { type: "string", nullable: true }, lines: arrayOf(directCostLineBody) });
const directCostIdParam = pathParam("directCostId", "Direct cost UUID.");
[
  { method: "get", path: "/projects/{projectId}/direct-costs", summary: "Direct costs with totals by status and type, paid / unpaid / overdue balances and the number waiting for approval.", operationId: "listDirectCosts", parameters: [...projectParams, queryParam("status", "Only this status.", directCostStatus), queryParam("type", "Only this type.", directCostType), queryParam("vendorCompanyId", "Only this vendor.", uuid), queryParam("from", "Cost date from.", { type: "string", format: "date" }), queryParam("to", "Cost date to.", { type: "string", format: "date" }), queryParam("q", "Ref, description, invoice number or vendor text.", { type: "string" })], permissions: modulePermission("cost", "read"), responseSchema: objectSchema({ items: arrayOf(directCostSchema), summary: objectSchema({ count: { type: "integer" }, byStatus: ref("GenericObject"), byType: ref("GenericObject"), total: { type: "number" }, paid: { type: "number" }, unpaid: { type: "number" }, overdue: { type: "number" }, pendingApproval: { type: "integer" } }) }) },
  { method: "post", path: "/projects/{projectId}/direct-costs", summary: "Record a direct cost (DC-nnn) — invoice, expense, payroll or other — with lines by cost code / budget line / activity; total = Σ lines + tax. 409 DIRECT_COST_DUPLICATE_INVOICE when the vendor's invoice number already exists.", operationId: "createDirectCost", parameters: projectParams, permissions: modulePermission("cost", "create"), requestBody: jsonBody(directCostBody, "Direct cost.", true), responseSchema: directCostSchema, status: 201 },
  { method: "get", path: "/projects/{projectId}/direct-costs/{directCostId}", summary: "One direct cost with its lines and payments.", operationId: "getDirectCost", parameters: [...projectParams, directCostIdParam], permissions: modulePermission("cost", "read"), responseSchema: directCostSchema },
  { method: "patch", path: "/projects/{projectId}/direct-costs/{directCostId}", summary: "Edit a draft or pending direct cost (lines replaced when sent). 409 DIRECT_COST_LOCKED once approved.", operationId: "updateDirectCost", parameters: [...projectParams, directCostIdParam], permissions: modulePermission("cost", "update"), requestBody: jsonBody(directCostBody, "Changes.", false), responseSchema: directCostSchema },
  { method: "delete", path: "/projects/{projectId}/direct-costs/{directCostId}", summary: "Delete a draft direct cost.", operationId: "deleteDirectCost", parameters: [...projectParams, directCostIdParam], permissions: modulePermission("cost", "delete"), responseSchema: objectSchema({ deleted: { type: "boolean" } }) },
  { method: "post", path: "/projects/{projectId}/direct-costs/{directCostId}/submit", summary: "Submit for approval: needs at least one line and a cost code (or budget line) on every line (400 DIRECT_COST_LINE_COST_CODE_REQUIRED); PMs and finance are notified.", operationId: "submitDirectCost", parameters: [...projectParams, directCostIdParam], permissions: modulePermission("cost", "submit"), responseSchema: directCostSchema },
  { method: "post", path: "/projects/{projectId}/direct-costs/{directCostId}/approve", summary: "Approve and post: each line's amount is added to its budget line's actual (the line named, else the cost code's line of the cost type — invoice → material, payroll → labour, expense → indirect — else any active line of the cost code) and to the activity's cost record actual; lines with no budget line are noted.", operationId: "approveDirectCost", parameters: [...projectParams, directCostIdParam], permissions: modulePermission("cost", "approve"), responseSchema: directCostSchema },
  { method: "post", path: "/projects/{projectId}/direct-costs/{directCostId}/reject", summary: "Return a pending direct cost to draft with a reason.", operationId: "rejectDirectCost", parameters: [...projectParams, directCostIdParam], permissions: modulePermission("cost", "approve"), requestBody: jsonBody(objectSchema({ reason: { type: "string" } }, ["reason"]), "Reason."), responseSchema: directCostSchema },
  { method: "post", path: "/projects/{projectId}/direct-costs/{directCostId}/void", summary: "Void with a reason; posted amounts are reversed exactly. 409 DIRECT_COST_HAS_PAYMENTS once a payment is recorded.", operationId: "voidDirectCost", parameters: [...projectParams, directCostIdParam], permissions: modulePermission("cost", "approve"), requestBody: jsonBody(objectSchema({ reason: { type: "string" } }, ["reason"]), "Reason."), responseSchema: directCostSchema },
  { method: "post", path: "/projects/{projectId}/direct-costs/{directCostId}/payments", summary: "Record a payment on an approved direct cost (≤ the balance, 400 DIRECT_COST_PAYMENT_EXCEEDS); paid in full moves it to paid; payments are outflows in the project cash flow.", operationId: "recordDirectCostPayment", parameters: [...projectParams, directCostIdParam], permissions: modulePermission("cost", "approve"), requestBody: jsonBody(objectSchema({ amount: { type: "number" }, paidAt: nullableDateString, method: { type: "string", nullable: true }, reference: { type: "string", nullable: true }, note: { type: "string", nullable: true } }, ["amount"]), "Payment."), responseSchema: directCostSchema, status: 201 },
].forEach((route) => addGenericRoute({ tag: "Direct Costs", ...route }));

// ─── Two-factor authentication and single sign-on (OCTA-SEC-AUTH-040) ─────
const mfaChallengeSchema = objectSchema({ mfaRequired: { type: "boolean", enum: [true] }, mfaToken: { type: "string", description: "Five-minute challenge token for POST /auth/mfa/verify." }, methods: arrayOf({ type: "string", enum: ["totp", "backup_code"] }) });
const mfaStatusSchema = objectSchema({ enabled: { type: "boolean" }, enrolledAt: nullableDateString, backupCodesRemaining: { type: "integer" }, pending: { type: "boolean" }, required: { type: "boolean" }, enrollmentRequired: { type: "boolean" }, ssoLinked: { type: "boolean" } });
const publicAuth = (path, method, { summary, description = undefined, operationId, requestBody = undefined, responseSchema = undefined, responses = undefined, parameters = [], status = 200 }) =>
  add(path, method, operation({ tag: "Auth", summary, description, operationId, security: false, parameters, requestBody, responseSchema, responses, status, permissions: { auth: "none" } }));
const userAuth = (path, method, { summary, description = undefined, operationId, requestBody = undefined, responseSchema = undefined, status = 200 }) =>
  add(path, method, operation({ tag: "Auth", summary, description, operationId, requestBody, responseSchema, status, permissions: { ...authenticatedOnly, note: "Any signed-in user, for their own account." } }));
publicAuth("/auth/mfa/verify", "post", { summary: "Second login step: the challenge token from POST /auth/login plus a 6-digit authenticator code or a backup code. Issues the normal session (refresh cookie + access token); backup codes are single-use; failures count towards the login lockout.", operationId: "verifyMfaLogin", requestBody: jsonBody(objectSchema({ mfaToken: { type: "string" }, code: { type: "string" } }, ["mfaToken", "code"]), "Challenge and code."), responses: { 200: authSessionResponse("Authenticated.") } });
userAuth("/auth/mfa", "get", { summary: "The caller's two-factor status, including whether the organisation requires it.", operationId: "getMfaStatus", responseSchema: mfaStatusSchema });
userAuth("/auth/mfa/setup", "post", { summary: "Start (or restart) enrolment: a new secret, the otpauth URL and a QR code as SVG. Nothing is enforced until /auth/mfa/enable confirms a code.", operationId: "startMfaSetup", responseSchema: objectSchema({ secret: { type: "string" }, otpauthUrl: { type: "string" }, qrSvg: { type: "string" }, issuer: { type: "string" }, account: { type: "string" } }) });
userAuth("/auth/mfa/enable", "post", { summary: "Confirm enrolment with a code from the app; returns the ten backup codes — shown once.", operationId: "enableMfa", requestBody: jsonBody(objectSchema({ code: { type: "string" } }, ["code"]), "Code."), responseSchema: objectSchema({ enabled: { type: "boolean" }, backupCodes: arrayOf({ type: "string" }) }) });
userAuth("/auth/mfa/disable", "post", { summary: "Turn two-factor off with the password and a current code (refused when the organisation requires it, unless the caller is a company admin).", operationId: "disableMfa", requestBody: jsonBody(objectSchema({ password: { type: "string" }, code: { type: "string" } }, ["password", "code"]), "Password and code."), responseSchema: objectSchema({ enabled: { type: "boolean" } }) });
userAuth("/auth/mfa/backup-codes", "post", { summary: "Replace the backup codes (needs a current authenticator code).", operationId: "regenerateMfaBackupCodes", requestBody: jsonBody(objectSchema({ code: { type: "string" } }, ["code"]), "Code."), responseSchema: objectSchema({ backupCodes: arrayOf({ type: "string" }) }) });
publicAuth("/auth/sso/lookup", "get", { summary: "Whether an email address signs in with single sign-on (by its organisation's email domains) and whether passwords are refused for it.", operationId: "ssoLookup", parameters: [queryParam("email", "Email address.", { type: "string", format: "email" })], responseSchema: objectSchema({ sso: { type: "boolean" }, required: { type: "boolean" }, orgName: { type: "string", nullable: true } }) });
publicAuth("/auth/sso/start", "post", { summary: "Build the identity provider's authorization URL (OpenID Connect authorization code with PKCE S256, signed state, nonce, login_hint) for the email's organisation. The browser is sent there.", operationId: "ssoStart", requestBody: jsonBody(objectSchema({ email: { type: "string", format: "email", nullable: true }, orgId: nullableUuid, redirectTo: { type: "string", nullable: true, description: "In-app path to open after sign-in." } }), "Who is signing in."), responseSchema: objectSchema({ authorizationUrl: { type: "string" }, orgName: { type: "string" } }) });
publicAuth("/auth/sso/callback", "get", { summary: "The provider's redirect target: verifies the state, exchanges the code (client secret + PKCE verifier), verifies the ID token against the provider's JWKS (signature, issuer, audience, expiry, nonce), links or provisions the user, and redirects the browser to WEB_APP_URL/sso/complete?ticket=… — or to /sign-in?ssoError=… on failure. Tokens never appear in a URL.", operationId: "ssoCallback", parameters: [queryParam("code", "Authorization code.", { type: "string" }), queryParam("state", "Signed state from /auth/sso/start.", { type: "string" }), queryParam("error", "Provider error.", { type: "string" }), queryParam("error_description", "Provider error description.", { type: "string" })], responses: { 302: { description: "Redirect to the web app." } } });
publicAuth("/auth/sso/complete", "post", { summary: "Exchange the one-time ticket (two minutes, single use) for the normal session: refresh cookie plus access token.", operationId: "ssoComplete", requestBody: jsonBody(objectSchema({ ticket: { type: "string" } }, ["ticket"]), "Ticket."), responses: { 200: authSessionResponse("Authenticated.") } });
const ssoSettingsSchema = objectSchema({ enabled: { type: "boolean" }, provider: { type: "string", enum: ["oidc"] }, issuer: { type: "string", nullable: true }, clientId: { type: "string", nullable: true }, clientSecretSet: { type: "boolean" }, domains: arrayOf({ type: "string" }), autoProvision: { type: "boolean" }, defaultRole: { type: "string" }, required: { type: "boolean" }, mfaRequired: { type: "boolean" }, redirectUri: { type: "string", description: "Register this with the identity provider." }, updatedAt: nullableDateString });
[
  { method: "get", path: "/company/security", summary: "SSO settings (secret masked), the MFA policy and every user's second-factor / SSO status.", operationId: "getCompanySecurity", parameters: [], permissions: companyAdminPermission, responseSchema: objectSchema({ sso: ssoSettingsSchema, mfaRequired: { type: "boolean" }, users: arrayOf(objectSchema({ id: uuid, name: { type: "string" }, email: { type: "string" }, role: { type: "string" }, status: { type: "string" }, isCompanyAdmin: { type: "boolean" }, mfaEnabled: { type: "boolean" }, mfaEnrolledAt: nullableDateString, ssoLinked: { type: "boolean" }, ssoLinkedAt: nullableDateString, lastLogin: nullableDateString })), summary: objectSchema({ users: { type: "integer" }, mfaEnabled: { type: "integer" }, ssoLinked: { type: "integer" } }) }) },
  { method: "put", path: "/company/security/sso", summary: "Update the OpenID Connect provider (issuer, client id, client secret — stored encrypted, email domains, auto-provisioning and default role, SSO-only policy) and the organisation-wide MFA requirement. Enabling needs issuer, client id and secret (400 SSO_INCOMPLETE); SSO-only needs at least one domain.", operationId: "updateCompanySso", parameters: [], permissions: companyAdminPermission, requestBody: jsonBody(objectSchema({ enabled: { type: "boolean" }, issuer: { type: "string", nullable: true }, clientId: { type: "string", nullable: true }, clientSecret: { type: "string", nullable: true }, domains: arrayOf({ type: "string" }), autoProvision: { type: "boolean" }, defaultRole: { type: "string" }, required: { type: "boolean" }, mfaRequired: { type: "boolean" } }), "Settings.", false), responseSchema: ssoSettingsSchema },
  { method: "post", path: "/company/security/sso/test", summary: "Read the provider's discovery document and report its endpoints and supported PKCE methods.", operationId: "testCompanySso", parameters: [], permissions: companyAdminPermission, responseSchema: objectSchema({ ok: { type: "boolean" }, issuer: { type: "string" }, authorizationEndpoint: { type: "string" }, tokenEndpoint: { type: "string" }, jwksUri: { type: "string" }, scopes: arrayOf({ type: "string" }), codeChallengeMethods: arrayOf({ type: "string" }), redirectUri: { type: "string" } }) },
  { method: "post", path: "/company/security/users/{userId}/mfa/reset", summary: "Clear a colleague's second factor so they can enrol again (audited).", operationId: "resetUserMfa", parameters: [pathParam("userId", "User UUID.")], permissions: companyAdminPermission, responseSchema: objectSchema({ reset: { type: "boolean" } }) },
].forEach((route) => addGenericRoute({ tag: "Company Workspace", ...route }));

// ─── Schedule export and lookaheads (OCTA-SCH-LOOKAHEAD-041) ─────────────
add("/projects/{projectId}/export/schedule/{format}", "get", operation({ tag: "Exports", summary: "Download the active schedule in a planner's own format: `xer` (Primavera P6 XER), `p6xml` (Primavera P6 XML) or `mspxml` (Microsoft Project XML). Calendars, the WBS tree (names from the revision), activities with early / late / actual dates, physical % complete, remaining duration and total float, and every dependency with its lag. P6 units are hours (8 per working day); MSPDI durations are ISO 8601 and slack / link lag are tenths of a minute (4800 per working day). Every file round-trips through the import parsers.", operationId: "exportScheduleFile", parameters: [...projectParams, { name: "format", in: "path", required: true, description: "xer | p6xml | mspxml", schema: { type: "string", enum: ["xer", "p6xml", "mspxml"] } }], permissions: modulePermission("schedule", "export"), responses: { 200: { description: "The schedule file, as an attachment.", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } }, "application/xml": { schema: { type: "string" } } } } } }));
const dateOnly = { type: "string", format: "date" };
const nullableDateOnly = { type: "string", format: "date", nullable: true };
const lookaheadStatus = { type: "string", enum: ["draft", "published", "archived"] };
const lookaheadItemStatus = { type: "string", enum: ["planned", "in_progress", "done", "not_done"] };
const lookaheadConstraintStatus = { type: "string", enum: ["none", "open", "cleared"] };
const lookaheadVarianceReason = { type: "string", enum: ["design", "material", "labour", "equipment", "weather", "prerequisite", "permit", "space", "other"], nullable: true };
const lookaheadFilterSchema = objectSchema({ wbsPrefixes: arrayOf({ type: "string" }), categories: arrayOf({ type: "string" }), activityIds: arrayOf(uuid), onlyCritical: { type: "boolean" } });
const lookaheadItemSchema = objectSchema({ id: uuid, lookaheadId: uuid, activityId: nullableUuid, activity: nullableRef("GenericObject"), source: { type: "string", enum: ["schedule", "added", "carried"] }, name: { type: "string" }, wbsCode: { type: "string", nullable: true }, plannedStart: dateOnly, plannedFinish: dateOnly, scheduleStart: nullableDateOnly, scheduleFinish: nullableDateOnly, datesEdited: { type: "boolean" }, driftDays: { type: "integer", nullable: true, description: "Planned finish minus the schedule's finish." }, crewId: nullableUuid, crew: nullableRef("GenericObject"), companyId: nullableUuid, assigneeUserId: nullableUuid, locationId: nullableUuid, location: nullableRef("GenericObject"), quantity: { type: "number", nullable: true }, unit: { type: "string", nullable: true }, status: lookaheadItemStatus, pctComplete: { type: "number" }, varianceReason: lookaheadVarianceReason, constraint: { type: "string", nullable: true }, constraintStatus: lookaheadConstraintStatus, constraintOwnerUserId: nullableUuid, constraintDueDate: nullableDateOnly, constraintClearedAt: nullableDateString, constraintOverdue: { type: "boolean" }, behind: { type: "boolean" }, notes: { type: "string", nullable: true }, sortOrder: { type: "integer" }, carriedFromItemId: nullableUuid, createdBy: nullableUuid, createdAt: nullableDateString, updatedAt: nullableDateString });
const lookaheadWeekSchema = objectSchema({ week: { type: "integer" }, start: dateOnly, end: dateOnly, closed: { type: "boolean" }, committed: { type: "integer" }, completed: { type: "integer" }, notDone: { type: "integer" }, ppc: { type: "number", nullable: true } });
const lookaheadSummarySchema = objectSchema({ items: { type: "integer" }, byStatus: ref("GenericObject"), openConstraints: { type: "integer" }, overdueConstraints: { type: "integer" }, behind: { type: "integer" }, ppc: objectSchema({ weeks: arrayOf(lookaheadWeekSchema), closedWeeks: { type: "integer" }, committed: { type: "integer" }, completed: { type: "integer" }, ppc: { type: "number", nullable: true, description: "Percent plan complete over the closed weeks." }, varianceReasons: ref("GenericObject") }) });
const lookaheadGridSchema = arrayOf(objectSchema({ index: { type: "integer" }, start: dateOnly, end: dateOnly, label: { type: "string" }, closed: { type: "boolean" }, current: { type: "boolean" }, days: arrayOf(objectSchema({ date: dateOnly, dow: { type: "integer" }, label: { type: "string" }, working: { type: "boolean" }, isToday: { type: "boolean" } })) }));
const lookaheadSchema = objectSchema({ id: uuid, projectId: uuid, number: { type: "integer" }, ref: { type: "string", example: "LA-001" }, title: { type: "string" }, startDate: dateOnly, endDate: dateOnly, weeks: { type: "integer" }, weekStartDay: { type: "integer" }, status: lookaheadStatus, filter: lookaheadFilterSchema, notes: { type: "string", nullable: true }, publishedBy: nullableUuid, publishedAt: nullableDateString, archivedBy: nullableUuid, archivedAt: nullableDateString, refreshedAt: nullableDateString, rolledFromId: nullableUuid, current: { type: "boolean" }, summary: lookaheadSummarySchema, grid: lookaheadGridSchema, items: arrayOf(lookaheadItemSchema), path: { type: "string" }, createdBy: nullableUuid, createdAt: nullableDateString, updatedAt: nullableDateString });
const lookaheadBody = objectSchema({ startDate: { ...dateOnly, description: "Moved back to the week boundary (weekStartDay)." }, weeks: { type: "integer", enum: [2, 3, 4, 5, 6] }, weekStartDay: { type: "integer", minimum: 0, maximum: 6, description: "0 Sunday … 6 Saturday; default Monday." }, title: { type: "string", nullable: true }, notes: { type: "string", nullable: true }, filter: lookaheadFilterSchema, seed: { type: "boolean", description: "Seed from the master schedule (default true)." } });
const lookaheadItemBody = objectSchema({ name: { type: "string", nullable: true, description: "Defaults to the activity's name." }, activityId: nullableUuid, wbsCode: { type: "string", nullable: true }, plannedStart: nullableDateOnly, plannedFinish: nullableDateOnly, crewId: nullableUuid, companyId: nullableUuid, assigneeUserId: nullableUuid, locationId: nullableUuid, quantity: { type: "number", nullable: true }, unit: { type: "string", nullable: true }, status: lookaheadItemStatus, pctComplete: { type: "number", nullable: true }, varianceReason: lookaheadVarianceReason, constraint: { type: "string", nullable: true }, constraintStatus: lookaheadConstraintStatus, constraintOwnerUserId: nullableUuid, constraintDueDate: nullableDateOnly, notes: { type: "string", nullable: true }, sortOrder: { type: "integer" } });
const lookaheadIdParam = pathParam("lookaheadId", "Lookahead UUID.");
const lookaheadItemIdParam = pathParam("itemId", "Lookahead task UUID.");
[
  { method: "get", path: "/projects/{projectId}/lookaheads", summary: "Lookaheads with per-plan summaries (task counts by status, open / overdue constraints, tasks behind, PPC) and which one covers today. Party users see published and archived plans plus their own drafts.", operationId: "listLookaheads", parameters: [...projectParams, queryParam("status", "Only this status.", lookaheadStatus)], permissions: modulePermission("lookahead", "read"), responseSchema: objectSchema({ items: arrayOf(lookaheadSchema), summary: objectSchema({ count: { type: "integer" }, byStatus: ref("GenericObject"), currentId: nullableUuid, openConstraints: { type: "integer" } }) }) },
  { method: "post", path: "/projects/{projectId}/lookaheads", summary: "Create a lookahead (LA-nnn): a 2–6 week window from the week boundary, seeded with every active, unfinished activity whose dates (actual start, early dates or planned dates) touch the window — narrowed by WBS prefixes, phases, critical-only or an explicit activity list. Items keep the schedule's dates next to the planned ones.", operationId: "createLookahead", parameters: projectParams, permissions: modulePermission("lookahead", "create"), requestBody: jsonBody(lookaheadBody, "Lookahead."), responseSchema: lookaheadSchema, status: 201 },
  { method: "get", path: "/projects/{projectId}/lookaheads/constraints", summary: "The make-ready log: every open constraint across the project's live lookaheads with owner, due date and overdue flag.", operationId: "listLookaheadConstraints", parameters: projectParams, permissions: modulePermission("lookahead", "read"), responseSchema: objectSchema({ items: arrayOf(lookaheadItemSchema), summary: objectSchema({ open: { type: "integer" }, overdue: { type: "integer" }, dueThisWeek: { type: "integer" } }) }) },
  { method: "get", path: "/projects/{projectId}/lookaheads/{lookaheadId}", summary: "One lookahead with its tasks, the week / day grid (working days from the project calendar) and the summary.", operationId: "getLookahead", parameters: [...projectParams, lookaheadIdParam], permissions: modulePermission("lookahead", "read"), responseSchema: lookaheadSchema },
  { method: "patch", path: "/projects/{projectId}/lookaheads/{lookaheadId}", summary: "Edit the title, notes, window or filter (409 LOOKAHEAD_LOCKED once archived). Changing the window does not re-seed — call refresh.", operationId: "updateLookahead", parameters: [...projectParams, lookaheadIdParam], permissions: modulePermission("lookahead", "update"), requestBody: jsonBody(lookaheadBody, "Changes.", false), responseSchema: lookaheadSchema },
  { method: "delete", path: "/projects/{projectId}/lookaheads/{lookaheadId}", summary: "Delete a draft lookahead (409 LOOKAHEAD_NOT_DRAFT otherwise — archive it).", operationId: "deleteLookahead", parameters: [...projectParams, lookaheadIdParam], permissions: modulePermission("lookahead", "delete"), responseSchema: objectSchema({ deleted: { type: "boolean" } }) },
  { method: "post", path: "/projects/{projectId}/lookaheads/{lookaheadId}/refresh", summary: "Bring the plan up to date with the master schedule: newly due activities are added, unedited dates follow the schedule (edited ones stay, drift is shown), approved progress lifts % complete, finished activities complete their task, removed tasks stay away.", operationId: "refreshLookahead", parameters: [...projectParams, lookaheadIdParam], permissions: modulePermission("lookahead", "update"), responseSchema: objectSchema({ added: { type: "integer" }, updated: { type: "integer" }, completed: { type: "integer" }, lookahead: lookaheadSchema }) },
  { method: "post", path: "/projects/{projectId}/lookaheads/{lookaheadId}/publish", summary: "Publish a draft (needs at least one task, 400 LOOKAHEAD_EMPTY): PMs, planners and site engineers plus every assignee, crew foreman and constraint owner are notified; party users can now see it.", operationId: "publishLookahead", parameters: [...projectParams, lookaheadIdParam], permissions: modulePermission("lookahead", "submit", "lookahead.publish"), responseSchema: lookaheadSchema },
  { method: "post", path: "/projects/{projectId}/lookaheads/{lookaheadId}/archive", summary: "Archive a lookahead (read-only from then on).", operationId: "archiveLookahead", parameters: [...projectParams, lookaheadIdParam], permissions: modulePermission("lookahead", "update", "lookahead.archive"), responseSchema: lookaheadSchema },
  { method: "post", path: "/projects/{projectId}/lookaheads/{lookaheadId}/roll-forward", summary: "Create the next lookahead (one week later by default, same length and filter) carrying the unfinished tasks — planned and in-progress tasks still due, and not-done tasks re-planned from the new start with the reason noted and open constraints kept — then seeding the newly due activities; activities the previous plan settled are not re-seeded. Optionally archives the source.", operationId: "rollForwardLookahead", parameters: [...projectParams, lookaheadIdParam], permissions: modulePermission("lookahead", "create"), requestBody: jsonBody(objectSchema({ startDate: nullableDateOnly, weeks: { type: "integer", enum: [2, 3, 4, 5, 6] }, title: { type: "string", nullable: true }, notes: { type: "string", nullable: true }, archiveSource: { type: "boolean" } }), "Options.", false), responseSchema: lookaheadSchema, status: 201 },
  { method: "get", path: "/projects/{projectId}/lookaheads/{lookaheadId}/export.xlsx", summary: "XLSX of the plan: the day grid with one column per day (planned days shaded by status, non-working days greyed, today marked), the constraints, PPC per week with variance reasons, and an About sheet.", operationId: "exportLookahead", parameters: [...projectParams, lookaheadIdParam], permissions: modulePermission("lookahead", "export"), responses: { 200: { description: "Workbook.", content: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { schema: { type: "string", format: "binary" } } } } } },
  { method: "post", path: "/projects/{projectId}/lookaheads/{lookaheadId}/items", summary: "Add a task — by hand or from an activity (name, WBS defaulted) — with planned dates, crew, location, quantity and an optional constraint. Party users' tasks belong to their company.", operationId: "addLookaheadItem", parameters: [...projectParams, lookaheadIdParam], permissions: modulePermission("lookahead", "update"), requestBody: jsonBody(lookaheadItemBody, "Task."), responseSchema: lookaheadItemSchema, status: 201 },
  { method: "patch", path: "/projects/{projectId}/lookaheads/{lookaheadId}/items/{itemId}", summary: "Edit a task: dates (edited dates survive a refresh), crew, location, quantity, status (not_done needs a variance reason), % complete (100 → done), constraint text / status / owner / due date, notes, order. Subcontractors may only edit their own company's tasks (403 LOOKAHEAD_ITEM_FORBIDDEN).", operationId: "updateLookaheadItem", parameters: [...projectParams, lookaheadIdParam, lookaheadItemIdParam], permissions: modulePermission("lookahead", "update"), requestBody: jsonBody(lookaheadItemBody, "Changes.", false), responseSchema: lookaheadItemSchema },
  { method: "post", path: "/projects/{projectId}/lookaheads/{lookaheadId}/items/{itemId}/status", summary: "Mark a task planned / in progress / done / not done (with the reason) from the site.", operationId: "setLookaheadItemStatus", parameters: [...projectParams, lookaheadIdParam, lookaheadItemIdParam], permissions: modulePermission("lookahead", "update", "lookahead.item_status"), requestBody: jsonBody(objectSchema({ status: lookaheadItemStatus, varianceReason: lookaheadVarianceReason, pctComplete: { type: "number", nullable: true }, notes: { type: "string", nullable: true } }, ["status"]), "Status."), responseSchema: lookaheadItemSchema },
  { method: "delete", path: "/projects/{projectId}/lookaheads/{lookaheadId}/items/{itemId}", summary: "Remove a task: schedule-seeded tasks are kept as removed so a refresh does not bring them back; added tasks are deleted.", operationId: "removeLookaheadItem", parameters: [...projectParams, lookaheadIdParam, lookaheadItemIdParam], permissions: modulePermission("lookahead", "update"), responseSchema: objectSchema({ removed: { type: "boolean" } }) },
].forEach((route) => addGenericRoute({ tag: "Lookaheads", ...route }));

// ─── BIM models (OCTA-BIM-IFC-043) ────────────────────────────────────────
const bimStatus = { type: "string", enum: ["processing", "ready", "failed"] };
const bimDiscipline = { type: "string", enum: ["architectural", "structural", "mechanical", "electrical", "plumbing", "civil", "coordination", "other"], nullable: true };
const bimLinkRecordType = { type: "string", enum: ["activity", "location", "boq_item", "punch_item", "observation", "rfi", "ncr"] };
const bimRelationType = { type: "string", enum: ["represents", "affects", "reference"] };
const bimQuantities = objectSchema({ netVolume: { type: "number" }, grossVolume: { type: "number" }, netArea: { type: "number" }, grossArea: { type: "number" }, length: { type: "number" }, width: { type: "number" }, height: { type: "number" }, perimeter: { type: "number" }, weight: { type: "number" }, count: { type: "number" } });
const bimSpatialNode = objectSchema({ globalId: { type: "string" }, ifcType: { type: "string" }, name: { type: "string", nullable: true }, longName: { type: "string", nullable: true }, elevation: { type: "number", nullable: true }, parentGlobalId: { type: "string", nullable: true }, elementCount: { type: "integer" }, children: { type: "array", items: ref("GenericObject") } });
const bimModelSchema = objectSchema({ id: uuid, projectId: uuid, name: { type: "string" }, discipline: bimDiscipline, documentId: nullableUuid, fileName: { type: "string", nullable: true }, fileSize: { type: "integer", nullable: true }, schema: { type: "string", nullable: true, description: "IFC4 or IFC2X3." }, status: bimStatus, version: { type: "integer" }, isCurrent: { type: "boolean" }, supersededById: nullableUuid, ifcProjectName: { type: "string", nullable: true }, siteName: { type: "string", nullable: true }, buildingName: { type: "string", nullable: true }, units: ref("GenericObject"), header: ref("GenericObject"), spatial: arrayOf(bimSpatialNode), typeSummary: arrayOf(objectSchema({ ifcType: { type: "string" }, label: { type: "string" }, count: { type: "integer" }, netVolume: { type: "number" }, netArea: { type: "number" } })), warnings: arrayOf({ type: "string" }), elementCount: { type: "integer" }, entityCount: { type: "integer" }, storeyCount: { type: "integer" }, linkedCount: { type: "integer" }, parsedAt: nullableDateString, jobId: nullableUuid, error: { type: "string", nullable: true }, notes: { type: "string", nullable: true }, path: { type: "string" }, uploadedBy: nullableUuid, createdAt: nullableDateString, updatedAt: nullableDateString });
const bimLinkSchema = objectSchema({ id: uuid, modelId: uuid, elementId: uuid, element: nullableRef("GenericObject"), recordType: bimLinkRecordType, recordId: { type: "string" }, recordTitle: { type: "string", nullable: true }, recordPath: { type: "string", nullable: true }, relationType: bimRelationType, notes: { type: "string", nullable: true }, createdBy: nullableUuid, createdAt: nullableDateString });
const bimElementSchema = objectSchema({ id: uuid, modelId: uuid, globalId: { type: "string" }, ifcType: { type: "string" }, typeLabel: { type: "string" }, name: { type: "string", nullable: true }, description: { type: "string", nullable: true }, objectType: { type: "string", nullable: true }, predefinedType: { type: "string", nullable: true }, tag: { type: "string", nullable: true }, typeName: { type: "string", nullable: true }, storeyName: { type: "string", nullable: true }, storeyGlobalId: { type: "string", nullable: true }, elevation: { type: "number", nullable: true }, spatialPath: { type: "string", nullable: true }, materials: arrayOf({ type: "string" }), properties: freeObject("Property sets, keyed by set name."), quantities: bimQuantities, linkCount: { type: "integer" }, links: arrayOf(bimLinkSchema), createdAt: nullableDateString });
const bimModelIdParam = pathParam("modelId", "BIM model UUID.");
const bimElementIdParam = pathParam("elementId", "BIM element UUID.");
const bimElementFilters = [
  queryParam("ifcType", "Only this IFC type (IFCWALL, IFCSLAB …).", { type: "string" }),
  queryParam("storeyGlobalId", "Only elements on this storey.", { type: "string" }),
  queryParam("typeName", "Only this type name (`Concrete 300`).", { type: "string" }),
  queryParam("q", "Text over name, tag, type name, material and storey.", { type: "string" }),
  queryParam("linked", "true: only linked elements; false: only unlinked.", { type: "string", enum: ["true", "false"] }),
];
[
  { method: "get", path: "/projects/{projectId}/bim/models", summary: "The project's IFC models, current version first, with element and link counts.", operationId: "listBimModels", parameters: [...projectParams, queryParam("status", "Only this status.", bimStatus), queryParam("discipline", "Only this discipline.", { type: "string" }), queryParam("current", "Only the current version of each model.", { type: "string", enum: ["true", "false"] })], permissions: modulePermission("bim", "read"), responseSchema: objectSchema({ items: arrayOf(bimModelSchema), summary: objectSchema({ count: { type: "integer" }, current: { type: "integer" }, elements: { type: "integer" }, linked: { type: "integer" }, byStatus: ref("GenericObject") }) }) },
  { method: "get", path: "/projects/{projectId}/bim/models/{modelId}", summary: "One model with its header, units, spatial breakdown and element counts by IFC type.", operationId: "getBimModel", parameters: [...projectParams, bimModelIdParam], permissions: modulePermission("bim", "read"), responseSchema: bimModelSchema },
  { method: "patch", path: "/projects/{projectId}/bim/models/{modelId}", summary: "Rename a model, set its discipline or its notes.", operationId: "updateBimModel", parameters: [...projectParams, bimModelIdParam], permissions: modulePermission("bim", "update"), requestBody: jsonBody(objectSchema({ name: { type: "string" }, discipline: bimDiscipline, notes: { type: "string", nullable: true } }), "Changes.", false), responseSchema: bimModelSchema },
  { method: "delete", path: "/projects/{projectId}/bim/models/{modelId}", summary: "Delete a model with its elements and links; the version it superseded becomes current again.", operationId: "deleteBimModel", parameters: [...projectParams, bimModelIdParam], permissions: modulePermission("bim", "delete"), responseSchema: objectSchema({ deleted: { type: "boolean" } }) },
  { method: "post", path: "/projects/{projectId}/bim/models/{modelId}/reparse", summary: "Read the uploaded file again (after a parser improvement or a failure).", operationId: "reparseBimModel", parameters: [...projectParams, bimModelIdParam], permissions: modulePermission("bim", "update"), responseSchema: bimModelSchema, status: 202 },
  { method: "get", path: "/projects/{projectId}/bim/models/{modelId}/spatial", summary: "The spatial breakdown as a tree (project → site → building → storey → space) with the element count on every node.", operationId: "getBimSpatialTree", parameters: [...projectParams, bimModelIdParam], permissions: modulePermission("bim", "read"), responseSchema: objectSchema({ items: arrayOf(bimSpatialNode), storeys: arrayOf(bimSpatialNode) }) },
  { method: "get", path: "/projects/{projectId}/bim/models/{modelId}/elements", summary: "Elements of the model, filtered and cursor-paged.", operationId: "listBimElements", parameters: [...projectParams, bimModelIdParam, ...bimElementFilters, queryParam("cursor", "Element id of the previous page's last row.", uuid), queryParam("limit", "Page size (default 100).", { type: "integer", minimum: 1, maximum: 500 })], permissions: modulePermission("bim", "read"), responseSchema: objectSchema({ items: arrayOf(bimElementSchema), nextCursor: nullableUuid, total: { type: "integer" } }) },
  { method: "get", path: "/projects/{projectId}/bim/models/{modelId}/elements/export.xlsx", summary: "XLSX of the filtered elements (Elements, Quantities by type, About).", operationId: "exportBimElements", parameters: [...projectParams, bimModelIdParam, ...bimElementFilters], permissions: modulePermission("bim", "export"), responses: { 200: { description: "Workbook.", content: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { schema: { type: "string", format: "binary" } } } } } },
  { method: "get", path: "/projects/{projectId}/bim/models/{modelId}/elements/{elementId}", summary: "One element with its property sets, quantities, materials and links.", operationId: "getBimElement", parameters: [...projectParams, bimModelIdParam, bimElementIdParam], permissions: modulePermission("bim", "read"), responseSchema: bimElementSchema },
  { method: "get", path: "/projects/{projectId}/bim/models/{modelId}/quantities", summary: "Element counts and quantity totals by IFC type or by storey, over the same filters as the element list.", operationId: "getBimQuantities", parameters: [...projectParams, bimModelIdParam, ...bimElementFilters, queryParam("groupBy", "type (default) or storey.", { type: "string", enum: ["type", "storey"] })], permissions: modulePermission("bim", "read"), responseSchema: objectSchema({ groupBy: { type: "string" }, units: ref("GenericObject"), items: arrayOf(objectSchema({ key: { type: "string" }, label: { type: "string" }, ifcType: { type: "string", nullable: true }, storeyGlobalId: { type: "string", nullable: true }, elements: { type: "integer" }, netVolume: { type: "number" }, grossVolume: { type: "number" }, netArea: { type: "number" }, grossArea: { type: "number" }, length: { type: "number" }, weight: { type: "number" }, count: { type: "number" } })), totals: ref("GenericObject") }) },
  { method: "get", path: "/projects/{projectId}/bim/models/{modelId}/links", summary: "Every element link on the model, and the records they point at with their element counts.", operationId: "listBimLinks", parameters: [...projectParams, bimModelIdParam, queryParam("recordType", "Only links to this record type.", bimLinkRecordType), queryParam("recordId", "Only links to this record.", { type: "string" })], permissions: modulePermission("bim", "read"), responseSchema: objectSchema({ items: arrayOf(bimLinkSchema), records: arrayOf(objectSchema({ recordType: bimLinkRecordType, recordId: { type: "string" }, recordTitle: { type: "string", nullable: true }, recordPath: { type: "string", nullable: true }, elements: { type: "integer" } })) }) },
  { method: "post", path: "/projects/{projectId}/bim/models/{modelId}/links", summary: "Tie elements to a record — an **activity** (which is what puts model elements on the activity-linked spine), a location, a BOQ item, a punch item / observation, an RFI or an NCR. Name the elements with `elementIds`, or send the same `filter` the element list takes to link everything it matches (up to 5 000) in one action. Links already present are counted, not duplicated.", operationId: "createBimLinks", parameters: [...projectParams, bimModelIdParam], permissions: modulePermission("bim", "update", "bim.link"), requestBody: jsonBody(objectSchema({ recordType: bimLinkRecordType, recordId: { type: "string" }, relationType: bimRelationType, elementIds: arrayOf(uuid), filter: objectSchema({ ifcType: { type: "string" }, storeyGlobalId: { type: "string" }, typeName: { type: "string" }, q: { type: "string" }, linked: { type: "string" } }), notes: { type: "string", nullable: true } }, ["recordType", "recordId"]), "What to link."), responseSchema: objectSchema({ linked: { type: "integer" }, alreadyLinked: { type: "integer" }, recordType: bimLinkRecordType, recordId: { type: "string" }, recordTitle: { type: "string", nullable: true } }), status: 201 },
  { method: "delete", path: "/projects/{projectId}/bim/models/{modelId}/links/{linkId}", summary: "Remove one element link.", operationId: "deleteBimLink", parameters: [...projectParams, bimModelIdParam, pathParam("linkId", "Link UUID.")], permissions: modulePermission("bim", "update", "bim.link"), responseSchema: objectSchema({ deleted: { type: "boolean" } }) },
  { method: "get", path: "/projects/{projectId}/bim/records/{recordType}/{recordId}/elements", summary: "Every model element tied to one record, with the quantity totals — what an activity, location or BOQ item covers in the models.", operationId: "listBimElementsForRecord", parameters: [...projectParams, pathParam("recordType", "activity | location | boq_item | punch_item | observation | rfi | ncr", null), pathParam("recordId", "Record id.", null)], permissions: modulePermission("bim", "read"), responseSchema: objectSchema({ items: arrayOf(objectSchema({ linkId: uuid, modelId: uuid, modelName: { type: "string", nullable: true }, relationType: bimRelationType, element: nullableRef("GenericObject") })), totals: objectSchema({ elements: { type: "integer" }, netVolume: { type: "number" }, netArea: { type: "number" } }) }) },
].forEach((route) => addGenericRoute({ tag: "BIM", ...route }));
add("/projects/{projectId}/bim/models", "post", operation({
  tag: "BIM",
  summary: "Upload an IFC model (.ifc, up to BIM_MAX_BYTES / 300 MB). The file is stored as a project document and read in the background (`bim.parse`): the spatial breakdown, every element with its type, materials, property sets and base quantities. Geometry is not evaluated. A second upload under the same name becomes version n+1 and supersedes the previous current model. Answers 202 with the model in `processing`.",
  operationId: "createBimModel",
  parameters: projectParams,
  permissions: modulePermission("bim", "create"),
  requestBody: fileUploadBody({ description: "The IFC model.", accepted: "IFC (.ifc)", extraProperties: { name: { type: "string" }, discipline: { type: "string" }, notes: { type: "string" } } }),
  responseSchema: bimModelSchema,
  status: 202,
}));

// ─── Conversations and inbound email (OCTA-COMM-CONV-042) ─────────────────
const conversationKind = { type: "string", enum: ["direct", "group", "record"] };
const conversationMemberSchema = objectSchema({ userId: uuid, name: { type: "string", nullable: true }, email: { type: "string", nullable: true }, role: { type: "string", nullable: true }, memberRole: { type: "string", enum: ["member", "admin"] }, joinedAt: nullableDateString, lastReadAt: nullableDateString });
const conversationSchema = objectSchema({ id: uuid, projectId: nullableUuid, project: nullableRef("GenericObject"), kind: conversationKind, title: { type: "string", description: "Display title: the name, the other person, or the record." }, rawTitle: { type: "string", nullable: true }, recordType: { type: "string", nullable: true }, recordId: { type: "string", nullable: true }, recordTitle: { type: "string", nullable: true }, recordPath: { type: "string", nullable: true }, lastMessageAt: nullableDateString, lastMessagePreview: { type: "string", nullable: true }, messageCount: { type: "integer" }, archivedAt: nullableDateString, members: arrayOf(conversationMemberSchema), me: objectSchema({ memberRole: { type: "string" }, lastReadAt: nullableDateString, starred: { type: "boolean" }, muted: { type: "boolean" } }), unread: { type: "integer" }, path: { type: "string" }, createdBy: nullableUuid, createdAt: nullableDateString, updatedAt: nullableDateString });
const conversationMessageSchema = objectSchema({ id: uuid, conversationId: uuid, authorId: nullableUuid, author: nullableRef("GenericObject"), kind: { type: "string", enum: ["text", "system", "email"] }, body: { type: "string" }, mentions: arrayOf(objectSchema({ userId: uuid, name: { type: "string", nullable: true } })), linkedRecord: { nullable: true, allOf: [objectSchema({ recordType: { type: "string" }, recordId: { type: "string" }, title: { type: "string", nullable: true }, projectId: nullableUuid, path: { type: "string", nullable: true } })] }, inboundEmailId: nullableUuid, editedAt: nullableDateString, deletedAt: nullableDateString, isMine: { type: "boolean" }, createdAt: nullableDateString });
const conversationIdParam = pathParam("conversationId", "Conversation UUID.");
const conversationMessageIdParam = pathParam("messageId", "Message UUID.");
const linkedRecordBody = objectSchema({ recordType: { type: "string" }, recordId: { type: "string" }, projectId: { ...nullableUuid, description: "Defaults to the conversation's project." }, title: { type: "string", nullable: true } }, ["recordType", "recordId"]);
[
  { method: "get", path: "/conversations", summary: "The caller's conversations, newest activity first, with unread counts; `filter` all | unread | starred | archived, `projectId` to scope, `q` over titles, previews and member names.", operationId: "listConversations", parameters: [queryParam("projectId", "Only this project's conversations.", uuid), queryParam("filter", "all | unread | starred | archived.", { type: "string", enum: ["all", "unread", "starred", "archived"] }), queryParam("q", "Text over titles, previews and member names.", { type: "string" }), queryParam("limit", "Maximum conversations.", { type: "integer", minimum: 1, maximum: 200 })], permissions: modulePermission("conversation", "read"), responseSchema: objectSchema({ items: arrayOf(conversationSchema), summary: objectSchema({ count: { type: "integer" }, unreadConversations: { type: "integer" }, unreadMessages: { type: "integer" } }) }) },
  { method: "get", path: "/conversations/unread", summary: "Unread conversations and messages for the badge (muted and archived threads excluded).", operationId: "unreadConversations", parameters: [], permissions: modulePermission("conversation", "read"), responseSchema: objectSchema({ unreadConversations: { type: "integer" }, unreadMessages: { type: "integer" } }) },
  { method: "get", path: "/conversations/people", summary: "People the caller can message: active members of the organisation; with `projectId`, only those who can open that project.", operationId: "listConversationPeople", parameters: [queryParam("projectId", "Narrow to people with access to this project.", uuid), queryParam("q", "Name or email text.", { type: "string" }), queryParam("limit", "Maximum people.", { type: "integer", minimum: 1, maximum: 200 })], permissions: modulePermission("conversation", "read"), responseSchema: objectSchema({ items: arrayOf(objectSchema({ id: uuid, name: { type: "string" }, email: { type: "string" }, role: { type: "string", nullable: true } })) }) },
  { method: "post", path: "/conversations", summary: "Start a conversation: `direct` (one other person — an existing thread for the pair is reused), `group` (title + people) or `record` (one thread per project record, `recordType` + `recordId`; reused). Project conversations only admit people who can open the project (400 CONVERSATION_MEMBER_INVALID). An optional first `message` is sent.", operationId: "createConversation", parameters: [], permissions: modulePermission("conversation", "create"), requestBody: jsonBody(objectSchema({ kind: conversationKind, projectId: nullableUuid, title: { type: "string", nullable: true }, memberUserIds: arrayOf(uuid), recordType: { type: "string", nullable: true }, recordId: { type: "string", nullable: true }, message: { type: "string", nullable: true } }), "Conversation."), responseSchema: conversationSchema, status: 201 },
  { method: "get", path: "/conversations/{conversationId}", summary: "One conversation with its members and the caller's unread count (members only — others get 404).", operationId: "getConversation", parameters: [conversationIdParam], permissions: modulePermission("conversation", "read"), responseSchema: conversationSchema },
  { method: "patch", path: "/conversations/{conversationId}", summary: "Rename a group / record thread, or archive / unarchive (starter, project manager or admin).", operationId: "updateConversation", parameters: [conversationIdParam], permissions: modulePermission("conversation", "update"), requestBody: jsonBody(objectSchema({ title: { type: "string", nullable: true }, archived: { type: "boolean" } }), "Changes.", false), responseSchema: conversationSchema },
  { method: "post", path: "/conversations/{conversationId}/members", summary: "Add people (they are notified; a system message records it).", operationId: "addConversationMembers", parameters: [conversationIdParam], permissions: modulePermission("conversation", "update"), requestBody: jsonBody(objectSchema({ userIds: arrayOf(uuid) }, ["userIds"]), "People."), responseSchema: conversationSchema },
  { method: "delete", path: "/conversations/{conversationId}/members/{userId}", summary: "Leave (your own id) or remove someone (admins).", operationId: "removeConversationMember", parameters: [conversationIdParam, userIdParam], permissions: modulePermission("conversation", "update"), responseSchema: ref("GenericObject") },
  { method: "patch", path: "/conversations/{conversationId}/me", summary: "Star or mute the conversation for yourself (muted threads do not notify new messages).", operationId: "setConversationFlags", parameters: [conversationIdParam], permissions: modulePermission("conversation", "read"), requestBody: jsonBody(objectSchema({ starred: { type: "boolean" }, muted: { type: "boolean" } }), "Flags.", false), responseSchema: conversationSchema },
  { method: "post", path: "/conversations/{conversationId}/read", summary: "Mark everything read.", operationId: "markConversationRead", parameters: [conversationIdParam], permissions: modulePermission("conversation", "read"), responseSchema: objectSchema({ conversationId: uuid, lastReadAt: dateString, unread: { type: "integer" } }) },
  { method: "get", path: "/conversations/{conversationId}/messages", summary: "Messages, oldest first within the page; `cursor` = the first message id of the previous page to load older ones.", operationId: "listConversationMessages", parameters: [conversationIdParam, queryParam("cursor", "Load messages older than this message id.", uuid), queryParam("limit", "Page size.", { type: "integer", minimum: 1, maximum: 200 })], permissions: modulePermission("conversation", "read"), responseSchema: objectSchema({ items: arrayOf(conversationMessageSchema), nextCursor: nullableUuid }) },
  { method: "post", path: "/conversations/{conversationId}/messages", summary: "Send a message: text with explicit @mentions (member ids) and / or a shared record (title and link resolved server-side). Mentioned people get a `mention` notification, everyone else a `message` one; members' open threads refresh in real time.", operationId: "sendConversationMessage", parameters: [conversationIdParam], permissions: modulePermission("conversation", "update"), requestBody: jsonBody(objectSchema({ body: { type: "string", nullable: true }, mentionUserIds: arrayOf(uuid), linkedRecord: { nullable: true, allOf: [linkedRecordBody] } }), "Message."), responseSchema: conversationMessageSchema, status: 201 },
  { method: "patch", path: "/conversations/{conversationId}/messages/{messageId}", summary: "Edit your own message.", operationId: "editConversationMessage", parameters: [conversationIdParam, conversationMessageIdParam], permissions: modulePermission("conversation", "update"), requestBody: jsonBody(objectSchema({ body: { type: "string" } }, ["body"]), "New text."), responseSchema: conversationMessageSchema },
  { method: "delete", path: "/conversations/{conversationId}/messages/{messageId}", summary: "Remove a message (your own, or any as an admin / project manager).", operationId: "deleteConversationMessage", parameters: [conversationIdParam, conversationMessageIdParam], permissions: modulePermission("conversation", "update"), responseSchema: objectSchema({ deleted: { type: "boolean" }, messageId: uuid }) },
].forEach((route) => addGenericRoute({ tag: "Conversations", ...route }));

const inboundEmailStatus = { type: "string", enum: ["received", "posted", "logged", "linked", "ignored", "unmatched", "rejected"] };
const inboundEmailSchema = objectSchema({ id: uuid, projectId: nullableUuid, provider: { type: "string" }, messageId: { type: "string", nullable: true }, from: objectSchema({ email: { type: "string" }, name: { type: "string", nullable: true } }), to: arrayOf(ref("GenericObject")), cc: arrayOf(ref("GenericObject")), subject: { type: "string" }, preview: { type: "string" }, textBody: { type: "string" }, htmlBody: { type: "string", nullable: true }, replyText: { type: "string", nullable: true, description: "The new text without the quoted thread." }, attachments: arrayOf(objectSchema({ name: { type: "string" }, contentType: { type: "string" }, size: { type: "integer", nullable: true }, stored: { type: "boolean" }, attachmentId: nullableUuid, documentId: nullableUuid })), attachmentCount: { type: "integer" }, receivedAt: nullableDateString, status: inboundEmailStatus, target: { type: "string", enum: ["project", "record", "conversation"], nullable: true }, recordType: { type: "string", nullable: true }, recordId: { type: "string", nullable: true }, recordPath: { type: "string", nullable: true }, conversationId: nullableUuid, conversationPath: { type: "string", nullable: true }, commentId: nullableUuid, correspondenceId: nullableUuid, correspondencePath: { type: "string", nullable: true }, senderUserId: nullableUuid, error: { type: "string", nullable: true }, processedAt: nullableDateString, createdAt: nullableDateString });
const inboundEmailSettingsSchema = objectSchema({ configured: { type: "boolean" }, domain: { type: "string", nullable: true }, address: { type: "string", nullable: true, description: "p-<token>@<domain> — give it to people who should write to the project." }, autoLog: { type: "boolean" }, repliesToRecords: { type: "boolean" }, providers: arrayOf({ type: "string" }), webhookPath: { type: "string" } });
const inboundEmailIdParam = pathParam("emailId", "Inbound email UUID.");
[
  { method: "get", path: "/projects/{projectId}/emails", summary: "The project inbox: every email received on the project address or on a reply-to-record / reply-to-conversation address, with status counts and how many need attention.", operationId: "listProjectEmails", parameters: [...projectParams, queryParam("status", "Only this status.", inboundEmailStatus), queryParam("target", "project | record | conversation.", { type: "string", enum: ["project", "record", "conversation"] }), queryParam("q", "Subject, sender or body text.", { type: "string" })], permissions: modulePermission("email", "read"), responseSchema: objectSchema({ items: arrayOf(inboundEmailSchema), summary: objectSchema({ count: { type: "integer" }, byStatus: ref("GenericObject"), needsAttention: { type: "integer" } }) }) },
  { method: "get", path: "/projects/{projectId}/emails/settings", summary: "The project's inbound address, whether inbound mail is configured (INBOUND_EMAIL_DOMAIN + INBOUND_EMAIL_SECRET), and the auto-log switch.", operationId: "getProjectEmailSettings", parameters: projectParams, permissions: modulePermission("email", "read"), responseSchema: inboundEmailSettingsSchema },
  { method: "patch", path: "/projects/{projectId}/emails/settings", summary: "Turn automatic logging on / off: mail to the project address becomes incoming correspondence immediately.", operationId: "updateProjectEmailSettings", parameters: projectParams, permissions: modulePermission("email", "update", "email.settings"), requestBody: jsonBody(objectSchema({ autoLog: { type: "boolean" } }), "Settings.", false), responseSchema: inboundEmailSettingsSchema },
  { method: "post", path: "/projects/{projectId}/emails/settings/rotate", summary: "Issue a new project address (the old one stops working).", operationId: "rotateProjectEmailAddress", parameters: projectParams, permissions: modulePermission("email", "update", "email.settings"), responseSchema: inboundEmailSettingsSchema },
  { method: "get", path: "/projects/{projectId}/emails/{emailId}", summary: "One email with its full text and attachments.", operationId: "getProjectEmail", parameters: [...projectParams, inboundEmailIdParam], permissions: modulePermission("email", "read"), responseSchema: inboundEmailSchema },
  { method: "post", path: "/projects/{projectId}/emails/{emailId}/log", summary: "Log the email as incoming correspondence (type, contractual-notice flag, response date); attachments follow it. 409 INBOUND_EMAIL_ALREADY_LOGGED.", operationId: "logProjectEmail", parameters: [...projectParams, inboundEmailIdParam], permissions: modulePermission("email", "update"), requestBody: jsonBody(objectSchema({ type: { type: "string", enum: ["email", "letter", "memo", "notice"] }, contractualNotice: { type: "boolean" }, responseRequiredBy: nullableDateString }), "Options.", false), responseSchema: inboundEmailSchema },
  { method: "post", path: "/projects/{projectId}/emails/{emailId}/post", summary: "Post the email on a record as a comment by the caller (sender, subject and text; attachments follow it).", operationId: "postProjectEmailToRecord", parameters: [...projectParams, inboundEmailIdParam], permissions: modulePermission("email", "update"), requestBody: jsonBody(objectSchema({ recordType: { type: "string" }, recordId: { type: "string" } }, ["recordType", "recordId"]), "Record."), responseSchema: inboundEmailSchema },
  { method: "post", path: "/projects/{projectId}/emails/{emailId}/conversation", summary: "Start a group conversation from the email (the sender is included when they are a user).", operationId: "startConversationFromEmail", parameters: [...projectParams, inboundEmailIdParam], permissions: modulePermission("email", "update"), requestBody: jsonBody(objectSchema({ memberUserIds: arrayOf(uuid), title: { type: "string", nullable: true } }), "People.", false), responseSchema: objectSchema({ email: inboundEmailSchema, conversation: conversationSchema }), status: 201 },
  { method: "post", path: "/projects/{projectId}/emails/{emailId}/ignore", summary: "Mark the email as not needing action.", operationId: "ignoreProjectEmail", parameters: [...projectParams, inboundEmailIdParam], permissions: modulePermission("email", "update"), responseSchema: inboundEmailSchema },
  { method: "delete", path: "/projects/{projectId}/emails/{emailId}", summary: "Delete an inbox email (its stored attachments stay as project documents).", operationId: "deleteProjectEmail", parameters: [...projectParams, inboundEmailIdParam], permissions: modulePermission("email", "delete"), responseSchema: objectSchema({ deleted: { type: "boolean" } }) },
].forEach((route) => addGenericRoute({ tag: "Project Emails", ...route }));
add("/public/inbound-email/{provider}", "post", operation({ tag: "Project Emails", summary: "Delivery webhook for the mail provider (`postmark`, `mailgun`, `sendgrid`, `generic`). Authenticated by the shared INBOUND_EMAIL_WEBHOOK_TOKEN (`?token=`, `X-Inbound-Token` or basic-auth password) or, for Mailgun, the HMAC signature. The recipient address decides where the message goes: `r-<type>-<id>-<sig>@` → a comment on the record by the sender; `c-<conversation>-<sig>@` → a message in the conversation; `p-<token>@` → the project inbox (logged as correspondence automatically when the project says so). Deduplicated by Message-ID; mail from unknown senders is kept as `unmatched`. Answers 200 even when the message is not for us (`accepted: false`).", operationId: "inboundEmailWebhook", parameters: [pathParam("provider", "postmark | mailgun | sendgrid | generic", null), queryParam("token", "Shared webhook token (alternative to the header).", { type: "string" })], requestBody: jsonBody(freeObject("The provider's payload (JSON or multipart form)."), "Delivered message."), responseSchema: objectSchema({ accepted: { type: "boolean" }, duplicate: { type: "boolean" }, reason: { type: "string", nullable: true }, id: nullableUuid, status: { type: "string", nullable: true }, target: { type: "string", nullable: true } }), permissions: { auth: "none", note: "Shared webhook token or Mailgun signature." }, security: false }));

// ─── Subcontractor payment applications (OCTA-FIN-SUBPAY-021) ─────────────
const payAppIdParam = pathParam("payAppId", "Payment application UUID.");
const payAppStatuses = ["draft", "submitted", "under_review", "approved", "paid", "rejected", "void"];
const payAppRejectionCodes = ["OVER_APPROVED_PROGRESS", "MISSING_COMPLIANCE", "INCORRECT_QUANTITIES", "DUPLICATE_PERIOD", "BACK_CHARGE_DISPUTE", "OTHER"];
const payAppLineSchema = objectSchema({
  id: uuid,
  sovLineId: uuid,
  lineNumber: { type: "integer", nullable: true },
  description: { type: "string" },
  costCode: { type: "string", nullable: true },
  activityId: nullableUuid,
  activity: nullableRef("GenericObject"),
  scheduledAmount: { type: "number", description: "The line as originally contracted." },
  approvedChangeAmount: {
    type: "number",
    description: "What approved change orders naming this line have added to it.",
  },
  revisedScheduledAmount: {
    type: "number",
    description:
      "scheduled + approved changes: the ceiling this claim may not exceed. Snapshotted when the claim was made.",
  },
  previousAmount: { type: "number" },
  thisPeriodAmount: { type: "number" },
  cumulativeAmount: { type: "number" },
  cumulativePct: { type: "number" },
  materialsOnSite: { type: "number" },
  approvedPct: { type: "number", nullable: true, description: "Latest approved progress of the line's activity." },
  capAmount: { type: "number", nullable: true, description: "approvedPct × scheduled; null when the line has no activity progress." },
  overClaimAmount: { type: "number" },
  balanceToFinish: { type: "number" },
  notes: { type: "string", nullable: true },
});
const payAppSchema = objectSchema({
  id: uuid,
  projectId: uuid,
  commitmentId: uuid,
  commitment: nullableRef("GenericObject"),
  number: { type: "integer" },
  ref: { type: "string", example: "SC-001-PA01" },
  periodLabel: { type: "string" },
  periodStart: nullableDateString,
  periodEnd: nullableDateString,
  status: { type: "string", enum: payAppStatuses },
  workThisPeriod: { type: "number" },
  workCumulative: { type: "number" },
  materialsOnSite: { type: "number" },
  grossThisPeriod: { type: "number" },
  retentionRate: { type: "number" },
  retentionThisPeriod: { type: "number" },
  retentionCumulative: { type: "number" },
  backCharges: { type: "number" },
  backChargesNote: { type: "string", nullable: true },
  otherDeductions: { type: "number" },
  otherDeductionsNote: { type: "string", nullable: true },
  taxRate: { type: "number" },
  taxAmount: {
    type: "number",
    description:
      "Tax on what is left after retention, back-charges and deductions — never on the gross.",
  },
  netThisPeriod: { type: "number" },
  paidAmount: { type: "number" },
  outstanding: { type: "number" },
  overClaimAmount: { type: "number" },
  waiverRequired: { type: "boolean" },
  waiverDocumentId: nullableUuid,
  waiverDocument: nullableRef("GenericObject"),
  complianceOverrideReason: { type: "string", nullable: true },
  overClaimOverrideReason: { type: "string", nullable: true },
  reviewNote: { type: "string", nullable: true },
  rejectionCode: { type: "string", nullable: true, enum: [...payAppRejectionCodes, null] },
  rejectedReason: { type: "string", nullable: true },
  notes: { type: "string", nullable: true },
  submittedAt: nullableDateString,
  reviewedAt: nullableDateString,
  approvedAt: nullableDateString,
  rejectedAt: nullableDateString,
  paidAt: nullableDateString,
  lines: arrayOf(payAppLineSchema),
  payments: arrayOf(objectSchema({ id: uuid, amount: { type: "number" }, paidAt: nullableDateString, method: { type: "string", nullable: true }, reference: { type: "string", nullable: true }, note: { type: "string", nullable: true } })),
  path: { type: "string" },
});
const payAppLineInput = objectSchema({
  sovLineId: uuid,
  thisPeriodAmount: { type: "number", nullable: true },
  thisPeriodPct: { type: "number", nullable: true, description: "Cumulative % to date; converted to this period." },
  materialsOnSite: { type: "number", nullable: true },
  notes: { type: "string", nullable: true },
});
const payAppUpdateRequest = objectSchema({
  periodLabel: { type: "string" },
  periodStart: nullableDateString,
  periodEnd: nullableDateString,
  retentionRate: { type: "number", nullable: true },
  backCharges: { type: "number", nullable: true },
  backChargesNote: { type: "string", nullable: true },
  otherDeductions: { type: "number", nullable: true },
  otherDeductionsNote: {
    type: "string",
    nullable: true,
    description: "Required when a deduction is set: withholding money must say why.",
  },
  taxRate: { type: "number", nullable: true },
  waiverRequired: { type: "boolean" },
  waiverDocumentId: nullableUuid,
  notes: { type: "string", nullable: true },
  lines: arrayOf(payAppLineInput),
});
const payAppPermission = (action, transition = null) => modulePermission("sub_pay_app", action, transition);
[
  { method: "get", path: "/projects/{projectId}/pay-apps", summary: "Payment applications with totals; subcontractor party users see only those on their commitments.", operationId: "listSubPayApps", parameters: [...projectParams, queryParam("commitmentId", "Filter by commitment.", uuid), queryParam("status", "Filter by status.", { type: "string", enum: payAppStatuses }), queryParam("includeVoid", "Include void applications.", { type: "boolean" })], permissions: payAppPermission("read"), responseSchema: objectSchema({ items: arrayOf(payAppSchema), summary: ref("GenericObject") }) },
  { method: "post", path: "/projects/{projectId}/pay-apps", summary: "Start a draft application against an executed commitment: lines are seeded from its schedule of values with previous claims and approved-progress caps. One open application per commitment.", operationId: "createSubPayApp", parameters: projectParams, permissions: payAppPermission("create"), requestBody: jsonBody(objectSchema({ commitmentId: uuid, periodLabel: { type: "string" }, periodStart: nullableDateString, periodEnd: nullableDateString, retentionRate: { type: "number", nullable: true }, waiverRequired: { type: "boolean" }, notes: { type: "string", nullable: true } }, ["commitmentId", "periodLabel"]), "Application."), responseSchema: payAppSchema, status: 201 },
  { method: "get", path: "/projects/{projectId}/pay-apps/{payAppId}", summary: "One application with lines and payments.", operationId: "getSubPayApp", parameters: [...projectParams, payAppIdParam], permissions: payAppPermission("read"), responseSchema: payAppSchema },
  { method: "patch", path: "/projects/{projectId}/pay-apps/{payAppId}", summary: "Edit claims (this period amount or cumulative %), materials on site, retention, back-charges and compliance fields while draft / submitted / under review. Cumulative cannot exceed the scheduled amount (400 SUB_PAY_APP_EXCEEDS_SCHEDULED).", operationId: "updateSubPayApp", parameters: [...projectParams, payAppIdParam], permissions: payAppPermission("update"), requestBody: jsonBody(payAppUpdateRequest, "Fields to change.", false), responseSchema: payAppSchema },
  { method: "delete", path: "/projects/{projectId}/pay-apps/{payAppId}", summary: "Void a draft or rejected application.", operationId: "voidSubPayApp", parameters: [...projectParams, payAppIdParam, queryParam("reason", "Reason.", { type: "string" })], permissions: payAppPermission("delete", "sub_pay_app.void"), responseSchema: payAppSchema },
  { method: "post", path: "/projects/{projectId}/pay-apps/{payAppId}/submit", summary: "Submit: claims are re-checked against approved progress; an over-claim is rejected with 400 SUB_PAY_APP_OVER_CLAIM and reason code OVER_APPROVED_PROGRESS listing the lines.", operationId: "submitSubPayApp", parameters: [...projectParams, payAppIdParam], permissions: payAppPermission("submit", "sub_pay_app.submit"), responseSchema: payAppSchema },
  { method: "post", path: "/projects/{projectId}/pay-apps/{payAppId}/review", summary: "QS review: marks the application under review with a note.", operationId: "reviewSubPayApp", parameters: [...projectParams, payAppIdParam], permissions: payAppPermission("submit", "sub_pay_app.review"), requestBody: jsonBody(objectSchema({ note: { type: "string", nullable: true } }), "Review note.", false), responseSchema: payAppSchema },
  { method: "post", path: "/projects/{projectId}/pay-apps/{payAppId}/approve", summary: "PM approval with the compliance gate (commitment insurance valid, lien waiver on file when required → 409 SUB_PAY_APP_COMPLIANCE) and the over-claim check; both can be overridden with a reason.", operationId: "approveSubPayApp", parameters: [...projectParams, payAppIdParam], permissions: payAppPermission("approve", "sub_pay_app.approve"), requestBody: jsonBody(objectSchema({ complianceOverrideReason: { type: "string", nullable: true }, overClaimOverrideReason: { type: "string", nullable: true } }), "Overrides.", false), responseSchema: payAppSchema },
  { method: "post", path: "/projects/{projectId}/pay-apps/{payAppId}/reject", summary: "Reject with a reason code and reason.", operationId: "rejectSubPayApp", parameters: [...projectParams, payAppIdParam], permissions: payAppPermission("submit", "sub_pay_app.reject"), requestBody: jsonBody(objectSchema({ code: { type: "string", enum: payAppRejectionCodes }, reason: { type: "string" } }, ["reason"]), "Rejection."), responseSchema: payAppSchema },
  { method: "post", path: "/projects/{projectId}/pay-apps/{payAppId}/reopen", summary: "Return a rejected application to draft.", operationId: "reopenSubPayApp", parameters: [...projectParams, payAppIdParam], permissions: payAppPermission("update"), responseSchema: payAppSchema },
  { method: "post", path: "/projects/{projectId}/pay-apps/{payAppId}/payments", summary: "Record a payment (finance). Σ payments cannot exceed the net approved (400 SUB_PAY_APP_PAYMENT_EXCEEDS); paid in full moves the application to paid and the project cash flow is rebuilt.", operationId: "recordSubPayAppPayment", parameters: [...projectParams, payAppIdParam], permissions: payAppPermission("certify", "sub_pay_app.pay"), requestBody: jsonBody(objectSchema({ amount: { type: "number" }, paidAt: nullableDateString, method: { type: "string", nullable: true }, reference: { type: "string", nullable: true }, note: { type: "string", nullable: true } }, ["amount"]), "Payment."), responseSchema: payAppSchema, status: 201 },
  { method: "get", path: "/projects/{projectId}/pay-apps/{payAppId}/export.pdf", summary: "Application statement PDF.", operationId: "exportSubPayAppPdf", parameters: [...projectParams, payAppIdParam], permissions: payAppPermission("export"), responseSchema: { type: "string", format: "binary" } },
].forEach((route) => addGenericRoute({ tag: "Commercial", ...route }));

// ─── Punch list ─────────────────────────────────────────────────────────
const punchItemIdParam = pathParam("itemId", "Punch item UUID.");
const punchFilterParams = [
  queryParam("kind", "punch (default), observation, or all.", { type: "string", enum: ["punch", "observation", "all"] }),
  queryParam("observationType", "Observation type.", { type: "string", enum: ["safety", "quality", "commissioning", "work_to_complete", "environmental"] }),
  queryParam("status", "Status, comma list, or `all` (void items hidden by default).", { type: "string" }),
  queryParam("assigneeCompanyId", "Assigned company.", uuid),
  queryParam("assigneeUserId", "Assigned user.", uuid),
  queryParam("managerUserId", "Manager.", uuid),
  queryParam("finalApproverUserId", "Final approver.", uuid),
  queryParam("ballInCourtUserId", "Ball in court user id, or `me`.", { type: "string" }),
  queryParam("locationId", "Location id; includes descendants.", uuid),
  queryParam("sheetId", "Sheet the item was raised on.", uuid),
  queryParam("trade", "Trade.", { type: "string" }),
  queryParam("priority", "Priority.", { type: "string", enum: ["low", "normal", "high", "urgent"] }),
  queryParam("overdue", "Only overdue open items.", { type: "boolean" }),
  queryParam("search", "Ref, title, description or location contains.", { type: "string" }),
  queryParam("limit", "Maximum rows (default 1000).", { type: "integer", minimum: 1, maximum: 1000 }),
];
const punchScopedNote = "Users who join through a project party (subcontractors) only see items assigned to their company or raised by them.";

add(
  "/projects/{projectId}/punch",
  "get",
  operation({
    tag: "Punch List",
    summary: "Punch items with filters and a summary by status, company and trade.",
    operationId: "listPunchItems",
    parameters: [...projectParams, ...punchFilterParams],
    permissions: { ...modulePermission("punch", "read"), note: punchScopedNote },
    responseSchema: ref("PunchListResponse"),
  }),
);

add(
  "/projects/{projectId}/punch",
  "post",
  operation({
    tag: "Punch List",
    summary: "Create a punch item (draft, or open immediately with `status: open`). Assignees, the company's project members and the manager are notified when it opens.",
    operationId: "createPunchItem",
    parameters: projectParams,
    permissions: modulePermission("punch", "create"),
    requestBody: jsonBody(ref("PunchItemInput"), "Punch item."),
    responseSchema: ref("PunchItem"),
    status: 201,
  }),
);

[
  {
    method: "post",
    path: "/projects/{projectId}/punch/bulk",
    summary: "Create up to 100 punch items in one go with shared defaults (assignee, location, due date…).",
    operationId: "bulkCreatePunchItems",
    permissions: modulePermission("punch", "create"),
    requestBody: jsonBody(ref("PunchBulkRequest"), "Items and defaults."),
    responseSchema: objectSchema({ items: arrayOf(ref("PunchItem")), created: { type: "integer" } }),
    status: 201,
  },
  {
    method: "post",
    path: "/projects/{projectId}/punch/distribute",
    summary: "Email the punch list to companies / users (their active project members) and record the distribution on each item.",
    operationId: "distributePunchItems",
    permissions: modulePermission("punch", "submit", "punch.distribute"),
    requestBody: jsonBody(ref("PunchDistributeRequest"), "Who receives which items."),
    responseSchema: ref("PunchDistributeResponse"),
  },
].forEach((route) => addGenericRoute({ tag: "Punch List", parameters: projectParams, ...route }));

add(
  "/projects/{projectId}/punch/export.pdf",
  "get",
  operation({
    tag: "Punch List",
    summary: "Punch list PDF grouped by company (one section per subcontractor) or by location, optionally with JPEG photos.",
    operationId: "exportPunchListPdf",
    parameters: [
      ...projectParams,
      ...punchFilterParams,
      queryParam("groupBy", "Grouping.", { type: "string", enum: ["company", "location", "none"] }),
      queryParam("includePhotos", "Embed up to two JPEG photos per item (max 40).", { type: "boolean" }),
    ],
    permissions: modulePermission("punch", "export"),
    responses: { 200: binaryResponse("PDF file.", "application/pdf") },
  }),
);

add(
  "/projects/{projectId}/punch/export.csv",
  "get",
  operation({
    tag: "Punch List",
    summary: "Punch list as CSV with the same filters as the list.",
    operationId: "exportPunchListCsv",
    parameters: [...projectParams, ...punchFilterParams],
    permissions: modulePermission("punch", "export"),
    responses: { 200: binaryResponse("CSV file.", "text/csv") },
  }),
);

[
  {
    method: "get",
    path: "/projects/{projectId}/punch/{itemId}",
    summary: "One punch item with its event ledger.",
    operationId: "getPunchItem",
    parameters: [projectIdParam, punchItemIdParam],
    permissions: { ...modulePermission("punch", "read"), note: punchScopedNote },
    responseSchema: ref("PunchItem"),
  },
  {
    method: "patch",
    path: "/projects/{projectId}/punch/{itemId}",
    summary: "Edit an item that is not closed or void; assignment changes re-notify.",
    operationId: "updatePunchItem",
    parameters: [projectIdParam, punchItemIdParam],
    permissions: modulePermission("punch", "update"),
    requestBody: jsonBody(ref("PunchItemInput"), "Fields to change."),
    responseSchema: ref("PunchItem"),
  },
  {
    method: "delete",
    path: "/projects/{projectId}/punch/{itemId}",
    summary: "Delete a draft item (use void for anything that was opened).",
    operationId: "deletePunchItem",
    parameters: [projectIdParam, punchItemIdParam],
    permissions: modulePermission("punch", "delete"),
    responseSchema: objectSchema({ deleted: { type: "boolean" }, id: uuid }),
  },
  {
    method: "post",
    path: "/projects/{projectId}/punch/{itemId}/transition",
    summary:
      "Move an item through draft → open → ready_for_review → closed (in_dispute from open / ready; void from anything not closed). Each action maps to a `punch.*` transition; only the final approver (when set) may close; reopen, dispute and void need a reason.",
    operationId: "transitionPunchItem",
    parameters: [projectIdParam, punchItemIdParam],
    permissions: {
      auth: "bearer",
      roles: ROLE_IDS,
      note: "open/ready_for_review/reopen/dispute/resolve_dispute → punch.* submit transitions; close → punch.close (approve); void → punch.void (approve).",
    },
    requestBody: jsonBody(ref("PunchTransitionRequest"), "Action and reason."),
    responseSchema: ref("PunchItem"),
  },
].forEach((route) => addGenericRoute({ tag: "Punch List", ...route }));

add(
  "/projects/{projectId}/drawings/sheets/{sheetId}/qr.svg",
  "get",
  operation({
    tag: "Drawings",
    summary: "Printable QR code for a sheet; scanning it opens the punch list with the sheet pre-selected for quick-create.",
    operationId: "getSheetQr",
    parameters: [projectIdParam, sheetIdParam],
    permissions: modulePermission("document_control", "read"),
    responses: { 200: binaryResponse("SVG image.", "image/svg+xml") },
  }),
);

// ─── Sheet markups and pins ─────────────────────────────────────────────
const markupIdParam = pathParam("markupId", "Markup UUID.");
const pinIdParam = pathParam("pinId", "Pin UUID.");
const markupReadPermission = {
  auth: "bearer",
  roles: ROLE_IDS,
  note: "document_control.read. A personal layer belongs to its author; only the author (or document_control.update for published layers) can change it.",
};

[
  {
    method: "get",
    path: "/projects/{projectId}/drawings/sheets/{sheetId}/markups",
    summary: "Published markup layers on a sheet plus the caller's own personal layer.",
    operationId: "listSheetMarkups",
    parameters: [projectIdParam, sheetIdParam],
    permissions: markupReadPermission,
    responseSchema: ref("MarkupListResponse"),
  },
  {
    method: "get",
    path: "/projects/{projectId}/drawings/sheets/{sheetId}/markups/mine",
    summary: "The caller's personal layer on the sheet (created empty on first use).",
    operationId: "getMySheetMarkup",
    parameters: [projectIdParam, sheetIdParam],
    permissions: markupReadPermission,
    responseSchema: ref("Markup"),
  },
  {
    method: "put",
    path: "/projects/{projectId}/drawings/sheets/{sheetId}/markups/mine",
    summary: "Replace the shapes of the caller's personal layer (auto-save target).",
    operationId: "saveMySheetMarkup",
    parameters: [projectIdParam, sheetIdParam],
    permissions: markupReadPermission,
    requestBody: jsonBody(ref("MarkupSaveRequest"), "Shapes and optional name."),
    responseSchema: ref("Markup"),
  },
  {
    method: "patch",
    path: "/projects/{projectId}/drawings/sheets/{sheetId}/markups/{markupId}",
    summary: "Edit a layer (author, or document_control.update for published layers).",
    operationId: "updateSheetMarkup",
    parameters: [projectIdParam, sheetIdParam, markupIdParam],
    permissions: markupReadPermission,
    requestBody: jsonBody(ref("MarkupSaveRequest"), "Shapes and/or name."),
    responseSchema: ref("Markup"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/drawings/sheets/{sheetId}/markups/{markupId}/publish",
    summary: "Make a personal layer visible to everyone on the project (audited on the sheet).",
    operationId: "publishSheetMarkup",
    parameters: [projectIdParam, sheetIdParam, markupIdParam],
    permissions: modulePermission("document_control", "create"),
    requestBody: jsonBody(objectSchema({ name: { type: "string", nullable: true, maxLength: 120 } }), "Optional layer name.", false),
    responseSchema: ref("Markup"),
  },
  {
    method: "delete",
    path: "/projects/{projectId}/drawings/sheets/{sheetId}/markups/{markupId}",
    summary: "Delete a layer (author, or document_control.update for published layers).",
    operationId: "deleteSheetMarkup",
    parameters: [projectIdParam, sheetIdParam, markupIdParam],
    permissions: markupReadPermission,
    responseSchema: objectSchema({ deleted: { type: "boolean" }, id: uuid }),
  },
  {
    method: "get",
    path: "/projects/{projectId}/drawings/sheets/{sheetId}/pins",
    summary: "Pins on a sheet with the state of the record behind each one.",
    operationId: "listSheetPins",
    parameters: [projectIdParam, sheetIdParam],
    permissions: modulePermission("document_control", "read"),
    responseSchema: ref("PinListResponse"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/drawings/sheets/{sheetId}/pins",
    summary:
      "Drop a pin: link an existing record (`recordId`) or create it on the spot (`create`, RFI or defect). Needs `create` on the target module when creating, `read` when linking. The record gets a note naming the sheet.",
    operationId: "createSheetPin",
    parameters: [projectIdParam, sheetIdParam],
    permissions: {
      auth: "bearer",
      roles: ROLE_IDS,
      note: "document_control.read plus `create` (when creating) or `read` (when linking) on the record's module.",
    },
    requestBody: jsonBody(ref("PinCreateRequest"), "Pin position and target."),
    responseSchema: ref("PinCreateResponse"),
    status: 201,
  },
  {
    method: "get",
    path: "/projects/{projectId}/drawings/pins",
    summary: "Pins that reference one record (which sheets it is on).",
    operationId: "listRecordPins",
    parameters: [
      projectIdParam,
      queryParam("recordType", "Record type.", { type: "string" }),
      queryParam("recordId", "Record id.", { type: "string" }),
    ],
    permissions: modulePermission("document_control", "read"),
    responseSchema: ref("PinListResponse"),
  },
  {
    method: "delete",
    path: "/projects/{projectId}/drawings/pins/{pinId}",
    summary: "Remove a pin (the person who dropped it, or document_control.update).",
    operationId: "deleteSheetPin",
    parameters: [projectIdParam, pinIdParam],
    permissions: modulePermission("document_control", "read"),
    responseSchema: objectSchema({ deleted: { type: "boolean" }, id: uuid }),
  },
].forEach((route) => addGenericRoute({ tag: "Drawings", ...route }));

// ─── Company workspace ──────────────────────────────────────────────────
const companyIdParam = pathParam("id", "Record UUID scoped to the organisation.");
const searchParam = queryParam("search", "Name contains.", { type: "string" });
const includeArchivedQuery = queryParam("includeArchived", "Include archived rows.", { type: "boolean" });

[
  {
    method: "get",
    path: "/company/directory",
    summary: "Company directory: every company the organisation works with, with member, project and supplier counts.",
    operationId: "listCompanyDirectory",
    parameters: [
      searchParam,
      queryParam("status", "Filter by status.", { type: "string", enum: ["active", "inactive"] }),
      queryParam("vendorsOnly", "Only vendors.", { type: "boolean" }),
    ],
    permissions: authenticatedOnly,
    responseSchema: ref("CompanyDirectoryResponse"),
  },
  {
    method: "get",
    path: "/company/vendors",
    summary: "Vendors (companies flagged isVendor) for supplier pickers on every project.",
    operationId: "listVendors",
    parameters: [
      searchParam,
      queryParam("trade", "Trade filter.", { type: "string" }),
      queryParam("includeInactive", "Include inactive vendors.", { type: "boolean" }),
    ],
    permissions: authenticatedOnly,
    responseSchema: ref("VendorListResponse"),
  },
  {
    method: "get",
    path: "/company/vendors/migration-report",
    summary: "De-duplication report from the project-supplier → vendor migration.",
    operationId: "getVendorMigrationReport",
    parameters: [],
    permissions: companyAdminPermission,
    responseSchema: ref("VendorMigrationReport"),
  },
  {
    method: "post",
    path: "/company/vendors",
    summary: "Create a vendor (or promote an existing company to vendor).",
    operationId: "createVendor",
    parameters: [],
    permissions: companyAdminPermission,
    requestBody: jsonBody(ref("VendorMutationRequest"), "Vendor details."),
    responseSchema: ref("CompanyDirectoryEntry"),
    status: 201,
  },
  {
    method: "patch",
    path: "/company/vendors/{id}",
    summary: "Update a vendor profile.",
    operationId: "updateVendor",
    parameters: [companyIdParam],
    permissions: companyAdminPermission,
    requestBody: jsonBody(ref("VendorMutationRequest"), "Fields to change."),
    responseSchema: ref("CompanyDirectoryEntry"),
  },
  {
    method: "get",
    path: "/company/cost-codes",
    summary: "Organisation cost code master.",
    operationId: "listCostCodes",
    parameters: [
      searchParam,
      queryParam("category", "Category filter.", { type: "string" }),
      includeArchivedQuery,
    ],
    permissions: authenticatedOnly,
    responseSchema: ref("CostCodeListResponse"),
  },
  {
    method: "post",
    path: "/company/cost-codes",
    summary: "Create a cost code.",
    operationId: "createCostCode",
    parameters: [],
    permissions: companyAdminPermission,
    requestBody: jsonBody(ref("CostCodeMutationRequest"), "Cost code."),
    responseSchema: ref("CostCode"),
    status: 201,
  },
  {
    method: "post",
    path: "/company/cost-codes/import",
    summary: "Bulk upsert cost codes by code; parents resolved by parentCode.",
    operationId: "importCostCodes",
    parameters: [],
    permissions: companyAdminPermission,
    requestBody: jsonBody(ref("CostCodeImportRequest"), "Rows to import."),
    responseSchema: objectSchema({ created: { type: "integer" }, updated: { type: "integer" } }),
  },
  {
    method: "patch",
    path: "/company/cost-codes/{id}",
    summary: "Update a cost code.",
    operationId: "updateCostCode",
    parameters: [companyIdParam],
    permissions: companyAdminPermission,
    requestBody: jsonBody(ref("CostCodeMutationRequest"), "Fields to change."),
    responseSchema: ref("CostCode"),
  },
  {
    method: "get",
    path: "/company/equipment",
    summary: "Organisation equipment master (names and rates reused per project).",
    operationId: "listCompanyEquipment",
    parameters: [searchParam, includeArchivedQuery],
    permissions: authenticatedOnly,
    responseSchema: ref("CompanyEquipmentListResponse"),
  },
  {
    method: "post",
    path: "/company/equipment",
    summary: "Create an equipment master.",
    operationId: "createCompanyEquipment",
    parameters: [],
    permissions: companyAdminPermission,
    requestBody: jsonBody(ref("CompanyEquipmentMutationRequest"), "Equipment."),
    responseSchema: ref("CompanyEquipment"),
    status: 201,
  },
  {
    method: "patch",
    path: "/company/equipment/{id}",
    summary: "Update an equipment master.",
    operationId: "updateCompanyEquipment",
    parameters: [companyIdParam],
    permissions: companyAdminPermission,
    requestBody: jsonBody(ref("CompanyEquipmentMutationRequest"), "Fields to change."),
    responseSchema: ref("CompanyEquipment"),
  },
  {
    method: "get",
    path: "/company/project-templates",
    summary: "Project templates.",
    operationId: "listProjectTemplates",
    parameters: [includeArchivedQuery],
    permissions: authenticatedOnly,
    responseSchema: ref("ProjectTemplateListResponse"),
  },
  {
    method: "post",
    path: "/company/project-templates",
    summary: "Create a project template.",
    operationId: "createProjectTemplate",
    parameters: [],
    permissions: companyAdminPermission,
    requestBody: jsonBody(ref("ProjectTemplateMutationRequest"), "Template."),
    responseSchema: ref("ProjectTemplate"),
    status: 201,
  },
  {
    method: "get",
    path: "/company/project-templates/{id}",
    summary: "Read a project template.",
    operationId: "getProjectTemplate",
    parameters: [companyIdParam],
    permissions: authenticatedOnly,
    responseSchema: ref("ProjectTemplate"),
  },
  {
    method: "patch",
    path: "/company/project-templates/{id}",
    summary: "Update a project template.",
    operationId: "updateProjectTemplate",
    parameters: [companyIdParam],
    permissions: companyAdminPermission,
    requestBody: jsonBody(ref("ProjectTemplateMutationRequest"), "Fields to change."),
    responseSchema: ref("ProjectTemplate"),
  },
  {
    method: "delete",
    path: "/company/project-templates/{id}",
    summary: "Archive a project template.",
    operationId: "archiveProjectTemplate",
    parameters: [companyIdParam],
    permissions: companyAdminPermission,
    responseSchema: ref("ProjectTemplate"),
  },
  {
    method: "post",
    path: "/company/project-templates/{id}/create-project",
    summary:
      "Create a project from a template: field defaults, parties with permission templates, document folders, location tree and default team assignments.",
    operationId: "createProjectFromTemplate",
    parameters: [companyIdParam],
    permissions: companyAdminPermission,
    requestBody: jsonBody(
      freeObject("Project fields (same as POST /projects); request values override template defaults."),
      "Project fields.",
    ),
    responseSchema: ref("CreateProjectFromTemplateResponse"),
    status: 201,
  },
].forEach((route) =>
  addGenericRoute({
    tag: "Company Workspace",
    ...route,
  }),
);

// ─── Inventory and warehouse (OCTA-INV-STOCK-050) ──────────────────────────
//
// Company-level: a central store serves every project. Movements carry the
// project and the activity or cost code they are for; the item master and the
// warehouses do not have to.

const inventoryPermission = (action, transition = null) =>
  modulePermission("inventory", action, transition);

const stockMovementBody = (extra = {}) =>
  jsonBody(
    objectSchema({
      itemId: { type: "string", format: "uuid" },
      warehouseId: { type: "string", format: "uuid" },
      locationId: nullableUuid,
      quantity: { type: "number" },
      batchNo: { type: "string", nullable: true },
      serialNo: { type: "string", nullable: true },
      reference: { type: "string", nullable: true },
      notes: { type: "string", nullable: true },
      ...extra,
    }),
    "The movement.",
  );

const inventoryItemBody = objectSchema({
  sku: { type: "string", maxLength: 60 },
  name: { type: "string", maxLength: 200 },
  unit: { type: "string", maxLength: 20 },
  barcode: { type: "string", nullable: true },
  qrCode: { type: "string", nullable: true },
  description: { type: "string", nullable: true },
  category: { type: "string", nullable: true },
  manufacturer: { type: "string", nullable: true },
  model: { type: "string", nullable: true },
  specification: { type: "string", nullable: true },
  preferredSupplierId: nullableUuid,
  projectId: nullableUuid,
  unitCost: { type: "number", minimum: 0 },
  reorderLevel: { type: "number", minimum: 0 },
  minStock: { type: "number", minimum: 0 },
  maxStock: { type: "number", nullable: true, minimum: 0 },
  leadTimeDays: { type: "integer", minimum: 0 },
  isSerialised: { type: "boolean" },
  isBatched: { type: "boolean" },
  status: { type: "string", enum: ["active", "archived"] },
  notes: { type: "string", nullable: true },
});

add(
  "/inventory/items",
  "get",
  operation({
    tag: "Inventory",
    summary: "List inventory items with their stock position.",
    operationId: "listInventoryItems",
    parameters: [
      queryParam("projectId", "Limit to company items plus this project's own.", {
        type: "string",
        format: "uuid",
      }),
      queryParam("search", "Matches SKU, name, barcode or manufacturer.", { type: "string" }),
      queryParam("category", "Exact category.", { type: "string" }),
      queryParam("status", "active (default) or archived.", { type: "string" }),
      queryParam("lowStock", "Only items at or below their reorder level.", { type: "boolean" }),
    ],
    permissions: inventoryPermission("read"),
  }),
);

add(
  "/inventory/items",
  "post",
  operation({
    tag: "Inventory",
    summary: "Add an item to the inventory master.",
    operationId: "createInventoryItem",
    permissions: inventoryPermission("create", "item.manage"),
    requestBody: jsonBody(inventoryItemBody, "Item fields. SKU, name and unit are required."),
    status: 201,
  }),
);

add(
  "/inventory/items/scan/{code}",
  "get",
  operation({
    tag: "Inventory",
    summary: "Resolve a scanned barcode, QR token or SKU to an item and its locations.",
    operationId: "scanInventoryItem",
    parameters: [pathParam("code", "Whatever the scanner produced.", null)],
    permissions: inventoryPermission("read"),
  }),
);

add(
  "/inventory/items/{itemId}",
  "get",
  operation({
    tag: "Inventory",
    summary: "Get one inventory item with its stock by location.",
    operationId: "getInventoryItem",
    parameters: [pathParam("itemId", "Inventory item id.")],
    permissions: inventoryPermission("read"),
  }),
);

add(
  "/inventory/items/{itemId}",
  "patch",
  operation({
    tag: "Inventory",
    summary: "Update an inventory item.",
    operationId: "updateInventoryItem",
    parameters: [pathParam("itemId", "Inventory item id.")],
    permissions: inventoryPermission("update", "item.manage"),
    requestBody: jsonBody(inventoryItemBody, "Any subset of the item's fields.", false),
  }),
);

add(
  "/inventory/warehouses",
  "get",
  operation({
    tag: "Inventory",
    summary: "List warehouses.",
    operationId: "listWarehouses",
    parameters: [
      queryParam("projectId", "Central warehouses plus this project's own.", {
        type: "string",
        format: "uuid",
      }),
    ],
    permissions: inventoryPermission("read"),
  }),
);

add(
  "/inventory/warehouses",
  "post",
  operation({
    tag: "Inventory",
    summary: "Create a warehouse.",
    operationId: "createWarehouse",
    permissions: inventoryPermission("create", "warehouse.manage"),
    requestBody: jsonBody(
      objectSchema({
        code: { type: "string", maxLength: 30 },
        name: { type: "string", maxLength: 200 },
        kind: {
          type: "string",
          enum: ["central", "project", "site", "temporary", "equipment_yard"],
        },
        projectId: nullableUuid,
        managerId: nullableUuid,
        address: { type: "string", nullable: true },
        notes: { type: "string", nullable: true },
      }),
      "Warehouse fields.",
    ),
    status: 201,
  }),
);

add(
  "/inventory/warehouses/{warehouseId}",
  "patch",
  operation({
    tag: "Inventory",
    summary: "Update or archive a warehouse.",
    operationId: "updateWarehouse",
    parameters: [pathParam("warehouseId", "Warehouse id.")],
    permissions: inventoryPermission("update", "warehouse.manage"),
    requestBody: jsonBody(
      objectSchema({
        name: { type: "string" },
        kind: { type: "string" },
        managerId: nullableUuid,
        address: { type: "string", nullable: true },
        notes: { type: "string", nullable: true },
        status: { type: "string", enum: ["active", "archived"] },
      }),
      "Any subset of the warehouse's fields.",
      false,
    ),
  }),
);

add(
  "/inventory/warehouses/{warehouseId}/locations",
  "get",
  operation({
    tag: "Inventory",
    summary: "List the zone / aisle / rack / shelf / bin tree of a warehouse.",
    operationId: "listWarehouseLocations",
    parameters: [pathParam("warehouseId", "Warehouse id.")],
    permissions: inventoryPermission("read"),
  }),
);

add(
  "/inventory/warehouses/{warehouseId}/locations",
  "post",
  operation({
    tag: "Inventory",
    summary: "Add a place inside a warehouse.",
    operationId: "createWarehouseLocation",
    parameters: [pathParam("warehouseId", "Warehouse id.")],
    permissions: inventoryPermission("create", "warehouse.manage"),
    requestBody: jsonBody(
      objectSchema({
        code: { type: "string", maxLength: 40 },
        name: { type: "string", maxLength: 200 },
        kind: { type: "string", enum: ["zone", "aisle", "rack", "shelf", "bin"] },
        parentId: nullableUuid,
        sortOrder: { type: "integer" },
      }),
      "Location fields. Omit parentId for a top-level zone.",
    ),
    status: 201,
  }),
);

add(
  "/inventory/stock/receive",
  "post",
  operation({
    tag: "Inventory",
    summary: "Receive stock into a warehouse, moving the weighted average cost.",
    operationId: "receiveStock",
    permissions: inventoryPermission("create", "stock.receive"),
    requestBody: stockMovementBody({
      unitCost: { type: "number", nullable: true, minimum: 0 },
      damagedQty: { type: "number", nullable: true, minimum: 0 },
      poLineId: nullableUuid,
      receiptLineId: nullableUuid,
      expiryDate: { type: "string", format: "date-time", nullable: true },
    }),
    status: 201,
  }),
);

add(
  "/inventory/stock/issue",
  "post",
  operation({
    tag: "Inventory",
    summary: "Issue stock to site against an activity or cost code.",
    operationId: "issueStock",
    permissions: inventoryPermission("submit", "stock.issue"),
    requestBody: stockMovementBody({
      projectId: nullableUuid,
      activityId: nullableUuid,
      costCodeId: nullableUuid,
      boqItemId: nullableUuid,
      locationRefId: nullableUuid,
      commitmentId: nullableUuid,
    }),
    status: 201,
  }),
);

[
  ["return", "Return unused stock from site.", "returnStock", "stock.return"],
  ["adjust", "Adjust stock up or down, with a reason.", "adjustStock", "stock.adjust"],
  ["damage", "Write stock off as damaged.", "damageStock", "stock.adjust"],
  ["quarantine", "Hold stock pending inspection.", "quarantineStock", "stock.adjust"],
  ["release", "Release quarantined stock back to available.", "releaseStock", "stock.adjust"],
].forEach(([path, summary, operationId, transition]) =>
  add(
    `/inventory/stock/${path}`,
    "post",
    operation({
      tag: "Inventory",
      summary,
      operationId,
      permissions: inventoryPermission("update", transition),
      requestBody: stockMovementBody({
        projectId: nullableUuid,
        activityId: nullableUuid,
      }),
      status: 201,
    }),
  ),
);

add(
  "/inventory/stock/transactions",
  "get",
  operation({
    tag: "Inventory",
    summary: "Read the stock ledger.",
    operationId: "listStockTransactions",
    parameters: [
      queryParam("itemId", "One item's movements.", { type: "string", format: "uuid" }),
      queryParam("warehouseId", "One warehouse's movements.", { type: "string", format: "uuid" }),
      queryParam("projectId", "Movements charged to one project.", { type: "string", format: "uuid" }),
      queryParam("activityId", "Movements charged to one activity.", { type: "string", format: "uuid" }),
      queryParam("type", "receipt, issue, return, transfer_out, transfer_in, adjust, damage, quarantine, release.", { type: "string" }),
      queryParam("limit", "Up to 500, default 100.", { type: "integer" }),
    ],
    permissions: inventoryPermission("read"),
  }),
);

add(
  "/inventory/transfers",
  "get",
  operation({
    tag: "Inventory",
    summary: "List warehouse-to-warehouse transfers.",
    operationId: "listStockTransfers",
    parameters: [
      queryParam("status", "draft, in_transit, received or cancelled.", { type: "string" }),
    ],
    permissions: inventoryPermission("read"),
  }),
);

add(
  "/inventory/transfers",
  "post",
  operation({
    tag: "Inventory",
    summary: "Raise a transfer between two warehouses.",
    operationId: "createStockTransfer",
    permissions: inventoryPermission("create", "stock.transfer"),
    requestBody: jsonBody(
      objectSchema({
        fromWarehouseId: { type: "string", format: "uuid" },
        toWarehouseId: { type: "string", format: "uuid" },
        ref: { type: "string", nullable: true },
        reason: { type: "string", nullable: true },
        notes: { type: "string", nullable: true },
        lines: {
          type: "array",
          items: objectSchema({
            itemId: { type: "string", format: "uuid" },
            // Validated as strictly positive by the route; expressed as a
            // minimum here because this document is OpenAPI 3.0, where
            // exclusiveMinimum is a boolean modifier rather than a value.
            quantity: { type: "number", minimum: 0 },
            batchNo: { type: "string", nullable: true },
            serialNo: { type: "string", nullable: true },
          }),
        },
      }),
      "Where from, where to, and what.",
    ),
    status: 201,
  }),
);

add(
  "/inventory/transfers/{transferId}/dispatch",
  "post",
  operation({
    tag: "Inventory",
    summary: "Send a transfer: stock leaves the source and is in transit.",
    operationId: "dispatchStockTransfer",
    parameters: [pathParam("transferId", "Transfer id.")],
    permissions: inventoryPermission("update", "stock.transfer"),
  }),
);

add(
  "/inventory/transfers/{transferId}/receive",
  "post",
  operation({
    tag: "Inventory",
    summary: "Receive a transfer, reporting anything damaged in transit.",
    operationId: "receiveStockTransfer",
    parameters: [pathParam("transferId", "Transfer id.")],
    permissions: inventoryPermission("update", "stock.transfer"),
    requestBody: jsonBody(
      objectSchema({
        lines: {
          type: "array",
          items: objectSchema({
            id: { type: "string", format: "uuid" },
            receivedQty: { type: "number", minimum: 0 },
            damagedQty: { type: "number", minimum: 0 },
          }),
        },
      }),
      "Per-line quantities. Omit a line to accept it in full.",
      false,
    ),
  }),
);

add(
  "/inventory/purchase-orders",
  "get",
  operation({
    tag: "Inventory",
    summary: "List purchase orders for receiving or matching.",
    operationId: "listReceivableOrders",
    parameters: [
      queryParam("projectId", "Limit to one project.", { type: "string", format: "uuid" }),
      queryParam(
        "scope",
        '"receivable" limits to orders still expecting a delivery; "all" (the default) also includes received orders, which is what the three-way match needs. Cancelled and closed orders are never listed.',
        { type: "string", enum: ["receivable", "all"] },
      ),
    ],
    permissions: inventoryPermission("read"),
  }),
);

add(
  "/inventory/purchase-orders/{ref}",
  "get",
  operation({
    tag: "Inventory",
    summary: "Find a purchase order by reference, with what is still outstanding on each line.",
    operationId: "findPurchaseOrderForReceipt",
    parameters: [pathParam("ref", "The PO reference, as scanned or typed off the delivery note.", null)],
    permissions: inventoryPermission("read"),
  }),
);

add(
  "/inventory/goods-receipt",
  "post",
  operation({
    tag: "Inventory",
    summary: "Receive a delivery against a purchase order, into stock.",
    operationId: "receiveAgainstPurchaseOrder",
    permissions: inventoryPermission("create", "stock.receive"),
    requestBody: jsonBody(
      objectSchema({
        orderId: { type: "string", format: "uuid" },
        warehouseId: { type: "string", format: "uuid" },
        receiptNumber: { type: "string", nullable: true },
        deliveryNote: { type: "string", nullable: true },
        notes: { type: "string", nullable: true },
        lines: {
          type: "array",
          items: objectSchema({
            poLineId: { type: "string", format: "uuid" },
            acceptedQty: { type: "number", minimum: 0 },
            rejectedQty: { type: "number", minimum: 0 },
            unitCost: { type: "number", nullable: true, minimum: 0 },
            locationId: nullableUuid,
            inventoryItemId: nullableUuid,
            batchNo: { type: "string", nullable: true },
            serialNo: { type: "string", nullable: true },
            expiryDate: { type: "string", format: "date-time", nullable: true },
          }),
        },
      }),
      "The order, where it is being put, and what turned up on each line.",
    ),
    status: 201,
  }),
);

add(
  "/inventory/match/order/{orderId}",
  "get",
  operation({
    tag: "Inventory",
    summary:
      "Three-way match for a purchase order: ordered against received against invoiced.",
    operationId: "matchPurchaseOrder",
    parameters: [pathParam("orderId", "Purchase order id.")],
    permissions: inventoryPermission("read"),
  }),
);

add(
  "/inventory/match/invoice/{directCostId}",
  "get",
  operation({
    tag: "Inventory",
    summary: "Three-way match from a supplier invoice's side.",
    operationId: "matchSupplierInvoice",
    parameters: [pathParam("directCostId", "Supplier invoice (direct cost) id.")],
    permissions: inventoryPermission("read"),
  }),
);

add(
  "/inventory/summary",
  "get",
  operation({
    tag: "Inventory",
    summary: "Inventory value, stock health and movement totals.",
    operationId: "getInventorySummary",
    parameters: [
      queryParam("projectId", "Scope the figures to one project.", {
        type: "string",
        format: "uuid",
      }),
    ],
    permissions: inventoryPermission("read"),
  }),
);

add(
  "/inventory/analytics",
  "get",
  operation({
    tag: "Inventory",
    summary:
      "The inventory dashboard: value by warehouse, shortages, overstock, slow movers, damage, usage and cost by activity, ordered-against-received-against-used, purchase price trends, upcoming material needs from the programme, and long-lead items.",
    description:
      "Every section names the rows behind its number, capped at 25 each. Heavier than /inventory/summary, which is the tile strip.",
    operationId: "getInventoryAnalytics",
    parameters: [
      queryParam("projectId", "Scope the figures to one project.", {
        type: "string",
        format: "uuid",
      }),
    ],
    permissions: inventoryPermission("read"),
  }),
);

const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "PMcopilots API",
    version: "1.0.0",
    description: [
      "Shared REST API contract for the PMcopilots web and mobile clients.",
      "All JSON API responses use an envelope: success responses are `{ success: true, data }`; errors are `{ success: false, error: { code, message, details? } }`.",
      "Authenticated endpoints require `Authorization: Bearer <accessToken>` and are scoped to the caller organization (`org_id`) by middleware and service-layer queries.",
      "Large collections use cursor pagination with `cursor`, `limit`, and response fields such as `nextCursor` and `hasMore` where supported.",
      "Permissions are documented per operation in the `x-permissions` extension. Module/action permissions are sourced from `shared/permissions.json`; role-only legacy gates list the allowed roles directly.",
    ].join("\n\n"),
  },
  servers: [
    { url: "/api/v1", description: "Current host API v1" },
    {
      url: "http://localhost:5000/api/v1",
      description: "Local backend development",
    },
    { url: "https://octapm.com/api/v1", description: "Production API" },
  ],
  tags: [
    {
      name: "Auth",
      description: "JWT registration, login, refresh, and profile endpoints.",
    },
    {
      name: "Billing",
      description:
        "Stripe-backed trial, subscription, invoice, and plan endpoints.",
    },
    {
      name: "Webhooks",
      description: "Signature-verified provider webhooks.",
    },
    {
      name: "Companies",
      description:
        "Reusable organization company records for external and internal parties.",
    },
    {
      name: "Projects",
      description: "Project CRUD, setup readiness, and workspace dashboard.",
    },
    {
      name: "Project Parties",
      description:
        "Owner, consultant, contractor, and subcontractor project relationships and scoped users.",
    },
    {
      name: "BOQ",
      description: "BOQ upload, management, and BOQ-linked activity helpers.",
    },
    {
      name: "Schedule",
      description:
        "Active schedule, AI generation, resources, and baseline endpoints.",
    },
    {
      name: "Schedule Revisions",
      description:
        "Draft review, approval, activation, rollback, and baseline lifecycle.",
    },
    {
      name: "Activities",
      description: "Activity CRUD and structured dependency payloads.",
    },
    {
      name: "Activity BOQ Allocations",
      description:
        "Official BOQ-to-activity allocation workflow for EV and IPC traceability.",
    },
    {
      name: "Materials",
      description:
        "Activity-linked material requirements, issued quantities, consumption, and procurement traceability.",
    },
    {
      name: "Progress",
      description:
        "Progress methods, submissions, approvals, and daily progress workflows.",
    },
    {
      name: "Imports",
      description:
        "P6 XER, P6 XML, MSP XML, progress import, and CPM utilities.",
    },
    {
      name: "Reports",
      description:
        "Earned value periods, cost loading, official EV, and reporting APIs.",
    },
    {
      name: "Tasks",
      description:
        "Persisted task assignments, comments, attachments, due dates, and closeout workflow.",
    },
    {
      name: "Meetings",
      description:
        "Meeting minutes, attendees, agenda, decisions, action items, distribution history, comments, notifications, and audit workflows.",
    },
    {
      name: "Weekly Reports",
      description: "Weekly progress report records and current-week helper.",
    },
    {
      name: "Cost Control",
      description:
        "Activity-linked cost records, summaries, and burn-rate APIs.",
    },
    {
      name: "Commercial",
      description:
        "Change orders, IPC, sub valuations, cash flow, EOT, and weather delay APIs.",
    },
    {
      name: "Procurement",
      description:
        "Suppliers, procurement packages, PO lines, delivery receipts, warehouse issue state, and lead-time alerts.",
    },
    {
      name: "Risks",
      description: "Project risk register APIs.",
    },
    {
      name: "Daily Reports",
      description: "Mobile-ready daily site reporting workflow.",
    },
    { name: "Site Diaries", description: "Mobile-ready site diary workflow." },
    {
      name: "Site Reporting",
      description: "Mobile-ready site photo upload and download APIs.",
    },
    {
      name: "Equipment",
      description:
        "Project equipment master data and approved daily-report utilization.",
    },
    {
      name: "Audit",
      description: "Project audit history and workflow timeline APIs.",
    },
    {
      name: "Notifications",
      description:
        "In-app notification state, user preferences, and auditable email delivery attempts.",
    },
    {
      name: "Health",
      description: "Seven-dimension project health scoring.",
    },
    {
      name: "Quality",
      description: "Quality dashboard and NCR workflow APIs.",
    },
    {
      name: "Document Control",
      description: "Document-control dashboard and RFI workflow APIs.",
    },
    {
      name: "Workflow Uploads",
      description: "Shared evidence upload and download APIs.",
    },
    { name: "Exports", description: "Project export APIs." },
    { name: "Users", description: "Organization user management." },
    {
      name: "Config",
      description: "Shared application configuration endpoints.",
    },
    {
      name: "Locations",
      description:
        "Hierarchical project locations (site, building, level, zone, room) used as the spatial key for field records.",
    },
    {
      name: "Jobs",
      description:
        "Durable background jobs (BOQ AI, schedule generation) stored in PostgreSQL and processed by workers with retry, heartbeat recovery, and TTL pruning. See docs/qa/background-jobs.md.",
    },
    {
      name: "Realtime",
      description:
        "Not a REST surface. Authenticated socket.io transport at the API origin: clients send `project:join { projectId }` (acknowledged after the same project access check as REST) and receive `domain.event` messages of type record.changed, approval.decided, notification.created, or job.progress. See docs/qa/realtime-events.md.",
    },
    {
      name: "Permissions",
      description:
        "Permission templates (per-module level none/read_only/standard/admin plus granular grants) assignable per user per project or per project party, layered over the static role policy in shared/permissions.json. See docs/qa/permission-templates.md.",
    },
    {
      name: "Company Workspace",
      description:
        "Organisation-level masters reused on every project: company directory, vendors (Company.isVendor, linked from project suppliers), cost codes, equipment masters and project templates. See docs/qa/company-workspace.md.",
    },
    {
      name: "Attachments",
      description:
        "Unified attachments and photos: one link table (Attachment → ProjectDocument) for every record type, a Photo entity with EXIF/GPS/location/tags, and background thumbnails via the photo.thumbnail job. See docs/qa/attachments-photos.md.",
    },
    {
      name: "Comments",
      description:
        "Comments with explicit @mentions on every record type, plus record subscriptions (follow / unfollow). Comments also appear in the record history feed (`GET /projects/{projectId}/audit?source=comment`). See docs/qa/comments-subscriptions.md.",
    },
    {
      name: "Inspections & Forms",
      description:
        "Checklist / template engine: company and project templates (sections → items of type pass/fail, yes/no, checkbox, text, number, choice, date, photo, signature) and their instances — inspections, ITPs, forms and toolbox talks — with scheduling and recurrence, per-item answers, photo evidence, drawn signatures, deficient answers raised as punch items, and ITP hold points that block progress approval (409 ITP_HOLD_POINT_OPEN). Legacy ITP records were migrated into instances. See docs/qa/inspections.md.",
    },
    {
      name: "Punch List",
      description:
        "Punch items with a draft → open → ready_for_review → closed state machine (plus in_dispute and void), an event ledger, company-scoped visibility for subcontractors, bulk create, email distribution, and PDF / CSV export per subcontractor or location. Replaces the legacy defect register (rows migrated). Observations (OCTA-QA-OBS-015: safety, quality, commissioning, work to complete, environmental; hazard and contributing condition; raised from inspections, photos or drawing pins) are the same engine with `kind=observation` and OBS-001 numbering. See docs/qa/punch-list.md.",
    },
    {
      name: "Drawings",
      description:
        "Drawing sets → sheets → revisions: upload a multi-page PDF, title blocks are read from the text layer per page (number, title, revision, discipline with confidence), review the grid, publish so the site sees only current sheets; superseded revisions stay available to document controllers. See docs/qa/drawings.md.",
    },
    {
      name: "Document Search",
      description:
        "Text extraction (PDF, Word, Excel, PowerPoint, OpenDocument, text) through the document.extract job, Postgres full-text search with snippets, and optional embeddings (OPENAI / VOYAGE / GEMINI keys) for semantic ranking. Content hits also surface in the global search. See docs/qa/document-search.md.",
    },
    {
      name: "Assignments",
      description:
        "Accountability references on workflow records: every RFI, submittal, NCR, ITP, defect, safety incident, material test, drawing, transmittal, correspondence and risk carries ownerUserId / reviewerUserId / approverUserId / assigneeUserId / assigneeCompanyId / ballInCourtUserId. Notifications resolve recipients by id only. See docs/qa/record-assignments.md.",
    },
    {
      name: "BIM",
      description:
        "IFC models (OCTA-BIM-IFC-043): upload a model, read its spatial breakdown, elements, property sets, materials and base quantities with a dependency-free IFC reader (no geometry is evaluated), roll quantities up by type or storey, and tie elements to activities, locations, BOQ items and issues — the 4D groundwork on the activity-linked spine. See docs/qa/bim-models.md.",
    },
    {
      name: "Conversations",
      description:
        "Messaging inside the organisation (OCTA-COMM-CONV-042): direct, group and per-record threads, optionally scoped to a project; explicit @mentions, shared records, stars, mutes, unread counts and real-time fan-out to the members. Replies to notification emails land here through the inbound webhook. See docs/qa/conversations-inbound-email.md.",
    },
    {
      name: "Project Emails",
      description:
        "Inbound email (OCTA-COMM-CONV-042): each project has an address (p-<token>@INBOUND_EMAIL_DOMAIN); notification emails carry signed reply-to-record / reply-to-conversation addresses. The provider webhook routes replies to comments and messages and keeps the rest in the project inbox for triage (log as correspondence, post to a record, start a conversation). See docs/qa/conversations-inbound-email.md.",
    },
    {
      name: "Inventory",
      description:
        "Inventory, warehouses and the stock ledger (OCTA-INV-STOCK-050): an item master with barcode and QR resolution, warehouses with a zone/aisle/rack/shelf/bin tree, and every movement — receipt, issue to an activity or cost code, return, transfer, adjustment, damage and quarantine — written to an append-only ledger that the balances are kept in step with. Costing is weighted average; stock cannot go negative.",
    },
    {
      name: "Lookaheads",
      description:
        "Short-interval plans (OCTA-SCH-LOOKAHEAD-041): 2–6 week windows seeded from the master schedule, tasks added by hand, constraints to clear (the make-ready log), weekly percent-plan-complete and roll-forward. Schedule files for Primavera P6 (XER, XML) and Microsoft Project are under Exports. See docs/qa/schedule-export-lookahead.md.",
    },
  ],
  paths,
  components,
};

module.exports = { openApiSpec };
