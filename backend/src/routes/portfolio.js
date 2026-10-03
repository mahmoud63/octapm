const express = require("express");
const ExcelJS = require("exceljs");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
/** A key limited to some projects sees a portfolio of those projects only (Phase 21D, CX21-425). */
const keyProjects = (req) => (req.apiClient?.projectIds?.length ? req.apiClient.projectIds : null);
const service = require("../services/portfolio.service");
const projectService = require("../services/project.service");

/** Portfolio (OCTA-RPT-BUILDER-023): `/portfolio` — one health row per project from snapshots. */
const router = express.Router();
router.use(authenticate);

const user = (req) => ({ id: req.user.id, role: req.user.role, isCompanyAdmin: Boolean(req.user.isCompanyAdmin) });
// Each project's contract value only where the caller may read its
// commercial terms, decided on that project's own view (R20, as GET
// /projects/:id decides it).
const commercialAccessForProjects = (req) => async (projectIds) => projectService.commercialTermsReadableIds({ req, projectIds });
const portfolioFor = (req) => service.getPortfolio({ orgId: req.user.orgId, user: user(req), projectIds: keyProjects(req), commercialAccessForProjects: commercialAccessForProjects(req) });

router.get(
  "/",
  requirePermission("portfolio", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, await portfolioFor(req))),
);

router.post(
  "/refresh",
  requirePermission("portfolio", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, await service.requestRefresh({ orgId: req.user.orgId, user: user(req) }), 202)),
);

router.get(
  "/export.xlsx",
  requirePermission("portfolio", "export"),
  asyncHandler(async (req, res) => {
    const portfolio = await portfolioFor(req);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "OctaPM";
    const sheet = workbook.addWorksheet("Portfolio");
    sheet.columns = [
      { header: "Project", key: "name", width: 32 },
      { header: "Status", key: "status", width: 12 },
      { header: "Client", key: "client", width: 24 },
      { header: "Currency", key: "currency", width: 10 },
      { header: "Contract value", key: "contractValue", width: 16 },
      { header: "Health", key: "health", width: 10 },
      { header: "Weakest", key: "weakest", width: 14 },
      { header: "SPI", key: "spi", width: 8 },
      { header: "CPI", key: "cpi", width: 8 },
      { header: "EV", key: "ev", width: 14 },
      { header: "PV", key: "pv", width: 14 },
      { header: "AC", key: "ac", width: 14 },
      { header: "EAC", key: "eac", width: 14 },
      { header: "Cash net (90d)", key: "cashNet90", width: 16 },
      { header: "Open RFIs", key: "openRfis", width: 10 },
      { header: "Open punch", key: "openPunch", width: 10 },
      { header: "Open NCRs", key: "openNcrs", width: 10 },
      { header: "Pending submittals", key: "pendingSubmittals", width: 12 },
      { header: "Open tasks", key: "openTasks", width: 10 },
      { header: "Overdue items", key: "overdueItems", width: 12 },
      { header: "Pending COs", key: "pendingChangeOrders", width: 12 },
      { header: "Delayed activities", key: "delayedActivities", width: 12 },
      { header: "Computed", key: "computedAt", width: 20 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const row of portfolio.rows) {
      const snapshot = row.snapshot || {};
      sheet.addRow({ name: row.name, status: row.status, client: row.client, currency: row.currency, contractValue: row.contractValueWithheld ? "" : row.contractValue, health: snapshot.overallScore ?? "", weakest: snapshot.weakestDimension ?? "", spi: snapshot.spi ?? "", cpi: snapshot.cpi ?? "", ev: snapshot.ev ?? "", pv: snapshot.pv ?? "", ac: snapshot.ac ?? "", eac: snapshot.eac ?? "", cashNet90: snapshot.cashNet90 ?? "", openRfis: snapshot.openRfis ?? "", openPunch: snapshot.openPunch ?? "", openNcrs: snapshot.openNcrs ?? "", pendingSubmittals: snapshot.pendingSubmittals ?? "", openTasks: snapshot.openTasks ?? "", overdueItems: snapshot.overdueItems ?? "", pendingChangeOrders: snapshot.pendingChangeOrders ?? "", delayedActivities: snapshot.delayedActivities ?? "", computedAt: snapshot.computedAt ?? "" });
    }
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="portfolio-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  }),
);

module.exports = router;
