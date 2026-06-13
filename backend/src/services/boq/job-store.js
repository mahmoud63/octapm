const JOB_TTL_MS = 2 * 60 * 60 * 1000;
const JOB_CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

const boqJobs = new Map();

const setBoqJob = (jobId, data) => {
  boqJobs.set(jobId, {
    ...boqJobs.get(jobId),
    ...data,
    updatedAt: Date.now(),
  });
};

const getBoqJob = (jobId) => boqJobs.get(jobId) || null;

const pruneBoqJobs = (now = Date.now()) => {
  const cutoff = now - JOB_TTL_MS;
  let removed = 0;
  for (const [id, job] of boqJobs) {
    if (job.updatedAt < cutoff) {
      boqJobs.delete(id);
      removed += 1;
    }
  }
  return removed;
};

const resetBoqJobs = () => {
  boqJobs.clear();
};

const boqJobCleanupTimer = setInterval(
  () => pruneBoqJobs(),
  JOB_CLEANUP_INTERVAL_MS,
);
boqJobCleanupTimer.unref?.();

module.exports = {
  getBoqJob,
  pruneBoqJobs,
  resetBoqJobs,
  setBoqJob,
};
