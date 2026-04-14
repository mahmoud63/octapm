const express = require('express');
const { body, param } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { HttpError } = require('../utils/http-error');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { prisma } = require('../config/db');

const router = express.Router({ mergeParams: true });

router.use(authenticate);

function startOfWeekMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeekMonday(date) {
  const end = new Date(startOfWeekMonday(date));
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

function workingDayToDate(projectStartDate, dayOffset) {
  if (!projectStartDate || dayOffset === null || dayOffset === undefined) {
    return null;
  }

  const d = new Date(projectStartDate);
  d.setDate(d.getDate() + Number(dayOffset));
  return d;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { id: req.params.projectId, orgId: req.user.orgId },
    });
    if (!project) {
      throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    const reports = await prisma.weeklyReport.findMany({
      where: { projectId: req.params.projectId },
      orderBy: [{ weekStartDate: 'desc' }, { createdAt: 'desc' }],
    });

    return sendSuccess(res, reports);
  }),
);

router.get(
  '/current',
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { id: req.params.projectId, orgId: req.user.orgId },
    });
    if (!project) {
      throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    const weekStartDate = startOfWeekMonday(new Date());
    const weekEndDate = endOfWeekMonday(new Date());

    let report = await prisma.weeklyReport.findFirst({
      where: {
        projectId: req.params.projectId,
        weekStartDate,
        weekEndDate,
      },
    });

    if (!report) {
      const activities = await prisma.activity.findMany({
        where: { projectId: req.params.projectId },
        include: {
          progress: { orderBy: { updatedAt: 'desc' }, take: 1 },
        },
      });

      const completed = [];
      const inProgress = [];
      let progressSum = 0;
      let plannedCount = 0;

      for (const activity of activities) {
        const pct = Number(activity.progress[0]?.pctComplete || 0);
        progressSum += pct;

        if (pct >= 100) {
          completed.push(activity.id);
        } else if (pct > 0) {
          inProgress.push(activity.id);
        }

        const plannedFinish = workingDayToDate(
          project.startDate,
          activity.earlyFinish,
        );
        if (
          plannedFinish &&
          plannedFinish >= weekStartDate &&
          plannedFinish <= weekEndDate
        ) {
          plannedCount += 1;
        }
      }

      const count = await prisma.weeklyReport.count({
        where: { projectId: req.params.projectId },
      });

      report = await prisma.weeklyReport.create({
        data: {
          projectId: req.params.projectId,
          ref: `WR-${String(count + 1).padStart(2, '0')}`,
          weekStartDate,
          weekEndDate,
          plannedProgress:
            activities.length > 0
              ? Number(((plannedCount / activities.length) * 100).toFixed(1))
              : 0,
          actualProgress:
            activities.length > 0
              ? Number((progressSum / activities.length).toFixed(1))
              : 0,
          activitiesCompleted: completed,
          activitiesInProgress: inProgress,
          status: 'draft',
        },
      });
    }

    return sendSuccess(res, report);
  }),
);

router.post(
  '/',
  requireRoles('pm', 'planning_eng', 'site_engineer'),
  [
    body('weekStartDate').isISO8601(),
    body('weekEndDate').isISO8601(),
    body('plannedProgress').optional().isFloat({ min: 0, max: 100 }),
    body('actualProgress').optional().isFloat({ min: 0, max: 100 }),
    body('weatherDelayDays').optional().isInt({ min: 0 }),
    body('manpowerCount').optional().isInt({ min: 0 }),
    body('status').optional().isIn(['draft', 'submitted', 'approved']),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { id: req.params.projectId, orgId: req.user.orgId },
    });
    if (!project) {
      throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    const count = await prisma.weeklyReport.count({
      where: { projectId: req.params.projectId },
    });

    const report = await prisma.weeklyReport.create({
      data: {
        projectId: req.params.projectId,
        ref: `WR-${String(count + 1).padStart(2, '0')}`,
        weekStartDate: new Date(req.body.weekStartDate),
        weekEndDate: new Date(req.body.weekEndDate),
        preparedBy: req.body.preparedBy || null,
        weatherCondition: req.body.weatherCondition || null,
        weatherDelayDays: Number(req.body.weatherDelayDays || 0),
        plannedProgress: Number(req.body.plannedProgress || 0),
        actualProgress: Number(req.body.actualProgress || 0),
        manpowerCount: Number(req.body.manpowerCount || 0),
        activitiesCompleted: req.body.activitiesCompleted || [],
        activitiesInProgress: req.body.activitiesInProgress || [],
        issuesSummary: req.body.issuesSummary || null,
        nextWeekPlan: req.body.nextWeekPlan || null,
        remarks: req.body.remarks || null,
        status: req.body.status || 'draft',
      },
    });

    return sendSuccess(res, report, 201);
  }),
);

router.patch(
  '/:id',
  requireRoles('pm', 'planning_eng', 'site_engineer'),
  [
    param('id').isUUID(),
    body('weekStartDate').optional().isISO8601(),
    body('weekEndDate').optional().isISO8601(),
    body('plannedProgress').optional().isFloat({ min: 0, max: 100 }),
    body('actualProgress').optional().isFloat({ min: 0, max: 100 }),
    body('weatherDelayDays').optional().isInt({ min: 0 }),
    body('manpowerCount').optional().isInt({ min: 0 }),
    body('status').optional().isIn(['draft', 'submitted', 'approved']),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const existing = await prisma.weeklyReport.findFirst({
      where: {
        id: req.params.id,
        projectId: req.params.projectId,
      },
    });

    if (!existing) {
      throw new HttpError(404, 'NOT_FOUND', 'Report not found');
    }

    const report = await prisma.weeklyReport.update({
      where: { id: req.params.id },
      data: {
        weekStartDate:
          req.body.weekStartDate !== undefined
            ? new Date(req.body.weekStartDate)
            : existing.weekStartDate,
        weekEndDate:
          req.body.weekEndDate !== undefined
            ? new Date(req.body.weekEndDate)
            : existing.weekEndDate,
        preparedBy:
          req.body.preparedBy !== undefined
            ? req.body.preparedBy || null
            : existing.preparedBy,
        weatherCondition:
          req.body.weatherCondition !== undefined
            ? req.body.weatherCondition || null
            : existing.weatherCondition,
        weatherDelayDays:
          req.body.weatherDelayDays !== undefined
            ? Number(req.body.weatherDelayDays)
            : existing.weatherDelayDays,
        plannedProgress:
          req.body.plannedProgress !== undefined
            ? Number(req.body.plannedProgress)
            : existing.plannedProgress,
        actualProgress:
          req.body.actualProgress !== undefined
            ? Number(req.body.actualProgress)
            : existing.actualProgress,
        manpowerCount:
          req.body.manpowerCount !== undefined
            ? Number(req.body.manpowerCount)
            : existing.manpowerCount,
        activitiesCompleted:
          req.body.activitiesCompleted !== undefined
            ? req.body.activitiesCompleted || []
            : existing.activitiesCompleted,
        activitiesInProgress:
          req.body.activitiesInProgress !== undefined
            ? req.body.activitiesInProgress || []
            : existing.activitiesInProgress,
        issuesSummary:
          req.body.issuesSummary !== undefined
            ? req.body.issuesSummary || null
            : existing.issuesSummary,
        nextWeekPlan:
          req.body.nextWeekPlan !== undefined
            ? req.body.nextWeekPlan || null
            : existing.nextWeekPlan,
        remarks:
          req.body.remarks !== undefined
            ? req.body.remarks || null
            : existing.remarks,
        status: req.body.status || existing.status,
      },
    });

    return sendSuccess(res, report);
  }),
);

router.delete(
  '/:id',
  requireRoles('pm'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const existing = await prisma.weeklyReport.findFirst({
      where: {
        id: req.params.id,
        projectId: req.params.projectId,
      },
    });

    if (!existing) {
      throw new HttpError(404, 'NOT_FOUND', 'Report not found');
    }

    await prisma.weeklyReport.delete({ where: { id: req.params.id } });
    return sendSuccess(res, { deleted: true });
  }),
);

module.exports = router;
