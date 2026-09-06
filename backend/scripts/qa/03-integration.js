/**
 * Cross-module integration chains.
 *
 * These are the scenarios that matter: not "can I create a change order" but
 * "does an RFI that finds extra work carry its value all the way through to the
 * budget without anyone retyping a number". Each step checks the API answer,
 * then goes to the database to confirm the link actually exists.
 */
const { prisma, login, actor, money, sameMoney } = require("./harness");

const SEED_PASSWORD = process.env.QA_SEED_PASSWORD || "DemoPassw0rd!";

const stamp = () => new Date().toISOString().slice(11, 19).replace(/:/g, "");

module.exports = async function integration(runner) {
  const ctx = runner.context;

  // Everything below acts as the PM unless a step needs another role.
  if (!ctx.pm) {
    const session = await login("pm@octapm.demo", SEED_PASSWORD);
    ctx.pm = actor(session.token, "PM");
    ctx.pmUser = session.user;
  }
  if (!ctx.projectId) {
    const projects = await ctx.pm.get("/projects");
    ctx.projectId = (projects.data?.items || [])[0]?.id;
  }
  const pm = ctx.pm;
  const P = ctx.projectId;

  // ─── The money chain ────────────────────────────────────────────────────

  await runner.run(
    "S-INT-001",
    {
      module: "RFI → Change Event",
      purpose: "An RFI that finds extra work becomes a change event carrying its reference",
      role: "PM",
      preconditions: "A project with an RFI",
    },
    async (s, context) => {
      const created = await pm.post(`/projects/${P}/rfi`, {
        subject: `Unforeseen rock in footing zone B ${stamp()}`,
        question: "Rock encountered at 2.4m. Confirm additional excavation and breaking.",
        priority: "high",
        scheduleImpactFlag: true,
        scheduleImpact: 6,
        costImpact: true,
        costImpactAmount: 48500,
      });
      s.step("PM raises an RFI with schedule impact", `HTTP ${created.status}`);
      if (created.status >= 300) {
        return s.fail("api", `RFI create failed: HTTP ${created.status} ${created.error?.message || ""}`, {
          severity: "Blocker",
        });
      }
      const rfi = created.data?.rfi || created.data;
      context.rfiId = rfi?.id;
      if (!context.rfiId) return s.fail("api", "RFI created but no id returned", { severity: "Blocker" });
      s.note("api", `RFI ${rfi.ref || context.rfiId} created`);

      const row = await prisma.rfi.findUnique({ where: { id: context.rfiId } });
      if (!row) return s.fail("database", "RFI row missing after a successful create", { severity: "Blocker" });
      if (row.projectId !== P) s.fail("database", "RFI written against the wrong project", { severity: "Blocker" });
      else s.note("database", "RFI row is scoped to the project");
      if (!row.createdBy && !row.raisedById && !row.createdById) {
        s.gap("database", "no creator column populated on the RFI row");
      } else {
        s.note("database", "creator recorded");
      }

      // Convert with no body at all: the whole point is that the RFI's own
      // cost and schedule impact carry across without anyone retyping them.
      const converted = await pm.post(`/projects/${P}/rfi/${context.rfiId}/convert-to-change`, {});
      s.step("convert the RFI to a change, passing no values", `HTTP ${converted.status}`);
      if (converted.status >= 300) {
        return s.fail(
          "connected",
          `RFI → change conversion failed: HTTP ${converted.status} ${converted.error?.message || ""}`,
          { severity: "Critical" },
        );
      }
      const payload = converted.data || {};
      context.changeOrderId = payload.changeOrder?.id || null;
      s.note("connected", `conversion returned: ${Object.keys(payload).join(", ")}`);

      // Naming versus behaviour: the route is convert-to-change and the service
      // is convertToChangeEvent, but what comes back is a ChangeOrder. The
      // Change Event module exists separately with its own RFQ pricing flow, so
      // an RFI cannot currently feed that flow — it jumps straight to a CO.
      if (payload.changeEvent) {
        s.note("connected", "conversion produced a change event");
      } else if (payload.changeOrder) {
        s.gap(
          "connected",
          "convert-to-change produces a ChangeOrder directly, not a ChangeEvent: an RFI cannot enter the change-event RFQ pricing flow",
        );
      }
      if (!context.changeOrderId) {
        return s.fail("api", "conversion returned no change order id", { severity: "Critical" });
      }

      const co = await prisma.changeOrder.findUnique({ where: { id: context.changeOrderId } });
      if (!co) return s.fail("database", "the change order returned does not exist", { severity: "Critical" });
      s.note("database", `change order ${co.ref} exists`);

      if (!sameMoney(co.value, 48500)) {
        s.fail(
          "connected",
          `the RFI's cost impact did not transfer: RFI carried 48500, change order stored ${money(co.value)}`,
          { severity: "Critical", fix: "Map rfi.costImpactAmount onto the change order value during conversion." },
        );
      } else {
        s.note("connected", "cost impact transferred with no manual re-entry");
      }
      if (Number(co.scheduleImpact) !== 6) {
        s.fail("connected", `schedule impact did not transfer: expected 6 days, stored ${co.scheduleImpact}`, {
          severity: "Major",
        });
      } else {
        s.note("connected", "schedule impact transferred");
      }

      const rfiAfter = await prisma.rfi.findUnique({ where: { id: context.rfiId } });
      if (rfiAfter?.changeOrderId !== context.changeOrderId) {
        s.fail("connected", "the RFI does not link forward to the change order it produced", { severity: "Major" });
      } else {
        s.note("connected", "the RFI links forward to its change order");
      }

      // Converting twice must not create a second change order.
      const again = await pm.post(`/projects/${P}/rfi/${context.rfiId}/convert-to-change`, {});
      s.step("convert the same RFI a second time", `HTTP ${again.status}`);
      if (again.status < 300) {
        s.fail("api", "the same RFI converted twice, creating a duplicate change order", { severity: "Major" });
      } else {
        s.note("api", `duplicate conversion refused with ${again.status} ${again.error?.code || ""}`);
      }
    },
  );

  await runner.run(
    "S-INT-002",
    {
      module: "Change Event → Change Order",
      purpose: "A priced change event becomes a change order with its value intact",
      role: "PM",
      preconditions: "S-INT-001",
    },
    async (s, context) => {
      // The change-event flow is its own path (RFIs do not feed it — see
      // S-INT-001), so raise one directly the way a PM pricing extra work would.
      const event = await pm.post(`/projects/${P}/change-events`, {
        title: `Additional rock excavation zone B ${stamp()}`,
        type: "site_condition",
        origin: "manual",
        romAmount: 48500,
        description: "Rock encountered at 2.4m across footing zone B.",
      });
      s.step("raise a change event with a ROM value", `HTTP ${event.status}`);
      if (event.status >= 300) {
        return s.fail("api", `change event create failed: HTTP ${event.status} ${event.error?.message || ""}`, {
          severity: "Critical",
        });
      }
      context.changeEventId = event.data?.changeEvent?.id || event.data?.id;
      if (!context.changeEventId) return s.fail("api", "no change event id returned", { severity: "Critical" });

      const eventRow = await prisma.changeEvent.findUnique({ where: { id: context.changeEventId } });
      if (!eventRow) return s.fail("database", "the change event returned does not exist", { severity: "Critical" });
      if (!sameMoney(eventRow.romAmount, 48500)) {
        s.fail("database", `ROM stored as ${money(eventRow.romAmount)}, expected 48500`, { severity: "Major" });
      } else {
        s.note("database", `change event ${eventRow.ref} holds its ROM value`);
      }

      const converted = await pm.post(`/projects/${P}/change-events/${context.changeEventId}/convert`, {
        description: "Additional rock excavation, footing zone B",
        category: "variation",
        value: 48500,
      });
      s.step("convert the change event to a change order", `HTTP ${converted.status}`);
      if (converted.status >= 300) {
        return s.fail(
          "connected",
          `conversion failed: HTTP ${converted.status} ${converted.error?.message || ""}`,
          { severity: "Critical" },
        );
      }

      const changeOrderId =
        converted.data?.changeOrder?.id || converted.data?.id || converted.data?.changeEvent?.changeOrderId;
      // This becomes the change order S-INT-003 pushes through to the budget.
      context.changeOrderId = changeOrderId || context.changeOrderId;
      if (!changeOrderId) return s.fail("api", "no change order id returned", { severity: "Critical" });

      const co = await prisma.changeOrder.findUnique({ where: { id: changeOrderId } });
      if (!co) return s.fail("database", "the change order id returned does not exist", { severity: "Critical" });
      s.note("database", `change order ${co.ref || co.id} exists`);

      if (!sameMoney(co.value, 48500)) {
        s.fail("connected", `value did not carry through: expected 48500, stored ${money(co.value)}`, {
          severity: "Critical",
          fix: "Map the change event's priced amount onto the change order value during conversion.",
        });
      } else {
        s.note("connected", "value carried through with no manual re-entry");
      }

      const afterConvert = await prisma.changeEvent.findUnique({ where: { id: context.changeEventId } });
      if (afterConvert?.changeOrderId !== changeOrderId) {
        s.fail("connected", "the change event does not point at the change order it produced", {
          severity: "Major",
        });
      } else {
        s.note("connected", "the change event links forward to its change order");
      }
      if (afterConvert && afterConvert.status !== "converted") {
        s.gap("connected", `change event status is "${afterConvert.status}" after conversion, expected "converted"`);
      }
    },
  );

  await runner.run(
    "S-INT-003",
    {
      module: "Change Order → Budget",
      purpose: "Approving a change order moves the revised budget by its value",
      role: "PM",
      preconditions: "S-INT-002",
    },
    async (s, context) => {
      if (!context.changeOrderId) return s.gap("connected", "skipped: no change order");

      const before = await pm.get(`/projects/${P}/budget/lines`);
      const beforeLines = before.data?.lines || before.data?.items || [];
      const beforeRevised = beforeLines.reduce((sum, l) => sum + money(l.revised ?? l.revisedBudget ?? 0), 0);
      s.step("read the budget before approval", `${beforeLines.length} line(s), revised total ${beforeRevised}`);
      if (!beforeLines.length) {
        s.gap("connected", "the project has no budget lines, so budget movement cannot be observed");
      }

      // First: the governance control. A variation must not be submittable
      // without impact analysis and supporting evidence — that is a contractual
      // requirement, not a nicety, so verify it is actually enforced.
      const premature = await pm.post(`/projects/${P}/change-orders/${context.changeOrderId}/submit`, {
        comment: "Submitted with no impact analysis",
      });
      s.step("try to submit with no impact analysis", `HTTP ${premature.status}`);
      if (premature.status < 300) {
        s.fail(
          "permission",
          "a change order was submitted with no impact summaries, activity link or evidence",
          { severity: "Major", fix: "assertSubmittable must run on the submit path." },
        );
      } else {
        s.note(
          "permission",
          `control enforced: submit refused with ${premature.status} ${premature.error?.code || ""}`,
        );
      }

      // Now supply what a PM would: the impact analysis and the activity it hits.
      const activities = await pm.get(`/projects/${P}/activities`);
      const activityRows = Array.isArray(activities.data) ? activities.data : activities.data?.items || [];
      const activityId = activityRows[0]?.id;

      const completed = await pm.patch(`/projects/${P}/change-orders/${context.changeOrderId}`, {
        scheduleImpactSummary: "6 days added to the critical path through the substructure.",
        costImpactSummary: "Additional rock excavation and breaking, measured against BOQ item B-100.",
        ...(activityId ? { activityIds: [activityId] } : {}),
      });
      s.step("supply the impact analysis", `HTTP ${completed.status}`);

      const submitted = await pm.post(`/projects/${P}/change-orders/${context.changeOrderId}/submit`, {
        comment: "Submitted with impact analysis",
      });
      s.step("submit with the analysis supplied", `HTTP ${submitted.status}`);
      if (submitted.status >= 300) {
        s.gap(
          "connected",
          `submit still refused (${submitted.error?.code || submitted.status}): ${submitted.error?.message || ""} — the remaining control is supporting evidence, which needs a document upload`,
        );
        return;
      }
      s.note("connected", "submit accepted once the impact analysis was supplied");

      const approved = await pm.post(`/projects/${P}/change-orders/${context.changeOrderId}/approve`, {
        comment: "Approved by the scenario test",
      });
      s.step("approve the change order", `HTTP ${approved.status}`);
      if (approved.status >= 300) {
        return s.fail(
          "api",
          `approval failed: HTTP ${approved.status} ${approved.error?.code || ""} ${approved.error?.message || ""}`,
          { severity: "Critical" },
        );
      }

      const co = await prisma.changeOrder.findUnique({ where: { id: context.changeOrderId } });
      if (co?.status !== "approved") {
        s.fail("database", `change order status is "${co?.status}" after approval`, { severity: "Critical" });
      } else {
        s.note("database", "change order is approved in the database");
      }

      if (beforeLines.length) {
        const after = await pm.get(`/projects/${P}/budget/lines`);
        const afterLines = after.data?.lines || after.data?.items || [];
        const afterRevised = afterLines.reduce((sum, l) => sum + money(l.revised ?? l.revisedBudget ?? 0), 0);
        s.step("read the budget after approval", `revised total ${afterRevised}`);
        const movement = afterRevised - beforeRevised;
        if (!sameMoney(movement, 48500, 1)) {
          s.fail(
            "connected",
            `approved change order did not move the revised budget: expected +48500, saw ${movement}`,
            {
              severity: "Critical",
              fix: "budget.service.applyChangeOrderToBudgetLines must run inside change-order approval.",
            },
          );
        } else {
          s.note("connected", "revised budget moved by exactly the approved value");
        }
      }

      // The audit trail is a contractual record on a financial change.
      const audits = await prisma.auditEvent
        .count({ where: { recordType: "change_order", recordId: context.changeOrderId } })
        .catch(() => null);
      if (audits === null) s.gap("database", "no auditEvent table reachable to verify the trail");
      else if (audits === 0) {
        s.fail("database", "approving a change order wrote no audit event", {
          severity: "Major",
          fix: "Emit an audit event on every change-order status transition.",
        });
      } else {
        s.note("database", `${audits} audit event(s) recorded against the change order`);
      }
    },
  );

  // ─── The field chain ────────────────────────────────────────────────────

  await runner.run(
    "S-INT-004",
    {
      module: "Inspection → Punch",
      purpose: "A failed inspection item raises a tracked defect",
      role: "PM",
      preconditions: "A form template exists",
    },
    async (s, context) => {
      let templates = await pm.get(`/projects/${P}/forms/templates`);
      s.step("list form templates", `HTTP ${templates.status}`);
      let list = templates.data?.templates || templates.data?.items || [];

      // A fresh organisation has none, so lay down the starter set the product
      // ships and carry on — a company would do this once at setup.
      if (!list.length) {
        const formService = require("../../src/services/form.service");
        await formService
          .seedStarterTemplates({ orgId: context.pmUser?.orgId || (await prisma.project.findUnique({ where: { id: P } })).orgId })
          .catch((error) => s.gap("api", `seedStarterTemplates failed: ${error.message}`));
        templates = await pm.get(`/projects/${P}/forms/templates`);
        list = templates.data?.templates || templates.data?.items || [];
        s.step("seed the starter inspection templates", `${list.length} template(s)`);
      }
      if (!list.length) {
        return s.gap("connected", "no inspection templates available, so the chain cannot be exercised");
      }
      s.note("api", `${list.length} template(s) available`);

      const instance = await pm.post(`/projects/${P}/forms`, {
        templateId: list[0].id,
        title: `Scenario inspection ${stamp()}`,
      });
      s.step("open an inspection", `HTTP ${instance.status}`);
      if (instance.status >= 300) {
        return s.fail("api", `could not open an inspection: HTTP ${instance.status} ${instance.error?.message || ""}`, {
          severity: "Major",
        });
      }
      const instanceId = instance.data?.instance?.id || instance.data?.id;
      context.formInstanceId = instanceId;

      const detail = await pm.get(`/projects/${P}/forms/${instanceId}`);
      const items =
        detail.data?.instance?.responses ||
        detail.data?.responses ||
        detail.data?.instance?.items ||
        detail.data?.items ||
        [];
      if (!items.length) return s.gap("api", "the inspection has no items to fail");

      const itemId = items[0].itemId || items[0].id;
      const deficiency = await pm.post(`/projects/${P}/forms/${instanceId}/items/${itemId}/deficiency`, {
        title: `Honeycombing at column C4 ${stamp()}`,
        description: "Concrete honeycombing exposed on strike. Raised from a failed inspection item.",
        kind: "punch_item",
      });
      s.step("raise a deficiency from the failed item", `HTTP ${deficiency.status}`);
      if (deficiency.status >= 300) {
        return s.fail(
          "connected",
          `deficiency did not raise a defect: HTTP ${deficiency.status} ${deficiency.error?.message || ""}`,
          { severity: "Critical" },
        );
      }

      const punchId = deficiency.data?.punchItem?.id || deficiency.data?.id;
      if (!punchId) return s.fail("api", "no punch item id returned", { severity: "Major" });

      const punch = await prisma.punchItem.findUnique({ where: { id: punchId } });
      if (!punch) return s.fail("database", "the punch item returned does not exist", { severity: "Critical" });
      s.note("database", `punch item ${punch.ref || punch.id} exists`);

      const linked =
        punch.sourceRecordId === instanceId ||
        punch.sourceRecordType === "form_instance" ||
        punch.formInstanceId === instanceId;
      if (!linked) {
        s.fail("connected", "the punch item does not record the inspection it came from", {
          severity: "Major",
          fix: "Persist sourceRecordType/sourceRecordId when raising a deficiency.",
        });
      } else {
        s.note("connected", "punch item traces back to the inspection");
      }
    },
  );

  // ─── Progress feeding earned value ──────────────────────────────────────

  await runner.run(
    "S-INT-005",
    {
      module: "Progress → Earned Value",
      purpose: "Approved activity progress is what the earned-value figures are built from",
      role: "PM",
      preconditions: "Seeded activities with approved progress",
    },
    async (s) => {
      const activities = await pm.get(`/projects/${P}/activities`);
      // This endpoint returns a bare array as `data`, where the rest of the API
      // returns { items, pagination } or { rows, pagination }.
      const rows = Array.isArray(activities.data)
        ? activities.data
        : activities.data?.items || activities.data?.activities || [];
      s.step("read activities", `${rows.length} activity(ies)`);
      if (!rows.length) return s.fail("api", "no activities on the project", { severity: "Critical" });
      if (Array.isArray(activities.data)) {
        s.gap(
          "api",
          "GET /projects/{id}/activities returns a bare array while comparable list endpoints return { items, pagination } — an inconsistency every client has to special-case",
        );
      }

      const health = await pm.get(`/projects/${P}/health`);
      s.step("read the project health dashboard", `HTTP ${health.status}`);
      if (health.status !== 200) return s.fail("api", `health returned ${health.status}`, { severity: "Major" });

      // Recompute the weighted percent complete from the source rows and
      // compare it with whatever the dashboard reports.
      const dbActivities = await prisma.activity.findMany({
        where: { projectId: P, isActive: true },
        select: { id: true, budget: true },
      });
      const budgets = new Map(dbActivities.map((a) => [a.id, money(a.budget)]));
      const totalBudget = [...budgets.values()].reduce((a, b) => a + b, 0);

      const approved = await prisma.activityProgress.findMany({
        where: { activityId: { in: [...budgets.keys()] }, status: "approved" },
        orderBy: { updatedAt: "desc" },
      });
      const latest = new Map();
      for (const p of approved) if (!latest.has(p.activityId)) latest.set(p.activityId, p);

      const earned = [...latest.values()].reduce(
        (sum, p) => sum + (money(p.pctComplete) / 100) * (budgets.get(p.activityId) || 0),
        0,
      );
      const expectedPct = totalBudget ? (earned / totalBudget) * 100 : 0;
      s.step("recompute weighted progress from source rows", `${expectedPct.toFixed(2)}%`);
      s.note("database", `EV recomputed from ${latest.size} approved progress row(s) = ${earned.toFixed(0)}`);

      const body = JSON.stringify(health.data || {});
      const reported =
        health.data?.progress?.percentComplete ??
        health.data?.summary?.percentComplete ??
        health.data?.percentComplete ??
        null;

      if (reported === null) {
        s.gap("connected", `the health payload exposes no overall percent complete (keys: ${Object.keys(health.data || {}).join(", ")})`);
      } else if (Math.abs(Number(reported) - expectedPct) > 1) {
        s.fail(
          "connected",
          `dashboard reports ${Number(reported).toFixed(2)}% but the source rows give ${expectedPct.toFixed(2)}%`,
          { severity: "Critical", fix: "Reconcile the dashboard aggregate with the approved-progress source." },
        );
      } else {
        s.note("connected", `dashboard percent complete agrees with the source rows (${Number(reported).toFixed(2)}%)`);
      }
      if (!body.includes("spi") && !body.includes("cpi")) {
        s.gap("connected", "the health payload carries no SPI/CPI figures");
      }
    },
  );
};
