const express = require('express');
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  listNcrs,
  createNcr,
  updateNcr,
  deleteNcr,
} = require('../services/ncr.service');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get('/', requirePermission('ncr', 'read'), async (req, res, next) => {
  try {
    const data = await listNcrs({
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
  requirePermission('ncr', 'create'),
  [
    body('severity').optional().isIn(['major', 'minor']),
    body('status').optional().isIn(['open', 'closed']),
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
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createNcr({
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
  '/:ncrId',
  requirePermission('ncr', 'update'),
  [
    param('ncrId').isUUID(),
    body('severity').optional().isIn(['major', 'minor']),
    body('status').optional().isIn(['open', 'closed']),
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
    body('closedDate').optional({ nullable: true }).isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateNcr({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        ncrId: req.params.ncrId,
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
  '/:ncrId',
  requirePermission('ncr', 'delete'),
  [param('ncrId').isUUID(), validate],
  async (req, res, next) => {
    try {
      const data = await deleteNcr({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        ncrId: req.params.ncrId,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
