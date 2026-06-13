const ExcelJS = require('exceljs');
const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  computeProcurementRisk,
  serializeDate,
} = require('./procurement-risk.service');
const { workingDayToDate } = require('./cpm.service');

const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1E3A5F' },
};
const HEADER_FONT = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 11,
};

function styleHeaders(sheet, columns) {
  sheet.columns = columns;
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true,
    };
  });
  headerRow.height = 28;
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB');
}

function parseAssumptions(snapshotJson) {
  if (!snapshotJson || typeof snapshotJson !== 'object') return [];
  const assumptions = Array.isArray(snapshotJson.assumptions)
    ? snapshotJson.assumptions
    : [];

  return assumptions.map((item, index) => {
    if (typeof item === 'string') {
      return {
        ref: `AS-${String(index + 1).padStart(2, '0')}`,
        activityRef: '',
        assumption: item,
      };
    }

    return {
      ref: item?.ref || item?.id || `AS-${String(index + 1).padStart(2, '0')}`,
      activityRef: item?.activityId || item?.activity || '',
      assumption: item?.description || item?.title || item?.text || '—',
    };
  });
}

function getStatus(pctComplete, endDate) {
  if (pctComplete >= 100) return 'complete';
  if (pctComplete > 0) return 'in_progress';
  if (endDate && new Date(endDate) < new Date()) return 'delayed';
  return 'todo';
}

async function generateProjectExport({ projectId, orgId }) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  const [activities, risks, longLead, latestRevision] = await Promise.all([
    prisma.activity.findMany({
      where: { projectId },
      include: {
        progress: {
          where: { status: 'approved' },
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.risk.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'asc' }],
    }),
    prisma.longLeadItem.findMany({
      where: { projectId },
      include: {
        activity: {
          select: {
            id: true,
            name: true,
            wbsCode: true,
            startDate: true,
            endDate: true,
            earlyStart: true,
            earlyFinish: true,
            baselineStart: true,
            baselineFinish: true,
            lateStart: true,
            lateFinish: true,
            isCritical: true,
            totalFloat: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }],
    }),
    prisma.scheduleRevision.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: { snapshotJson: true },
    }),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PMcopilots';
  workbook.created = new Date();
  workbook.modified = new Date();

  const assumptions = parseAssumptions(latestRevision?.snapshotJson || null);

  const scheduleRows = activities.map((activity) => {
    const progress = activity.progress[0] || null;
    const pctComplete = Number(progress?.pctComplete || 0);

    const calendarOptions = {
      calendarId: activity.calendarId || project.projectCalendar,
      projectCalendar: project.projectCalendar,
    };
    const esDate = workingDayToDate(
      project.startDate,
      activity.earlyStart,
      calendarOptions,
    );
    const efDate = workingDayToDate(
      project.startDate,
      activity.earlyFinish,
      calendarOptions,
    );
    const lsDate = workingDayToDate(
      project.startDate,
      activity.lateStart,
      calendarOptions,
    );
    const lfDate = workingDayToDate(
      project.startDate,
      activity.lateFinish,
      calendarOptions,
    );

    return {
      activity,
      row: {
        id: activity.activityCode || activity.p6ActivityId || activity.id,
        activityName: activity.name,
        duration: activity.duration,
        earlyStart: formatDate(esDate),
        earlyFinish: formatDate(efDate),
        lateStart: formatDate(lsDate),
        lateFinish: formatDate(lfDate),
        totalFloat: activity.totalFloat ?? '—',
        critical: activity.isCritical ? 'Yes' : 'No',
        percentComplete: `${pctComplete}%`,
        status: getStatus(pctComplete, activity.endDate),
        wbsCode: activity.wbsCode || '—',
      },
    };
  });

  const masterSheet = workbook.addWorksheet('Master Schedule');
  styleHeaders(masterSheet, [
    { header: 'ID', key: 'id', width: 18 },
    { header: 'Activity Name', key: 'activityName', width: 38 },
    { header: 'Duration (d)', key: 'duration', width: 12 },
    { header: 'Early Start', key: 'earlyStart', width: 14 },
    { header: 'Early Finish', key: 'earlyFinish', width: 14 },
    { header: 'Late Start', key: 'lateStart', width: 14 },
    { header: 'Late Finish', key: 'lateFinish', width: 14 },
    { header: 'Total Float', key: 'totalFloat', width: 12 },
    { header: 'Critical', key: 'critical', width: 10 },
    { header: '% Complete', key: 'percentComplete', width: 12 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'WBS', key: 'wbsCode', width: 16 },
  ]);

  for (const row of scheduleRows) {
    const excelRow = masterSheet.addRow(row.row);
    if (row.activity.isCritical) {
      excelRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFECEC' },
        };
      });
      excelRow.font = { color: { argb: 'FF9B1C1C' } };
    }
  }

  const criticalSheet = workbook.addWorksheet('Critical Path');
  styleHeaders(criticalSheet, [
    { header: 'ID', key: 'id', width: 18 },
    { header: 'Activity Name', key: 'activityName', width: 40 },
    { header: 'Duration (d)', key: 'duration', width: 12 },
    { header: 'Early Start', key: 'earlyStart', width: 14 },
    { header: 'Early Finish', key: 'earlyFinish', width: 14 },
    { header: 'Total Float', key: 'totalFloat', width: 12 },
    { header: '% Complete', key: 'percentComplete', width: 12 },
  ]);

  scheduleRows
    .filter((item) => item.activity.isCritical)
    .forEach((item) => {
      criticalSheet.addRow({
        id: item.row.id,
        activityName: item.row.activityName,
        duration: item.row.duration,
        earlyStart: item.row.earlyStart,
        earlyFinish: item.row.earlyFinish,
        totalFloat: item.row.totalFloat,
        percentComplete: item.row.percentComplete,
      });
    });

  const riskSheet = workbook.addWorksheet('Risks');
  styleHeaders(riskSheet, [
    { header: 'Ref', key: 'ref', width: 12 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Probability', key: 'probability', width: 12 },
    { header: 'Impact', key: 'impact', width: 12 },
    { header: 'Severity', key: 'severity', width: 12 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Mitigation', key: 'mitigation', width: 36 },
    { header: 'Owner', key: 'owner', width: 20 },
  ]);

  risks.forEach((risk) => {
    riskSheet.addRow({
      ref: risk.ref,
      description: risk.description,
      probability: risk.probability,
      impact: risk.impact,
      severity: risk.severity,
      status: risk.status,
      mitigation: risk.mitigation || '—',
      owner: risk.owner || '—',
    });
  });

  const assumptionsSheet = workbook.addWorksheet('Assumptions');
  styleHeaders(assumptionsSheet, [
    { header: 'Ref', key: 'ref', width: 12 },
    { header: 'Activity Ref', key: 'activityRef', width: 16 },
    { header: 'Assumption', key: 'assumption', width: 70 },
  ]);

  assumptions.forEach((assumption) => {
    assumptionsSheet.addRow(assumption);
  });

  const longLeadSheet = workbook.addWorksheet('Long Lead Items');
  styleHeaders(longLeadSheet, [
    { header: 'Item', key: 'item', width: 32 },
    { header: 'Lead Weeks', key: 'leadWeeks', width: 12 },
    { header: 'Buffer Days', key: 'bufferDays', width: 12 },
    { header: 'Need Date', key: 'needDate', width: 14 },
    { header: 'Order By', key: 'orderBy', width: 14 },
    { header: 'Expected Delivery', key: 'expectedDeliveryDate', width: 18 },
    { header: 'Warehouse', key: 'warehouseStatus', width: 16 },
    { header: 'Criticality', key: 'criticality', width: 14 },
    { header: 'Risk Severity', key: 'riskSeverity', width: 14 },
    { header: 'Risk Reason', key: 'riskReason', width: 24 },
    { header: 'Days At Risk', key: 'daysAtRisk', width: 14 },
    { header: 'Risk Note', key: 'risk', width: 22 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Supplier', key: 'supplier', width: 20 },
    { header: 'Activity', key: 'activity', width: 24 },
  ]);

  longLead.forEach((item) => {
    const procurementRisk = computeProcurementRisk(item, { project });
    const needDate = serializeDate(procurementRisk.needDate);
    const orderByDate = serializeDate(procurementRisk.orderByDate);
    const expectedDeliveryDate = serializeDate(
      procurementRisk.expectedDeliveryDate,
    );

    longLeadSheet.addRow({
      item: item.item,
      leadWeeks: item.leadWeeks,
      bufferDays: item.bufferDays,
      needDate: formatDate(needDate),
      orderBy: orderByDate ? formatDate(orderByDate) : item.orderBy || '—',
      expectedDeliveryDate: formatDate(expectedDeliveryDate),
      warehouseStatus: item.warehouseStatus || '—',
      criticality: item.criticality || '—',
      riskSeverity: procurementRisk.severity,
      riskReason: procurementRisk.reason,
      daysAtRisk: procurementRisk.daysAtRisk,
      risk: item.risk || '—',
      status: item.status,
      supplier: item.supplier || '—',
      activity: item.activity?.wbsCode || item.activity?.name || '—',
    });
  });

  const wbsSheet = workbook.addWorksheet('WBS');
  styleHeaders(wbsSheet, [
    { header: 'WBS Code', key: 'wbsCode', width: 22 },
    { header: 'Activity Count', key: 'count', width: 16 },
    { header: 'Total Duration (d)', key: 'duration', width: 18 },
  ]);

  const wbsGroups = activities.reduce((acc, activity) => {
    const code = activity.wbsCode || 'Unassigned';
    if (!acc[code]) {
      acc[code] = { count: 0, duration: 0 };
    }

    acc[code].count += 1;
    acc[code].duration += Number(activity.duration || 0);
    return acc;
  }, {});

  Object.entries(wbsGroups).forEach(([wbsCode, values]) => {
    wbsSheet.addRow({
      wbsCode,
      count: values.count,
      duration: values.duration,
    });
  });

  return {
    workbook,
    filenameBase: project.name || `project-${projectId}`,
  };
}

module.exports = { generateProjectExport };
