const { prisma } = require('../config/db');
const { assertProjectRows } = require('./tenant-references.service');

const ACTIVITY_LIST_FIELDS = ['activitiesCompleted', 'activitiesInProgress'];

/**
 * A weekly report's activity lists name activities of the report's own
 * project (CERT-2 isolation sweep: another company's activity id was stored
 * on the report as given). Every id a list states must be an activity of this
 * project; another company's activity and an id that exists nowhere get the
 * same 404 ACTIVITY_NOT_FOUND, before anything is written. The route checks
 * that each list is an array of UUIDs.
 */
const assertReportActivities = async ({ projectId, payload = {}, tx = prisma }) => {
  for (const field of ACTIVITY_LIST_FIELDS) {
    const ids = payload[field];
    if (ids === undefined || ids === null) continue;
    await assertProjectRows({
      tx,
      model: 'activity',
      projectId,
      ids,
      code: 'ACTIVITY_NOT_FOUND',
      message: 'Activity not found',
    });
  }
};

module.exports = { ACTIVITY_LIST_FIELDS, assertReportActivities };
