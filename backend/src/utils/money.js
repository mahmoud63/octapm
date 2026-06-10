const { Prisma } = require('@prisma/client');
const { body } = require('express-validator');
const { HttpError } = require('./http-error');

const MONEY_SCALE = 2;
const MONEY_PRECISION = 18;
const MONEY_MAX = '9999999999999999.99';
const MONEY_MAX_DECIMAL = new Prisma.Decimal(MONEY_MAX);
const NUMERIC_TEXT_RE = /^[-+]?(?:\d+|\d*\.\d+)$/;

const isBlank = (value) =>
  value === undefined || value === null || value === '';

const isPrismaDecimal = (value) =>
  Boolean(
    value &&
      typeof value === 'object' &&
      (Prisma.Decimal.isDecimal?.(value) ||
        (typeof value.toDecimalPlaces === 'function' &&
          typeof value.decimalPlaces === 'function')),
  );

const decimalFrom = (value, fallback = 0) => {
  if (isBlank(value)) return new Prisma.Decimal(fallback);
  if (isPrismaDecimal(value)) return value;

  try {
    return new Prisma.Decimal(value);
  } catch (_error) {
    return new Prisma.Decimal(fallback);
  }
};

const countMeaningfulDecimalPlaces = (value) => {
  if (isPrismaDecimal(value)) {
    return value.decimalPlaces();
  }

  const text = String(value).trim();
  if (!text.includes('.')) return 0;
  const fraction = text.split('.')[1] || '';
  return fraction.replace(/0+$/, '').length;
};

const assertMoneyInput = (
  field,
  value,
  { required = false, min = 0, max = MONEY_MAX } = {},
) => {
  if (isBlank(value)) {
    if (required) {
      throw new HttpError(400, 'VALIDATION_ERROR', `${field} is required`);
    }
    return true;
  }

  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `${field} must be a finite monetary value`,
    );
  }

  if (!isPrismaDecimal(value) && !NUMERIC_TEXT_RE.test(String(value).trim())) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `${field} must be a valid monetary value`,
    );
  }

  if (countMeaningfulDecimalPlaces(value) > MONEY_SCALE) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `${field} must have at most ${MONEY_SCALE} decimal places`,
    );
  }

  const decimal = decimalFrom(value);
  if (decimal.lessThan(min)) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `${field} must be greater than or equal to ${min}`,
    );
  }

  if (max !== null && max !== undefined && decimal.greaterThan(max)) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `${field} exceeds the maximum supported monetary value`,
    );
  }

  return true;
};

const roundMoneyDecimal = (value) =>
  decimalFrom(value).toDecimalPlaces(MONEY_SCALE);

const toMoneyNumber = (value, fallback = 0) => {
  if (isBlank(value)) return fallback;
  return Number(roundMoneyDecimal(value).toString());
};

const toMoneyDecimal = (value, fallback = 0) => roundMoneyDecimal(isBlank(value) ? fallback : value);

const addMoney = (...values) =>
  toMoneyNumber(
    values.reduce(
      (total, value) => total.plus(decimalFrom(value)),
      new Prisma.Decimal(0),
    ),
  );

const subtractMoney = (left, right) =>
  toMoneyNumber(decimalFrom(left).minus(decimalFrom(right)));

const multiplyMoney = (value, factor) =>
  toMoneyNumber(decimalFrom(value).times(decimalFrom(factor)));

const divideMoney = (value, divisor, fallback = 0) => {
  const denominator = decimalFrom(divisor);
  if (denominator.isZero()) return fallback;
  return toMoneyNumber(decimalFrom(value).dividedBy(denominator));
};

const normalizeMoneyTree = (value) => {
  if (isPrismaDecimal(value)) return toMoneyNumber(value);
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(normalizeMoneyTree);
  if (!value || typeof value !== 'object') return value;

  return Object.entries(value).reduce((acc, [key, child]) => {
    acc[key] = normalizeMoneyTree(child);
    return acc;
  }, {});
};

const moneyBody = (
  field,
  { required = false, min = 0, nullable = true } = {},
) => {
  const chain = body(field);
  const guarded = required ? chain : chain.optional({ nullable });
  return guarded
    .custom((value) => assertMoneyInput(field, value, { required, min }))
    .toFloat();
};

module.exports = {
  MONEY_MAX,
  MONEY_PRECISION,
  MONEY_SCALE,
  addMoney,
  assertMoneyInput,
  divideMoney,
  isPrismaDecimal,
  multiplyMoney,
  moneyBody,
  normalizeMoneyTree,
  roundMoneyDecimal,
  subtractMoney,
  toMoneyDecimal,
  toMoneyNumber,
};
