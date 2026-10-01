/**
 * PC-7b — the exception engine against a real API process and the real local
 * Postgres (OCTAPM_CHANGE_INTELLIGENCE.md §1, §6).
 *
 * One LiveTest project is built — through the product's own API wherever it
 * has one — so that every implemented kind fires:
 *
 *   quantity_over_allocation   70 m3 installed (approved entries) on a 60 m3 allocation
 *   quantity_over_boq          70 + 40 = 110 m3 installed on a 100 m3 BOQ row
 *   certified_over_installed   20 t certified on rebar with 10 t installed
 *   certified_over_earned      a certified IPC whose stored over-certification is 500
 *   committed_over_budget      an executed 1,500 commitment on a 1,000 budget line
 *   actual_over_committed      1,600 on the ledger against that 1,500 commitment
 *   forecast_over_revised      official EAC above revised BAC (CPI < 0.9); the line's
 *                              DEFAULT forecast (1,600 = max(revised, actual, committed))
 *                              is not compared — it restates committed/actual (PC-7b int H) —
 *                              until a forecast is entered on the line (last case)
 *   schedule_slip_on_mapped_item  on items with certification pending, three ways:
 *                              D's CPM early finish 10 working days behind its baseline
 *                              (a replanned, not yet due activity); S finished — approved
 *                              100 % through the API — with an actual finish months after
 *                              its baseline while its early finish never moved; T, at 0 %,
 *                              past its planned finish (the data date is its finish)
 *
 * allocation_over_capacity cannot be built: the database's capacity triggers
 * refuse approved allocations above their item, so the run asserts none.
 *
 * Then: a dry run writes nothing; the evaluation writes ProjectException rows
 * only (every other table's rows of the organisation — a row matching ANY of
 * projectId, orgId, activityId or boqItemId the table carries, so an
 * organisation-level notification, job, outbound event or audit row counts —
 * and the Organisation row itself, byte-identical around it) and moves no figure (EV
 * report, budget register and ledger sums identical: delta 0.00); a second
 * run makes no duplicate and moves lastSeenAt only; a change order approved
 * through the API with an allocation link clears the two quantity rows
 * ('cleared'); a person's dismissal is not reopened while the slip stands
 * still and reopens as a new row when it worsens; a second organisation's
 * footprint is byte-identical throughout and its project cannot be evaluated
 * under the first organisation.
 *
 * Everything lives in throwaway "LiveTest <uuid>" organisations dropped
 * afterwards. The engine is never run against a durable organisation.
 *
 *   npm run test:live -- src/services/__live__/pc-7b-exception-engine.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const engine = require("../exception-engine.service");
const evService = require("../earned-value.service");
const budgetService = require("../budget.service");
const costLedger = require("../cost-ledger.service");
const { dateToWorkingDay } = require("../cpm.service");

const SKIP_TABLES = new Set(["ProjectException", "_prisma_migrations"]);
const SCOPE_COLUMNS = ["projectId", "orgId", "activityId", "boqItemId"];

liveDescribe("PC-7b: the exception engine evaluates, refreshes, clears and respects a dismissal — writing ProjectException rows only", () => {
  let live;
  let other;
  let api;
  let project;
  let otherProject;
  const items = {};
  const acts = {};
  const allocations = {};
  const ids = {};
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;
  const ok = (label, answer, status = 200) => expect([label, answer.status, answer.body?.error]).toEqual([label, status, undefined]);
  const today = () => new Date().toISOString().slice(0, 10);
  // Today (the project is in UTC) in the CPM's working-day index, from the project's 2026-01-05 start.
  const dataDateIndex = () => dateToWorkingDay(new Date("2026-01-05T00:00:00Z"), new Date(`${today()}T00:00:00Z`), { projectCalendar: null });

  // ─── the footprint of an organisation: every table, scoped ───────────────
  let tableColumns;
  const loadTableColumns = async () => {
    const rows = await prisma.$queryRaw`
      SELECT c.table_name AS "table", c.column_name AS "column"
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'`;
    const map = new Map();
    for (const row of rows) map.set(row.table, new Set([...(map.get(row.table) || []), row.column]));
    return map;
  };
  const footprint = async (orgId, { includeExceptions = false } = {}) => {
    const projectIds = (await prisma.project.findMany({ where: { orgId }, select: { id: true } })).map((row) => row.id);
    const activityIds = (await prisma.activity.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } })).map((row) => row.id);
    const itemIds = (await prisma.boqItem.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } })).map((row) => row.id);
    const values = { projectId: projectIds, orgId: [orgId], activityId: activityIds, boqItemId: itemIds };
    const result = {};
    const unscoped = [];
    for (const table of [...tableColumns.keys()].sort()) {
      if (SKIP_TABLES.has(table) && !(includeExceptions && table === "ProjectException")) continue;
      const columns = tableColumns.get(table);
      // A row belongs to the organisation when ANY scope column the table has
      // names it: an organisation-level Notification, BackgroundJob,
      // OutboundEvent or AuditEvent (orgId set, projectId NULL) is seen as
      // well as a project's. The organisation's own row is matched by its id.
      const scope = table === "Organisation" ? [["id", [orgId]]] : SCOPE_COLUMNS.filter((name) => columns.has(name)).map((name) => [name, values[name]]);
      if (!scope.length) {
        unscoped.push(table);
        continue;
      }
      const where = scope.map(([name], index) => `t."${name}"::text = ANY($${index + 1}::text[])`).join(" OR ");
      const [row] = await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS n, md5(coalesce(string_agg(md5(t::text), ',' ORDER BY md5(t::text)), '')) AS h FROM "${table}" t WHERE ${where}`,
        ...scope.map(([, list]) => list),
      );
      result[table] = `${row.n}:${row.h}`;
    }
    return { tables: result, unscoped };
  };
  const scopedRows = (fp) => Object.values(fp.tables).reduce((sum, value) => sum + Number(value.split(":")[0]), 0);

  // ─── the money figures that must not move ────────────────────────────────
  const money = async () => {
    const ev = await evService.buildOfficialEvReport({ orgId: live.org.id, projectId: project.id, useLockedSnapshot: true, includeReadiness: false });
    const register = await budgetService.listBudgetLines({ orgId: live.org.id, projectId: project.id });
    const cents = (value) => Math.round(Number(value || 0) * 100);
    const ledger = (await prisma.costLedgerEntry.findMany({ where: { projectId: project.id }, select: { amount: true } })).reduce((sum, row) => sum + cents(row.amount), 0);
    const lineActual = (await prisma.budgetLine.findMany({ where: { projectId: project.id }, select: { actual: true } })).reduce((sum, row) => sum + cents(row.actual), 0);
    const recordActual = (await prisma.costRecord.findMany({ where: { projectId: project.id }, select: { actual: true } })).reduce((sum, row) => sum + cents(row.actual), 0);
    return {
      ev: { totalBudget: ev.totalBudget, pv: ev.pv, ev: ev.ev, ac: ev.ac, eac: ev.eac, cpi: ev.cpi, spi: ev.spi },
      register: register.summary.totals,
      ledger,
      lineActual,
      recordActual,
    };
  };

  const rowsOf = (where = {}) => prisma.projectException.findMany({ where: { projectId: project.id, ...where }, orderBy: [{ kind: "asc" }, { subjectId: "asc" }, { createdAt: "asc" }] });
  // The §1 overrun rules (quantity.js, money.js, schedule.js). Since the merge the registry also
  // loads the §7 data-quality rules (data-quality.js), proven in pc-7b-data-quality.live.test.js;
  // this suite counts the overrun kinds, so it evaluates those rules only.
  const OVERRUN_RULES = require("../exception-rules").getRules().filter((rule) => rule.file !== "data-quality.js");
  const evaluate = (extra = {}) => engine.evaluateProject({ orgId: live.org.id, projectId: project.id, trigger: "test", logger: { log: () => {} }, rules: OVERRUN_RULES, ...extra });

  beforeAll(async () => {
    tableColumns = await loadTableColumns();
    live = await createLiveOrg(prisma);
    other = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4", EXCEPTIONS_ENGINE_ENABLED: "false" }, { appOnly: true });
    const tag = Date.now().toString(36);
    project = await prisma.project.create({
      data: { orgId: live.org.id, currency: "USD", name: "LiveTest PC-7b exception engine", timezone: "UTC", startDate: new Date("2026-01-05"), endDate: new Date("2027-06-30") },
    });

    // The second organisation: a project with a BOQ row, an activity and a budget line of its own.
    otherProject = await prisma.project.create({ data: { orgId: other.org.id, currency: "USD", name: "LiveTest PC-7b other", startDate: new Date("2026-01-05") } });
    await prisma.boqItem.create({ data: { projectId: otherProject.id, code: "X.1", description: "LTSECRET other", unit: "m3", qty: 5, rate: 10, amount: 50 } });
    await prisma.activity.create({ data: { projectId: otherProject.id, name: "Other pour", activityCode: "OX1", earlyFinish: 40, baselineFinish: 10 } });

    // BOQ rows, through the API.
    for (const [key, data] of Object.entries({
      R1: { code: "7B.1", description: "LTSECRET concrete slab", quantity: 100, unit: "m3", rate: 100 },
      R2: { code: "7B.2", description: "LTSECRET reinforcement", quantity: 50, unit: "t", rate: 1000 },
      R3: { code: "7B.3", description: "LTSECRET blockwork", quantity: 10, unit: "m2", rate: 500 },
      R4: { code: "7B.4", description: "LTSECRET render", quantity: 10, unit: "m2", rate: 100 },
    })) {
      const created = await api.post(at("/boq/items"), data, auth());
      ok(`boq ${key}`, created, 201);
      items[key] = created.body.data.item;
    }
    // Activities A, B, C measured by quantity; D, S and T by percent.
    for (const key of ["A", "B", "C", "D", "S", "T"]) {
      const created = await api.post(at("/activities"), { engineerIds: [live.user.id], name: `LiveTest ${key}-7B`, activityCode: `E7${key}`, duration: 5, startDate: "2026-02-02", endDate: "2026-02-06" }, auth());
      ok(`activity ${key}`, created, 201);
      acts[key] = created.body.data.id;
    }
    for (const [key, item, activity, quantity] of [["A", "R1", "A", 60], ["B", "R1", "B", 40], ["C", "R2", "C", 30], ["D", "R3", "D", 10], ["S", "R4", "S", 5], ["T", "R4", "T", 5]]) {
      const created = await api.post(at("/activity-boq-allocations"), { boqItemId: items[item].id, activityId: acts[activity], quantity }, auth());
      ok(`allocation ${key}`, created, 201);
      allocations[key] = created.body.data.id;
      for (const step of ["submit", "approve"]) ok(`allocation ${key} ${step}`, await api.post(at(`/activity-boq-allocations/${allocations[key]}/${step}`), {}, auth()));
    }
    for (const key of ["A", "B", "C"]) ok(`method ${key}`, await api.request("PUT", at(`/activities/${acts[key]}/progress-method`), { body: { method: "quantity" }, headers: auth() }));

    // Installed quantity: entries recorded, bundled and approved through the API.
    const install = async (activity, item, quantity, n) => {
      const entry = await api.post(at("/quantity-progress"), { status: "submitted", activityId: acts[activity], boqItemId: items[item].id, quantity, date: "2026-09-20", clientRequestId: `pc7b-${tag}-${n}` }, auth());
      ok(`entry ${n}`, entry, 201);
      const submission = await api.post(at(`/activities/${acts[activity]}/progress`), { method: "quantity", entryIds: [entry.body.data.entry.id] }, auth());
      ok(`submission ${n}`, submission);
      ok(`approve ${n}`, await api.post(at(`/activities/${acts[activity]}/progress-submissions/${submission.body.data.submission.id}/approve`), {}, auth()));
    };
    await install("A", "R1", 70, 1);
    await install("B", "R1", 40, 2);
    await install("C", "R2", 10, 3);

    // A certified IPC (stored as ipc.service stores a certification): 20 t of
    // rebar on C's allocation, and a stored over-certification of 500.
    const now = new Date();
    const certificate = await prisma.ipcCertificate.create({
      data: { projectId: project.id, period: `IPC-7B-${tag}`, status: "certified", totalCert: 20000, netPayable: 19000, balanceDue: 19000, certifiedAt: now, earnedValueAtCertification: 10000, approvedLimitAtCertification: 30000, overCertificationAmount: 500, certificationOverrideReason: "LiveTest override", certificationOverrideBy: live.user.id, certificationOverrideAt: now },
    });
    ids.certificate = certificate.id;
    await prisma.ipcItem.create({
      data: { projectId: project.id, boqItemId: items.R2.id, allocationId: allocations.C, ipcCertificateId: certificate.id, ipcPeriod: certificate.period, qty: 20, rate: 1000, currentCert: 20000, cumulativeCert: 20000, status: "certified", certDate: now },
    });

    // The budget register and a commitment above it, through the API.
    const code = await api.post("/api/v1/company/cost-codes", { code: `LT7B-${tag}`, name: "LiveTest formwork", category: "subcontract" }, auth());
    ok("cost code", code, 201);
    ok("project cost codes", await api.request("PUT", at("/budget/cost-codes"), { body: { costCodeIds: [code.body.data.id] }, headers: auth() }));
    const line = await api.post(at("/budget/lines"), { costCodeId: code.body.data.id, costType: "subcontract", originalBudget: 1000, description: "LiveTest formwork" }, auth());
    ok("budget line", line, 201);
    ids.line = line.body.data.id;
    const vendor = await prisma.company.create({ data: { orgId: live.org.id, name: "LiveTest Formwork Ltd" } });
    const commitment = await api.post(at("/commitments"), { title: "LiveTest subcontract", type: "subcontract", vendorCompanyId: vendor.id, lines: [{ description: "Formwork", budgetLineId: ids.line, activityId: acts.A, qty: 1, rate: 1500, amount: 1500 }] }, auth());
    ok("commitment", commitment, 201);
    ids.commitment = commitment.body.data.id;
    for (const step of ["submit", "approve"]) ok(`commitment ${step}`, await api.post(at(`/commitments/${ids.commitment}/${step}`), {}, auth()));
    const document = await prisma.projectDocument.create({
      data: { orgId: live.org.id, projectId: project.id, documentType: "workflow_attachment", originalName: "agreement.pdf", fileName: "agreement.pdf", mimeType: "application/pdf", sizeBytes: 1, sha256: "0".repeat(64), storageProvider: "local", objectKey: `livetest/${ids.commitment}`, storageKey: `livetest/${ids.commitment}/${tag}` },
    });
    ok("commitment execute", await api.post(at(`/commitments/${ids.commitment}/execute`), { documentId: document.id }, auth()));

    // Ledger postings through the one ledger writer: 1,600 against the
    // commitment, and 30,000 more on B (actual cost well above earned value).
    await prisma.$transaction(async (tx) => {
      await costLedger.post({ tx, orgId: live.org.id, projectId: project.id, sourceType: "manual", sourceId: `pc7b-${tag}-commitment`, amount: 1600, commitmentId: ids.commitment, budgetLineId: ids.line, activityId: acts.A, incurredOn: today(), postedBy: live.user.id, note: "LiveTest" });
      await costLedger.post({ tx, orgId: live.org.id, projectId: project.id, sourceType: "manual", sourceId: `pc7b-${tag}-burn`, amount: 30000, activityId: acts.B, incurredOn: today(), postedBy: live.user.id, note: "LiveTest" });
    });

    // S finished: 100 % with an actual finish on 2026-07-01, submitted and approved through the API.
    const finished = await api.post(at(`/activities/${acts.S}/progress`), { method: "percent", pctComplete: 100, actualStart: "2026-02-02", actualFinish: "2026-07-01", notes: "LiveTest finished late" }, auth());
    ok("progress S", finished);
    ok("approve S", await api.post(at(`/activities/${acts.S}/progress-submissions/${finished.body.data.submission.id}/approve`), {}, auth()));

    // D's early finish 10 working days behind its baseline (as a baseline lock
    // then a CPM re-run leave it), in 2027 — not yet due, so its early finish
    // is its finish — off the critical path; R3 has nothing certified.
    await prisma.activity.update({ where: { id: acts.D }, data: { baselineFinish: 300, earlyFinish: 310, isCritical: false } });
    // S and T: the CPM's forward pass never moved them (early finish = baseline
    // = working day 20, 2026-02-02); S finished on 2026-07-01 (working day 127),
    // T has no progress and is past its planned finish. R4 has nothing certified.
    for (const key of ["S", "T"]) await prisma.activity.update({ where: { id: acts[key] }, data: { baselineFinish: 20, earlyFinish: 20, isCritical: false } });
  }, 300_000);

  afterAll(async () => {
    if (api) await api.stop();
    for (const org of [live, other]) {
      if (!org) continue;
      await prisma.projectException.deleteMany({ where: { orgId: org.org.id } }).catch(() => {});
      for (const model of ["projectDocument", "backgroundJob", "outboundEvent", "recordHistorySnapshot", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: org.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, org.org.id);
    }
    await prisma.$disconnect();
  });

  let otherBefore;
  let firstRows;

  it("a dry run plans every kind and writes nothing", async () => {
    otherBefore = await footprint(other.org.id, { includeExceptions: true });
    const before = await footprint(live.org.id, { includeExceptions: true });
    const planned = await evaluate({ dryRun: true });
    expect(planned.errors).toEqual([]);
    expect(planned).toMatchObject({ dryRun: true, opened: 10, refreshed: 0, resolved: 0, unchanged: 0 });
    expect(await footprint(live.org.id, { includeExceptions: true })).toEqual(before);
    expect(await prisma.projectException.count({ where: { orgId: live.org.id } })).toBe(0);
  });

  it("the evaluation opens one row per finding — each kind, severity, subject and both figures with their basis — and writes nothing else", async () => {
    const before = await footprint(live.org.id);
    const moneyBefore = await money();
    expect(scopedRows(before)).toBeGreaterThan(50);
    // The side-effect tables are fingerprinted over every scope column they carry (an
    // organisation-level row included), and the organisation's own row by its id.
    expect(Object.keys(before.tables)).toEqual(expect.arrayContaining(["Notification", "BackgroundJob", "OutboundEvent", "AuditEvent", "Organisation", "User"]));
    expect(before.unscoped).not.toContain("Organisation");

    const result = await evaluate();
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result).toMatchObject({ opened: 10, refreshed: 0, resolved: 0, unchanged: 0, suppressed: 0 });

    // Every other table of the organisation, byte-identical; no figure moved (delta 0.00).
    const after = await footprint(live.org.id);
    expect(after).toEqual(before);
    expect(await money()).toEqual(moneyBefore);
    expect(moneyBefore.ledger).toBe(3160000);
    expect([moneyBefore.lineActual, moneyBefore.recordActual]).toEqual([160000, 3160000]);

    const ev = moneyBefore.ev;
    expect(ev.cpi).toBeLessThan(0.9);
    firstRows = await rowsOf();
    const shape = firstRows.map((row) => [row.kind, row.subjectType, row.subjectId, row.severity, row.measured.toFixed(3), row.limit.toFixed(3), row.unitCode]);
    expect(shape).toEqual(
      [
        ["actual_over_committed", "commitment", ids.commitment, "warning", "1600.000", "1500.000", "USD"],
        ["certified_over_earned", "ipc_certificate", ids.certificate, "critical", "500.000", "0.000", "USD"],
        ["certified_over_installed", "boq_item", items.R2.id, "critical", "20.000", "10.000", items.R2.unitCode],
        ["committed_over_budget", "budget_line", ids.line, "critical", "1500.000", "1000.000", "USD"],
        ["forecast_over_revised", "project", project.id, "critical", Number(ev.eac).toFixed(3), Number(ev.totalBudget).toFixed(3), "USD"],
        ["quantity_over_allocation", "allocation", allocations.A, "critical", "70.000", "60.000", items.R1.unitCode],
        ["quantity_over_boq", "boq_item", items.R1.id, "warning", "110.000", "100.000", items.R1.unitCode],
        ["schedule_slip_on_mapped_item", "activity", acts.D, "warning", "10.000", "5.000", "working_day"],
        ["schedule_slip_on_mapped_item", "activity", acts.S, "critical", "107.000", "5.000", "working_day"],
        ["schedule_slip_on_mapped_item", "activity", acts.T, "critical", (dataDateIndex() - 20).toFixed(3), "5.000", "working_day"],
      ].sort((a, b) => (a[0] + a[2]).localeCompare(b[0] + b[2])),
    );
    expect(firstRows.some((row) => row.kind === "allocation_over_capacity")).toBe(false);
    const byKind = (kind, subjectType) => firstRows.find((row) => row.kind === kind && (!subjectType || row.subjectType === subjectType));
    expect(byKind("quantity_over_allocation").measuredBasis).toMatch(/installedByActivity/);
    expect(byKind("quantity_over_allocation").limitBasis).toMatch(/getApprovedVariationAllowances/);
    expect(byKind("quantity_over_boq").measuredBasis).toMatch(/installedByBoqItem/);
    expect(byKind("certified_over_installed").measuredBasis).toMatch(/certifiedIpcItemWhere/);
    expect(byKind("certified_over_earned").measuredBasis).toMatch(/overCertificationAmount/);
    expect(byKind("committed_over_budget").measuredBasis).toMatch(/budget register/);
    expect(byKind("actual_over_committed").measuredBasis).toMatch(/certifiedAgainstCommitment/);
    expect(byKind("forecast_over_revised", "project").measuredBasis).toMatch(/Official EAC/);
    // One gap, one row: the line's default forecast (1,600 = its actual) is not a second row beside committed_over_budget.
    expect(byKind("forecast_over_revised", "budget_line")).toBeUndefined();
    const slipOf = (key) => firstRows.find((row) => row.kind === "schedule_slip_on_mapped_item" && row.subjectId === acts[key]);
    for (const key of ["D", "S", "T"]) expect(slipOf(key).measuredBasis).toMatch(/change-order impacts are not read/);
    expect(slipOf("D").measuredBasis).toMatch(/Activity\.earlyFinish − Activity\.baselineFinish/);
    expect(slipOf("S").measuredBasis).toMatch(/actual finish \(latest approved ActivityProgress\.actualFinish/);
    expect(slipOf("T").measuredBasis).toMatch(/the data date/);
    expect([slipOf("D"), slipOf("S"), slipOf("T")].map((row) => [row.dataJson.finishBasis, row.dataJson.finishIndex, row.dataJson.finishDate])).toEqual([
      ["early_finish", 310, null],
      ["actual_finish", 127, "2026-07-01"],
      ["data_date", dataDateIndex(), today()],
    ]);
    expect(slipOf("S").dataJson).toMatchObject({ pctComplete: 100, actualFinish: "2026-07-01", earlyFinish: 20, baselineFinish: 20 });
    expect(slipOf("S").dataJson.boq.pendingItems.map((row) => row.boqItemId)).toEqual([items.R4.id]);
    for (const row of firstRows) {
      expect([row.orgId, row.resolvedAt, row.changeEventId, row.snoozedUntil]).toEqual([live.org.id, null, null, null]);
      expect(row.measuredBasis.length).toBeGreaterThan(10);
      expect(row.limitBasis.length).toBeGreaterThan(10);
    }
    expect(byKind("quantity_over_allocation").dataJson).toMatchObject({ activityId: acts.A, boqItemId: items.R1.id, allocationQuantity: 60, approvedVariationQuantity: 0, exceedance: 10 });
    expect(byKind("committed_over_budget").costCodeId).toBeTruthy();
    expect(slipOf("D").dataJson.boq.pendingItems.map((row) => row.boqItemId)).toEqual([items.R3.id]);
  });

  it("a second run makes no duplicate and moves lastSeenAt only", async () => {
    const before = await footprint(live.org.id);
    const result = await evaluate();
    expect(result).toMatchObject({ opened: 0, refreshed: 0, resolved: 0, unchanged: 10, suppressed: 0, errors: [] });
    const rows = await rowsOf();
    expect(rows.map((row) => row.id)).toEqual(firstRows.map((row) => row.id));
    const strip = ({ lastSeenAt, updatedAt, ...rest }) => rest;
    expect(rows.map(strip)).toEqual(firstRows.map(strip));
    for (const [index, row] of rows.entries()) expect(row.lastSeenAt.getTime()).toBeGreaterThan(firstRows[index].lastSeenAt.getTime());
    expect(await footprint(live.org.id)).toEqual(before);
    // The database holds the open-row key: a second open row for a subject is refused.
    const { id, createdAt, updatedAt, ...copy } = rows[0];
    await expect(prisma.projectException.create({ data: copy })).rejects.toMatchObject({ code: "P2002" });
  });

  it("an item the rule can no longer measure (its activity taken off the quantity method) is resolved 'not_comparable' with the reason — never 'cleared' — and the API says so", async () => {
    const certRows = () => rowsOf({ kind: "certified_over_installed", subjectId: items.R2.id });
    const [before] = await certRows();
    expect(before.resolvedAt).toBeNull();
    await prisma.activityProgressMethod.update({ where: { activityId: acts.C }, data: { method: "percent" } });
    try {
      const result = await evaluate();
      expect([result.errors, result.notComparable, result.resolved]).toEqual([[], 1, 0]);
      const [after] = await certRows();
      expect([after.id, after.resolvedReason, after.resolvedAt !== null]).toEqual([before.id, "not_comparable", true]);
      expect(after.dataJson.notComparable).toMatchObject({ reason: expect.stringMatching(/not every approved allocation of the item is on a quantity-method activity/), trigger: "test" });
      // The figures stay as they were last measured.
      expect([after.measured.toFixed(3), after.limit.toFixed(3)]).toEqual([before.measured.toFixed(3), before.limit.toFixed(3)]);
      const read = await api.get(at(`/controls/exceptions/${before.id}`), auth());
      ok("read not comparable", read);
      expect(read.body.data).toMatchObject({ status: "resolved", resolution: { reason: "not_comparable", detail: expect.stringMatching(/quantity-method activity/) } });
    } finally {
      await prisma.activityProgressMethod.update({ where: { activityId: acts.C }, data: { method: "quantity" } });
    }
    // Measurable again and still over: a new open row.
    const again = await evaluate();
    expect([again.errors, again.opened]).toEqual([[], 1]);
    const rows = await certRows();
    expect(rows.map((row) => [row.resolvedReason, row.resolvedAt === null])).toEqual([["not_comparable", false], [null, true]]);
    const cleared = await api.get(at(`/controls/exceptions/${rows[1].id}`), auth());
    expect(cleared.body.data.resolution).toBeNull();
  });

  it("a change order approved through the API with an allocation link raising the allocation clears the two quantity rows", async () => {
    const order = await api.post(at("/change-orders"), {
      description: "LiveTest slab extension",
      category: "variation",
      value: 1500,
      scheduleImpactSummary: "LiveTest none",
      costImpactSummary: "LiveTest priced",
      allocationLinks: [{ allocationId: allocations.A, quantity: 15, amount: 1500 }],
      activityLinks: [{ activityId: acts.A, relationType: "affected", scheduleImpactDays: 0 }],
      attachmentRefs: [{ fileName: "LiveTest proof.pdf", fileUrl: "https://example.test/proof.pdf" }],
    }, auth());
    ok("change order", order, 201);
    ok("change order submit", await api.post(at(`/change-orders/${order.body.data.id}/submit`), {}, auth()));
    ok("change order approve", await api.post(at(`/change-orders/${order.body.data.id}/approve`), { comment: "LiveTest" }, auth()));
    // The allocation itself is never changed: the authorised quantity is derived.
    expect(Number((await prisma.activityBoqAllocation.findUnique({ where: { id: allocations.A } })).quantity)).toBe(60);

    const result = await evaluate();
    expect(result.errors).toEqual([]);
    expect(result.resolved).toBe(2);
    const cleared = await rowsOf({ resolvedAt: { not: null }, resolvedReason: "cleared" });
    expect(cleared.map((row) => [row.kind, row.subjectId, row.resolvedReason])).toEqual([
      ["quantity_over_allocation", allocations.A, "cleared"],
      ["quantity_over_boq", items.R1.id, "cleared"],
    ]);
    const open = await rowsOf({ resolvedAt: null });
    expect(open).toHaveLength(8);
    expect(open.every((row) => !["quantity_over_allocation", "quantity_over_boq"].includes(row.kind))).toBe(true);
  });

  it("a dismissed slip is not reopened while it stands still, and reopens as a new row when it worsens", async () => {
    const slipRows = () => rowsOf({ kind: "schedule_slip_on_mapped_item", subjectId: acts.D });
    const slip = (await slipRows())[0];
    const dismissed = await engine.setDismissed({ orgId: live.org.id, projectId: project.id, exceptionId: slip.id, actorId: live.user.id, reason: "recovery plan accepted", note: "LiveTest" });
    expect(dismissed).toMatchObject({ resolvedReason: "dismissed:recovery plan accepted", reviewedBy: live.user.id, reviewNote: "LiveTest" });
    expect(dismissed.dataJson.dismissal).toMatchObject({ measured: "10.000", limit: "5.000", dismissedBy: live.user.id });
    expect(engine.statusOf(dismissed)).toBe("dismissed");
    // Another organisation cannot dismiss it.
    await expect(engine.setDismissed({ orgId: other.org.id, projectId: project.id, exceptionId: slip.id, reason: "x" })).rejects.toMatchObject({ status: 404 });

    let result = await evaluate();
    expect(result).toMatchObject({ opened: 0, suppressed: 1, resolved: 0, errors: [] });
    let rows = await slipRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(dismissed);

    // The CPM moves D's finish further out.
    await prisma.activity.update({ where: { id: acts.D }, data: { earlyFinish: 315 } });
    result = await evaluate();
    expect(result).toMatchObject({ opened: 1, suppressed: 0, errors: [] });
    rows = await slipRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(dismissed);
    expect(rows[1]).toMatchObject({ resolvedAt: null, severity: "warning" });
    expect(rows[1].measured.toFixed(3)).toBe("15.000");
    expect(rows[1].dataJson.reopenedFrom).toEqual({ id: slip.id, resolvedReason: "dismissed:recovery plan accepted", dismissedMeasured: "10" });
  });

  it("a forecast ENTERED on the budget line above its revised budget is a row of its own; removing it clears the row", async () => {
    const lineRows = () => rowsOf({ kind: "forecast_over_revised", subjectType: "budget_line", subjectId: ids.line });
    expect(await lineRows()).toEqual([]);
    ok("enter forecast", await api.request("PATCH", at(`/budget/lines/${ids.line}`), { body: { forecast: 1700 }, headers: auth() }));
    try {
      const result = await evaluate();
      expect([result.errors, result.opened]).toEqual([[], 1]);
      const [row] = await lineRows();
      expect([row.measured.toFixed(3), row.limit.toFixed(3), row.severity, row.dataJson.forecastIsManual]).toEqual(["1700.000", "1000.000", "critical", true]);
      expect(row.measuredBasis).toMatch(/entered \(typed\) forecast/);
      // committed_over_budget still states the commitment's gap, once.
      expect((await rowsOf({ kind: "committed_over_budget", resolvedAt: null })).length).toBe(1);
    } finally {
      ok("clear forecast", await api.request("PATCH", at(`/budget/lines/${ids.line}`), { body: { forecast: null }, headers: auth() }));
    }
    const cleared = await evaluate();
    expect(cleared.errors).toEqual([]);
    expect((await lineRows()).map((row) => row.resolvedReason)).toEqual(["cleared"]);
  });

  it("tenancy: the second organisation's project cannot be evaluated under the first, and its footprint is byte-identical throughout", async () => {
    await expect(engine.evaluateProject({ orgId: live.org.id, projectId: otherProject.id, trigger: "test", logger: { log: () => {} } })).rejects.toMatchObject({ status: 404, code: "PROJECT_NOT_FOUND" });
    expect(await footprint(other.org.id, { includeExceptions: true })).toEqual(otherBefore);
    expect(await prisma.projectException.count({ where: { OR: [{ orgId: other.org.id }, { projectId: otherProject.id }] } })).toBe(0);
    expect(await prisma.projectException.count({ where: { projectId: project.id, NOT: { orgId: live.org.id } } })).toBe(0);
  });
});
