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
  "Project UUID scoped to the authenticated organization and, for non-PM roles, an assigned project membership.",
);
const activityIdParam = pathParam("activityId", "Activity UUID.");
const idParam = pathParam("id", "Record UUID.");

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
  note: "Authenticated users are tenant-scoped by org_id middleware/service filters. Project routes also require an assigned ProjectAssignment unless the caller has org-wide PM access.",
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
    "Authenticated user lacks the required role, module/action permission, or project assignment.",
  ),
  404: errorResponse("Record, route, or async job was not found."),
  409: errorResponse(
    "Business rule conflict, such as duplicate or capacity violations.",
  ),
  422: errorResponse("Semantically invalid payload."),
  500: errorResponse("Unexpected server error."),
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
    SuccessEnvelope: successEnvelope(),
    ErrorEnvelope: objectSchema(
      {
        success: { type: "boolean", enum: [false] },
        error: ref("ApiError"),
      },
      ["success", "error"],
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
        "AI_LIMIT_REACHED",
        "ALLOCATION_NOT_EDITABLE",
        "ALREADY_ACTIVE",
        "ALREADY_INACTIVE",
        "AUTH_REQUIRED",
        "BOQ_ITEM_CODE_REQUIRED",
        "BOQ_BASELINE_LOCKED",
        "BOQ_ITEM_HAS_LINKED_ALLOCATIONS",
        "BOQ_ITEM_INACTIVE",
        "BOQ_ITEM_NOT_DELETABLE",
        "BOQ_ITEM_NOT_FOUND",
        "BOQ_VALIDATION_FAILED",
        "CARD_DECLINED",
        "CONFIG_ERROR",
        "CONFLICT",
        "COST_RECORD_NOT_FOUND",
        "CPM_DEPENDENCY_CYCLE",
        "DAILY_REPORT_NOT_FOUND",
        "DEFECT_NOT_FOUND",
        "DOWNGRADE_NOT_ALLOWED",
        "DRAWING_NOT_FOUND",
        "EMAIL_EXISTS",
        "EMPTY_FILE",
        "ENTERPRISE_VIA_SALES",
        "EOT_CLAIM_NOT_FOUND",
        "EQUIPMENT_NOT_FOUND",
        "FILE_NOT_AVAILABLE",
        "FILE_NOT_FOUND",
        "FILE_PARSE_ERROR",
        "FILE_TOO_LARGE",
        "FILE_TYPE_MISMATCH",
        "FILE_VIRUS_DETECTED",
        "FORBIDDEN",
        "INTERNAL_ERROR",
        "INVALID_ALLOCATION_VALUES",
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
        "INVALID_REFRESH_TOKEN",
        "INVALID_ROLE",
        "INVALID_SEATS_BAND",
        "INVALID_TOKEN",
        "INVALID_UNIT",
        "IPC_ITEM_NOT_FOUND",
        "IPC_ALLOCATION_AMOUNT_EXCEEDED",
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
        "IPC_RETENTION_RELEASE_AMOUNT_REQUIRED",
        "IPC_RETENTION_RELEASE_EXCEEDS_HELD",
        "ISSUED_QTY_EXCEEDS_RECEIVED",
        "ITP_NOT_FOUND",
        "JOB_ACCESS_DENIED",
        "JOB_NOT_FOUND",
        "LONG_LEAD_NOT_FOUND",
        "MATERIAL_HAS_PROCUREMENT_ACTIVITY",
        "MATERIAL_NOT_FOUND",
        "MATERIAL_USAGE_EXCEEDS_ISSUED_QTY",
        "MISSING_FIELDS",
        "NCR_NOT_FOUND",
        "NO_ACTIVE_SUBSCRIPTION",
        "NO_FILE",
        "NOT_FOUND",
        "PARSE_ERROR",
        "PAYMENT_METHOD_REQUIRED",
        "PROJECT_LIMIT_REACHED",
        "PROJECT_ACCESS_DENIED",
        "PROJECT_NOT_FOUND",
        "PO_LINE_NOT_FOUND",
        "PO_LINES_REQUIRED",
        "PROCUREMENT_ACTIVITY_REQUIRED",
        "PROCUREMENT_ALERT_NOT_FOUND",
        "PROCUREMENT_ORDER_NOT_FOUND",
        "PROCUREMENT_PACKAGE_NOT_FOUND",
        "REVISION_NOT_FOUND",
        "RECEIPT_LINE_NOT_FOUND",
        "RECEIPT_LINES_REQUIRED",
        "RECEIPT_QTY_EXCEEDS_ORDERED",
        "REFRESH_SESSION_REQUIRED",
        "REFRESH_TOKEN_EXPIRED",
        "REFRESH_TOKEN_REUSED",
        "RFI_NOT_FOUND",
        "RISK_NOT_FOUND",
        "SITE_DIARY_NOT_FOUND",
        "SUBMITTAL_NOT_FOUND",
        "SUBSCRIPTION_REQUIRED",
        "SUPPLIER_NOT_FOUND",
        "TOKEN_EXPIRED",
        "TRANSMITTAL_NOT_FOUND",
        "TRIAL_NOT_AVAILABLE",
        "UNSUPPORTED_FORMAT",
        "UNSUPPORTED_DOCUMENT_TYPE",
        "UNSUPPORTED_SITE_PHOTO",
        "UNSUPPORTED_WORKFLOW_ATTACHMENT",
        "USER_INACTIVE",
        "USER_NOT_FOUND",
        "VALIDATION_ERROR",
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
            "procurement_supplier",
            "procurement_package",
            "procurement_order",
            "delivery_receipt",
            "activity_material_usage",
            "procurement_alert",
            "rfi",
            "submittal",
          ],
        },
        entityId: { type: "string" },
        action: {
          type: "string",
          enum: [
            "created",
            "updated",
            "status_changed",
            "approved",
            "rejected",
            "baseline_locked",
            "certified",
            "deleted",
            "superseded",
            "imported",
          ],
        },
        actorId: { type: "string", nullable: true },
        actorRole: { type: "string", nullable: true },
        occurredAt: dateString,
        oldStatus: { type: "string", nullable: true },
        newStatus: { type: "string", nullable: true },
        reason: { type: "string", nullable: true },
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
        activityName: { type: "string" },
        unit: { type: "string" },
        quantity: nonNegativeNumber,
        rate: money,
        dependencyType: { type: "string", enum: ["FS", "SS"], nullable: true },
        predecessorCode: { type: "string", nullable: true },
      },
      ["activityName", "unit", "quantity", "rate"],
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
          wbsCode: { type: "string", nullable: true },
          p6ActivityId: { type: "string", nullable: true },
        }),
        nullable: true,
      },
    }),
    ActivityMutation: objectSchema({
      name: { type: "string" },
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
        status: { type: "string", enum: ["pending", "approved", "rejected"] },
        scheduleImpact: { type: "integer" },
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
          enum: ["draft", "submitted", "approved", "rejected"],
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
        leadWeeks: { type: "integer", minimum: 0 },
        bufferDays: { type: "integer", minimum: 0 },
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
        installedLocation: { type: "string", nullable: true },
        notes: { type: "string", nullable: true },
      },
      ["usedQty"],
    ),
    ProcurementLeadTimeAlertUpdateRequest: objectSchema(
      {
        status: {
          type: "string",
          enum: ["open", "acknowledged", "resolved"],
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
      status: { type: "string", enum: ["open", "closed"] },
      owner: { type: "string" },
      reviewer: { type: "string" },
      approver: { type: "string" },
      activityId: nullableUuid,
      activityIds: arrayOf(uuid),
      activityLinks: arrayOf(ref("ActivityLinkInput")),
      attachments: arrayOf(ref("WorkflowAttachmentRef")),
      attachmentRefs: arrayOf(ref("WorkflowAttachmentRef")),
      comment: { type: "string" },
      statusComment: { type: "string" },
      dueDate: nullableDateString,
      closedDate: nullableDateString,
    }),
    RfiRequest: objectSchema(
      {
        subject: { type: "string" },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        status: { type: "string", enum: ["open", "answered", "closed"] },
        owner: { type: "string" },
        reviewer: { type: "string" },
        approver: { type: "string" },
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
        statusComment: { type: "string" },
        date: nullableDateString,
        dueDate: nullableDateString,
        closedDate: nullableDateString,
        lostDays: { type: "integer", minimum: 0 },
        status: { type: "string", enum: ["open", "investigating", "closed"] },
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
    responseSchema: ref("GenericObject"),
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
  "/projects",
  "get",
  operation({
    tag: "Projects",
    summary: "List projects accessible to the authenticated user.",
    description:
      "PM users receive all projects in their organization. Other roles receive only projects where they have a ProjectAssignment row.",
    operationId: "listProjects",
    parameters: [
      ...cursorParams,
      queryParam("status", "Filter by project status.", { type: "string" }),
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
      "Aggregates all organization projects for PM users and only assigned projects for non-PM users.",
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
    summary: "Delete a project.",
    operationId: "deleteProject",
    parameters: projectParams,
    permissions: rolesPermission("pm", "planning_eng"),
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
      "Creates a BOQ item, an official schedule Activity with a generated wbsCode, and a draft ActivityBoqAllocation. The allocation must be approved before it contributes to official EV, IPC, and reporting value.",
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
    permissions: modulePermission("cost", "approve"),
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
    parameters: projectParams,
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
  "/projects/{projectId}/change-orders/{id}",
  "delete",
  operation({
    tag: "Commercial",
    summary: "Delete a change order.",
    operationId: "deleteChangeOrder",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm"),
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
    ref("CommentRequest"),
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
    permissions: modulePermission(
      "procurement",
      "create",
      "supplier.manage",
    ),
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
    summary: "Post a delivery receipt and optionally issue received quantities to activities.",
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
    summary: "List lead-time alerts generated from activity need dates and delivery commitments.",
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
    summary: "Acknowledge or resolve a procurement lead-time alert.",
    operationId: "updateProcurementLeadTimeAlert",
    parameters: [
      ...projectParams,
      pathParam("alertId", "Procurement lead-time alert UUID."),
    ],
    permissions: modulePermission(
      "procurement",
      "update",
      "alert.acknowledge",
    ),
    requestBody: jsonBody(
      ref("ProcurementLeadTimeAlertUpdateRequest"),
      "Lead-time alert status payload.",
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
    enum: ["open", "answered", "closed"],
  }),
  queryParam("priority", "Filter by RFI priority.", {
    type: "string",
    enum: ["low", "normal", "high", "urgent"],
  }),
  queryParam("activityId", "Filter RFIs linked to an activity.", uuid),
  queryParam("owner", "Filter by owner text.", { type: "string" }),
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
    enum: ["pending", "under_review", "approved", "resubmit", "rejected"],
  }),
  queryParam("activityId", "Filter submittals linked to an activity.", uuid),
  queryParam("owner", "Filter by owner text.", { type: "string" }),
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
      `/projects/{projectId}/${base}/{${idName}}`,
      "delete",
      operation({
        tag: apiTag,
        summary: `Delete a ${label} record.`,
        operationId: `delete${operationBase}Record`,
        parameters: [...projectParams, pathParam(idName, `${label} UUID.`)],
        permissions: modulePermission(moduleName, "delete"),
      }),
    );
  },
);

add(
  "/projects/{projectId}/doc-control/dashboard",
  "get",
  operation({
    tag: "Document Control",
    summary:
      "Get document-control dashboard, RFI/submittal/drawing/transmittal/correspondence metrics, due alerts, and revisions.",
    operationId: "getDocControlDashboard",
    parameters: projectParams,
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
    summary: "List activity BOQ allocations.",
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
    operationId: "createActivityBoqAllocation",
    permissions: rolesPermission("pm", "planning_eng", "qs"),
    requestBody: genericPayloadBody("Allocation payload.", true),
    status: 201,
  },
  {
    method: "patch",
    path: "/projects/{projectId}/activity-boq-allocations/{id}",
    summary: "Update a draft activity BOQ allocation.",
    operationId: "updateActivityBoqAllocation",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm", "planning_eng", "qs"),
    requestBody: genericPayloadBody("Partial allocation payload."),
  },
  {
    method: "post",
    path: "/projects/{projectId}/activity-boq-allocations/{id}/submit",
    summary: "Submit an activity BOQ allocation for approval.",
    operationId: "submitActivityBoqAllocation",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm", "planning_eng", "qs"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/activity-boq-allocations/{id}/approve",
    summary: "Approve an activity BOQ allocation.",
    operationId: "approveActivityBoqAllocation",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm", "qs"),
  },
  {
    method: "post",
    path: "/projects/{projectId}/activity-boq-allocations/{id}/reject",
    summary: "Reject an activity BOQ allocation.",
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
    summary: "Record activity material usage or waste against issued quantities.",
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
  operationId: "getProjectHealth",
});

[
  {
    method: "get",
    path: "/projects/{projectId}/risks",
    summary: "List project risks.",
    operationId: "listRisks",
  },
  {
    method: "post",
    path: "/projects/{projectId}/risks",
    summary: "Create a project risk.",
    operationId: "createRisk",
    permissions: rolesPermission("pm", "planning_eng", "qs"),
    requestBody: genericPayloadBody("Risk payload.", true),
    status: 201,
  },
  {
    method: "patch",
    path: "/projects/{projectId}/risks/{id}",
    summary: "Update a project risk.",
    operationId: "updateRisk",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm", "planning_eng", "qs"),
    requestBody: genericPayloadBody("Partial risk payload."),
  },
  {
    method: "delete",
    path: "/projects/{projectId}/risks/{id}",
    summary: "Delete a project risk.",
    operationId: "deleteRisk",
    parameters: projectRecordParams,
    permissions: rolesPermission("pm", "planning_eng"),
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
      name: "Projects",
      description: "Project CRUD, setup readiness, and workspace dashboard.",
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
      description: "Project equipment master data.",
    },
    {
      name: "Audit",
      description: "Project audit history and workflow timeline APIs.",
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
  ],
  paths,
  components,
};

module.exports = { openApiSpec };
