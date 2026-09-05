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
  registerJobHandler(JOB_TYPES.DOCUMENT_EXTRACT, (context) =>
    require("../../services/document-text.service").runDocumentExtractJob(context),
  );
  registerJobHandler(JOB_TYPES.DRAWING_SET_PROCESS, (context) =>
    require("../../services/drawing-set.service").runDrawingSetJob(context),
  );
  registerJobHandler(JOB_TYPES.DAILY_LOG_WEATHER, (context) =>
    require("../../services/daily-log.service").runWeatherJob(context),
  );
  registerJobHandler(JOB_TYPES.DAILY_LOG_DISTRIBUTE, (context) =>
    require("../../services/daily-log.service").runDistributeJob(context),
  );
  registerJobHandler(JOB_TYPES.REPORT_RENDER, (context) =>
    require("../../services/report-builder.service").runReportRenderJob(context),
  );
  registerJobHandler(JOB_TYPES.PORTFOLIO_REFRESH, (context) =>
    require("../../services/portfolio.service").runPortfolioRefreshJob(context),
  );
};

module.exports = { registerAllHandlers };
