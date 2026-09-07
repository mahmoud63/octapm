const store = { evaluations: [], criteria: [], commitments: [], ncrs: [], punch: [], incidents: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;

const matches = (row, where = {}) =>
  Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
      if ("in" in expected) return expected.in.includes(row[key]);
      if ("not" in expected) return row[key] !== expected.not;
      return matches(row[key] || {}, expected);
    }
    return row[key] === expected;
  });

const withCriteria = (row) =>
  row
    ? {
        ...row,
        criteria: store.criteria
          .filter((item) => item.evaluationId === row.id)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      }
    : row;

const mockPrisma = {
  commitment: {
    findFirst: jest.fn(async ({ where }) => store.commitments.find((row) => matches(row, where)) || null),
  },
  subcontractorEvaluation: {
    findFirst: jest.fn(async ({ where }) => withCriteria(store.evaluations.find((row) => matches(row, where)) || null)),
    findMany: jest.fn(async ({ where } = {}) => store.evaluations.filter((row) => matches(row, where))),
    create: jest.fn(async ({ data }) => {
      const { criteria, ...rest } = data;
      const row = { id: nextId("ev"), status: "draft", createdAt: new Date(), updatedAt: new Date(), ...rest };
      store.evaluations.push(row);
      for (const entry of criteria?.create ?? []) {
        store.criteria.push({ id: nextId("cr"), evaluationId: row.id, score: null, overrideReason: null, note: null, ...entry });
      }
      return withCriteria(row);
    }),
    update: jest.fn(async ({ where, data }) => {
      const row = store.evaluations.find((item) => item.id === where.id);
      Object.assign(row, data);
      return withCriteria(row);
    }),
  },
  evaluationCriterion: {
    upsert: jest.fn(async ({ where, create, update }) => {
      const { evaluationId, key } = where.evaluationId_key;
      const row = store.criteria.find((item) => item.evaluationId === evaluationId && item.key === key);
      if (row) {
        Object.assign(row, update);
        return row;
      }
      const created = { id: nextId("cr"), score: null, overrideReason: null, note: null, ...create };
      store.criteria.push(created);
      return created;
    }),
  },
  ncrRecord: { findMany: jest.fn(async ({ where }) => store.ncrs.filter((row) => matches(row, where))) },
  punchItem: { findMany: jest.fn(async ({ where }) => store.punch.filter((row) => matches(row, where))) },
  safetyIncident: { findMany: jest.fn(async ({ where }) => store.incidents.filter((row) => matches(row, where))) },
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => ({
  ENTITY_TYPES: { COMMITMENT: "commitment" },
  ACTIONS: { APPROVED: "approved", UPDATED: "updated" },
  recordEvent: jest.fn(async () => ({})),
}));

const service = require("../subcontractor-evaluation.service");

const ORG = "org-1";
const PROJECT = "p1";
const COMMITMENT = "sc-1";
const VENDOR = "co-1";

const days = (n) => new Date(Date.now() + n * 86_400_000);

/** A subcontract with a clean record: nothing raised, no changes, closeout untouched. */
const seedCommitment = (overrides = {}) => {
  store.commitments.push({
    id: COMMITMENT,
    orgId: ORG,
    projectId: PROJECT,
    ref: "SC-0001",
    title: "Concrete frame",
    type: "subcontract",
    status: "executed",
    currency: "USD",
    vendorCompanyId: VENDOR,
    vendorCompany: { id: VENDOR, name: "Meridian Concrete" },
    lines: [{ amount: 1000000 }],
    changeOrders: [],
    closeout: null,
    ...overrides,
  });
};

const read = () => service.buildEvaluation({ orgId: ORG, projectId: PROJECT, commitmentId: COMMITMENT });
const lineFor = (view, key) => view.criteria.find((line) => line.key === key);

beforeEach(() => {
  for (const key of Object.keys(store)) store[key].length = 0;
  seq = 0;
});

describe("the evaluation", () => {
  it("opens with all eight criteria listed and weights that sum to 100", async () => {
    seedCommitment();
    const view = await read();

    expect(view.criteria).toHaveLength(8);
    expect(view.criteria.reduce((sum, line) => sum + line.weight, 0)).toBe(100);
    // Six read from the records, two a person judges.
    expect(view.criteria.filter((line) => line.source === "derived")).toHaveLength(6);
    expect(view.criteria.filter((line) => line.source === "rated")).toHaveLength(2);
    expect(view.gaps).toEqual([
      "Programme has not been rated",
      "Site management has not been rated",
      "Say whether you would use them again",
    ]);
  });

  it("refuses a purchase order, which buys a thing rather than a package of work", async () => {
    seedCommitment({ type: "purchase_order" });
    await expect(read()).rejects.toMatchObject({ code: "EVALUATION_NOT_A_SUBCONTRACT" });
  });

  it("is created once and read back", async () => {
    seedCommitment();
    await read();
    await read();
    expect(store.evaluations).toHaveLength(1);
    expect(store.criteria).toHaveLength(8);
  });
});

describe("what the records already say", () => {
  it("weights a major non-conformance above a minor one", async () => {
    seedCommitment();
    store.ncrs.push(
      { projectId: PROJECT, assigneeCompanyId: VENDOR, severity: "major", status: "closed", dueDate: null, closedDate: null },
      { projectId: PROJECT, assigneeCompanyId: VENDOR, severity: "minor", status: "closed", dueDate: null, closedDate: null },
    );
    const view = await read();
    const quality = lineFor(view, "quality");
    // 2.5 + 1 = 3.5 weighted, which lands on 2 of 5.
    expect(quality.score).toBe(2);
    expect(quality.detail).toBe("1 major and 1 minor non-conformances");
  });

  it("scores a clean record full marks and says so", async () => {
    seedCommitment();
    const view = await read();
    expect(lineFor(view, "quality")).toMatchObject({ score: 5, detail: "No non-conformances raised" });
    expect(lineFor(view, "safety")).toMatchObject({ score: 5, detail: "No incidents recorded" });
    expect(lineFor(view, "snagging")).toMatchObject({ score: 5, detail: "No punch items raised" });
  });

  it("treats one critical incident as more than several low ones", async () => {
    seedCommitment();
    store.incidents.push({ projectId: PROJECT, assigneeCompanyId: VENDOR, severity: "critical", status: "closed" });
    const critical = lineFor(await read(), "safety");

    store.evaluations.length = 0;
    store.criteria.length = 0;
    store.incidents.length = 0;
    store.incidents.push(
      ...[1, 2].map(() => ({ projectId: PROJECT, assigneeCompanyId: VENDOR, severity: "low", status: "closed" })),
    );
    const low = lineFor(await read(), "safety");

    expect(critical.score).toBeLessThan(low.score);
    expect(critical.detail).toContain("worst critical");
  });

  it("counts only what carried a due date when measuring responsiveness", async () => {
    seedCommitment();
    store.ncrs.push(
      { projectId: PROJECT, assigneeCompanyId: VENDOR, severity: "minor", status: "closed", dueDate: days(-10), closedDate: days(-12) },
      { projectId: PROJECT, assigneeCompanyId: VENDOR, severity: "minor", status: "closed", dueDate: days(-10), closedDate: days(-2) },
      // No due date: holding somebody to a date nobody set is not responsiveness.
      { projectId: PROJECT, assigneeCompanyId: VENDOR, severity: "minor", status: "open", dueDate: null, closedDate: null },
    );
    const line = lineFor(await read(), "responsiveness");
    expect(line.detail).toBe("1 of 2 closed late or still overdue");
    expect(line.score).toBe(2);
  });

  it("says so rather than scoring zero when there is nothing to measure", async () => {
    seedCommitment();
    const view = await read();
    // Nothing was raised with a due date, and the closeout has not been opened.
    expect(lineFor(view, "responsiveness").score).toBeNull();
    expect(lineFor(view, "documentation").score).toBeNull();
    expect(view.unmeasurable).toHaveLength(2);
    // Those lines drop out of the weighting rather than dragging the score down.
    expect(view.weightScored).toBe(100 - 10 - 10 - 10 - 5);
  });
});

describe("cost control", () => {
  it("does not charge a client's variation to the subcontractor's record", async () => {
    seedCommitment({
      changeOrders: [
        // The client varied the work; that says nothing about the subcontractor.
        { status: "approved", value: 200000, primeChangeOrderId: "pco-1" },
      ],
    });
    const line = lineFor(await read(), "cost_control");
    expect(line.score).toBe(5);
    expect(line.detail).toBe("No additions of their own (1 client variation passed down, not counted)");
  });

  it("counts additions the subcontractor raised themselves", async () => {
    seedCommitment({
      changeOrders: [
        { status: "approved", value: 80000, primeChangeOrderId: null },
        { status: "pending", value: 500000, primeChangeOrderId: null },
        { status: "approved", value: -30000, primeChangeOrderId: null },
      ],
    });
    const line = lineFor(await read(), "cost_control");
    // 8% of a million, from the one approved addition of their own. The
    // omission does not net off — a client-instructed omission cannot pay for
    // the subcontractor's own growth.
    expect(line.detail).toBe("8% added by 1 change order of their own");
    expect(line.score).toBe(1);
  });

  it("has nothing to measure against when the subcontract has no value", async () => {
    seedCommitment({ lines: [] });
    expect(lineFor(await read(), "cost_control").score).toBeNull();
  });
});

describe("documentation", () => {
  const closeoutWith = (items, status = "open") => ({ id: "cl-1", status, items });

  it("does not score a closeout nobody has started", async () => {
    seedCommitment({
      closeout: closeoutWith([
        { key: "as_builts", status: "outstanding", required: true },
        { key: "om_manuals", status: "outstanding", required: true },
        // A waived derived check is not a handover document.
        { key: "insurance_current", status: "waived", required: true },
      ]),
    });
    const line = lineFor(await read(), "documentation");
    expect(line.score).toBeNull();
    expect(line.detail).toBe("The closeout handover has not been started");
  });

  it("scores the handover once it is under way, and a waiver is not a delivery", async () => {
    seedCommitment({
      closeout: closeoutWith([
        { key: "as_builts", status: "complete", required: true },
        { key: "om_manuals", status: "complete", required: true },
        { key: "warranties", status: "waived", required: true },
        { key: "lien_waiver", status: "outstanding", required: true },
      ]),
    });
    const line = lineFor(await read(), "documentation");
    expect(line.detail).toBe("2 of 4 handover requirements delivered, 1 waived");
    expect(line.score).toBe(2);
  });
});

describe("overriding what the records say", () => {
  it("needs a reason, and keeps the reading beside the override", async () => {
    seedCommitment();
    store.ncrs.push(
      { projectId: PROJECT, assigneeCompanyId: VENDOR, severity: "major", status: "closed", dueDate: null, closedDate: null },
    );

    await expect(
      service.scoreCriterion({ orgId: ORG, projectId: PROJECT, commitmentId: COMMITMENT, key: "quality", payload: { score: 5 } }),
    ).rejects.toMatchObject({ code: "EVALUATION_OVERRIDE_REASON_REQUIRED" });

    const view = await service.scoreCriterion({
      orgId: ORG,
      projectId: PROJECT,
      commitmentId: COMMITMENT,
      key: "quality",
      payload: { score: 5, overrideReason: "Raised in error and withdrawn the same day." },
    });
    const quality = lineFor(view, "quality");
    expect(quality).toMatchObject({ score: 5, derivedScore: 3, overridden: true });
    expect(quality.overrideReason).toBe("Raised in error and withdrawn the same day.");
  });

  it("puts the reading back when the override is cleared", async () => {
    seedCommitment();
    store.ncrs.push(
      { projectId: PROJECT, assigneeCompanyId: VENDOR, severity: "major", status: "closed", dueDate: null, closedDate: null },
    );
    await service.scoreCriterion({
      orgId: ORG, projectId: PROJECT, commitmentId: COMMITMENT, key: "quality",
      payload: { score: 5, overrideReason: "Withdrawn" },
    });
    const view = await service.scoreCriterion({
      orgId: ORG, projectId: PROJECT, commitmentId: COMMITMENT, key: "quality", payload: { score: null },
    });
    expect(lineFor(view, "quality")).toMatchObject({ score: 3, overridden: false, overrideReason: null });
  });

  it("takes a rated line with no reason, because nothing was overridden", async () => {
    seedCommitment();
    const view = await service.scoreCriterion({
      orgId: ORG, projectId: PROJECT, commitmentId: COMMITMENT, key: "schedule", payload: { score: 3 },
    });
    expect(lineFor(view, "schedule").score).toBe(3);
    expect(view.gaps).not.toContain("Programme has not been rated");
  });

  it("writes a row for a criterion an older evaluation never had", async () => {
    seedCommitment();
    await read();
    // An evaluation created before the scale grew: its row for this criterion
    // does not exist. Scoring it should write one rather than fail.
    const index = store.criteria.findIndex((row) => row.key === "management");
    store.criteria.splice(index, 1);

    const view = await service.scoreCriterion({
      orgId: ORG, projectId: PROJECT, commitmentId: COMMITMENT, key: "management", payload: { score: 5 },
    });
    expect(lineFor(view, "management").score).toBe(5);
  });

  it("rejects a score outside the scale and an unknown criterion", async () => {
    seedCommitment();
    await expect(
      service.scoreCriterion({ orgId: ORG, projectId: PROJECT, commitmentId: COMMITMENT, key: "schedule", payload: { score: 7 } }),
    ).rejects.toMatchObject({ code: "EVALUATION_SCORE_INVALID" });
    await expect(
      service.scoreCriterion({ orgId: ORG, projectId: PROJECT, commitmentId: COMMITMENT, key: "charisma", payload: { score: 3 } }),
    ).rejects.toMatchObject({ code: "EVALUATION_CRITERION_UNKNOWN" });
  });
});

describe("finalising", () => {
  const complete = async () => {
    for (const [key, score] of [["schedule", 4], ["management", 4]]) {
      await service.scoreCriterion({ orgId: ORG, projectId: PROJECT, commitmentId: COMMITMENT, key, payload: { score } });
    }
    return service.setVerdict({
      orgId: ORG, projectId: PROJECT, commitmentId: COMMITMENT,
      payload: { wouldReuse: true, summary: "Held the programme; strong on safety." },
    });
  };

  it("is refused while a rated line is unrated or the verdict is unanswered", async () => {
    seedCommitment();
    await expect(service.finalise({ orgId: ORG, projectId: PROJECT, commitmentId: COMMITMENT })).rejects.toMatchObject({
      code: "EVALUATION_INCOMPLETE",
      details: { gaps: expect.arrayContaining(["Say whether you would use them again"]) },
    });
  });

  it("stamps the score and locks scoring", async () => {
    seedCommitment();
    const ready = await complete();
    expect(ready.ready).toBe(true);

    const final = await service.finalise({ orgId: ORG, projectId: PROJECT, commitmentId: COMMITMENT, userId: "pm-1" });
    expect(final.status).toBe("final");
    expect(final.score).toBeGreaterThan(0);
    expect(store.evaluations[0].score).toBe(final.score);

    await expect(
      service.scoreCriterion({ orgId: ORG, projectId: PROJECT, commitmentId: COMMITMENT, key: "schedule", payload: { score: 1 } }),
    ).rejects.toMatchObject({ code: "EVALUATION_FINAL" });
    await expect(
      service.setVerdict({ orgId: ORG, projectId: PROJECT, commitmentId: COMMITMENT, payload: { wouldReuse: false } }),
    ).rejects.toMatchObject({ code: "EVALUATION_FINAL" });
  });

  it("reopens with a reason and keeps the scores", async () => {
    seedCommitment();
    await complete();
    await service.finalise({ orgId: ORG, projectId: PROJECT, commitmentId: COMMITMENT });

    await expect(service.reopen({ orgId: ORG, projectId: PROJECT, commitmentId: COMMITMENT, reason: " " })).rejects.toMatchObject({
      code: "EVALUATION_REOPEN_REASON_REQUIRED",
    });

    const reopened = await service.reopen({
      orgId: ORG, projectId: PROJECT, commitmentId: COMMITMENT, reason: "New evidence on the rebar delays",
    });
    expect(reopened.status).toBe("draft");
    expect(lineFor(reopened, "schedule").score).toBe(4);
  });
});

describe("the company's history", () => {
  it("averages only finalised evaluations and counts the reuse answers as a fraction", async () => {
    store.evaluations.push(
      { id: "e1", orgId: ORG, companyId: VENDOR, status: "final", score: 80, wouldReuse: true, evaluatedAt: days(-30) },
      { id: "e2", orgId: ORG, companyId: VENDOR, status: "final", score: 60, wouldReuse: false, evaluatedAt: days(-10) },
      // Still a draft: a half-finished evaluation averaged in is worse than
      // none, because it looks like one.
      { id: "e3", orgId: ORG, companyId: VENDOR, status: "draft", score: 10, wouldReuse: true, evaluatedAt: null },
    );
    const history = await service.historyFor({ orgId: ORG, companyIds: [VENDOR, "co-2"] });

    expect(history.get(VENDOR)).toMatchObject({ evaluations: 2, score: 70, wouldReuse: { yes: 1, of: 2 } });
    // A company nobody has evaluated is reported, not omitted.
    expect(history.get("co-2")).toMatchObject({ evaluations: 0, score: null, wouldReuse: null });
  });
});
