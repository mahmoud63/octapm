const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { multiplyMoney, toMoneyNumber } = require('../utils/money');
const auditService = require('./audit.service');
const {
  RECORD_TYPES,
  attachEvidenceToRecords,
  syncEvidenceReferences,
} = require('./commercial-traceability.service');
const { recordWorkflowHistory } = require('./workflow-support.service');
const approvalWorkflowService = require('./approval-workflow.service');
const { nextRef } = require("../utils/reference-number");

const EOT_WORKFLOW_ACTIONS = Object.freeze({
  SUBMIT: 'submit',
  APPROVE: 'approve',
  REJECT: 'reject',
});

const activityTraceSelect = {
  id: true,
  name: true,
  p6ActivityId: true,
  wbsCode: true,
  totalFloat: true,
  isCritical: true,
};

const eotClaimInclude = {
  activityLinks: {
    include: { activity: { select: activityTraceSelect } },
    orderBy: [{ createdAt: 'asc' }],
  },
  weatherDelayLinks: {
    include: {
      weatherDelay: {
        select: {
          id: true,
          date: true,
          description: true,
          delayDays: true,
          contractual: true,
          monthKey: true,
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }],
  },
};

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
};

const formatDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const dateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const approvalDecisionNote = (payload = {}) =>
  trimOrNull(
    payload.reason ||
      payload.rejectionReason ||
      payload.rejectedReason ||
      payload.comment ||
      payload.statusComment,
  );

const addDays = (value, days) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + Number(days || 0));
  return date;
};

const dateIsoOrNull = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const summarizeEotClaim = (claim) => ({
  ref: claim.ref,
  eventName: claim.eventName,
  eventType: claim.eventType,
  status: claim.status,
  delayDays: claim.delayDays,
  eotDaysGranted: claim.eotDaysGranted,
  ldLiability: claim.ldLiability,
  revisedCompletionRecommendation: dateIsoOrNull(
    claim.revisedCompletionRecommendation,
  ),
  cumulativeApprovedEotDays: claim.cumulativeApprovedEotDays || 0,
  officialAt: dateIsoOrNull(claim.officialAt),
  criticalPathImpactDays:
    claim.activityLinks?.reduce(
      (sum, link) => sum + (Number(link.criticalPathImpactDays) || 0),
      0,
    ) || 0,
  activityLinkCount: claim.activityLinks?.length || 0,
  weatherDelayLinkCount: claim.weatherDelayLinks?.length || 0,
});

const normalizeActivityLinks = ({ affectedActivityIds, activityLinks }) => {
  if (activityLinks !== undefined) {
    return (Array.isArray(activityLinks) ? activityLinks : [])
      .map((link) => ({
        activityId: trimOrNull(link?.activityId || link?.id),
        delayStart: dateOrNull(link?.delayStart),
        delayEnd: dateOrNull(link?.delayEnd),
        delayDays:
          link?.delayDays !== undefined ? Number(link.delayDays) || 0 : null,
        baselineStart: dateOrNull(link?.baselineStart),
        baselineFinish: dateOrNull(link?.baselineFinish),
        impactedStart: dateOrNull(link?.impactedStart),
        impactedFinish: dateOrNull(link?.impactedFinish),
        impactBasis: trimOrNull(link?.impactBasis || link?.basis),
        notes: trimOrNull(link?.notes),
      }))
      .filter((link) => link.activityId);
  }

  return (Array.isArray(affectedActivityIds) ? affectedActivityIds : [])
    .map((activityId) => ({
      activityId: trimOrNull(activityId),
      delayStart: null,
      delayEnd: null,
      delayDays: null,
      baselineStart: null,
      baselineFinish: null,
      impactedStart: null,
      impactedFinish: null,
      impactBasis: null,
      notes: null,
    }))
    .filter((link) => link.activityId);
};

const normalizeWeatherDelayLinks = (payload = {}) => {
  if (payload.weatherDelayLinks !== undefined) {
    return (Array.isArray(payload.weatherDelayLinks)
      ? payload.weatherDelayLinks
      : []
    )
      .map((link) => ({
        weatherDelayId: trimOrNull(link?.weatherDelayId || link?.id),
        delayStart: link?.delayStart || null,
        delayEnd: link?.delayEnd || null,
        delayDays: Number(link?.delayDays) || 0,
        notes: trimOrNull(link?.notes),
      }))
      .filter((link) => link.weatherDelayId);
  }

  if (payload.weatherDelayIds !== undefined) {
    return (Array.isArray(payload.weatherDelayIds) ? payload.weatherDelayIds : [])
      .map((weatherDelayId) => ({
        weatherDelayId: trimOrNull(weatherDelayId),
        delayStart: null,
        delayEnd: null,
        delayDays: 0,
        notes: null,
      }))
      .filter((link) => link.weatherDelayId);
  }

  return null;
};

const evidenceInputCount = (payload = {}) => {
  const input =
    payload.attachmentRefs !== undefined
      ? payload.attachmentRefs
      : payload.attachments !== undefined
        ? payload.attachments
        : payload.supportingDocumentIds !== undefined
          ? payload.supportingDocumentIds
          : payload.documentIds;
  return Array.isArray(input) ? input.length : 0;
};

const countExistingRows = async ({ tx, model, where }) => {
  if (model?.count) return model.count({ where });
  if (model?.findMany) {
    const rows = await model.findMany({ where, select: { id: true } });
    return rows.length;
  }
  return 0;
};

const assertSubmissionProof = async ({
  tx,
  projectId,
  claimId,
  status,
  calc = null,
  existing = null,
  activityTrace = null,
  evidence = null,
  payload = {},
  preCreate = false,
}) => {
  if (!['submitted', 'approved'].includes(status)) return;

  const activityCount = preCreate
    ? calc?.affectedActivities?.length || 0
    : activityTrace?.count ??
      existing?.activityLinks?.length ??
      (await countExistingRows({
        tx,
        model: tx.eotClaimActivityLink,
        where: { projectId, eotClaimId: claimId },
      }));
  const documentCount = preCreate
    ? evidenceInputCount(payload)
    : evidence?.attachmentCount ??
      (await countExistingRows({
        tx,
        model: tx.commercialAttachmentRef,
        where: { projectId, recordType: RECORD_TYPES.EOT_CLAIM, recordId: claimId },
      }));

  if (activityCount > 0 && documentCount > 0) return;

  throw new HttpError(
    400,
    'EOT_IMPACT_PROOF_REQUIRED',
    'Submitting or approving an EOT claim requires affected activities and supporting documents',
    {
      activityCount,
      supportingDocumentCount: documentCount,
    },
  );
};

const assertEotWorkflowTransition = ({
  existingStatus,
  nextStatus,
  workflowAction,
}) => {
  if (!nextStatus || nextStatus === existingStatus) return;

  const transitionKey = `${existingStatus || 'new'}:${nextStatus}`;
  const allowedByAction = {
    'draft:submitted': EOT_WORKFLOW_ACTIONS.SUBMIT,
    'rejected:submitted': EOT_WORKFLOW_ACTIONS.SUBMIT,
    'submitted:approved': EOT_WORKFLOW_ACTIONS.APPROVE,
    'submitted:rejected': EOT_WORKFLOW_ACTIONS.REJECT,
  };
  const expectedAction = allowedByAction[transitionKey];

  if (workflowAction && workflowAction === expectedAction) return;

  throw new HttpError(
    400,
    'EOT_WORKFLOW_ACTION_REQUIRED',
    'EOT status changes must use the submit, approve, or reject workflow endpoint',
    {
      fromStatus: existingStatus,
      toStatus: nextStatus,
    },
  );
};

const buildApprovedCompletionRecommendation = async ({
  tx,
  projectId,
  project,
  claimId,
  eotDaysGranted,
}) => {
  const baseCompletionDate = project.completionDate || project.endDate;
  if (!baseCompletionDate) {
    return {
      cumulativeApprovedEotDays: Number(eotDaysGranted) || 0,
      revisedCompletionRecommendation: null,
    };
  }

  const approvedClaims = tx.eotClaim?.findMany
    ? await tx.eotClaim.findMany({
        where: {
          projectId,
          status: 'approved',
          id: { not: claimId },
        },
        select: { eotDaysGranted: true },
      })
    : [];
  const priorApprovedDays = approvedClaims.reduce(
    (sum, claim) => sum + (Number(claim.eotDaysGranted) || 0),
    0,
  );
  const cumulativeApprovedEotDays =
    priorApprovedDays + (Number(eotDaysGranted) || 0);

  return {
    cumulativeApprovedEotDays,
    revisedCompletionRecommendation: addDays(
      baseCompletionDate,
      cumulativeApprovedEotDays,
    ),
  };
};

const calculateEot = async ({
  orgId,
  projectId,
  eventName,
  eventType,
  delayDays,
  eotDaysGranted,
  ldRatePerDay,
  affectedActivityIds,
  activityLinks,
  analysis,
}) => {
  const project = await ensureProject({ orgId, projectId });

  const normalizedLinks = normalizeActivityLinks({
    affectedActivityIds,
    activityLinks,
  });
  const ids = [...new Set(normalizedLinks.map((link) => link.activityId))];
  const activityRows = ids.length
    ? await prisma.activity.findMany({
        where: { projectId, id: { in: ids } },
        select: activityTraceSelect,
      })
    : [];
  const activityById = new Map(activityRows.map((activity) => [activity.id, activity]));
  const missing = ids.filter((id) => !activityById.has(id));
  if (missing.length > 0) {
    throw new HttpError(
      400,
      'EOT_ACTIVITY_NOT_FOUND',
      'One or more affected activities were not found in this project',
    );
  }
  const affectedActivities = normalizedLinks
    .map((link) => {
      const activity = activityById.get(link.activityId);
      if (!activity) return null;
      const floatDays = Math.max(0, Number(activity.totalFloat) || 0);
      const linkDelayDays =
        link.delayDays !== null ? link.delayDays : Number(delayDays) || 0;
      return {
        ...activity,
        delayStart: link.delayStart,
        delayEnd: link.delayEnd,
        delayDays: linkDelayDays,
        baselineStart: link.baselineStart,
        baselineFinish: link.baselineFinish,
        impactedStart: link.impactedStart,
        impactedFinish: link.impactedFinish,
        impactBasis: link.impactBasis,
        floatDays,
        criticalPathImpactDays: Math.max(0, linkDelayDays - floatDays),
        approvedEotDays: eotDaysGranted !== undefined ? Number(eotDaysGranted) || 0 : 0,
        notes: link.notes,
      };
    })
    .filter(Boolean);

  const totalDelay = Number(delayDays) || 0;
  const eot = Math.max(0, Number(eotDaysGranted) || 0);
  const rate =
    Number(ldRatePerDay) > 0
      ? toMoneyNumber(ldRatePerDay)
      : toMoneyNumber(project.ldRatePerDay);

  const floatBuffer = affectedActivities.reduce((sum, activity) => {
    return sum + Math.max(0, Number(activity.totalFloat) || 0);
  }, 0);

  const floatSensitive = affectedActivities.filter(
    (activity) =>
      (Number(activity.totalFloat) || 0) <= 0 || activity.isCritical,
  ).length;

  const criticalPathImpactDays = affectedActivities.reduce(
    (sum, activity) => sum + (Number(activity.criticalPathImpactDays) || 0),
    0,
  );
  const effectiveDelay =
    criticalPathImpactDays > 0
      ? criticalPathImpactDays
      : Math.max(0, totalDelay - floatBuffer);
  const ldApplicableDays = Math.max(0, effectiveDelay - eot);
  const ldLiability = multiplyMoney(ldApplicableDays, rate);
  const affectedActivitiesWithCost = affectedActivities.map((activity) => ({
    ...activity,
    approvedEotDays: eot,
    ldExposure: multiplyMoney(
      Math.max(0, (Number(activity.criticalPathImpactDays) || 0) - eot),
      rate,
    ),
  }));
  const contractualCompletion = formatDate(
    project.completionDate || project.endDate,
  );
  const revisedCompletion = formatDate(project.revisedCompletionDate);
  const baseCompletionDate =
    project.revisedCompletionDate || project.completionDate || project.endDate;
  const revisedCompletionRecommendation = addDays(baseCompletionDate, eot);

  const claimLetter = [
    `Subject: Extension of Time Claim - ${eventName}`,
    '',
    `Project: ${project.name}`,
    contractualCompletion
      ? `Contract Completion: ${contractualCompletion}`
      : null,
    revisedCompletion ? `Revised Completion: ${revisedCompletion}` : null,
    `Event Type: ${eventType || 'Delay Event'}`,
    `Claimed Delay: ${totalDelay} days`,
    `EOT Requested/Granted: ${eot} days`,
    `Impacted Critical Activities: ${floatSensitive}`,
    `Critical Path Impact: ${criticalPathImpactDays} days`,
    `Liquidated Damages Exposure: ${ldLiability.toFixed(2)}`,
    '',
    'We request formal review and approval of this EOT claim in line with contract provisions.',
    analysis ? `\nSupporting Analysis:\n${analysis}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const daysEntitlementSummary = {
    claimedDelayDays: totalDelay,
    criticalPathImpactDays,
    floatAbsorbedDays: Math.max(0, totalDelay - effectiveDelay),
    effectiveDelayDays: effectiveDelay,
    requestedEotDays: eot,
    recommendedEotDays: Math.min(eot, effectiveDelay),
    nonCompensableDelayDays: Math.max(0, effectiveDelay - eot),
    ldApplicableDays,
    ldRatePerDay: rate,
    ldLiability,
    impactedCriticalActivities: floatSensitive,
    contractualCompletion,
    currentRevisedCompletion: revisedCompletion,
    revisedCompletionRecommendation: formatDate(revisedCompletionRecommendation),
  };

  return {
    eventName,
    eventType: eventType || null,
    totalDelay,
    eotDaysGranted: eot,
    ldRatePerDay: rate,
    floatBuffer,
    effectiveDelay,
    criticalPathImpactDays,
    ldApplicableDays,
    ldLiability,
    contractualCompletion,
    revisedCompletion,
    revisedCompletionRecommendation: formatDate(revisedCompletionRecommendation),
    affectedActivities: affectedActivitiesWithCost,
    analysis: analysis || null,
    daysEntitlementSummary,
    claimLetter,
  };
};

const listEotClaims = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const claims = await prisma.eotClaim.findMany({
    where: { projectId },
    include: eotClaimInclude,
    orderBy: [{ createdAt: 'desc' }],
  });

  return attachEvidenceToRecords({
    projectId,
    recordType: RECORD_TYPES.EOT_CLAIM,
    records: claims,
  });
};

const syncEotActivityLinks = async ({ tx, projectId, claimId, calc }) => {
  await tx.eotClaimActivityLink.deleteMany({
    where: { projectId, eotClaimId: claimId },
  });

  if (!calc.affectedActivities?.length) return { count: 0 };

  await tx.eotClaimActivityLink.createMany({
    data: calc.affectedActivities.map((activity) => ({
      projectId,
      eotClaimId: claimId,
      activityId: activity.id,
      delayStart: activity.delayStart ? new Date(activity.delayStart) : null,
      delayEnd: activity.delayEnd ? new Date(activity.delayEnd) : null,
      delayDays: Number(activity.delayDays) || 0,
      floatDays: Number(activity.floatDays) || 0,
      isCritical: Boolean(activity.isCritical),
      criticalPathImpactDays: Number(activity.criticalPathImpactDays) || 0,
      approvedEotDays: Number(activity.approvedEotDays) || 0,
      ldExposure: toMoneyNumber(activity.ldExposure),
      baselineStart: activity.baselineStart
        ? new Date(activity.baselineStart)
        : null,
      baselineFinish: activity.baselineFinish
        ? new Date(activity.baselineFinish)
        : null,
      impactedStart: activity.impactedStart
        ? new Date(activity.impactedStart)
        : null,
      impactedFinish: activity.impactedFinish
        ? new Date(activity.impactedFinish)
        : null,
      impactBasis: activity.impactBasis || null,
      cpmSnapshotJson: {
        totalFloat: activity.totalFloat,
        isCritical: activity.isCritical,
        effectiveDelay: calc.effectiveDelay,
        approvedEotDays: calc.eotDaysGranted,
        ldApplicableDays: calc.ldApplicableDays,
        ldExposure: activity.ldExposure,
        criticalPathImpactDays: activity.criticalPathImpactDays,
        delayStart: activity.delayStart?.toISOString?.() || activity.delayStart || null,
        delayEnd: activity.delayEnd?.toISOString?.() || activity.delayEnd || null,
        baselineStart:
          activity.baselineStart?.toISOString?.() || activity.baselineStart || null,
        baselineFinish:
          activity.baselineFinish?.toISOString?.() ||
          activity.baselineFinish ||
          null,
        impactedStart:
          activity.impactedStart?.toISOString?.() || activity.impactedStart || null,
        impactedFinish:
          activity.impactedFinish?.toISOString?.() ||
          activity.impactedFinish ||
          null,
      },
      notes: activity.notes || null,
    })),
    skipDuplicates: true,
  });

  return { count: calc.affectedActivities.length };
};

const syncWeatherDelayLinks = async ({ tx, projectId, claimId, payload }) => {
  const links = normalizeWeatherDelayLinks(payload);
  if (links === null) return null;

  await tx.eotClaimWeatherDelayLink.deleteMany({
    where: { projectId, eotClaimId: claimId },
  });
  if (links.length === 0) return { count: 0 };

  const ids = [...new Set(links.map((link) => link.weatherDelayId))];
  const rows = await tx.weatherDelay.findMany({
    where: { projectId, id: { in: ids } },
    select: { id: true, delayDays: true, date: true },
  });
  const weatherById = new Map(rows.map((row) => [row.id, row]));
  const missing = ids.filter((id) => !weatherById.has(id));
  if (missing.length > 0) {
    throw new HttpError(
      400,
      'EOT_WEATHER_DELAY_NOT_FOUND',
      'One or more linked weather delay events were not found in this project',
    );
  }

  await tx.eotClaimWeatherDelayLink.createMany({
    data: links.map((link) => {
      const weather = weatherById.get(link.weatherDelayId);
      return {
        projectId,
        eotClaimId: claimId,
        weatherDelayId: link.weatherDelayId,
        delayStart: link.delayStart
          ? new Date(link.delayStart)
          : weather?.date || null,
        delayEnd: link.delayEnd ? new Date(link.delayEnd) : null,
        delayDays: link.delayDays || Number(weather?.delayDays) || 0,
        notes: link.notes,
      };
    }),
    skipDuplicates: true,
  });

  return { count: links.length };
};

const existingActivityLinksPayload = (claim) =>
  (claim?.activityLinks || []).map((link) => ({
    activityId: link.activityId,
    delayStart: link.delayStart || null,
    delayEnd: link.delayEnd || null,
    delayDays: link.delayDays,
    baselineStart: link.baselineStart || null,
    baselineFinish: link.baselineFinish || null,
    impactedStart: link.impactedStart || null,
    impactedFinish: link.impactedFinish || null,
    impactBasis: link.impactBasis || null,
    notes: link.notes || null,
  }));

const needsEotRecalculation = (payload = {}) =>
  [
    'eventName',
    'eventType',
    'delayDays',
    'eotDaysGranted',
    'ldRatePerDay',
    'affectedActivityIds',
    'activityLinks',
    'analysis',
  ].some((key) => payload[key] !== undefined);

const createEotClaim = async ({
  orgId,
  projectId,
  payload,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const generatedRef = await nextRef(prisma, { table: 'EotClaim', scopeColumn: 'projectId', scopeId: projectId, prefix: 'EOT', pad: 2 });
  const ref = generatedRef;

  const calc = await calculateEot({
    orgId,
    projectId,
    eventName: payload.eventName,
    eventType: payload.eventType,
    delayDays: payload.delayDays,
    eotDaysGranted: payload.eotDaysGranted,
    ldRatePerDay: payload.ldRatePerDay,
    affectedActivityIds: payload.affectedActivityIds,
    activityLinks: payload.activityLinks,
    analysis: payload.analysis,
  });
  const status = payload.status || 'draft';
  await assertSubmissionProof({
    status,
    calc,
    payload,
    preCreate: true,
  });

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const created = await tx.eotClaim.create({
      data: {
        projectId,
        ref,
        eventName: calc.eventName,
        eventType: calc.eventType,
        delayDays: calc.totalDelay,
        eotDaysGranted: calc.eotDaysGranted,
        ldRatePerDay: calc.ldRatePerDay,
        ldLiability: calc.ldLiability,
        affectedActivities: calc.affectedActivities,
        analysis: calc.analysis,
        claimLetter: calc.claimLetter,
        entitlementSummaryJson: calc.daysEntitlementSummary,
        status,
        submittedBy: status === 'submitted' ? userId || null : null,
        submittedAt: status === 'submitted' ? now : null,
      },
      include: eotClaimInclude,
    });

    const activityTrace = await syncEotActivityLinks({
      tx,
      projectId,
      claimId: created.id,
      calc,
    });
    const weatherTrace = await syncWeatherDelayLinks({
      tx,
      projectId,
      claimId: created.id,
      payload,
    });
    const evidence = await syncEvidenceReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.EOT_CLAIM,
      recordId: created.id,
      payload,
      userId,
    });
    await assertSubmissionProof({
      tx,
      projectId,
      claimId: created.id,
      status: created.status,
      calc,
      activityTrace,
      evidence,
      payload,
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.EOT_CLAIM,
      entityId: created.id,
      action: auditService.ACTIONS.CREATED,
      actorId: userId,
      newStatus: created.status,
      newSummary: summarizeEotClaim(created),
      summary: {
        transition: 'eot_claim.create',
        ref: created.ref,
        delayDays: created.delayDays,
        eotDaysGranted: created.eotDaysGranted,
        criticalPathImpactDays: calc.criticalPathImpactDays,
        daysEntitlementSummary: calc.daysEntitlementSummary,
        activityLinks: activityTrace.count,
        weatherDelayLinks: weatherTrace?.count ?? 0,
        correspondenceLinks: evidence.correspondenceCount,
        attachmentRefs: evidence.attachmentCount,
      },
      attachments: evidence.attachments,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.EOT_CLAIM,
      recordId: created.id,
      fromStatus: null,
      toStatus: created.status,
      actorId: userId,
      actorRole: userRole,
      comment: payload.comment || payload.statusComment || null,
      metadata: {
        ref: created.ref,
        delayDays: created.delayDays,
        eotDaysGranted: created.eotDaysGranted,
        daysEntitlementSummary: calc.daysEntitlementSummary,
        activityLinks: activityTrace.count,
        weatherDelayLinks: weatherTrace?.count ?? 0,
      },
    });

    const reloaded = await tx.eotClaim.findFirst({
      where: { id: created.id },
      include: eotClaimInclude,
    });
    const [enriched] = await attachEvidenceToRecords({
      tx,
      projectId,
      recordType: RECORD_TYPES.EOT_CLAIM,
      records: [reloaded],
    });
    return enriched;
  });
};

const updateEotClaim = async ({
  orgId,
  projectId,
  claimId,
  payload,
  userId = null,
  userRole = null,
  workflowAction = null,
}) => {
  const project = await ensureProject({ orgId, projectId });

  const existing = await prisma.eotClaim.findFirst({
    where: { id: claimId, projectId },
    include: eotClaimInclude,
  });

  if (!existing) {
    throw new HttpError(404, 'EOT_CLAIM_NOT_FOUND', 'EOT claim not found');
  }

  const recalculate = needsEotRecalculation(payload);
  const calc = recalculate
    ? await calculateEot({
        orgId,
        projectId,
        eventName: payload.eventName ?? existing.eventName,
        eventType: payload.eventType ?? existing.eventType,
        delayDays: payload.delayDays ?? existing.delayDays,
        eotDaysGranted: payload.eotDaysGranted ?? existing.eotDaysGranted,
        ldRatePerDay: payload.ldRatePerDay ?? existing.ldRatePerDay,
        affectedActivityIds: payload.affectedActivityIds,
        activityLinks:
          payload.activityLinks !== undefined ||
          payload.affectedActivityIds !== undefined
            ? payload.activityLinks
            : existingActivityLinksPayload(existing),
        analysis: payload.analysis ?? existing.analysis,
      })
    : null;
  const nextStatus = payload.status ?? existing.status;
  assertEotWorkflowTransition({
    existingStatus: existing.status,
    nextStatus,
    workflowAction,
  });

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const approvalRecommendation =
      nextStatus === 'approved' && existing.status !== 'approved'
        ? await buildApprovedCompletionRecommendation({
            tx,
            projectId,
            project,
            claimId,
            eotDaysGranted: calc?.eotDaysGranted ?? existing.eotDaysGranted,
          })
        : null;
    const decisionNote = approvalDecisionNote(payload);
    const updated = await tx.eotClaim.update({
      where: { id: claimId },
      data: {
        status: nextStatus,
        eventName: calc?.eventName ?? payload.eventName ?? existing.eventName,
        eventType: calc ? calc.eventType : payload.eventType ?? existing.eventType,
        delayDays: calc?.totalDelay ?? existing.delayDays,
        eotDaysGranted: calc?.eotDaysGranted ?? existing.eotDaysGranted,
        ldRatePerDay: calc?.ldRatePerDay ?? existing.ldRatePerDay,
        ldLiability: calc?.ldLiability ?? existing.ldLiability,
        affectedActivities: calc?.affectedActivities ?? existing.affectedActivities,
        analysis: calc?.analysis ?? payload.analysis ?? existing.analysis,
        claimLetter: payload.claimLetter ?? calc?.claimLetter ?? existing.claimLetter,
        entitlementSummaryJson:
          calc?.daysEntitlementSummary ?? existing.entitlementSummaryJson ?? {},
        submittedBy:
          nextStatus === 'submitted' && existing.status !== 'submitted'
            ? userId || null
            : existing.submittedBy,
        submittedAt:
          nextStatus === 'submitted' && existing.status !== 'submitted'
            ? now
            : existing.submittedAt,
        approvedBy:
          nextStatus === 'approved' && existing.status !== 'approved'
            ? userId || null
            : existing.approvedBy,
        approvedAt:
          nextStatus === 'approved' && existing.status !== 'approved'
            ? now
            : existing.approvedAt,
        officialAt:
          nextStatus === 'approved' && existing.status !== 'approved'
            ? now
            : existing.officialAt,
        rejectedBy:
          nextStatus === 'rejected' && existing.status !== 'rejected'
            ? userId || null
            : existing.rejectedBy,
        rejectedAt:
          nextStatus === 'rejected' && existing.status !== 'rejected'
            ? now
            : existing.rejectedAt,
        rejectionReason:
          nextStatus === 'rejected'
            ? decisionNote
            : nextStatus === 'submitted'
              ? null
              : existing.rejectionReason,
        revisedCompletionRecommendation:
          approvalRecommendation?.revisedCompletionRecommendation ??
          existing.revisedCompletionRecommendation,
        cumulativeApprovedEotDays:
          approvalRecommendation?.cumulativeApprovedEotDays ??
          existing.cumulativeApprovedEotDays,
      },
      include: eotClaimInclude,
    });

    const activityTrace = calc
      ? await syncEotActivityLinks({
          tx,
          projectId,
          claimId,
          calc,
        })
      : null;
    const weatherTrace = await syncWeatherDelayLinks({
      tx,
      projectId,
      claimId,
      payload,
    });
    const evidence = await syncEvidenceReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.EOT_CLAIM,
      recordId: updated.id,
      payload,
      userId,
    });
    await assertSubmissionProof({
      tx,
      projectId,
      claimId,
      status: updated.status,
      calc,
      existing,
      activityTrace,
      evidence,
      payload,
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.EOT_CLAIM,
      entityId: updated.id,
      action:
        updated.status !== existing.status
          ? updated.status === 'approved'
            ? auditService.ACTIONS.APPROVED
            : updated.status === 'rejected'
              ? auditService.ACTIONS.REJECTED
              : auditService.ACTIONS.STATUS_CHANGED
          : auditService.ACTIONS.UPDATED,
      actorId: userId,
      oldStatus: existing.status,
      newStatus: updated.status,
      reason: decisionNote,
      oldSummary: summarizeEotClaim(existing),
      newSummary: summarizeEotClaim(updated),
      summary: {
        transition:
          updated.status !== existing.status
            ? `eot_claim.${updated.status}`
            : 'eot_claim.update',
        ref: updated.ref,
        delayDays: updated.delayDays,
        eotDaysGranted: updated.eotDaysGranted,
        revisedCompletionRecommendation: dateIsoOrNull(
          updated.revisedCompletionRecommendation,
        ),
        cumulativeApprovedEotDays: updated.cumulativeApprovedEotDays,
        daysEntitlementSummary: updated.entitlementSummaryJson,
        criticalPathImpactDays:
          calc?.criticalPathImpactDays ??
          updated.activityLinks?.reduce(
            (sum, link) => sum + (Number(link.criticalPathImpactDays) || 0),
            0,
          ) ??
          0,
        activityLinks:
          activityTrace?.count ?? updated.activityLinks?.length ?? 0,
        weatherDelayLinks:
          weatherTrace?.count ?? updated.weatherDelayLinks?.length ?? 0,
        correspondenceLinks: evidence.correspondenceCount,
        attachmentRefs: evidence.attachmentCount,
      },
      attachments: evidence.attachments,
    });
    if (
      updated.status !== existing.status &&
      ['approved', 'rejected'].includes(updated.status)
    ) {
      await recordWorkflowHistory({
        tx,
        projectId,
        recordType: approvalWorkflowService.RECORD_TYPES.EOT_CLAIM,
        recordId: updated.id,
        oldStatus: existing.status,
        newStatus: updated.status,
        comment: decisionNote,
        userId,
        userRole,
        force: true,
      });
    }
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.EOT_CLAIM,
      recordId: updated.id,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      reason: decisionNote,
      comment: payload.comment || payload.statusComment || null,
      metadata: {
        ref: updated.ref,
        delayDays: updated.delayDays,
        eotDaysGranted: updated.eotDaysGranted,
        revisedCompletionRecommendation: dateIsoOrNull(
          updated.revisedCompletionRecommendation,
        ),
        cumulativeApprovedEotDays: updated.cumulativeApprovedEotDays,
        daysEntitlementSummary: updated.entitlementSummaryJson,
        criticalPathImpactDays:
          calc?.criticalPathImpactDays ??
          updated.activityLinks?.reduce(
            (sum, link) => sum + (Number(link.criticalPathImpactDays) || 0),
            0,
          ) ??
          0,
        activityLinks:
          activityTrace?.count ?? updated.activityLinks?.length ?? 0,
        weatherDelayLinks:
          weatherTrace?.count ?? updated.weatherDelayLinks?.length ?? 0,
      },
    });

    const [enriched] = await attachEvidenceToRecords({
      tx,
      projectId,
      recordType: RECORD_TYPES.EOT_CLAIM,
      records: [updated],
    });
    return enriched;
  });
};

const approveEotClaim = async ({
  orgId,
  projectId,
  claimId,
  comment = null,
  userId = null,
  userRole = null,
}) => {
  return updateEotClaim({
    orgId,
    projectId,
    claimId,
    userId,
    userRole,
    payload: {
      status: 'approved',
      comment: trimOrNull(comment),
      statusComment: trimOrNull(comment),
    },
    workflowAction: EOT_WORKFLOW_ACTIONS.APPROVE,
  });
};

const submitEotClaim = async ({
  orgId,
  projectId,
  claimId,
  comment = null,
  userId = null,
  userRole = null,
}) => {
  return updateEotClaim({
    orgId,
    projectId,
    claimId,
    userId,
    userRole,
    payload: {
      status: 'submitted',
      comment: trimOrNull(comment),
      statusComment: trimOrNull(comment),
    },
    workflowAction: EOT_WORKFLOW_ACTIONS.SUBMIT,
  });
};

const rejectEotClaim = async ({
  orgId,
  projectId,
  claimId,
  reason,
  userId = null,
  userRole = null,
}) => {
  const rejectionReason = approvalDecisionNote({ reason });
  if (!rejectionReason) {
    throw new HttpError(
      400,
      'APPROVAL_WORKFLOW_REASON_REQUIRED',
      'A reason is required for this workflow decision',
    );
  }

  return updateEotClaim({
    orgId,
    projectId,
    claimId,
    userId,
    userRole,
    payload: {
      status: 'rejected',
      reason: rejectionReason,
      rejectionReason,
      comment: rejectionReason,
      statusComment: rejectionReason,
    },
    workflowAction: EOT_WORKFLOW_ACTIONS.REJECT,
  });
};

module.exports = {
  calculateEot,
  listEotClaims,
  createEotClaim,
  updateEotClaim,
  submitEotClaim,
  approveEotClaim,
  rejectEotClaim,
};
