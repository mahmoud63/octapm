/**
 * PC-7b — the API reads each exception kind's module and BOQ derivation from
 * the engine's rule registry (exception-rules/index.js) as that registry
 * actually exports it, and its own table (utils/boq-figures
 * EXCEPTION_KIND_POLICY) agrees with every rule's statement — so a kind the
 * rules call BOQ-derived is withheld whole from a member without boq:read.
 */
const path = require("path");
const exceptionService = require("../exception.service");
const { EXCEPTION_KIND_POLICY, exceptionPolicy, exceptionReadable } = require("../../utils/boq-figures");

const RULES_INDEX = path.join(__dirname, "..", "exception-rules", "index.js");

// A member without boq:read who reads schedule and progress (a site engineer
// on a no-BOQ template), and one who also reads cost.
const SITE_NO_BOQ = Object.freeze({ boq: false, modules: { boq: false, cost: false, schedule: true, progress: true } });
const COST_NO_BOQ = Object.freeze({ boq: false, modules: { boq: false, cost: true, schedule: true, progress: true } });

// The shape exception-rules/index.js exports: constants and functions, no array.
const engineShaped = (rules) => ({
  MODULES: ["boq", "cost", "schedule", "progress"],
  SEVERITIES: ["info", "warning", "critical"],
  THRESHOLDS: { QUANTITY_TOLERANCE: 0.001 },
  assertRule: () => {},
  loadRules: () => rules,
  ruleFiles: () => ["data-quality.js"],
  ruleFor: (kind) => rules.find((rule) => rule.kind === kind) || null,
  getRules: () => rules,
  kindMeta: () => Object.fromEntries(rules.map((rule) => [rule.kind, { kind: rule.kind, severity: rule.severity, subjectType: rule.subjectType, module: rule.module, boqDerived: rule.boqDerived }])),
});

const RULES = [
  { kind: "structure_missing", severity: "info", subjectType: "project", module: "boq", boqDerived: true, evaluate: async () => [] },
  { kind: "readiness_override_active", severity: "warning", subjectType: "reporting_period", module: "cost", boqDerived: true, evaluate: async () => [] },
  { kind: "progress_stale", severity: "warning", subjectType: "activity", module: "progress", boqDerived: false, evaluate: async () => [] },
];

describe("the engine's rule registry as the API reads it", () => {
  afterEach(() => exceptionService._resetRegistry());

  it("reads kindMeta() from the engine's export shape (functions, not an array)", () => {
    expect(exceptionService._registryFrom(engineShaped(RULES))).toEqual({
      structure_missing: { module: "boq", boqDerived: true },
      readiness_override_active: { module: "cost", boqDerived: true },
      progress_stale: { module: "progress", boqDerived: false },
    });
  });

  it("falls back to getRules(), and still reads a bare array or .rules", () => {
    const { kindMeta, ...withoutMeta } = engineShaped(RULES);
    expect(Object.keys(exceptionService._registryFrom(withoutMeta)).sort()).toEqual(["progress_stale", "readiness_override_active", "structure_missing"]);
    expect(exceptionService._registryFrom(RULES)).toMatchObject({ structure_missing: { module: "boq", boqDerived: true } });
    expect(exceptionService._registryFrom({ rules: RULES })).toMatchObject({ readiness_override_active: { module: "cost", boqDerived: true } });
    expect(exceptionService._registryFrom({ MODULES: ["boq"], THRESHOLDS: {} })).toBeNull();
  });

  it("with the engine's statement, a BOQ-derived data-quality kind is withheld from a member without boq:read", () => {
    const registry = exceptionService._registryFrom(engineShaped(RULES));
    for (const kind of ["structure_missing", "readiness_override_active"]) {
      expect([kind, exceptionReadable({ kind, subjectType: "project" }, SITE_NO_BOQ, registry)]).toEqual([kind, false]);
      expect([kind, exceptionReadable({ kind, subjectType: "project" }, COST_NO_BOQ, registry)]).toEqual([kind, false]);
    }
    expect(exceptionReadable({ kind: "progress_stale", subjectType: "activity" }, SITE_NO_BOQ, registry)).toBe(true);
  });
});

describe("the API's own kind table agrees with the rules' statements", () => {
  it("states the dq kinds as their rules do: structure_missing boq/BOQ-derived, readiness_override_active cost/BOQ-derived, change_order_possible_duplicate cost", () => {
    expect(EXCEPTION_KIND_POLICY.structure_missing).toEqual({ module: "boq", boqDerived: true });
    expect(EXCEPTION_KIND_POLICY.readiness_override_active).toEqual({ module: "cost", boqDerived: true });
    expect(EXCEPTION_KIND_POLICY.change_order_possible_duplicate).toEqual({ module: "cost", boqDerived: false });
    // Without any registry (this track's base) the table alone withholds them.
    for (const kind of ["structure_missing", "readiness_override_active"]) {
      expect([kind, exceptionReadable({ kind, subjectType: "project" }, SITE_NO_BOQ, null)]).toEqual([kind, false]);
    }
    expect(exceptionReadable({ kind: "change_order_possible_duplicate", subjectType: "change_order" }, COST_NO_BOQ, null)).toBe(true);
    expect(exceptionReadable({ kind: "change_order_possible_duplicate", subjectType: "change_order" }, SITE_NO_BOQ, null)).toBe(false);
  });

  it("the real exception-rules folder loads, the registry is non-null, and the table states every rule's kind with its module and at least its BOQ derivation", () => {
    exceptionService._resetRegistry();
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const meta = require(RULES_INDEX).kindMeta();
    const registry = exceptionService._ruleRegistry();
    expect(registry).not.toBeNull();
    expect(Object.keys(registry).sort()).toEqual(Object.keys(meta).sort());
    for (const [kind, rule] of Object.entries(meta)) {
      const own = EXCEPTION_KIND_POLICY[kind];
      expect([kind, Boolean(own)]).toEqual([kind, true]);
      expect([kind, own.module]).toEqual([kind, rule.module]);
      // The table may widen (call a kind BOQ-derived), never narrow.
      if (rule.boqDerived) expect([kind, own.boqDerived]).toEqual([kind, true]);
      expect([kind, exceptionPolicy(kind, registry)]).toEqual([kind, { module: rule.module, boqDerived: rule.boqDerived || own.boqDerived }]);
    }
  });
});
