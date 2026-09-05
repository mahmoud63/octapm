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

const queryParam = (name, description, schema) => ({
  name,
  in: "query",
  required: false,
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
        "SUBMITTAL_ARCHIVED",
        "SUBMITTAL_ARCHIVE_ACTION_REQUIRED",
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
    RfiRequest: objectSchema(
      {
        subject: { type: "string" },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        status: { type: "string", enum: ["open", "answered", "closed"] },
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
      },
      ["title"],
    ),
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
      name: "Assignments",
      description:
        "Accountability references on workflow records: every RFI, submittal, NCR, ITP, defect, safety incident, material test, drawing, transmittal, correspondence and risk carries ownerUserId / reviewerUserId / approverUserId / assigneeUserId / assigneeCompanyId / ballInCourtUserId. Notifications resolve recipients by id only. See docs/qa/record-assignments.md.",
    },
  ],
  paths,
  components,
};

module.exports = { openApiSpec };
