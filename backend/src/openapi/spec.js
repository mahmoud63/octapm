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
// §12: the bill's figures on the schedule and the activities — and every
// per-activity budget built from them, cost readers included (owner decision
// E1, 2026-09-28) — go only to a caller who may read the BOQ. Absent (never
// zeroed) for anyone else. The project's totals built from them are stated
// where they sit (a caller who may read the BOQ or the cost module).
const BOQ_READERS_ONLY = " Present only for a caller who may read the BOQ (boq:read); omitted, not zeroed, for anyone else.";
const boqFigure = (schema, what) => ({ ...schema, description: what + BOQ_READERS_ONLY });
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
        mfaEnabled: { type: "boolean" },
        ssoLinked: { type: "boolean" },
        mfaEnrollmentRequired: { type: "boolean" },
        createdAt: nullableDateString,
        updatedAt: nullableDateString,
        memberships: {
          type: "array",
          description:
            "Every workspace the identity belongs to (memberships that were left are not listed; suspended ones carry their status). Present on GET /auth/me and on a workspace session.",
          items: ref("WorkspaceMembership"),
        },
        active: {
          nullable: true,
          description:
            "The workspace and membership the presented token is bound to; null for an identity token.",
          allOf: [
            objectSchema({ orgId: uuid, membershipId: nullableUuid }, ["orgId"]),
          ],
        },
      },
      ["id", "orgId", "name", "email", "role", "status"],
    ),
    WorkspaceMembership: objectSchema(
      {
        orgId: uuid,
        membershipId: uuid,
        slug: { type: "string", nullable: true },
        name: { type: "string", nullable: true },
        kind: { type: "string", enum: ["personal", "company"] },
        role: { type: "string" },
        isAdmin: { type: "boolean" },
        isOwner: { type: "boolean" },
        status: { type: "string", enum: ["invited", "active", "suspended"] },
      },
      ["orgId", "membershipId", "kind", "role", "isAdmin", "isOwner", "status"],
    ),
    AuthWorkspaceChoiceResponse: objectSchema(
      {
        chooseWorkspace: {
          type: "boolean",
          description: "The identity has several active workspaces: pick one with POST /auth/workspaces/{orgId}/session.",
        },
        needsWorkspace: {
          type: "boolean",
          description: "The identity has no workspace it can enter (every membership left or suspended).",
        },
        identityToken: {
          type: "string",
          description:
            "A short-lived token that names the identity and no workspace. Accepted only by GET /auth/me and POST /auth/workspaces/{orgId}/session.",
        },
        memberships: arrayOf(ref("WorkspaceMembership")),
      },
      ["identityToken", "memberships"],
    ),
    AuthWorkspaceSessionResponse: objectSchema(
      {
        user: ref("GenericObject"),
        tokens: ref("AuthTokens"),
        workspace: ref("WorkspaceMembership"),
        memberships: arrayOf(ref("WorkspaceMembership")),
      },
      ["user", "tokens", "workspace", "memberships"],
    ),
    AuthWorkspaceResolveResponse: objectSchema(
      {
        project: objectSchema({ id: uuid, name: { type: "string" } }, ["id", "name"]),
        workspace: {
          allOf: [
            ref("WorkspaceMembership"),
            objectSchema(
              {
                segment: {
                  type: "string",
                  description:
                    "The URL segment the web client puts the project under: the workspace's slug, or its id while it has no slug.",
                },
              },
              ["segment"],
            ),
          ],
        },
        active: {
          type: "boolean",
          nullable: true,
          description:
            "Whether the project's workspace is the one the caller's token is bound to; null for an identity token, which is bound to none.",
        },
      },
      ["project", "workspace", "active"],
    ),
    // ENT-6 personal workspaces and conversion
    OrganisationSummary: objectSchema(
      {
        id: uuid,
        name: { type: "string" },
        kind: { type: "string", enum: ["personal", "company"] },
        slug: { type: "string", nullable: true },
        plan: { type: "string", description: "The organisation's plan label: individual for a personal workspace, standard for a company." },
        status: { type: "string" },
        defaultCurrency: { type: "string", description: "ISO 4217 currency a new project of this workspace starts with when it names none (default USD)." },
        defaultTimezone: { type: "string", nullable: true, description: "IANA time zone a new project of this workspace starts with when it names none; null when none was chosen." },
      },
      ["id", "name", "kind", "plan", "status", "defaultCurrency", "defaultTimezone"],
    ),
    OrganisationCreateRequest: objectSchema(
      {
        name: { type: "string", minLength: 2, maxLength: 120, description: "The company workspace's name; its URL handle is allocated from it." },
        currency: { type: "string", pattern: "^[A-Za-z]{3}$", description: "ISO 4217 currency code (e.g. USD, AED); stored upper-case. New projects of the workspace default to it when they name none." },
        timezone: { type: "string", description: "IANA time zone name (e.g. Asia/Dubai). New projects of the workspace default to it when they name none." },
      },
      ["name"],
    ),
    OrganisationConvertRequest: objectSchema({
      name: {
        type: "string",
        minLength: 2,
        maxLength: 120,
        description: "A new name for the company workspace; omitted, the personal workspace's name is kept. The URL handle is always kept.",
      },
    }),
    OrganisationWorkspaceResponse: objectSchema(
      {
        organisation: ref("OrganisationSummary"),
        workspace: {
          allOf: [ref("WorkspaceMembership")],
          description: "The caller's membership in the workspace: the seat to enter with POST /auth/workspaces/{orgId}/session.",
        },
        memberships: arrayOf(ref("WorkspaceMembership")),
      },
      ["organisation", "workspace", "memberships"],
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
        "BOQ_REVISION_COMPARISON_ONLY",
        "BOQ_REVISION_NOT_APPROVED",
        "BOQ_REVISION_NOT_CURRENT",
        "BOQ_REVISION_NOT_FOUND",
        "BOQ_REQUIRED_FOR_BASELINE",
        "BOQ_SCOPE_REQUIRED_FOR_BASELINE",
        "BOQ_VALIDATION_FAILED",
        "BOQ_VALUE_REQUIRED_FOR_BASELINE",
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
        "CONTRACT_VALUE_ALREADY_ESTABLISHED",
        "CONTRACT_VALUE_CONFIRM_CONFLICT",
        "CONTRACT_VALUE_CONFIRM_FORBIDDEN",
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
        "PAYLOAD_TOO_LARGE",
        "FILE_TOO_LARGE",
        "SERVICE_UNAVAILABLE",
        "SERVICE_NOT_READY",
        "FILE_STORAGE_UNAVAILABLE",
        "AWS_CREDENTIALS_UNAVAILABLE",
        "REGISTRATION_CLOSED",
        "BOOTSTRAP_NOT_EMPTY",
        "AI_NOT_CONFIGURED",
        "AI_UNAVAILABLE",
        "AI_TRANSCRIPTION_NOT_CONFIGURED",
        "AI_TRANSCRIPTION_FAILED",
        "ASSISTANT_UNAVAILABLE",
        "PUSH_NOT_CONFIGURED",
        "INBOUND_EMAIL_NOT_CONFIGURED",
        "WEATHER_FEED_UNAVAILABLE",
        "WEATHER_FEED_NO_DATA",
        "SSO_DISCOVERY_FAILED",
        "SSO_DISCOVERY_INVALID",
        "SSO_JWKS_FAILED",
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
        "SUBSCRIPTION_PLAN_UNKNOWN",
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
        // Workspace membership (enterprise programme, ENT-2)
        "ALREADY_MEMBER",
        "LAST_OWNER",
        "SELF_ELEVATION_FORBIDDEN",
        "OWNER_REQUIRED",
        "GUEST_FORBIDDEN",
        "WORKSPACE_REQUIRED",
        "WORKSPACE_NOT_FOUND",
        "SSO_IDENTITY_CONFLICT",
        "INVITATION_SIGN_IN_REQUIRED",
        "WORKFLOW_ACTIVITY_NOT_FOUND",
        "WORKFLOW_PROJECT_PARTY_NOT_FOUND",
        "WBS_NODE_NOT_FOUND",
        "WBS_NODE_CODE_REQUIRED",
        "WBS_NODE_CODE_TOO_LONG",
        "WBS_NODE_NAME_REQUIRED",
        "WBS_NODE_NAME_TOO_LONG",
        "WBS_NODE_DUPLICATE_CODE",
        "WBS_NODE_PARENT_INVALID",
        "WBS_NODE_PARENT_ARCHIVED",
        "WBS_NODE_INVALID_PARENT",
        "WBS_NODE_DEPTH_EXCEEDED",
        "WBS_NODE_ARCHIVED",
        "WBS_PACKAGE_OWNER_INVALID",
        "WBS_PACKAGE_COMMITMENT_INVALID",
        "UNIT_CODE_REQUIRED",
        "UNIT_CODE_TOO_LONG",
        "UNIT_NAME_TOO_LONG",
        "UNIT_DIMENSION_INVALID",
        "UNIT_DUPLICATE_CODE",
        // Tenant hardening (ENT-3): job results
        "BOQ_JOB_PROJECT_NOT_FOUND",
        "JOB_ORG_MISMATCH",
        "JOB_ORG_REQUIRED",
        // BOQ ↔ activity mapping (PC-3).
        "MAPPING_NOT_APPLICABLE",
        "MAPPING_RULE_HAS_APPROVED_ALLOCATION",
        "BOQ_ITEM_BELOW_ALLOCATIONS",
        "INVALID_MAPPING_RULE",
        "INVALID_ALLOCATION_BASIS",
        "INVALID_SUGGESTION_SOURCE",
        "INVALID_SUGGESTION_CONFIDENCE",
        "LOCATION_OUTSIDE_SUBTREE",
        "MAPPING_IMPORT_INVALID",
        "MAPPING_IMPORT_BATCH_NOT_FOUND",
        // ENT-6 personal workspaces and conversion
        "PERSONAL_WORKSPACE_CONVERT_REQUIRED",
        "WORKSPACE_ALREADY_COMPANY",
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
        boqWithheld: objectSchema(
          {
            keys: arrayOf({ type: "string" }),
            reason: { type: "string" },
          },
          ["keys", "reason"],
        ),
        valueWithheld: objectSchema(
          {
            parts: arrayOf({ type: "string" }),
            keys: arrayOf({ type: "string" }),
            reason: { type: "string" },
          },
          ["parts", "keys", "reason"],
        ),
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
        // ENT-6 (§16): the personal workspace's project defaults, optional.
        currency: { type: "string", pattern: "^[A-Za-z]{3}$", description: "ISO 4217 currency code (e.g. USD, AED); stored upper-case. New projects of the workspace default to it when they name none." },
        timezone: { type: "string", description: "IANA time zone name (e.g. Asia/Dubai). New projects of the workspace default to it when they name none." },
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
        existingUser: {
          type: "boolean",
          description:
            "The invited email already belongs to an identity (here or in another workspace). Acceptance then needs proof of that identity: a bearer for it on the accept request, or its password.",
        },
        requiresPassword: {
          type: "boolean",
          description:
            "Always true: a new identity chooses its password; an existing one proves itself with the password it has (unless the accept request carries a bearer for it).",
        },
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
        refreshToken: {
          type: "string",
          description:
            "Native clients only (request header X-OctaPM-Client: mobile): the rotated refresh token, to be kept in the platform keychain and presented in the body of /auth/refresh and /auth/logout. Browser clients never receive it here; they get the httpOnly cookie.",
        },
        refreshTokenExpiresAt: {
          type: "string",
          format: "date-time",
          nullable: true,
          description: "Native clients only.",
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
    BillingSubscriptionLimits: objectSchema(
      {
        projectLimit: {
          type: "integer",
          minimum: 1,
          nullable: true,
          description: "Live projects the plan allows; null means unlimited.",
        },
        aiLimit: {
          type: "integer",
          minimum: 1,
          nullable: true,
          description: "AI generations per period; null means unlimited.",
        },
      },
      ["projectLimit", "aiLimit"],
    ),
    BillingPlanConfigurationError: objectSchema(
      {
        code: { type: "string", enum: ["SUBSCRIPTION_PLAN_UNKNOWN"] },
        message: { type: "string" },
      },
      ["code", "message"],
    ),
    BillingSubscription: objectSchema(
      {
        id: uuid,
        plan: {
          type: "string",
          nullable: true,
          description:
            "The stored plan. One of trial, individual, business or enterprise when `recognized` is true. " +
            "Any other stored value is a configuration fault (`recognized` false): it is echoed when it is a plain token " +
            "and null otherwise, and it is never a tier.",
        },
        recognized: {
          type: "boolean",
          description: "Whether the stored plan is in the plan catalogue.",
        },
        planName: {
          type: "string",
          nullable: true,
          description: "The plan's display name; null when the plan is not recognized.",
        },
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
        projectLimit: {
          type: "integer",
          minimum: 1,
          nullable: true,
          description:
            "Same as limits.projectLimit (null means unlimited). Absent when the plan is not recognized — its limits are unavailable.",
        },
        aiLimit: {
          type: "integer",
          minimum: 1,
          nullable: true,
          description:
            "Same as limits.aiLimit (null means unlimited). Absent when the plan is not recognized — its limits are unavailable.",
        },
        limits: {
          ...ref("BillingSubscriptionLimits"),
          nullable: true,
          description: "The plan's limits; null when the plan is not recognized.",
        },
        configurationError: {
          ...ref("BillingPlanConfigurationError"),
          nullable: true,
          description:
            "Set when the plan is not recognized: the fault the project and AI gates answer with (500 SUBSCRIPTION_PLAN_UNKNOWN).",
        },
        aiGenerationsUsed: { type: "integer", minimum: 0 },
        trialEndsAt: nullableDateString,
        currentPeriodEnd: nullableDateString,
        cancelAtPeriodEnd: { type: "boolean" },
        paymentMethod: { ...ref("BillingPaymentMethod"), nullable: true },
      },
      [
        "id",
        "plan",
        "recognized",
        "planName",
        "status",
        "hasAccess",
        "limits",
        "configurationError",
      ],
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
    /**
     * The only four things a buyer could sensibly change when raising the
     * order for an award. Everything else is read from the award itself.
     */
    ProcurementOrderFromAward: objectSchema(
      {
        ref: { type: 'string', nullable: true },
        requiredBy: nullableDateString,
        leadWeeks: { type: 'integer', minimum: 0 },
        notes: { type: 'string', nullable: true },
      },
      [],
    ),
    ProcurementQuoteRequest: objectSchema(
      {
        title: { type: 'string' },
        description: { type: 'string', nullable: true },
        instructions: { type: 'string', nullable: true },
        dueAt: nullableDateString,
        currency: { type: 'string', minLength: 3, maxLength: 3 },
        boqSections: arrayOf({ type: 'string' }),
      },
      [],
    ),
    BoqItemMutation: objectSchema(
      {
        code: { type: "string" },
        description: { type: "string" },
        quantity: nonNegativeNumber,
        unit: { type: "string" },
        rate: money,
        activityId: {
          ...uuid,
          description:
            "An activity already on the programme, to allocate this row to. Use this on a project that has a schedule — it is what keeps the bill and the programme on one activity instead of growing a second, shadow one. Mutually exclusive with activityName.",
        },
        activityName: {
          type: "string",
          description:
            "Creates a new schedule activity for this row, with a generated activityCode. For a project that has no programme yet. Mutually exclusive with activityId; giving neither leaves the row unallocated, to be split across several activities afterwards.",
        },
      },
      ["code", "description", "quantity", "unit", "rate"],
    ),
    BoqActivityMutation: objectSchema(
      {
        activityId: {
          ...uuid,
          description:
            "An activity already on the programme, to allocate this share to. Mutually exclusive with activityName.",
        },
        activityName: {
          type: "string",
          description:
            "Creates a new official schedule Activity for this share. Mutually exclusive with activityId. Legacy BoqActivity records are suggestion/history only.",
        },
        unit: { type: "string" },
        quantity: nonNegativeNumber,
        rate: money,
        dependencyType: { type: "string", enum: ["FS", "SS"], nullable: true },
        predecessorCode: { type: "string", nullable: true },
      },
      ["unit", "quantity", "rate"],
    ),
    ActivityBoqAllocationMutation: objectSchema(
      {
        boqItemId: uuid,
        activityId: uuid,
        quantity: nonNegativeNumber,
        amount: money,
        weight: percent,
        basis: {
          type: "string",
          enum: ["quantity", "amount", "weight"],
          description:
            "Which figure was typed; the other two are derived from the BOQ item (money 2 dp, quantity 3 dp). Defaults to the first figure present.",
        },
        source: {
          type: "string",
          enum: ["manual", "import", "ai", "migration"],
        },
        notes: { type: "string", nullable: true },
        locationId: {
          ...nullableUuid,
          description:
            "The zone this share is delivered in. Must be the BOQ item's (and the activity's) location or a descendant of it (422 LOCATION_OUTSIDE_SUBTREE).",
        },
        suggestedBy: {
          type: "string",
          nullable: true,
          enum: ["ai", "rule:code", "rule:wbs", "rule:location", "rule:name", "rule:costcode", "import", null],
          description: "Provenance of an accepted suggestion.",
        },
        confidence: { type: "number", minimum: 0, maximum: 1, nullable: true },
      },
      ["boqItemId", "activityId"],
    ),
    MappingWarning: objectSchema({
      code: {
        type: "string",
        enum: ["UNIT_MISMATCH", "WBS_OUTSIDE_SUBTREE", "LOCATION_OUTSIDE_SUBTREE", "ALLOCATION_RATE_DRIFT"],
      },
      severity: { type: "string", enum: ["warning"] },
      message: { type: "string" },
      details: ref("GenericObject"),
    }),
    MappingRuleWarning: objectSchema({
      code: { type: "string", enum: ["MAPPING_RULE_HAS_APPROVED_ALLOCATION"] },
      row: { type: "integer", description: "1-based row in the uploaded workbook." },
      itemCode: { type: "string" },
      boqItemId: uuid,
      message: { type: "string" },
    }),
    BoqUploadMappingRuleCounts: objectSchema({
      required: { type: "integer" },
      optional: { type: "integer" },
      notApplicable: { type: "integer" },
      unspecified: { type: "integer", description: "Rows whose mapping_rule cell is blank; they keep or default to required." },
    }),
    RederivedAllocation: objectSchema({
      allocationId: uuid,
      basis: { type: "string", enum: ["quantity", "amount", "weight"] },
      before: ref("GenericObject"),
      after: ref("GenericObject"),
    }),
    // PC-5 detail views: one envelope for every figure they state (three
    // truths, OCTAPM_PROJECT_CONTROL_MODEL.md §3), and the section shape.
    ControlsFigure: {
      type: "object",
      description:
        "A figure and where it comes from. truth is source (read from its own row), derived (worked by the service that owns the rule, from source rows) or projection (an estimate that never feeds a certified figure). A figure no service can prove yet has value null, truth null, notAvailable true and the wave that brings it.",
      additionalProperties: false,
      properties: {
        value: { type: "number", nullable: true },
        truth: { type: "string", enum: ["source", "derived", "projection"], nullable: true },
        basis: { type: "string", description: "What the figure is and the rule or filter that produced it." },
        derivedFrom: arrayOf(freeObject("A record type (and id or filter) the figure is read or derived from.")),
        notAvailable: { type: "boolean" },
        wave: { type: "string", description: "The programme wave that will bring a figure not available yet (PC-6, PC-7)." },
      },
      required: ["value", "truth", "basis", "derivedFrom"],
    },
    ControlsDetailSection: {
      type: "object",
      description:
        "One section of a detail view. allowed false means the viewer may not read the module that owns it (or, for the bill's figures, the BOQ): no data is sent, only module and reason. Lists inside a section are capped at 50 rows as { items, total, viewAll }. Every numeric figure is a ControlsFigure.",
      additionalProperties: true,
      properties: {
        allowed: { type: "boolean" },
        module: { type: "string" },
        reason: { type: "string" },
      },
      required: ["allowed"],
    },
    ControlsDetail: objectSchema(
      {
        kind: { type: "string", enum: ["boq_item", "activity"] },
        id: { type: "string", format: "uuid" },
        href: { type: "string", description: "The record's web link (/o/{slug}/projects/{id}/...?recordId=&source=)." },
        header: freeObject("Identity, dates and status of the record (source fields)."),
        sections: {
          type: "object",
          additionalProperties: ref("ControlsDetailSection"),
          description:
            "BOQ item: structure, mapping, quantities, money, certification (ipc), commitments (commitment), changes (change_order), procurement, readiness, history (audit), documents. Activity: structure, mapping (BOQ readers only), progress, cost, certification (ipc and BOQ), changes, procurement, quality, constraints, documents, history (audit).",
        },
        withheld: { type: "boolean" },
        reason: { type: "string" },
      },
      ["kind", "id"],
    ),
    BoqItemUpdateResponse: objectSchema({
      item: ref("GenericObject"),
      financial: ref("GenericObject"),
      unitWarning: nullableRef("UnitWarning"),
      allocationWarnings: {
        ...arrayOf(ref("MappingWarning")),
        description: "ALLOCATION_RATE_DRIFT for each approved or submitted allocation the rate change left disagreeing with the item; those rows are never rewritten.",
      },
      rederivedAllocations: {
        ...arrayOf(ref("RederivedAllocation")),
        description: "Draft allocations re-derived from their basis after a rate or quantity change on the unlocked item.",
      },
    }),
    AllocationCoverageCounts: objectSchema({
      unmapped: { type: "integer" },
      partial: { type: "integer" },
      complete: { type: "integer" },
      over: { type: "integer" },
      notApplicable: { type: "integer" },
    }),
    AllocationCoverageGroup: objectSchema({
      key: { type: "string" },
      label: { type: "string" },
      code: { type: "string", nullable: true },
      path: { type: "string", nullable: true },
      itemCount: { type: "integer" },
      totalBoqQuantity: { type: "number" },
      totalBoqAmount: money,
      allocatableBoqAmount: money,
      approvedAllocatedQuantity: { type: "number" },
      approvedAllocatedAmount: money,
      pendingAllocatedAmount: money,
      unallocatedQuantity: { type: "number" },
      unallocatedAmount: money,
      optionalUnallocatedQuantity: { type: "number" },
      optionalUnallocatedAmount: money,
      notApplicableQuantity: { type: "number" },
      notApplicableAmount: money,
      earnedValue: money,
      certifiedValue: money,
      coveragePct: percent,
      counts: ref("AllocationCoverageCounts"),
    }),
    AllocationCoverageSummary: objectSchema({
      groupBy: { type: "string", enum: ["none", "wbs", "section", "location", "costCode", "package"] },
      cutoffDate: nullableDateString,
      totalBoqQuantity: { type: "number" },
      totalBoqAmount: money,
      allocatableBoqAmount: money,
      activeAllocatedQuantity: { type: "number" },
      activeAllocatedAmount: money,
      approvedAllocatedQuantity: { type: "number" },
      approvedAllocatedAmount: money,
      pendingAllocatedAmount: money,
      scheduledQuantity: { type: "number" },
      scheduledValue: money,
      unscheduledQuantity: { type: "number" },
      unscheduledValue: money,
      unallocatedQuantity: { type: "number" },
      unallocatedAmount: money,
      optionalUnallocatedQuantity: { type: "number" },
      optionalUnallocatedAmount: {
        ...money,
        description: "Remaining value of items whose mappingRule is optional: inside unallocatedAmount, reported apart because readiness warns about it instead of blocking on it.",
      },
      notApplicableAmount: {
        ...money,
        description: "Value of items whose mappingRule is not_applicable: BOQ total = approved allocated + unallocated + not applicable.",
      },
      notApplicableQuantity: { type: "number" },
      earnedValue: money,
      certifiedValue: money,
      coveragePct: percent,
      counts: ref("AllocationCoverageCounts"),
      groups: arrayOf(ref("AllocationCoverageGroup")),
      items: arrayOf(ref("GenericObject")),
    }),
    MappingSuggestion: objectSchema({
      boqItemId: uuid,
      boqCode: { type: "string" },
      activityId: uuid,
      activityCode: { type: "string" },
      activityName: { type: "string" },
      wbsCode: { type: "string", nullable: true },
      suggestedBy: { type: "string", enum: ["rule:code", "rule:wbs", "rule:costcode", "rule:name"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reasons: arrayOf({ type: "string" }),
    }),
    MappingSuggestionsResponse: objectSchema({
      suggestions: arrayOf(ref("MappingSuggestion")),
      byItem: arrayOf(
        objectSchema({
          boqItemId: uuid,
          code: { type: "string" },
          candidates: arrayOf(ref("MappingSuggestion")),
          skipped: { type: "string", nullable: true, enum: ["not_applicable", null] },
        }),
      ),
      summary: objectSchema({
        items: { type: "integer" },
        itemsWithCandidates: { type: "integer" },
        candidates: { type: "integer" },
        limitPerItem: { type: "integer" },
      }),
    }),
    MappingRulesMutation: objectSchema(
      {
        rule: { type: "string", enum: ["required", "optional", "not_applicable"] },
        itemIds: arrayOf(uuid),
        section: { type: "string", nullable: true, description: "Apply to every active row of this section (case-insensitive)." },
      },
      ["rule"],
    ),
    MappingRulesResponse: objectSchema({
      rule: { type: "string" },
      matched: { type: "integer" },
      updated: { type: "integer" },
      itemIds: arrayOf(uuid),
    }),
    // ── Setup readiness (PC-4): the twelve-step check with per-item detail ──
    ProjectSetupTarget: objectSchema(
      {
        module: { type: "string" },
        child: { type: "string" },
      },
      ["module"],
    ),
    ProjectSetupItem: objectSchema(
      {
        type: {
          type: "string",
          description:
            "The record behind the issue: project, boq_item, boq_revision, activity, allocation, schedule_revision, unit, wbs, location or cost_code.",
        },
        id: { type: "string", nullable: true },
        code: { type: "string", nullable: true },
        label: { type: "string", nullable: true },
        missing: { type: "string", description: "What the record lacks." },
        href: {
          type: "string",
          nullable: true,
          description: "Where to fix it: the module page under the project's workspace, with the record in the URL. null when no page resolves it yet (a BOQ row without a WBS node or a cost code: filing comes with the BOQ item detail) — named, not linked.",
        },
      },
      ["type", "missing", "href"],
    ),
    ProjectSetupIssue: objectSchema(
      {
        code: { type: "string" },
        message: { type: "string" },
        severity: {
          type: "string",
          enum: ["blocking", "warning", "advisory"],
          description: "advisory: information only (a step's advisories list) — it never moves a step's status, its message or a gate.",
        },
        details: {
          ...ref("GenericObject"),
          description:
            "The figures behind the issue. The BOQ value figures (totalBoqAmount, allocatableBoqAmount, approved/pending/unallocated/optionalUnallocated/notApplicable amounts) are left out for a caller who may not read the BOQ.",
        },
        items: {
          ...arrayOf(ref("ProjectSetupItem")),
          description: "The offending records, capped at 50; `count` is the whole number.",
        },
        count: {
          type: "integer",
          description:
            "Absent on a mapping issue (BOQ_MAPPING_RULE_UNSET, NO_APPROVED_ALLOCATIONS, UNALLOCATED_BOQ, OPTIONAL_UNALLOCATED, PENDING_ALLOCATIONS, SUGGESTIONS_PENDING, UNIT_MISMATCH_COUNT, LOCATION_MISMATCH_COUNT) and on a BOQ row issue (BOQ_ITEMS_WITHOUT_WBS, BOQ_ITEMS_WITHOUT_COST_CODE, BOQ_UNIT_UNRESOLVED, UOM_UNRESOLVED) for a caller who may not read the BOQ.",
        },
        mappingDetailsWithheld: {
          type: "boolean",
          description:
            "Present and true on a mapping issue for a caller who may not read the BOQ: its count, the counting details and any count in its message are left out.",
        },
        boqDetailsWithheld: {
          type: "boolean",
          description:
            "Present and true on a BOQ row issue (BOQ_ITEMS_WITHOUT_WBS, BOQ_ITEMS_WITHOUT_COST_CODE, BOQ_UNIT_UNRESOLVED, UOM_UNRESOLVED) for a caller who may not read the BOQ: code, severity and verdict stay; its count, the counting details and the number in its message are left out, and reason says why.",
        },
        reason: {
          type: "string",
          description: "With boqDetailsWithheld: \"BOQ details unavailable to you\".",
        },
        itemsWithheld: {
          type: "boolean",
          description:
            "Present and true when the caller may not read the BOQ and the BOQ records behind the issue (rows, allocations, revisions, unit spellings) were left out of items; count is still the whole number.",
        },
        scheduleItemsWithheld: {
          type: "boolean",
          description:
            "Present and true when the caller may not read the schedule and the schedule records behind the issue (activities, schedule revisions) were left out of items; count is still the whole number, and scheduleReason says why.",
        },
        scheduleReason: {
          type: "string",
          description: "With scheduleItemsWithheld: \"Schedule records are listed for people who can open the schedule\".",
        },
        stepKey: { type: "string" },
        stepLabel: { type: "string" },
        actionLabel: { type: "string" },
        target: ref("ProjectSetupTarget"),
      },
      ["code", "message", "severity", "items"],
    ),
    ProjectSetupStep: objectSchema(
      {
        key: {
          type: "string",
          enum: [
            "project_profile",
            "structure_setup",
            "boq_upload",
            "boq_approval",
            "schedule_generation",
            "boq_allocation",
            "cost_loading_review",
            "engineer_assignment",
            "progress_method_configuration",
            "schedule_approval",
            "baseline_readiness",
            "progress_readiness",
          ],
        },
        label: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: ["complete", "attention", "blocked", "pending"] },
        requiredFor: arrayOf({ type: "string", enum: ["baseline", "progress", "reporting"] }),
        critical: { type: "boolean" },
        message: { type: "string" },
        blockers: arrayOf(ref("ProjectSetupIssue")),
        warnings: arrayOf(ref("ProjectSetupIssue")),
        advisories: {
          ...arrayOf(ref("ProjectSetupIssue")),
          description:
            "PC-4's filing and matching checks, severity advisory: listed with the step, never moving its status or a gate, and never in gates.*.warnings. structure_setup lists the BOQ rows and activities without an active WBS node (a node that has been archived counts as none) and the rows without a cost code; boq_upload the rows with an unrecognised unit; schedule_generation the activities on an unmapped imported calendar; boq_allocation pending suggestions and unit or location mismatches; progress_method_configuration quantity methods without a unit; schedule_approval STAGED_REVISION_PENDING, a newer revision staged beside the active one, with its next step. The BOQ-row filing advisories (BOQ_ITEMS_WITHOUT_WBS, BOQ_ITEMS_WITHOUT_COST_CODE) link nowhere (items[].href null): no page files a row yet; it comes with the BOQ item detail.",
        },
        counts: {
          ...ref("GenericObject"),
          description:
            "The step's counts. For a caller who may not read the BOQ: its BOQ value figures (totalBoqAmount and, on boq_allocation, the allocatable, approved, pending, unallocated, optional and not-applicable amounts) are left out, and so is every count of BOQ rows or mapping — boqItems, itemsWithoutWbs, itemsWithoutCostCode, itemsWithUnresolvedUnit (boq_upload), unitsUnresolved (structure_setup), revisionItems, revisionChanges, revisionBlockedRows and itemsWithoutMappingRule (boq_approval), suggestionsPending, unitMismatchCount and locationMismatchCount (boq_allocation). Activity and other counts stay. A BOQ reader's counts are unchanged.",
        },
        action: objectSchema(
          { label: { type: "string" }, target: ref("ProjectSetupTarget") },
          ["label", "target"],
        ),
        guides: {
          ...arrayOf(ref("ProjectSetupGuide")),
          description:
            "On structure_setup only: WBS, locations, cost codes, BOQ structure, schedule structure and mapping readiness, each with its state and where it is done.",
        },
      },
      ["key", "label", "status", "requiredFor", "critical", "message", "blockers", "warnings", "counts", "action"],
    ),
    ProjectSetupGuide: objectSchema(
      {
        key: {
          type: "string",
          enum: ["wbs", "locations", "cost_codes", "boq_structure", "schedule_structure", "mapping_readiness"],
        },
        label: { type: "string" },
        status: {
          type: "string",
          enum: ["complete", "attention", "pending"],
          description: "pending when the thing it guides needs the bill or the schedule first.",
        },
        count: {
          type: "integer",
          nullable: true,
          description:
            "What is in place, or what is still to file. null for a caller who may not read the BOQ on mapping_readiness (detailsWithheld true, detail \"Mapping details unavailable to you\") and on boq_structure (detailsWithheld true, detail \"BOQ details unavailable to you\").",
        },
        detail: { type: "string" },
        detailsWithheld: { type: "boolean" },
        target: { ...ref("ProjectSetupTarget"), nullable: true },
        href: {
          type: "string",
          nullable: true,
          description: "The page under the project's workspace where it is done. target and href are null when no page does it yet (boq_structure whose only open item is filing rows under WBS nodes).",
        },
      },
      ["key", "label", "status", "count", "detail", "target", "href"],
    ),
    ProjectSetupHeadlineEntry: objectSchema(
      {
        key: {
          type: "string",
          enum: ["boq_imported", "schedule_imported", "mapping", "unmapped_quantity", "unmapped_boq", "critical_unmapped", "baseline", "cost_loading"],
          description:
            "unmapped_quantity and unmapped_boq are given only to a caller who may read the BOQ; unmapped_quantity lists the open quantity by unit (never added across units), the three units leaving most value open first.",
        },
        label: { type: "string" },
        value: { type: "string", description: "As shown: PASS / FAIL, a percentage, a money figure, a count, or a state." },
        tone: { type: "string", enum: ["done", "review", "blocked", "info", "neutral"] },
        raw: { description: "The figure behind the text, when there is one." },
        withheld: {
          type: "boolean",
          description:
            "Present and true on the mapping and critical_unmapped entries for a caller who may not read the BOQ: value is \"—\", tone neutral, raw null, and reason says the mapping details are unavailable to them.",
        },
        reason: { type: "string" },
      },
      ["key", "label", "value", "tone"],
    ),
    ProjectSetupStructure: objectSchema(
      {
        wbsNodes: { type: "integer" },
        locations: { type: "integer" },
        projectCostCodes: { type: "integer" },
        unitsUnresolved: {
          type: "integer",
          description:
            "Distinct unit spellings on the bill not in the organisation's unit list. Absent for a caller who may not read the BOQ (a BOQ-derived count): unitsUnresolvedWithheld true and reason \"BOQ details unavailable to you\" instead.",
        },
        unitsUnresolvedWithheld: { type: "boolean" },
        reason: { type: "string" },
      },
      ["wbsNodes", "locations", "projectCostCodes"],
    ),
    ProjectSetupReadiness: objectSchema(
      {
        projectId: uuid,
        rulesetVersion: { type: "string" },
        checkedAt: { type: "string", format: "date-time" },
        summary: {
          ...ref("GenericObject"),
          description:
            "Step counts, the three ready flags, nextAction (chosen from the ten original steps only, as before PC-4), advisoryAction (the first of the two advisory steps, structure_setup and boq_approval, still asking for something, or null), and `headline` — the §33 status line (BOQ imported, schedule imported, mapping %, unmapped BOQ quantity by unit, unmapped BOQ value, critical unmapped activities, baseline, cost loading), each entry a ProjectSetupHeadlineEntry. criticalUnmappedActivities (critical activities with no approved BOQ allocation, read off the mapping) is present only for a caller who may read the BOQ; anyone else gets criticalUnmappedWithheld true and criticalUnmappedReason \"Mapping details unavailable to you\" instead, and the critical_unmapped headline entry withheld. The critical activities themselves (steps[schedule_generation].counts.criticalActivities) are every caller's.",
        },
        gates: {
          ...ref("GenericObject"),
          description: "baseline (block), progress (warn) and reporting (block, PM override) — unchanged by the structure and approval steps, which are advisory.",
        },
        structure: ref("ProjectSetupStructure"),
        coverage: {
          ...ref("AllocationCoverageSummary"),
          description:
            "The §69 coverage totals as the coverage endpoint reports them, without the per-item rows. A caller who may not read the BOQ gets none of it — no coveragePct (rounded or not), no row counts, no value — only { withheld: true, reason: \"Mapping details unavailable to you\" }.",
        },
        context: {
          ...ref("GenericObject"),
          description:
            "workspace, currentRevision (schedule), boqRevision (revision, status, source, item count, value, `changes` from the upload comparison, `validation.blocked` rows each with code, description, reason (the machine code) and message (the sentence to show), `history` of workflow transitions with the actor named — the item count, `changes`, validation.blockedCount, value, blocked rows and history only for a caller who may read the BOQ; anyone else gets countsWithheld true, reason \"BOQ details unavailable to you\" and validation.blocked empty), boqBaseline (source schedule_baseline before boq_revision, as GET /boq names it), progressMethods, allocationSummary (only for a caller who may read the BOQ), scheduleReadiness (the schedule's own checks; the allocations check's BOQ value figures only for a caller who may read the BOQ).",
        },
        steps: arrayOf(ref("ProjectSetupStep")),
      },
      ["projectId", "rulesetVersion", "checkedAt", "summary", "gates", "structure", "coverage", "context", "steps"],
    ),
    ActivityBoqAllocationBulkMutation: objectSchema(
      { allocations: arrayOf(ref("ActivityBoqAllocationMutation")) },
      ["allocations"],
    ),
    ActivityBoqAllocationBulkResponse: objectSchema({
      createdCount: { type: "integer" },
      failedCount: { type: "integer" },
      created: arrayOf(ref("GenericObject")),
      failed: arrayOf(
        objectSchema({
          index: { type: "integer" },
          boqItemId: uuid,
          activityId: uuid,
          code: ref("ErrorCode"),
          message: { type: "string" },
          details: ref("GenericObject"),
        }),
      ),
    }),
    MappingImportReport: objectSchema({
      dryRun: { type: "boolean" },
      batchId: nullableUuid,
      rowCount: { type: "integer" },
      columns: arrayOf({ type: "string" }),
      summary: objectSchema({
        matched: { type: "integer" },
        unmatched: { type: "integer" },
        existing: { type: "integer" },
        breaches: { type: "integer" },
        notApplicable: { type: "integer" },
        invalid: { type: "integer" },
        created: { type: "integer" },
        failed: { type: "integer" },
        totalAmount: money,
      }),
      matched: arrayOf(ref("GenericObject")),
      unmatched: arrayOf(ref("GenericObject")),
      existing: arrayOf(ref("GenericObject")),
      breaches: arrayOf(ref("GenericObject")),
      notApplicable: arrayOf(ref("GenericObject")),
      invalid: arrayOf(ref("GenericObject")),
      created: arrayOf(ref("GenericObject")),
      failed: arrayOf(ref("GenericObject")),
      rowLimit: { type: "integer" },
    }),
    MappingImportUndoResponse: objectSchema({
      batchId: uuid,
      total: { type: "integer" },
      rejected: { type: "integer" },
      keptApproved: { type: "integer" },
      alreadyRejected: { type: "integer" },
      rejectedAllocations: arrayOf(objectSchema({ allocationId: uuid, fromStatus: { type: "string" } })),
      keptAllocations: arrayOf(objectSchema({ allocationId: uuid, status: { type: "string" } })),
    }),
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
        enum: [
          "imported",
          "comparison_only",
          "under_review",
          "approved",
          "baselined",
          "superseded",
        ],
      },
      baselineLocked: { type: "boolean" },
      lockedAt: nullableDateString,
      lockedBy: nullableUuid,
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
        unitWarnings: arrayOf(ref("UnitWarning")),
        mappingRuleWarnings: {
          ...arrayOf(ref("MappingRuleWarning")),
          description: "Rows the file marks not applicable that kept their rule because an approved allocation exists.",
        },
      },
      ["jobId", "revisionId", "mode", "baselineLocked", "document"],
    ),
    BoqUploadDryRunResponse: objectSchema(
      {
        dryRun: { type: "boolean", enum: [true] },
        mode: { type: "string", enum: ["imported", "comparison_only"] },
        baselineLocked: { type: "boolean" },
        baseline: ref("BoqBaselineState"),
        label: { type: "string", nullable: true },
        rowCount: { type: "integer", minimum: 0 },
        totalAmount: money,
        comparison: objectSchema({
          summary: ref("BoqRevisionComparisonSummary"),
          added: arrayOf(ref("GenericObject")),
          updated: arrayOf(ref("GenericObject")),
          removed: arrayOf(ref("GenericObject")),
          unchanged: arrayOf(ref("GenericObject")),
          blocked: arrayOf(ref("GenericObject")),
          rowLimit: { type: "integer" },
        }),
        unitWarnings: arrayOf(ref("UnitWarning")),
        mappingRules: ref("BoqUploadMappingRuleCounts"),
      },
      ["dryRun", "mode", "baselineLocked", "rowCount", "comparison"],
    ),
    BoqRevisionDetail: {
      allOf: [
        ref("BoqRevisionSummary"),
        objectSchema({
          source: { type: "string" },
          createdBy: nullableUuid,
          comparison: ref("GenericObject"),
          importedRows: arrayOf(ref("GenericObject")),
          workflowEvents: arrayOf(ref("GenericObject")),
        }),
      ],
    },
    BoqRevisionReviewRequest: objectSchema({
      comment: { type: "string", nullable: true, maxLength: 2000 },
    }),
    BoqBaselineLockResponse: objectSchema(
      {
        revision: ref("BoqRevisionSummary"),
        lockedRows: { type: "integer", minimum: 0 },
        baseline: ref("BoqBaselineState"),
      },
      ["revision", "lockedRows", "baseline"],
    ),
    ScheduleXlsxDryRunResponse: objectSchema(
      {
        dryRun: { type: "boolean", enum: [true] },
        staged: { type: "boolean", enum: [false] },
        source: { type: "string", enum: ["xlsx"] },
        activityCount: { type: "integer", minimum: 0 },
        dependencyCount: { type: "integer", minimum: 0 },
        wbsNodeCount: { type: "integer", minimum: 0 },
        criticalActivities: { type: "integer", minimum: 0 },
        issueCount: { type: "integer", minimum: 0 },
        issues: arrayOf(ref("GenericObject")),
        activities: arrayOf(ref("GenericObject")),
        dependencies: arrayOf(ref("GenericObject")),
        rowLimit: { type: "integer" },
        message: { type: "string" },
      },
      ["dryRun", "activityCount", "dependencyCount", "issues"],
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
    ExtraService: objectSchema(
      {
        id: { type: "string", format: "uuid", nullable: true },
        orgId: { type: "string", format: "uuid", nullable: true },
        label: { type: "string", maxLength: 80 },
        percentage: { type: "number", minimum: 0 },
        sortOrder: { type: "integer", minimum: 0, nullable: true },
      },
      ["label", "percentage"],
    ),
    ExtraServicesPayload: objectSchema(
      {
        services: {
          type: "array",
          maxItems: 20,
          items: objectSchema(
            {
              label: { type: "string", minLength: 1, maxLength: 80 },
              percentage: { type: "number", minimum: 0, maximum: 1000 },
            },
            ["label", "percentage"],
          ),
        },
      },
      ["services"],
    ),
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
    // Project-controls structure (PC-1): WBS nodes and units of measure.
    WbsNodeRecord: objectSchema({
      id: uuid,
      projectId: uuid,
      parentId: { type: "string", format: "uuid", nullable: true },
      code: { type: "string" },
      name: { type: "string" },
      path: {
        type: "string",
        description: "Materialized path of node ids from the root.",
      },
      pathNames: arrayOf({ type: "string" }),
      fullName: { type: "string" },
      depth: { type: "integer" },
      sortOrder: { type: "integer" },
      source: { type: "string", enum: ["manual", "import", "ai"] },
      externalId: {
        type: "string",
        nullable: true,
        description: "P6 wbs_id / MSP outline code the node was imported with.",
      },
      isPackage: {
        type: "boolean",
        description:
          "A work package: the scope one party delivers under one commitment. There is no separate package entity.",
      },
      ownerPartyId: { type: "string", format: "uuid", nullable: true },
      commitmentId: { type: "string", format: "uuid", nullable: true },
      status: { type: "string", enum: ["active", "archived"] },
      childCount: { type: "integer" },
      activityCount: { type: "integer" },
      boqItemCount: { type: "integer" },
      createdBy: { type: "string", nullable: true },
      updatedBy: { type: "string", nullable: true },
      archivedAt: nullableDateString,
      archivedBy: { type: "string", nullable: true },
      createdAt: nullableDateString,
      updatedAt: nullableDateString,
    }),
    WbsNodeTreeNode: {
      allOf: [
        ref("WbsNodeRecord"),
        objectSchema({ children: arrayOf(ref("GenericObject")) }),
      ],
    },
    WbsNodeListResponse: objectSchema({
      view: {
        type: "string",
        enum: ["outline"],
        description:
          "Present only for a caller admitted as a schedule reader who may not read the BOQ. Each node then carries only id, projectId, parentId, code, name, path, pathNames, fullName, depth, sortOrder, isPackage, status, archivedAt, childCount and activityCount (no boqItemCount, owner party, commitment, source or external id), and the summary has no linkedBoqItems. A BOQ reader's answer has no view key and is unchanged.",
      },
      items: arrayOf(ref("WbsNodeRecord")),
      tree: arrayOf(ref("WbsNodeTreeNode")),
      summary: objectSchema({
        total: { type: "integer" },
        active: { type: "integer" },
        archived: { type: "integer" },
        packages: { type: "integer" },
        roots: { type: "integer" },
        maxDepth: { type: "integer" },
        linkedActivities: { type: "integer" },
        linkedBoqItems: { type: "integer" },
      }),
    }),
    WbsNodeMutation: objectSchema({
      code: { type: "string", maxLength: 60 },
      name: { type: "string", maxLength: 160 },
      parentId: {
        type: "string",
        format: "uuid",
        nullable: true,
        description:
          "Moving a node rewrites the path and depth of its whole subtree.",
      },
      sortOrder: { type: "integer", minimum: 0, nullable: true },
      isPackage: { type: "boolean" },
      ownerPartyId: {
        type: "string",
        format: "uuid",
        nullable: true,
        description: "Must be a party on this project.",
      },
      commitmentId: {
        type: "string",
        format: "uuid",
        nullable: true,
        description: "Must be a commitment of this project.",
      },
      externalId: { type: "string", maxLength: 120, nullable: true },
    }),
    WbsNodeReasonPayload: objectSchema({
      reason: { type: "string", maxLength: 500, nullable: true },
    }),
    WbsNodeArchiveResponse: objectSchema({
      id: uuid,
      status: { type: "string", enum: ["archived"] },
      archived: { type: "boolean" },
      deleted: { type: "boolean" },
      affectedCount: { type: "integer" },
      affectedIds: arrayOf(uuid),
    }),
    UnitOfMeasureRecord: objectSchema({
      id: uuid,
      orgId: uuid,
      code: { type: "string" },
      name: { type: "string" },
      aliases: arrayOf({ type: "string" }),
      dimension: {
        type: "string",
        enum: ["length", "area", "volume", "mass", "time", "count", "money"],
      },
      isSystem: { type: "boolean" },
      status: { type: "string", enum: ["active", "archived"] },
      sortOrder: { type: "integer" },
      createdAt: nullableDateString,
      updatedAt: nullableDateString,
    }),
    UnitListResponse: objectSchema({
      items: arrayOf(ref("UnitOfMeasureRecord")),
      seeded: {
        type: "boolean",
        description:
          "False while the organisation has no unit rows yet; normalisation then answers from the default list, returned in `defaults`.",
      },
      defaults: arrayOf(ref("GenericObject")),
      summary: objectSchema({
        total: { type: "integer" },
        active: { type: "integer" },
        archived: { type: "integer" },
      }),
    }),
    UnitMutation: objectSchema(
      {
        code: { type: "string", maxLength: 16 },
        name: { type: "string", maxLength: 80, nullable: true },
        dimension: {
          type: "string",
          enum: ["length", "area", "volume", "mass", "time", "count", "money"],
          nullable: true,
        },
        aliases: arrayOf({ type: "string", maxLength: 40 }),
      },
      ["code"],
    ),
    UnitWarning: objectSchema({
      code: { type: "string", enum: ["UNIT_UNRECOGNISED"] },
      unit: { type: "string", description: "The unit exactly as typed; never rewritten." },
      message: { type: "string" },
      count: { type: "integer", nullable: true },
      rows: arrayOf({ type: "integer" }),
    }),
    UnitNormaliseResponse: objectSchema({
      unit: { type: "string", nullable: true },
      unitCode: {
        type: "string",
        nullable: true,
        description: "The organisation's unit code the spelling resolves to, or null.",
      },
      warning: { allOf: [ref("UnitWarning")], nullable: true },
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
      payload: freeObject(
        "Job input; never contains secrets. A schedule.generate job's input carries the uploaded bill as rawText, which is left out for a caller who may not read the BOQ (see payloadWithheld).",
      ),
      payloadWithheld: objectSchema({
        keys: arrayOf({ type: "string" }),
        reason: { type: "string" },
      }),
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
    /** Who to put on the project, and optionally what they do here. */
    ProjectMemberRequest: objectSchema(
      {
        userId: { type: "string", format: "uuid" },
        role: {
          type: "string",
          nullable: true,
          enum: [
            "pm",
            "planning_eng",
            "qs",
            "cost_controller",
            "procurement",
            "warehouse",
            "site_engineer",
            "finance",
          ],
          description:
            "What they do on this project. Defaults to the role they carry in the organisation.",
        },
      },
      ["userId"],
    ),
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
        enum: ["attachment", "evidence", "photo", "reference", "signature"],
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
      notNotified: {
        ...ref("CommentNotNotified"),
        description:
          "Only on a create or edit answer, and only when someone mentioned was not notified: a comment on a BOQ record (boq_item) notifies only people who may read the BOQ on the project. The comment and its mentions are saved either way.",
      },
    }),
    CommentNotNotified: objectSchema(
      {
        reason: { type: "string", enum: ["NO_BOQ_ACCESS"], description: "Why they were not notified: they may not read the BOQ on this project." },
        people: arrayOf(objectSchema({ userId: uuid, name: { type: "string" } }, ["userId", "name"])),
        message: { type: "string", description: 'For the author, e.g. "Saved. Not notified (no BOQ access): Jane Doe, Omar Ali." Names only: no figure, no record detail.' },
      },
      ["reason", "people", "message"],
    ),
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
      prequalification: nullableRef("PrequalState"),
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
        qualified: { type: "integer" },
        trades: arrayOf(objectSchema({ trade: { type: "string" }, count: { type: "integer" } })),
      }),
    }),
    VendorDuplicateReport: objectSchema({
      duplicates: arrayOf(
        objectSchema({
          nameKey: { type: "string", description: "The folded name the group shares." },
          keepSuggestion: uuid,
          companies: arrayOf(
            objectSchema({
              id: uuid,
              name: { type: "string" },
              isVendor: { type: "boolean" },
              status: { type: "string" },
              prequalification: { type: "string", nullable: true },
              commitments: { type: "integer" },
              evaluations: { type: "integer" },
              projects: { type: "integer" },
              suppliers: { type: "integer" },
              members: { type: "integer" },
              createdAt: nullableDateString,
            }),
          ),
        }),
      ),
      summary: objectSchema({
        companies: { type: "integer" },
        groups: { type: "integer" },
        affected: { type: "integer" },
      }),
      note: { type: "string" },
    }),
    PrequalState: objectSchema({
      status: {
        type: "string",
        enum: ["not_assessed", "draft", "under_review", "approved", "conditionally_approved", "rejected", "expired"],
        description: "\"expired\" is derived from the validity date and from criteria that carry their own expiry — it is never stored.",
      },
      qualified: { type: "boolean", description: "Approved or conditionally approved, and not lapsed." },
      score: { type: "number", nullable: true, description: "Weighted score out of 100 over the criteria actually scored." },
      validUntil: nullableDateString,
      expiresAt: { ...nullableDateString, description: "The earlier of the validity date and any criterion expiry." },
      expiresBecause: { type: "string", nullable: true, description: "The criterion that brings the expiry forward, if any." },
      singleAwardLimit: { type: "number", nullable: true },
      conditions: { type: "string", nullable: true },
    }),
    PrequalCriterion: objectSchema({
      id: uuid,
      key: { type: "string" },
      label: { type: "string" },
      category: { type: "string", enum: ["commercial", "hse", "capability", "compliance", "quality"] },
      weight: { type: "integer", description: "Weights across the nine criteria sum to 100." },
      maxScore: { type: "integer" },
      score: { type: "integer", nullable: true },
      required: { type: "boolean" },
      tracksExpiry: { type: "boolean", description: "Cover and licences lapse; a track record does not." },
      reference: { type: "string", nullable: true },
      expiresAt: nullableDateString,
      expired: { type: "boolean" },
      note: { type: "string", nullable: true },
      hint: { type: "string", nullable: true },
      sortOrder: { type: "integer" },
    }),
    VendorPrequalification: objectSchema({
      id: uuid,
      companyId: uuid,
      company: objectSchema({ id: uuid, name: { type: "string" }, trades: arrayOf({ type: "string" }) }),
      status: { type: "string", enum: ["draft", "under_review", "approved", "conditionally_approved", "rejected"] },
      effectiveStatus: { type: "string", description: "The stored status, or \"expired\" once it has lapsed." },
      qualified: { type: "boolean" },
      score: { type: "number", nullable: true },
      scoredCriteria: { type: "integer" },
      weightAssessed: { type: "integer" },
      band: { type: "string", nullable: true },
      recommendation: { type: "string", nullable: true, description: "What the score suggests now." },
      storedRecommendation: { type: "string", nullable: true, description: "What the score suggested when the decision was taken." },
      decisionAgainstScore: { type: "boolean", description: "True when the decision went against the score's recommendation." },
      validUntil: nullableDateString,
      expiresAt: nullableDateString,
      expiresBecause: { type: "string", nullable: true },
      expired: { type: "boolean" },
      singleAwardLimit: { type: "number", nullable: true },
      conditions: { type: "string", nullable: true },
      decisionNote: { type: "string", nullable: true },
      submittedAt: nullableDateString,
      decidedAt: nullableDateString,
      decidedBy: { type: "string", nullable: true },
      gaps: arrayOf({ type: "string", description: "What is stopping a decision being recorded, named rather than counted." }),
      performance: ref("VendorPerformanceHistory"),
      criteria: arrayOf(ref("PrequalCriterion")),
      createdAt: nullableDateString,
      updatedAt: nullableDateString,
    }),
    PrequalOverview: objectSchema({
      items: arrayOf(
        objectSchema({
          companyId: uuid,
          name: { type: "string" },
          trades: arrayOf({ type: "string" }),
          status: { type: "string" },
          qualified: { type: "boolean" },
          score: { type: "number", nullable: true },
          validUntil: nullableDateString,
          expiresAt: nullableDateString,
          expiresBecause: { type: "string", nullable: true },
          expiringSoon: { type: "boolean" },
          singleAwardLimit: { type: "number", nullable: true },
          gaps: arrayOf({ type: "string" }),
        }),
      ),
      summary: objectSchema({
        vendors: { type: "integer" },
        qualified: { type: "integer" },
        notAssessed: { type: "integer" },
        underReview: { type: "integer" },
        expired: { type: "integer" },
        rejected: { type: "integer" },
        expiringSoon: { type: "integer" },
      }),
    }),
    VendorPerformanceHistory: objectSchema({
      evaluations: { type: "integer", description: "Finalised evaluations only." },
      score: { type: "number", nullable: true, description: "Average across them, out of 100." },
      wouldReuse: objectSchema({ yes: { type: "integer" }, of: { type: "integer" } }),
      lastEvaluatedAt: nullableDateString,
    }),
    VendorPerformance: objectSchema({
      items: arrayOf(
        objectSchema({
          id: uuid,
          status: { type: "string", enum: ["draft", "final"] },
          score: { type: "number", nullable: true },
          wouldReuse: { type: "boolean", nullable: true },
          summary: { type: "string", nullable: true },
          evaluatedAt: nullableDateString,
          commitment: objectSchema({ id: uuid, ref: { type: "string" }, title: { type: "string" } }),
          project: objectSchema({ id: uuid, name: { type: "string" } }),
        }),
      ),
      history: ref("VendorPerformanceHistory"),
    }),
    PrequalCriterionRequest: objectSchema({
      score: { type: "integer", minimum: 0, maximum: 5, nullable: true },
      note: { type: "string", nullable: true },
      reference: { type: "string", nullable: true },
      expiresAt: { type: "string", format: "date-time", nullable: true },
    }),
    PrequalDecisionRequest: objectSchema({
      status: { type: "string", enum: ["approved", "conditionally_approved", "rejected"] },
      validUntil: { type: "string", format: "date-time", nullable: true },
      conditions: { type: "string", nullable: true },
      decisionNote: { type: "string", nullable: true },
      singleAwardLimit: { type: "number", nullable: true },
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
      budget: boqFigure(money, "The activity budget: on GET /schedule, the approved BOQ allocation value; on the activity endpoints, the stored activity budget. Per activity and read off the mapping, so withheld from a cost reader without boq:read too (owner decision E1, 2026-09-28)."),
      generatedBudget: boqFigure(money, "The budget the generator or the import gave the activity (GET /schedule); withheld like budget."),
      allocatedBoqQuantity: boqFigure(nonNegativeNumber, "Approved BOQ allocation quantity."),
      allocatedBoqAmount: boqFigure(money, "Approved BOQ allocation value."),
      allocatedBoqWeight: boqFigure(nonNegativeNumber, "Approved BOQ allocation weight (% of the bill)."),
      approvedAllocationCount: boqFigure(
        { type: "integer", minimum: 0 },
        "How many approved BOQ allocations the activity has (its mapping badge).",
      ),
      mintedByBoqItemId: boqFigure(
        { ...uuid, nullable: true },
        "On GET /schedule: the BOQ row that created the activity (POST /boq/items with an activityName creates the activity and allocates the row to it), or null for an activity made any other way. A per-activity link to the bill.",
      ),
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
      revision: {
        ...ref("GenericObject"),
        description:
          "The schedule revision. unallocatedBoqAmount, and the BOQ value figures in readiness.checks[].details (totalBoqAmount, allocatableBoqAmount, approvedAllocatedAmount, pendingAllocatedAmount, unallocatedAmount, optionalUnallocatedAmount, notApplicableAmount), are present only for a caller who may read the BOQ, and so are the generator's per-activity and per-WBS-node budgets (snapshotJson.activities[].budget, wbs[].budget); the project totals totalBudget, generatedTotalBudget and projectSummary.totalBudget only for a caller who may read the BOQ or the cost module. Check keys, verdicts, messages, ready and blockingCount are the same for every caller.",
      },
      candidateRevision: {
        ...ref("GenericObject"),
        nullable: true,
        description:
          "A newer revision staged beside the active one (imported or generated after it, not activated; the latest candidate the lifecycle accepts), with its own readiness judged on its snapshot, so it can be submitted, approved, rejected or activated where it is seen. null when there is none or no revision is active. Its figures are withheld as the revision's are.",
      },
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
        cutoffDate: {
          ...dateString,
          description:
            "The period's cutoff date (defaults to periodEnd). A calendar date (YYYY-MM-DD) is that date; a date-time names the date it falls on in the project's reporting time zone. What is kept is that reporting date, exactly as entered; it never moves when a time zone changes later. The cutoff instant is the END of that date in Project.timezone, else the organisation's defaultTimezone, else UTC — computed for that date from the zone's own rules, daylight saving included, never a fixed offset — whenever the period is read or locked, and PV, EV and AC are all selected against it. Responses give that computed instant as cutoffDate with cutoffLocalDate, timeZone, timeZoneSource and timeZoneNote, never the stored value.",
        },
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
        eacBasis: {
          type: "string",
          enum: ["budget_over_cpi", "budget_cpi_zero", "budget_no_cost_performance", "no_budget"],
          description:
            "Which rule gave eac (the formula is unchanged): budget_over_cpi = revised BAC / CPI (CPI > 0); budget_cpi_zero = the revised BAC, because CPI is 0 (actual cost recorded, nothing earned, so BAC / CPI cannot be computed); budget_no_cost_performance = the revised BAC, because there is no CPI (no official actual cost through the cutoff); no_budget = no revised BAC. A locked snapshot's basis is read from its stored figures. Not money: every reader of the report receives it.",
        },
        sv: signedMoney,
        cv: signedMoney,
        etc: signedMoney,
        reporting: {
          ...ref("GenericObject"),
          description:
            "cutoffDate is the one cutoff PV (approved cost loading whose plannedDate calendar date is on or before cutoffLocalDate), EV (progress approved on or before the cutoffDate instant) and AC (cost records whose actualThroughDate calendar date is on or before cutoffLocalDate) are selected against. plannedDate and actualThroughDate are calendar dates (a date input stores them at 00:00 UTC of the date; the date is the UTC calendar date of the stored value), so a row dated the day after the cutoff date never counts, in any zone; real instants (approvedAt, budget-revision effectiveDate) compare with the cutoffDate instant. The cutoffDate instant is the end of cutoffLocalDate (YYYY-MM-DD) in timeZone (IANA), whose timeZoneSource says where the zone came from — project (Project.timezone), organisation (Organisation.defaultTimezone) or utc. The instant is computed for that date from the zone's own rules, daylight saving included (for America/Chicago a date in CDT ends at 04:59:59.999Z the next day, a date in CST at 05:59:59.999Z), never a fixed offset. timeZoneNote is null when the project's own zone applied, otherwise the sentence to show beside the cutoff: \"Project timezone is not configured; UTC is being used\" or \"Project timezone is not configured; the organisation default <zone> is being used\" (also appended to basisWarnings). sourceSummary.pv/ev/ac.selectedThrough state the cutoff instant each figure is reported through — the same one. When the cutoffDate instant is still in the future, basisWarnings says so: EV and AC are measured through today while PV runs to the cutoff. A locked period answers with its stored snapshot (isSnapshot true), never recomputed; its cutoffDate, zone and note are those recorded at the lock, and a snapshot stored before the zone was recorded carries no timeZone. An open period may move when records fall between an earlier cutoff and this one.",
        },
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
        sCurve: {
          ...arrayOf(ref("GenericObject")),
          description:
            "Monthly rows { label, pv, ev }: pv is the approved cost loading planned through the month's last date. ev is given only in the month of this report's cutoff date, with evMeasuredAt (the cutoff instant) and pvAtCutoff (the PV through that same instant); every other month's ev is null — EV is measured at a cutoff, and each locked period's snapshot holds its own. A snapshot locked before this rule keeps its stored series (sCurveNote says so).",
        },
        sCurveNote: {
          type: "string",
          description: "What the sCurve's EV points are; for a snapshot stored before EV was given only at the cutoff, that its earlier months repeat the cutoff's EV and are not a measured history.",
        },
        activityBreakdown: {
          ...arrayOf(ref("EarnedValueActivityBreakdown")),
          description: "The twenty activities with the largest approved allocation, by size. Present only for a caller who may read the BOQ (owner decision E1, 2026-09-28); omitted for anyone else, with activityBreakdownWithheld and activityBreakdownReason.",
        },
        activityBreakdownWithheld: { type: "boolean", enum: [true], description: "Present (true) when activityBreakdown is withheld from this caller." },
        activityBreakdownReason: { type: "string", description: "Why activityBreakdown is withheld: \"Mapping details unavailable to you\"." },
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
        subcontractor: {
          type: "string",
          description:
            "Free-text subcontractor name. Historical only: creation is retired, and on update this field is immutable (409 SUB_VALUATION_NAME_IMMUTABLE). Use `companyId` to attribute the valuation to a real company.",
        },
        companyId: {
          ...nullableUuid,
          description:
            "The company this legacy valuation is attributed to. Set one row at a time, from the attribution report — names are never matched automatically.",
        },
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
        warehouseId: {
          ...nullableUuid,
          description:
            "The warehouse the delivery went into. Omit it and the project's own warehouse is used when it has exactly one, otherwise the single central warehouse; when neither is unambiguous the receipt is refused with WAREHOUSE_REQUIRED_FOR_RECEIPT rather than recording a delivery that creates no stock. Replaces the free-text warehouseLocation, which is still readable on historical receipts but no longer written.",
        },
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
      "Creates a new personal workspace (ENT-6: kind personal, the individual plan, one member — the caller, its owner and administrator — plus guests; optional currency and timezone set its project defaults) and a server-side refresh session, sets it as an httpOnly cookie, and returns a short-lived access token. Self-service registration can be closed (it is closed in production unless PUBLIC_REGISTRATION=true); GET /config/public reports which. When closed, a well-formed request is refused with 403 REGISTRATION_CLOSED before any account lookup, so the answer never reveals whether an email is registered; a malformed body still gets 400 VALIDATION_ERROR first, because field validation runs ahead of the gate and its errors describe only the request.",
    operationId: "register",
    security: false,
    requestBody: jsonBody(ref("AuthRegisterRequest"), "Registration payload."),
    responses: {
      201: authSessionResponse("Registered and authenticated."),
    },
    status: 201,
  }),
);
paths["/auth/register"].post.responses[403] = errorResponse(
  "REGISTRATION_CLOSED: self-service registration is closed on this deployment; organisations join by invitation.",
);

add(
  "/auth/login",
  "post",
  operation({
    tag: "Auth",
    summary: "Exchange email and password for an access token.",
    description:
      "Creates a server-side refresh session, sets it as an httpOnly cookie, and returns a short-lived access token bound to the identity's workspace membership. An identity with exactly one active workspace (every existing user) gets the session directly; one with several gets { chooseWorkspace: true, identityToken, memberships } and picks with POST /auth/workspaces/{orgId}/session; one with none gets { needsWorkspace: true, identityToken, memberships: [] }. A second factor, when enrolled, is challenged first ({ mfaRequired: true, mfaToken }).",
    operationId: "login",
    security: false,
    requestBody: jsonBody(ref("AuthLoginRequest"), "Login credentials."),
    responses: {
      200: authSessionResponse("Authenticated, a second-factor challenge, or a workspace choice.", {
        oneOf: [ref("AuthTokenResponse"), ref("AuthWorkspaceChoiceResponse"), ref("GenericObject")],
      }),
    },
  }),
);

add(
  "/auth/workspaces/{orgId}/session",
  "post",
  operation({
    tag: "Auth",
    summary: "Enter a workspace: a new session bound to the caller's membership in it.",
    description:
      "Takes any valid access token (bound to whichever workspace) or the identity token a sign-in returns when the identity has several workspaces, and answers with a fresh access + refresh pair bound to the caller's active membership in {orgId}, on the caller's channel (refresh cookie for browsers, body for X-OctaPM-Client: mobile). The target workspace's SSO-only policy is evaluated (403 SSO_REQUIRED for a non-admin on an SSO-only domain); its MFA policy is reported as user.mfaEnrollmentRequired. Nothing is revoked: the other workspace's session stays valid so the person can switch back. 404 WORKSPACE_NOT_FOUND when the identity is not a member; 403 USER_INACTIVE when its membership there is suspended. Recorded as workspace.switched and session.workspace_issued.",
    operationId: "issueWorkspaceSession",
    security: true,
    permissions: { ...authenticatedOnly, note: "Any valid access token (bound to whichever workspace) or the identity token a sign-in returns, for the same identity; API keys are refused." },
    parameters: [pathParam("orgId", "Organisation (workspace) UUID.")],
    responses: {
      200: authSessionResponse("Session issued for the workspace.", ref("AuthWorkspaceSessionResponse")),
    },
  }),
);

add(
  "/auth/workspaces/resolve",
  "get",
  operation({
    tag: "Auth",
    summary: "Which of the caller's workspaces owns a project, for a legacy /projects/:id link.",
    description:
      "Links minted before workspace-prefixed URLs name a project and no workspace. The web client asks here which of the identity's own workspaces owns the project, so it can open the link under /o/{segment}/projects/… or offer a switch when that workspace is not the one the session is bound to (workspace switching doc §5, deep-link rule §108). Any token of the identity is accepted, including the identity token a sign-in with several workspaces returns. A project of an organisation the identity does not belong to answers 404 PROJECT_NOT_FOUND, the same as a project that does not exist; whether the member may open the project is the project route's question.",
    operationId: "resolveProjectWorkspace",
    security: true,
    permissions: { ...authenticatedOnly, note: "Any valid access token (bound to whichever workspace) or the identity token a sign-in returns; the answer is drawn only from the caller's own memberships." },
    parameters: [queryParam("projectId", "Project UUID from the legacy link.", uuid, { required: true })],
    responseSchema: ref("AuthWorkspaceResolveResponse"),
  }),
);

// ENT-6 personal workspaces and conversion
add(
  "/organisations",
  "post",
  operation({
    tag: "Workspaces",
    summary: "Create a company workspace for the signed-in identity.",
    description:
      "Sign-up makes a personal workspace (one member — its owner — plus guests, on the individual plan); this makes a further, company workspace with the caller as its owner and administrator, fully provisioned: an owner membership, a subscription, the twelve system permission templates and the default units of measure, plus the project defaults (currency, default USD; time zone, default none) the caller names — 400 VALIDATION_ERROR for a currency that is not ISO 4217 or a zone that is not IANA. Everything is written in one transaction: a failure after the organisation row leaves no workspace behind. Any active identity may create one. The answer carries the new membership so the client can enter it with POST /auth/workspaces/{orgId}/session; the caller's current session is untouched. Recorded as workspace.created. API keys are refused (403 API_KEY_FORBIDDEN).",
    operationId: "createOrganisation",
    permissions: { ...authenticatedOnly, note: "Any active workspace-bound session; the new workspace is the caller's own. API keys are refused." },
    requestBody: jsonBody(ref("OrganisationCreateRequest"), "The workspace's name."),
    responseSchema: ref("OrganisationWorkspaceResponse"),
    status: 201,
  }),
);

add(
  "/organisations/{id}/convert",
  "post",
  operation({
    tag: "Workspaces",
    summary: "Convert a personal workspace to a company workspace.",
    description:
      "By the workspace's owner, for the workspace the token is bound to. The kind becomes company, the plan label becomes the company one, and the name changes when a new one is given; the URL handle is kept. Nothing else changes: every project, record and figure already carries this workspace's id, no row moves or is re-keyed, ledger and budget rows are untouched, the owner stays owner, and the workspace can then invite people (a personal workspace refuses a second member with 409 PERSONAL_WORKSPACE_CONVERT_REQUIRED). 403 OWNER_REQUIRED for a member who is not an owner; 404 WORKSPACE_NOT_FOUND when {id} is not the session's workspace; 409 WORKSPACE_ALREADY_COMPANY for a company workspace. Recorded as workspace.converted.",
    operationId: "convertOrganisation",
    permissions: { ...authenticatedOnly, note: "The owner of the workspace the session is bound to (membership isOwner)." },
    parameters: [pathParam("id", "Organisation (workspace) UUID — the session's own.")],
    requestBody: jsonBody(ref("OrganisationConvertRequest"), "An optional new name.", false),
    responseSchema: ref("OrganisationWorkspaceResponse"),
  }),
);

add(
  "/auth/forgot-password",
  "post",
  operation({
    tag: "Auth",
    summary: "Request a password reset email.",
    description:
      "Always returns a neutral success payload. When the email belongs to an active user, a hashed one-time reset token is stored and a reset link is sent by the configured email provider. A delivery failure is recorded in the auth audit trail (password_reset_delivery_failed) and still answers the same neutral payload, so the response never reveals whether an address is registered.",
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
      "Creates a user and their membership, or gives an existing identity a membership in the inviting workspace — an identity that already exists in another workspace is welcome, keeps its name and password, and gets a second workspace (a party invitation makes a guest membership). An existing identity must prove it is the invitee: an Authorization bearer for that identity (an access or identity token) on this request, or the account password in the body; otherwise 401 INVITATION_SIGN_IN_REQUIRED. An identity its own workspace deactivated can be reopened only by a re-invitation from that workspace (403 USER_INACTIVE from any other). An identity already an active member here keeps its workspace role; the invitation assigns the project. Assigns the invitation role/project, marks the token accepted, audits the event, and issues the normal refresh cookie plus access token response, bound to the invited workspace.",
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
    description:
      "The identity as the active workspace sees it (orgId, role and isCompanyAdmin are the membership's), plus memberships[] — every workspace the identity belongs to — and active { orgId, membershipId }. Also answers an identity token (the only route that does besides the workspace session issue): then active is null and the workspace fields describe the identity's own organisation.",
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
  "/companies/{companyId}",
  "patch",
  operation({
    tag: "Companies",
    summary: "Edit a managed company (Phase 22B).",
    description:
      "Every field is optional. The parties, bids, commitments and invoices that name the company keep their link; a name that another company already carries is refused with COMPANY_EXISTS.",
    operationId: "updateCompany",
    parameters: [pathParam("companyId", "Company id.")],
    permissions: modulePermission("project_parties", "update"),
    requestBody: jsonBody(ref("CompanyMutation"), "Fields to change."),
    responseSchema: ref("Company"),
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

// Owner decision D4: the one default EV basis every default reader uses.
const DEFAULT_EV_PERIOD =
  " With no period chosen, the earned-value basis is the latest reporting period whose cutoff instant has passed (cutoff <= now); a period whose cutoff is still ahead is never the default but can be requested by periodId (its report then notes that the cutoff has not been reached). With no such period, the basis is an ad hoc report cut at the end of today in the project's reporting time zone.";

add(
  "/projects/workspace-dashboard",
  "get",
  operation({
    tag: "Projects",
    summary: "Get workspace-level construction health and workflow queues.",
    description:
      "Aggregates all organization projects for PM users and only assigned projects for non-PM users. Returns officialKpis with sourceRule, sourceStatus, cutoffDate, and drill-through targets. Draft/rejected/cancelled records are excluded from official KPI cards; submitted/pending workflow values are returned separately under pendingReview. Each projectHealth row carries bac (the official EV budget: the approved BOQ allocations), eac (bac / CPI), ev (approved allocations × % complete), pv (approved cost loading) and ac (the cost ledger's official actuals) only for a caller who may read the BOQ or the cost module on that project, decided as that project's own routes decide it (permission template, role, party); otherwise those keys are absent, not zero. The IPC queue (workflowQueues ipcActions, pendingReview ipcActions, each project's workflowActions) counts and lists a project's certificates only for a caller who may read its IPC (ipc:read, as GET /projects/{projectId}/ipc), and its certificate lines (target.source ipc_item: one per approved BOQ allocation, valued off the row) only for one who may also read its BOQ, as GET /projects/{projectId}/ipc/{period} withholds them; for anyone else those items are absent and not counted. Scores, spi and cpi are the same for every caller. dataFreshness.cutoffDate is the official cutoff: the latest EV cutoff among the projects' EV reports (each on its default basis), never a project data date — the answer's own time only when no project has an EV report; when it is a project's EV cutoff, dataFreshness also states cutoffLocalDate, cutoffTimeZone, cutoffTimeZoneSource and cutoffTimeZoneNote (null when that project's own zone applied, otherwise \"Project timezone is not configured; UTC is being used\" or the organisation default it names) — otherwise those are null." + DEFAULT_EV_PERIOD,
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
    description:
      "The §89 setup sequence as twelve steps — profile, structure, BOQ upload, BOQ approval, schedule, allocation, cost loading, engineers, progress methods, schedule approval, baseline, progress — each with its blockers and warnings and, on every issue, the offending records (`items`, capped at 50, `count` the whole number) with a link to fix each one. The three gates keep their shape and meaning; the structure and approval steps are advisory. `structure` counts the project's WBS nodes, locations, cost codes and unresolved units; `coverage` is the allocation coverage summary (never recomputed here). Owner decision D5, the greenfield order — upload and approve the BOQ, import or generate a schedule, submit, approve, activate, map the bill's value to the active activities, lock the baseline: while a staged revision is not yet active, the allocation step's ALLOCATION_WAITING_FOR_SCHEDULE blocker names the revision step still missing (its review and approval, or its activation) and the step's action opens Schedule › Revisions; after the activation, unallocated coverage blocks the baseline step (SCHEDULE_ALLOCATIONS_FAILED, whose message names Project Controls › Mapping), whose action then opens the mapping. The schedule approval step never waits on allocations.",
    operationId: "getProjectSetupReadiness",
    parameters: projectParams,
    responseSchema: ref("ProjectSetupReadiness"),
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
  "/projects/{projectId}/procurement/packages/{packageId}/quotes",
  "post",
  operation({
    tag: "Procurement",
    summary: "Ask suppliers to price a procurement package.",
    description:
      "Opens a quote enquiry for the package. Underneath it is the bid engine — the same machinery that levels and awards subcontract bids, which already understands a purchase order as the thing being awarded — so this creates a BidPackage with commitmentType purchase_order, linked back to the procurement package, taking its title, currency and due date from what the buyer has already stated. The buyer does not choose a commitment type or go to Commercial to start it.",
    operationId: "requestProcurementQuotes",
    parameters: [...projectParams, pathParam("packageId", "Procurement package id")],
    permissions: rolesPermission("pm", "procurement", "qs"),
    requestBody: jsonBody(ref("ProcurementQuoteRequest"), "Optional overrides; everything else is inherited.", false),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/procurement/packages/{packageId}/quotes",
  "get",
  operation({
    tag: "Procurement",
    summary: "The quote enquiries raised for a procurement package.",
    operationId: "listProcurementQuotes",
    parameters: [...projectParams, pathParam("packageId", "Procurement package id")],
    permissions: rolesPermission("pm", "procurement", "qs"),
  }),
);

add(
  "/projects/{projectId}/procurement/packages/{packageId}/order",
  "post",
  operation({
    tag: "Procurement",
    summary: "Raise the purchase order for an awarded package.",
    description:
      "Creates the order for whatever quote was awarded against this package, taking every field from what is already recorded: the supplier from the winning bid, the description, unit and quantity from the priced package lines, the unit cost from the rate that supplier quoted, the activity from the package line, and the needed-on-site date and lead time from the package. The reference is issued by the project unless one is supplied. Only the reference, required date, lead weeks and notes may be overridden here — everything else would be a difference between the order and the award, which is what the three-way match later has to compare against. Refused with PROCUREMENT_NO_AWARD until a quote has been awarded, and with PROCUREMENT_AWARD_NOT_SCHEDULE_LINKED if none of the awarded lines carry an activity.",
    operationId: "raiseProcurementOrderFromAward",
    parameters: [...projectParams, pathParam("packageId", "Procurement package id")],
    permissions: rolesPermission("pm", "procurement"),
    requestBody: jsonBody(
      ref("ProcurementOrderFromAward"),
      "Optional overrides; everything else is inherited from the award.",
      false,
    ),
    status: 201,
  }),
);

add(
  "/projects/{projectId}/boq/shadow-activities",
  "get",
  operation({
    tag: "BOQ",
    summary: "Report activities that look like a shadow of the real programme.",
    description:
      "Lists activities carrying BOQ allocations that have no duration and no logic, on a project whose other activities have both — the trace a BOQ row leaves when it mints its own activity beside an existing programme. Each is reported as POTENTIAL_SHADOW_ACTIVITY, with any same-named activities alongside it. Read-only: nothing is merged or moved, because deciding two activities are the same piece of work is a judgement about the job and acting on it would move financial history.",
    operationId: "getBoqShadowActivities",
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
      "Scans and type-checks the workbook, stores the original upload as private project document metadata, creates a BOQ revision, and compares it with current active BOQ rows. Unlocked projects import changed/new rows without deleting omitted rows. Baseline-locked projects save a comparison-only revision and do not mutate current BOQ rows, allocations, progress, IPC, or reporting basis. With dryRun=true the workbook is parsed and compared and the comparison is returned (BoqUploadDryRunResponse) without storing a document, a revision, any rows or a job; a dry run counts against the upload rate limit but not the AI generation limit.",
    operationId: "uploadBoq",
    parameters: [
      ...projectParams,
      queryParam(
        "dryRun",
        "Parse and compare only; nothing is written.",
        { type: "boolean", default: false },
      ),
    ],
    permissions: rolesPermission("pm", "planning_eng", "qs"),
    requestBody: fileUploadBody({
      description:
        "Excel BOQ upload. Files with more than 60 items are chunked by section.",
      accepted: ".xlsx or .xls workbook, maximum 50 MB.",
      extraProperties: { label: { type: "string" } },
    }),
    responseSchema: {
      oneOf: [ref("BoqUploadResponse"), ref("BoqUploadDryRunResponse")],
    },
  }),
);

add(
  "/projects/{projectId}/boq/revisions/{revisionId}",
  "get",
  operation({
    tag: "BOQ",
    summary: "Get one BOQ revision with its comparison and review history.",
    operationId: "getBoqRevision",
    parameters: [...projectParams, pathParam("revisionId", "BOQ revision UUID.")],
    permissions: modulePermission("boq", "read"),
    responseSchema: ref("BoqRevisionDetail"),
  }),
);

[
  [
    "submit",
    "submitBoqRevision",
    "Submit an imported BOQ revision for review.",
    "The revision moves from imported to under_review. Only the current revision — the newest whose rows were applied to the BOQ — can be reviewed; an older one is refused with BOQ_REVISION_NOT_CURRENT. A comparison-only revision (saved while the baseline was locked) cannot be reviewed: its rows are not on the current BOQ.",
    "submit",
    ref("BoqRevisionSummary"),
  ],
  [
    "approve",
    "approveBoqRevision",
    "Approve a BOQ revision under review.",
    "The revision moves from under_review to approved. Approval signs off the rows already on the current BOQ; it does not change them. Only the current revision can be approved (BOQ_REVISION_NOT_CURRENT otherwise).",
    "approve",
    ref("BoqRevisionSummary"),
  ],
  [
    "lock",
    "lockBoqBaseline",
    "Lock the BOQ baseline on an approved revision.",
    "Writes the explicit lock (baselineLocked, lockedBy, lockedAt, status baselined) beside the derived rule that a baselined schedule locks the BOQ; either one makes the BOQ locked. Only the current revision can be locked (BOQ_REVISION_NOT_CURRENT otherwise); the earlier applied revisions, whose rows it replaced, become superseded. Once locked, rows cannot be edited, later uploads are saved as comparison-only revisions, and a second lock is refused with BOQ_BASELINE_LOCKED. There is no unlock, as there is none for a schedule baseline.",
    "approve",
    ref("BoqBaselineLockResponse"),
  ],
].forEach(([suffix, operationId, summary, description, action, responseSchema]) => {
  add(
    `/projects/{projectId}/boq/revisions/{revisionId}/${suffix}`,
    "post",
    operation({
      tag: "BOQ",
      summary,
      description,
      operationId,
      parameters: [
        ...projectParams,
        pathParam("revisionId", "BOQ revision UUID."),
      ],
      permissions: modulePermission("boq", action),
      requestBody: jsonBody(
        ref("BoqRevisionReviewRequest"),
        "Optional review comment.",
        false,
      ),
      responseSchema,
    }),
  );
});

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
  "/projects/{projectId}/boq/items/{id}/detail",
  "get",
  operation({
    tag: "BOQ",
    summary: "BOQ item detail: the row's story across the modules (PC-5).",
    description:
      "Composed read-only from the services that own each figure: structure (WBS, location, cost code), mapping and linked activities (dates, critical flag, float, approved progress, authorised quantity per allocation — the schedule fields only for a schedule reader: anyone else gets each activity's id, code and name, href null and schedule: { allowed: false, module: \"schedule\", reason }), quantities (original from the baseline-locked revision, current, authorised = current + approved change-order allocation-link quantity by the IPC certification cap's rule, mapped, unallocated; installed, paid and forecast are not available yet and name their wave), money (rate, amount, approved allocation, EV derived as of now — not the official reporting-cutoff EV), certification (ipc:read), commitments (commitment:read; SOV lines on executed/closed commitments, excluding variations), changes (change_order:read), procurement (procurement:read; order values, not committed cost), PC-4 readiness flags (a row beyond a capped list is reported as not itemised, never as clean), history (audit:read) and documents. A section the viewer may not read is { allowed: false, module, reason }. Another organisation's item, or a missing one, is 404 BOQ_ITEM_NOT_FOUND.",
    operationId: "getBoqItemDetail",
    parameters: projectRecordParams,
    permissions: modulePermission("boq", "read"),
    responseSchema: ref("ControlsDetail"),
  }),
);

add(
  "/projects/{projectId}/boq/items/{id}",
  "patch",
  operation({
    tag: "BOQ",
    summary: "Update a BOQ item.",
    description:
      "A rate or quantity change recomputes the row's amount. When the row's active allocations to activities would then exceed its new quantity or amount, the edit is refused with 409 BOQ_ITEM_BELOW_ALLOCATIONS (details: boqItemId, exceeded \"quantity\" or \"amount\"): reduce or reject the allocations first (Project Controls › Mapping).",
    operationId: "updateBoqItem",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm", "planning_eng", "qs"),
    requestBody: jsonBody(
      ref("BoqItemMutation"),
      "Partial BOQ item payload.",
      false,
    ),
    responseSchema: ref("BoqItemUpdateResponse"),
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
    description:
      "Every schedule reader receives the programme, its criticality included (isCritical, totalFloat, the critical path). The bill's figures on it (each activity's allocatedBoqQuantity, allocatedBoqAmount and allocatedBoqWeight, its approvedAllocationCount — the mapping badge, read off the allocations — and its mintedByBoqItemId, the BOQ row that created it, if one did; the revision's unallocatedBoqAmount; the BOQ value figures in the allocations readiness check) are present only for a caller who may read the BOQ, and so are the per-activity budgets built from the mapping (each activity's budget and generatedBudget, the generator's per-activity and per-WBS-node budgets) — reading the cost module does not override this (owner decision E1, 2026-09-28). The project totals (revision totalBudget and generatedTotalBudget) go to a caller who may read the BOQ or the cost module. A withheld figure is omitted, never zeroed.",
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
    description:
      "The source is the uploaded bill (every row's description, quantity, rate and amount), so it is served only to a member who may read both the schedule and the BOQ; anyone else is refused 403 FORBIDDEN (details.module \"boq\").",
    operationId: "downloadScheduleGenerationSource",
    parameters: [
      ...projectParams,
      pathParam("documentId", "ProjectDocument UUID for the source upload."),
    ],
    permissions: {
      auth: "bearer",
      module: "schedule",
      action: "read",
      roles: modulePermission("schedule", "read").roles.filter((role) =>
        modulePermission("boq", "read").roles.includes(role),
      ),
      note: "Requires schedule:read and boq:read (§12: the source upload is the bill).",
    },
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

// Owner decision D5: which readiness checks each gate needs.
const READINESS_GATES =
  "readiness.ready and readiness.blockingCount answer for the approval, which judges the revision's own logic (predecessor logic, critical path, date sanity); readiness.baselineReady and readiness.baselineBlockingCount answer for the baseline lock, which also needs a BOQ and its allocation coverage of the active activities. Each check's requiredFor names the gates it guards (\"approval\", \"baseline\"); the BOQ allocations check guards the baseline only, and on a staged revision it says the bill's value is mapped after the activation. Each failing check carries fix { where, inline, next, text, permission } — what puts it right and the page that offers it, by where the revision stands: a staged revision's own logic is corrected at its source and imported again or regenerated (Schedule › Update Schedule) or, under review, rejected; an active revision's on Schedule › Gantt › Edit or by Recalculate CPM (Schedule › More actions); coverage on Project Controls › Mapping; the BOQ itself on the BOQ page. permission names the step's permission (schedule.create, schedule.update, schedule.approve, boq.upload — the BOQ's upload, boq.edit — a BOQ row's edit, boq.create — an allocation, boq.update — a row's mapping rule); a passing check has fix null. The first check, boq_present (label \"BOQ\", requiredFor [\"baseline\"], details {}), is the rule the lock enforces with 400 BOQ_REQUIRED_FOR_BASELINE: on a project with no active BOQ item it fails, so baselineReady is false and baselineBlockingCount counts it, and its fix is { where: \"BOQ page\", next: \"upload the BOQ (BOQ page)\", permission: \"boq.upload\" } — named before any schedule or mapping step (the coverage check, which passes vacuously on an empty bill, no longer stands alone). It also fails when the bill has no in-scope value (owner decision E2, 2026-09-28): the priced amounts of the active rows whose mapping rule is neither not_applicable nor optional come to a cent or less (one threshold with the lock and the setup baseline gate, closure review 2026-09-29) — saying which step is missing, as the lock does. When none of the bill's rows is priced (the rule the lock enforces with 400 BOQ_VALUE_REQUIRED_FOR_BASELINE) its message says the bill has no value to map and its fix is { where: \"BOQ page\", next: \"price the BOQ's rows (BOQ page)\", permission: \"boq.edit\" }; when priced rows exist and every one is not_applicable or optional (400 BOQ_SCOPE_REQUIRED_FOR_BASELINE) its message says the bill has no in-scope value to map, the BOQ allocations check says there is no in-scope value to allocate yet, and its fix is { where: \"Project Controls › Mapping\", next: \"mark the rows that belong to the schedule as required (Project Controls › Mapping)\", permission: \"boq.update\" }. It says only whether such a bill exists, never a count or a value, and ready (the approval) does not include it. GET /projects/{projectId}/setup-readiness does not repeat it as a schedule blocker: its BOQ step names the upload (NO_BOQ), the pricing (BOQ_HAS_NO_VALUE) or the missing in-scope value (BOQ_NO_IN_SCOPE_VALUE), in the refusal's words.";
const APPROVAL_WITHOUT_COVERAGE =
  "Approval does not require BOQ allocations (owner decision D5): allocations are made to the active activities, which exist only once the approved revision is activated. SCHEDULE_NOT_READY at approval names only the revision's own failing checks.";
const BASELINE_NEEDS_COVERAGE =
  "The baseline lock of an activated revision whose required BOQ value is not allocated to approved active activities is refused with 400 SCHEDULE_NOT_READY, whose message names BOQ allocations and Project Controls › Mapping (\"Schedule readiness checks must pass before baseline lock: BOQ allocations — BOQ value remains unallocated to approved schedule activities (Project Controls › Mapping).\"), with no BOQ figure.";

// Owner decision 2026-09-28: no baseline without a bill.
const BASELINE_NEEDS_BOQ =
  "A project with no BOQ item is refused the baseline lock with 400 BOQ_REQUIRED_FOR_BASELINE (\"BOQ required before baseline lock: upload the BOQ (BOQ page), then map it to the schedule and lock the baseline.\"): in integrated Project Controls the steps run project structure, BOQ, schedule, mapping, validation, baseline lock, and the BOQ is named before any schedule refusal (REVISION_NOT_FOUND, INVALID_REVISION_STATUS, REVISION_NOT_ACTIVATED, SCHEDULE_NOT_READY, NO_ACTIVITIES). A project whose bill has no value (its active rows' priced amounts come to a cent or less — every amount 0, or one row at $0.01) is refused the same way with 400 BOQ_VALUE_REQUIRED_FOR_BASELINE (\"BOQ required before baseline lock: the bill has no value to map; price its rows (BOQ page), map them to the schedule, then lock the baseline.\"), and one with no in-scope value (its rows neither not_applicable nor optional come to a cent or less) with 400 BOQ_SCOPE_REQUIRED_FOR_BASELINE (\"BOQ required before baseline lock: the bill has no in-scope value to map; mark the rows that belong to the schedule as required (Project Controls › Mapping), map them, then lock the baseline.\"; owner decision E2, 2026-09-28); a bill with in-scope rows fully mapped beside not-applicable rows locks. Nothing is written. Baselines locked before this rule are unchanged.";

// The lifecycle refusals that name the step to take next.
const BASELINE_NOT_ACTIVATED =
  "An approved revision that is still staged (not yet activated) is refused with 409 REVISION_NOT_ACTIVATED, whose message says to activate it on Schedule › Revisions first; its baseline is locked after that. With no active activity at all the refusal is 400 NO_ACTIVITIES, which likewise says to activate an approved revision first.";
const BASELINE_ALREADY_LOCKED =
  "A revision whose baseline is already locked is refused with 409 INVALID_REVISION_STATUS, whose message says a new baseline comes from a new revision (import or generate one on Schedule › Update Schedule, take it through review and activation, then lock its baseline). With no schedule revision at all the refusal is 404 REVISION_NOT_FOUND, whose message says to import a P6/MSP schedule or generate one from the BOQ on the Schedule page.";
const REVISION_NOT_CURRENT_NOTE =
  "A revision that is neither the active one nor the latest staged one (a newer import has superseded it) is refused with 409 REVISION_NOT_CURRENT, whose message says to refresh to see the current revision (Schedule › Revisions).";
const REASON_REQUIRED_NOTE =
  "A missing or blank reason is refused with 400 VALIDATION_ERROR whose error.message is the reason itself (\"A rejection reason is required.\" or \"A rollback reason is required.\"), in production too.";

add(
  "/projects/{projectId}/schedule/baseline",
  "post",
  operation({
    tag: "Schedule",
    summary: "Lock the approved current schedule as baseline.",
    description:
      `The BOQ value figures in the answer's readiness are present only for a caller who may read the BOQ. A schedule that is not ready is refused with 400 SCHEDULE_NOT_READY, whose error.message names each failing blocking check, what is wrong and where to put it right (for example, for an active revision, \"Predecessor logic — at least one predecessor relationship is required (Schedule › Gantt › Edit)\"; for a staged revision, which no page edits, the reasons followed by \"A staged revision cannot be edited: correct the schedule at its source and import it again, or regenerate it from the BOQ (Schedule › Update Schedule) — the new revision replaces this one, or reject this revision (Schedule Review).\"; never the read-only Critical Path tab), followed, when the caller may not take that step, by who can (\"Only members who can create schedules (import or generate) can take this step; ask one of them.\") and carries no BOQ figure, and the readiness in error.details, whose BOQ value figures are likewise present only for a caller who may read the BOQ; ready, blockingCount and the checks' verdicts are the same for every caller. A step the revision's current status does not allow is refused with 409 INVALID_REVISION_STATUS, whose message names the status it is in now and the one the step needs, as the Revisions tab labels them (e.g. \"This schedule revision is now Rejected; it must be Under review before it can be rejected. Refresh to see its current status.\"). ${BASELINE_NEEDS_BOQ} ${BASELINE_NOT_ACTIVATED} ${BASELINE_NEEDS_COVERAGE} ${BASELINE_ALREADY_LOCKED} ${READINESS_GATES} ${REVISION_NOT_CURRENT_NOTE}`,
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

// §12, as utils/boq-figures applies it to every answer that carries a revision.
const REVISION_FIGURES =
  `The BOQ value figures in readiness.checks[].details (and a revision's unallocatedBoqAmount) are present only for a caller who may read the BOQ; totalBudget and generatedTotalBudget only for a caller who may read the BOQ or the cost module. Check keys, verdicts and counts are the same for every caller. ${READINESS_GATES}`;
// ... and to the refusal that states the readiness.
const NOT_READY_FIGURES =
  "A schedule that is not ready is refused with 400 SCHEDULE_NOT_READY, whose error.message names each failing blocking check, what is wrong and where to put it right (for example, for an active revision, \"Predecessor logic — at least one predecessor relationship is required (Schedule › Gantt › Edit)\"; for a staged revision, which no page edits, the reasons followed by \"A staged revision cannot be edited: correct the schedule at its source and import it again, or regenerate it from the BOQ (Schedule › Update Schedule) — the new revision replaces this one, or reject this revision (Schedule Review).\"; never the read-only Critical Path tab), followed, when the caller may not take that step, by who can (\"Only members who can create schedules (import or generate) can take this step; ask one of them.\") and carries no BOQ figure, and the readiness in error.details, whose BOQ value figures are likewise present only for a caller who may read the BOQ; ready, blockingCount and the checks' verdicts are the same for every caller. A step the revision's current status does not allow is refused with 409 INVALID_REVISION_STATUS, whose message names the status it is in now and the one the step needs, as the Revisions tab labels them (e.g. \"This schedule revision is now Rejected; it must be Under review before it can be rejected. Refresh to see its current status.\").";

add(
  "/projects/{projectId}/schedule/revisions",
  "get",
  operation({
    tag: "Schedule Revisions",
    summary: "List staged schedule revisions.",
    description: `${REVISION_FIGURES} Each listed revision carries snapshotActivityCount, the number of activities its stored snapshot holds (0 when none): a rollback can restore only a previous revision that stores some.`,
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
      description: REVISION_FIGURES,
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
    description: `${REVISION_FIGURES} The stored snapshot's boqRows are likewise present only for a caller who may read the BOQ.`,
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
    "Rollback an active schedule revision: the previous active revision's stored snapshot activities are restored. Refused 409 ROLLBACK_TARGET_HAS_NO_ACTIVITIES when that revision stored none (GET /schedule/revisions gives each revision's snapshotActivityCount). A rollback whose target revision is baselined re-establishes a schedule baseline, so it is a baseline path (owner decision E2, ruling G2 2026-09-29): before any write it is refused with the baseline lock's own refusal when the bill has no in-scope priced value (400 BOQ_REQUIRED_FOR_BASELINE, BOQ_VALUE_REQUIRED_FOR_BASELINE or BOQ_SCOPE_REQUIRED_FOR_BASELINE, in the lock's words), and with 400 SCHEDULE_NOT_READY naming the BOQ allocations check and Project Controls › Mapping when that value is not fully allocated to the activities the rollback keeps (allocations to activities it retires do not count); the refusal carries no BOQ figure. A rollback to an approved, never-baselined revision is not a baseline path.",
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
      description: [
        REVISION_FIGURES,
        ["approve", "baseline"].includes(suffix) && NOT_READY_FIGURES,
        suffix === "approve" && APPROVAL_WITHOUT_COVERAGE,
        suffix === "baseline" && BASELINE_NEEDS_BOQ,
        suffix === "baseline" && BASELINE_NOT_ACTIVATED,
        suffix === "baseline" && BASELINE_NEEDS_COVERAGE,
        suffix === "baseline" && BASELINE_ALREADY_LOCKED,
        suffix !== "rollback" && REVISION_NOT_CURRENT_NOTE,
        ["reject", "rollback"].includes(suffix) && REASON_REQUIRED_NOTE,
      ]
        .filter(Boolean)
        .join(" "),
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
    description: `${REVISION_FIGURES} A body without a mappings list, or a mapping missing its oldActivityId or newActivityKey, is refused with 400 VALIDATION_ERROR whose error.message says what is missing, in production too; send an empty mappings list when no schedule is active yet. A revision that is already active (activated elsewhere while the dialog was open) is refused with 409 REVISION_ALREADY_ACTIVE, whose message says to refresh Schedule › Revisions and names the next step (map the BOQ to its activities and lock the baseline, or that its baseline is locked). With a schedule already active, a body with no mapping and no removal is refused with 400 MAPPING_CONFIRMATION_REQUIRED, whose message says activation replaces the active schedule and that Schedule › Revisions › Activate proposes the mapping.`,
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
    description:
      "allocatedBoqQuantity, allocatedBoqAmount, allocatedBoqWeight, approvedAllocationCount and the per-activity budget and generatedBudget are present only for a caller who may read the BOQ; reading the cost module does not override this (owner decision E1, 2026-09-28). The same holds for every endpoint here that answers with an activity.",
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
  "/projects/{projectId}/activities/{id}/detail",
  "get",
  operation({
    tag: "Activities",
    summary: "Activity detail: the activity's story across the modules (PC-5).",
    description:
      "Composed read-only from the services that own each figure: header (dates, float, critical flag), structure (WBS, location; an activity has no cost code of its own), mapping (BOQ allocations with links to each BOQ item, mapped quantity, budget = Σ approved allocations, generated budget as a projection, EV derived as of now = the allocation summary's per-allocation EV scoped to this activity) — for BOQ readers only, cost readers included (owner decision E1), otherwise { allowed: false, module: \"boq\" } —; for a member who may not read the BOQ, a change order reached only through an allocation link is left out, every listed order carries no allocationLinks and boqWithheld: { keys: [\"allocationLinks\"], reason }, and changes.changeOrders and history carry boqWithheld: { reason } (always, with no count), progress (progress:read; method, approved history, progress source, submissions), cost (cost:read; CostRecord committed and actual, stored forecast), certification (ipc:read and BOQ read), changes (change orders and change events), procurement, quality (NCR, ITP, punch), constraints (logic ties and open lookahead constraints), documents and photos, and history (audit:read; progress-submission, allocation-approval, change-order and schedule-revision events — activities have no audit trail of their own). Another organisation's activity, or a missing one, is 404 ACTIVITY_NOT_FOUND.",
    operationId: "getActivityDetail",
    parameters: projectRecordParams,
    permissions: modulePermission("schedule", "read"),
    responseSchema: ref("ControlsDetail"),
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
  "/projects/{projectId}/import/xlsx",
  "post",
  operation({
    tag: "Imports",
    summary: "Import a programme from an Excel workbook.",
    description:
      "Columns: activity_code and name (required); wbs_code, start, finish, duration_days, predecessors (\"A100, A110FS+2, A120 SS -1\"), percent_complete, calendar (optional). Staged as a draft schedule revision exactly like an XER or MSPDI import, to be activated after mapping review. With dryRun=true the workbook is parsed and the staged snapshot reported (ScheduleXlsxDryRunResponse) and nothing is stored.",
    operationId: "importXlsxSchedule",
    parameters: [
      ...projectParams,
      queryParam(
        "dryRun",
        "Parse and report only; nothing is written.",
        { type: "boolean", default: false },
      ),
    ],
    permissions: modulePermission("schedule", "create"),
    requestBody: fileUploadBody({
      description: "Schedule workbook upload.",
      accepted: ".xlsx workbook, maximum 50 MB.",
    }),
    responseSchema: {
      oneOf: [ref("ImportResponse"), ref("ScheduleXlsxDryRunResponse")],
    },
    status: 201,
  }),
);

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
    description:
      "Each period's cutoffDate is the instant its figures are cut at, never the stored value: an open period's reporting date (cutoffLocalDate, as entered) ending in the project's reporting zone resolved now (timeZone, timeZoneSource, timeZoneNote); a locked period's the instant, date, zone and note its snapshot recorded. The list also states the zone open periods are read in today: timeZone, timeZoneSource and timeZoneNote (null when the project's own zone applies, otherwise \"Project timezone is not configured; UTC is being used\" or the organisation default it names).",
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
    description:
      "The reporting date is kept as entered. The created period answers with the computed cutoff instant as cutoffDate (the end of cutoffLocalDate in timeZone), timeZoneSource and timeZoneNote.",
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

// §12, as utils/boq-figures applies it to the official EV report.
const EV_REPORT_FIGURES =
  "The report is a cost reader's: the project totals (totalBudget, approvedAllocatedAmount, pv, ev, ac, spi, cpi, eac, the S-curve) are every such caller's. unallocatedBoqAmount, and the BOQ value figures in readinessGate.blockers[].details and readinessGate.warnings[].details, are present only for a caller who may read the BOQ, and so is activityBreakdown (owner decision E1, 2026-09-28): each row's budget is the activity's approved allocation, its pv and ev are built from it, and the rows are the largest allocations in order of size. For a cost reader without boq:read activityBreakdown is omitted and the report carries activityBreakdownWithheld: true and activityBreakdownReason \"Mapping details unavailable to you\". Output only: a locked period's stored snapshot is not changed.";

add(
  "/projects/{projectId}/reports/periods/{periodId}/lock",
  "post",
  operation({
    tag: "Reports",
    summary: "Lock a reporting period EV snapshot.",
    description: `${EV_REPORT_FIGURES} A lock refused by the official-reporting readiness gate (409 REPORTING_READINESS_BLOCKED, 403 REPORTING_READINESS_OVERRIDE_FORBIDDEN) states the gate in error.details.gate, withheld the same way.`,
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
    description:
      "Cost loadings are the Cost module's own per-activity record: each row's plannedValue is typed in by the person who creates it (source \"manual\" by default; source is a label, never a calculation), not a figure derived from a BOQ allocation. They are therefore returned to every member who may read the cost module, with or without BOQ read access (orchestrator ruling G1, 2026-09-29): moving an approved BOQ allocation between activities changes no cost loading, so this list is not covered by the withholding of allocation-derived per-activity figures (owner decision E1) — the EV report's activityBreakdown, the schedule's and activities' budgets, the forecast's per-activity cost — and is not a gap in it.",
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
    description: EV_REPORT_FIGURES + DEFAULT_EV_PERIOD,
    operationId: "getEarnedValueReport",
    parameters: [
      ...projectParams,
      queryParam("periodId", "Optional reporting period UUID.", uuid),
      queryParam(
        "cutoffDate",
        "Optional ad hoc cutoff: a calendar date (YYYY-MM-DD) or a date-time (the date it falls on in the project's reporting time zone). The report runs to the end of that date in Project.timezone, else the organisation's defaultTimezone, else UTC.",
        dateString,
      ),
    ],
    permissions: modulePermission("cost", "read"),
  }),
);

// A change order's and a sub valuation's allocation links point at a BOQ
// row and its allocation; a caller without boq:read is given each link
// without them (utils/boq-figures withheldAllocationLinks).
const allocationLinkWithholding = (ownFigures) =>
  "Each of `allocationLinks` carries the BOQ row it points at (boqItemId, boqItem: id, code, ref, description, unit, qty, rate, amount) and its allocation (allocationId, allocation: id, quantity, amount, weight, status, with the row and its activity). A caller who may not read the BOQ (boq:read) is given each link without those four keys and `boqWithheld: { keys, reason }` in their place; the link's own " +
  ownFigures +
  ", its notes, and every figure of the record itself are returned to every reader, and boq:read is not needed to read or work the record.";
const changeOrderLinkWithholding = allocationLinkWithholding("quantity and amount");
const subValuationLinkWithholding = allocationLinkWithholding(
  "quantity, workDoneAmount, materialsOnSiteAmount and retentionAmount",
);

add(
  "/projects/{projectId}/change-orders",
  "get",
  operation({
    tag: "Commercial",
    summary:
      "List change orders with activity, BOQ allocation, correspondence, and attachment traceability.",
    description: changeOrderLinkWithholding,
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
    description: changeOrderLinkWithholding,
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
    description: changeOrderLinkWithholding,
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
    description: changeOrderLinkWithholding,
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
    description: changeOrderLinkWithholding,
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
    description: changeOrderLinkWithholding,
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
    description: changeOrderLinkWithholding,
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
    description: changeOrderLinkWithholding,
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
      "Created on first read from the project's own contract metadata and BOQ total, so nothing has to be re-keyed. " +
      "The original value is classified by the server only (`originalValueSource`: project_value — the project's own contract value at creation; boq_fallback — the active BOQ's total, used when the project had none; contract_entry — entered or confirmed under contract.manage; unestablished — a row written before the classification). While it is boq_fallback or unestablished, a caller who may not read the BOQ (boq:read) is given the contract without originalValue, revisedValue and — when advanceRate > 0, since it is then a rate of the value — advanceAmount, and `valueWithheld: { keys, source, reason }` in their place (never zero); an established value, and everything else, is returned to every ipc reader.",
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
        confirmOriginalValue: {
          type: "boolean",
          description:
            "true confirms the stored original value as it stands (a boq_fallback or unestablished value) as the contract's: originalValueSource becomes contract_entry and the contract.manage audit event records who and when (summary.originalValueConfirmation = confirmed). Needs boq:read on the project as well (403 CONTRACT_VALUE_CONFIRM_FORBIDDEN), cannot be sent with originalValue (400 CONTRACT_VALUE_CONFIRM_CONFLICT), and an established value has nothing to confirm (409 CONTRACT_VALUE_ALREADY_ESTABLISHED).",
        },
      }),
      "Contract fields to change. The advance amount follows the advance rate unless it is given explicitly. An originalValue different from the stored one is an entry (originalValueSource becomes contract_entry; summary.originalValueConfirmation = entered); the stored value sent back, or a save without originalValue, never changes the source. originalValueSource cannot be sent (400 VALIDATION_ERROR). The answer is the contract, withheld as GET withholds it.",
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
    description:
      "`lines` (the schedule of values) are the project's live BOQ rows — boqItemId, code, section, description, unit, quantity, rate, contractAmount — with what the period certified against each. A caller who may not read the BOQ (boq:read) is given the statement without `lines`, and `linesWithheld: { reason }` in their place; the contract, summary, current certificate and periods are the commercial module's own records and are returned to every ipc reader — except the contract's original value while it is boq_fallback or unestablished (see getPrimeContract): such a caller is given the contract and the summary without originalValue, revisedValue, remainingToCertify (summary) and, when advanceRate > 0, advanceAmount, each with `valueWithheld: { keys, source, reason }`.",
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
      "The advance received. Refused if it takes the total past the agreed advance (409 ADVANCE_OVER_AGREED; the message states the agreed figure only to a caller who may receive it). The answer is the contract, withheld as GET /prime-contract withholds it.",
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
    description:
      "A caller who may not read the BOQ (boq:read) is given each certificate without the certification review stamped on it from the BOQ rows and their allocations (earnedValueAtCertification, approvedLimitAtCertification, overCertificationAmount); `boqWithheld: { keys, reason }` names what was left out.",
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
    description:
      "`items` are the certificate's lines — each a live BOQ row (boqItem: id, code, ref, description, unit, qty, rate) with its allocation and progress link — and `certificationReview` is worked over them. A caller who may not read the BOQ (boq:read) is given the certificate without `items`, `certificationReview` and the review stamped at certification, and `boqWithheld: { keys, reason }` in their place; the certificate's own totals, invoices, payments and retention releases are returned to every ipc reader. The certificate answered by create, adjustments, submit, certify, a payment and a retention release is withheld the same way.",
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
    description:
      "Answers with the line as written — its BOQ row, allocation and progress link included. A caller who may not read the BOQ (boq:read) is given only the line's id and `itemWithheld: { reason }`.",
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
    "A period that claims more than approved progress earned, or more than the approved allocation or its quantity, needs a PM override: without an overrideReason it is refused with 400 IPC_PM_OVERRIDE_REASON_REQUIRED, and by anyone but a PM with 403 IPC_PM_OVERRIDE_REQUIRED. Outside production error.details on those refusals is the certification review, worked from the BOQ rows and their allocations (currentClaimedAmount, earnedAmount, approvedLimitAmount, overEarnedAmount, overApprovedQuantity, overrideLineCount …) — for a caller who may read the BOQ (boq:read); anyone else is given `{ boqWithheld: { keys: [\"certificationReview\"], reason } }` in its place, and the same code and message.",
  ],
].forEach(([suffix, operationId, summary, action, transition, bodySchema, description]) => {
  add(
    `/projects/{projectId}/ipc/{period}/${suffix}`,
    "post",
    operation({
      tag: "Commercial",
      summary,
      description,
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
    summary:
      "List legacy subcontractor valuations. Superseded by payment applications against a subcontract commitment (OCTA-FIN-SUBVAL-064): these name their subcontractor in free text, hold no schedule of values and post nothing to the cost ledger — they reach the project through cash flow only, and only once certified or paid. Existing rows are retained and readable; no new ones are accepted.",
    description: subValuationLinkWithholding,
    operationId: "listSubValuations",
    parameters: projectParams,
  }),
);

add(
  "/projects/{projectId}/sub-valuations/attribution",
  "get",
  operation({
    tag: "Commercial",
    summary:
      "Which company each legacy free-text name most likely meant. Proposes only: an unambiguous single match is offered as `suggested`, anything else as `candidates` for a person to choose. Names are never matched automatically — the key folds punctuation but not the legal form, so \"ABC Steel LLC\" and \"ABC Steel Ltd\" stay apart. Apply one row at a time with PATCH `companyId`.",
    operationId: "reportSubValuationAttribution",
    parameters: projectParams,
  }),
);

add(
  "/projects/{projectId}/sub-valuations",
  "post",
  operation({
    tag: "Commercial",
    summary:
      "Retired — always 409 SUB_VALUATION_RETIRED. Raise a subcontract commitment and claim against it with a payment application, which names the subcontractor company and posts certified cost to the ledger. The error carries the destination.",
    operationId: "createSubValuation",
    parameters: projectParams,
    status: 201,
  }),
);

add(
  "/projects/{projectId}/sub-valuations/{id}",
  "patch",
  operation({
    tag: "Commercial",
    summary:
      "Update a legacy valuation so an in-flight one can be finished, and attribute it to a company with `companyId`. `subcontractor` is immutable (409 SUB_VALUATION_NAME_IMMUTABLE): it records who was billed at the time, and attribution goes beside it rather than over it.",
    description: subValuationLinkWithholding,
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
  description,
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
      description,
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
  // BOQ ↔ activity mapping (PC-3): coverage, rules, bulk, import, suggestions.
  {
    method: "get",
    path: "/projects/{projectId}/activity-boq-allocations/coverage",
    summary: "Coverage by structure (§69): the allocation summary grouped by WBS, section, location, cost code or package, as of an optional cutoff date.",
    description:
      "Per item, per group and in total: BOQ amount, approved and pending allocated value, unallocated value, the not-applicable bucket (items whose mappingRule is not_applicable, never reported as unallocated), earned and certified value, and counts of items by mapping state. BOQ total = approved allocated + unallocated + not applicable on every project.",
    operationId: "getActivityBoqAllocationCoverage",
    parameters: [
      ...projectParams,
      queryParam("groupBy", "Group rows by a structure dimension.", { type: "string", enum: ["none", "wbs", "section", "location", "costCode", "package"] }),
      queryParam("cutoffDate", "Read the allocations as they stood on this date.", { type: "string", format: "date-time" }),
    ],
    permissions: modulePermission("boq", "read"),
    responseSchema: ref("AllocationCoverageSummary"),
  },
  {
    method: "get",
    path: "/projects/{projectId}/activity-boq-allocations/suggestions",
    summary: "Ranked mapping suggestions with provenance (§94-§95). Never writes a row.",
    description:
      "Candidates per BOQ row from rule:code (0.9), rule:wbs (0.8), rule:costcode (0.7) and rule:name (0.6), with a rule:location bonus of 0.05 for the same location subtree. Pairs that already have an active allocation and not_applicable rows are left out. Accepting one is an ordinary create with suggestedBy and confidence.",
    operationId: "listActivityBoqAllocationSuggestions",
    parameters: [
      ...projectParams,
      queryParam("boqItemId", "Only this BOQ row.", uuid),
      queryParam("limit", "Candidates per row (1-20, default 5).", { type: "integer", minimum: 1, maximum: 20 }),
    ],
    permissions: modulePermission("boq", "read"),
    responseSchema: ref("MappingSuggestionsResponse"),
  },
  {
    method: "patch",
    path: "/projects/{projectId}/activity-boq-allocations/mapping-rules",
    summary: "Set the mapping rule (required, optional, not_applicable) on a set of BOQ rows or a whole section.",
    description:
      "A row marked not_applicable refuses allocations (409 MAPPING_NOT_APPLICABLE) and is excluded from unallocated value and readiness blockers. An optional row's remaining value is reported apart (optionalUnallocatedAmount) and warns instead of blocking. Moving a row with an approved allocation to not_applicable is refused (409 MAPPING_RULE_HAS_APPROVED_ALLOCATION) until the allocation is rejected. A mapping rule is a bill edit: on a baseline-locked project every change is refused (409 BOQ_BASELINE_LOCKED).",
    operationId: "setBoqMappingRules",
    permissions: modulePermission("boq", "update", "allocation.update"),
    requestBody: jsonBody(ref("MappingRulesMutation"), "The rule and the rows (itemIds) or section it applies to."),
    responseSchema: ref("MappingRulesResponse"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/activity-boq-allocations/bulk",
    summary: "Create several draft allocations in one call; each row is judged on its own and reported.",
    description:
      "The matrix's allocate-evenly / by-duration / by-remaining-capacity actions send their rows here. A row that breaks a rule (capacity, duplicate pair, not_applicable item, location subtree) is listed under failed with its error code; the others are created. 201 when at least one row was created, 200 otherwise. An amount obeys the same money rule as the single create (two decimals, at least 0.01), so a row with more precision fails validation for the whole call (400 VALIDATION_ERROR).",
    operationId: "createActivityBoqAllocationsBulk",
    permissions: modulePermission("boq", "create", "allocation.create"),
    requestBody: jsonBody(ref("ActivityBoqAllocationBulkMutation"), "Up to 500 draft allocation payloads."),
    responseSchema: ref("ActivityBoqAllocationBulkResponse"),
    status: 201,
  },
  {
    method: "post",
    path: "/projects/{projectId}/activity-boq-allocations/import",
    summary: "Import a mapping file (boq_code, activity_code, quantity|amount|weight): ?dryRun=true reports, otherwise applies as import drafts under one batch id.",
    description:
      "The dry run reports rows matched, codes not found, pairs already allocated, capacity breaches and rows on not-applicable items without writing. Apply creates the matched rows as drafts with source 'import', suggestedBy 'import' and one importBatchId; the same file applied again creates nothing (every pair is then existing).",
    operationId: "importActivityBoqAllocations",
    parameters: [...projectParams, queryParam("dryRun", "Report only; write nothing.", { type: "boolean" })],
    permissions: modulePermission("boq", "create", "allocation.create"),
    requestBody: fileUploadBody({
      description: "The mapping workbook.",
      accepted: ".xlsx, .xls or .csv with boq_code, activity_code and one of quantity, amount, weight (optional: notes, location).",
    }),
    responseSchema: ref("MappingImportReport"),
    status: 201,
  },
  {
    method: "post",
    path: "/projects/{projectId}/activity-boq-allocations/import/{batchId}/undo",
    summary: "Undo an import batch: rejects its rows that are still draft or submitted; approved rows are kept and named.",
    operationId: "undoActivityBoqAllocationImport",
    parameters: [...projectParams, pathParam("batchId", "Import batch UUID.")],
    permissions: modulePermission("boq", "approve", "allocation.reject"),
    responseSchema: ref("MappingImportUndoResponse"),
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
  summary:
    "List project audit events. The history of the BOQ's records (boq_item, boq_revision, activity_boq_allocation) is present only for a caller who may read the BOQ, a cost_record event's budget (and generatedBudget) in its summaries — the budget written on the record, its activity's approved BOQ allocation when the record was made (owner decision E1) — only for a caller who may read the BOQ, and a schedule_revision event's totalBudget in its summaries only for a caller who may read the BOQ or the cost module. An ipc_certificate event's certificationReview and progressLinks (the review of the certificate's lines — the BOQ rows and their allocations — recorded at certification in the audit summary and the approval metadata: approvedLimitAmount, earnedAmount, overEarnedAmount, overApprovedLimitAmount, overApprovedQuantity, overrideLineCount …) are present only for a caller who may read the BOQ; anyone else is given the event without them and `boqWithheld: { keys, reason }` — who certified, when, the status, the certificate's totals and the override reason stay. A project event recording contract.manage (summary.transition) states the client contract's original value before and after (oldSummary / newSummary, each with its originalValueSource; an event written before that states none and is taken as project_value only while the contract is project_value now): for a caller who may not read the BOQ an original value that was not established (boq_fallback or unestablished) is left out of that summary and `valueWithheld: { parts, keys, reason }` names it; who, when and the rates stay. Output only: the stored events are not changed.",
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
    "Returns official project health dimensions with sourceRule, cutoffDate, and drill-through targets, plus a separate pendingReview block for submitted progress, IPC, change orders, and submittals that do not feed official scores. The cost dimension's unallocatedBoqAmount is given only to a caller who may read the BOQ; its ac and ev only to a caller who may read the BOQ or the cost module (absent, not zero, otherwise — the score and cpi stay). The schedule dimension's delayedActivities is counted as of today (the latest progress), not as of the cutoff. dataFreshness.cutoffDate is the earned-value cutoff instant: the end of dataFreshness.cutoffLocalDate in dataFreshness.cutoffTimeZone (the project's time zone, else the organisation's default, else UTC — cutoffTimeZoneSource says which); a locked period stored before the zone was recorded gives null for the zone. dataFreshness.cutoffTimeZoneNote is the EV report's timeZoneNote: null when the project's own zone applied, otherwise \"Project timezone is not configured; UTC is being used\" or \"Project timezone is not configured; the organisation default <zone> is being used\". Each dimension's measuredThrough says what it is measured through: ev_cutoff (schedule and cost: the official EV report) or today (commercial, supply chain, quality, safety, doc control and every pendingReview metric: the records as they stand now). The schedule detail's spiNote and the cost detail's cpiNote are the server's reason when SPI or CPI is missing (or CPI is 0), null otherwise; scoreBasis is neutral_no_index when the index is missing and the score is the rule's neutral 60, otherwise spi or cpi; acSource.officialActualActivities counts the activities with official actual cost through the cutoff. dataFreshness.cutoffNotReachedNote (also on the schedule and cost details) is set when the EV cutoff is still ahead of now: PV runs to the cutoff while EV and AC are measured through today. Messages only — no score or figure changes." + DEFAULT_EV_PERIOD,
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

// Owner decision E1 (2026-09-28), as utils/boq-figures applies it to the Cost module.
const COST_RECORD_BUDGETS =
  "Each record's budget is its activity's approved BOQ allocation, and generatedBudget the budget first written on the record: both are present only for a caller who may read the BOQ — reading the cost module does not override this (owner decision E1, 2026-09-28). The cost ledger's own figures on each record (the cost categories, committed, actual, actualThroughDate, forecast) are every cost reader's.";

[
  {
    method: "get",
    path: "/projects/{projectId}/cost",
    summary: "List activity cost records.",
    description: COST_RECORD_BUDGETS,
    operationId: "listCostRecords",
    parameters: costRecordListParams,
    permissions: modulePermission("cost", "read"),
    responseSchema: ref("RowsCursorPage"),
  },
  {
    method: "get",
    path: "/projects/{projectId}/cost/summary",
    summary: "Get project cost summary.",
    description: `${COST_RECORD_BUDGETS} The summary's figures built from those budgets — they add up the approved allocations of the activities that have a cost record, per category and in total, and a record with no forecast counts its budget in the forecast — are present only for a caller who may read the BOQ: byPhase[].budget, forecast, variance and variancePct; totals.budget and totals.forecast; eac.toComplete, optimistic, mostLikely and pessimistic; budget.allocatedToActivities. Anyone else receives each byPhase row's phase, committed and actual, totals.committed and totals.actual, eac.basis and eac.actual, and the budget register's original, approved changes, revisions and revised budget, with activityBudgetsWithheld true and activityBudgetsReason "Mapping details unavailable to you". Moving an approved allocation between activities changes nothing such a caller receives (owner decision E1). The project's own totals — EV, PV, AC, SPI, CPI, EAC — are on the EV report and the forecast.`,
    operationId: "getCostSummary",
    permissions: modulePermission("cost", "read"),
  },
  {
    method: "get",
    path: "/projects/{projectId}/cost/reconciliation",
    summary:
      "Compare the stored actual cost against the cost ledger (OCTA-FIN-LEDGER-059). `BudgetLine.actual` and `CostRecord.actual` are materialised projections of the ledger; this recomputes them from source entries and reports every line and activity where the two disagree by more than half a cent, in either direction. A stale `actualThroughDate` is reported even when the amount agrees, because it silently drops cost out of official AC. Read-only.",
    operationId: "getCostReconciliation",
    permissions: modulePermission("cost", "read"),
  },
  {
    method: "get",
    path: "/projects/{projectId}/cost/reconciliation/explain",
    summary:
      "Where one actual-cost figure came from: the ledger entries behind a budget line or an activity, newest first, each naming its source record.",
    operationId: "explainActualCost",
    parameters: [
      queryParam("budgetLineId", "Budget line to explain.", { type: "string", format: "uuid" }),
      queryParam("activityId", "Activity to explain.", { type: "string", format: "uuid" }),
      queryParam("limit", "Maximum entries (default 200, max 500).", { type: "integer" }),
    ],
    permissions: modulePermission("cost", "read"),
  },
  {
    method: "get",
    path: "/projects/{projectId}/cost/reconciliation/migration",
    summary:
      "What actual cost predates the ledger, classified per row (OCTA-FIN-MIGRATE-062): **A** the ledger already explains it · **B** partially explained, only the remainder opens · **C** nothing explains it · **drift** the ledger explains *more* than the projection holds, which belongs to recompute rather than to an opening balance. Read-only.",
    operationId: "getActualCostMigration",
    permissions: modulePermission("cost", "read"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/cost/reconciliation/migrate",
    summary:
      "Open the actual cost that no source transaction explains, as `legacy_opening_balance` ledger entries carrying a batch id and a stated reason. It does not pretend the amount came from an invoice, a pay application or a stock issue. Idempotent by arithmetic rather than by memory: the opening amount is always stored minus everything the ledger already explains — prior openings included — so a second run finds nothing and writes nothing.",
    operationId: "migrateActualCostToLedger",
    requestBody: jsonBody(
      objectSchema({ reason: { type: "string", nullable: true }, dryRun: { type: "boolean" } }),
      "Why the balances are being opened.",
      false,
    ),
    permissions: modulePermission("cost", "approve"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/cost/reconciliation/recompute",
    summary:
      "Rebuild `BudgetLine.actual` and `CostRecord.actual` from the cost ledger, writing only the rows that disagree. Deliberate rather than scheduled: a silent nightly rewrite of financial figures hides drift instead of surfacing it. Pass `dryRun` to see what would change.",
    operationId: "recomputeActualCost",
    requestBody: jsonBody(objectSchema({ dryRun: { type: "boolean" } }), "Options.", false),
    permissions: modulePermission("cost", "approve"),
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
    description: `A record made here is written with its activity's approved BOQ allocation as its budget when none is given. ${COST_RECORD_BUDGETS} The answer is the record as written, without budget and generatedBudget for a caller who may not read the BOQ.`,
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
    description: `${COST_RECORD_BUDGETS} The answer is the record as written, without budget and generatedBudget for a caller who may not read the BOQ.`,
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
  summary:
    "Delete a draft or submitted legacy valuation. A certified or paid one is refused (409 SUB_VALUATION_HISTORICAL): it is the record that money was committed to or paid out, and deleting it removes the only trace that it happened.",
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
      "Stores a hashed invitation token, sends an email invite, and audits the invitation. The invite can optionally assign a project role when accepted. An email that already belongs to an identity in another workspace may be invited (acceptance gives it a second membership); one that is already an active member here is refused with 409 ALREADY_MEMBER unless the invitation is for a project or party — and then it assigns the project without changing the member's workspace role.",
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
    summary: "Create an organization user, or add an existing identity to this workspace.",
    description:
      "A new email creates an identity (password required) and its membership. An email that already belongs to an identity in another workspace gets a membership here instead: the response carries existingIdentity: true, the password is ignored, and the identity's name and password are untouched. 409 EMAIL_EXISTS when the identity is already in this workspace.",
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

// Owner rule 2026-09-28: a member without boq:read receives no BOQ-derived
// information, notifications included.
const BOQ_RECORD_NOTICES =
  "A notification about one of the bill's own records (entityType activity_boq_allocation, boq_revision or boq_item — a workflow step, a comment or an @mention alike) is written only for a recipient who may read the BOQ on its project (the project's template, role and party decide it, as on the BOQ routes): a member without boq:read is not told that an allocation, a revision or a BOQ item's discussion exists, in-app, by email, by push or by the realtime badge. Such a row stored for them before this rule is left out of the list, the summary and its counts (unread, read, archived), is untouched by mark-all-read, and answers 404 NOTIFICATION_NOT_FOUND when opened, marked, archived or retried; the stored row itself is never rewritten.";

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
    description: BOQ_RECORD_NOTICES,
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
    summary: "Register (or refresh) this device's push subscription: a browser's Web Push subscription, or the field app's Expo token. Upserts on endpoint (the token for Expo).",
    operationId: "createPushSubscription",
    requestBody: jsonBody(
      objectSchema({
        provider: { type: "string", enum: ["web", "expo"], description: "Defaults to web. With expo, send token and platform instead of endpoint and keys." },
        endpoint: { type: "string" },
        keys: objectSchema({ p256dh: { type: "string" }, auth: { type: "string" } }, ["p256dh", "auth"]),
        token: { type: "string", description: "Expo push token, ExponentPushToken[...]" },
        platform: { type: "string", enum: ["ios", "android"] },
        deviceName: { type: "string", nullable: true },
      }),
      "The browser's `PushSubscription.toJSON()`, or `{ provider: 'expo', token, platform, deviceName? }` from the field app.",
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
    description: BOQ_RECORD_NOTICES,
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
    description: BOQ_RECORD_NOTICES,
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
    description: BOQ_RECORD_NOTICES,
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
  "/config/public",
  "get",
  operation({
    tag: "Config",
    summary: "Public client configuration.",
    description:
      "Unauthenticated. Tells the sign-in and sign-up screens whether self-service registration is open. It is open outside production and closed in production unless PUBLIC_REGISTRATION=true; when closed, organisations are created by the first-administrator bootstrap and people join by invitation.",
    operationId: "getPublicConfig",
    security: false,
    responseSchema: objectSchema(
      {
        registration: {
          type: "string",
          enum: ["open", "closed"],
          description: "Whether POST /auth/register accepts new organisations.",
        },
      },
      ["registration"],
    ),
  }),
);

add(
  "/config/extra-services",
  "get",
  operation({
    tag: "Config",
    summary: "List the caller's organisation's extra BOQ services (VAT, overhead, contingency), or the platform defaults when it has none.",
    operationId: "getExtraServices",
    permissions: authenticatedOnly,
    responseSchema: { type: "array", items: ref("ExtraService") },
  }),
);

add(
  "/config/extra-services",
  "put",
  operation({
    tag: "Config",
    summary: "Replace the caller's organisation's extra BOQ services, in order. Labels must be unique within the organisation.",
    operationId: "setExtraServices",
    permissions: {
      auth: "bearer",
      roles: ["pm"],
      note: "Company administrators and owners (requireCompanyAdmin).",
    },
    requestBody: jsonBody(ref("ExtraServicesPayload"), "The organisation's list, replacing the current one.", true),
    responseSchema: { type: "array", items: ref("ExtraService") },
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

// Project-controls structure (PC-1). Gated by the boq module: structure is
// what the bill and the programme are grouped by (integration doc §2).
[
  {
    method: "get",
    path: "/projects/{projectId}/structure/wbs",
    summary:
      "List the project WBS (flat ordered rows plus nested tree, with linked activity and BOQ row counts). Readable by anyone who can read the schedule (owner decision D3): a BOQ reader receives the whole answer; a schedule reader who may not read the BOQ receives the outline (view: outline). Writes stay on boq:update.",
    operationId: "listWbsNodes",
    parameters: [...projectParams, includeArchivedParam],
    permissions: {
      ...modulePermission("schedule", "read"),
      anyOf: [modulePermission("schedule", "read"), modulePermission("boq", "read")],
      roles: [
        ...new Set([
          ...modulePermission("schedule", "read").roles,
          ...modulePermission("boq", "read").roles,
        ]),
      ],
      note: "schedule:read or boq:read. Without boq:read the answer is the outline (view: outline).",
    },
    responseSchema: ref("WbsNodeListResponse"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/structure/wbs",
    summary: "Create a WBS node under an optional parent.",
    operationId: "createWbsNode",
    permissions: modulePermission("boq", "update"),
    requestBody: jsonBody(ref("WbsNodeMutation"), "WBS node payload (code and name required).", true),
    responseSchema: ref("WbsNodeRecord"),
    status: 201,
  },
  {
    method: "patch",
    path: "/projects/{projectId}/structure/wbs/{id}",
    summary:
      "Rename, recode, reorder, move, or flag a WBS node as a work package. A move rewrites the subtree's path and depth.",
    operationId: "updateWbsNode",
    parameters: projectRecordParams,
    permissions: modulePermission("boq", "update"),
    requestBody: jsonBody(ref("WbsNodeMutation"), "Partial WBS node payload."),
    responseSchema: ref("WbsNodeRecord"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/structure/wbs/{id}/archive",
    summary:
      "Archive a WBS node and its subtree. Linked activities and BOQ rows keep their wbsNodeId.",
    operationId: "archiveWbsNode",
    parameters: projectRecordParams,
    permissions: modulePermission("boq", "update"),
    requestBody: jsonBody(ref("WbsNodeReasonPayload"), "Optional reason.", false),
    responseSchema: ref("WbsNodeArchiveResponse"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/structure/wbs/{id}/restore",
    summary: "Restore an archived WBS node (parent must be active).",
    operationId: "restoreWbsNode",
    parameters: projectRecordParams,
    permissions: modulePermission("boq", "update"),
    requestBody: jsonBody(ref("WbsNodeReasonPayload"), "Optional reason.", false),
    responseSchema: ref("WbsNodeRecord"),
  },
  {
    method: "get",
    path: "/projects/{projectId}/structure/units",
    summary: "List the organisation's units of measure.",
    operationId: "listUnitsOfMeasure",
    parameters: [...projectParams, includeArchivedParam],
    permissions: modulePermission("boq", "read"),
    responseSchema: ref("UnitListResponse"),
  },
  {
    method: "get",
    path: "/projects/{projectId}/structure/units/normalise",
    summary:
      "Resolve a unit spelling to the organisation's unit code. What was typed is returned unchanged; an unknown spelling comes back with a warning, never rewritten.",
    operationId: "normaliseUnitOfMeasure",
    parameters: [
      ...projectParams,
      queryParam("unit", "The unit as typed, e.g. M3 or cu.m.", { type: "string" }, { required: true }),
    ],
    permissions: modulePermission("boq", "read"),
    responseSchema: ref("UnitNormaliseResponse"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/structure/units",
    summary: "Add a unit of measure to the organisation's list (seeds the defaults first when the list is empty).",
    operationId: "createUnitOfMeasure",
    permissions: modulePermission("boq", "update"),
    requestBody: jsonBody(ref("UnitMutation"), "Unit payload.", true),
    responseSchema: ref("UnitOfMeasureRecord"),
    status: 201,
  },
].forEach((route) =>
  addGenericRoute({
    tag: "Structure",
    ...route,
  }),
);

const backgroundJobIdParam = pathParam("jobId", "Background job UUID.");
const projectJobParams = [projectIdParam, backgroundJobIdParam];

[
  {
    method: "get",
    path: "/projects/{projectId}/jobs",
    summary: "List durable background jobs for a project (newest first): only the jobs of modules the caller may read, and a schedule.generate job without its uploaded bill (payload.rawText) for a caller without boq:read (payloadWithheld says so).",
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
    summary: "Read one background job. Read under the read permission of the job's module; a schedule.generate job comes without its uploaded bill (payload.rawText) to a caller without boq:read, and payloadWithheld names what was left out and why.",
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
    method: "get",
    path: "/projects/{projectId}/team/assignable",
    summary: "Colleagues who could be added to this project, with existing members marked.",
    description:
      "Everyone active in the organisation, each flagged with whether they are already on the project. The already-assigned are returned rather than filtered out, because the question at this screen is usually whether somebody is already on the job and a missing name does not answer it. This is the existing-colleague half of building a team; somebody with no account is invited by email through POST /users/invitations instead.",
    operationId: "listAssignableProjectUsers",
    parameters: [
      ...projectParams,
      {
        name: "search",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Filters on name or email.",
      },
    ],
    permissions: companyAdminPermission,
  },
  {
    method: "post",
    path: "/projects/{projectId}/team",
    summary: "Add an existing company user to this project.",
    description:
      "Writes the same ProjectAssignment that accepting an invitation writes, so project access and permission templates behave exactly as they already did — this is a way in, not a second access model. The project role defaults to the role the person carries in the organisation, which is right nearly always, but may be overridden: a planner brought onto a job to run cost control can be assigned as one without changing who they are elsewhere. Adding somebody already on the project changes their role and answers 200 rather than 201. Refused with USER_NOT_IN_ORGANISATION for anyone outside the company — an external party joins through ProjectParty, which has its own invitation and visibility rules — and with USER_NOT_ACTIVE for a suspended account.",
    operationId: "addProjectMember",
    parameters: projectParams,
    permissions: companyAdminPermission,
    requestBody: jsonBody(ref("ProjectMemberRequest"), "The colleague, and optionally their role here."),
    status: 201,
  },
  {
    method: "delete",
    path: "/projects/{projectId}/team/{userId}",
    summary: "Take somebody off this project.",
    description:
      "Removes the project assignment and the permission template granted for this project. Their company account, their access to every other project, and everything they authored here are untouched: a project record that quietly loses its author is worse than one belonging to somebody who has moved on. Refused with PROJECT_MEMBER_NOT_FOUND if they were not on the project.",
    operationId: "removeProjectMember",
    parameters: [projectIdParam, userIdParam],
    permissions: companyAdminPermission,
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
  "/projects/{projectId}/attachments/search",
  "get",
  operation({
    tag: "Attachments",
    summary: "Search the project's attachments across records, for reuse as evidence (Phase 22B).",
    description:
      "Matches file name, caption, record reference and title on the newest attachments the caller may see (record-type permission and record visibility both apply). One row per document; deep link on the record.",
    operationId: "searchProjectAttachments",
    parameters: [
      ...projectParams,
      queryParam("q", "Text to match (file name, caption, record reference or title).", { type: "string" }),
      queryParam("limit", "Rows to return (1–100, default 25).", { type: "integer" }),
    ],
    permissions: authenticatedOnly,
    responseSchema: ref("GenericObject"),
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
          enum: ["attachment", "evidence", "photo", "reference", "signature"],
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
      "Comment on any record. @mentions notify the named users (category `mention`); other followers get a `comment` notification. The author and mentioned users start following the record. On a BOQ record (boq_item) only people who may read the BOQ on the project are notified; the answer's notNotified names the others (names only).",
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
    summary: "Edit your own comment (marks it edited; newly mentioned users are notified — on a BOQ record only those who may read the BOQ, the rest named in notNotified).",
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
    description: `\`changeOrder\` is the change order as the register returns it. ${changeOrderLinkWithholding}`,
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
  activityBudgetsWithheld: { type: "boolean", enum: [true], description: "Present (true) when each activity's allocation is withheld from this caller (owner decision E1)." },
  activityBudgetsReason: { type: "string", description: "Why: \"Mapping details unavailable to you\"." },
});
// Owner decision E1 (2026-09-28), as utils/boq-figures applies it to the reconciliation.
const BUDGET_RECONCILIATION_FIGURES =
  "Each activity's boqBudget is its approved BOQ allocation, and its activityBudget and difference are built from it; they, mismatches and activitiesWithoutLines are present only for a caller who may read the BOQ — reading the cost module does not override this (owner decision E1, 2026-09-28). For anyone else each activity keeps activityId, name, code, approvedChanges and budgetFromLines, and the answer carries activityBudgetsWithheld: true and activityBudgetsReason \"Mapping details unavailable to you\". generatedAt, balanced, totals and underAllocatedLines are every cost reader's.";
const budgetSnapshotSchema = objectSchema({
  id: uuid,
  projectId: uuid,
  reportingPeriodId: nullableUuid,
  reportingPeriod: {
    ...nullableRef("GenericObject"),
    description: "id, code, label, status and the period's cutoff as the EV reports use it: cutoffDate (the instant — a locked period's as its snapshot stored it), cutoffLocalDate, timeZone, timeZoneSource and timeZoneNote.",
  },
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
    description: BUDGET_RECONCILIATION_FIGURES,
    operationId: "getBudgetReconciliation",
    parameters: projectParams,
    permissions: modulePermission("cost", "read"),
    responseSchema: budgetReconciliationSchema,
  },
  {
    method: "get",
    path: "/projects/{projectId}/budget/snapshots",
    summary: "Budget snapshots, newest first.",
    description: `Each snapshot's reconciliation is answered as GET /budget/reconciliation answers it. ${BUDGET_RECONCILIATION_FIGURES}`,
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
    description: `Its reconciliation is answered as GET /budget/reconciliation answers it. ${BUDGET_RECONCILIATION_FIGURES}`,
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
    description: "The suggestion is read off the approved BOQ allocations — each activity's amount, its share, and which activities have any — so a caller who may not read the BOQ receives no suggestion (owner decision E1, 2026-09-28): items is empty, basis is omitted, and the answer carries withheld: true and reason \"Mapping details unavailable to you\".",
    operationId: "suggestBudgetLineAllocations",
    parameters: [...projectParams, budgetLineIdParam],
    permissions: modulePermission("cost", "read"),
    responseSchema: objectSchema({ lineId: uuid, basis: { type: "string", enum: ["boq", "even"] }, items: arrayOf(objectSchema({ activityId: uuid, activity: nullableRef("GenericObject"), basisAmount: budgetMoney, weight: { type: "number" }, source: { type: "string" } })), withheld: { type: "boolean", enum: [true], description: "Present (true) when the suggestion is withheld from this caller." }, reason: { type: "string", description: "Why the suggestion is withheld." } }),
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
  lines: arrayOf(objectSchema({ description: { type: "string" }, sovLineId: { ...nullableUuid, description: "The schedule-of-values line this change modifies. Naming it raises that line's billing ceiling on the next payment application once the change is approved; without it the change adds to the contract value but no line can be billed any further. Must be a line of this commitment (400 COMMITMENT_CO_LINE_SOV_INVALID)." }, costCodeId: nullableUuid, budgetLineId: nullableUuid, activityId: nullableUuid, amount: { type: "number" } })),
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
  { method: "post", path: "/projects/{projectId}/commitments/{commitmentId}/close", summary: "Close an executed commitment. A subcontract runs the closeout gate first and is refused while anything required is outstanding (409 CLOSEOUT_OUTSTANDING, which names them); closeoutOverrideReason goes ahead anyway and is audited.", operationId: "closeCommitment", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("approve", "commitment.close"), requestBody: jsonBody(objectSchema({ closeoutOverrideReason: { type: "string", nullable: true } }), "Optional closeout override.", false), responseSchema: commitmentSchema },
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
  // Closeout (OCTA-SUB-CLOSE-056).
  { method: "get", path: "/projects/{projectId}/commitments/{commitmentId}/closeout", summary: "The closeout checklist. Four checks are derived on every read from records the system already holds — the punch list against this subcontractor, the commitment's insurance, whether the payment applications are settled, and whether retention is still held — followed by the handover documents somebody produces.", operationId: "getCommitmentCloseout", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("read") },
  { method: "patch", path: "/projects/{projectId}/commitments/{commitmentId}/closeout/items/{key}", summary: "Mark one requirement complete against evidence, or waive it with a reason. A derived check cannot be ticked (409 CLOSEOUT_DERIVED_ITEM) — close the punch items, file the certificate, pay the application — it can only be waived.", operationId: "updateCommitmentCloseoutItem", parameters: [...projectParams, commitmentIdParam, pathParam("key", "Requirement key, e.g. as_builts.", null)], permissions: commitmentPermission("update", "closeout.manage"), requestBody: jsonBody(objectSchema({ status: { type: "string", enum: ["outstanding", "complete", "waived", "not_applicable"] }, documentId: nullableUuid, note: { type: "string", nullable: true }, waivedReason: { type: "string", nullable: true, description: "Required when waiving." } }), "The requirement's new state.", false) },
  { method: "post", path: "/projects/{projectId}/commitments/{commitmentId}/closeout/complete", summary: "Stamp the closeout complete. Refused while anything required is outstanding (409 CLOSEOUT_OUTSTANDING, which names them); overrideReason goes ahead anyway and is audited.", operationId: "completeCommitmentCloseout", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("approve", "closeout.approve"), requestBody: jsonBody(objectSchema({ overrideReason: { type: "string", nullable: true } }), "Optional override.", false) },
  { method: "post", path: "/projects/{projectId}/commitments/{commitmentId}/closeout/reopen", summary: "Reopen a completed closeout with a reason.", operationId: "reopenCommitmentCloseout", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("approve", "closeout.approve"), requestBody: jsonBody(objectSchema({ reason: { type: "string" } }, ["reason"]), "Why it is being reopened.") },
  { method: "get", path: "/projects/{projectId}/commitments/{commitmentId}/evaluation", summary: "How the subcontractor performed. Six of the eight criteria are read from the records on every read — non-conformances, safety incidents and punch items raised against their company, change orders they raised themselves, how much they closed by the date it was due, and the closeout handover — and two are rated by a person. A criterion with nothing to measure (no closeout started, no due dates set) scores nothing rather than zero and drops out of the weighting, so the score measures the subcontractor rather than the project's record-keeping. Purchase orders are refused (409 EVALUATION_NOT_A_SUBCONTRACT).", operationId: "getCommitmentEvaluation", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("read") },
  { method: "patch", path: "/projects/{projectId}/commitments/{commitmentId}/evaluation/criteria/{key}", summary: "Rate one criterion, or override a derived one — which needs a reason (400 EVALUATION_OVERRIDE_REASON_REQUIRED), because a count cannot tell three non-conformances on a frame from three on a fit-out. The reading is kept beside the override as derivedScore, and clearing the score (null) puts it back.", operationId: "scoreCommitmentEvaluationCriterion", parameters: [...projectParams, commitmentIdParam, pathParam("key", "Criterion key, e.g. quality or schedule.", null)], permissions: commitmentPermission("update", "evaluation.manage"), requestBody: jsonBody(objectSchema({ score: { type: "integer", minimum: 0, maximum: 5, nullable: true }, overrideReason: { type: "string", nullable: true, description: "Required when scoring a derived criterion." }, note: { type: "string", nullable: true } }), "The score.", false) },
  { method: "patch", path: "/projects/{projectId}/commitments/{commitmentId}/evaluation", summary: "Whether you would use them again, and the written summary — the part of an evaluation that is not a score.", operationId: "setCommitmentEvaluationVerdict", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("update", "evaluation.manage"), requestBody: jsonBody(objectSchema({ wouldReuse: { type: "boolean", nullable: true }, summary: { type: "string", nullable: true } }), "The verdict.", false) },
  { method: "post", path: "/projects/{projectId}/commitments/{commitmentId}/evaluation/final", summary: "Finalise the evaluation, which is what makes it count towards the company's history and show on their next prequalification. Refused while a rated criterion is unrated or nobody has said whether they would use them again (409 EVALUATION_INCOMPLETE, which names the gaps).", operationId: "finaliseCommitmentEvaluation", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("approve", "evaluation.approve") },
  { method: "post", path: "/projects/{projectId}/commitments/{commitmentId}/evaluation/reopen", summary: "Reopen a final evaluation with a reason. The scores stay; only the decision is dropped.", operationId: "reopenCommitmentEvaluation", parameters: [...projectParams, commitmentIdParam], permissions: commitmentPermission("approve", "evaluation.approve"), requestBody: jsonBody(objectSchema({ reason: { type: "string" } }, ["reason"]), "Why it is being reopened.") },
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
const assistantMessageSchema = objectSchema({ id: uuid, role: { type: "string", enum: ["user", "assistant"] }, content: { type: "string", description: "Markdown; citations appear as [n]." }, citations: arrayOf(assistantCitationSchema), actions: arrayOf(assistantActionSchema), sources: arrayOf(ref("GenericObject")), usage: nullableRef("GenericObject"), provider: { type: "string", nullable: true }, model: { type: "string", nullable: true }, feedback: { type: "string", nullable: true, enum: ["up", "down", null] }, feedbackNote: { type: "string", nullable: true }, createdAt: nullableDateString, contentWithheld: { ...objectSchema({ reason: { type: "string" } }), description: "Present only on a stored AI run built from the BOQ's rows or the mapping (scope_gap, forecast, a report narrative over a source with mapping columns) when the reader may not read the BOQ on the run's project now: content, citations, actions and sources are then left out, and this says why." } });
const assistantConversationSchema = objectSchema({ id: uuid, projectId: nullableUuid, project: nullableRef("GenericObject"), title: { type: "string" }, lastMessageAt: nullableDateString, messageCount: { type: "integer", nullable: true }, createdAt: nullableDateString, updatedAt: nullableDateString, messages: arrayOf(assistantMessageSchema), kind: { type: "string", description: "The stored run's kind; present only beside contentWithheld." }, contentWithheld: { ...objectSchema({ reason: { type: "string" } }), description: "Present only when the conversation is a stored AI run built from the BOQ's rows or the mapping and the reader (its owner included) may not read the BOQ on its project now; every message is served without its content." } });
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
const webhookInput = objectSchema({ name: { type: "string" }, url: { type: "string", description: "https endpoint on a public address. A host that is or resolves to a loopback, private, link-local, unique-local, CGNAT or metadata address is refused with 400 WEBHOOK_TARGET_REFUSED (and checked again on every delivery); one that does not resolve with 400 WEBHOOK_URL_UNRESOLVED." }, eventTypes: arrayOf({ type: "string", description: "*, record.changed, approval.decided, notification.created, job.progress, or <entity>.<action> such as rfi.status_changed / change_order.*" }), description: { type: "string", nullable: true }, projectId: { ...uuid, nullable: true, description: "Limit to one project." }, secret: { type: "string", nullable: true, description: "Your own signing secret (≥ 16 chars); generated when omitted." }, status: { type: "string", enum: ["active", "paused"] } });
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
  columns: arrayOf(objectSchema({
    key: { type: "string" },
    label: { type: "string" },
    type: { type: "string" },
    withheld: { type: "boolean", description: "Present (true) only when this column was withheld on at least one project of the run — see `withheld`." },
    withheldReason: { type: "string", description: "Present with `withheld`: \"Mapping details unavailable to you\"." },
  })),
  rows: { ...arrayOf(ref("GenericObject")), description: "Flattened rows: id, projectId, projectName and one value per column. A row of a project where the caller may not read the BOQ carries null for each withheld column and names them in `withheldColumns`." },
  rowCount: { type: "integer" },
  total: { type: "integer" },
  truncated: { type: "boolean" },
  groupBy: nullableRef("GenericObject"),
  aggregates: arrayOf(ref("GenericObject")),
  groups: { type: "array", nullable: true, items: ref("GenericObject"), description: "An aggregate over a withheld column is null in a group holding a withheld row (and in the totals)." },
  totals: ref("GenericObject"),
  projects: objectSchema({ inScope: { type: "integer" }, queried: { type: "integer" }, denied: { type: "integer", description: "Projects skipped because the caller cannot read the source there." } }),
  withheld: {
    ...objectSchema({
      columns: arrayOf({ type: "string" }),
      reason: { type: "string" },
      projects: { type: "integer", description: "Projects of the run where the caller may not read the BOQ." },
    }),
    description: "Present only when the run uses a column that states a figure an allocation gives one activity (activity: budget; cost_record: budget, variance, cpi) and the caller may not read the BOQ on at least one of its projects (owner decision E1: cost read does not override it). Those columns are null on that project's rows, and filters, sorts, groupings and aggregates over them see the null, never the figure. Exports (XLSX, PDF), saved reports' runs, scheduled runs and /reports/ask and /reports/narrate follow the same rule; a file says so on its About sheet or header. A BOQ reader's result carries no such key.",
  },
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
// §12, as utils/boq-figures applies it to the forecast.
const FORECAST_FIGURES =
  "cost.eac is the official EV report's EAC — revised BAC / CPI when CPI > 0, otherwise the revised BAC — and cost.bac the revised BAC it was computed from (approved allocations plus approved budget revisions); cost.eacBasis says which rule applied (budget_over_cpi, budget_cpi_zero — CPI 0: actual cost with nothing earned, so the EAC is the revised BAC and dataQuality says so —, budget_no_cost_performance, no_budget; null without an EV report). The EV figures are the same answer the health card and the EV report give for the latest reporting period: when that period is locked, its stored snapshot (SPI, CPI, EAC and the cutoff instant and zone recorded at the lock), never a live recomputation. cost.projected is max(eac, bottomUp). earnedValueCutoff states the EV cutoff SPI, CPI and EAC were measured through: cutoffDate (the instant), cutoffLocalDate, timeZone, timeZoneSource and timeZoneNote (null when the project's own zone applied, otherwise the sentence also added to dataQuality: \"Project timezone is not configured; UTC is being used\" or the organisation default it names). dataQuality also carries the server's reason when SPI or CPI is missing or CPI is 0 (with no_budget: that there is no approved budget to earn against), and, when the EV cutoff is still ahead of asOf, that EV and AC are measured through today while PV runs to the cutoff. The explanation never calls a budget handed back (budget_cpi_zero, budget_no_cost_performance) or a project with no budget \"within budget\". " +
  "The cost view's money (cost.budget, bac, eac, bottomUp, projected, overrun, overrunPct and actual; each activity's cost.budget, actual, committed, projected, overrun, overrunPct and reasons; each budget line's revised, committed, actual, forecast, overrun and overrunPct) is present only for a caller who may read the BOQ or the cost module. For anyone else nothing of the cost view that is read off the BOQ mapping is given either (owner decision, 2026-09-28): an activity has a cost basis, and a cost level above low, only when it has a budget (an approved allocation), so each activity's cost (in activities and schedule.topRisks) is replaced by { withheld: true, reason: \"Cost figures are not available to you\" }; cost.topRisks, cost.counts.atRisk and cost.eacBasis are omitted, and cost carries withheld: true and the same reason. A cost reader who may not read the BOQ keeps the project's cost (cost.budget, bac, eac, eacBasis, bottomUp, projected, overrun, overrunPct, actual) and the budget lines, but nothing per activity that an approved allocation gives (owner decision E1, 2026-09-28): each activity's cost (in activities and schedule.topRisks) keeps only actual and committed (the cost ledger's) with { withheld: true, reason: \"Mapping details unavailable to you\" }; cost.topRisks and cost.counts.atRisk are omitted, and cost carries activityCostWithheld: true and activityCostReason with the same reason. The schedule view (levels, bases, counts, criticality), each budget line's name and level, cost.counts.lines, summary and dataQuality are the same for every caller.";
const forecastBlockerSchema = objectSchema({ type: { type: "string", enum: ["rfi", "submittal", "long_lead"] }, id: uuid, ref: { type: "string", nullable: true }, title: { type: "string" }, status: { type: "string", nullable: true }, due: nullableDateString, overdue: { type: "boolean" } });
const forecastActivitySchema = objectSchema({ id: uuid, name: { type: "string" }, code: { type: "string", nullable: true }, isCritical: { type: "boolean" }, isMilestone: { type: "boolean" }, status: { type: "string" }, pct: { type: "number" }, expectedPct: { type: "number", nullable: true }, gap: { type: "number" }, velocity: { type: "number", nullable: true, description: "% per day from approved progress in the last 45 days." }, lastProgressAt: nullableDateString, plannedStart: { type: "string", nullable: true }, plannedFinish: { type: "string", nullable: true }, projectedFinish: { type: "string", nullable: true }, basis: { type: "string", enum: ["complete", "planned", "velocity", "pace", "overdue", "late_start"] }, slipDays: { type: "integer" }, impactDays: { type: "number" }, float: { type: "number", nullable: true }, floatBreached: { type: "boolean" }, stalledDays: { type: "integer" }, blockers: arrayOf(forecastBlockerSchema), score: { type: "integer" }, level: forecastLevel, reasons: arrayOf({ type: "string" }), cost: objectSchema({ budget: { type: "number" }, actual: { type: "number" }, committed: { type: "number" }, projected: { type: "number", nullable: true }, basis: { type: "string", nullable: true, description: "burn, forecast, commitments or budget; null when the activity has no budget. Omitted for a caller who reads neither the BOQ nor the cost module." }, overrun: { type: "number" }, overrunPct: { type: "number" }, level: { ...forecastLevel, description: "Omitted for a caller who reads neither the BOQ nor the cost module." }, reasons: arrayOf({ type: "string" }), withheld: { type: "boolean", description: "true when the activity's cost is withheld from this caller (it then carries only withheld and reason)." }, reason: { type: "string", description: "Why the cost is withheld." } }) });
const forecastSchema = objectSchema({ available: { type: "boolean" }, reason: { type: "string", nullable: true }, asOf: dateString, schedule: nullableRef("GenericObject"), cost: nullableRef("GenericObject"), summary: nullableRef("GenericObject"), dataQuality: arrayOf({ type: "string" }), activities: arrayOf(forecastActivitySchema) });
const forecastActionSchema = objectSchema({ type: { type: "string", enum: ["create_risk", "create_task", "open"] }, label: { type: "string" }, activityId: nullableUuid, activityName: { type: "string", nullable: true }, title: { type: "string", nullable: true }, description: { type: "string", nullable: true }, probability: { ...forecastLevel, nullable: true }, impact: { ...forecastLevel, nullable: true }, mitigation: { type: "string", nullable: true } });
[
  { method: "get", path: "/projects/{projectId}/forecast", summary: "Schedule and cost forecast from the project's own records: per-activity velocity from approved progress, projected finish vs plan, float and critical path, recorded impacts (RFI / submittal / risk / weather links), open items holding the activity, burn-rate cost projection, budget lines over; project finish = later of EV-based and activity-based, cost = higher of EAC and bottom-up. No model call. " + FORECAST_FIGURES + DEFAULT_EV_PERIOD, operationId: "getProjectForecast", parameters: projectParams, permissions: modulePermission("schedule", "read"), responseSchema: forecastSchema },
  { method: "post", path: "/projects/{projectId}/forecast/explain", summary: "Plain-language narrative of the forecast with up to five draft actions (create_risk, create_task, open); built from the forecast itself when no provider answers (`degraded`). 409 FORECAST_UNAVAILABLE without a schedule. The explanation is written from the forecast this caller receives. " + FORECAST_FIGURES, operationId: "explainProjectForecast", parameters: projectParams, permissions: modulePermission("schedule", "read"), responseSchema: objectSchema({ degraded: { type: "boolean" }, reason: { type: "string", nullable: true }, forecast: forecastSchema, narrative: objectSchema({ headline: { type: "string" }, schedule: { type: "string" }, cost: { type: "string" }, watch: arrayOf({ type: "string" }), actions: arrayOf(forecastActionSchema) }), message: nullableRef("GenericObject") }) },
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
const specBoqWithheld = { ...objectSchema({ reason: { type: "string", example: "BOQ coverage is worked from the BOQ's rows, available only to members who may read the BOQ" } }, ["reason"]), description: "Present, in place of the BOQ keys, for a caller who may not read the BOQ (boq:read): the check ran without loading the bill, so no BOQ row, row count, uncovered row, no_boq gap or BOQ count is returned." };
const specRelatedSchema = objectSchema({ boqItemsWithheld: specBoqWithheld, boqItems: arrayOf(objectSchema({ id: uuid, code: { type: "string", nullable: true }, description: { type: "string" }, unit: { type: "string", nullable: true }, qty: { type: "number" }, basis: specBasis, score: { type: "number" } })), sheets: arrayOf(objectSchema({ id: uuid, number: { type: "string" }, title: { type: "string" }, discipline: { type: "string", nullable: true }, currentRevisionId: nullableUuid, basis: specBasis, score: { type: "number" }, path: { type: "string" } })), activities: arrayOf(objectSchema({ id: uuid, name: { type: "string" }, activityCode: { type: "string", nullable: true }, wbsCode: { type: "string", nullable: true }, basis: specBasis, score: { type: "number" } })), rfis: arrayOf(objectSchema({ id: uuid, ref: { type: "string" }, subject: { type: "string" }, status: { type: "string" }, basis: specBasis, score: { type: "number" }, path: { type: "string" } })), keywords: arrayOf({ type: "string" }), disciplines: arrayOf({ type: "string" }) });
const specDocumentSchema = objectSchema({ id: uuid, title: { type: "string" }, originalName: { type: "string" }, documentNumber: { type: "string", nullable: true }, category: { type: "string", nullable: true }, discipline: { type: "string", nullable: true }, mimeType: { type: "string" }, uploadedAt: nullableDateString, wordCount: { type: "integer" }, pageCount: { type: "integer", nullable: true }, sections: { type: "integer" }, indexedAt: nullableDateString, likelySpec: { type: "boolean" } });
const specGapSchema = objectSchema({ sections: arrayOf({ ...specSectionSchema, properties: { ...specSectionSchema.properties, counts: objectSchema({ boq: { type: "integer" }, sheets: { type: "integer" }, sheetsByDiscipline: { type: "integer" }, activities: { type: "integer" }, rfis: { type: "integer" } }), gaps: arrayOf({ type: "string", enum: ["no_boq", "no_drawings", "no_activities"] }), keywords: arrayOf({ type: "string" }) } }), summary: objectSchema({ sections: { type: "integer" }, withGaps: { type: "integer" }, noBoq: { type: "integer" }, noDrawings: { type: "integer" }, noActivities: { type: "integer" }, boqItems: { type: "integer" }, uncoveredBoq: { type: "integer" }, sheets: { type: "integer" }, activities: { type: "integer" } }), uncoveredBoq: arrayOf(objectSchema({ id: uuid, code: { type: "string", nullable: true }, description: { type: "string" }, unit: { type: "string", nullable: true }, qty: { type: "number" } })), uncoveredDisciplines: arrayOf(objectSchema({ discipline: { type: "string" }, sheets: { type: "integer" } })), notes: arrayOf({ type: "string" }), computedAt: dateString, boqWithheld: specBoqWithheld });
const specSectionIdParam = pathParam("sectionId", "Specification section UUID.");
[
  { method: "get", path: "/projects/{projectId}/specifications/status", summary: "Whether an AI provider is configured for the scope review and conflict check, and the text limits (AI_SPEC_CHARS, AI_SPEC_SHEETS).", operationId: "specificationStatus", parameters: projectParams, permissions: modulePermission("document_control", "read"), responseSchema: objectSchema({ enabled: { type: "boolean" }, provider: { type: "string", nullable: true }, model: { type: "string", nullable: true }, sectionChars: { type: "integer" }, sheetLimit: { type: "integer" } }) },
  { method: "get", path: "/projects/{projectId}/specifications/documents", summary: "Every document with extracted text, with its indexed section count and whether it reads like a specification (CSI hints, name, category).", operationId: "listSpecificationDocuments", parameters: projectParams, permissions: modulePermission("document_control", "read"), responseSchema: objectSchema({ items: arrayOf(specDocumentSchema) }) },
  { method: "post", path: "/projects/{projectId}/specifications/index", summary: "Parse the given documents — or, without `documentIds`, every document whose text reads like a specification — into sections: CSI MasterFormat headings (SECTION 03 30 00 / 03 30 00 TITLE / five-digit codes), else generic SECTION n or numbered headings; table-of-contents repeats dropped; pages located in the PDF. Replaces earlier sections of each document.", operationId: "indexSpecifications", parameters: projectParams, permissions: modulePermission("document_control", "update"), requestBody: jsonBody(objectSchema({ documentIds: arrayOf(uuid) }), "Documents to index (optional).", false), responseSchema: objectSchema({ documents: arrayOf(objectSchema({ documentId: uuid, title: { type: "string", nullable: true }, sections: { type: "integer" }, dropped: { type: "integer" }, divisions: arrayOf({ type: "string" }), error: { type: "string", nullable: true } })), sections: { type: "integer" } }) },
  { method: "get", path: "/projects/{projectId}/specifications", summary: "Indexed sections with division counts; filter by text (`q` on code / title), `division` or `documentId`.", operationId: "listSpecificationSections", parameters: [...projectParams, queryParam("q", "Code or title text.", { type: "string" }), queryParam("division", "Two-digit division, e.g. 03.", { type: "string" }), queryParam("documentId", "Only sections of this document.", uuid)], permissions: modulePermission("document_control", "read"), responseSchema: objectSchema({ items: arrayOf(specSectionSchema), divisions: arrayOf(objectSchema({ division: { type: "string", nullable: true }, label: { type: "string", nullable: true }, count: { type: "integer" } })), total: { type: "integer" } }) },
  { method: "get", path: "/projects/{projectId}/specifications/scope-gaps", summary: "Scope coverage of every indexed section against the BOQ, the current sheets and the schedule (keyword, division vocabulary, CSI code prefix and discipline matching): per-section counts and gaps, BOQ items no section covers, disciplines with sheets but no specification, and notes on what could not be checked. For a caller who may not read the BOQ the check runs against the sheets and the schedule only: counts.boq, the no_boq gap, summary.noBoq / boqItems / uncoveredBoq and uncoveredBoq[] are absent and boqWithheld gives the reason.", operationId: "specificationScopeGaps", parameters: projectParams, permissions: modulePermission("document_control", "read"), responseSchema: specGapSchema },
  { method: "post", path: "/projects/{projectId}/specifications/scope-gaps/explain", summary: "The scope-gap check reviewed by the model — headline, narrative and up to four draft actions (create_task / create_rfi) — stored as a scope_gap run; the computed review is returned without a provider. Requires assistant:read as well. For a caller who may not read the BOQ the check is the withheld one (see specificationScopeGaps) and the model's prompt carries no BOQ row or count.", operationId: "explainSpecificationScopeGaps", parameters: projectParams, permissions: modulePermission("document_control", "read"), responseSchema: objectSchema({ degraded: { type: "boolean" }, reason: { type: "string", nullable: true }, gaps: specGapSchema, review: objectSchema({ headline: { type: "string" }, narrative: { type: "string" }, actions: arrayOf(ref("GenericObject")) }), message: nullableRef("GenericObject") }) },
  { method: "get", path: "/projects/{projectId}/specifications/{sectionId}", summary: "One section with its text (`maxChars`, default 20,000) and the related BOQ items, sheets, activities and RFIs with the basis of each match. For a caller who may not read the BOQ related.boqItems is absent and related.boqItemsWithheld gives the reason.", operationId: "getSpecificationSection", parameters: [...projectParams, specSectionIdParam, queryParam("maxChars", "Characters of text to return (500–200,000).", { type: "integer", minimum: 500, maximum: 200000 })], permissions: modulePermission("document_control", "read"), responseSchema: { ...specSectionSchema, properties: { ...specSectionSchema.properties, text: { type: "string" }, truncated: { type: "boolean" }, totalChars: { type: "integer" }, related: specRelatedSchema } } },
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
  certificationRevision: {
    type: "integer",
    description:
      "How many times this application's certification has been revoked and re-issued. Part of the ledger's idempotency key, so a corrected certificate posts as its own economic event rather than being taken for a duplicate of the one that was reversed.",
  },
  revokedReason: { type: "string", nullable: true },
  revokedAt: nullableDateString,
  revocable: {
    type: "boolean",
    description:
      "Whether the certification can still be taken back — approved, with nothing paid against it.",
  },
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
  { method: "post", path: "/projects/{projectId}/pay-apps/{payAppId}/reopen", summary: "Return an application to draft. From rejected this is an ordinary resubmission. From approved it revokes the certificate: the certified cost is reversed on the ledger with negative mirrors (nothing is deleted), `certificationRevision` is bumped so the corrected re-certification posts as its own event, and a reason is required (400 SUB_PAY_APP_REASON_REQUIRED). Refused once any of it has been paid (409 SUB_PAY_APP_ALREADY_PAID) — correct a paid certificate on the next application or with a credit.", operationId: "reopenSubPayApp", parameters: [...projectParams, payAppIdParam], permissions: payAppPermission("update"), requestBody: jsonBody(objectSchema({ reason: { type: "string", nullable: true, maxLength: 2000, description: "Required when revoking a certification." } }), "Revocation reason."), responseSchema: payAppSchema },
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
    path: "/company/vendors/duplicates",
    summary:
      "Companies in the directory that are probably the same company (OCTA-ADM-DEDUPE-061), grouped by normalised name — case, punctuation and spacing folded, legal form deliberately not. **Reports, never merges**: moving commitments, prequalifications, evaluations and insurance between legal entities is a decision for a person. `keepSuggestion` is the record carrying the most history, because that is the one whose loss would cost the most.",
    operationId: "getVendorDuplicates",
    parameters: [],
    permissions: companyAdminPermission,
    responseSchema: ref("VendorDuplicateReport"),
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
    path: "/company/prequalification",
    summary:
      "Every vendor's prequalification state, with the ones expiring soon called out. \"expired\" is derived from the validity date and from criteria that carry their own expiry, so a qualification granted on cover that lapses stops counting the day it lapses.",
    operationId: "listVendorPrequalification",
    parameters: [queryParam("withinDays", "Horizon for \"expiring soon\" (default 60).", { type: "integer" })],
    permissions: authenticatedOnly,
    responseSchema: ref("PrequalOverview"),
  },
  {
    method: "get",
    path: "/company/vendors/{id}/performance",
    summary:
      "What this subcontractor's finished subcontracts said about them: every evaluation, and the average across the finalised ones with how often the team said they would use them again. This is the history that shows on their next prequalification.",
    operationId: "getVendorPerformance",
    parameters: [companyIdParam],
    permissions: authenticatedOnly,
    responseSchema: ref("VendorPerformance"),
  },
  {
    method: "get",
    path: "/company/vendors/{id}/prequalification",
    summary:
      "One vendor's assessment: nine weighted criteria out of five, the weighted score out of 100, what the score recommends, and what is still stopping a decision. Created with all nine criteria listed and unscored on first read.",
    operationId: "getVendorPrequalification",
    parameters: [companyIdParam],
    permissions: authenticatedOnly,
    responseSchema: ref("VendorPrequalification"),
  },
  {
    method: "patch",
    path: "/company/vendors/{id}/prequalification/criteria/{key}",
    summary:
      "Score one criterion. An expiry date is only accepted on the criteria that carry one (insurance, licences). A decided assessment has to be reopened first.",
    operationId: "scoreVendorPrequalCriterion",
    parameters: [companyIdParam, pathParam("key", "Criterion key, e.g. financial_capacity.", "string")],
    permissions: companyAdminPermission,
    requestBody: jsonBody(ref("PrequalCriterionRequest"), "Score, note, reference or expiry."),
    responseSchema: ref("VendorPrequalification"),
  },
  {
    method: "post",
    path: "/company/vendors/{id}/prequalification/decision",
    summary:
      "Record the decision. Every required criterion must be scored; an approval needs a validity date, a conditional approval its conditions, a rejection its reason. The score's recommendation is stored with the decision, so a decision against it stays visible.",
    operationId: "decideVendorPrequalification",
    parameters: [companyIdParam],
    permissions: companyAdminPermission,
    requestBody: jsonBody(ref("PrequalDecisionRequest"), "The decision."),
    responseSchema: ref("VendorPrequalification"),
  },
  {
    method: "post",
    path: "/company/vendors/{id}/prequalification/reopen",
    summary: "Reopen a decided assessment for renewal or new evidence. The scores stay; the decision is dropped.",
    operationId: "reopenVendorPrequalification",
    parameters: [companyIdParam],
    permissions: companyAdminPermission,
    requestBody: jsonBody(objectSchema({ reason: { type: "string", maxLength: 500 } }, ["reason"]), "Why."),
    responseSchema: ref("VendorPrequalification"),
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
    summary:
      "Issue stock to site against an activity or cost code. The issue posts consumption to the cost ledger at the item's **weighted average** (OCTA-FIN-LEDGER-059), so the cost ledger and the stock ledger reconcile line for line. Refused with 409 `INV_INSUFFICIENT_AVAILABLE` when the quantity exceeds available stock — on hand less what is reserved.",
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

add(
  "/inventory/stock/reserve",
  "post",
  operation({
    tag: "Inventory",
    summary:
      "Reserve stock, or give it back. A positive quantity reserves, a negative one releases. Reserved stock stays on hand but stops being available, and an issue may only draw on what is available. Without a `locationId` the claim spreads across bins fullest-first, the same way an issue draws from them. Refused with 409 `INV_RESERVATION_OVER_STOCK` when more is reserved than is spare, and `INV_RESERVATION_NEGATIVE` when more is released than was held.",
    operationId: "adjustStockReservation",
    permissions: inventoryPermission("submit", "stock.issue"),
    requestBody: jsonBody(
      objectSchema({
        itemId: uuid,
        warehouseId: uuid,
        locationId: nullableUuid,
        quantity: { type: "number", description: "Positive reserves, negative releases." },
        reference: { type: "string", nullable: true },
        notes: { type: "string", nullable: true },
      }, ["itemId", "warehouseId", "quantity"]),
      "The reservation change.",
    ),
    responseSchema: objectSchema({
      itemId: uuid,
      warehouseId: uuid,
      locationId: nullableUuid,
      onHand: { type: "number" },
      reserved: { type: "number" },
      available: { type: "number" },
      reservedBy: { type: "string", nullable: true },
    }),
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

// Service health (WS1, running on AWS). These live at /api/health, outside
// /api/v1, so each operation names its own server. No authentication; bodies
// carry the release identity and never a host or an error message.
const serviceHealthServers = [{ url: "/api", description: "Current host, outside the versioned API" }];
const serviceReleaseSchema = objectSchema({
  version: { type: "string", description: "backend/package.json version." },
  sha: { type: "string", nullable: true, description: "RELEASE_GIT_SHA the image was built from." },
  builtAt: { type: "string", nullable: true, description: "RELEASE_BUILD_TIME, ISO 8601." },
  environment: { type: "string", description: "APP_ENV (production | staging), else NODE_ENV." },
});
const serviceLivenessSchema = objectSchema({
  status: { type: "string", enum: ["ok"] },
  timestamp: dateString,
  release: serviceReleaseSchema,
});
const serviceLiveness = (path, operationId, summary) =>
  add(path, "get", {
    ...operation({
      tag: "Health",
      summary,
      description:
        "Liveness: the process is up and serving HTTP. Touches nothing else, so a database outage never marks every task unhealthy at once. The load balancer checks GET /api/health. Every response from the API carries the X-OctaPM-Release header (the commit, or the package version locally).",
      operationId,
      security: false,
      responseSchema: serviceLivenessSchema,
    }),
    servers: serviceHealthServers,
  });

add("/health", "get", {
  ...operation({
    tag: "Health",
    summary: "The load balancer's health check.",
    description:
      "Touches nothing but the process, so a database outage never marks every task unhealthy at once. Answers 503 SERVICE_NOT_READY while the task is shutting down, so the load balancer stops sending it new requests; /api/health/live stays 200 until the process exits. Every response from the API carries the X-OctaPM-Release header (the commit, or the package version locally).",
    operationId: "getServiceHealth",
    security: false,
    responses: {
      200: jsonResponse("Up and taking requests.", serviceLivenessSchema),
      503: errorResponse("SERVICE_NOT_READY: the task is shutting down."),
    },
  }),
  servers: serviceHealthServers,
});
serviceLiveness("/health/live", "getServiceLiveness", "Liveness probe: 200 while the process is alive, draining or not.");
add("/health/ready", "get", {
  ...operation({
    tag: "Health",
    summary: "Readiness probe: the database answers and the process is not draining.",
    description:
      "Runs SELECT 1 against the database, abandoned after HEALTH_DB_TIMEOUT_MS (default 2000). Answers 503 SERVICE_NOT_READY when the database does not answer in time or the process is shutting down; the details hold only booleans, latencies and the release. For deploy gates and alarms, not for the load balancer.",
    operationId: "getServiceReadiness",
    security: false,
    responses: {
      200: jsonResponse(
        "Ready.",
        objectSchema({
          status: { type: "string", enum: ["ready"] },
          timestamp: dateString,
          checks: objectSchema({
            database: objectSchema({ ok: { type: "boolean" }, latencyMs: { type: "integer" } }),
          }),
          release: serviceReleaseSchema,
        }),
      ),
      503: errorResponse("SERVICE_NOT_READY: the database did not answer in time, or the process is draining."),
    },
  }),
  servers: serviceHealthServers,
});

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
      name: "Workspaces",
      description:
        "Workspaces as things that are made and change kind (ENT-6): a further company workspace for a signed-in identity, and personal → company conversion. Entering a workspace is POST /auth/workspaces/{orgId}/session under Auth.",
    },
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
      name: "Structure",
      description:
        "Project-controls structure: the project WBS (nodes populated from schedule imports, editable, with work-package flags) and the organisation's units of measure with normalisation.",
    },
    {
      name: "Jobs",
      description:
        "Durable background jobs (BOQ AI, schedule generation) stored in PostgreSQL and processed by workers with retry, heartbeat recovery, and TTL pruning. See docs/qa/background-jobs.md.",
    },
    {
      name: "Realtime",
      description:
        "Not a REST surface. Authenticated socket.io transport at the API origin: a socket joins user:{userId}, org:{orgId} and member:{membershipId} rooms on connect (`realtime.ready` carries userId, orgId and membershipId); clients send `project:join { projectId }` (acknowledged after the same project access check as REST) and receive `domain.event` messages of type record.changed, approval.decided, notification.created, or job.progress. Events addressed to people are delivered to their member room in the event's workspace only, so a person connected in another workspace does not receive them. See docs/qa/realtime-events.md.",
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
