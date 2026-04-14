const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const {
  listSubmittals,
  createSubmittal,
  updateSubmittal,
  deleteSubmittal,
} = require('../services/submittal.service');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const data = await listSubmittals({
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
    body('title').trim().notEmpty(),
    body('status')
      .optional()
      .isIn(['pending', 'under_review', 'approved', 'resubmit', 'rejected']),
    body('submittedOn').optional().isISO8601(),
    body('dueDate').optional().isISO8601(),
    body('reviewedOn').optional().isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createSubmittal({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        payload: req.body,
      });

      return res.status(201).json({ success: true, data: row });
    } catch (error) {
      return next(error);
    }
  },
);

router.patch(
  '/:submittalId',
  [
    param('submittalId').isUUID(),
    body('status')
      .optional()
      .isIn(['pending', 'under_review', 'approved', 'resubmit', 'rejected']),
    body('submittedOn').optional().isISO8601(),
    body('dueDate').optional().isISO8601(),
    body('reviewedOn').optional().isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateSubmittal({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        submittalId: req.params.submittalId,
        payload: req.body,
      });

      return res.json({ success: true, data: row });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  '/:submittalId',
  [param('submittalId').isUUID(), validate],
  async (req, res, next) => {
    try {
      const data = await deleteSubmittal({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        submittalId: req.params.submittalId,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
