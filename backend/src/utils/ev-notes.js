const { EAC_BASES } = require("./eac-basis");

/**
 * The sentences the server gives beside an earned-value figure that is not
 * what it looks like: an index that does not exist yet, an index of 0 and
 * why, and a cutoff that has not been reached. One wording, used by the EV
 * report, the health card and the forecast, so every screen (web and
 * mobile) shows the server's own reason and none paraphrases it.
 *
 * Messages only: no figure is computed here, and none moves.
 */
const EV_NOTES = Object.freeze({
  SPI_UNAVAILABLE:
    "SPI is not available yet: no approved time-phased cost loading through the cutoff, so there is no planned value to measure progress against.",
  CPI_UNAVAILABLE:
    "CPI is not available yet: no official cost-record actuals through the cutoff, so the earned-value estimate at completion falls back to the budget.",
  CPI_UNAVAILABLE_NO_BUDGET:
    "CPI is not available yet: no official cost-record actuals through the cutoff, and no approved budget to earn against.",
  CPI_ZERO:
    "CPI is 0: actual cost has been recorded with no earned value through the cutoff, so budget ÷ CPI cannot be computed and the estimate at completion shows the budget.",
  CPI_ZERO_NO_BUDGET:
    "CPI is 0 because there is no approved budget to earn against: actual cost has been recorded, but with no approved allocation nothing can be earned, so there is no estimate at completion.",
  CUTOFF_NOT_REACHED:
    "This period's cutoff has not been reached; EV and AC are measured through today while PV runs to the cutoff.",
});

/** Why CPI is missing or 0, for the EAC's basis; null when CPI is a real index. */
const cpiNoteFor = ({ cpi, eacBasis }) => {
  const noBudget = eacBasis === EAC_BASES.NO_BUDGET;
  if (cpi === null || cpi === undefined) {
    return noBudget ? EV_NOTES.CPI_UNAVAILABLE_NO_BUDGET : EV_NOTES.CPI_UNAVAILABLE;
  }
  if (Number(cpi) > 0) return null;
  return noBudget ? EV_NOTES.CPI_ZERO_NO_BUDGET : EV_NOTES.CPI_ZERO;
};

/** Why SPI is missing; null when it exists. */
const spiNoteFor = ({ spi }) => (spi === null || spi === undefined ? EV_NOTES.SPI_UNAVAILABLE : null);

/** Whether a cutoff instant is still ahead of `now`. */
const cutoffNotReached = (cutoffDate, now = new Date()) => {
  if (!cutoffDate) return false;
  const at = new Date(cutoffDate).getTime();
  return Number.isFinite(at) && at > new Date(now).getTime();
};

module.exports = { EV_NOTES, cpiNoteFor, spiNoteFor, cutoffNotReached };
