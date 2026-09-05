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
      queryParam("recordType", "Record type.", ref("AttachmentRecordType")),
      queryParam("recordId", "Record id.", { type: "string" }),
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
const commentRecordParams = [
  ...projectParams,
  queryParam("recordType", "Record type.", ref("AttachmentRecordType")),
  queryParam("recordId", "Record id.", { type: "string" }),
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
  ],
  paths,
  components,
};

module.exports = { openApiSpec };
