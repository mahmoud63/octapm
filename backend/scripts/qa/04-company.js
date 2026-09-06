/**
 * Company-scoped scenarios.
 *
 * A construction company sets its standards once and reuses them on every
 * project: inspection templates, cost codes, vendors. These live at the
 * organisation, not on a project, and that distinction is where the bugs hide.
 */
const { prisma, login, actor } = require("./harness");

const SEED_PASSWORD = process.env.QA_SEED_PASSWORD || "DemoPassw0rd!";
const stamp = () => Date.now().toString().slice(-8);

module.exports = async function company(runner) {
  const ctx = runner.context;
  if (!ctx.pm) {
    const session = await login("pm@octapm.demo", SEED_PASSWORD);
    ctx.pm = actor(session.token, "PM");
    ctx.pmUser = session.user;
  }
  const pm = ctx.pm;

  await runner.run(
    "S-COMPANY-001",
    {
      module: "Company / Inspections",
      purpose: "A company admin publishes a shared inspection template for every project to use",
      role: "Company admin (PM)",
      preconditions: "Signed-in company administrator",
    },
    async (s, context) => {
      const name = `Company concrete pour checklist ${stamp()}`;
      const created = await pm.post("/company/form-templates", {
        name,
        type: "inspection",
        sections: [
          {
            title: "Pre-pour",
            items: [
              { label: "Reinforcement as per drawing", type: "pass_fail" },
              { label: "Formwork checked and clean", type: "pass_fail" },
            ],
          },
        ],
      });
      s.step("create a company-level template", `HTTP ${created.status}`);
      if (created.status >= 300) {
        return s.fail(
          "api",
          `company template creation failed: HTTP ${created.status} ${created.error?.code || ""} ${created.error?.message || ""}`,
          {
            severity: "Critical",
            fix: "Company-scoped entities have no projectId; the audit trail must accept that.",
          },
        );
      }

      const templateId = created.data?.template?.id || created.data?.id;
      if (!templateId) return s.fail("api", "no template id returned", { severity: "Major" });
      context.companyTemplateId = templateId;
      s.note("api", "company template created");

      const row = await prisma.formTemplate.findUnique({ where: { id: templateId } });
      if (!row) return s.fail("database", "the template returned does not exist", { severity: "Critical" });
      if (row.projectId !== null) {
        s.fail("database", `a company template was written with projectId ${row.projectId}`, { severity: "Major" });
      } else {
        s.note("database", "the template is org-scoped, with no project");
      }

      // The audit trail is the reason this was broken; check it is now written.
      const audits = await prisma.auditEvent.findMany({
        where: { entityId: templateId },
        select: { entityType: true, action: true, projectId: true, orgId: true },
      });
      if (!audits.length) {
        s.fail("database", "creating a company template left no audit event", {
          severity: "Major",
          fix: "AuditEvent.projectId must be nullable so org-level actions can be recorded.",
        });
      } else {
        s.note("database", `audit event recorded (projectId=${audits[0].projectId}, action=${audits[0].action})`);
      }

      // And it must actually be reusable from a project.
      const visible = await pm.get("/company/form-templates");
      const list = visible.data?.templates || visible.data?.items || [];
      if (!list.some((t) => t.id === templateId)) {
        s.fail("connected", "the new template is not in the company template list", { severity: "Major" });
      } else {
        s.note("connected", `${list.length} company template(s) available to every project`);
      }

      if (context.projectId) {
        const fromProject = await pm.get(`/projects/${context.projectId}/forms/templates`);
        const projectList = fromProject.data?.templates || fromProject.data?.items || [];
        if (!projectList.some((t) => t.id === templateId)) {
          s.fail(
            "connected",
            "a company template is not offered inside a project, so it cannot be used where the work happens",
            { severity: "Critical" },
          );
        } else {
          s.note("connected", "the company template is selectable from within the project");
        }
      }
    },
  );
};
