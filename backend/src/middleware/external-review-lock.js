/**
 * Refuses an edit to a record whose content was formally issued to a
 * consultant and has not been revised since (CONSULTANT V1): the issued
 * revision is not changed silently — the contractor creates a revision on the
 * review first. `param` names the route parameter holding the record id.
 */
const lockIfIssued = (sourceType, param) => (req, _res, next) => {
  require("../services/external-review.service")
    .assertSourceEditable({ projectId: req.params.projectId, sourceType, sourceId: req.params[param] })
    .then(() => next())
    .catch(next);
};

module.exports = { lockIfIssued };
