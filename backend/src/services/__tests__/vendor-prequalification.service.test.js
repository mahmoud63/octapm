const store = { prequals: [], criteria: [], companies: [], audits: [], evaluations: [] };
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
    ? { ...row, criteria: store.criteria.filter((item) => item.prequalId === row.id).sort((a, b) => a.sortOrder - b.sortOrder) }
    : row;

const mockPrisma = {
  company: {
    findFirst: jest.fn(async ({ where }) => store.companies.find((row) => matches(row, where)) || null),
    findMany: jest.fn(async ({ where } = {}) => store.companies.filter((row) => matches(row, where))),
  },
  vendorPrequalification: {
    findFirst: jest.fn(async ({ where }) => withCriteria(store.prequals.find((row) => matches(row, where)) || null)),
    findMany: jest.fn(async ({ where } = {}) => store.prequals.filter((row) => matches(row, where)).map(withCriteria)),
    create: jest.fn(async ({ data }) => {
      const { criteria, ...rest } = data;
      const row = { id: nextId("pq"), status: "draft", createdAt: new Date(), updatedAt: new Date(), ...rest };
      store.prequals.push(row);
      for (const entry of criteria?.create ?? []) {
        store.criteria.push({
          id: nextId("cr"),
          prequalId: row.id,
          score: null,
          required: true,
          tracksExpiry: false,
          expiresAt: null,
          reference: null,
          note: null,
          ...entry,
        });
      }
      return withCriteria(row);
    }),
    update: jest.fn(async ({ where, data }) => {
      const row = store.prequals.find((item) => item.id === where.id);
      Object.assign(row, data);
      return withCriteria(row);
    }),
  },
  prequalCriterion: {
    update: jest.fn(async ({ where, data }) => {
      const row = store.criteria.find((item) => item.id === where.id);
      Object.assign(row, data);
      return row;
    }),
  },
  // The assessment now carries what their finished subcontracts said about
  // them, so reading one reads the evaluations too.
  subcontractorEvaluation: {
    findMany: jest.fn(async ({ where } = {}) => store.evaluations.filter((row) => matches(row, where))),
  },
  authAuditEvent: { create: jest.fn(async ({ data }) => (store.audits.push(data), data)) },
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const service = require("../vendor-prequalification.service");

const ORG = "org-1";
const COMPANY = "co-1";

/** Scores every criterion, so a decision is not blocked by an unfinished assessment. */
const scoreAll = async (score = 4, companyId = COMPANY) => {
  for (const entry of service.CRITERIA) {
    await service.scoreCriterion({ orgId: ORG, companyId, key: entry.key, payload: { score }, userId: "pm-1" });
  }
};

const future = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
const past = (days) => new Date(Date.now() - days * 86_400_000).toISOString();

beforeEach(() => {
  for (const key of Object.keys(store)) store[key].length = 0;
  seq = 0;
  store.companies.push(
    { id: COMPANY, orgId: ORG, name: "Meridian Concrete", trades: ["concrete"], isVendor: true, status: "active" },
    { id: "co-2", orgId: ORG, name: "Delta Piling", trades: ["piling"], isVendor: true, status: "active" },
  );
});

describe("the assessment", () => {
  it("opens with all nine criteria listed, unscored, and weights that sum to 100", async () => {
    const view = await service.getPrequalification({ orgId: ORG, companyId: COMPANY });

    expect(view.criteria).toHaveLength(9);
    expect(view.criteria.reduce((sum, row) => sum + row.weight, 0)).toBe(100);
    expect(view.criteria.every((row) => row.score === null)).toBe(true);
    // Listed and unscored, not absent — an assessment you have to remember to
    // add criteria to assesses whatever the assessor felt like.
    expect(view.gaps).toHaveLength(9);
    expect(view.gaps[0]).toBe("Financial capacity has not been scored");
    expect(view.score).toBeNull();
    expect(view.qualified).toBe(false);
  });

  it("is created once and read back, not created again", async () => {
    await service.getPrequalification({ orgId: ORG, companyId: COMPANY });
    await service.getPrequalification({ orgId: ORG, companyId: COMPANY });
    expect(store.prequals).toHaveLength(1);
    expect(store.criteria).toHaveLength(9);
  });

  it("refuses an unknown company", async () => {
    await expect(service.getPrequalification({ orgId: ORG, companyId: "nope" })).rejects.toMatchObject({
      code: "VENDOR_NOT_FOUND",
    });
  });

  it("carries what their finished subcontracts said about them", async () => {
    // The loop the two stages exist to close: performance is scored at
    // closeout so it turns up here, where somebody decides whether to qualify
    // them again.
    store.evaluations.push(
      { id: "e1", orgId: ORG, companyId: COMPANY, status: "final", score: 82, wouldReuse: true, evaluatedAt: new Date() },
      { id: "e2", orgId: ORG, companyId: COMPANY, status: "final", score: 74, wouldReuse: false, evaluatedAt: new Date() },
    );
    const view = await service.getPrequalification({ orgId: ORG, companyId: COMPANY });
    expect(view.performance).toMatchObject({ evaluations: 2, score: 78, wouldReuse: { yes: 1, of: 2 } });
  });

  it("reports no history rather than omitting it for a vendor nobody has used", async () => {
    const view = await service.getPrequalification({ orgId: ORG, companyId: COMPANY });
    expect(view.performance).toMatchObject({ evaluations: 0, score: null, wouldReuse: null });
  });
});

describe("scoring", () => {
  it("weights the score over the criteria actually scored, not counting the rest as zero", async () => {
    // Only financial capacity, and full marks: the score is 100, not 20.
    const view = await service.scoreCriterion({
      orgId: ORG,
      companyId: COMPANY,
      key: "financial_capacity",
      payload: { score: 5 },
    });
    expect(view.score).toBe(100);
    expect(view.weightAssessed).toBe(20);
    // An unfinished assessment still cannot be decided.
    expect(view.gaps).toHaveLength(8);
  });

  it("computes the weighted total", async () => {
    const scores = {
      financial_capacity: 4,
      safety_history: 5,
      experience: 4,
      references: 3,
      insurance: 5,
      licenses: 4,
      manpower: 4,
      equipment: 3,
      quality_history: 4,
    };
    let view;
    for (const [key, score] of Object.entries(scores)) {
      view = await service.scoreCriterion({ orgId: ORG, companyId: COMPANY, key, payload: { score } });
    }
    // 16 + 15 + 12 + 6 + 10 + 8 + 6.4 + 4.2 + 4
    expect(view.score).toBe(81.6);
    expect(view.band).toBe("Approve");
    expect(view.recommendation).toBe("approved");
    expect(view.gaps).toEqual([]);
  });

  it("moves a draft to under review on the first score", async () => {
    const view = await service.scoreCriterion({ orgId: ORG, companyId: COMPANY, key: "experience", payload: { score: 3 } });
    expect(view.status).toBe("under_review");
  });

  it("rejects a score outside the scale and an unknown criterion", async () => {
    await expect(
      service.scoreCriterion({ orgId: ORG, companyId: COMPANY, key: "experience", payload: { score: 9 } }),
    ).rejects.toMatchObject({ code: "PREQUAL_SCORE_INVALID" });
    await expect(
      service.scoreCriterion({ orgId: ORG, companyId: COMPANY, key: "vibes", payload: { score: 5 } }),
    ).rejects.toMatchObject({ code: "PREQUAL_CRITERION_UNKNOWN" });
  });

  it("takes an expiry only on the criteria that carry one", async () => {
    await expect(
      service.scoreCriterion({ orgId: ORG, companyId: COMPANY, key: "experience", payload: { expiresAt: future(90) } }),
    ).rejects.toMatchObject({ code: "PREQUAL_EXPIRY_NOT_TRACKED" });

    const view = await service.scoreCriterion({
      orgId: ORG,
      companyId: COMPANY,
      key: "insurance",
      payload: { expiresAt: future(90), reference: "GL-88213" },
    });
    expect(view.criteria.find((row) => row.key === "insurance")).toMatchObject({
      reference: "GL-88213",
      expired: false,
    });
  });
});

describe("the decision", () => {
  it("refuses while any required criterion is unscored, and names them", async () => {
    await expect(
      service.decide({ orgId: ORG, companyId: COMPANY, payload: { status: "approved", validUntil: future(365) } }),
    ).rejects.toMatchObject({
      code: "PREQUAL_INCOMPLETE",
      details: { gaps: expect.arrayContaining(["Safety history has not been scored"]) },
    });
  });

  it("refuses an approval with no validity date", async () => {
    await scoreAll();
    await expect(service.decide({ orgId: ORG, companyId: COMPANY, payload: { status: "approved" } })).rejects.toMatchObject({
      code: "PREQUAL_INCOMPLETE",
      details: { gaps: ["A qualification with no expiry date is not a qualification — set one"] },
    });
  });

  it("refuses a conditional approval with no conditions, and a rejection with no reason", async () => {
    await scoreAll();
    await expect(
      service.decide({ orgId: ORG, companyId: COMPANY, payload: { status: "conditionally_approved", validUntil: future(365) } }),
    ).rejects.toMatchObject({ code: "PREQUAL_INCOMPLETE", details: { gaps: ["Say what the conditions are"] } });

    await expect(service.decide({ orgId: ORG, companyId: COMPANY, payload: { status: "rejected" } })).rejects.toMatchObject({
      code: "PREQUAL_INCOMPLETE",
      details: { gaps: ["Say why the vendor was rejected"] },
    });
  });

  it("refuses to grant a qualification on cover that has already lapsed", async () => {
    await scoreAll();
    await service.scoreCriterion({ orgId: ORG, companyId: COMPANY, key: "licenses", payload: { expiresAt: past(30) } });

    // Without this the assessment would read "approved" and be expired the
    // moment it was granted, with nobody told why.
    await expect(
      service.decide({ orgId: ORG, companyId: COMPANY, payload: { status: "approved", validUntil: future(365) } }),
    ).rejects.toMatchObject({
      code: "PREQUAL_INCOMPLETE",
      details: { gaps: expect.arrayContaining([expect.stringContaining("Licences and registrations expired on")]) },
    });
  });

  it("refuses a validity date that has already passed", async () => {
    await scoreAll();
    await expect(
      service.decide({ orgId: ORG, companyId: COMPANY, payload: { status: "approved", validUntil: past(1) } }),
    ).rejects.toMatchObject({ code: "PREQUAL_VALIDITY_PAST" });
  });

  it("records the decision with what the score recommended, so a decision against it stays visible", async () => {
    await scoreAll(5);
    const view = await service.decide({
      orgId: ORG,
      companyId: COMPANY,
      payload: {
        status: "conditionally_approved",
        validUntil: future(365),
        conditions: "Supervision to be named before mobilisation.",
        singleAwardLimit: 750000,
      },
      userId: "pm-1",
    });

    expect(view.score).toBe(100);
    expect(view.storedRecommendation).toBe("approved");
    expect(view.decisionAgainstScore).toBe(true);
    expect(view.qualified).toBe(true);
    expect(view.singleAwardLimit).toBe(750000);
    expect(store.audits.at(-1)).toMatchObject({
      entityType: "vendor_prequalification",
      action: "decided",
      metadataJson: expect.objectContaining({ againstScore: true }),
    });
  });

  it("rejects a single-award limit that is not a positive amount", async () => {
    await scoreAll();
    await expect(
      service.decide({
        orgId: ORG,
        companyId: COMPANY,
        payload: { status: "approved", validUntil: future(365), singleAwardLimit: 0 },
      }),
    ).rejects.toMatchObject({ code: "PREQUAL_LIMIT_INVALID" });
  });

  it("locks scoring once decided, and reopening keeps the scores", async () => {
    await scoreAll();
    await service.decide({ orgId: ORG, companyId: COMPANY, payload: { status: "approved", validUntil: future(365) } });

    await expect(
      service.scoreCriterion({ orgId: ORG, companyId: COMPANY, key: "experience", payload: { score: 1 } }),
    ).rejects.toMatchObject({ code: "PREQUAL_DECIDED" });

    await expect(service.reopen({ orgId: ORG, companyId: COMPANY, reason: "" })).rejects.toMatchObject({
      code: "PREQUAL_REOPEN_REASON_REQUIRED",
    });

    const reopened = await service.reopen({ orgId: ORG, companyId: COMPANY, reason: "Annual renewal" });
    expect(reopened.status).toBe("under_review");
    // Re-assessing from a blank sheet every year throws away the only history
    // worth having.
    expect(reopened.criteria.every((row) => row.score === 4)).toBe(true);
    expect(reopened.score).toBe(80);
  });
});

describe("expiry, which is read rather than stored", () => {
  it("takes the earlier of the validity date and a criterion that lapses first", async () => {
    await scoreAll();
    await service.scoreCriterion({ orgId: ORG, companyId: COMPANY, key: "licenses", payload: { expiresAt: future(30) } });
    const view = await service.decide({
      orgId: ORG,
      companyId: COMPANY,
      payload: { status: "approved", validUntil: future(365) },
    });

    expect(view.expiresBecause).toBe("Licences and registrations");
    expect(new Date(view.expiresAt).getTime()).toBeLessThan(new Date(view.validUntil).getTime());
    expect(view.qualified).toBe(true);
  });

  it("reads an approval whose cover has since lapsed as expired, without changing the stored status", async () => {
    await scoreAll();
    await service.decide({ orgId: ORG, companyId: COMPANY, payload: { status: "approved", validUntil: future(365) } });

    // The licence lapses after the fact — the record is not touched.
    const licence = store.criteria.find((row) => row.key === "licenses");
    licence.expiresAt = new Date(past(1));

    const view = await service.getPrequalification({ orgId: ORG, companyId: COMPANY });
    expect(view.status).toBe("approved");
    expect(view.effectiveStatus).toBe("expired");
    expect(view.qualified).toBe(false);
    expect(view.expiresBecause).toBe("Licences and registrations");
  });
});

describe("the gates", () => {
  const qualify = async (companyId, extra = {}) => {
    await scoreAll(4, companyId);
    return service.decide({
      orgId: ORG,
      companyId,
      payload: { status: "approved", validUntil: future(365), ...extra },
    });
  };

  it("refuses to invite an unassessed vendor and names it", async () => {
    await expect(
      service.assertInvitable({ orgId: ORG, companies: [{ companyId: COMPANY, name: "Meridian Concrete" }] }),
    ).rejects.toMatchObject({
      code: "PREQUAL_NOT_QUALIFIED",
      message: "Meridian Concrete has not been prequalified",
      details: { vendors: [expect.objectContaining({ status: "not_assessed" })] },
    });
  });

  it("lets a qualified vendor through, and an unqualified one through with a reason", async () => {
    await qualify(COMPANY);
    await expect(
      service.assertInvitable({ orgId: ORG, companies: [{ companyId: COMPANY, name: "Meridian Concrete" }] }),
    ).resolves.toEqual([]);

    const overridden = await service.assertInvitable({
      orgId: ORG,
      companies: [{ companyId: "co-2", name: "Delta Piling" }],
      override: "Emergency works; assessment starts Monday.",
    });
    // The override returns who was waved through, so the caller can audit it.
    expect(overridden).toHaveLength(1);
    expect(overridden[0].name).toBe("Delta Piling");
  });

  it("ignores invitations that name no company, because there is nothing to read", async () => {
    await expect(
      service.assertInvitable({ orgId: ORG, companies: [{ companyId: null, name: "Someone new" }] }),
    ).resolves.toEqual([]);
  });

  it("holds an award over the single-award limit a conditional approval set", async () => {
    await scoreAll(4, COMPANY);
    await service.decide({
      orgId: ORG,
      companyId: COMPANY,
      payload: {
        status: "conditionally_approved",
        validUntil: future(365),
        conditions: "Up to half a million.",
        singleAwardLimit: 500000,
      },
    });

    await expect(
      service.assertAwardable({ orgId: ORG, companyId: COMPANY, companyName: "Meridian Concrete", amount: 640000 }),
    ).rejects.toMatchObject({
      code: "PREQUAL_AWARD_BLOCKED",
      message: expect.stringContaining("conditionally approved up to 500000"),
      details: { amount: 640000, singleAwardLimit: 500000 },
    });

    await expect(
      service.assertAwardable({ orgId: ORG, companyId: COMPANY, companyName: "Meridian Concrete", amount: 480000 }),
    ).resolves.toMatchObject({ qualified: true });
  });

  it("holds an award to a vendor whose qualification has lapsed, saying which cover lapsed", async () => {
    await scoreAll(4, COMPANY);
    await service.decide({ orgId: ORG, companyId: COMPANY, payload: { status: "approved", validUntil: future(365) } });
    store.criteria.find((row) => row.key === "insurance").expiresAt = new Date(past(10));

    await expect(
      service.assertAwardable({ orgId: ORG, companyId: COMPANY, companyName: "Meridian Concrete", amount: 100 }),
    ).rejects.toMatchObject({
      code: "PREQUAL_AWARD_BLOCKED",
      message: expect.stringContaining("insurance and bonds expired on"),
    });
  });
});

describe("the overview", () => {
  it("counts each state and calls out what expires inside the horizon", async () => {
    await scoreAll(4, COMPANY);
    await service.scoreCriterion({ orgId: ORG, companyId: COMPANY, key: "insurance", payload: { expiresAt: future(20) } });
    await service.decide({ orgId: ORG, companyId: COMPANY, payload: { status: "approved", validUntil: future(365) } });

    const overview = await service.listStates({ orgId: ORG, withinDays: 60 });
    expect(overview.summary).toMatchObject({ vendors: 2, qualified: 1, notAssessed: 1, expiringSoon: 1 });

    const row = overview.items.find((item) => item.companyId === COMPANY);
    expect(row).toMatchObject({ status: "approved", expiringSoon: true, expiresBecause: "Insurance and bonds" });
    // A vendor nobody has looked at is listed, not omitted — the absence is
    // the finding.
    expect(overview.items.find((item) => item.companyId === "co-2")).toMatchObject({ status: "not_assessed" });
  });
});
