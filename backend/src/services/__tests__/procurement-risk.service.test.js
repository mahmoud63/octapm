const {
  computeProcurementRisk,
  serializeDate,
} = require('../procurement-risk.service');

const project = {
  id: 'project-1',
  startDate: new Date('2026-01-01T00:00:00.000Z'),
};

const activity = {
  id: 'activity-1',
  name: 'Install facade panels',
  wbsCode: 'A.20',
  startDate: new Date('2026-07-10T00:00:00.000Z'),
  endDate: new Date('2026-07-20T00:00:00.000Z'),
  earlyStart: 120,
  earlyFinish: 130,
  baselineStart: null,
  baselineFinish: null,
  lateStart: null,
  lateFinish: null,
  isCritical: false,
  totalFloat: 4,
};

describe('procurement risk calculations', () => {
  test('derives need date from linked activity timing and order-by from lead plus buffer', () => {
    const risk = computeProcurementRisk(
      {
        id: 'll-1',
        activityId: activity.id,
        item: 'Facade panels',
        activity,
        leadWeeks: 4,
        requiredTiming: 'activity_start',
        needOffsetDays: 2,
        bufferDays: 10,
        status: 'ordered',
        expectedDeliveryDate: new Date('2026-07-01T00:00:00.000Z'),
        warehouseStatus: 'not_received',
      },
      { project, today: new Date('2026-05-15T00:00:00.000Z') },
    );

    expect(serializeDate(risk.needDate)).toBe('2026-07-08T00:00:00.000Z');
    expect(serializeDate(risk.orderByDate)).toBe('2026-05-31T00:00:00.000Z');
    expect(risk.severity).toBe('none');
  });

  test('falls back to project start plus CPM offsets when activity date fields are missing', () => {
    const risk = computeProcurementRisk(
      {
        id: 'll-2',
        activityId: activity.id,
        item: 'Switchgear',
        activity: {
          ...activity,
          startDate: null,
          endDate: null,
          earlyStart: 20,
        },
        leadWeeks: 1,
        requiredTiming: 'activity_start',
        needOffsetDays: 5,
        bufferDays: 2,
        status: 'ordered',
        expectedDeliveryDate: new Date('2026-01-14T00:00:00.000Z'),
        warehouseStatus: 'not_received',
      },
      { project, today: new Date('2026-01-05T00:00:00.000Z') },
    );

    expect(serializeDate(risk.needDate)).toBe('2026-01-16T00:00:00.000Z');
    expect(serializeDate(risk.orderByDate)).toBe('2026-01-07T00:00:00.000Z');
  });

  test('flags delivery after a critical activity need date as critical schedule risk', () => {
    const risk = computeProcurementRisk(
      {
        id: 'll-3',
        activityId: activity.id,
        item: 'Tower crane',
        activity: { ...activity, isCritical: true },
        leadWeeks: 8,
        bufferDays: 14,
        status: 'ordered',
        expectedDeliveryDate: new Date('2026-07-15T00:00:00.000Z'),
        warehouseStatus: 'not_received',
      },
      { project, today: new Date('2026-06-01T00:00:00.000Z') },
    );

    expect(risk.reason).toBe('delivery_after_need');
    expect(risk.severity).toBe('critical');
    expect(risk.daysAtRisk).toBe(5);
  });

  test('escalates missed order-by dates after a week without delivery commitment', () => {
    const risk = computeProcurementRisk(
      {
        id: 'll-4',
        activityId: activity.id,
        item: 'Louvers',
        activity,
        leadWeeks: 4,
        bufferDays: 10,
        status: 'not_ordered',
        warehouseStatus: 'not_received',
      },
      { project, today: new Date('2026-06-15T00:00:00.000Z') },
    );

    expect(risk.reason).toBe('order_by_missed');
    expect(risk.severity).toBe('critical');
    expect(risk.daysAtRisk).toBe(13);
  });

  test('warehouse receipt clears delivery slip risk', () => {
    const risk = computeProcurementRisk(
      {
        id: 'll-5',
        activityId: activity.id,
        item: 'Generator',
        activity: { ...activity, isCritical: true },
        leadWeeks: 10,
        bufferDays: 14,
        status: 'delivered',
        expectedDeliveryDate: new Date('2026-07-25T00:00:00.000Z'),
        warehouseStatus: 'received',
      },
      { project, today: new Date('2026-07-12T00:00:00.000Z') },
    );

    expect(risk.reason).toBe('received');
    expect(risk.severity).toBe('none');
    expect(risk.isAtRisk).toBe(false);
  });

  test('uses explicit material required date and PO promised date when present', () => {
    const risk = computeProcurementRisk(
      {
        id: 'po-line-1',
        activityId: activity.id,
        item: 'Rebar couplers',
        activity,
        leadWeeks: 3,
        bufferDays: 7,
        status: 'ordered',
        requiredDate: new Date('2026-06-20T00:00:00.000Z'),
        promisedDate: new Date('2026-06-25T00:00:00.000Z'),
        warehouseStatus: 'not_received',
      },
      { project, today: new Date('2026-06-01T00:00:00.000Z') },
    );

    expect(serializeDate(risk.needDate)).toBe('2026-06-20T00:00:00.000Z');
    expect(serializeDate(risk.orderByDate)).toBe('2026-05-23T00:00:00.000Z');
    expect(serializeDate(risk.expectedDeliveryDate)).toBe(
      '2026-06-25T00:00:00.000Z',
    );
    expect(risk.reason).toBe('delivery_after_need');
    expect(risk.severity).toBe('high');
  });
});
