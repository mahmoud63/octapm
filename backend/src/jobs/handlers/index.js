const { JOB_TYPES } = require("../job.service");
const { registerJobHandler } = require("../worker");

/**
 * Registers every job handler. Services are required lazily so that this
 * module can be loaded before the (large) service modules and to avoid
 * circular imports between services and the worker.
 */
const registerAllHandlers = () => {
  registerJobHandler(JOB_TYPES.SCHEDULE_GENERATE, (context) =>
    require("../../services/schedule.service").runScheduleGenerationJob(context),
  );
  registerJobHandler(JOB_TYPES.BOQ_PARSE, (context) =>
    require("../../services/boq.service").runBoqActivityJob(context),
  );
  registerJobHandler(JOB_TYPES.PHOTO_THUMBNAIL, (context) =>
    require("../../services/attachment.service").runPhotoThumbnailJob(context),
  );
};

module.exports = { registerAllHandlers };
