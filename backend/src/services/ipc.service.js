const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { normalizeRoleId } = require("../config/permissions");
const {
  addMoney,
  divideMoney,
  multiplyMoney,
  subtractMoney,
  toMoneyNumber,
} = require("../utils/money");
const auditService = require("./audit.service");
const approvalWorkflowService = require("./approval-workflow.service");
const primeContractService = require("./prime-contract.service");

const MONEY_EPSILON = 0.01;
const QTY_EPSILON = 0.000001;
const DEFAULT_RETENTION_RATE = 5;
const CERTIFIED_ITEM_STATUSES = ["certified", "paid"];
const PAYABLE_CERTIFICATE_STATUSES = ["certified", "paid"];

const progressLinkInclude = {
  include: {
    activity: {
      select: {
        id: true,
        name: true,
        p6ActivityId: true,
        wbsCode: true,
        totalFloat: true,
        isCritical: true,
      },
    },
    progress: {
      select: {
        id: true,
        pctComplete: true,
        quantityComplete: true,
        quantityPlanned: true,
        quantityUnit: true,
        progressMethod: true,
        status: true,
        approvedAt: true,
        updatedAt: true,
      },
    },
  },
  orderBy: [{ createdAt: "desc" }],
};

const resolveRetentionRate = (project) => {
  const rate = Number(project?.defaultRetentionRate);
  return Number.isFinite(rate) ? rate : DEFAULT_RETENTION_RATE;
};

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const dateOrDefault = (value, fallback = new Date()) => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
};

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  }

  return project;
};

const getNextPeriod = (existingCertificates) => {
  const maxN = existingCertificates.reduce((max, cert) => {
    const match = String(cert.period || "").match(/IPC-(\d+)/i);
    if (!match) return max;
    return Math.max(max, Number(match[1]) || 0);
  }, 0);

  return `IPC-${maxN + 1}`;
};

const listIpcCertificates = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  return prisma.ipcCertificate.findMany({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }],
  });
};

/**
 * Re-adds a certificate from its items, then applies the client contract.
 *
 * The items give the certified work and the retention on it. The contract
 * turns that into a sum of money: stored materials on top, the retention cap,
 * the slice taken back off the advance, any deductions, and tax on what is
 * left. A project with no terms set has all of those at zero, so the answer is
 * what it always was — certified less retention.
 */
const recomputeCertificateTotals = async (tx, certificateId) => {
  const items = await tx.ipcItem.findMany({
    where: { ipcCertificateId: certificateId },
    select: { currentCert: true, retention: true, netPayable: true },
  });

  const totals = items.reduce(
    (acc, item) => {
      acc.totalCert = addMoney(acc.totalCert, item.currentCert);
      acc.totalRet = addMoney(acc.totalRet, item.retention);
      acc.netPayable = addMoney(acc.netPayable, item.netPayable);
      return acc;
    },
    { totalCert: 0, totalRet: 0, netPayable: 0 },
  );

  const certificate = await tx.ipcCertificate.findUnique({
    where: { id: certificateId },
    select: {
      id: true,
      projectId: true,
      materialsOnSite: true,
      deductions: true,
      totalRet: true,
    },
  });
  const contract = certificate
    ? await tx.primeContract.findFirst({ where: { projectId: certificate.projectId } })
    : null;

  // Retention already held on earlier certificates, so the cap is measured
  // across the contract rather than one period at a time.
  const cumulativeRetention = certificate
    ? await tx.ipcCertificate
        .aggregate({
          where: {
            projectId: certificate.projectId,
            status: { in: CERTIFIED_ITEM_STATUSES },
            id: { not: certificateId },
          },
          _sum: { totalRet: true },
        })
        .then((row) => toMoneyNumber(row._sum?.totalRet, 0))
    : 0;

  const financials = primeContractService.certificateFinancials({
    contract,
    totalCert: totals.totalCert,
    materialsOnSite: toMoneyNumber(certificate?.materialsOnSite, 0),
    totalRet: totals.totalRet,
    deductions: toMoneyNumber(certificate?.deductions, 0),
    cumulativeRetention,
  });

  const data = {
    totalCert: totals.totalCert,
    totalRet: financials.retention,
    grossThisPeriod: financials.gross,
    advanceRecovery: financials.advanceRecovery,
    taxRate: financials.taxRate,
    taxAmount: financials.taxAmount,
    netPayable: financials.netPayable,
  };

  await tx.ipcCertificate.update({ where: { id: certificateId }, data });

  return { ...totals, ...data };
};

const sumMoneyRows = (rows, field) =>
  (rows || []).reduce((sum, row) => addMoney(sum, row?.[field] || 0), 0);

const sumNumberRows = (rows, field) =>
  (rows || []).reduce((sum, row) => sum + (Number(row?.[field]) || 0), 0);

const getApprovedVariationAllowance = async ({
  tx,
  projectId,
  allocationId = null,
  boqItemId = null,
}) => {
  const filters = [];
  if (allocationId) filters.push({ allocationId });
  if (boqItemId) filters.push({ boqItemId });
  if (filters.length === 0 || !tx.changeOrderAllocationLink?.findMany) {
    return { quantity: 0, amount: 0 };
  }

  const rows = await tx.changeOrderAllocationLink.findMany({
    where: {
      projectId,
      OR: filters,
      changeOrder: { status: "approved" },
    },
    select: {
      quantity: true,
      amount: true,
    },
  });

  return {
    quantity: sumNumberRows(rows, "quantity"),
    amount: sumMoneyRows(rows, "amount"),
  };
};

const getCertificationLimit = async ({
  tx,
  projectId,
  allocation,
  boqItemId,
}) => {
  if (!allocation) return null;

  const variation = await getApprovedVariationAllowance({
    tx,
    projectId,
    allocationId: allocation.id,
    boqItemId: allocation.boqItemId || boqItemId || null,
  });

  return {
    baseQuantity: Number(allocation.quantity) || 0,
    baseAmount: toMoneyNumber(allocation.amount),
    variationQuantity: variation.quantity,
    variationAmount: variation.amount,
    quantity: (Number(allocation.quantity) || 0) + variation.quantity,
    amount: addMoney(allocation.amount, variation.amount),
  };
};

const getPreviousCertifiedAmount = async ({ tx, projectId, item }) => {
  const where = {
    projectId,
    id: { not: item.id },
    status: { in: CERTIFIED_ITEM_STATUSES },
  };

  if (item.allocationId) {
    where.allocationId = item.allocationId;
  } else {
    where.boqItemId = item.boqItemId;
  }

  const previousItems = await tx.ipcItem.findMany({
    where,
    select: { currentCert: true },
  });

  return sumMoneyRows(previousItems, "currentCert");
};

const buildPaymentState = ({ certificate, payments = [], releases = [] }) => {
  const amountPaid = Math.max(
    sumMoneyRows(payments, "amount"),
    toMoneyNumber(certificate.amountPaid),
  );
  const retentionReleased = Math.max(
    sumMoneyRows(releases, "amount"),
    toMoneyNumber(certificate.retentionReleased),
  );
  const payableToDate = addMoney(certificate.netPayable, retentionReleased);
  const rawBalanceDue = subtractMoney(payableToDate, amountPaid);
  const balanceDue = rawBalanceDue > MONEY_EPSILON ? rawBalanceDue : 0;
  const totalRetention = toMoneyNumber(certificate.totalRet);

  const paymentStatus =
    amountPaid <= MONEY_EPSILON
      ? "unpaid"
      : balanceDue <= MONEY_EPSILON
        ? "paid"
        : "partially_paid";
  const retentionStatus =
    totalRetention <= MONEY_EPSILON ||
    retentionReleased >= totalRetention - MONEY_EPSILON
      ? "released"
      : retentionReleased > MONEY_EPSILON
        ? "partially_released"
        : "held";

  return {
    amountPaid,
    retentionReleased,
    payableToDate,
    balanceDue,
    paymentStatus,
    retentionStatus,
  };
};

const loadPaymentRows = async ({ tx, projectId, certificateId }) => {
  const [payments, releases] = await Promise.all([
    tx.ipcPayment.findMany({
      where: { projectId, ipcCertificateId: certificateId },
      select: { amount: true },
    }),
    tx.ipcRetentionRelease.findMany({
      where: { projectId, ipcCertificateId: certificateId },
      select: { amount: true },
    }),
  ]);

  return { payments, releases };
};

const syncPaymentState = async ({ tx, projectId, certificate, invoice }) => {
  const { payments, releases } = await loadPaymentRows({
    tx,
    projectId,
    certificateId: certificate.id,
  });
  const state = buildPaymentState({ certificate, payments, releases });
  const nextCertificateStatus =
    PAYABLE_CERTIFICATE_STATUSES.includes(certificate.status) &&
    state.balanceDue <= MONEY_EPSILON &&
    state.amountPaid >= toMoneyNumber(certificate.netPayable) - MONEY_EPSILON
      ? "paid"
      : certificate.status;

  const updatedInvoice = invoice
    ? await tx.ipcInvoice.update({
        where: { id: invoice.id },
        data: {
          retentionReleased: state.retentionReleased,
          netAmount: state.payableToDate,
          amountPaid: state.amountPaid,
          balanceDue: state.balanceDue,
          status:
            invoice.status === "void"
              ? "void"
              : state.paymentStatus === "paid"
                ? "paid"
                : state.paymentStatus === "partially_paid"
                  ? "partially_paid"
                  : "issued",
        },
      })
    : null;

  const updatedCertificate = await tx.ipcCertificate.update({
    where: { id: certificate.id },
    data: {
      status: nextCertificateStatus,
      amountPaid: state.amountPaid,
      retentionReleased: state.retentionReleased,
      balanceDue: state.balanceDue,
      paymentStatus: state.paymentStatus,
      retentionStatus: state.retentionStatus,
      invoiceStatus:
        invoice?.status === "void"
          ? "void"
          : invoice
            ? "issued"
            : certificate.invoiceStatus,
    },
  });

  return {
    state,
    invoice: updatedInvoice,
    certificate: updatedCertificate,
    oldStatus: certificate.status,
    newStatus: nextCertificateStatus,
  };
};

const findLatestApprovedProgress = async (tx, activityId) =>
  tx.activityProgress.findFirst({
    where: { activityId, status: "approved" },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      pctComplete: true,
      quantityComplete: true,
      quantityPlanned: true,
      quantityUnit: true,
      progressMethod: true,
      status: true,
      approvedAt: true,
      updatedAt: true,
    },
  });

const approvedProgressCap = ({ allocation, progress, amountLimit = null }) => {
  if (!allocation || !progress) return null;
  const amount =
    amountLimit === null || amountLimit === undefined
      ? toMoneyNumber(allocation.amount)
      : toMoneyNumber(amountLimit);
  const pct = Math.min(Math.max(Number(progress.pctComplete) || 0, 0), 100);
  return multiplyMoney(amount, pct / 100);
};

const assertApprovedProgressBasis = ({
  allocation,
  progress,
  cumulativeCert,
  amountLimit = null,
  allowOverride = false,
}) => {
  if (!allocation || Number(cumulativeCert) <= MONEY_EPSILON) return;
  if (!progress) {
    throw new HttpError(
      400,
      "IPC_APPROVED_PROGRESS_REQUIRED",
      "IPC certification requires approved activity progress for the linked allocation",
    );
  }

  const cap = approvedProgressCap({ allocation, progress, amountLimit });
  if (
    cap !== null &&
    Number(cumulativeCert) > cap + MONEY_EPSILON &&
    !allowOverride
  ) {
    throw new HttpError(
      400,
      "IPC_APPROVED_PROGRESS_EXCEEDED",
      "IPC cumulative certification cannot exceed approved progress on the linked allocation",
    );
  }
};

const assertIpcItemWithinApprovedLimit = ({
  limit,
  qty,
  cumulativeCert,
  allowOverride = false,
}) => {
  if (!limit || allowOverride) return;

  if (Number(qty) > Number(limit.quantity || 0) + QTY_EPSILON) {
    throw new HttpError(
      400,
      "IPC_ALLOCATION_QTY_EXCEEDED",
      "IPC quantity cannot exceed the approved BOQ allocation plus approved variation quantity",
    );
  }
  if (Number(cumulativeCert) > toMoneyNumber(limit.amount) + MONEY_EPSILON) {
    throw new HttpError(
      400,
      "IPC_ALLOCATION_AMOUNT_EXCEEDED",
      "IPC cumulative certification cannot exceed approved BOQ allocation and approved variation value",
    );
  }
};

const assertApprovedActiveAllocation = (allocation) => {
  if (!allocation) return;

  if (allocation.status !== "approved" || allocation.isActive !== true) {
    throw new HttpError(
      409,
      "IPC_ALLOCATION_NOT_APPROVED",
      "IPC certification can only use approved active BOQ allocations",
    );
  }
};

const buildIpcItemCertificationReview = async ({
  tx,
  projectId,
  item,
  previousCert = null,
}) => {
  const allocation = item.allocation || null;
  const currentCert = toMoneyNumber(item.currentCert);
  const resolvedPreviousCert =
    previousCert === null || previousCert === undefined
      ? toMoneyNumber(item.previousCert)
      : toMoneyNumber(previousCert);
  const cumulativeCert = addMoney(resolvedPreviousCert, currentCert);

  if (!allocation) {
    return {
      currentClaimedAmount: currentCert,
      previousCertifiedAmount: resolvedPreviousCert,
      cumulativeCertifiedAmount: cumulativeCert,
      earnedAmount: 0,
      approvedLimitAmount: 0,
      approvedLimitQuantity: 0,
      approvedVariationAmount: 0,
      approvedVariationQuantity: 0,
      overEarnedAmount: currentCert > MONEY_EPSILON ? currentCert : 0,
      overApprovedLimitAmount: 0,
      overApprovedQuantity: 0,
      latestApprovedProgressId: null,
      latestApprovedPctComplete: null,
      requiresOverride: currentCert > MONEY_EPSILON,
      missingProgressEvidence: currentCert > MONEY_EPSILON,
    };
  }

  const [limit, progress] = await Promise.all([
    getCertificationLimit({
      tx,
      projectId,
      allocation,
      boqItemId: item.boqItemId,
    }),
    findLatestApprovedProgress(tx, allocation.activityId),
  ]);

  const approvedLimitAmount = toMoneyNumber(limit?.amount || 0);
  const approvedLimitQuantity = Number(limit?.quantity || 0);
  const earnedAmount = progress
    ? approvedProgressCap({
        allocation,
        progress,
        amountLimit: approvedLimitAmount,
      })
    : 0;
  const overApprovedLimitAmount = Math.max(
    0,
    subtractMoney(cumulativeCert, approvedLimitAmount),
  );
  const overEarnedAmount = Math.max(0, subtractMoney(cumulativeCert, earnedAmount));
  const overApprovedQuantity = Math.max(
    0,
    (Number(item.qty) || 0) - approvedLimitQuantity,
  );

  return {
    currentClaimedAmount: currentCert,
    previousCertifiedAmount: resolvedPreviousCert,
    cumulativeCertifiedAmount: cumulativeCert,
    earnedAmount,
    approvedLimitAmount,
    approvedLimitQuantity,
    approvedVariationAmount: toMoneyNumber(limit?.variationAmount || 0),
    approvedVariationQuantity: Number(limit?.variationQuantity || 0),
    overEarnedAmount,
    overApprovedLimitAmount,
    overApprovedQuantity,
    latestApprovedProgressId: progress?.id || null,
    latestApprovedPctComplete:
      progress?.pctComplete === null || progress?.pctComplete === undefined
        ? null
        : Number(progress.pctComplete),
    requiresOverride:
      overApprovedLimitAmount > MONEY_EPSILON ||
      overEarnedAmount > MONEY_EPSILON ||
      overApprovedQuantity > QTY_EPSILON,
    missingProgressEvidence: currentCert > MONEY_EPSILON && !progress,
  };
};

const summarizeIpcCertificationReview = (itemReviews) => {
  const totals = itemReviews.reduce(
    (acc, review) => {
      acc.currentClaimedAmount = addMoney(
        acc.currentClaimedAmount,
        review.currentClaimedAmount,
      );
      acc.previousCertifiedAmount = addMoney(
        acc.previousCertifiedAmount,
        review.previousCertifiedAmount,
      );
      acc.cumulativeCertifiedAmount = addMoney(
        acc.cumulativeCertifiedAmount,
        review.cumulativeCertifiedAmount,
      );
      acc.earnedAmount = addMoney(acc.earnedAmount, review.earnedAmount);
      acc.approvedLimitAmount = addMoney(
        acc.approvedLimitAmount,
        review.approvedLimitAmount,
      );
      acc.overEarnedAmount = addMoney(
        acc.overEarnedAmount,
        review.overEarnedAmount,
      );
      acc.overApprovedLimitAmount = addMoney(
        acc.overApprovedLimitAmount,
        review.overApprovedLimitAmount,
      );
      acc.overApprovedQuantity += Number(review.overApprovedQuantity) || 0;
      if (review.requiresOverride) acc.overrideLineCount += 1;
      if (review.missingProgressEvidence) acc.missingProgressEvidenceCount += 1;
      return acc;
    },
    {
      currentClaimedAmount: 0,
      previousCertifiedAmount: 0,
      cumulativeCertifiedAmount: 0,
      earnedAmount: 0,
      approvedLimitAmount: 0,
      overEarnedAmount: 0,
      overApprovedLimitAmount: 0,
      overApprovedQuantity: 0,
      overrideLineCount: 0,
      missingProgressEvidenceCount: 0,
    },
  );

  return {
    ...totals,
    requiresPmOverride: totals.overrideLineCount > 0,
    hasMissingProgressEvidence: totals.missingProgressEvidenceCount > 0,
  };
};

const enrichIpcCertificateReview = async ({ tx = prisma, projectId, certificate }) => {
  if (!certificate?.items?.length) {
    return {
      ...certificate,
      certificationReview: summarizeIpcCertificationReview([]),
    };
  }

  const items = [];
  const reviews = [];
  for (const item of certificate.items) {
    const review = await buildIpcItemCertificationReview({
      tx,
      projectId,
      item,
    });
    reviews.push(review);
    items.push({ ...item, certificationReview: review });
  }

  return {
    ...certificate,
    items,
    certificationReview: summarizeIpcCertificationReview(reviews),
  };
};

const syncIpcProgressLink = async ({
  tx,
  projectId,
  item,
  allocation,
  progress,
  qty,
  currentCert,
  previousCert,
}) => {
  await tx.ipcItemProgressLink.deleteMany({
    where: { projectId, ipcItemId: item.id },
  });

  if (!allocation || !progress) return null;

  const created = await tx.ipcItemProgressLink.create({
    data: {
      projectId,
      ipcItemId: item.id,
      allocationId: allocation.id,
      activityId: allocation.activityId,
      progressId: progress.id,
      approvedPctComplete: Number(progress.pctComplete) || 0,
      approvedQuantityComplete: progress.quantityComplete ?? null,
      certifiedQuantity: Number(qty) || 0,
      certifiedAmount: toMoneyNumber(currentCert),
      previousCertifiedAmount: toMoneyNumber(previousCert),
      cutoffDate: progress.updatedAt || null,
    },
    include: progressLinkInclude.include,
  });

  return created;
};

const getIpcPeriod = async ({ orgId, projectId, period }) => {
  await ensureProject({ orgId, projectId });

  const certificate = await prisma.ipcCertificate.findFirst({
    where: { projectId, period },
    include: {
      items: {
        include: {
          boqItem: {
            select: {
              id: true,
              code: true,
              ref: true,
              description: true,
              unit: true,
              qty: true,
              rate: true,
            },
          },
          allocation: {
            select: {
              id: true,
              boqItemId: true,
              activityId: true,
              quantity: true,
              amount: true,
              weight: true,
              status: true,
              isActive: true,
              activity: {
                select: {
                  id: true,
                  name: true,
                  p6ActivityId: true,
                  wbsCode: true,
                },
              },
            },
          },
          progressLinks: progressLinkInclude,
        },
        orderBy: [{ boqItem: { sortOrder: "asc" } }, { createdAt: "asc" }],
      },
      invoices: {
        include: {
          payments: {
            orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
          },
        },
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      },
      payments: {
        orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
      },
      retentionReleases: {
        orderBy: [{ releaseDate: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!certificate) {
    throw new HttpError(404, "IPC_PERIOD_NOT_FOUND", "IPC period not found");
  }

  return enrichIpcCertificateReview({ projectId, certificate });
};

const createIpcPeriod = async ({
  orgId,
  projectId,
  period,
  userId = null,
  userRole = null,
}) => {
  const project = await ensureProject({ orgId, projectId });
  const defaultRetentionRate = resolveRetentionRate(project);

  const existingCertificates = await prisma.ipcCertificate.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: { period: true },
  });

  const resolvedPeriod = period?.trim() || getNextPeriod(existingCertificates);

  const existing = await prisma.ipcCertificate.findFirst({
    where: { projectId, period: resolvedPeriod },
  });
  if (existing) {
    throw new HttpError(400, "IPC_PERIOD_EXISTS", "IPC period already exists");
  }

  const allocations = await prisma.activityBoqAllocation.findMany({
    where: {
      projectId,
      status: "approved",
      isActive: true,
      activity: { isActive: true },
    },
    include: {
      boqItem: true,
      activity: {
        select: {
          id: true,
          name: true,
          sortOrder: true,
        },
      },
    },
    orderBy: [
      { boqItem: { sortOrder: "asc" } },
      { activity: { sortOrder: "asc" } },
      { createdAt: "asc" },
    ],
  });

  const previousItems = await prisma.ipcItem.findMany({
    where: { projectId, status: { in: CERTIFIED_ITEM_STATUSES } },
    select: { allocationId: true, currentCert: true },
  });

  const previousCertMap = new Map();
  for (const item of previousItems) {
    if (!item.allocationId) continue;
    const current = previousCertMap.get(item.allocationId) || 0;
    previousCertMap.set(item.allocationId, addMoney(current, item.currentCert));
  }

  const certificate = await prisma.$transaction(async (tx) => {
    const created = await tx.ipcCertificate.create({
      data: {
        projectId,
        period: resolvedPeriod,
      },
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.IPC_CERTIFICATE,
      recordId: created.id,
      fromStatus: null,
      toStatus: created.status,
      actorId: userId,
      actorRole: userRole,
      metadata: { period: created.period },
    });

    if (allocations.length > 0) {
      await tx.ipcItem.createMany({
        data: allocations.map((allocation) => {
          const previousCert = previousCertMap.get(allocation.id) || 0;
          const rate =
            Number(allocation.quantity) > 0
              ? divideMoney(allocation.amount, allocation.quantity)
              : toMoneyNumber(allocation.boqItem.rate);

          return {
            projectId,
            boqItemId: allocation.boqItemId,
            allocationId: allocation.id,
            ipcCertificateId: created.id,
            ipcPeriod: resolvedPeriod,
            qty: 0,
            rate,
            previousCert,
            currentCert: 0,
            cumulativeCert: previousCert,
            retentionRate: defaultRetentionRate,
            retention: 0,
            netPayable: 0,
            status: "draft",
          };
        }),
      });
    }

    return created;
  });

  return getIpcPeriod({ orgId, projectId, period: certificate.period });
};

const updateIpcItem = async ({ orgId, projectId, period, itemId, payload }) => {
  await ensureProject({ orgId, projectId });

  const certificate = await prisma.ipcCertificate.findFirst({
    where: { projectId, period },
  });
  if (!certificate) {
    throw new HttpError(404, "IPC_PERIOD_NOT_FOUND", "IPC period not found");
  }
  if (certificate.status !== "draft") {
    throw new HttpError(
      409,
      "IPC_PERIOD_NOT_EDITABLE",
      "IPC items can only be updated while the period is in draft",
    );
  }
  if (payload.status !== undefined || payload.certDate !== undefined) {
    throw new HttpError(
      400,
      "IPC_ITEM_STATUS_DIRECT_UPDATE_FORBIDDEN",
      "IPC item status and certification dates are controlled by the period workflow",
    );
  }

  const existing = await prisma.ipcItem.findFirst({
    where: { id: itemId, projectId, ipcPeriod: period },
    include: { allocation: true },
  });
  if (!existing) {
    throw new HttpError(404, "IPC_ITEM_NOT_FOUND", "IPC item not found");
  }
  assertApprovedActiveAllocation(existing.allocation);

  const qty = Number(payload.qty ?? existing.qty) || 0;
  const rate = toMoneyNumber(payload.rate ?? existing.rate);
  const retentionRate =
    Number(payload.retentionRate ?? existing.retentionRate) || 0;

  const currentCert = multiplyMoney(qty, rate);
  const retention = multiplyMoney(currentCert, retentionRate / 100);
  const netPayable = subtractMoney(currentCert, retention);
  const cumulativeCert = addMoney(existing.previousCert, currentCert);

  const [certificationLimit, latestProgress] = existing.allocation
    ? await Promise.all([
        getCertificationLimit({
          tx: prisma,
          projectId,
          allocation: existing.allocation,
          boqItemId: existing.boqItemId,
        }),
        findLatestApprovedProgress(prisma, existing.allocation.activityId),
      ])
    : [null, null];

  assertIpcItemWithinApprovedLimit({
    limit: certificationLimit,
    qty,
    cumulativeCert,
  });
  assertApprovedProgressBasis({
    allocation: existing.allocation,
    progress: latestProgress,
    cumulativeCert,
    amountLimit: certificationLimit?.amount ?? null,
  });

  const updatedItem = await prisma.$transaction(async (tx) => {
    const item = await tx.ipcItem.update({
      where: { id: itemId },
      data: {
        qty,
        rate,
        retentionRate,
        currentCert,
        retention,
        netPayable,
        cumulativeCert,
        status: existing.status,
        certDate: existing.certDate,
      },
      include: {
        boqItem: {
          select: {
            id: true,
            code: true,
            ref: true,
            description: true,
            unit: true,
            qty: true,
            rate: true,
          },
        },
        allocation: {
          select: {
            id: true,
            quantity: true,
            amount: true,
            weight: true,
            activity: {
              select: {
                id: true,
                name: true,
                p6ActivityId: true,
                wbsCode: true,
              },
            },
          },
        },
        progressLinks: progressLinkInclude,
      },
    });

    await syncIpcProgressLink({
      tx,
      projectId,
      item,
      allocation: existing.allocation,
      progress: latestProgress,
      qty,
      currentCert,
      previousCert: existing.previousCert,
    });

    await recomputeCertificateTotals(tx, certificate.id);

    return tx.ipcItem.findFirst({
      where: { id: item.id },
      include: {
        boqItem: {
          select: {
            id: true,
            code: true,
            ref: true,
            description: true,
            unit: true,
            qty: true,
            rate: true,
          },
        },
        allocation: {
          select: {
            id: true,
            quantity: true,
            amount: true,
            weight: true,
            activity: {
              select: {
                id: true,
                name: true,
                p6ActivityId: true,
                wbsCode: true,
              },
            },
          },
        },
        progressLinks: progressLinkInclude,
      },
    });
  });

  return updatedItem;
};

/**
 * Stored materials and deductions on a certificate.
 *
 * These are not measured work, so they do not belong on a BOQ line: material
 * delivered but not yet installed is money the client owes against an invoice
 * and a delivery note, and a deduction is a sum being withheld for a stated
 * reason. Both sit on the certificate itself and both move the money, so a
 * deduction must say why.
 */
const updateCertificateAdjustments = async ({
  orgId,
  projectId,
  period,
  payload = {},
  userId = null,
}) => {
  await ensureProject({ orgId, projectId });

  const certificate = await prisma.ipcCertificate.findFirst({
    where: { projectId, period },
  });
  if (!certificate) {
    throw new HttpError(404, "IPC_PERIOD_NOT_FOUND", "IPC period not found");
  }
  if (!["draft", "submitted"].includes(certificate.status)) {
    throw new HttpError(
      409,
      "IPC_ADJUSTMENT_LOCKED",
      "A certified period cannot be adjusted",
    );
  }

  const contract = await prisma.primeContract.findFirst({ where: { projectId } });
  const data = {};

  if (payload.materialsOnSite !== undefined) {
    const value = toMoneyNumber(payload.materialsOnSite, 0);
    if (value < 0) {
      throw new HttpError(400, "IPC_MATERIALS_INVALID", "Stored materials cannot be negative");
    }
    // The contract may allow only a share of stored material to be certified.
    const rate = contract?.materialsOnSiteRate ?? 100;
    if (rate < 100 && payload.materialsAtCost !== undefined) {
      const allowed = toMoneyNumber(payload.materialsAtCost, 0) * (rate / 100);
      if (value > allowed + MONEY_EPSILON) {
        throw new HttpError(
          409,
          "IPC_MATERIALS_OVER_RATE",
          `The contract allows ${rate}% of stored material, which is ${allowed.toFixed(2)}`,
        );
      }
    }
    data.materialsOnSite = value;
  }

  if (payload.deductions !== undefined) {
    const value = toMoneyNumber(payload.deductions, 0);
    if (value < 0) {
      throw new HttpError(400, "IPC_DEDUCTION_INVALID", "A deduction cannot be negative");
    }
    const note = trimOrNull(payload.deductionsNote ?? certificate.deductionsNote);
    if (value > MONEY_EPSILON && !note) {
      throw new HttpError(
        400,
        "IPC_DEDUCTION_REASON_REQUIRED",
        "Say what is being deducted and why",
      );
    }
    data.deductions = value;
    data.deductionsNote = value > MONEY_EPSILON ? note : null;
  } else if (payload.deductionsNote !== undefined) {
    data.deductionsNote = trimOrNull(payload.deductionsNote);
  }

  if (!Object.keys(data).length) {
    throw new HttpError(400, "IPC_ADJUSTMENT_EMPTY", "Nothing to change");
  }

  return prisma.$transaction(async (tx) => {
    await tx.ipcCertificate.update({ where: { id: certificate.id }, data });
    await recomputeCertificateTotals(tx, certificate.id);

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.IPC_CERTIFICATE,
      entityId: certificate.id,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      summary: { transition: "certificate.adjust", period, ...data },
    });

    return tx.ipcCertificate.findUnique({ where: { id: certificate.id } });
  });
};

const submitIpcPeriod = async ({
  orgId,
  projectId,
  period,
  userId,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const certificate = await prisma.ipcCertificate.findFirst({
    where: { projectId, period },
  });
  if (!certificate) {
    throw new HttpError(404, "IPC_PERIOD_NOT_FOUND", "IPC period not found");
  }
  if (certificate.status !== "draft") {
    throw new HttpError(
      409,
      "IPC_INVALID_SUBMISSION_STATE",
      "Only draft IPC periods can be submitted for certification",
    );
  }

  const updatedCertificate = await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.ipcItem.updateMany({
      where: { projectId, ipcPeriod: period },
      data: { status: "submitted" },
    });

    const updated = await tx.ipcCertificate.update({
      where: { id: certificate.id },
      data: {
        status: "submitted",
        issueDate: now,
        submittedBy: userId || null,
        submittedAt: now,
      },
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.IPC_CERTIFICATE,
      entityId: certificate.id,
      action: auditService.ACTIONS.STATUS_CHANGED,
      actorId: userId,
      occurredAt: now,
      oldStatus: certificate.status,
      newStatus: "submitted",
      oldSummary: {
        period: certificate.period,
        status: certificate.status,
        totalCert: certificate.totalCert,
        netPayable: certificate.netPayable,
      },
      newSummary: {
        period: updated.period,
        status: updated.status,
        totalCert: updated.totalCert,
        netPayable: updated.netPayable,
      },
      summary: {
        transition: "period.submit",
        period: updated.period,
        totalCert: updated.totalCert,
        netPayable: updated.netPayable,
      },
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.IPC_CERTIFICATE,
      recordId: certificate.id,
      fromStatus: certificate.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      metadata: {
        period: updated.period,
        totalCert: updated.totalCert,
        netPayable: updated.netPayable,
      },
    });

    return updated;
  });
  require("./workflow-engine.service")
    .maybeStart({ orgId, projectId, tool: "ipc_certificate", recordId: certificate.id, actor: { id: userId, role: userRole } })
    .catch(() => null);
  return updatedCertificate;
};

const certifyIpcPeriod = async ({
  orgId,
  projectId,
  period,
  userId = null,
  userRole = null,
  comment = null,
  overrideReason = null,
  viaWorkflow = false,
}) => {
  await ensureProject({ orgId, projectId });

  const certificate = await prisma.ipcCertificate.findFirst({
    where: { projectId, period },
  });
  if (!certificate) {
    throw new HttpError(404, "IPC_PERIOD_NOT_FOUND", "IPC period not found");
  }
  if (certificate.status !== "submitted") {
    throw new HttpError(
      409,
      "IPC_INVALID_CERTIFICATION_STATE",
      "Only submitted IPC periods can be certified",
    );
  }
  if (!viaWorkflow) {
    await require("./workflow-engine.service").assertNotLocked({ tool: "ipc_certificate", projectId, recordId: certificate.id });
  }

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const normalizedOverrideReason = trimOrNull(overrideReason);
    const normalizedRole = normalizeRoleId(userRole);
    const items = await tx.ipcItem.findMany({
      where: { projectId, ipcPeriod: period },
      include: { allocation: true },
    });

    const reviewedItems = [];
    for (const item of items) {
      assertApprovedActiveAllocation(item.allocation);
      const previousCert = await getPreviousCertifiedAmount({
        tx,
        projectId,
        item,
      });
      const review = await buildIpcItemCertificationReview({
        tx,
        projectId,
        item,
        previousCert,
      });
      reviewedItems.push({
        item,
        previousCert,
        cumulativeCert: review.cumulativeCertifiedAmount,
        review,
      });
    }

    const certificationReview = summarizeIpcCertificationReview(
      reviewedItems.map(({ review }) => review),
    );
    const requiresOverride = certificationReview.requiresPmOverride;
    if (requiresOverride && !normalizedOverrideReason) {
      throw new HttpError(
        400,
        "IPC_PM_OVERRIDE_REASON_REQUIRED",
        "A PM override reason is required when IPC certification exceeds earned or approved value",
        certificationReview,
      );
    }
    if (requiresOverride && normalizedRole !== "pm") {
      throw new HttpError(
        403,
        "IPC_PM_OVERRIDE_REQUIRED",
        "Only a Project Manager can certify an IPC period with over-limit values",
        certificationReview,
      );
    }
    const allowOverride = requiresOverride && normalizedRole === "pm";

    let progressLinkCount = 0;
    for (const { item, previousCert, cumulativeCert } of reviewedItems) {
      const limit = item.allocation
        ? await getCertificationLimit({
            tx,
            projectId,
            allocation: item.allocation,
            boqItemId: item.boqItemId,
          })
        : null;
      assertIpcItemWithinApprovedLimit({
        limit,
        qty: item.qty,
        cumulativeCert,
        allowOverride,
      });
      const latestProgress = item.allocation
        ? await findLatestApprovedProgress(tx, item.allocation.activityId)
        : null;
      assertApprovedProgressBasis({
        allocation: item.allocation,
        progress: latestProgress,
        cumulativeCert,
        amountLimit: limit?.amount ?? null,
        allowOverride,
      });
      if (previousCert !== toMoneyNumber(item.previousCert)) {
        await tx.ipcItem.update({
          where: { id: item.id },
          data: {
            previousCert,
            cumulativeCert,
          },
        });
      } else if (cumulativeCert !== toMoneyNumber(item.cumulativeCert)) {
        await tx.ipcItem.update({
          where: { id: item.id },
          data: { cumulativeCert },
        });
      }
      const syncedItem = {
        ...item,
        previousCert,
        cumulativeCert,
      };
      const link = await syncIpcProgressLink({
        tx,
        projectId,
        item: syncedItem,
        allocation: item.allocation,
        progress: latestProgress,
        qty: item.qty,
        currentCert: item.currentCert,
        previousCert,
      });
      if (link) progressLinkCount += 1;
    }

    await tx.ipcItem.updateMany({
      where: { projectId, ipcPeriod: period },
      data: { status: "certified", certDate: now },
    });

    // Settle the money before the certificate is stamped: the totals are
    // re-read from the items and the contract's terms applied, so what is
    // certified and what the client owes cannot drift apart.
    const settled = await recomputeCertificateTotals(tx, certificate.id);
    await primeContractService.applyAdvanceRecovery(tx, {
      orgId,
      projectId,
      certificate,
      amount: settled.advanceRecovery,
    });

    const updated = await tx.ipcCertificate.update({
      where: { id: certificate.id },
      data: {
        status: "certified",
        certifiedBy: userId || null,
        certifiedAt: now,
        certificationComment: comment?.trim() || null,
        earnedValueAtCertification: certificationReview.earnedAmount,
        approvedLimitAtCertification: certificationReview.approvedLimitAmount,
        overCertificationAmount: Math.max(
          certificationReview.overApprovedLimitAmount,
          certificationReview.overEarnedAmount,
        ),
        certificationOverrideReason: requiresOverride
          ? normalizedOverrideReason
          : null,
        certificationOverrideBy: requiresOverride ? userId || null : null,
        certificationOverrideAt: requiresOverride ? now : null,
        balanceDue: settled.netPayable,
        paymentStatus: "unpaid",
        retentionStatus: settled.totalRet <= MONEY_EPSILON ? "released" : "held",
      },
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.IPC_CERTIFICATE,
      entityId: certificate.id,
      action: auditService.ACTIONS.CERTIFIED,
      actorId: userId,
      occurredAt: now,
      oldStatus: certificate.status,
      newStatus: "certified",
      reason: comment,
      oldSummary: {
        period: certificate.period,
        status: certificate.status,
        totalCert: certificate.totalCert,
        totalRet: certificate.totalRet,
        netPayable: certificate.netPayable,
      },
      newSummary: {
        period: updated.period,
        status: updated.status,
        totalCert: updated.totalCert,
        totalRet: updated.totalRet,
        netPayable: updated.netPayable,
        certifiedAt: updated.certifiedAt,
      },
      summary: {
        transition: "period.certify",
        period: updated.period,
        totalCert: updated.totalCert,
        totalRet: updated.totalRet,
        netPayable: updated.netPayable,
        progressLinks: progressLinkCount,
        certificationReview,
        overrideReason: requiresOverride ? normalizedOverrideReason : null,
      },
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.IPC_CERTIFICATE,
      recordId: certificate.id,
      fromStatus: certificate.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      comment,
      metadata: {
        period: updated.period,
        totalCert: updated.totalCert,
        totalRet: updated.totalRet,
        netPayable: updated.netPayable,
        progressLinks: progressLinkCount,
        certificationReview,
        overrideReason: requiresOverride ? normalizedOverrideReason : null,
      },
    });

    return updated;
  });
};

const loadCertificateForFinance = async ({ projectId, period }) => {
  const certificate = await prisma.ipcCertificate.findFirst({
    where: { projectId, period },
  });
  if (!certificate) {
    throw new HttpError(404, "IPC_PERIOD_NOT_FOUND", "IPC period not found");
  }
  return certificate;
};

const findIssuedInvoice = async ({ tx, projectId, certificateId }) =>
  tx.ipcInvoice.findFirst({
    where: {
      projectId,
      ipcCertificateId: certificateId,
      status: { not: "void" },
    },
  });

const nextReference = async ({ tx, modelName, projectId, prefix, field }) => {
  const count = tx[modelName]?.count
    ? await tx[modelName].count({ where: { projectId } })
    : 0;
  return `${prefix}-${String(count + 1).padStart(3, "0")}`;
};

const issueIpcInvoice = async ({
  orgId,
  projectId,
  period,
  payload = {},
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });
  const certificate = await loadCertificateForFinance({ projectId, period });

  if (!PAYABLE_CERTIFICATE_STATUSES.includes(certificate.status)) {
    throw new HttpError(
      409,
      "IPC_CERTIFICATE_NOT_CERTIFIED",
      "Only certified IPC periods can be issued as invoices",
    );
  }

  return prisma.$transaction(async (tx) => {
    const existingInvoice = await findIssuedInvoice({
      tx,
      projectId,
      certificateId: certificate.id,
    });
    if (existingInvoice) {
      throw new HttpError(
        409,
        "IPC_INVOICE_ALREADY_ISSUED",
        "This IPC period already has an issued invoice",
      );
    }

    const now = new Date();
    const invoiceNumber =
      trimOrNull(payload.invoiceNumber) ||
      (await nextReference({
        tx,
        modelName: "ipcInvoice",
        projectId,
        prefix: `${period}-INV`,
        field: "invoiceNumber",
      }));
    const invoiceDate = dateOrDefault(payload.invoiceDate, now);
    const dueDate = payload.dueDate
      ? dateOrDefault(payload.dueDate, null)
      : null;
    const paymentRows = await loadPaymentRows({
      tx,
      projectId,
      certificateId: certificate.id,
    });
    const state = buildPaymentState({
      certificate,
      payments: paymentRows.payments,
      releases: paymentRows.releases,
    });

    const invoice = await tx.ipcInvoice.create({
      data: {
        projectId,
        ipcCertificateId: certificate.id,
        invoiceNumber,
        invoiceDate,
        dueDate,
        grossAmount: toMoneyNumber(certificate.totalCert),
        retentionHeld: toMoneyNumber(certificate.totalRet),
        retentionReleased: state.retentionReleased,
        netAmount: state.payableToDate,
        amountPaid: state.amountPaid,
        balanceDue: state.balanceDue,
        status:
          state.paymentStatus === "paid"
            ? "paid"
            : state.paymentStatus === "partially_paid"
              ? "partially_paid"
              : "issued",
        issuedBy: userId || null,
        issuedAt: now,
      },
    });

    const synced = await syncPaymentState({
      tx,
      projectId,
      certificate: {
        ...certificate,
        invoiceStatus: "issued",
      },
      invoice,
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.IPC_CERTIFICATE,
      entityId: certificate.id,
      action: auditService.ACTIONS.STATUS_CHANGED,
      actorId: userId,
      actorRole: userRole,
      occurredAt: now,
      oldStatus: certificate.invoiceStatus || "not_issued",
      newStatus: "issued",
      summary: {
        transition: "invoice.issue",
        period,
        invoiceNumber,
        netAmount: synced.invoice.netAmount,
        balanceDue: synced.invoice.balanceDue,
      },
    });

    return synced.invoice;
  });
};

const recordIpcPayment = async ({
  orgId,
  projectId,
  period,
  payload = {},
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });
  const certificate = await loadCertificateForFinance({ projectId, period });
  if (!PAYABLE_CERTIFICATE_STATUSES.includes(certificate.status)) {
    throw new HttpError(
      409,
      "IPC_CERTIFICATE_NOT_CERTIFIED",
      "Only certified IPC periods can receive payments",
    );
  }

  const amount = toMoneyNumber(payload.amount);
  if (amount <= MONEY_EPSILON) {
    throw new HttpError(
      400,
      "IPC_PAYMENT_AMOUNT_REQUIRED",
      "Payment amount must be greater than zero",
    );
  }

  return prisma.$transaction(async (tx) => {
    const invoice = await findIssuedInvoice({
      tx,
      projectId,
      certificateId: certificate.id,
    });
    if (!invoice) {
      throw new HttpError(
        409,
        "IPC_INVOICE_REQUIRED",
        "Issue an IPC invoice before recording payments",
      );
    }

    const { payments, releases } = await loadPaymentRows({
      tx,
      projectId,
      certificateId: certificate.id,
    });
    const state = buildPaymentState({ certificate, payments, releases });
    if (amount > state.balanceDue) {
      throw new HttpError(
        400,
        "IPC_PAYMENT_EXCEEDS_PAYABLE_BALANCE",
        "Payment amount cannot exceed the current payable balance",
        {
          balanceDue: state.balanceDue,
        },
      );
    }

    const now = new Date();
    const paymentReference =
      trimOrNull(payload.paymentReference) ||
      (await nextReference({
        tx,
        modelName: "ipcPayment",
        projectId,
        prefix: `${period}-PAY`,
        field: "paymentReference",
      }));
    const payment = await tx.ipcPayment.create({
      data: {
        projectId,
        ipcCertificateId: certificate.id,
        invoiceId: invoice.id,
        paymentReference,
        paymentDate: dateOrDefault(payload.paymentDate, now),
        amount,
        paymentMethod: trimOrNull(payload.paymentMethod),
        notes: trimOrNull(payload.notes),
        receivedBy: userId || null,
        receivedAt: now,
      },
    });

    const synced = await syncPaymentState({
      tx,
      projectId,
      certificate,
      invoice,
    });

    if (synced.oldStatus !== synced.newStatus) {
      await approvalWorkflowService.recordTransition({
        tx,
        orgId,
        projectId,
        recordType: approvalWorkflowService.RECORD_TYPES.IPC_CERTIFICATE,
        recordId: certificate.id,
        fromStatus: synced.oldStatus,
        toStatus: synced.newStatus,
        actorId: userId,
        actorRole: userRole,
        metadata: {
          transition: "payment.record",
          period,
          amount,
          paymentReference,
          balanceDue: synced.state.balanceDue,
        },
      });
    }

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.IPC_CERTIFICATE,
      entityId: certificate.id,
      action: auditService.ACTIONS.STATUS_CHANGED,
      actorId: userId,
      actorRole: userRole,
      occurredAt: now,
      oldStatus: certificate.paymentStatus || "unpaid",
      newStatus: synced.certificate.paymentStatus,
      summary: {
        transition: "payment.record",
        period,
        amount,
        paymentReference,
        balanceDue: synced.state.balanceDue,
      },
    });

    return {
      payment,
      invoice: synced.invoice,
      certificate: synced.certificate,
    };
  });
};

const releaseIpcRetention = async ({
  orgId,
  projectId,
  period,
  payload = {},
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });
  const certificate = await loadCertificateForFinance({ projectId, period });
  if (!PAYABLE_CERTIFICATE_STATUSES.includes(certificate.status)) {
    throw new HttpError(
      409,
      "IPC_CERTIFICATE_NOT_CERTIFIED",
      "Only certified IPC periods can release retention",
    );
  }

  const amount = toMoneyNumber(payload.amount);
  if (amount <= MONEY_EPSILON) {
    throw new HttpError(
      400,
      "IPC_RETENTION_RELEASE_AMOUNT_REQUIRED",
      "Retention release amount must be greater than zero",
    );
  }

  return prisma.$transaction(async (tx) => {
    const invoice = await findIssuedInvoice({
      tx,
      projectId,
      certificateId: certificate.id,
    });
    if (!invoice) {
      throw new HttpError(
        409,
        "IPC_INVOICE_REQUIRED",
        "Issue an IPC invoice before releasing retention",
      );
    }

    const { payments, releases } = await loadPaymentRows({
      tx,
      projectId,
      certificateId: certificate.id,
    });
    const state = buildPaymentState({ certificate, payments, releases });
    const retainedBalance = subtractMoney(
      certificate.totalRet,
      state.retentionReleased,
    );
    if (amount > retainedBalance) {
      throw new HttpError(
        400,
        "IPC_RETENTION_RELEASE_EXCEEDS_HELD",
        "Retention release cannot exceed the retained balance",
        {
          retainedBalance,
        },
      );
    }

    const now = new Date();
    const releaseReference =
      trimOrNull(payload.releaseReference) ||
      (await nextReference({
        tx,
        modelName: "ipcRetentionRelease",
        projectId,
        prefix: `${period}-RET`,
        field: "releaseReference",
      }));
    const release = await tx.ipcRetentionRelease.create({
      data: {
        projectId,
        ipcCertificateId: certificate.id,
        releaseReference,
        releaseDate: dateOrDefault(payload.releaseDate, now),
        amount,
        reason: trimOrNull(payload.reason),
        releasedBy: userId || null,
        releasedAt: now,
      },
    });

    const synced = await syncPaymentState({
      tx,
      projectId,
      certificate,
      invoice,
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.IPC_CERTIFICATE,
      entityId: certificate.id,
      action: auditService.ACTIONS.STATUS_CHANGED,
      actorId: userId,
      actorRole: userRole,
      occurredAt: now,
      oldStatus: certificate.retentionStatus || "held",
      newStatus: synced.certificate.retentionStatus,
      reason: payload.reason,
      summary: {
        transition: "retention.release",
        period,
        amount,
        releaseReference,
        retainedBalance: subtractMoney(
          certificate.totalRet,
          synced.state.retentionReleased,
        ),
      },
    });

    return {
      release,
      invoice: synced.invoice,
      certificate: synced.certificate,
    };
  });
};

module.exports = {
  listIpcCertificates,
  createIpcPeriod,
  getIpcPeriod,
  updateIpcItem,
  updateCertificateAdjustments,
  submitIpcPeriod,
  certifyIpcPeriod,
  issueIpcInvoice,
  recordIpcPayment,
  releaseIpcRetention,
};
