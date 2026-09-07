const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { addMoney, toMoneyNumber } = require("../utils/money");
const auditService = require("./audit.service");
const { HANDOVER } = require("./closeout.service");

/**
 * Subcontractor performance evaluation (OCTA-SUB-PERF-058).
 *
 * Stage 12 of the subcontractor lifecycle, and the counterpart to
 * prequalification: that one asks whether a company can do the work, this one
 * asks whether they did.
 *
 * The difference is that by now there is a trail. Non-conformances, punch
 * items and safety incidents all carry the company they were raised against;
 * the change orders sit on the subcontract; the closeout records whether the
 * handover arrived. So six of the eight criteria are read from the records and
 * recomputed on every read, and only the two things nobody can count —
 * whether they held the programme, and how they ran their own site — are left
 * to a person.
 *
 * A derived score can still be overridden, with a reason. Three
 * non-conformances on a forty-storey frame are not three non-conformances on
 * a fit-out, and the count alone cannot tell them apart. The reason is stored,
 * so an evaluation that talked the numbers up says who did it.
 *
 * Averaged across a company's finalised evaluations, this is the history that
 * shows on their next prequalification — which is the whole point of scoring
 * it rather than writing a paragraph.
 */

const STATUS = Object.freeze({ DRAFT: "draft", FINAL: "final" });
const MAX_SCORE = 5;

/**
 * The scale. Weights sum to 100 and each line is scored out of five, so a
 * subcontractor who was faultless everywhere scores 100.
 */
const CRITERIA = Object.freeze([
  {
    key: "quality",
    label: "Quality of work",
    category: "quality",
    weight: 20,
    source: "derived",
    hint: "Non-conformances raised against them, weighted by severity",
  },
  {
    key: "safety",
    label: "Safety",
    category: "hse",
    weight: 20,
    source: "derived",
    hint: "Incidents on their work, weighted by severity",
  },
  {
    key: "schedule",
    label: "Programme",
    category: "delivery",
    weight: 10,
    source: "rated",
    hint: "Did they hold the dates they signed up to",
  },
  {
    key: "cost_control",
    label: "Cost control",
    category: "commercial",
    weight: 15,
    source: "derived",
    hint: "Approved change orders against the original subcontract value",
  },
  {
    key: "snagging",
    label: "Snagging",
    category: "quality",
    weight: 10,
    source: "derived",
    hint: "Punch items raised against them",
  },
  {
    key: "responsiveness",
    label: "Responsiveness",
    category: "delivery",
    weight: 10,
    source: "derived",
    hint: "Non-conformances and punch items closed by the date they were due",
  },
  {
    key: "documentation",
    label: "Documentation",
    category: "compliance",
    weight: 10,
    source: "derived",
    hint: "The closeout handover: as-builts, manuals, warranties, waivers",
  },
  {
    key: "management",
    label: "Site management",
    category: "delivery",
    weight: 5,
    source: "rated",
    hint: "Supervision, and coordination with the other trades",
  },
]);

const DERIVED_KEYS = Object.freeze(
  CRITERIA.filter((entry) => entry.source === "derived").map((entry) => entry.key)
);
const RATED_KEYS = Object.freeze(
  CRITERIA.filter((entry) => entry.source === "rated").map((entry) => entry.key)
);
const BY_KEY = new Map(CRITERIA.map((entry) => [entry.key, entry]));

const trimOrNull = (value) => {
  const text = String(value ?? "").trim();
  return text ? text : null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const num = (value) => toMoneyNumber(value, 0);
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * Turns a count of bad things into a score out of five.
 *
 * `thresholds` are the counts at which each score is lost, best first: a
 * weighted count at or below thresholds[0] scores 5, at or below
 * thresholds[1] scores 4, and so on.
 */
const bandDown = (weighted, thresholds) => {
  for (let index = 0; index < thresholds.length; index += 1) {
    if (weighted <= thresholds[index]) return MAX_SCORE - index;
  }
  return 0;
};

// ─── the derived six ───────────────────────────────────────────────────────

/**
 * Non-conformances raised against this subcontractor on this project.
 *
 * Weighted the way the project's own quality score weights them: a major is
 * worth two and a half minors, because it is.
 */
const qualityState = ({ ncrs }) => {
  const major = ncrs.filter((row) => row.severity === "major").length;
  const minor = ncrs.length - major;
  if (!ncrs.length) return { score: MAX_SCORE, detail: "No non-conformances raised" };
  const weighted = major * 2.5 + minor;
  return {
    score: bandDown(weighted, [0, 1, 3, 6, 10]),
    detail: `${plural(major, "major")} and ${plural(minor, "minor")} non-conformance${
      ncrs.length === 1 ? "" : "s"
    }`,
  };
};

/** Safety incidents on their work. A single critical incident is not a rounding error. */
const safetyState = ({ incidents }) => {
  if (!incidents.length) return { score: MAX_SCORE, detail: "No incidents recorded" };
  const weight = { critical: 6, high: 3, medium: 1.5, low: 0.5 };
  const weighted = incidents.reduce((sum, row) => sum + (weight[row.severity] ?? 1), 0);
  const worst = ["critical", "high", "medium", "low"].find((level) =>
    incidents.some((row) => row.severity === level)
  );
  return {
    score: bandDown(weighted, [0, 0.5, 1.5, 3, 6]),
    detail: `${plural(incidents.length, "incident")}${worst ? `, worst ${worst}` : ""}`,
  };
};

/** Punch items raised against them, against the size of the subcontract. */
const snaggingState = ({ punch }) => {
  const open = punch.filter((row) => !["closed", "void"].includes(row.status)).length;
  if (!punch.length) return { score: MAX_SCORE, detail: "No punch items raised" };
  return {
    score: bandDown(punch.length, [0, 5, 15, 30, 60]),
    detail: `${plural(punch.length, "punch item")}, ${open} still open`,
  };
};

/**
 * Whether they closed things when they said they would.
 *
 * Over the non-conformances and punch items that carried a due date: closed
 * by it, closed late, or still open past it. Nothing with no due date counts
 * either way — holding somebody to a date nobody set is not responsiveness.
 */
const responsivenessState = ({ ncrs, punch }) => {
  const now = new Date();
  const tracked = [
    ...ncrs.map((row) => ({ due: row.dueDate, closed: row.closedDate, isClosed: row.status === "closed" })),
    ...punch.map((row) => ({ due: row.dueDate, closed: row.closedAt, isClosed: row.status === "closed" })),
  ].filter((row) => row.due);

  if (!tracked.length) return { score: null, detail: "Nothing was raised with a due date" };

  const late = tracked.filter((row) =>
    row.isClosed && row.closed ? new Date(row.closed) > new Date(row.due) : new Date(row.due) < now
  ).length;
  const rate = late / tracked.length;
  const score = rate === 0 ? 5 : rate <= 0.1 ? 4 : rate <= 0.25 ? 3 : rate <= 0.5 ? 2 : rate <= 0.75 ? 1 : 0;
  return {
    score,
    detail:
      late === 0
        ? `All ${tracked.length} closed by the date they were due`
        : `${late} of ${tracked.length} closed late or still overdue`,
  };
};

/**
 * Change orders against the original subcontract value.
 *
 * Only approved ones, only additions, and only the ones that started inside
 * the subcontract. A subcontract change order linked to a prime change order
 * is the client's variation flowing down: the subcontractor was told to build
 * something different, and charging that to their record would score them on
 * the client's indecision. Additions with no prime behind them are the ones
 * that say something about how they priced the work.
 *
 * Omissions do not net off, because a client-instructed omission cannot pay
 * for the subcontractor's own growth.
 */
const costState = ({ commitment, changeOrders }) => {
  const original = num(commitment.original);
  if (original <= 0) {
    return { score: null, detail: "The subcontract has no original value to measure against" };
  }
  const own = changeOrders.filter(
    (row) => row.status === "approved" && num(row.value) > 0 && !row.primeChangeOrderId
  );
  const passedDown = changeOrders.filter(
    (row) => row.status === "approved" && num(row.value) > 0 && row.primeChangeOrderId
  ).length;
  const additions = own.reduce((sum, row) => addMoney(sum, row.value), 0);
  const growth = round2((additions / original) * 100);
  const aside = passedDown
    ? ` (${plural(passedDown, "client variation")} passed down, not counted)`
    : "";
  return {
    score: bandDown(growth, [0, 1, 3, 7, 15]),
    detail:
      additions === 0
        ? `No additions of their own${aside}`
        : `${growth}% added by ${plural(own.length, "change order")} of their own${aside}`,
  };
};

/**
 * The closeout handover.
 *
 * Read from the closeout checklist rather than judged again: whether the
 * as-builts, manuals, warranties and waivers arrived is already recorded
 * there, and asking twice invites two different answers.
 */
const documentationState = ({ closeout }) => {
  if (!closeout) return { score: null, detail: "Closeout has not been opened" };
  // The closeout checklist also stores rows for its four derived checks — but
  // only when somebody waives one, and a waived insurance check is not a
  // handover document. Count the handover rows and nothing else.
  const required = new Set(
    HANDOVER.filter((item) => item.required !== false).map((item) => item.key)
  );
  const handover = (closeout.items || []).filter((item) => required.has(item.key));
  if (!handover.length) return { score: null, detail: "No handover requirements recorded" };

  const done = handover.filter((item) => item.status === "complete").length;
  const waived = handover.filter((item) => item.status === "waived").length;

  // A closeout nobody has started is not a documentation failure — it is a
  // process the project has not run yet. Scoring it zero would measure the
  // project rather than the subcontractor, so it scores nothing until either
  // the closeout is finished or somebody has begun working through it.
  if (closeout.status !== "complete" && done + waived === 0) {
    return { score: null, detail: "The closeout handover has not been started" };
  }

  // A waiver is not a delivery. It clears the closeout gate, not the score.
  const rate = done / handover.length;
  const score = rate >= 1 ? 5 : rate >= 0.8 ? 4 : rate >= 0.6 ? 3 : rate >= 0.4 ? 2 : rate > 0 ? 1 : 0;
  return {
    score,
    detail: `${done} of ${handover.length} handover requirement${
      handover.length === 1 ? "" : "s"
    } delivered${waived ? `, ${waived} waived` : ""}`,
  };
};

// ─── loading ───────────────────────────────────────────────────────────────

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
      // The original value is the sum of the schedule-of-values lines; the
      // commitment does not store it.
      lines: { select: { amount: true } },
      vendorCompany: { select: { id: true, name: true } },
      changeOrders: { select: { status: true, value: true, primeChangeOrderId: true } },
      closeout: { select: { id: true, status: true, items: { select: { key: true, status: true, required: true } } } },
    },
  });
  if (!commitment) throw new HttpError(404, "COMMITMENT_NOT_FOUND", "Commitment not found");
  if (commitment.type !== "subcontract") {
    throw new HttpError(
      409,
      "EVALUATION_NOT_A_SUBCONTRACT",
      "A purchase order buys a thing rather than a package of work; there is no performance to evaluate"
    );
  }
  return commitment;
};

/** Everything the records already say about this subcontractor on this project. */
const evidenceFor = async ({ projectId, vendorCompanyId }) => {
  if (!vendorCompanyId) return { ncrs: [], punch: [], incidents: [] };
  const [ncrs, punch, incidents] = await Promise.all([
    prisma.ncrRecord.findMany({
      where: { projectId, assigneeCompanyId: vendorCompanyId },
      select: { severity: true, status: true, dueDate: true, closedDate: true },
    }),
    prisma.punchItem.findMany({
      where: { projectId, assigneeCompanyId: vendorCompanyId, status: { not: "void" } },
      select: { status: true, dueDate: true, closedAt: true },
    }),
    prisma.safetyIncident.findMany({
      where: { projectId, assigneeCompanyId: vendorCompanyId },
      select: { severity: true, status: true },
    }),
  ]);
  return { ncrs, punch, incidents };
};

/**
 * The evaluation, created on first read with all eight criteria listed.
 *
 * Listed rather than absent, for the same reason the closeout checklist is:
 * an evaluation you have to remember to add lines to measures whatever the
 * evaluator felt like measuring.
 */
const ensureEvaluation = async ({ orgId, projectId, commitmentId, userId = null }) => {
  const existing = await prisma.subcontractorEvaluation.findFirst({
    where: { commitmentId, projectId },
    include: { criteria: { orderBy: [{ sortOrder: "asc" }] } },
  });
  if (existing) return existing;

  const commitment = await loadCommitment({ orgId, projectId, commitmentId });
  return prisma.subcontractorEvaluation.create({
    data: {
      orgId,
      projectId,
      commitmentId,
      companyId: commitment.vendorCompanyId,
      createdBy: userId,
      updatedBy: userId,
      criteria: {
        create: CRITERIA.map((entry, index) => ({
          orgId,
          key: entry.key,
          label: entry.label,
          category: entry.category,
          weight: entry.weight,
          maxScore: MAX_SCORE,
          sortOrder: index,
        })),
      },
    },
    include: { criteria: { orderBy: [{ sortOrder: "asc" }] } },
  });
};

// ─── assembling ────────────────────────────────────────────────────────────

/**
 * The weighted score over the lines that carry one.
 *
 * A derived line with nothing to measure — no closeout opened, no original
 * value — scores nothing rather than zero, and drops out of the weighting.
 * Scoring a subcontractor down for a record that was never kept measures the
 * project, not the subcontractor.
 */
const scoreOf = (lines) => {
  const scored = lines.filter((line) => line.score !== null && line.score !== undefined);
  const weight = scored.reduce((sum, line) => sum + line.weight, 0);
  if (!weight) return { score: null, weightScored: 0 };
  const earned = scored.reduce((sum, line) => sum + line.weight * (line.score / line.maxScore), 0);
  return { score: round2((earned / weight) * 100), weightScored: weight };
};

const buildEvaluation = async ({ orgId, projectId, commitmentId, userId = null }) => {
  const [commitment, record] = await Promise.all([
    loadCommitment({ orgId, projectId, commitmentId }),
    ensureEvaluation({ orgId, projectId, commitmentId, userId }),
  ]);
  const { ncrs, punch, incidents } = await evidenceFor({
    projectId,
    vendorCompanyId: commitment.vendorCompanyId,
  });

  const derived = {
    quality: qualityState({ ncrs }),
    safety: safetyState({ incidents }),
    snagging: snaggingState({ punch }),
    responsiveness: responsivenessState({ ncrs, punch }),
    cost_control: costState({
      commitment: {
        original: (commitment.lines || []).reduce((sum, line) => addMoney(sum, line.amount), 0),
      },
      changeOrders: commitment.changeOrders || [],
    }),
    documentation: documentationState({ closeout: commitment.closeout }),
  };

  const storedByKey = new Map((record.criteria || []).map((row) => [row.key, row]));

  const lines = CRITERIA.map((entry, index) => {
    const stored = storedByKey.get(entry.key);
    const state = derived[entry.key] ?? null;
    // On a derived line a stored score is an override, and it wins — the
    // reading it replaced is kept beside it so both are visible.
    const overridden = entry.source === "derived" && stored?.score !== null && stored?.score !== undefined;
    const score = entry.source === "derived" ? (overridden ? stored.score : state?.score ?? null) : stored?.score ?? null;
    return {
      id: stored?.id ?? null,
      key: entry.key,
      label: entry.label,
      category: entry.category,
      source: entry.source,
      hint: entry.hint,
      weight: entry.weight,
      maxScore: MAX_SCORE,
      score: score ?? null,
      derivedScore: state?.score ?? null,
      detail: state?.detail ?? null,
      overridden,
      overrideReason: stored?.overrideReason ?? null,
      note: stored?.note ?? null,
      sortOrder: index,
    };
  });

  const { score, weightScored } = scoreOf(lines);
  const missing = lines.filter(
    (line) => line.source === "rated" && (line.score === null || line.score === undefined)
  );
  const unmeasurable = lines.filter((line) => line.source === "derived" && line.score === null);

  return {
    id: record.id,
    commitmentId,
    commitmentRef: commitment.ref,
    commitmentTitle: commitment.title,
    projectId,
    company: commitment.vendorCompany
      ? { id: commitment.vendorCompany.id, name: commitment.vendorCompany.name }
      : null,
    status: record.status,
    score,
    weightScored,
    wouldReuse: record.wouldReuse ?? null,
    summary: record.summary ?? null,
    evaluatedAt: toIso(record.evaluatedAt),
    evaluatedBy: record.evaluatedBy ?? null,
    ready: missing.length === 0,
    gaps: [
      ...missing.map((line) => `${line.label} has not been rated`),
      ...(record.wouldReuse === null || record.wouldReuse === undefined
        ? ["Say whether you would use them again"]
        : []),
    ],
    unmeasurable: unmeasurable.map((line) => `${line.label}: ${line.detail}`),
    criteria: lines,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
};

// ─── scoring ───────────────────────────────────────────────────────────────

/**
 * Rates one line, or overrides a derived one.
 *
 * Overriding what the records say needs a reason. Clearing the override puts
 * the reading back — the derived value was never replaced, only covered.
 */
const scoreCriterion = async ({ orgId, projectId, commitmentId, key, payload = {}, userId = null }) => {
  const record = await ensureEvaluation({ orgId, projectId, commitmentId, userId });
  const entry = BY_KEY.get(key);
  if (!entry) throw new HttpError(404, "EVALUATION_CRITERION_UNKNOWN", `No evaluation criterion called "${key}"`);
  if (record.status === STATUS.FINAL) {
    throw new HttpError(
      409,
      "EVALUATION_FINAL",
      "This evaluation is final; reopen it before changing a score"
    );
  }
  const data = {};
  if (payload.score !== undefined) {
    if (payload.score === null) {
      data.score = null;
      data.overrideReason = null;
    } else {
      const score = Number(payload.score);
      if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
        throw new HttpError(400, "EVALUATION_SCORE_INVALID", `${entry.label}: score 0 to ${MAX_SCORE}`);
      }
      const reason = trimOrNull(payload.overrideReason ?? payload.reason);
      if (entry.source === "derived" && !reason) {
        throw new HttpError(
          400,
          "EVALUATION_OVERRIDE_REASON_REQUIRED",
          `${entry.label} is read from the records — say why you are scoring it differently`
        );
      }
      data.score = score;
      if (entry.source === "derived") data.overrideReason = reason;
    }
  }
  if (payload.note !== undefined) data.note = trimOrNull(payload.note)?.slice(0, 2000) ?? null;
  if (!Object.keys(data).length) return buildEvaluation({ orgId, projectId, commitmentId, userId });

  // An evaluation created before a criterion existed has no row for it. Write
  // one rather than fail: the scale can grow, and old evaluations should keep
  // working when it does.
  await prisma.evaluationCriterion.upsert({
    where: { evaluationId_key: { evaluationId: record.id, key } },
    create: {
      orgId,
      evaluationId: record.id,
      key,
      label: entry.label,
      category: entry.category,
      weight: entry.weight,
      maxScore: MAX_SCORE,
      sortOrder: CRITERIA.indexOf(entry),
      ...data,
    },
    update: data,
  });
  await prisma.subcontractorEvaluation.update({
    where: { id: record.id },
    data: { updatedBy: userId },
  });
  return buildEvaluation({ orgId, projectId, commitmentId, userId });
};

/** Records the two answers that are not a score: would you use them again, and why. */
const setVerdict = async ({ orgId, projectId, commitmentId, payload = {}, userId = null }) => {
  const record = await ensureEvaluation({ orgId, projectId, commitmentId, userId });
  if (record.status === STATUS.FINAL) {
    throw new HttpError(409, "EVALUATION_FINAL", "This evaluation is final; reopen it first");
  }
  const data = { updatedBy: userId };
  if (payload.wouldReuse !== undefined) {
    data.wouldReuse = payload.wouldReuse === null ? null : Boolean(payload.wouldReuse);
  }
  if (payload.summary !== undefined) data.summary = trimOrNull(payload.summary)?.slice(0, 4000) ?? null;
  await prisma.subcontractorEvaluation.update({ where: { id: record.id }, data });
  return buildEvaluation({ orgId, projectId, commitmentId, userId });
};

/**
 * Finalises the evaluation, which is what makes it count towards the
 * company's history.
 *
 * Refused while a rated line is unrated or nobody has said whether they would
 * use them again. A half-finished evaluation averaged into a company's record
 * is worse than no evaluation, because it looks like one.
 */
const finalise = async ({ orgId, projectId, commitmentId, userId = null }) => {
  const view = await buildEvaluation({ orgId, projectId, commitmentId, userId });
  if (view.status === STATUS.FINAL) return view;
  if (!view.ready) {
    const error = new HttpError(
      409,
      "EVALUATION_INCOMPLETE",
      `The evaluation is not finished: ${view.gaps.length} thing${view.gaps.length === 1 ? "" : "s"} outstanding`
    );
    error.details = { gaps: view.gaps };
    throw error;
  }

  await prisma.subcontractorEvaluation.update({
    where: { id: view.id },
    data: {
      status: STATUS.FINAL,
      score: view.score,
      evaluatedAt: new Date(),
      evaluatedBy: userId,
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
      oldStatus: STATUS.DRAFT,
      newStatus: STATUS.FINAL,
      summary: {
        transition: "evaluation.final",
        score: view.score,
        wouldReuse: view.wouldReuse,
        overridden: view.criteria.filter((line) => line.overridden).map((line) => line.key),
      },
    })
    .catch(() => null);

  return buildEvaluation({ orgId, projectId, commitmentId, userId });
};

const reopen = async ({ orgId, projectId, commitmentId, reason, userId = null }) => {
  if (!trimOrNull(reason)) {
    throw new HttpError(400, "EVALUATION_REOPEN_REASON_REQUIRED", "Say why the evaluation is being reopened");
  }
  const record = await ensureEvaluation({ orgId, projectId, commitmentId, userId });
  await prisma.subcontractorEvaluation.update({
    where: { id: record.id },
    data: { status: STATUS.DRAFT, evaluatedAt: null, evaluatedBy: null, updatedBy: userId },
  });
  await auditService
    .recordEvent({
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.COMMITMENT,
      entityId: commitmentId,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      reason: trimOrNull(reason),
      oldStatus: STATUS.FINAL,
      newStatus: STATUS.DRAFT,
      summary: { transition: "evaluation.reopen" },
    })
    .catch(() => null);
  return buildEvaluation({ orgId, projectId, commitmentId, userId });
};

// ─── the history ───────────────────────────────────────────────────────────

/**
 * A company's record across every subcontract they have finished.
 *
 * Only finalised evaluations count. This is what shows on their next
 * prequalification, which is the reason for scoring performance rather than
 * writing a paragraph about it: the answer has somewhere to go.
 */
const historyFor = async ({ orgId, companyIds = [] }) => {
  const ids = [...new Set(companyIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await prisma.subcontractorEvaluation.findMany({
    where: { orgId, companyId: { in: ids }, status: STATUS.FINAL },
    select: { companyId: true, score: true, wouldReuse: true, evaluatedAt: true },
    orderBy: { evaluatedAt: "desc" },
  });

  const byCompany = new Map(ids.map((id) => [id, []]));
  for (const row of rows) byCompany.get(row.companyId)?.push(row);

  const out = new Map();
  for (const [companyId, list] of byCompany) {
    if (!list.length) {
      out.set(companyId, { evaluations: 0, score: null, wouldReuse: null, lastEvaluatedAt: null });
      continue;
    }
    const scored = list.filter((row) => row.score !== null);
    const reuse = list.filter((row) => row.wouldReuse !== null);
    out.set(companyId, {
      evaluations: list.length,
      score: scored.length
        ? round2(scored.reduce((sum, row) => sum + Number(row.score), 0) / scored.length)
        : null,
      // Named as a fraction rather than a percentage: "3 of 4" is a fact,
      // "75%" invites reading four jobs as a statistic.
      wouldReuse: reuse.length
        ? { yes: reuse.filter((row) => row.wouldReuse).length, of: reuse.length }
        : null,
      lastEvaluatedAt: toIso(list[0].evaluatedAt),
    });
  }
  return out;
};

/** Every finalised evaluation for one company, newest first. */
const listForCompany = async ({ orgId, companyId }) => {
  const rows = await prisma.subcontractorEvaluation.findMany({
    where: { orgId, companyId },
    select: {
      id: true,
      status: true,
      score: true,
      wouldReuse: true,
      summary: true,
      evaluatedAt: true,
      projectId: true,
      commitment: { select: { id: true, ref: true, title: true } },
      project: { select: { id: true, name: true } },
    },
    orderBy: [{ evaluatedAt: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  const history = await historyFor({ orgId, companyIds: [companyId] });
  return {
    items: rows.map((row) => ({
      id: row.id,
      status: row.status,
      score: row.score === null ? null : Number(row.score),
      wouldReuse: row.wouldReuse ?? null,
      summary: row.summary ?? null,
      evaluatedAt: toIso(row.evaluatedAt),
      commitment: row.commitment
        ? { id: row.commitment.id, ref: row.commitment.ref, title: row.commitment.title }
        : null,
      project: row.project ? { id: row.project.id, name: row.project.name } : null,
    })),
    history: history.get(companyId) ?? { evaluations: 0, score: null, wouldReuse: null, lastEvaluatedAt: null },
  };
};

module.exports = {
  CRITERIA,
  DERIVED_KEYS,
  MAX_SCORE,
  RATED_KEYS,
  STATUS,
  bandDown,
  buildEvaluation,
  costState,
  documentationState,
  ensureEvaluation,
  evidenceFor,
  finalise,
  historyFor,
  listForCompany,
  qualityState,
  reopen,
  responsivenessState,
  safetyState,
  scoreCriterion,
  scoreOf,
  setVerdict,
  snaggingState,
};
