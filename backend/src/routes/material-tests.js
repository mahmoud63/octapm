const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const {
  listMaterialTests,
  createMaterialTest,
  updateMaterialTest,
  deleteMaterialTest,
} = require('../services/material-test.service');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const data = await listMaterialTests({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });

    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.post(
  '/',
  [
    body('testType').trim().notEmpty(),
    body('result').optional().isIn(['pass', 'fail', 'pending']),
    body('owner').optional().isString().trim(),
    body('reviewer').optional().isString().trim(),
    body('approver').optional().isString().trim(),
    body('activityId').optional({ nullable: true }).isUUID(),
    body('activityIds').optional().isArray(),
    body('activityIds.*').optional().isUUID(),
    body('activityLinks').optional().isArray(),
    body('activityLinks.*.activityId').optional().isUUID(),
    body('attachments').optional().isArray(),
    body('attachmentRefs').optional().isArray(),
    body('comment').optional().isString().trim(),
    body('statusComment').optional().isString().trim(),
    body('dueDate').optional({ nullable: true }).isISO8601(),
    body('testDate').optional({ nullable: true }).isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createMaterialTest({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        payload: req.body,
        userId: req.user.id,
        userRole: req.user.role,
      });

      return res.status(201).json({ success: true, data: row });
    } catch (error) {
      return next(error);
    }
  },
);

router.patch(
  '/:testId',
  [
    param('testId').isUUID(),
    body('result').optional().isIn(['pass', 'fail', 'pending']),
    body('owner').optional().isString().trim(),
    body('reviewer').optional().isString().trim(),
    body('approver').optional().isString().trim(),
    body('activityId').optional({ nullable: true }).isUUID(),
    body('activityIds').optional().isArray(),
    body('activityIds.*').optional().isUUID(),
    body('activityLinks').optional().isArray(),
    body('activityLinks.*.activityId').optional().isUUID(),
    body('attachments').optional().isArray(),
    body('attachmentRefs').optional().isArray(),
    body('comment').optional().isString().trim(),
    body('statusComment').optional().isString().trim(),
    body('dueDate').optional({ nullable: true }).isISO8601(),
    body('testDate').optional({ nullable: true }).isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateMaterialTest({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        testId: req.params.testId,
        payload: req.body,
        userId: req.user.id,
        userRole: req.user.role,
      });

      return res.json({ success: true, data: row });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  '/:testId',
  [param('testId').isUUID(), validate],
  async (req, res, next) => {
    try {
      const data = await deleteMaterialTest({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        testId: req.params.testId,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
