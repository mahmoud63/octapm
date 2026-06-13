const { Prisma } = require('@prisma/client');
const {
  addMoney,
  assertMoneyInput,
  multiplyMoney,
  normalizeMoneyTree,
  toMoneyNumber,
} = require('../money');

describe('money utilities', () => {
  it('uses decimal arithmetic instead of binary float artifacts', () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(addMoney(19.99, 0.01)).toBe(20);
  });

  it('does not require a generated Prisma Decimal constructor at module load', () => {
    jest.isolateModules(() => {
      jest.doMock('@prisma/client', () => ({
        Prisma: { Decimal: { unavailable: true } },
      }));

      const isolatedMoney = require('../money');
      expect(isolatedMoney.addMoney(0.1, 0.2)).toBe(0.3);
    });
    jest.dontMock('@prisma/client');
  });

  it('rejects monetary input with more than two decimal places', () => {
    expect(() => assertMoneyInput('currentCert', '125.999')).toThrow(
      /at most 2 decimal places/,
    );
  });

  it('normalizes Prisma Decimal values to two-decimal API numbers', () => {
    const payload = normalizeMoneyTree({
      totalCert: new Prisma.Decimal('1000.10'),
      nested: {
        netPayable: new Prisma.Decimal('950.095'),
      },
    });

    expect(payload).toEqual({
      totalCert: 1000.1,
      nested: {
        netPayable: 950.1,
      },
    });
  });

  it('rounds retention and cumulative values to cents', () => {
    const retention = multiplyMoney(12345.67, 0.05);
    const cumulative = addMoney('1000.10', '250.20', '0.30');

    expect(retention).toBe(617.28);
    expect(cumulative).toBe(1250.6);
    expect(toMoneyNumber(retention)).toBe(617.28);
  });
});
