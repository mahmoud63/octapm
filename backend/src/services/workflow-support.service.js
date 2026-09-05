const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const approvalWorkflowService = require("./approval-workflow.service");

const RECORD_TYPES = Object.freeze({
  NCR: "ncr",
  ITP: "itp",
  DEFECT: "defect",
  PUNCH_ITEM: "punch_item",
  SAFETY_INCIDENT: "safety_incident",
  MATERIAL_TEST: "material_test",
  RFI: "rfi",
  SUBMITTAL: "submittal",
  DRAWING: "drawing",
  TRANSMITTAL: "transmittal",
  CORRESPONDENCE: "correspondence",
});

const DOCUMENT_RECORD_TYPES = new Set([
  RECORD_TYPES.RFI,
  RECORD_TYPES.SUBMITTAL,
  RECORD_TYPES.DRAWING,
  RECORD_TYPES.TRANSMITTAL,
  RECORD_TYPES.CORRESPONDENCE,
]);

/**
 * Accountability references (OCTA-DATA-REFS-004). Every workflow record has
 * user ids for owner / reviewer / approver / assignee / ball-in-court and a
 * company id for the assignee. The legacy text columns (owner, reviewer,
 * approver, assignee, responsible) are kept for one release and mirrored from
 * the referenced user's name when a request sets an id without text.
 */
const USER_REF_FIELDS = Object.freeze([
  "ownerUserId",
  "reviewerUserId",
  "approverUserId",
  "assigneeUserId",
  "ballInCourtUserId",
]);
const COMPANY_REF_FIELDS = Object.freeze(["assigneeCompanyId"]);
const TEXT_MIRROR = Object.freeze({
  ownerUserId: "owner",
  reviewerUserId: "reviewer",
  approverUserId: "approver",
});

// Statuses after which nobody has to act on the record.
const CLOSED_STATUSES = new Set([
  "closed",
  "approved",
  "passed",
  "waived",
  "cancelled",
  "acknowledged",
  "archived",
  "superseded",
  "pass",
]);
// Statuses where the originator (owner / assignee) holds the ball.
const ORIGINATOR_STATUSES = new Set([
  "answered",
  "resubmit",
  "rejected",
  "in_progress",
  "fail",
  "failed",
  "reopened",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toArray = (value) => (Array.isArray(value) ? value : []);

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const maybeDate = (value) => {
  if (value === null || value === undefined || value === "") return null;
  return new Date(value);
};

const normalizeTextField = (payload, existing, field) => {
  if (payload[field] === undefined) return existing?.[field] ?? null;
  return trimOrNull(payload[field]);
};

const assignmentData = (payload = {}, existing = {}) => ({
  owner: normalizeTextField(payload, existing, "owner"),
  reviewer: normalizeTextField(payload, existing, "reviewer"),
  approver: normalizeTextField(payload, existing, "approver"),
});

/**
 * Who must act next given the record's status and its references. Explicit
 * `ballInCourtUserId` in the payload always wins.
 */
const deriveBallInCourt = ({ status, refs = {} }) => {
  const normalized = String(status || "").toLowerCase();
  if (CLOSED_STATUSES.has(normalized)) return null;
  if (ORIGINATOR_STATUSES.has(normalized)) {
    return refs.assigneeUserId || refs.ownerUserId || null;
  }
  return (
    refs.reviewerUserId ||
    refs.approverUserId ||
    refs.assigneeUserId ||
    refs.ownerUserId ||
    null
  );
};

/**
 * Resolves the reference fields for a create/update: validates that every id
 * belongs to the organisation, mirrors user names into the legacy text columns
 * when the request only sent ids, and derives ball-in-court.
 */
const resolveAssignmentReferences = async ({
  tx = prisma,
  orgId = null,
  projectId = null,
  payload = {},
  existing = {},
  status = undefined,
  assigneeTextField = null,
  textData = {},
}) => {
  const data = {};
  const refs = {};

  for (const field of [...USER_REF_FIELDS, ...COMPANY_REF_FIELDS]) {
    if (payload[field] !== undefined) {
      data[field] = trimOrNull(payload[field]);
    }
    refs[field] =
      payload[field] !== undefined
        ? trimOrNull(payload[field])
        : (existing?.[field] ?? null);
  }

  const requestedUserIds = [
    ...new Set(USER_REF_FIELDS.map((field) => data[field]).filter(Boolean)),
  ];
  const requestedCompanyIds = [
    ...new Set(COMPANY_REF_FIELDS.map((field) => data[field]).filter(Boolean)),
  ];

  let resolvedOrgId = orgId;
  if (
    !resolvedOrgId &&
    projectId &&
    (requestedUserIds.length || requestedCompanyIds.length) &&
    tx.project?.findFirst
  ) {
    const project = await tx.project.findFirst({
      where: { id: projectId },
      select: { orgId: true },
    });
    resolvedOrgId = project?.orgId || null;
  }

  const usersById = new Map();
  if (requestedUserIds.length && tx.user?.findMany) {
    const users = await tx.user.findMany({
      where: {
        id: { in: requestedUserIds },
        ...(resolvedOrgId ? { orgId: resolvedOrgId } : {}),
      },
      select: { id: true, name: true, email: true },
    });
    for (const user of users) usersById.set(user.id, user);
    const missing = requestedUserIds.filter((id) => !usersById.has(id));
    if (missing.length) {
      throw new HttpError(
        400,
        "ASSIGNMENT_USER_NOT_FOUND",
        "One or more assigned users were not found in this organisation",
      );
    }
  }

  if (requestedCompanyIds.length && tx.company?.findMany) {
    const companies = await tx.company.findMany({
      where: {
        id: { in: requestedCompanyIds },
        ...(resolvedOrgId ? { orgId: resolvedOrgId } : {}),
      },
      select: { id: true },
    });
    const found = new Set(companies.map((company) => company.id));
    const missing = requestedCompanyIds.filter((id) => !found.has(id));
    if (missing.length) {
      throw new HttpError(
        400,
        "ASSIGNMENT_COMPANY_NOT_FOUND",
        "The assigned company was not found in this organisation",
      );
    }
  }

  // Mirror names into the legacy text columns when only ids were supplied.
  for (const [idField, textField] of Object.entries(TEXT_MIRROR)) {
    if (data[idField] && payload[textField] === undefined) {
      const user = usersById.get(data[idField]);
      if (user?.name) textData[textField] = user.name;
    }
  }
  if (
    assigneeTextField &&
    data.assigneeUserId &&
    payload[assigneeTextField] === undefined
  ) {
    const user = usersById.get(data.assigneeUserId);
    if (user?.name) textData[assigneeTextField] = user.name;
  }

  if (payload.ballInCourtUserId === undefined && status !== undefined) {
    data.ballInCourtUserId = deriveBallInCourt({ status, refs });
  }

  return { ...textData, ...data };
};

/**
 * Text assignments (legacy) plus validated user/company references.
 * Drop-in replacement for `...assignmentData(payload, existing)` inside a
 * transaction: `...(await workflowAssignmentData({ tx, orgId, projectId, payload, existing, status }))`.
 */
const workflowAssignmentData = async ({
  tx = prisma,
  orgId = null,
  projectId = null,
  payload = {},
  existing = {},
  status = undefined,
  assigneeTextField = null,
}) =>
  resolveAssignmentReferences({
    tx,
    orgId,
    projectId,
    payload,
    existing,
    status,
    assigneeTextField,
    textData: assignmentData(payload, existing),
  });

const PARTY_ASSIGNMENT_FIELDS = [
  ["ownerPartyId", "owner"],
  ["reviewerPartyId", "reviewer"],
  ["approverPartyId", "approver"],
];

const workflowPartyAssignmentData = async ({
  tx = prisma,
  orgId = null,
  projectId,
  payload = {},
  existing = {},
  status = undefined,
}) => {
  const data = assignmentData(payload, existing);
  const requested = PARTY_ASSIGNMENT_FIELDS.filter(
    ([field]) => payload[field] !== undefined,
  );

  if (requested.length) {
    const requestedIds = requested
      .map(([field]) => trimOrNull(payload[field]))
      .filter(Boolean);
    const uniqueIds = [...new Set(requestedIds)];

    const partyRows = uniqueIds.length
      ? await tx.projectParty.findMany({
          where: {
            id: { in: uniqueIds },
            projectId,
            status: "active",
          },
          include: {
            company: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        })
      : [];
    const partiesById = new Map(partyRows.map((row) => [row.id, row]));
    const missing = uniqueIds.filter((id) => !partiesById.has(id));

    if (missing.length) {
      throw new HttpError(
        400,
        "WORKFLOW_PROJECT_PARTY_NOT_FOUND",
        "One or more routed project parties were not found in this project",
      );
    }

    for (const [partyField, textField] of requested) {
      const partyId = trimOrNull(payload[partyField]);
      data[partyField] = partyId;

      if (partyId && payload[textField] === undefined) {
        data[textField] = partiesById.get(partyId)?.company?.name || null;
      }
    }

    // A routed party implies the assignee company unless one was given.
    if (payload.assigneeCompanyId === undefined) {
      const routed =
        partiesById.get(trimOrNull(payload.reviewerPartyId)) ||
        partiesById.get(trimOrNull(payload.ownerPartyId));
      if (routed?.companyId) data.assigneeCompanyId = routed.companyId;
    }
  }

  return resolveAssignmentReferences({
    tx,
    orgId,
    projectId,
    payload,
    existing,
    status,
    textData: data,
  });
};

/** User ids a record is accountable to (for notifications and "my items"). */
const assignmentUserIds = (record = {}) => [
  ...new Set(
    USER_REF_FIELDS.map((field) => record?.[field]).filter(
      (value) => value && UUID_PATTERN.test(String(value)),
    ),
  ),
];

const normalizeActivityLinks = (payload = {}) => {
  const raw =
    payload.activityLinks !== undefined
      ? payload.activityLinks
      : payload.activityIds;

  if (raw === undefined) {
    if (payload.activityId !== undefined) {
      return payload.activityId
        ? [
            {
              activityId: trimOrNull(payload.activityId),
              relationType: "primary",
              scheduleImpactDays: 0,
              notes: null,
            },
          ]
        : [];
    }
    return null;
  }

  return toArray(raw)
    .map((entry, index) => {
      if (typeof entry === "string") {
        return {
          activityId: trimOrNull(entry),
          relationType: index === 0 ? "primary" : "affected",
          scheduleImpactDays: 0,
          notes: null,
        };
      }

      return {
        activityId: trimOrNull(entry?.activityId || entry?.id),
        relationType:
          trimOrNull(entry?.relationType) ||
          (index === 0 ? "primary" : "affected"),
        scheduleImpactDays: Number(entry?.scheduleImpactDays) || 0,
        notes: trimOrNull(entry?.notes),
      };
    })
    .filter((entry) => entry.activityId);
};

const primaryActivityIdFromPayload = (
  payload = {},
  existingActivityId = null,
) => {
  const links = normalizeActivityLinks(payload);
  if (links !== null) return links[0]?.activityId || null;
  if (payload.activityId !== undefined) return payload.activityId || null;
  return existingActivityId || null;
};

const normalizeAttachmentRefs = (value, userId = null) => {
  if (value === undefined) return null;

  return toArray(value)
    .map((entry) => ({
      fileName: trimOrNull(entry?.fileName || entry?.filename || entry?.name),
      fileUrl: trimOrNull(entry?.fileUrl || entry?.url),
      storageKey: trimOrNull(entry?.storageKey || entry?.key),
      mimeType: trimOrNull(entry?.mimeType || entry?.type),
      sizeBytes:
        entry?.sizeBytes !== undefined || entry?.size !== undefined
          ? Number(entry.sizeBytes ?? entry.size) || 0
          : null,
      description: trimOrNull(entry?.description),
      uploadedBy: trimOrNull(entry?.uploadedBy) || userId || null,
      uploadedAt: maybeDate(entry?.uploadedAt) || new Date(),
    }))
    .filter((entry) => entry.fileUrl || entry.storageKey || entry.fileName);
};

const normalizeRevisionRefs = (payload = {}, row = {}, userId = null) => {
  const explicit =
    payload.revisions !== undefined ? toArray(payload.revisions) : null;
  const rows = [];

  if (explicit) {
    rows.push(
      ...explicit
        .map((entry) => ({
          projectDocumentId: trimOrNull(
            entry?.projectDocumentId || entry?.documentId,
          ),
          revision: trimOrNull(entry?.revision),
          status: trimOrNull(entry?.status),
          title: trimOrNull(entry?.title || entry?.fileName || entry?.name),
          fileName: trimOrNull(
            entry?.fileName || entry?.filename || entry?.name,
          ),
          fileUrl: trimOrNull(entry?.fileUrl || entry?.url),
          storageKey: trimOrNull(
            entry?.storageKey ||
              entry?.key ||
              entry?.projectDocumentId ||
              entry?.documentId,
          ),
          isLatest: Boolean(entry?.isLatest),
          issuedBy: trimOrNull(entry?.issuedBy) || userId || null,
          issuedAt: maybeDate(entry?.issuedAt) || new Date(),
          approvedBy: trimOrNull(entry?.approvedBy),
          approvedAt: maybeDate(entry?.approvedAt),
          supersededBy: trimOrNull(entry?.supersededBy),
          supersededAt: maybeDate(entry?.supersededAt),
          notes: trimOrNull(entry?.notes),
        }))
        .filter((entry) => entry.revision),
    );
  }

  const revision = trimOrNull(payload.revision ?? row.revision);
  if (revision) {
    rows.push({
      projectDocumentId: trimOrNull(
        payload.projectDocumentId || payload.documentId,
      ),
      revision,
      status: trimOrNull(payload.status ?? row.status),
      title: trimOrNull(
        payload.title ?? row.title ?? row.subject ?? row.drawingNumber,
      ),
      fileName: trimOrNull(payload.fileName),
      fileUrl: trimOrNull(payload.fileUrl ?? row.fileUrl),
      storageKey: trimOrNull(
        payload.storageKey || payload.projectDocumentId || payload.documentId,
      ),
      isLatest: Boolean(payload.isLatest),
      issuedBy: trimOrNull(payload.issuedBy) || userId || null,
      issuedAt: maybeDate(payload.issuedAt || payload.issueDate) || new Date(),
      approvedBy: trimOrNull(payload.approvedBy),
      approvedAt: maybeDate(payload.approvedAt),
      supersededBy: trimOrNull(payload.supersededBy),
      supersededAt: maybeDate(payload.supersededAt),
      notes: trimOrNull(
        payload.revisionNotes || payload.notes || payload.remarks,
      ),
    });
  }

  if (!revision && row.id && DOCUMENT_RECORD_TYPES.has(row.recordType)) {
    rows.push({
      projectDocumentId: null,
      revision: "1",
      status: trimOrNull(row.status),
      title: trimOrNull(row.subject || row.title || row.ref),
      fileName: null,
      fileUrl: trimOrNull(row.fileUrl),
      storageKey: null,
      isLatest: false,
      issuedBy: userId || null,
      issuedAt: new Date(),
      approvedBy: null,
      approvedAt: null,
      supersededBy: null,
      supersededAt: null,
      notes: null,
    });
  }

  const unique = new Map();
  for (const entry of rows) {
    if (!unique.has(entry.revision)) unique.set(entry.revision, entry);
  }
  return [...unique.values()];
};

const ensureActivities = async ({ tx, projectId, links }) => {
  if (!links.length) return;
  if (!tx.activity?.findMany) return;

  const ids = [...new Set(links.map((link) => link.activityId))];
  const rows = await tx.activity.findMany({
    where: { projectId, id: { in: ids } },
    select: { id: true },
  });
  const found = new Set(rows.map((row) => row.id));
  const missing = ids.filter((id) => !found.has(id));

  if (missing.length > 0) {
    throw new HttpError(
      400,
      "WORKFLOW_ACTIVITY_NOT_FOUND",
      "One or more linked activities were not found in this project",
    );
  }
};

const syncWorkflowReferences = async ({
  tx,
  projectId,
  recordType,
  recordId,
  payload = {},
  userId = null,
}) => {
  const links = normalizeActivityLinks(payload);
  const attachments = normalizeAttachmentRefs(
    payload.attachmentRefs !== undefined
      ? payload.attachmentRefs
      : payload.attachments,
    userId,
  );

  const result = {
    activityLinkCount: null,
    attachmentCount: null,
  };

  if (links !== null) {
    await ensureActivities({ tx, projectId, links });
    await tx.workflowActivityLink.deleteMany({
      where: { projectId, recordType, recordId },
    });
    if (links.length > 0) {
      await tx.workflowActivityLink.createMany({
        data: links.map((link) => ({
          projectId,
          recordType,
          recordId,
          activityId: link.activityId,
          relationType: link.relationType,
          scheduleImpactDays: link.scheduleImpactDays,
          notes: link.notes,
        })),
        skipDuplicates: true,
      });
    }
    result.activityLinkCount = links.length;
  }

  if (attachments !== null) {
    await tx.workflowAttachment.deleteMany({
      where: { projectId, recordType, recordId },
    });
    if (attachments.length > 0) {
      await tx.workflowAttachment.createMany({
        data: attachments.map((attachment) => ({
          projectId,
          recordType,
          recordId,
          ...attachment,
        })),
      });
    }
    result.attachmentCount = attachments.length;
  }

  return result;
};

const recordWorkflowHistory = async ({
  tx,
  projectId,
  recordType,
  recordId,
  oldStatus = null,
  newStatus = null,
  comment = null,
  userId = null,
  userRole = null,
  force = false,
}) => {
  const trimmedComment = trimOrNull(comment);
  const hasStatusChange = (oldStatus || null) !== (newStatus || null);
  if (!force && !hasStatusChange && !trimmedComment) return null;
  if (!tx.workflowStatusHistory?.create) return null;

  return tx.workflowStatusHistory.create({
    data: {
      projectId,
      recordType,
      recordId,
      oldStatus: oldStatus || null,
      newStatus: newStatus || null,
      comment: trimmedComment,
      createdBy: userId || null,
      actorRole: userRole || null,
    },
  });
};

const recordDocumentRevisions = async ({
  tx,
  projectId,
  recordType,
  record,
  payload = {},
  userId = null,
}) => {
  if (!DOCUMENT_RECORD_TYPES.has(recordType)) return { revisionCount: null };
  const revisions = normalizeRevisionRefs(
    payload,
    { ...record, recordType },
    userId,
  );
  if (!revisions.length) return { revisionCount: 0 };

  await tx.documentRevision.createMany({
    data: revisions.map((revision) => ({
      projectId,
      recordType,
      recordId: record.id,
      ...revision,
    })),
    skipDuplicates: true,
  });

  return { revisionCount: revisions.length };
};

const groupByRecordId = (rows) =>
  rows.reduce((acc, row) => {
    if (!acc.has(row.recordId)) acc.set(row.recordId, []);
    acc.get(row.recordId).push(row);
    return acc;
  }, new Map());

const serializeRevision = (revision, projectId) => {
  const key = revision.projectDocumentId || revision.storageKey;
  const downloadUrl = key
    ? `/api/v1/projects/${projectId}/doc-control/revisions/${revision.id}/download`
    : null;

  return {
    ...revision,
    downloadUrl,
    fileUrl: revision.fileUrl || downloadUrl,
  };
};

const dueDateForRecord = (record) =>
  record.dueDate ||
  record.responseRequiredBy ||
  record.targetCloseBy ||
  record.inspectionDate ||
  null;

const dueAlertForRecord = (record) => {
  const due = dueDateForRecord(record);
  if (!due) return null;
  const status = String(record.status || record.result || "").toLowerCase();
  if (
    [
      "closed",
      "approved",
      "passed",
      "waived",
      "cancelled",
      "acknowledged",
    ].includes(status)
  ) {
    return null;
  }

  const dueTime = new Date(due).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil(
    (dueTime - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 0) return { severity: "overdue", days: Math.abs(diffDays) };
  if (diffDays <= 7) return { severity: "due_soon", days: diffDays };
  return null;
};

/** Loads {id,name,email} for every user referenced by the rows. */
const loadReferencedUsers = async ({ tx, rows }) => {
  const ids = [
    ...new Set(
      rows.flatMap((row) => USER_REF_FIELDS.map((field) => row?.[field])).filter(Boolean),
    ),
  ];
  if (!ids.length || !tx.user?.findMany) return new Map();
  const users = await tx.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((user) => [user.id, user]));
};

const loadReferencedCompanies = async ({ tx, rows }) => {
  const ids = [
    ...new Set(
      rows.flatMap((row) => COMPANY_REF_FIELDS.map((field) => row?.[field])).filter(Boolean),
    ),
  ];
  if (!ids.length || !tx.company?.findMany) return new Map();
  const companies = await tx.company.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(companies.map((company) => [company.id, company]));
};

const serializeUserRef = (usersById, userId) => {
  if (!userId) return null;
  const user = usersById.get(userId);
  return user
    ? { id: user.id, name: user.name, email: user.email }
    : { id: userId, name: null, email: null };
};

const serializeCompanyRef = (companiesById, companyId) => {
  if (!companyId) return null;
  const company = companiesById.get(companyId);
  return company
    ? { id: company.id, name: company.name }
    : { id: companyId, name: null };
};

/** Adds ownerUser / reviewerUser / … / assigneeCompany objects to rows. */
const attachAssignmentReferences = async ({ tx = prisma, rows }) => {
  const [usersById, companiesById] = await Promise.all([
    loadReferencedUsers({ tx, rows }),
    loadReferencedCompanies({ tx, rows }),
  ]);
  return rows.map((row) => ({
    ...row,
    ownerUser: serializeUserRef(usersById, row.ownerUserId),
    reviewerUser: serializeUserRef(usersById, row.reviewerUserId),
    approverUser: serializeUserRef(usersById, row.approverUserId),
    assigneeUser: serializeUserRef(usersById, row.assigneeUserId),
    ballInCourtUser: serializeUserRef(usersById, row.ballInCourtUserId),
    assigneeCompany: serializeCompanyRef(companiesById, row.assigneeCompanyId),
  }));
};

const attachWorkflowDetailsToRecords = async ({
  tx = prisma,
  projectId,
  recordType,
  records,
}) => {
  const rows = toArray(records);
  const ids = rows.map((row) => row.id).filter(Boolean);
  if (!ids.length) return rows;

  if (
    !tx.workflowAttachment?.findMany ||
    !tx.workflowStatusHistory?.findMany ||
    !tx.workflowActivityLink?.findMany ||
    !tx.documentRevision?.findMany
  ) {
    return rows.map((row) => ({
      ...row,
      dueDate: dueDateForRecord(row),
      dueAlert: dueAlertForRecord(row),
      attachmentRefs: [],
      attachments: [],
      activityLinks: [],
      history: [],
      approvalHistory: [],
      revisions: [],
    }));
  }

  const [
    attachments,
    history,
    activityLinks,
    revisions,
    approvalHistoryById,
    usersById,
    companiesById,
    unifiedAttachments,
  ] = await Promise.all([
    tx.workflowAttachment.findMany({
      where: { projectId, recordType, recordId: { in: ids } },
      orderBy: [{ createdAt: "asc" }],
    }),
    tx.workflowStatusHistory.findMany({
      where: { projectId, recordType, recordId: { in: ids } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    tx.workflowActivityLink.findMany({
      where: { projectId, recordType, recordId: { in: ids } },
      include: {
        activity: {
          select: {
            id: true,
            name: true,
            p6ActivityId: true,
            wbsCode: true,
            isCritical: true,
            totalFloat: true,
            startDate: true,
            endDate: true,
          },
        },
      },
      orderBy: [{ createdAt: "asc" }],
    }),
    DOCUMENT_RECORD_TYPES.has(recordType)
      ? tx.documentRevision.findMany({
          where: { projectId, recordType, recordId: { in: ids } },
          orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
        })
      : Promise.resolve([]),
    approvalWorkflowService.listEventsForRecords({
      tx,
      projectId,
      recordType,
      recordIds: ids,
    }),
    loadReferencedUsers({ tx, rows }),
    loadReferencedCompanies({ tx, rows }),
    // Unified attachments (OCTA-DOC-ATTACH-006) merged into the evidence list.
    tx.attachment?.findMany
      ? tx.attachment
          .findMany({
            where: { projectId, recordType, recordId: { in: ids } },
            include: {
              document: {
                include: {
                  photo: { include: { location: { select: { id: true, name: true, path: true } } } },
                },
              },
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          })
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const { serializeAttachment } = require("./attachment.service");
  const unifiedByRecord = groupByRecordId(
    unifiedAttachments.map((row) => ({
      ...serializeAttachment(row, projectId),
      recordId: row.recordId,
      attachmentId: row.id,
      storageKey: row.documentId,
      description: row.caption || null,
      uploadedAt: row.createdAt,
    })),
  );
  const mergeAttachments = (recordId, legacy) => {
    const unified = unifiedByRecord.get(recordId) || [];
    const unifiedKeys = new Set(unified.map((row) => row.storageKey));
    return [
      ...unified,
      ...legacy.filter((row) => !row.storageKey || !unifiedKeys.has(row.storageKey)),
    ];
  };

  const attachmentsById = groupByRecordId(attachments);
  const historyById = groupByRecordId(history);
  const activityLinksById = groupByRecordId(activityLinks);
  const revisionsById = groupByRecordId(
    revisions.map((revision) => serializeRevision(revision, projectId)),
  );
  const partyIds = [
    ...new Set(
      rows
        .flatMap((row) => [
          row.ownerPartyId,
          row.reviewerPartyId,
          row.approverPartyId,
        ])
        .filter(Boolean),
    ),
  ];
  const partyRows =
    partyIds.length && tx.projectParty?.findMany
      ? await tx.projectParty.findMany({
          where: {
            projectId,
            id: { in: partyIds },
          },
          include: {
            company: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
          },
        })
      : [];
  const partiesById = new Map(partyRows.map((party) => [party.id, party]));
  const serializeParty = (partyId) => {
    const party = partiesById.get(partyId);
    if (!party) return null;
    return {
      id: party.id,
      role: party.role,
      companyId: party.companyId,
      companyName: party.company?.name || null,
      status: party.status,
    };
  };

  return rows.map((row) => {
    const dueDate = dueDateForRecord(row);
    const rowAttachments = mergeAttachments(row.id, attachmentsById.get(row.id) || []);
    return {
      ...row,
      dueDate,
      dueAlert: dueAlertForRecord(row),
      ownerParty: serializeParty(row.ownerPartyId),
      reviewerParty: serializeParty(row.reviewerPartyId),
      approverParty: serializeParty(row.approverPartyId),
      ownerUser: serializeUserRef(usersById, row.ownerUserId),
      reviewerUser: serializeUserRef(usersById, row.reviewerUserId),
      approverUser: serializeUserRef(usersById, row.approverUserId),
      assigneeUser: serializeUserRef(usersById, row.assigneeUserId),
      ballInCourtUser: serializeUserRef(usersById, row.ballInCourtUserId),
      assigneeCompany: serializeCompanyRef(companiesById, row.assigneeCompanyId),
      attachmentRefs: rowAttachments,
      attachments: rowAttachments,
      activityLinks: activityLinksById.get(row.id) || [],
      history: historyById.get(row.id) || [],
      approvalHistory: approvalHistoryById.get(row.id) || [],
      revisions: revisionsById.get(row.id) || [],
    };
  });
};

module.exports = {
  COMPANY_REF_FIELDS,
  RECORD_TYPES,
  USER_REF_FIELDS,
  assignmentData,
  assignmentUserIds,
  attachAssignmentReferences,
  attachWorkflowDetailsToRecords,
  deriveBallInCourt,
  dueAlertForRecord,
  dueDateForRecord,
  normalizeActivityLinks,
  normalizeAttachmentRefs,
  primaryActivityIdFromPayload,
  recordDocumentRevisions,
  recordWorkflowHistory,
  resolveAssignmentReferences,
  syncWorkflowReferences,
  trimOrNull,
  workflowAssignmentData,
  workflowPartyAssignmentData,
};
