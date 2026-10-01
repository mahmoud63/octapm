/**
 * The exception rule registry (PC-7b; OCTAPM_CHANGE_INTELLIGENCE.md §6).
 *
 * Every `*.js` file in this folder except this one and the `_`-prefixed
 * helpers is a rule file: it exports an array of rules
 *
 *   { kind, severity: 'info'|'warning'|'critical', subjectType,
 *     module: 'boq'|'cost'|'schedule'|'progress', boqDerived: boolean,
 *     requires?: () => null | reason,          // a source that may be absent
 *     evaluate: async ({ orgId, projectId, cutoff, ctx }) => [row] }
 *
 * and each row is
 *
 *   { subjectType, subjectId, secondarySubjectType?, secondarySubjectId?,
 *     measured: { value, unitCode?, basis }, limit: { value, unitCode?, basis },
 *     groupKeys?: { wbsNodeId?, locationId?, costCodeId? }, severity?, data? }
 *
 * (`severity` on a row overrides the rule's default for that row).
 * `data.dismissalKey` (optional, a string) names the episode a row belongs to,
 * for a rule whose measured figure grows by itself (elapsed days): a
 * dismissal then holds while the key is the same and a new key reopens it,
 * whatever the figure (exception-engine reopensDismissal). Rules are
 * pure reads; the engine (exception-engine.service) is the only writer, and
 * it writes ProjectException rows only. A file added here — the dq track's
 * data-quality.js — is picked up without touching this one.
 */
const fs = require("fs");
const path = require("path");
const thresholds = require("./_thresholds");

const SEVERITIES = Object.freeze(["info", "warning", "critical"]);
const MODULES = Object.freeze(["boq", "cost", "schedule", "progress"]);

const ruleFiles = (dir = __dirname) =>
  fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".js") && file !== "index.js" && !file.startsWith("_") && !file.endsWith(".test.js"))
    .sort();

const assertRule = (rule, file) => {
  const where = `exception rule ${rule?.kind || "?"} (${file})`;
  if (!rule || typeof rule.kind !== "string" || !/^[a-z][a-z0-9_]*$/.test(rule.kind)) throw new Error(`${where}: kind must be a snake_case string`);
  if (!SEVERITIES.includes(rule.severity)) throw new Error(`${where}: severity must be one of ${SEVERITIES.join(", ")}`);
  if (!MODULES.includes(rule.module)) throw new Error(`${where}: module must be one of ${MODULES.join(", ")}`);
  if (typeof rule.boqDerived !== "boolean") throw new Error(`${where}: boqDerived must be a boolean`);
  if (typeof rule.subjectType !== "string" || !rule.subjectType) throw new Error(`${where}: subjectType is required`);
  if (typeof rule.evaluate !== "function") throw new Error(`${where}: evaluate must be a function`);
  if (rule.requires !== undefined && typeof rule.requires !== "function") throw new Error(`${where}: requires must be a function`);
};

/** Loads every rule file of `dir`; a kind defined twice is refused. */
const loadRules = (dir = __dirname) => {
  const rules = [];
  const seen = new Map();
  for (const file of ruleFiles(dir)) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const exported = require(path.join(dir, file));
    if (!Array.isArray(exported)) throw new Error(`exception rule file ${file} must export an array of rules`);
    for (const rule of exported) {
      assertRule(rule, file);
      if (seen.has(rule.kind)) throw new Error(`exception rule ${rule.kind} is defined in ${seen.get(rule.kind)} and ${file}`);
      seen.set(rule.kind, file);
      rules.push(Object.freeze({ ...rule, file }));
    }
  }
  return Object.freeze(rules);
};

let cached = null;
const getRules = () => {
  if (!cached) cached = loadRules();
  return cached;
};

/** kind → { kind, severity, subjectType, module, boqDerived } for the readers (the api track's withholding). */
const kindMeta = () =>
  Object.freeze(
    Object.fromEntries(
      getRules().map((rule) => [rule.kind, Object.freeze({ kind: rule.kind, severity: rule.severity, subjectType: rule.subjectType, module: rule.module, boqDerived: rule.boqDerived })]),
    ),
  );

const ruleFor = (kind) => getRules().find((rule) => rule.kind === kind) || null;

module.exports = {
  MODULES,
  SEVERITIES,
  THRESHOLDS: thresholds.THRESHOLDS,
  assertRule,
  getRules,
  kindMeta,
  loadRules,
  ruleFiles,
  ruleFor,
};
