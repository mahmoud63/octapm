const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { addMoney, subtractMoney, toMoneyNumber } = require("../utils/money");
const auditService = require("./audit.service");

/**
 * Subcontract closeout (OCTA-SUB-CLOSE-056).
 *
 * The last gate before a subcontractor is paid out and the subcontract is
 * closed: punch list closed, as-builts in, O&M manuals and warranties handed
 * over, training delivered, insurance current, the account settled and the
 * final lien waiver on file.
 *
 * Half of that the system already knows. The punch list is in the punch
 * register, the insurance is on the commitment, and whether the account is
 * settled is arithmetic over the payment applications — so those checks are
 * derived on every read and cannot be ticked. What is left is the handover
 * itself: documents somebody produces, recorded against evidence.
 *
 * A required item can be waived with a reason, because retention does get
 * released against a written undertaking often enough that pretending
 * otherwise only teaches people to lie to the checklist. The waiver is stored
 * and audited, and it overrides the live answer — so it survives the thing it
 * waived changing underneath it.
 */

const MONEY_EPSILON = 0.01;

const STATUS = Object.freeze({
  OUTSTANDING: "outstanding",
  COMPLETE: "complete",
  WAIVED: "waived",
  NOT_APPLICABLE: "not_applicable",
});
const STATUSES = Object.freeze(Object.values(STATUS));

/** Statuses that satisfy a requirement. */
const SETTLED = Object.freeze([STATUS.COMPLETE, STATUS.WAIVED, STATUS.NOT_APPLICABLE]);

/**
 * The handover documents. These are rows: somebody produces them, and the
 * evidence is attached.
 */
const HANDOVER = Object.freeze([
  { key: "as_builts", label: "As-built records submitted" },
  { key: "om_manuals", label: "Operation and maintenance manuals" },
  { key: "warranties", label: "Warranties and guarantees" },
  { key: "training", label: "Training delivered", required: false },
  { key: "lien_waiver", label: "Final lien waiver" },
  { key: "spares", label: "Spares and attic stock", required: false },
]);

/** Keys the system answers for itself. A row may still waive one. */
const DERIVED_KEYS = Object.freeze([
  "punch_closed",
  "insurance_current",
  "account_settled",
  "retention_released",
]);

const trimOrNull = (value) => {
  const text = String(value ?? "").trim();
  return text ? text : null;
};

const num = (value) => toMoneyNumber(value, 0);
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

// ─── the derived half ──────────────────────────────────────────────────────

/**
 * Insurance the commitment requires, on file and not expired.
 *
 * The same reading the payment-application compliance gate uses, so a
 * subcontract cannot be closed out on cover that would have blocked its last
 * certificate.
 */
const insuranceState = (commitment) => {
  const entries = Array.isArray(commitment.insuranceJson) ? commitment.insuranceJson : [];
  const required = entries.filter((entry) => entry.required);
  const now = new Date();
  const bad = required.filter(
    (entry) => !entry.documentId || (entry.expiresAt && new Date(entry.expiresAt) < now)
  );
  return {
    ok: bad.length === 0,
    detail: bad.length
      ? `${bad.length} required cover${bad.length === 1 ? " is" : "s are"} missing or expired`
      : `${required.length} required cover${required.length === 1 ? "" : "s"} current`,
  };
};

/**
 * The punch list against this subcontractor.
 *
 * Scoped to the vendor's company rather than the whole project: closing one
 * trade's subcontract should not wait on another trade's snags.
 */
const punchState = async ({ projectId, vendorCompanyId }) => {
  if (!vendorCompanyId) {
    return { ok: true, detail: "No subcontractor company is named, so nothing is assigned" };
  }
  const open = await prisma.punchItem.count({
    where: {
      projectId,
      assigneeCompanyId: vendorCompanyId,
      status: { notIn: ["closed", "void"] },
    },
  });
  return {
    ok: open === 0,
    detail: open === 0 ? "No open punch items" : `${open} punch item${open === 1 ? "" : "s"} still open`,
  };
};

/**
 * Whether the account is finished with: everything claimed, nothing in flight.
 *
 * An application still sitting in draft or review is money the subcontractor
 * believes it is owed, and closing over it is how disputes start.
 */
const accountState = ({ commitment, payApps }) => {
  const inFlight = payApps.filter((app) =>
    ["draft", "submitted", "under_review"].includes(app.status)
  );
  if (inFlight.length) {
    return {
      ok: false,
      detail: `${inFlight.length} payment application${inFlight.length === 1 ? " is" : "s are"} still open`,
    };
  }

  const counted = payApps.filter((app) => ["approved", "paid"].includes(app.status));
  const certified = counted.reduce((sum, app) => addMoney(sum, app.grossThisPeriod), 0);
  const paid = counted.reduce((sum, app) => addMoney(sum, app.paidAmount), 0);
  const owing = round2(
    counted.reduce((sum, app) => addMoney(sum, subtractMoney(app.netThisPeriod, app.paidAmount)), 0)
  );

  if (owing > MONEY_EPSILON) {
    return { ok: false, detail: `${owing} approved and not yet paid` };
  }
  return {
    ok: true,
    detail: counted.length
      ? `${counted.length} application${counted.length === 1 ? "" : "s"} certified and paid`
      : "Nothing has been claimed",
    certified,
    paid,
  };
};

/** Retention held across the certificates, against what has been paid back. */
const retentionState = ({ payApps }) => {
  const counted = payApps.filter((app) => ["approved", "paid"].includes(app.status));
  const held = round2(
    counted.reduce((sum, app) => addMoney(sum, app.retentionThisPeriod), 0)
  );
  return {
    ok: held <= MONEY_EPSILON,
    detail:
      held <= MONEY_EPSILON
        ? "No retention is held"
        : `${held} of retention is still held and must be released`,
    held,
  };
};

// ─── assembling the checklist ──────────────────────────────────────────────

const DERIVED_LABEL = Object.freeze({
  punch_closed: "Punch list closed",
  insurance_current: "Insurance and bonds current",
  account_settled: "Payment applications settled",
  retention_released: "Retention released",
});

const loadCommitment = async ({ orgId, projectId, commitmentId }) => {
  const commitment = await prisma.commitment.findFirst({
    where: { id: commitmentId, projectId, orgId },
    select: {
      id: true,
      ref: true,
      title: true,
      type: true,
      status: true,
      currency: true,
      vendorCompanyId: true,
      insuranceJson: true,
    },
  });
  if (!commitment) throw new HttpError(404, "COMMITMENT_NOT_FOUND", "Commitment not found");
  return commitment;
};

/**
 * The closeout record, created on first read with the handover rows listed.
 *
 * Listed and outstanding, not absent: a checklist you have to remember to add
 * items to is not a checklist.
 */
const ensureCloseout = async ({ orgId, projectId, commitmentId, userId = null }) => {
  const existing = await prisma.subcontractCloseout.findFirst({
    where: { commitmentId, projectId },
    include: { items: { orderBy: [{ sortOrder: "asc" }] } },
  });
  if (existing) return existing;

  await loadCommitment({ orgId, projectId, commitmentId });
  return prisma.subcontractCloseout.create({
    data: {
      orgId,
      projectId,
      commitmentId,
      createdBy: userId,
      updatedBy: userId,
      items: {
        create: HANDOVER.map((item, index) => ({
          orgId,
          projectId,
          key: item.key,
          label: item.label,
          required: item.required !== false,
          sortOrder: index,
        })),
      },
    },
    include: { items: { orderBy: [{ sortOrder: "asc" }] } },
  });
};

const serializeItem = (item) => ({
  id: item.id,
  key: item.key,
  label: item.label,
  source: DERIVED_KEYS.includes(item.key) ? "derived" : "handover",
  required: item.required,
  status: item.status,
  detail: item.detail ?? null,
  documentId: item.documentId ?? null,
  note: item.note ?? null,
  waivedReason: item.waivedReason ?? null,
  completedAt: item.completedAt ? new Date(item.completedAt).toISOString() : null,
  sortOrder: item.sortOrder ?? 0,
});

/**
 * The whole checklist: the four derived checks, then the handover rows.
 *
 * A stored row for a derived key exists only to waive it, and when it does the
 * waiver wins — otherwise the live answer would quietly un-waive itself the
 * next time somebody raised a snag.
 */
const buildCloseout = async ({ orgId, projectId, commitmentId, userId = null }) => {
  const [commitment, record] = await Promise.all([
    loadCommitment({ orgId, projectId, commitmentId }),
    ensureCloseout({ orgId, projectId, commitmentId, userId }),
  ]);

  const payApps = await prisma.subPayApp.findMany({
    where: { commitmentId, status: { not: "void" } },
    select: {
      id: true,
      ref: true,
      status: true,
      grossThisPeriod: true,
      netThisPeriod: true,
      paidAmount: true,
      retentionThisPeriod: true,
    },
  });
  const money = payApps.map((app) => ({
    ...app,
    grossThisPeriod: num(app.grossThisPeriod),
    netThisPeriod: num(app.netThisPeriod),
    paidAmount: num(app.paidAmount),
    retentionThisPeriod: num(app.retentionThisPeriod),
  }));

  const [punch, insurance, account, retention] = [
    await punchState({ projectId, vendorCompanyId: commitment.vendorCompanyId }),
    insuranceState(commitment),
    accountState({ commitment, payApps: money }),
    retentionState({ payApps: money }),
  ];

  const storedByKey = new Map(record.items.map((item) => [item.key, item]));

  const derived = [
    ["punch_closed", punch],
    ["insurance_current", insurance],
    ["account_settled", account],
    ["retention_released", retention],
  ].map(([key, state], index) => {
    const override = storedByKey.get(key);
    // Only a waiver overrides; anything else is the live answer.
    const waived = override?.status === STATUS.WAIVED;
    return serializeItem({
      id: override?.id ?? null,
      key,
      label: DERIVED_LABEL[key],
      required: override ? override.required : true,
      status: waived ? STATUS.WAIVED : state.ok ? STATUS.COMPLETE : STATUS.OUTSTANDING,
      detail: state.detail,
      waivedReason: override?.waivedReason ?? null,
      note: override?.note ?? null,
      completedAt: override?.completedAt ?? null,
      sortOrder: index,
    });
  });

  const handover = record.items
    .filter((item) => !DERIVED_KEYS.includes(item.key))
    .map((item) => serializeItem({ ...item, sortOrder: derived.length + item.sortOrder }));

  const items = [...derived, ...handover];
  const outstanding = items.filter(
    (item) => item.required && !SETTLED.includes(item.status)
  );

  return {
    id: record.id,
    commitmentId,
    commitmentRef: commitment.ref,
    status: record.status,
    notes: record.notes,
    completedAt: record.completedAt?.toISOString() ?? null,
    currency: commitment.currency,
    ready: outstanding.length === 0,
    outstanding: outstanding.map((item) => item.label),
    summary: {
      total: items.length,
      complete: items.filter((item) => item.status === STATUS.COMPLETE).length,
      waived: items.filter((item) => item.status === STATUS.WAIVED).length,
      outstanding: outstanding.length,
      retentionHeld: retention.held ?? 0,
    },
    items,
  };
};

// ─── completing an item ────────────────────────────────────────────────────

/**
 * Marks one requirement.
 *
 * A derived check cannot be completed by hand — close the punch items, file
 * the certificate, pay the application. It can only be waived, and a waiver
 * has to say why.
 */
const updateItem = async ({ orgId, projectId, commitmentId, key, payload = {}, userId }) => {
  const record = await ensureCloseout({ orgId, projectId, commitmentId, userId });
  if (record.status === "complete") {
    throw new HttpError(
      409,
      "CLOSEOUT_COMPLETE",
      "This closeout is complete; reopen it before changing an item"
    );
  }

  const status = payload.status ?? STATUS.COMPLETE;
  if (!STATUSES.includes(status)) {
    throw new HttpError(400, "CLOSEOUT_STATUS_INVALID", "Unknown closeout status");
  }

  const isDerived = DERIVED_KEYS.includes(key);
  if (isDerived && status !== STATUS.WAIVED) {
    throw new HttpError(
      409,
      "CLOSEOUT_DERIVED_ITEM",
      `${DERIVED_LABEL[key]} is read from the records — it can be waived, but not ticked`
    );
  }

  const waivedReason = trimOrNull(payload.waivedReason ?? payload.reason);
  if (status === STATUS.WAIVED && !waivedReason) {
    throw new HttpError(
      400,
      "CLOSEOUT_WAIVER_REASON_REQUIRED",
      "Say why the requirement is being waived"
    );
  }

  const documentId = trimOrNull(payload.documentId);
  if (documentId) {
    const evidenceNotFound = () => new HttpError(404, "DOCUMENT_NOT_FOUND", "Evidence document not found");
    const document = await prisma.projectDocument.findFirst({
      where: { id: documentId, projectId },
      select: { id: true },
    });
    if (!document) throw evidenceNotFound();
    // Close-out evidence is a read grant to every reader of the commitment:
    // it names only a file the writer may read, or their own new upload
    // (certification R29). Refused as a missing file is.
    const current = prisma.closeoutItem?.findUnique
      ? await prisma.closeoutItem.findUnique({
          where: { closeoutId_key: { closeoutId: record.id, key } },
          select: { documentId: true },
        })
      : null;
    await require("./document-text.service").assertDocumentsLinkable({
      orgId,
      projectId,
      keys: [documentId],
      unchanged: [current?.documentId],
      userId,
      refuse: evidenceNotFound,
    });
  }

  const known = HANDOVER.find((item) => item.key === key);
  if (!known && !isDerived) {
    throw new HttpError(404, "CLOSEOUT_ITEM_UNKNOWN", `No closeout requirement called "${key}"`);
  }

  const data = {
    status,
    documentId,
    note: trimOrNull(payload.note),
    waivedReason: status === STATUS.WAIVED ? waivedReason : null,
    completedAt: SETTLED.includes(status) ? new Date() : null,
    completedBy: SETTLED.includes(status) ? userId : null,
  };

  await prisma.closeoutItem.upsert({
    where: { closeoutId_key: { closeoutId: record.id, key } },
    create: {
      orgId,
      projectId,
      closeoutId: record.id,
      key,
      label: known?.label ?? DERIVED_LABEL[key] ?? key,
      required: known ? known.required !== false : true,
      sortOrder: known ? HANDOVER.indexOf(known) : 0,
      ...data,
    },
    update: data,
  });

  await auditService
    .recordEvent({
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.COMMITMENT,
      entityId: commitmentId,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      reason: waivedReason,
      summary: { transition: "closeout.item", key, status },
    })
    .catch(() => null);

  return buildCloseout({ orgId, projectId, commitmentId, userId });
};

// ─── the gate ──────────────────────────────────────────────────────────────

/**
 * Refuses while anything required is outstanding, and names it.
 *
 * A PM can go ahead anyway with a reason — the alternative is that somebody
 * marks the checklist done to get past it, which loses the record of what was
 * actually outstanding. The override is audited by the caller.
 */
const assertReady = async ({ orgId, projectId, commitmentId, override = null, what = "closed" }) => {
  const closeout = await buildCloseout({ orgId, projectId, commitmentId });
  if (closeout.ready) return closeout;

  if (trimOrNull(override)) return closeout;

  const error = new HttpError(
    409,
    "CLOSEOUT_OUTSTANDING",
    `This subcontract cannot be ${what}: ${closeout.outstanding.length} closeout requirement${
      closeout.outstanding.length === 1 ? " is" : "s are"
    } outstanding`
  );
  error.details = { outstanding: closeout.outstanding };
  throw error;
};

/** Stamps the closeout complete once nothing required is left. */
const complete = async ({ orgId, projectId, commitmentId, userId, override = null }) => {
  const closeout = await assertReady({ orgId, projectId, commitmentId, override });
  if (closeout.status === "complete") return closeout;

  await prisma.subcontractCloseout.update({
    where: { id: closeout.id },
    data: {
      status: "complete",
      completedAt: new Date(),
      completedBy: userId,
      updatedBy: userId,
    },
  });

  await auditService
    .recordEvent({
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.COMMITMENT,
      entityId: commitmentId,
      action: auditService.ACTIONS.APPROVED,
      actorId: userId,
      reason: trimOrNull(override),
      oldStatus: "open",
      newStatus: "complete",
      summary: {
        transition: "closeout.complete",
        outstanding: closeout.outstanding,
        overridden: Boolean(trimOrNull(override)),
      },
    })
    .catch(() => null);

  return buildCloseout({ orgId, projectId, commitmentId });
};

const reopen = async ({ orgId, projectId, commitmentId, userId, reason }) => {
  if (!trimOrNull(reason)) {
    throw new HttpError(
      400,
      "CLOSEOUT_REOPEN_REASON_REQUIRED",
      "Say why the closeout is being reopened"
    );
  }
  const record = await ensureCloseout({ orgId, projectId, commitmentId, userId });
  await prisma.subcontractCloseout.update({
    where: { id: record.id },
    data: { status: "open", completedAt: null, completedBy: null, updatedBy: userId },
  });

  await auditService
    .recordEvent({
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.COMMITMENT,
      entityId: commitmentId,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      reason,
      oldStatus: "complete",
      newStatus: "open",
      summary: { transition: "closeout.reopen" },
    })
    .catch(() => null);

  return buildCloseout({ orgId, projectId, commitmentId });
};

module.exports = {
  DERIVED_KEYS,
  DERIVED_LABEL,
  HANDOVER,
  SETTLED,
  STATUS,
  STATUSES,
  accountState,
  assertReady,
  buildCloseout,
  complete,
  ensureCloseout,
  insuranceState,
  punchState,
  reopen,
  retentionState,
  updateItem,
};
