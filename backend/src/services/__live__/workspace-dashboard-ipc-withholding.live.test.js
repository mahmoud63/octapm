/**
 * The workspace home's IPC queue lists a certificate's lines only to a
 * member who may read the BOQ, and the queue itself only to a member who may
 * read the IPC — proven against a real API process and the real local
 * Postgres (owner check, 2026-09-29).
 *
 * GET /projects/workspace-dashboard is open to every signed-in member for
 * the projects they can see. Its "IPC actions" queue listed every submitted
 * certificate line (ipc_item: its id, its period, its net payable) and
 * counted the lines, with no ipc:read and no boq:read check — although the
 * IPC routes admit certificates on ipc:read and withhold a certificate's
 * lines (one per approved allocation of a BOQ row, valued off the row) from
 * a member who may not read the BOQ (utils/boq-figures.js).
 *
 * Now, per project, as that project's own routes decide it:
 *   a member who may read the IPC and the BOQ receives the queue as before,
 *   byte for byte (the service's answer with no scope);
 *   a QS, finance member or PM whose template sets the BOQ tool to none
 *   (refused GET /boq, admitted to GET /ipc) receives the certificate-level
 *   items (the certificate's own totals, payment and retention status) and
 *   no line: no ipc_item item, no line in the count, no line id;
 *   a site engineer (refused GET /ipc) receives no IPC queue item and no
 *   count at all.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation that is
 * dropped afterwards.
 *
 *   npm run test:live -- src/services/__live__/workspace-dashboard-ipc-withholding.live.test.js
 */
const { prisma } = require("../../config/db");
const {
  createLiveOrg,
  createLiveUser,
  dropLiveOrg,
  liveDescribe,
  mintAccessToken,
} = require("../../__live__/helpers");
const { normalizeMoneyTree } = require("../../utils/money");
const workspaceDashboardService = require("../workspace-dashboard.service");
const { startApi } = require("./auth-live-kit");

// The home is stamped with when it was built and dates its sources by the
// newest record it read; nothing else moves between two reads.
const unstamped = (text) =>
  text
    .replace(/"generatedAt":"[^"]*"/g, '"generatedAt":"-"')
    .replace(/"cutoffDate":"[^"]*"/g, '"cutoffDate":"-"')
    .replace(/"sourceUpdatedAt":"[^"]*"/g, '"sourceUpdatedAt":"-"')
    .replace(/"asOf":"[^"]*"/g, '"asOf":"-"')
    .replace(/"asOfDate":"[^"]*"/g, '"asOfDate":"-"');

// PC-7b appends the open-exceptions tile to the route's answer (routes/projects.js);
// the service's dashboard is everything before it. The answer without the tile is
// compared with the service byte for byte; the tile is asserted on its own.
const withoutExceptionsTile = (text) => {
  const body = JSON.parse(text);
  const { openExceptions, ...data } = body.data;
  return { text: JSON.stringify({ ...body, data }), openExceptions };
};
const EMPTY_EXCEPTIONS_TILE = {
  total: 0,
  bySeverity: { critical: 0, warning: 0, info: 0 },
  inChange: 0,
  snoozed: 0,
  basis: "Unresolved project exceptions the caller may read, on every project they can open; open = not carried by a live change event and not snoozed",
};

const ipcQueue = (dashboard) => dashboard.workflowQueues.find((queue) => queue.key === "ipcActions");
const ipcPending = (dashboard) => dashboard.pendingReview.metrics.find((metric) => metric.key === "ipcActions").count;

liveDescribe("The workspace home lists IPC certificate lines only to a member who may read the BOQ", () => {
  let live;
  let api;
  let project;
  let row;
  let allocationId;
  let certificateId;
  let lineId;
  const members = {};
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;
  const HOME = "/api/v1/projects/workspace-dashboard";

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4" });
    const tag = Date.now();
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest IPC queue", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });

    const addMember = async (key, role, { noBoq }) => {
      const member = await createLiveUser(prisma, {
        orgId: live.org.id,
        name: `LiveTest ${key}`,
        email: `live-ipcqueue-${key.replace(/_/g, "")}-${tag}@octapm-live.test`,
        role,
      });
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: member.id, role, orgId: live.org.id } });
      if (noBoq) {
        // The role keeps its ipc access; the template takes the BOQ tool away.
        const template = await prisma.permissionTemplate.create({
          data: {
            orgId: live.org.id,
            name: `LiveTest ${key}, no BOQ ${tag}`,
            baseRole: role,
            tools: { create: [{ module: "boq", level: "none" }] },
          },
        });
        await prisma.projectUserPermission.create({
          data: { orgId: live.org.id, projectId: project.id, userId: member.id, templateId: template.id },
        });
      }
      members[key] = member;
    };
    await addMember("qs_reader", "qs", { noBoq: false });
    for (const role of ["qs", "finance", "pm"]) await addMember(role, role, { noBoq: true });
    await addMember("site_engineer", "site_engineer", { noBoq: false });

    // One priced row, allocated in full, so the certificate has one line
    // whose value is the row's amount.
    const created = await api.post(at("/boq/items"), { code: "Q7.41", description: "QUEUESECRET grout", quantity: 37, unit: "m3", rate: 487.61 }, auth());
    expect([created.status, created.body?.error]).toEqual([201, undefined]);
    row = created.body.data.item;
    const activity = await api.post(at("/activities"), {
      engineerIds: [live.user.id],
      name: "Grout baseplates",
      activityCode: "A910",
      duration: 3,
      startDate: "2026-02-02",
      endDate: "2026-02-04",
    }, auth());
    expect([activity.status, activity.body?.error]).toEqual([201, undefined]);
    const allocation = await api.post(at("/activity-boq-allocations"), { boqItemId: row.id, activityId: activity.body.data.id, quantity: 37 }, auth());
    expect([allocation.status, allocation.body?.error]).toEqual([201, undefined]);
    allocationId = allocation.body.data.id;
    for (const step of ["submit", "approve"]) {
      const moved = await api.post(at(`/activity-boq-allocations/${allocationId}/${step}`), {}, auth());
      expect([step, moved.status, moved.body?.error]).toEqual([step, 200, undefined]);
    }

    const terms = await api.request("PATCH", at("/prime-contract"), {
      body: { originalValue: 250000, retentionRate: 5, taxRate: 7.5 },
      headers: auth(),
    });
    expect([terms.status, terms.body?.error]).toEqual([200, undefined]);
    const period = await api.post(at("/ipc"), { period: "P01" }, auth());
    expect([period.status, period.body?.error]).toEqual([201, undefined]);
    certificateId = period.body.data.id;
    const read = await api.get(at("/ipc/P01"), auth());
    expect(read.body.data.items).toHaveLength(1);
    lineId = read.body.data.items[0].id;
    const submitted = await api.post(at("/ipc/P01/submit"), {}, auth());
    expect([submitted.status, submitted.body?.error, submitted.body.data.status]).toEqual([200, undefined, "submitted"]);
  }, 120_000);

  afterAll(async () => {
    if (api) await api.stop();
    if (live) {
      for (const model of ["projectDocument", "backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  it("a member who may read the IPC and the BOQ receives the queue as before, byte for byte, with the certificate and its line", async () => {
    for (const [who, headers, user] of [
      ["owner", auth(), { id: live.user.id, role: "pm", isCompanyAdmin: true }],
      ["qs_reader", as(members.qs_reader), { id: members.qs_reader.id, role: "qs", isCompanyAdmin: false }],
    ]) {
      const answer = await api.get(HOME, headers);
      expect([who, answer.status]).toEqual([who, 200]);
      // The service's answer with no IPC scope: what the route gave before.
      const before = await workspaceDashboardService.getWorkspaceDashboard({
        orgId: live.org.id,
        userId: user.id,
        role: user.role,
        isCompanyAdmin: user.isCompanyAdmin,
      });
      const beforeText = JSON.stringify({ success: true, data: normalizeMoneyTree(before) });
      if (who === "owner") {
        const { text, openExceptions } = withoutExceptionsTile(answer.text);
        expect([who, unstamped(text)]).toEqual([who, unstamped(beforeText)]);
        // This LiveTest organisation holds no exception rows: the tile is the empty figure, exactly.
        expect([who, openExceptions]).toEqual([who, EMPTY_EXCEPTIONS_TILE]);
      }
      else expect([who, ipcQueue(answer.body.data)]).toEqual([who, ipcQueue(JSON.parse(beforeText).data)]);

      const queue = ipcQueue(answer.body.data);
      expect([who, queue.count, queue.items.map((item) => [item.id, item.target.source])]).toEqual([
        who,
        2,
        [
          [certificateId, "ipc_certificate"],
          [lineId, "ipc_item"],
        ],
      ]);
    }
  });

  it("a QS, finance member and PM without BOQ read receive the certificate but no line of it, in the list or the count", async () => {
    const reader = (await api.get(HOME, auth())).body.data;
    const readerQueue = ipcQueue(reader);
    const readerRow = reader.projectHealth.find((entry) => entry.id === project.id);
    const expectedQueue = {
      ...readerQueue,
      count: readerQueue.count - 1,
      items: readerQueue.items.filter((item) => item.target.source !== "ipc_item"),
    };

    for (const role of ["qs", "finance", "pm"]) {
      const memberAuth = as(members[role]);
      // The BOQ tool is refused them; the IPC is not.
      expect([role, (await api.get(at("/boq"), memberAuth)).status]).toEqual([role, 403]);
      expect([role, (await api.get(at("/ipc/P01"), memberAuth)).status]).toEqual([role, 200]);

      const home = await api.get(HOME, memberAuth);
      expect([role, home.status]).toEqual([role, 200]);
      expect([role, ipcQueue(home.body.data)]).toEqual([role, expectedQueue]);
      expect([role, ipcQueue(home.body.data).items.map((item) => item.id)]).toEqual([role, [certificateId]]);
      for (const secret of [lineId, row.id, allocationId, "Q7.41", "QUEUESECRET", "ipc_item"]) {
        expect([role, secret, home.text.includes(secret)]).toEqual([role, secret, false]);
      }
      // The line is out of the pending-review count and the project's
      // workflow count too.
      expect([role, ipcPending(home.body.data)]).toEqual([role, ipcPending(reader) - 1]);
      const mine = home.body.data.projectHealth.find((entry) => entry.id === project.id);
      expect([role, mine.workflowActions]).toEqual([role, readerRow.workflowActions - 1]);
    }
  });

  it("a site engineer, who may not read the IPC, receives no IPC queue item and no IPC count", async () => {
    const reader = (await api.get(HOME, auth())).body.data;
    const readerQueue = ipcQueue(reader);
    const readerRow = reader.projectHealth.find((entry) => entry.id === project.id);
    const memberAuth = as(members.site_engineer);
    expect((await api.get(at("/ipc"), memberAuth)).status).toBe(403);

    const home = await api.get(HOME, memberAuth);
    expect(home.status).toBe(200);
    expect(ipcQueue(home.body.data)).toEqual({
      ...readerQueue,
      count: 0,
      items: [],
      defaultTarget: { projectId: null, module: "commercial", child: "ipc" },
    });
    expect(ipcPending(home.body.data)).toBe(0);
    for (const secret of [certificateId, lineId, row.id, allocationId, "ipc_item"]) {
      expect([secret, home.text.includes(secret)]).toEqual([secret, false]);
    }
    const mine = home.body.data.projectHealth.find((entry) => entry.id === project.id);
    expect(mine.workflowActions).toBe(readerRow.workflowActions - 2);
  });
});
