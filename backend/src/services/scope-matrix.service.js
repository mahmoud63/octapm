const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const auditService = require("./audit.service");

/**
 * The scope and responsibility matrix (OCTA-SUB-SCOPE-054).
 *
 * Construction disputes come overwhelmingly from unclear scope boundaries: who
 * supplies the crane, who takes the waste away, who calls the inspection. Prose
 * in a contract nobody re-reads does not settle those. A row with a named party
 * against it does.
 *
 * The matrix is agreed before the subcontract is written and then carried into
 * it — entered once, printed wherever it is needed.
 */

const KINDS = Object.freeze([
  "scope",
  "responsibility",
  "inclusion",
  "exclusion",
  "clarification",
  "interface",
]);

/** Kinds that allocate work to a party; the rest are statements. */
const ALLOCATED_KINDS = Object.freeze(["scope", "responsibility"]);

const PARTIES = Object.freeze([
  "gc",
  "subcontractor",
  "by_others",
  "shared",
  "not_applicable",
]);

const PARTY_LABEL = Object.freeze({
  gc: "Main contractor",
  subcontractor: "Subcontractor",
  by_others: "By others",
  shared: "Shared",
  not_applicable: "Not applicable",
});

const STATUSES = Object.freeze(["draft", "agreed"]);

/**
 * A starter matrix.
 *
 * The rows are the ones that cause arguments on nearly every trade package, so
 * a new matrix opens with them already listed and unallocated rather than with
 * an empty table. Nobody has to remember to ask "who is doing the cleanup?" —
 * the question is already on the page, waiting for an answer.
 */
const STARTER = Object.freeze([
  { kind: "scope", section: "Supply", description: "Material supply" },
  { kind: "scope", section: "Supply", description: "Material delivery to site" },
  { kind: "scope", section: "Supply", description: "Material storage on site" },
  { kind: "scope", section: "Works", description: "Installation" },
  { kind: "scope", section: "Works", description: "Setting out" },
  { kind: "scope", section: "Works", description: "Temporary works and scaffolding" },
  { kind: "scope", section: "Works", description: "Crane and lifting" },
  { kind: "scope", section: "Works", description: "Power and water at the work face" },
  { kind: "scope", section: "Quality", description: "Testing and commissioning" },
  { kind: "scope", section: "Site", description: "Daily cleanup" },
  { kind: "scope", section: "Site", description: "Waste removal from site" },

  { kind: "responsibility", section: "Submittals", description: "Shop drawings" },
  { kind: "responsibility", section: "Submittals", description: "Material samples and approvals" },
  { kind: "responsibility", section: "Submittals", description: "Method statements" },
  { kind: "responsibility", section: "Procurement", description: "Procurement of specified materials" },
  { kind: "responsibility", section: "Quality", description: "Inspection requests" },
  { kind: "responsibility", section: "Quality", description: "Third-party testing" },
  { kind: "responsibility", section: "Quality", description: "Closing out non-conformances" },
  { kind: "responsibility", section: "Safety", description: "Personal protective equipment" },
  { kind: "responsibility", section: "Safety", description: "Task-specific risk assessments" },
  { kind: "responsibility", section: "Closeout", description: "As-built records" },
  { kind: "responsibility", section: "Closeout", description: "O&M manuals and warranties" },
]);

const trimOrNull = (value) => {
  const text = String(value ?? "").trim();
  return text ? text : null;
};

const requireText = (value, field, max = 500) => {
  const text = trimOrNull(value);
  if (!text) throw new HttpError(400, "SCOPE_TEXT_REQUIRED", `${field} is required`);
  return text.slice(0, max);
};

const serializeItem = (item) => ({
  id: item.id,
  kind: item.kind,
  section: item.section,
  description: item.description,
  responsibility: item.responsibility,
  responsibilityLabel: item.responsibility ? PARTY_LABEL[item.responsibility] : null,
  notes: item.notes,
  sortOrder: item.sortOrder,
});

/**
 * The matrix, plus what it does not yet say.
 *
 * `unallocated` is the whole point of the screen: a scope row with nobody
 * against it is the boundary that will be argued about, and it should be
 * impossible to miss before the contract is signed.
 */
const serialize = (matrix) => {
  const items = (matrix.items ?? []).map(serializeItem);
  const allocated = items.filter((item) => ALLOCATED_KINDS.includes(item.kind));
  const unallocated = allocated.filter((item) => !item.responsibility);

  const byParty = Object.fromEntries(PARTIES.map((party) => [party, 0]));
  for (const item of allocated) {
    if (item.responsibility) byParty[item.responsibility] += 1;
  }

  return {
    id: matrix.id,
    projectId: matrix.projectId,
    commitmentId: matrix.commitmentId,
    bidPackageId: matrix.bidPackageId,
    title: matrix.title,
    status: matrix.status,
    notes: matrix.notes,
    agreedAt: matrix.agreedAt?.toISOString() ?? null,
    summary: {
      total: items.length,
      allocated: allocated.length - unallocated.length,
      unallocated: unallocated.length,
      byParty,
      byKind: Object.fromEntries(
        KINDS.map((kind) => [kind, items.filter((item) => item.kind === kind).length])
      ),
    },
    items,
  };
};

const include = { items: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] } };

const loadCommitment = async ({ orgId, projectId, commitmentId }) => {
  const commitment = await prisma.commitment.findFirst({
    where: { id: commitmentId, projectId, orgId },
    select: { id: true, ref: true, title: true, type: true, status: true },
  });
  if (!commitment) throw new HttpError(404, "COMMITMENT_NOT_FOUND", "Commitment not found");
  return commitment;
};

/**
 * The matrix for a commitment, created on first read.
 *
 * A new one is seeded with the starter rows unallocated, so the questions are
 * on the page before anybody thinks to ask them.
 */
const getForCommitment = async ({ orgId, projectId, commitmentId, userId = null }) => {
  const existing = await prisma.scopeMatrix.findFirst({
    where: { commitmentId, projectId },
    include,
  });
  if (existing) return serialize(existing);

  const commitment = await loadCommitment({ orgId, projectId, commitmentId });
  const created = await prisma.scopeMatrix.create({
    data: {
      orgId,
      projectId,
      commitmentId,
      title: `${commitment.ref} — scope and responsibility`,
      createdBy: userId,
      updatedBy: userId,
      items: {
        create: STARTER.map((item, index) => ({
          orgId,
          projectId,
          kind: item.kind,
          section: item.section,
          description: item.description,
          responsibility: null,
          sortOrder: index,
        })),
      },
    },
    include,
  });
  return serialize(created);
};

const normalizeItem = (raw, index) => {
  const kind = KINDS.includes(raw.kind) ? raw.kind : "scope";
  const responsibility = trimOrNull(raw.responsibility);
  if (responsibility && !PARTIES.includes(responsibility)) {
    throw new HttpError(400, "SCOPE_PARTY_INVALID", `Unknown party "${responsibility}"`);
  }
  // A clarification does not belong to anybody: it is a statement, not work.
  if (responsibility && !ALLOCATED_KINDS.includes(kind)) {
    throw new HttpError(
      400,
      "SCOPE_PARTY_NOT_ALLOWED",
      `A ${kind} is a statement, not work to allocate`
    );
  }
  return {
    id: trimOrNull(raw.id),
    kind,
    section: trimOrNull(raw.section)?.slice(0, 80) ?? null,
    description: requireText(raw.description, "Description"),
    responsibility: ALLOCATED_KINDS.includes(kind) ? responsibility : null,
    notes: trimOrNull(raw.notes)?.slice(0, 1000) ?? null,
    sortOrder: Number.isInteger(raw.sortOrder) ? raw.sortOrder : index,
  };
};

/**
 * Replaces the matrix's rows.
 *
 * The whole list is sent, so a row removed on screen is removed here. An
 * agreed matrix is locked: re-opening it is a deliberate act, because the
 * signed contract quotes it.
 */
const replaceItems = async ({ orgId, projectId, commitmentId, userId, payload = {} }) => {
  const current = await prisma.scopeMatrix.findFirst({
    where: { commitmentId, projectId },
    select: { id: true, status: true },
  });
  if (!current) throw new HttpError(404, "SCOPE_MATRIX_NOT_FOUND", "Scope matrix not found");
  if (current.status === "agreed") {
    throw new HttpError(
      409,
      "SCOPE_MATRIX_AGREED",
      "This matrix has been agreed; reopen it before changing the scope"
    );
  }

  const rows = Array.isArray(payload.items) ? payload.items : null;
  if (!rows) throw new HttpError(400, "SCOPE_ITEMS_REQUIRED", "Send the full list of rows");
  if (rows.length > 500) {
    throw new HttpError(400, "SCOPE_TOO_MANY_ITEMS", "A matrix takes up to 500 rows");
  }
  const normalized = rows.map(normalizeItem);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.scopeMatrixItem.deleteMany({ where: { matrixId: current.id } });
    if (normalized.length) {
      await tx.scopeMatrixItem.createMany({
        data: normalized.map(({ id, ...item }) => ({
          ...item,
          orgId,
          projectId,
          matrixId: current.id,
        })),
      });
    }
    await tx.scopeMatrix.update({
      where: { id: current.id },
      data: {
        updatedBy: userId,
        ...(payload.notes !== undefined ? { notes: trimOrNull(payload.notes) } : {}),
        ...(payload.title !== undefined ? { title: requireText(payload.title, "Title", 200) } : {}),
      },
    });
    return tx.scopeMatrix.findUnique({ where: { id: current.id }, include });
  });

  await auditService
    .recordEvent({
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.COMMITMENT,
      entityId: commitmentId,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      summary: { transition: "scope.manage", rows: normalized.length },
    })
    .catch(() => null);

  return serialize(updated);
};

/**
 * Agreeing the matrix.
 *
 * Refused while any scope or responsibility row has nobody against it —
 * agreeing a matrix with holes in it is agreeing to argue later. The holes are
 * named in the error so they can be fixed rather than hunted for.
 */
const agree = async ({ orgId, projectId, commitmentId, userId }) => {
  const matrix = await prisma.scopeMatrix.findFirst({
    where: { commitmentId, projectId },
    include,
  });
  if (!matrix) throw new HttpError(404, "SCOPE_MATRIX_NOT_FOUND", "Scope matrix not found");
  if (matrix.status === "agreed") return serialize(matrix);

  const unallocated = matrix.items.filter(
    (item) => ALLOCATED_KINDS.includes(item.kind) && !item.responsibility
  );
  if (unallocated.length) {
    const error = new HttpError(
      409,
      "SCOPE_MATRIX_INCOMPLETE",
      `${unallocated.length} row${unallocated.length === 1 ? " has" : "s have"} nobody against ${
        unallocated.length === 1 ? "it" : "them"
      }`
    );
    error.details = {
      rows: unallocated.slice(0, 20).map((item) => item.description),
    };
    throw error;
  }

  const updated = await prisma.scopeMatrix.update({
    where: { id: matrix.id },
    data: { status: "agreed", agreedAt: new Date(), agreedBy: userId, updatedBy: userId },
    include,
  });

  await auditService
    .recordEvent({
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.COMMITMENT,
      entityId: commitmentId,
      action: auditService.ACTIONS.APPROVED,
      actorId: userId,
      oldStatus: "draft",
      newStatus: "agreed",
      summary: { transition: "scope.agree", rows: matrix.items.length },
    })
    .catch(() => null);

  return serialize(updated);
};

const reopen = async ({ orgId, projectId, commitmentId, userId, reason = null }) => {
  const matrix = await prisma.scopeMatrix.findFirst({
    where: { commitmentId, projectId },
    include,
  });
  if (!matrix) throw new HttpError(404, "SCOPE_MATRIX_NOT_FOUND", "Scope matrix not found");
  if (matrix.status !== "agreed") return serialize(matrix);
  if (!trimOrNull(reason)) {
    throw new HttpError(
      400,
      "SCOPE_REOPEN_REASON_REQUIRED",
      "Say why the agreed scope is being reopened"
    );
  }

  const updated = await prisma.scopeMatrix.update({
    where: { id: matrix.id },
    data: { status: "draft", agreedAt: null, agreedBy: null, updatedBy: userId },
    include,
  });

  await auditService
    .recordEvent({
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.COMMITMENT,
      entityId: commitmentId,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      oldStatus: "agreed",
      newStatus: "draft",
      reason,
      summary: { transition: "scope.reopen" },
    })
    .catch(() => null);

  return serialize(updated);
};

module.exports = {
  ALLOCATED_KINDS,
  KINDS,
  PARTIES,
  PARTY_LABEL,
  STARTER,
  STATUSES,
  agree,
  getForCommitment,
  normalizeItem,
  reopen,
  replaceItems,
  serialize,
};
