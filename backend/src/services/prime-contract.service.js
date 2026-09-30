const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const {
  addMoney,
  subtractMoney,
  multiplyMoney,
  toMoneyNumber,
} = require("../utils/money");
const auditService = require("./audit.service");
const { nextRef } = require("../utils/reference-number");

/**
 * The client contract, and the money it brings in (OCTA-COM-PRIME-051).
 *
 * OctaPM keeps money coming in and money going out on separate spines. Going
 * out is the commitment: subcontract or purchase order, with its own schedule
 * of values and pay applications. Coming in is this: one contract with the
 * client, whose schedule of values is the BOQ, whose progress is certified
 * period by period as an IPC, and whose certificates become invoices, payments
 * and a receivable.
 *
 * What lives here is everything the BOQ cannot say: what was originally
 * agreed, what approved client change orders have done to it, and the terms
 * that turn certified work into a sum of money — retention and its cap, the
 * advance and how it is recovered, tax, and how many days the client has.
 *
 * The single-source rule: a contract value is entered once, here. Approved
 * change orders move it by themselves. Nothing downstream — certificate,
 * forecast, cash flow — keeps its own copy.
 */

const MONEY_EPSILON = 0.01;

/** Client change orders that have actually moved the contract value. */
const APPROVED_CHANGE_STATUSES = ["approved"];
/** Raised, not yet decided: shown separately so a forecast can see it coming. */
const PENDING_CHANGE_STATUSES = ["draft", "pending"];

/**
 * Where the contract's original value came from (PrimeContract.
 * originalValueSource; owner decisions 1-3, 2026-09-29). Set by the server
 * only — never read off a request:
 *
 * - project_value: ensureContract took the project's own contract value;
 * - boq_fallback: the project had none, so ensureContract took the active
 *   BOQ's total — the bill's figure, not yet the contract's;
 * - contract_entry: a contract manager entered a different original value,
 *   or one who may also read the BOQ confirmed the fallback as it stands;
 * - unestablished: NULL, a row written before the column whose source cannot
 *   be shown.
 *
 * The first and third are established amounts. The other two are withheld
 * from a member who may not read the BOQ (utils/boq-figures).
 */
const VALUE_SOURCES = Object.freeze({
  PROJECT_VALUE: "project_value",
  CONTRACT_ENTRY: "contract_entry",
  BOQ_FALLBACK: "boq_fallback",
  UNESTABLISHED: "unestablished",
});
const ESTABLISHED_VALUE_SOURCES = Object.freeze([
  VALUE_SOURCES.PROJECT_VALUE,
  VALUE_SOURCES.CONTRACT_ENTRY,
]);

/** Refusal when the contract.manage audit record cannot be written (updateContract). */
const CONTRACT_AUDIT_UNAVAILABLE_MESSAGE =
  "The contract terms were not saved because their audit record could not be written; try again";

const valueSourceOf = (contract) =>
  (contract && contract.originalValueSource) || VALUE_SOURCES.UNESTABLISHED;
const valueEstablished = (contract) => ESTABLISHED_VALUE_SOURCES.includes(valueSourceOf(contract));

/**
 * The retention/advance provenance prerequisite (owner decision, 2026-09-29).
 *
 * A BOQ fallback, or a value whose source cannot be shown, is the bill's
 * figure, not yet the contract's. Drafting and review carry on with it; a
 * financial action that relies on the contract amount does not — certifying
 * an IPC (which locks retention against the cap, a rate of the revised value)
 * and recording an advance receipt (checked against the agreed advance, a
 * rate of the original value). Those wait until the value is established
 * through the one existing road: a contract manager enters it, or one who
 * may read the BOQ confirms it (updateContract).
 *
 * The refusal is one response, decided on the value's source alone and raised
 * before any amount is looked at, so asking again reveals nothing about the
 * withheld figure and writes nothing.
 *
 * A project whose contract row does not exist yet is judged by what
 * ensureContract would record for it — the project's own value is
 * established, the BOQ total is a fallback — without creating the row: a
 * refusal leaves no record behind, and nobody can step round the rule by not
 * having opened the contract.
 */
const CONTRACT_VALUE_NOT_ESTABLISHED_MESSAGE =
  "Establish the contract value first (Contract terms: enter it, or confirm it if you may read the BOQ)";

const assertContractValueEstablished = async ({ orgId, projectId, tx = prisma }) => {
  const contract = await tx.primeContract.findFirst({
    where: { projectId, project: { orgId } },
    select: { originalValueSource: true },
  });
  let established;
  if (contract) {
    established = valueEstablished(contract);
  } else {
    const project = await tx.project.findFirst({
      where: { id: projectId, orgId },
      select: { contractValue: true },
    });
    // Mirrors ensureContract: a non-zero project value is project_value.
    established = Boolean(num(project?.contractValue));
  }
  if (!established) {
    throw new HttpError(409, "CONTRACT_VALUE_NOT_ESTABLISHED", CONTRACT_VALUE_NOT_ESTABLISHED_MESSAGE);
  }
};

const CONTRACT_TYPES = ["lump_sum", "remeasured", "cost_plus", "gmp"];
const CONTRACT_STATUSES = ["draft", "active", "closed"];
const ADVANCE_KINDS = ["payment", "recovery"];

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const num = (value) => toMoneyNumber(value, 0);

const trimOrNull = (value) => {
  const text = String(value ?? "").trim();
  return text ? text : null;
};

const pct = (amount, rate) => round2((Number(amount) || 0) * ((Number(rate) || 0) / 100));

// ─── the contract itself ───────────────────────────────────────────────────

const serializeContract = (contract, extra = {}) => ({
  id: contract.id,
  projectId: contract.projectId,
  ref: contract.ref,
  title: contract.title,
  clientCompanyId: contract.clientCompanyId,
  client: contract.clientCompany?.name ?? null,
  contractType: contract.contractType,
  currency: contract.currency,
  originalValue: num(contract.originalValue),
  originalValueSource: valueSourceOf(contract),
  approvedChangesValue: num(contract.approvedChangesValue),
  pendingChangesValue: num(contract.pendingChangesValue),
  revisedValue: num(contract.revisedValue),
  retentionRate: contract.retentionRate,
  retentionCapRate: contract.retentionCapRate,
  advanceRate: contract.advanceRate,
  advanceAmount: num(contract.advanceAmount),
  advancePaidAmount: num(contract.advancePaidAmount),
  advanceRecoveryRate: contract.advanceRecoveryRate,
  advanceRecoveredAmount: num(contract.advanceRecoveredAmount),
  advanceOutstanding: round2(
    num(contract.advancePaidAmount) - num(contract.advanceRecoveredAmount)
  ),
  materialsOnSiteRate: contract.materialsOnSiteRate,
  taxRate: contract.taxRate,
  paymentTermsDays: contract.paymentTermsDays,
  startDate: contract.startDate?.toISOString() ?? null,
  completionDate: contract.completionDate?.toISOString() ?? null,
  status: contract.status,
  notes: contract.notes,
  ...extra,
});

const contractInclude = { clientCompany: { select: { id: true, name: true } } };

const loadProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
    select: {
      id: true,
      name: true,
      contractNumber: true,
      contractType: true,
      contractValue: true,
      currency: true,
      defaultRetentionRate: true,
      startDate: true,
      endDate: true,
    },
  });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

/**
 * The contract for a project, created on first read.
 *
 * A project that predates this module still has a contract value on it, and a
 * BOQ. Rather than making somebody re-key what the system already knows, the
 * first read builds the contract from the project's own metadata and the BOQ
 * total. Nothing is invented: if the project has no value recorded, the
 * original value is the BOQ, and if there is no BOQ either it is zero and
 * waiting to be filled in.
 */
const ensureContract = async ({ orgId, projectId, userId = null }) => {
  const existing = await prisma.primeContract.findFirst({
    where: { projectId, project: { orgId } },
    include: contractInclude,
  });
  if (existing) return existing;

  const project = await loadProject({ orgId, projectId });
  const boq = await prisma.boqItem.aggregate({
    where: { projectId, isActive: true },
    _sum: { amount: true },
  });
  const boqTotal = num(boq._sum?.amount);
  const projectValue = num(project.contractValue);
  const originalValue = projectValue || boqTotal;
  // Which of the two it was, recorded once, here: nothing a client sends
  // decides it.
  const originalValueSource = projectValue
    ? VALUE_SOURCES.PROJECT_VALUE
    : VALUE_SOURCES.BOQ_FALLBACK;

  // The reference is unique per organisation, so fall back off the contract
  // number to a count when two projects share one (or have none).
  const base = trimOrNull(project.contractNumber) || `PC-${project.name}`;
  let ref = base;
  for (let attempt = 2; attempt <= 50; attempt += 1) {
    const clash = await prisma.primeContract.findFirst({ where: { orgId, ref } });
    if (!clash) break;
    ref = `${base}-${attempt}`;
  }

  // Change orders that were approved before anybody opened this screen are
  // still part of the contract. Reading them at creation is the difference
  // between a contract that is built from what the system knows and one that
  // starts wrong and only corrects itself on the next change order.
  const [approved, pending] = await Promise.all([
    prisma.changeOrder.aggregate({
      where: { projectId, status: { in: APPROVED_CHANGE_STATUSES }, archivedAt: null },
      _sum: { value: true },
    }),
    prisma.changeOrder.aggregate({
      where: { projectId, status: { in: PENDING_CHANGE_STATUSES }, archivedAt: null },
      _sum: { value: true },
    }),
  ]);
  const approvedChangesValue = num(approved._sum?.value);
  const pendingChangesValue = num(pending._sum?.value);

  return prisma.primeContract.create({
    data: {
      orgId,
      projectId,
      ref,
      title: `${project.name} — client contract`,
      contractType: CONTRACT_TYPES.includes(project.contractType)
        ? project.contractType
        : "lump_sum",
      currency: project.currency || "USD",
      originalValue,
      originalValueSource,
      approvedChangesValue,
      pendingChangesValue,
      revisedValue: addMoney(originalValue, approvedChangesValue),
      retentionRate: Number.isFinite(project.defaultRetentionRate)
        ? project.defaultRetentionRate
        : 5,
      startDate: project.startDate,
      completionDate: project.endDate,
      createdBy: userId,
      updatedBy: userId,
    },
    include: contractInclude,
  });
};

/**
 * Re-reads the client change orders and moves the contract value.
 *
 * Called whenever a change order's status changes. Approved changes land on
 * the revised value; everything still in play is reported beside it rather
 * than folded in, because a forecast wants to see both and a certificate must
 * only ever be measured against what is actually approved.
 */
const recomputeChangeValues = async (tx, { orgId, projectId }) => {
  const contract = await tx.primeContract.findFirst({ where: { projectId } });
  if (!contract) return null;

  const [approved, pending] = await Promise.all([
    tx.changeOrder.aggregate({
      where: { projectId, status: { in: APPROVED_CHANGE_STATUSES }, archivedAt: null },
      _sum: { value: true },
    }),
    tx.changeOrder.aggregate({
      where: { projectId, status: { in: PENDING_CHANGE_STATUSES }, archivedAt: null },
      _sum: { value: true },
    }),
  ]);

  const approvedChangesValue = num(approved._sum?.value);
  const pendingChangesValue = num(pending._sum?.value);

  return tx.primeContract.update({
    where: { id: contract.id },
    data: {
      approvedChangesValue,
      pendingChangesValue,
      revisedValue: addMoney(num(contract.originalValue), approvedChangesValue),
    },
  });
};

const EDITABLE = [
  "title",
  "contractType",
  "currency",
  "status",
  "notes",
  "clientCompanyId",
];

/**
 * Saves the contract's terms, and is the one road to an established original
 * value (owner decisions 1-3, 2026-09-29). Admitted on ipc:update
 * contract.manage.
 *
 * - Entering an original value that differs from the stored one records it as
 *   contract_entry. Sending the stored value back (a form saving its terms)
 *   changes nothing about where the value came from.
 * - `confirmOriginalValue: true` confirms the stored BOQ fallback (or an
 *   unestablished value) as the contract's, unchanged. That reveals the
 *   bill's total, so the caller must also be able to read the BOQ on the
 *   project (`canConfirmFallback`, decided by the route); it cannot be
 *   combined with entering a value, and an established value has nothing to
 *   confirm.
 *
 * Either is recorded by the existing contract.manage audit event — its
 * actor and time, the source before and after, and which it was. The event is
 * written inside the update's transaction: if it cannot be written, nothing
 * is saved and the request answers 503 CONTRACT_AUDIT_UNAVAILABLE.
 */
const updateContract = async ({ orgId, projectId, userId, payload = {}, canConfirmFallback = false }) => {
  const contract = await ensureContract({ orgId, projectId, userId });
  const data = { updatedBy: userId };
  let valueConfirmation = null;

  if (payload.confirmOriginalValue === true) {
    if (payload.originalValue !== undefined) {
      throw new HttpError(
        400,
        "CONTRACT_VALUE_CONFIRM_CONFLICT",
        "Confirm the stored original value or enter a new one, not both"
      );
    }
    if (!canConfirmFallback) {
      throw new HttpError(
        403,
        "CONTRACT_VALUE_CONFIRM_FORBIDDEN",
        "Confirming the original value as it stands needs BOQ read access on this project; enter the contract value instead"
      );
    }
    if (valueEstablished(contract)) {
      throw new HttpError(
        409,
        "CONTRACT_VALUE_ALREADY_ESTABLISHED",
        "The original value is already established; there is nothing to confirm"
      );
    }
    data.originalValueSource = VALUE_SOURCES.CONTRACT_ENTRY;
    valueConfirmation = "confirmed";
  }

  for (const field of EDITABLE) {
    if (payload[field] === undefined) continue;
    if (field === "contractType" && !CONTRACT_TYPES.includes(payload[field])) {
      throw new HttpError(400, "CONTRACT_TYPE_INVALID", "Unknown contract type");
    }
    if (field === "status" && !CONTRACT_STATUSES.includes(payload[field])) {
      throw new HttpError(400, "CONTRACT_STATUS_INVALID", "Unknown contract status");
    }
    data[field] = typeof payload[field] === "string" ? trimOrNull(payload[field]) : payload[field];
  }

  if (payload.originalValue !== undefined) {
    const value = num(payload.originalValue);
    if (value < 0) {
      throw new HttpError(400, "CONTRACT_VALUE_INVALID", "The contract value cannot be negative");
    }
    data.originalValue = value;
    data.revisedValue = addMoney(value, num(contract.approvedChangesValue));
    // A different amount is an entry; the stored amount sent back is a save.
    // Except where the stored amount is withheld from this caller (not
    // established, and they may not read the BOQ): whatever they send is
    // their own entry. Otherwise sending a guess would answer whether it was
    // the hidden amount (the source staying a fallback while any other amount
    // becomes an entry), and an amount they typed would stay unestablished.
    const withheldFromCaller = !valueEstablished(contract) && !canConfirmFallback;
    if (withheldFromCaller || round2(value) !== round2(num(contract.originalValue))) {
      data.originalValueSource = VALUE_SOURCES.CONTRACT_ENTRY;
      valueConfirmation = "entered";
    }
  }

  for (const [field, code] of [
    ["retentionRate", "RETENTION_RATE_INVALID"],
    ["retentionCapRate", "RETENTION_CAP_INVALID"],
    ["advanceRate", "ADVANCE_RATE_INVALID"],
    ["advanceRecoveryRate", "ADVANCE_RECOVERY_INVALID"],
    ["materialsOnSiteRate", "MATERIALS_RATE_INVALID"],
    ["taxRate", "TAX_RATE_INVALID"],
  ]) {
    if (payload[field] === undefined) continue;
    if (payload[field] === null && field === "retentionCapRate") {
      data.retentionCapRate = null;
      continue;
    }
    const rate = Number(payload[field]);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new HttpError(400, code, `${field} must be a percentage between 0 and 100`);
    }
    data[field] = rate;
  }

  if (payload.paymentTermsDays !== undefined) {
    const days = Number(payload.paymentTermsDays);
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      throw new HttpError(400, "PAYMENT_TERMS_INVALID", "Payment terms must be 0–365 days");
    }
    data.paymentTermsDays = days;
  }

  for (const field of ["startDate", "completionDate"]) {
    if (payload[field] === undefined) continue;
    data[field] = payload[field] ? new Date(payload[field]) : null;
  }

  // The advance is a percentage of the contract, so it follows the value
  // rather than being typed twice.
  const advanceRate = data.advanceRate ?? contract.advanceRate;
  const baseValue = data.originalValue ?? num(contract.originalValue);
  if (payload.advanceAmount !== undefined) {
    data.advanceAmount = num(payload.advanceAmount);
  } else if (data.advanceRate !== undefined || data.originalValue !== undefined) {
    data.advanceAmount = pct(baseValue, advanceRate);
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.primeContract.update({ where: { id: contract.id }, data });
    // Re-read the change orders while we are here. They are maintained by
    // hooks on every change-order write, but a contract that was created
    // before this module existed has never seen them, and saving the terms is
    // exactly the moment somebody would notice the total was wrong.
    await recomputeChangeValues(tx, { orgId, projectId });
    const saved = await tx.primeContract.findUnique({
      where: { id: contract.id },
      include: contractInclude,
    });

    // The contract.manage event is the evidence of who entered or confirmed
    // the contract value, and when (PC-7a, owner decision 2026-09-29). It is
    // written on the same transaction client, so the change and its audit
    // record commit together or not at all: a confirmation can never stand
    // without the record that it was made. A failed audit write fails the
    // request and rolls the change back; it is never swallowed.
    try {
      await auditService.recordEvent({
        tx,
        orgId,
        projectId,
        entityType: auditService.ENTITY_TYPES.PROJECT,
        entityId: projectId,
        action: auditService.ACTIONS.UPDATED,
        actorId: userId,
        summary: {
          transition: "contract.manage",
          ref: saved.ref,
          ...(valueConfirmation ? { originalValueConfirmation: valueConfirmation } : {}),
        },
        oldSummary: {
          originalValue: num(contract.originalValue),
          originalValueSource: valueSourceOf(contract),
          retentionRate: contract.retentionRate,
          advanceRate: contract.advanceRate,
          taxRate: contract.taxRate,
        },
        newSummary: {
          originalValue: num(saved.originalValue),
          originalValueSource: valueSourceOf(saved),
          retentionRate: saved.retentionRate,
          advanceRate: saved.advanceRate,
          taxRate: saved.taxRate,
        },
      });
    } catch (error) {
      // The client is told only that nothing was saved; the cause is for the
      // server log.
      console.error("[prime-contract-audit]", error?.code || error?.name, error?.message);
      throw new HttpError(503, "CONTRACT_AUDIT_UNAVAILABLE", CONTRACT_AUDIT_UNAVAILABLE_MESSAGE);
    }
    return saved;
  });

  return serializeContract(updated);
};

/**
 * Where the project's contract value came from, without creating the
 * contract: null when the project has none yet. The project history reads it
 * to decide the contract.manage events' amounts (utils/boq-figures).
 */
const contractValueSource = async ({ orgId, projectId }) => {
  const contract = await prisma.primeContract.findFirst({
    where: { projectId, project: { orgId } },
    select: { originalValueSource: true },
  });
  return contract ? valueSourceOf(contract) : null;
};

/**
 * The contract terms a reader of the payment certificates needs to know
 * whether their cap-limited totals restate a withheld contract value
 * (utils/boq-figures retentionCapWithheld): where the original value came
 * from and the retention cap rate. Null when the project has no contract row
 * — its certificates were worked without a cap. Never creates the row.
 */
const contractValueTerms = async ({ orgId, projectId }) => {
  const contract = await prisma.primeContract.findFirst({
    where: { projectId, project: { orgId } },
    select: { originalValueSource: true, retentionCapRate: true },
  });
  return contract
    ? { originalValueSource: valueSourceOf(contract), retentionCapRate: contract.retentionCapRate }
    : null;
};

// ─── the advance ───────────────────────────────────────────────────────────

const advanceOutstanding = (contract) =>
  round2(num(contract.advancePaidAmount) - num(contract.advanceRecoveredAmount));

const nextAdvanceReference = async (tx, { projectId, prefix }) =>
  // This one already knew counting was unsafe: it scanned forward up to two
  // hundred times looking for a free reference, which is a race dressed as a
  // retry — two callers scan the same gap and both take it. The counter
  // settles it in one atomic statement (OCTA-API-REFNUM-111).
  nextRef(tx, {
    table: "PrimeContractAdvance",
    column: "reference",
    scopeColumn: "projectId",
    scopeId: projectId,
    prefix,
  });

/** The client pays the advance. */
const recordAdvancePayment = async ({ orgId, projectId, userId, payload = {}, canReadBoq = false }) => {
  // Checked against the agreed advance, a rate of the original value: that
  // value must be the contract's before a receipt is taken against it. First,
  // before the amount is read, and before ensureContract could write a row.
  await assertContractValueEstablished({ orgId, projectId });
  const contract = await ensureContract({ orgId, projectId, userId });
  const amount = num(payload.amount);
  if (amount <= 0) {
    throw new HttpError(400, "ADVANCE_AMOUNT_INVALID", "The advance must be greater than zero");
  }

  return prisma.$transaction(async (tx) => {
    // The contract row is held and its figures read under the lock: two
    // receipts arriving together each read the same "received so far", both
    // passed the agreed cap, and the aggregate kept one of them while both
    // receipt rows stood (Phase 21D, CX21-495).
    const held = tx.$queryRaw
      ? (await tx.$queryRaw`SELECT "advanceAmount"::float8 AS "advanceAmount", "advancePaidAmount"::float8 AS "advancePaidAmount" FROM "PrimeContract" WHERE id = ${contract.id} FOR UPDATE`)[0]
      : null;
    const agreed = num(held?.advanceAmount ?? contract.advanceAmount);
    const receivedSoFar = num(held?.advancePaidAmount ?? contract.advancePaidAmount);
    const paid = addMoney(receivedSoFar, amount);
    if (agreed > 0 && paid > agreed + MONEY_EPSILON) {
      // The agreed advance is a rate of the original value: while that value
      // is withheld from the caller (utils/boq-figures), so is the figure.
      // The prerequisite above already refuses an unestablished value; this
      // stays as the second line should that ever change.
      const agreedWithheld = !canReadBoq && !valueEstablished(contract) && Number(contract.advanceRate) > 0;
      throw new HttpError(
        409,
        "ADVANCE_OVER_AGREED",
        agreedWithheld
          ? `This receipt would take the advance over the amount agreed; ${receivedSoFar} has already been received`
          : `The advance agreed is ${agreed}; ${receivedSoFar} has already been received`
      );
    }

    const reference =
      trimOrNull(payload.reference) || (await nextAdvanceReference(tx, { projectId, prefix: "ADV" }));

    await tx.primeContractAdvance.create({
      data: {
        orgId,
        projectId,
        contractId: contract.id,
        reference,
        kind: "payment",
        amount,
        occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : new Date(),
        note: trimOrNull(payload.note),
        createdBy: userId,
      },
    });

    const updated = await tx.primeContract.update({
      where: { id: contract.id },
      data: { advancePaidAmount: paid },
      include: contractInclude,
    });
    return serializeContract(updated);
  });
};

const listAdvances = async ({ orgId, projectId }) => {
  const contract = await ensureContract({ orgId, projectId });
  const rows = await prisma.primeContractAdvance.findMany({
    where: { contractId: contract.id },
    orderBy: [{ occurredAt: "asc" }],
  });
  return {
    items: rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      kind: row.kind,
      amount: num(row.amount),
      certificateId: row.certificateId,
      occurredAt: row.occurredAt?.toISOString() ?? null,
      note: row.note,
    })),
    outstanding: advanceOutstanding(contract),
  };
};

// ─── what a certificate is actually worth ──────────────────────────────────

/**
 * Turns a certificate's certified work into a sum of money.
 *
 * Pure, so the same arithmetic runs whether a certificate is being previewed
 * in a draft or locked at certification. The order matters and is the order
 * every standard form uses: gross, less retention, less what is being taken
 * back off the advance, less deductions, then tax on what is left.
 */
const certificateFinancials = ({
  contract,
  totalCert = 0,
  materialsOnSite = 0,
  totalRet = 0,
  deductions = 0,
  cumulativeRetention = 0,
}) => {
  const gross = addMoney(num(totalCert), num(materialsOnSite));

  // Retention stops once the cap is reached: the client holds a share of the
  // contract, not a share of every certificate for ever.
  let retention = num(totalRet);
  const capRate = contract?.retentionCapRate;
  if (capRate != null && capRate > 0) {
    const cap = pct(num(contract.revisedValue), capRate);
    const room = round2(cap - num(cumulativeRetention));
    retention = Math.max(0, Math.min(retention, room));
  }

  // Never recover more of the advance than is still outstanding.
  const outstanding = contract ? advanceOutstanding(contract) : 0;
  const advanceRecovery = Math.min(
    outstanding,
    pct(gross, contract?.advanceRecoveryRate ?? 0)
  );

  const beforeTax = round2(
    subtractMoney(subtractMoney(subtractMoney(gross, retention), advanceRecovery), num(deductions))
  );
  const taxRate = contract?.taxRate ?? 0;
  const taxAmount = pct(beforeTax, taxRate);

  return {
    gross,
    retention,
    advanceRecovery,
    deductions: num(deductions),
    beforeTax,
    taxRate,
    taxAmount,
    netPayable: addMoney(beforeTax, taxAmount),
  };
};

/**
 * Locks the advance recovery a certificate took, once it is certified.
 *
 * Writes a ledger row rather than only a counter, so "how much of the advance
 * is left" can always be re-derived from the certificates that recovered it.
 */
const applyAdvanceRecovery = async (tx, { orgId, projectId, certificate, amount }) => {
  if (!amount || amount <= MONEY_EPSILON) return null;
  const contract = await tx.primeContract.findFirst({ where: { projectId } });
  if (!contract) return null;

  const already = await tx.primeContractAdvance.findFirst({
    where: { contractId: contract.id, kind: "recovery", certificateId: certificate.id },
  });
  if (already) return already;

  const reference = await nextAdvanceReference(tx, { projectId, prefix: "REC" });
  const row = await tx.primeContractAdvance.create({
    data: {
      orgId,
      projectId,
      contractId: contract.id,
      reference,
      kind: "recovery",
      amount,
      certificateId: certificate.id,
      occurredAt: new Date(),
      note: `Recovered on ${certificate.period}`,
    },
  });

  await tx.primeContract.update({
    where: { id: contract.id },
    data: {
      advanceRecoveredAmount: addMoney(num(contract.advanceRecoveredAmount), amount),
    },
  });
  return row;
};

// ─── the statement ─────────────────────────────────────────────────────────

const CERTIFIED_STATUSES = ["certified", "paid"];

/**
 * The client billing statement.
 *
 * The summary block is the front page of a payment application: what was
 * agreed, what the changes did to it, what has been certified before, what is
 * being claimed now, and what the client actually owes. The lines below are
 * the same story per BOQ item — contract, previous, this period, total,
 * remaining — which is the table a QS reads first and the one every dispute
 * starts from.
 */
const buildStatement = async ({ orgId, projectId, period = null }) => {
  const contract = await ensureContract({ orgId, projectId });

  const [certificates, boqItems] = await Promise.all([
    prisma.ipcCertificate.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "asc" }],
    }),
    // Only live BOQ items are in the contract: a superseded revision's items
    // are history, not scope the client owes for.
    prisma.boqItem.findMany({
      where: { projectId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        section: true,
        description: true,
        unit: true,
        qty: true,
        rate: true,
        amount: true,
      },
    }),
  ]);

  // The period being reported: the named one, else the newest not yet paid,
  // else the newest of all.
  const current =
    (period ? certificates.find((row) => row.period === period) : null) ??
    [...certificates].reverse().find((row) => row.status !== "paid") ??
    certificates[certificates.length - 1] ??
    null;

  const certifiedBefore = certificates.filter(
    (row) =>
      CERTIFIED_STATUSES.includes(row.status) && (!current || row.createdAt < current.createdAt)
  );

  const previousCertified = certifiedBefore.reduce(
    (sum, row) => addMoney(sum, num(row.totalCert)),
    0
  );
  const cumulativeRetention = certificates
    .filter((row) => CERTIFIED_STATUSES.includes(row.status))
    .reduce((sum, row) => addMoney(sum, num(row.totalRet)), 0);

  const items = current
    ? await prisma.ipcItem.findMany({
        where: { projectId, ipcCertificateId: current.id },
        select: {
          id: true,
          boqItemId: true,
          qty: true,
          rate: true,
          previousCert: true,
          currentCert: true,
          cumulativeCert: true,
        },
      })
    : [];
  const itemByBoq = new Map(items.map((row) => [row.boqItemId, row]));

  const lines = boqItems.map((boqItem) => {
    const item = itemByBoq.get(boqItem.id);
    const contractAmount = num(boqItem.amount);
    const previous = num(item?.previousCert);
    const thisPeriod = num(item?.currentCert);
    const total = item ? num(item.cumulativeCert) : previous;
    return {
      boqItemId: boqItem.id,
      code: boqItem.code,
      section: boqItem.section,
      description: boqItem.description,
      unit: boqItem.unit,
      quantity: boqItem.qty,
      rate: num(boqItem.rate),
      contractAmount,
      previous,
      thisPeriod,
      total,
      remaining: round2(contractAmount - total),
      pctComplete: contractAmount > 0 ? round2((total / contractAmount) * 100) : 0,
    };
  });

  const financials = current
    ? certificateFinancials({
        contract,
        totalCert: num(current.totalCert),
        materialsOnSite: num(current.materialsOnSite),
        totalRet: num(current.totalRet),
        deductions: num(current.deductions),
        cumulativeRetention: subtractMoney(cumulativeRetention, num(current.totalRet)),
      })
    : null;

  const received = certificates.reduce((sum, row) => addMoney(sum, num(row.amountPaid)), 0);
  const invoiced = certificates
    .filter((row) => row.invoiceStatus === "issued")
    .reduce((sum, row) => addMoney(sum, num(row.netPayable)), 0);

  return {
    contract: serializeContract(contract),
    summary: {
      originalValue: num(contract.originalValue),
      approvedChangesValue: num(contract.approvedChangesValue),
      pendingChangesValue: num(contract.pendingChangesValue),
      revisedValue: num(contract.revisedValue),
      previousCertified,
      currentCertified: current ? num(current.totalCert) : 0,
      materialsOnSite: current ? num(current.materialsOnSite) : 0,
      grossThisPeriod: financials?.gross ?? 0,
      retentionThisPeriod: financials?.retention ?? 0,
      retentionCumulative: cumulativeRetention,
      advanceAmount: num(contract.advanceAmount),
      advancePaid: num(contract.advancePaidAmount),
      advanceRecoveredToDate: num(contract.advanceRecoveredAmount),
      advanceRecoveryThisPeriod: financials?.advanceRecovery ?? 0,
      advanceOutstanding: advanceOutstanding(contract),
      deductions: financials?.deductions ?? 0,
      taxRate: financials?.taxRate ?? contract.taxRate,
      taxAmount: financials?.taxAmount ?? 0,
      totalDue: financials?.netPayable ?? 0,
      cumulativeCertified: addMoney(previousCertified, current ? num(current.totalCert) : 0),
      remainingToCertify: round2(
        num(contract.revisedValue) -
          addMoney(previousCertified, current ? num(current.totalCert) : 0)
      ),
      invoiced,
      received,
      outstanding: round2(invoiced - received),
    },
    current: current
      ? {
          id: current.id,
          period: current.period,
          status: current.status,
          invoiceStatus: current.invoiceStatus,
          paymentStatus: current.paymentStatus,
          issueDate: current.issueDate?.toISOString() ?? null,
          dueDate: current.dueDate?.toISOString() ?? null,
          totalCert: num(current.totalCert),
          totalRet: num(current.totalRet),
          netPayable: num(current.netPayable),
          amountPaid: num(current.amountPaid),
          balanceDue: num(current.balanceDue),
          deductionsNote: current.deductionsNote,
        }
      : null,
    periods: certificates.map((row) => ({
      id: row.id,
      period: row.period,
      status: row.status,
      totalCert: num(row.totalCert),
      totalRet: num(row.totalRet),
      netPayable: num(row.netPayable),
      amountPaid: num(row.amountPaid),
      balanceDue: num(row.balanceDue),
    })),
    lines,
  };
};

// ─── accounts receivable ───────────────────────────────────────────────────

const AGEING_BUCKETS = [
  { key: "current", label: "Not yet due", from: -Infinity, to: 0 },
  { key: "d1_30", label: "1–30 days", from: 1, to: 30 },
  { key: "d31_60", label: "31–60 days", from: 31, to: 60 },
  { key: "d61_90", label: "61–90 days", from: 61, to: 90 },
  { key: "d90_plus", label: "Over 90 days", from: 91, to: Infinity },
];

const bucketFor = (daysOverdue) =>
  AGEING_BUCKETS.find((bucket) => daysOverdue >= bucket.from && daysOverdue <= bucket.to) ??
  AGEING_BUCKETS[0];

/**
 * What the client owes, and how late it is.
 *
 * Ageing runs off the invoice's own due date where it has one and off the
 * contract's payment terms where it does not — an invoice with no due date is
 * still owed, and hiding it until somebody types a date is how debt goes
 * unnoticed.
 */
const receivables = async ({ orgId, projectId, asOf = new Date() }) => {
  const contract = await ensureContract({ orgId, projectId });
  const invoices = await prisma.ipcInvoice.findMany({
    where: { projectId, status: { not: "void" } },
    orderBy: [{ invoiceDate: "asc" }],
    include: { ipcCertificate: { select: { period: true } } },
  });

  const day = 24 * 60 * 60 * 1000;
  const buckets = Object.fromEntries(
    AGEING_BUCKETS.map((bucket) => [bucket.key, { ...bucket, amount: 0, count: 0 }])
  );

  const rows = invoices.map((invoice) => {
    const dueDate =
      invoice.dueDate ??
      new Date(invoice.invoiceDate.getTime() + contract.paymentTermsDays * day);
    const balance = round2(num(invoice.netAmount) - num(invoice.amountPaid));
    const daysOverdue = Math.floor((asOf.getTime() - dueDate.getTime()) / day);
    const bucket = bucketFor(daysOverdue);

    if (balance > MONEY_EPSILON) {
      buckets[bucket.key].amount = addMoney(buckets[bucket.key].amount, balance);
      buckets[bucket.key].count += 1;
    }

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      period: invoice.ipcCertificate?.period ?? null,
      invoiceDate: invoice.invoiceDate.toISOString(),
      dueDate: dueDate.toISOString(),
      netAmount: num(invoice.netAmount),
      amountPaid: num(invoice.amountPaid),
      balance,
      status: invoice.status,
      daysOverdue: balance > MONEY_EPSILON ? Math.max(0, daysOverdue) : 0,
      bucket: bucket.key,
    };
  });

  const outstanding = rows.reduce((sum, row) => addMoney(sum, row.balance), 0);
  const overdue = rows
    .filter((row) => row.daysOverdue > 0)
    .reduce((sum, row) => addMoney(sum, row.balance), 0);

  return {
    currency: contract.currency,
    invoiced: rows.reduce((sum, row) => addMoney(sum, row.netAmount), 0),
    received: rows.reduce((sum, row) => addMoney(sum, row.amountPaid), 0),
    outstanding,
    overdue,
    ageing: AGEING_BUCKETS.map((bucket) => buckets[bucket.key]),
    invoices: rows,
  };
};

module.exports = {
  ADVANCE_KINDS,
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
  ESTABLISHED_VALUE_SOURCES,
  VALUE_SOURCES,
  advanceOutstanding,
  applyAdvanceRecovery,
  assertContractValueEstablished,
  buildStatement,
  certificateFinancials,
  contractValueSource,
  contractValueTerms,
  ensureContract,
  listAdvances,
  receivables,
  recomputeChangeValues,
  recordAdvancePayment,
  serializeContract,
  updateContract,
};
