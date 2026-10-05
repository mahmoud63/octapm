/**
 * The equipment lines a daily report and a site diary take (CERT-2, trivial-7).
 *
 * HOURS. A line's hours are what one line carries, and a line is not one
 * machine's day: the web progress tab sends the day's equipment hours as ONE
 * line, { name: 'site equipment', hours } (frontend progress-tab.tsx,
 * createDailyReport), with no maximum of its own, and the site-reporting
 * form's lines have none either. Round 6 bounded a line at a day (0-24),
 * which refused that form at 30 or 48 hours (400; 201 at f16c14f). A line is
 * bounded at a month of round-the-clock running instead, 24 x 31 = 744 hours:
 * finite, and past any day's total a form takes. What the hours can overflow
 * is the cost the approval writes (hours x rate, a Decimal(18,2)): that is
 * checked on the line's own rate below.
 *
 * RATE. A line may carry its own rate and rateType, which the approval
 * prefers to the project equipment's (equipment.service
 * normalizeDailyReportEquipmentLines: row.rate ?? equipment.rate, row.rateType
 * || equipment.rateType). Both were stored unchecked: a rate of -500 was
 * stored and its approval posted a cost of -1,000.00; 1e30 was stored and its
 * approval refused for ever at the write; rateType 'weekly' was stored (the
 * approval read it as hourly). A rate is now one figure, 0 to
 * MONEY_FIGURE_MAX; a rateType 'hourly' or 'daily'; and a line's own rate
 * times its hours (a daily rate per eight hours, as the approval prices it)
 * must be a cost the approval can write, or the line is refused 400 naming
 * its rate before anything is stored. A null rate or rateType is the
 * equipment's, as it always was.
 */
const { body } = require('express-validator');
const { scalarFigure, MONEY_FIGURE_MAX } = require('./figure-input');
const { multiplyMoney, toMoneyNumber } = require('./money');

const EQUIPMENT_LINE_HOURS_MAX = 24 * 31;
const EQUIPMENT_RATE_TYPES = ['hourly', 'daily'];
// equipment.service DAY_RATE_HOURS: a daily rate is charged per eight hours.
const DAY_RATE_HOURS = 8;

const LINE_RATE_PATH = /^equipment\[(\d+)\]\.rate$/;

/**
 * The cost the approval would write for a line priced at its own rate, as the
 * approval computes it (toMoneyNumber, multiplyMoney): a line without hours,
 * or whose hours are refused by their own check, has none to compare.
 */
const lineCost = ({ rate, hours, rateType }) => {
  const numericHours = Math.max(0, Number(hours) || 0);
  const price = toMoneyNumber(rate);
  return rateType === 'daily'
    ? multiplyMoney(price, numericHours / DAY_RATE_HOURS)
    : multiplyMoney(price, numericHours);
};

/** For equipment.*.rate, after the figure checks: the line's own cost fits. */
const lineCostFits = (rate, { req, path }) => {
  const index = LINE_RATE_PATH.exec(String(path || ''))?.[1];
  const line = index === undefined ? null : req.body?.equipment?.[Number(index)];
  if (!line || typeof line !== 'object') return true;
  // Without a rateType of its own the line is priced as the approval prices an
  // unmatched one (hourly): the larger of the two, so what passes here fits
  // whichever the equipment turns out to be.
  const rateType = line.rateType === 'daily' ? 'daily' : 'hourly';
  const cost = lineCost({ rate, hours: line.hours, rateType });
  if (!Number.isFinite(cost) || Math.abs(cost) > MONEY_FIGURE_MAX) {
    throw new Error('rate x hours is more than a cost can record');
  }
  return true;
};

/** The three equipment line figures, for a router's payload validators. */
const equipmentLineValidators = () => [
  body('equipment.*.hours').optional().custom(scalarFigure).bail().isFloat({ min: 0, max: EQUIPMENT_LINE_HOURS_MAX }).toFloat(),
  body('equipment.*.rateType').optional({ nullable: true }).isString().bail().isIn(EQUIPMENT_RATE_TYPES),
  body('equipment.*.rate')
    .optional({ nullable: true })
    .custom(scalarFigure)
    .bail()
    .isFloat({ min: 0, max: MONEY_FIGURE_MAX })
    .bail()
    .toFloat()
    .custom(lineCostFits),
];

module.exports = {
  EQUIPMENT_LINE_HOURS_MAX,
  EQUIPMENT_RATE_TYPES,
  equipmentLineValidators,
  lineCost,
  lineCostFits,
};
