/**
 * The most days a schedule figure may name (CERT-2, trivial-7): an activity's
 * duration, its early and late day offsets and its float, a dependency's lag
 * (either way) — 36,500 days, a hundred years.
 *
 * The routes took each up to INT4_MAX (2,147,483,647). An activity's dates are
 * worked out from its day offsets on every read and inside every PATCH's
 * critical-path pass (cpm.service workingDayToDate), which walked one day at a
 * time: a duration of 1,000,000 working days held the PATCH's transaction for
 * eight seconds and answered 500, and past about 71 million days the date
 * walked off what a Date holds and the walk never ended. The conversion now
 * works in whole weeks and ends on any input; this bound is the door's: a
 * figure past a hundred years is no programme. The activity routes refuse
 * more (400 VALIDATION_ERROR naming the field), and so does a schedule import
 * (XER, P6 XML, MSP XML, xlsx: import.service) for the durations, float and
 * lags a file carries.
 */
const SCHEDULE_DAYS_MAX = 36_500;

module.exports = { SCHEDULE_DAYS_MAX };
