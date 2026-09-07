const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { toMoneyNumber } = require("../utils/money");

/**
 * Subcontractor prequalification (OCTA-SUB-PREQUAL-057).
 *
 * Stage 2 of the subcontractor lifecycle: before a company is invited to
 * price work, somebody establishes that it can do the work and survive doing
 * it. Nine weighted criteria — financial capacity, safety history,
 * experience, references, insurance, licences, manpower, equipment and
 * quality history — each scored out of five, weighted to a score out of a
 * hundred.
 *
 * The score recommends; a person decides. The recommendation is stored
 * alongside the decision so an approval granted against a failing score is
 * visible afterwards rather than lost.
 *
 * The assessment is held at the organisation, not the project: a
 * subcontractor is qualified once and that answer is reused everywhere they
 * are invited.
 *
 * "Expired" is never stored. It is read from the validity date and from the
 * criteria that carry their own expiry, so an approval granted on cover that
 * lapses in March stops counting in April rather than when somebody notices.
 * The same reason the closeout gate reads the punch register instead of
 * offering a tickbox: a status somebody has to remember to change is a status
 * that is wrong.
 */

const STATUS = Object.freeze({
  DRAFT: "draft",
  UNDER_REVIEW: "under_review",
  APPROVED: "approved",
  CONDITIONALLY_APPROVED: "conditionally_approved",
  REJECTED: "rejected",
});
const STATUSES = Object.freeze(Object.values(STATUS));

/** Derived, never stored — see the note above. */
const EXPIRED = "expired";

/** Statuses that let a vendor be invited to price work. */
const QUALIFIED = Object.freeze([STATUS.APPROVED, STATUS.CONDITIONALLY_APPROVED]);

/** Statuses that carry a decision, and so need a validity date. */
const DECIDED = Object.freeze([...QUALIFIED, STATUS.REJECTED]);

/**
 * The assessment. Weights sum to 100 and each line is scored out of five, so
 * a vendor scoring five everywhere scores 100.
 *
 * `tracksExpiry` marks the lines that are only true until a date: cover and
 * licences lapse, a track record does not.
 */
const CRITERIA = Object.freeze([
  {
    key: "financial_capacity",
    label: "Financial capacity",
    category: "commercial",
    weight: 20,
    hint: "Turnover, working capital and credit against the size of the work",
  },
  {
    key: "safety_history",
    label: "Safety history",
    category: "hse",
    weight: 15,
    hint: "Incident and lost-time rates, and what changed after them",
  },
  {
    key: "experience",
    label: "Experience",
    category: "capability",
    weight: 15,
    hint: "Comparable work delivered, at comparable size and complexity",
  },
  {
    key: "references",
    label: "References",
    category: "capability",
    weight: 10,
    hint: "Clients contacted, not clients listed",
  },
  {
    key: "insurance",
    label: "Insurance and bonds",
    category: "compliance",
    weight: 10,
    tracksExpiry: true,
    hint: "Cover in place to the limits the contract will require",
  },
  {
    key: "licenses",
    label: "Licences and registrations",
    category: "compliance",
    weight: 10,
    tracksExpiry: true,
    hint: "Trade licences, tax registration and any statutory approvals",
  },
  {
    key: "manpower",
    label: "Manpower",
    category: "capability",
    weight: 8,
    hint: "Workforce available for this scope, not the company total",
  },
  {
    key: "equipment",
    label: "Plant and equipment",
    category: "capability",
    weight: 7,
    hint: "Owned or firmly committed, and fit for the method",
  },
  {
    key: "quality_history",
    label: "Quality history",
    category: "quality",
    weight: 5,
    hint: "Non-conformances, rework and defects on previous work",
  },
]);

const MAX_SCORE = 5;

/**
 * What the score suggests. Bands are deliberately wide: the point is to make a
 * decision that disagrees with the evidence visible, not to make the decision.
 */
const BAND = Object.freeze([
  { min: 80, recommendation: STATUS.APPROVED, label: "Approve" },
  { min: 60, recommendation: STATUS.CONDITIONALLY_APPROVED, label: "Approve with conditions" },
  { min: 0, recommendation: STATUS.REJECTED, label: "Reject" },
]);

const trimOrNull = (value) => {
  const text = String(value ?? "").trim();
  return text ? text : null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const parseDate = (value, field) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, "PREQUAL_DATE_INVALID", `${field} is not a date`);
  }
  return date;
};

// ─── scoring ───────────────────────────────────────────────────────────────

/**
 * The weighted score over the lines that have actually been scored.
 *
 * Unscored lines are not counted as zero — an assessment half done would then
 * look like a bad vendor rather than an unfinished assessment. They are
 * reported as gaps instead, and a decision cannot be recorded while any
 * required line is still unscored.
 */
const scoreOf = (criteria) => {
  const scored = criteria.filter((row) => row.score !== null && row.score !== undefined);
  const weight = scored.reduce((sum, row) => sum + (row.weight || 0), 0);
  if (!weight) return { score: null, scored: scored.length, weightAssessed: 0 };
  const earned = scored.reduce(
    (sum, row) => sum + (row.weight || 0) * (row.score / (row.maxScore || MAX_SCORE)),
    0
  );
  return { score: round2((earned / weight) * 100), scored: scored.length, weightAssessed: weight };
};

const bandFor = (score) =>
  score === null || score === undefined
    ? null
    : BAND.find((band) => score >= band.min) ?? BAND[BAND.length - 1];

/**
 * The date the qualification actually stops counting.
 *
 * Whichever comes first: the validity date somebody set, or the earliest
 * expiry on a criterion that carries one. Cover that lapses in March cannot
 * qualify anybody in April, whatever the certificate says.
 */
const effectiveExpiry = ({ validUntil, criteria }) => {
  const dates = [];
  if (validUntil) dates.push({ at: new Date(validUntil), source: "validity" });
  for (const row of criteria) {
    if (row.tracksExpiry && row.expiresAt) dates.push({ at: new Date(row.expiresAt), source: row.label });
  }
  if (!dates.length) return null;
  return dates.reduce((earliest, entry) => (entry.at < earliest.at ? entry : earliest));
};

// ─── reading one ───────────────────────────────────────────────────────────

const serializeCriterion = (row) => ({
  id: row.id,
  key: row.key,
  label: row.label,
  category: row.category,
  weight: row.weight,
  maxScore: row.maxScore,
  score: row.score ?? null,
  required: row.required,
  tracksExpiry: row.tracksExpiry,
  reference: row.reference ?? null,
  expiresAt: toIso(row.expiresAt),
  expired: Boolean(row.tracksExpiry && row.expiresAt && new Date(row.expiresAt) < new Date()),
  note: row.note ?? null,
  hint: CRITERIA.find((entry) => entry.key === row.key)?.hint ?? null,
  sortOrder: row.sortOrder ?? 0,
});

/**
 * What is stopping a decision being recorded.
 *
 * Named, not counted: "Safety history has not been scored" is a next step,
 * "3 outstanding" is a puzzle.
 */
const gapsIn = ({ criteria, status, validUntil, conditions, decisionNote }) => {
  const gaps = [];
  const now = new Date();
  for (const row of criteria) {
    if (row.required && (row.score === null || row.score === undefined)) {
      gaps.push(`${row.label} has not been scored`);
    }
    // A qualification granted on cover that has already lapsed is expired the
    // moment it is granted. Say so now rather than let it read as approved.
    if (QUALIFIED.includes(status) && row.tracksExpiry && row.expiresAt && new Date(row.expiresAt) < now) {
      gaps.push(`${row.label} expired on ${new Date(row.expiresAt).toISOString().slice(0, 10)}`);
    }
  }
  if (QUALIFIED.includes(status) && !validUntil) {
    gaps.push("A qualification with no expiry date is not a qualification — set one");
  }
  if (status === STATUS.CONDITIONALLY_APPROVED && !trimOrNull(conditions)) {
    gaps.push("Say what the conditions are");
  }
  if (status === STATUS.REJECTED && !trimOrNull(decisionNote)) {
    gaps.push("Say why the vendor was rejected");
  }
  return gaps;
};

const serialize = (record, { company = null } = {}) => {
  const criteria = (record.criteria || []).map(serializeCriterion);
  const { score, scored, weightAssessed } = scoreOf(record.criteria || []);
  const band = bandFor(score);
  const expiry = effectiveExpiry({ validUntil: record.validUntil, criteria: record.criteria || [] });
  const lapsed = Boolean(expiry && expiry.at < new Date());
  const effectiveStatus = lapsed && QUALIFIED.includes(record.status) ? EXPIRED : record.status;

  return {
    id: record.id,
    companyId: record.companyId,
    company: company ? { id: company.id, name: company.name, trades: company.trades || [] } : null,
    status: record.status,
    effectiveStatus,
    qualified: QUALIFIED.includes(record.status) && !lapsed,
    score,
    scoredCriteria: scored,
    weightAssessed,
    band: band ? band.label : null,
    recommendation: band ? band.recommendation : null,
    decisionAgainstScore:
      DECIDED.includes(record.status) && record.recommendation && record.recommendation !== record.status,
    storedRecommendation: record.recommendation ?? null,
    validUntil: toIso(record.validUntil),
    expiresAt: expiry ? expiry.at.toISOString() : null,
    expiresBecause: expiry && expiry.source !== "validity" ? expiry.source : null,
    expired: lapsed,
    singleAwardLimit: record.singleAwardLimit === null || record.singleAwardLimit === undefined
      ? null
      : toMoneyNumber(record.singleAwardLimit, 0),
    conditions: record.conditions ?? null,
    decisionNote: record.decisionNote ?? null,
    submittedAt: toIso(record.submittedAt),
    decidedAt: toIso(record.decidedAt),
    decidedBy: record.decidedBy ?? null,
    gaps: gapsIn({
      criteria: record.criteria || [],
      status: record.status,
      validUntil: record.validUntil,
      conditions: record.conditions,
      decisionNote: record.decisionNote,
    }),
    criteria,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
};

const loadCompany = async ({ orgId, companyId }) => {
  const company = await prisma.company.findFirst({
    where: { id: companyId, orgId },
    select: { id: true, name: true, trades: true, isVendor: true },
  });
  if (!company) throw new HttpError(404, "VENDOR_NOT_FOUND", "Vendor not found");
  return company;
};

/**
 * The assessment, created on first read with all nine criteria listed and
 * unscored. Listed and unscored, not absent: an assessment you have to
 * remember to add criteria to assesses whatever the assessor felt like.
 */
const ensurePrequalification = async ({ orgId, companyId, userId = null }) => {
  const existing = await prisma.vendorPrequalification.findFirst({
    where: { companyId, orgId },
    include: { criteria: { orderBy: [{ sortOrder: "asc" }] } },
  });
  if (existing) return existing;

  await loadCompany({ orgId, companyId });
  return prisma.vendorPrequalification.create({
    data: {
      orgId,
      companyId,
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
          tracksExpiry: Boolean(entry.tracksExpiry),
          sortOrder: index,
        })),
      },
    },
    include: { criteria: { orderBy: [{ sortOrder: "asc" }] } },
  });
};

const getPrequalification = async ({ orgId, companyId, userId = null }) => {
  const [company, record] = await Promise.all([
    loadCompany({ orgId, companyId }),
    ensurePrequalification({ orgId, companyId, userId }),
  ]);
  return serialize(record, { company });
};

// ─── scoring a criterion ───────────────────────────────────────────────────

const scoreCriterion = async ({ orgId, companyId, key, payload = {}, userId = null }) => {
  const record = await ensurePrequalification({ orgId, companyId, userId });
  const criterion = record.criteria.find((row) => row.key === key);
  if (!criterion) {
    throw new HttpError(404, "PREQUAL_CRITERION_UNKNOWN", `No prequalification criterion called "${key}"`);
  }
  if (DECIDED.includes(record.status)) {
    throw new HttpError(
      409,
      "PREQUAL_DECIDED",
      "This assessment has been decided; reopen it before changing a score"
    );
  }

  const data = {};
  if (payload.score !== undefined) {
    if (payload.score === null) {
      data.score = null;
    } else {
      const score = Number(payload.score);
      if (!Number.isInteger(score) || score < 0 || score > criterion.maxScore) {
        throw new HttpError(
          400,
          "PREQUAL_SCORE_INVALID",
          `${criterion.label}: score 0 to ${criterion.maxScore}`
        );
      }
      data.score = score;
    }
  }
  if (payload.note !== undefined) data.note = trimOrNull(payload.note)?.slice(0, 2000) ?? null;
  if (payload.reference !== undefined) data.reference = trimOrNull(payload.reference)?.slice(0, 200) ?? null;
  const expiresAt = parseDate(payload.expiresAt, "expiresAt");
  if (expiresAt !== undefined) {
    if (expiresAt && !criterion.tracksExpiry) {
      throw new HttpError(
        400,
        "PREQUAL_EXPIRY_NOT_TRACKED",
        `${criterion.label} does not expire — only cover and licences do`
      );
    }
    data.expiresAt = expiresAt;
  }
  if (!Object.keys(data).length) return getPrequalification({ orgId, companyId, userId });

  await prisma.prequalCriterion.update({ where: { id: criterion.id }, data });
  await prisma.vendorPrequalification.update({
    where: { id: record.id },
    data: { updatedBy: userId, status: record.status === STATUS.DRAFT ? STATUS.UNDER_REVIEW : record.status },
  });
  return getPrequalification({ orgId, companyId, userId });
};

// ─── the decision ──────────────────────────────────────────────────────────

const recordAudit = async ({ orgId, companyId, userId, action, metadata = {} }) => {
  if (!prisma.authAuditEvent?.create) return null;
  return prisma.authAuditEvent
    .create({
      data: {
        orgId,
        actorId: userId,
        entityType: "vendor_prequalification",
        entityId: companyId,
        action,
        metadataJson: metadata,
      },
    })
    .catch(() => null);
};

/**
 * Records the decision.
 *
 * Every required criterion has to be scored first — a qualification decided
 * on half an assessment is somebody's opinion with a number attached. An
 * approval needs a validity date, a conditional approval needs its conditions
 * written down, and a rejection needs a reason, because the vendor will ask.
 *
 * The score's own recommendation is stored with the decision, so an approval
 * granted over a failing score stays visible.
 */
const decide = async ({ orgId, companyId, payload = {}, userId = null }) => {
  const record = await ensurePrequalification({ orgId, companyId, userId });
  const status = payload.status;
  if (!DECIDED.includes(status)) {
    throw new HttpError(
      400,
      "PREQUAL_DECISION_INVALID",
      `status must be one of ${DECIDED.join(", ")}`
    );
  }

  const validUntil = parseDate(payload.validUntil, "validUntil") ?? record.validUntil ?? null;
  const conditions =
    payload.conditions === undefined ? record.conditions : trimOrNull(payload.conditions)?.slice(0, 4000) ?? null;
  const decisionNote =
    payload.decisionNote === undefined
      ? record.decisionNote
      : trimOrNull(payload.decisionNote)?.slice(0, 4000) ?? null;

  const gaps = gapsIn({ criteria: record.criteria, status, validUntil, conditions, decisionNote });
  if (gaps.length) {
    const error = new HttpError(
      409,
      "PREQUAL_INCOMPLETE",
      `The assessment is not ready to decide: ${gaps.length} thing${gaps.length === 1 ? "" : "s"} outstanding`
    );
    error.details = { gaps };
    throw error;
  }

  if (validUntil && QUALIFIED.includes(status) && validUntil < new Date()) {
    throw new HttpError(
      400,
      "PREQUAL_VALIDITY_PAST",
      "The validity date has already passed — a qualification cannot start expired"
    );
  }

  let singleAwardLimit = record.singleAwardLimit;
  if (payload.singleAwardLimit !== undefined) {
    singleAwardLimit =
      payload.singleAwardLimit === null || payload.singleAwardLimit === ""
        ? null
        : toMoneyNumber(payload.singleAwardLimit, 0);
    if (singleAwardLimit !== null && singleAwardLimit <= 0) {
      throw new HttpError(400, "PREQUAL_LIMIT_INVALID", "A single-award limit has to be a positive amount");
    }
  }

  const { score } = scoreOf(record.criteria);
  const band = bandFor(score);

  await prisma.vendorPrequalification.update({
    where: { id: record.id },
    data: {
      status,
      score,
      recommendation: band ? band.recommendation : null,
      validUntil,
      conditions,
      decisionNote,
      singleAwardLimit,
      submittedAt: record.submittedAt ?? new Date(),
      decidedAt: new Date(),
      decidedBy: userId,
      updatedBy: userId,
    },
  });

  await recordAudit({
    orgId,
    companyId,
    userId,
    action: "decided",
    metadata: {
      status,
      score,
      recommendation: band ? band.recommendation : null,
      againstScore: Boolean(band && band.recommendation !== status),
      validUntil: toIso(validUntil),
    },
  });

  return getPrequalification({ orgId, companyId, userId });
};

/**
 * Reopens a decided assessment — a renewal, or new evidence.
 *
 * The scores stay; what is dropped is the decision. Re-assessing a vendor
 * from a blank sheet every year throws away the only history worth having.
 */
const reopen = async ({ orgId, companyId, reason, userId = null }) => {
  if (!trimOrNull(reason)) {
    throw new HttpError(400, "PREQUAL_REOPEN_REASON_REQUIRED", "Say why the assessment is being reopened");
  }
  const record = await ensurePrequalification({ orgId, companyId, userId });
  await prisma.vendorPrequalification.update({
    where: { id: record.id },
    data: {
      status: STATUS.UNDER_REVIEW,
      decidedAt: null,
      decidedBy: null,
      updatedBy: userId,
    },
  });
  await recordAudit({ orgId, companyId, userId, action: "reopened", metadata: { reason: trimOrNull(reason) } });
  return getPrequalification({ orgId, companyId, userId });
};

// ─── the gate ──────────────────────────────────────────────────────────────

/**
 * The prequalification state of several vendors at once, for list screens and
 * for the bid-invitation gate. A vendor with no assessment reads as
 * `not_assessed` rather than being left out — the absence is the finding.
 */
const statesFor = async ({ orgId, companyIds = [] }) => {
  const ids = [...new Set(companyIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await prisma.vendorPrequalification.findMany({
    where: { orgId, companyId: { in: ids } },
    include: { criteria: { orderBy: [{ sortOrder: "asc" }] } },
  });
  const byCompany = new Map();
  for (const row of rows) {
    const view = serialize(row);
    byCompany.set(row.companyId, {
      status: view.effectiveStatus,
      qualified: view.qualified,
      score: view.score,
      validUntil: view.validUntil,
      expiresAt: view.expiresAt,
      expiresBecause: view.expiresBecause,
      singleAwardLimit: view.singleAwardLimit,
      conditions: view.conditions,
    });
  }
  for (const id of ids) {
    if (!byCompany.has(id)) {
      byCompany.set(id, {
        status: "not_assessed",
        qualified: false,
        score: null,
        validUntil: null,
        expiresAt: null,
        expiresBecause: null,
        singleAwardLimit: null,
        conditions: null,
      });
    }
  }
  return byCompany;
};

/** Plain English for a state, used in both gate messages. */
const describe = (state) => {
  if (!state || state.status === "not_assessed") return "has not been prequalified";
  if (state.status === EXPIRED) {
    return state.expiresBecause
      ? `is prequalified but ${state.expiresBecause.toLowerCase()} expired on ${state.expiresAt?.slice(0, 10)}`
      : `has a prequalification that expired on ${state.expiresAt?.slice(0, 10)}`;
  }
  if (state.status === STATUS.REJECTED) return "was rejected at prequalification";
  if (state.status === STATUS.DRAFT || state.status === STATUS.UNDER_REVIEW) {
    return "has a prequalification still under review";
  }
  return "is prequalified";
};

/**
 * Refuses to let an unqualified vendor be invited to price work, and says
 * which vendors and why.
 *
 * A PM can go ahead with a reason. The point is not to make prequalification
 * impossible to bypass — it is to make bypassing it a decision somebody put
 * their name to.
 */
const assertInvitable = async ({ orgId, companies = [], override = null }) => {
  const known = companies.filter((entry) => entry.companyId);
  if (!known.length) return [];
  const companyIds = known.map((entry) => entry.companyId);
  const [states, named] = await Promise.all([
    statesFor({ orgId, companyIds }),
    prisma.company.findMany({ where: { orgId, id: { in: companyIds } }, select: { id: true, name: true } }),
  ]);
  const nameById = new Map(named.map((row) => [row.id, row.name]));
  const blocked = known
    .map((entry) => ({
      ...entry,
      name: nameById.get(entry.companyId) || entry.name || "This vendor",
      state: states.get(entry.companyId),
    }))
    .filter((entry) => !entry.state?.qualified);
  if (!blocked.length || trimOrNull(override)) return blocked;

  const error = new HttpError(
    409,
    "PREQUAL_NOT_QUALIFIED",
    blocked.map((entry) => `${entry.name} ${describe(entry.state)}`).join("; ")
  );
  error.details = {
    vendors: blocked.map((entry) => ({
      companyId: entry.companyId,
      name: entry.name,
      status: entry.state?.status ?? "not_assessed",
      reason: describe(entry.state),
    })),
  };
  throw error;
};

/**
 * The award check: the vendor is qualified, and the award is inside whatever
 * single-award limit a conditional approval set.
 *
 * The limit is the only part of a conditional approval that means anything on
 * its own — "approved for work up to 500,000" is a number, and the award is a
 * number, so the system can hold it. The written conditions are for people.
 */
const assertAwardable = async ({ orgId, companyId, companyName, amount = 0, override = null }) => {
  const states = await statesFor({ orgId, companyIds: [companyId] });
  const state = states.get(companyId);
  const value = toMoneyNumber(amount, 0);
  const reasons = [];

  if (!state?.qualified) reasons.push(`${companyName} ${describe(state)}`);
  else if (state.singleAwardLimit !== null && value > state.singleAwardLimit) {
    reasons.push(
      `${companyName} is conditionally approved up to ${state.singleAwardLimit}; this award is ${value}`
    );
  }

  if (!reasons.length || trimOrNull(override)) return state;

  const error = new HttpError(409, "PREQUAL_AWARD_BLOCKED", reasons.join("; "));
  error.details = {
    companyId,
    status: state?.status ?? "not_assessed",
    singleAwardLimit: state?.singleAwardLimit ?? null,
    amount: value,
    reasons,
  };
  throw error;
};

/**
 * Every vendor's prequalification state at a glance, with the ones expiring
 * soon called out — a qualification that lapses the week a package goes out
 * is a problem best found before the package goes out.
 */
const listStates = async ({ orgId, withinDays = 60 }) => {
  const [companies, rows] = await Promise.all([
    prisma.company.findMany({
      where: { orgId, isVendor: true, status: "active" },
      select: { id: true, name: true, trades: true },
      orderBy: [{ name: "asc" }],
      take: 500,
    }),
    prisma.vendorPrequalification.findMany({
      where: { orgId },
      include: { criteria: { orderBy: [{ sortOrder: "asc" }] } },
    }),
  ]);
  const byCompany = new Map(rows.map((row) => [row.companyId, serialize(row)]));
  const horizon = new Date(Date.now() + withinDays * 86_400_000);

  const items = companies.map((company) => {
    const view = byCompany.get(company.id);
    const expiresAt = view?.expiresAt ? new Date(view.expiresAt) : null;
    return {
      companyId: company.id,
      name: company.name,
      trades: company.trades || [],
      status: view ? view.effectiveStatus : "not_assessed",
      qualified: Boolean(view?.qualified),
      score: view?.score ?? null,
      validUntil: view?.validUntil ?? null,
      expiresAt: view?.expiresAt ?? null,
      expiresBecause: view?.expiresBecause ?? null,
      expiringSoon: Boolean(view?.qualified && expiresAt && expiresAt <= horizon),
      singleAwardLimit: view?.singleAwardLimit ?? null,
      gaps: view?.gaps ?? [],
    };
  });

  return {
    items,
    summary: {
      vendors: items.length,
      qualified: items.filter((item) => item.qualified).length,
      notAssessed: items.filter((item) => item.status === "not_assessed").length,
      underReview: items.filter((item) => [STATUS.DRAFT, STATUS.UNDER_REVIEW].includes(item.status)).length,
      expired: items.filter((item) => item.status === EXPIRED).length,
      rejected: items.filter((item) => item.status === STATUS.REJECTED).length,
      expiringSoon: items.filter((item) => item.expiringSoon).length,
    },
  };
};

module.exports = {
  BAND,
  CRITERIA,
  DECIDED,
  EXPIRED,
  MAX_SCORE,
  QUALIFIED,
  STATUS,
  STATUSES,
  assertAwardable,
  assertInvitable,
  bandFor,
  decide,
  describe,
  effectiveExpiry,
  ensurePrequalification,
  gapsIn,
  getPrequalification,
  listStates,
  reopen,
  scoreCriterion,
  scoreOf,
  serialize,
  statesFor,
};
