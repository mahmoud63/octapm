/**
 * The workspace dashboard as the caller may see it (AI-3): the composition
 * GET /projects/workspace-dashboard always made, moved here so the AI
 * features read exactly what the dashboard already shows and nothing more.
 * Every figure is decided per project, as that project's own routes decide
 * it, BEFORE anything is read (authorisation before retrieval):
 *   - each queue only where the caller may read that module there
 *     (certification N3), tasks under the task list's rule;
 *   - the IPC queue only with ipc:read, its lines only with the BOQ;
 *   - budget and EAC only with the BOQ or cost module (§12);
 *   - open exceptions only those the caller may read (PC-7b);
 *   - contract values only with the commercial terms (L25).
 * `projectId` narrows the read to one project the caller can open (the
 * project-level AI); omitted, it is the whole workspace.
 */
const { requestForProject } = require("../../../middleware/project-access");
const { hasPermission } = require("../../../middleware/rbac");
const { boqFigureAccess, canReadBoq, withheldWorkspaceDashboard } = require("../../../utils/boq-figures");
const exceptionService = require("../../exception.service");
const projectService = require("../../project.service");
const taskService = require("../../task.service");
const workspaceDashboardService = require("../../workspace-dashboard.service");

const authorizedWorkspaceDashboard = async (req, { projectId = null } = {}) => {
  // The caller as each project's own routes see them (template, role,
  // party), resolved once per project.
  const views = new Map();
  const viewFor = (id) => {
    if (!views.has(id)) views.set(id, requestForProject(req, id));
    return views.get(id);
  };
  const caller = { orgId: req.user.orgId, userId: req.user.id, role: req.user.role, isCompanyAdmin: req.user.isCompanyAdmin };

  const result = await workspaceDashboardService.getWorkspaceDashboard({
    ...caller,
    onlyProjectId: projectId,
    // The IPC queue, as the IPC routes admit it: a project's certificates
    // only to a member who may read its IPC (ipc:read, the guard on
    // GET /ipc), and its certificate lines — one per BOQ row allocated,
    // valued off it — only to one who may also read its BOQ, as
    // GET /ipc/:period withholds them (utils/boq-figures).
    ipcAccessFor: async (id) => {
      const view = await viewFor(id);
      const certificates = hasPermission(view, "ipc", "read");
      return { certificates, lines: certificates && canReadBoq(view) };
    },
    // Every other queue, as that module's own routes decide it on that
    // project (certification N3), and tasks under the task list's rule.
    moduleAccessFor: async (id) => {
      const view = await viewFor(id);
      return {
        can: (moduleName) => hasPermission(view, moduleName, "read"),
        projectWideTasks: Boolean(view.user) && taskService.hasProjectWideTaskVisibility({ role: req.user.role, projectAccess: view.projectAccess }),
      };
    },
  });

  // Each project's row states its budget (bac) and the EAC built from it:
  // the approved allocations, which that project's schedule, forecast and
  // history withhold from someone who may read neither the BOQ nor the
  // cost module there (§12, utils/boq-figures). Decided per project, as
  // that project's own routes decide it.
  const rows = Array.isArray(result?.projectHealth) ? result.projectHealth : [];
  const access = new Map(await Promise.all(rows.map(async (row) => [row.id, boqFigureAccess(await viewFor(row.id))])));
  // PC-7b: the open-exceptions figure, org-wide (§35 rule 2) over the
  // projects the caller can open, counting on each only the exceptions
  // they may read there (utils/boq-figures, per project).
  const openExceptions = await exceptionService.workspaceOpenExceptions({
    ...caller,
    onlyProjectId: projectId,
    accessFor: async (id) => exceptionService.exceptionAccessForView(await viewFor(id)),
  });
  const dashboard = withheldWorkspaceDashboard(result, (id) => access.get(id));
  // Each project's contract value, and their total, only where the caller
  // may read the project's commercial terms (certification L25).
  const withTerms = await projectService.withheldDashboardContractValues({
    dashboard,
    ...caller,
    commercialAccessFor: async (id) => hasPermission(await viewFor(id), "ipc", "read"),
  });
  return { ...withTerms, openExceptions };
};

module.exports = { authorizedWorkspaceDashboard };
