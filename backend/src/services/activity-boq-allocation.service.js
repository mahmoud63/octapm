const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  addMoney,
  multiplyMoney,
  subtractMoney,
  toMoneyNumber,
} = require('../utils/money');
const approvalWorkflowService = require('./approval-workflow.service');

const ACTIVE_STATUSES = ['draft', 'submitted', 'approved'];
const CERTIFIED_IPC_STATUSES = ['certified', 'paid'];
const VALID_SOURCES = ['manual', 'import', 'ai', 'migration'];
const APPROVED_STATUS = 'approved';
const EPSILON = 0.000001;
const MONEY_EPSILON = 0.01;

// Mapping (PC-3). `basis` is which of the three figures the user typed; the
// other two are derived from the item. `mappingRule` lives on the BOQ item
// and says whether the row must be scheduled at all.
const VALID_BASES = ['quantity', 'amount', 'weight'];
const DEFAULT_BASIS = 'amount';
const MAPPING_RULES = ['required', 'optional', 'not_applicable'];
const NOT_APPLICABLE = 'not_applicable';
const OPTIONAL = 'optional';
const SUGGESTION_SOURCES = [
  'ai',
  'rule:code',
  'rule:wbs',
  'rule:location',
  'rule:name',
  'rule:costcode',
  'import',
];
const GROUP_BY_OPTIONS = ['none', 'wbs', 'section', 'location', 'costCode', 'package'];
const PATH_SEPARATOR = '/';
const QUANTITY_SCALE = 1000; // quantities are kept to three decimals

const ensureProject = async ({ orgId, projectId }, tx = prisma) => {
  const project = await tx.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
};

const ensureBoqItem = async ({ projectId, boqItemId }, tx = prisma) => {
  const boqItem = await tx.boqItem.findFirst({
    where: { id: boqItemId, projectId },
    include: {
      wbsNode: { select: { id: true, code: true, path: true } },
      location: { select: { id: true, code: true, name: true, path: true } },
    },
  });

  if (!boqItem) {
    throw new HttpError(404, 'BOQ_ITEM_NOT_FOUND', 'BOQ item not found');
  }

  return boqItem;
};

const ensureActivity = async ({ projectId, activityId }, tx = prisma) => {
  const activity = await tx.activity.findFirst({
    where: { id: activityId, projectId },
    include: {
      wbsNode: { select: { id: true, code: true, path: true } },
      location: { select: { id: true, code: true, name: true, path: true } },
      progressMethod: { select: { method: true, quantityUnit: true } },
    },
  });

  if (!activity) {
    throw new HttpError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found');
  }

  return activity;
};

const ensureAllocation = async ({ projectId, allocationId }, tx = prisma) => {
  const allocation = await tx.activityBoqAllocation.findFirst({
    where: { id: allocationId, projectId },
    include: allocationInclude,
  });

  if (!allocation) {
    throw new HttpError(
      404,
      'ALLOCATION_NOT_FOUND',
      'Activity BOQ allocation not found',
    );
  }

  return allocation;
};

const allocationInclude = {
  boqItem: {
    select: {
      id: true,
      code: true,
      ref: true,
      description: true,
      unit: true,
      unitCode: true,
      qty: true,
      rate: true,
      amount: true,
      section: true,
      sortOrder: true,
      mappingRule: true,
      wbsNodeId: true,
      locationId: true,
      costCodeId: true,
    },
  },
  activity: {
    select: {
      id: true,
      name: true,
      activityCode: true,
      p6ActivityId: true,
      wbsCode: true,
      category: true,
      sortOrder: true,
      wbsNodeId: true,
      locationId: true,
      duration: true,
      startDate: true,
      endDate: true,
    },
  },
  location: {
    select: { id: true, code: true, name: true },
  },
};

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const roundQuantity = (value) =>
  Math.round((toNumber(value) + Number.EPSILON) * QUANTITY_SCALE) / QUANTITY_SCALE;

const isProvided = (value) =>
  value !== undefined && value !== null && value !== '';

const computeDefaultAmount = ({ quantity, amount, boqItem }) => {
  if (isProvided(amount)) {
    return toMoneyNumber(amount);
  }

  return multiplyMoney(quantity, boqItem.rate);
};

const computeDefaultWeight = ({ weight, amount, boqItem }) => {
  if (isProvided(weight)) {
    return toNumber(weight);
  }

  const boqAmount = toNumber(boqItem.amount);
  if (boqAmount <= 0) return 0;
  return (toNumber(amount) / boqAmount) * 100;
};

/**
 * Which figure the user typed. An explicit basis wins; otherwise the first
 * figure present decides, in the order quantity, amount, weight — the order
 * the form asks for them — so a payload with only an amount is an amount
 * allocation and never a zero-quantity one.
 */
const resolveBasis = ({ basis, quantity, amount, weight }) => {
  if (isProvided(basis)) {
    if (!VALID_BASES.includes(basis)) {
      throw new HttpError(
        400,
        'INVALID_ALLOCATION_BASIS',
        'Allocation basis must be quantity, amount or weight',
      );
    }
    return basis;
  }
  if (isProvided(quantity)) return 'quantity';
  if (isProvided(amount)) return 'amount';
  if (isProvided(weight)) return 'weight';
  return null;
};

/**
 * Only the basis figure of a stored row: what the user typed, with the two
 * derived figures left out so a derivation starts from the source figure.
 */
const basisFigures = (row) => {
  const basis = row.basis || DEFAULT_BASIS;
  return {
    quantity: basis === 'quantity' ? row.quantity : undefined,
    amount: basis === 'amount' ? row.amount : undefined,
    weight: basis === 'weight' ? row.weight : undefined,
  };
};

/**
 * The three figures of an allocation from the one that was typed (§4 of the
 * mapping doc). Money is kept to two decimals as Decimal(18,2) would, and
 * quantity to three. A typed figure is never rounded away from what was
 * typed beyond that scale; the derived ones follow the item's rate and
 * amount. When the item has no rate (a lump sum with zero quantity) the
 * quantity cannot be derived from money and stays at what was given.
 */
const deriveFigures = ({ basis, quantity, amount, weight, boqItem }) => {
  const rate = toMoneyNumber(boqItem.rate);
  const itemAmount = toMoneyNumber(boqItem.amount);
  const itemQuantity = toNumber(boqItem.qty);
  const weightOf = (money) => (itemAmount > 0 ? (money / itemAmount) * 100 : 0);

  if (basis === 'quantity') {
    const qty = roundQuantity(quantity);
    const money = isProvided(amount) ? toMoneyNumber(amount) : multiplyMoney(qty, rate);
    return { quantity: qty, amount: money, weight: weightOf(money) };
  }

  if (basis === 'weight') {
    const pct = toNumber(weight);
    const money = multiplyMoney(itemAmount, pct / 100);
    const qty = roundQuantity(itemQuantity * (pct / 100));
    return { quantity: qty, amount: money, weight: pct };
  }

  // amount: the figure EV and IPC read; quantity follows the rate. The
  // division is plain arithmetic rounded to the quantity scale — a money
  // division would round the quantity to two places.
  const money = toMoneyNumber(amount);
  const qty = isProvided(quantity)
    ? roundQuantity(quantity)
    : rate > 0
      ? roundQuantity(money / rate)
      : 0;
  return { quantity: qty, amount: money, weight: weightOf(money) };
};

const getActiveTotalsForBoqItem = async (
  { boqItemId, excludeAllocationId = null, statuses = null },
  tx = prisma,
) => {
  const allocations = await tx.activityBoqAllocation.findMany({
    where: {
      boqItemId,
      isActive: true,
      status: Array.isArray(statuses) ? { in: statuses } : undefined,
      id: excludeAllocationId ? { not: excludeAllocationId } : undefined,
    },
    select: {
      quantity: true,
      amount: true,
    },
  });

  return allocations.reduce(
    (acc, allocation) => {
      acc.quantity += toNumber(allocation.quantity);
      acc.amount = addMoney(acc.amount, allocation.amount);
      return acc;
    },
    { quantity: 0, amount: 0 },
  );
};

const duplicateActiveAllocationError = () =>
  new HttpError(
    400,
    'DUPLICATE_ACTIVE_ALLOCATION',
    'An active allocation already exists for this BOQ item and activity',
  );

const assertAllocationCapacity = ({
  boqItem,
  existingTotals,
  nextQuantity,
  nextAmount,
}) => {
  const totalQuantity = existingTotals.quantity + toNumber(nextQuantity);
  const totalAmount = addMoney(existingTotals.amount, nextAmount);

  if (totalQuantity > toNumber(boqItem.qty) + EPSILON) {
    throw new HttpError(
      400,
      'ALLOCATION_QUANTITY_EXCEEDED',
      'Allocation totals cannot exceed the BOQ item quantity',
      {
        boqItemId: boqItem.id,
        boqQuantity: toNumber(boqItem.qty),
        allocatedQuantity: totalQuantity,
      },
    );
  }

  if (totalAmount > toNumber(boqItem.amount) + MONEY_EPSILON) {
    throw new HttpError(
      400,
      'ALLOCATION_AMOUNT_EXCEEDED',
      'Allocation totals cannot exceed the BOQ item amount',
      {
        boqItemId: boqItem.id,
        boqAmount: toNumber(boqItem.amount),
        allocatedAmount: totalAmount,
      },
    );
  }
};

/**
 * A row whose mapping rule is not_applicable is priced but never progressed
 * (preliminaries, provisional sums, dayworks, contingency): any allocation to
 * it is refused, whatever its source.
 */
const assertMappingRuleAllows = (boqItem) => {
  if ((boqItem.mappingRule || 'required') === NOT_APPLICABLE) {
    throw new HttpError(
      409,
      'MAPPING_NOT_APPLICABLE',
      'This BOQ item is marked not applicable for scheduling and cannot be allocated',
      { boqItemId: boqItem.id, code: boqItem.code || boqItem.ref || null },
    );
  }
};

const isDescendantPath = (candidatePath, ancestorPath) =>
  Boolean(candidatePath) &&
  Boolean(ancestorPath) &&
  (candidatePath === ancestorPath ||
    candidatePath.startsWith(`${ancestorPath}${PATH_SEPARATOR}`));

const ensureLocation = async ({ projectId, locationId }, tx = prisma) => {
  const location = await tx.location.findFirst({
    where: { id: locationId, projectId },
    select: { id: true, code: true, name: true, path: true, status: true },
  });
  if (!location) {
    throw new HttpError(404, 'LOCATION_NOT_FOUND', 'Location not found');
  }
  return location;
};

/**
 * The mapping validation rules of §70-§72 that are warnings rather than
 * refusals. They are computed on every write and on approval, and returned
 * in the response `warnings[]` so a reader sees them without re-running the
 * write. Nothing here throws.
 *
 *   UNIT_MISMATCH        item unitCode ≠ the activity's quantity-method unit
 *   WBS_OUTSIDE_SUBTREE  the activity's WBS node is not the item's or below it
 *   LOCATION_OUTSIDE_SUBTREE  (legacy rows on approve) the allocation's
 *                        location is outside the item's or the activity's
 */
const collectMappingWarnings = ({ boqItem, activity, location = null }) => {
  const warnings = [];

  const method = activity?.progressMethod;
  if (
    method?.method === 'quantity' &&
    boqItem?.unitCode &&
    method.quantityUnit &&
    String(method.quantityUnit).trim().toLowerCase() !== String(boqItem.unitCode).toLowerCase()
  ) {
    warnings.push({
      code: 'UNIT_MISMATCH',
      severity: 'warning',
      message: `BOQ item unit "${boqItem.unitCode}" differs from the activity's quantity unit "${method.quantityUnit}"`,
      details: { itemUnit: boqItem.unitCode, activityUnit: method.quantityUnit },
    });
  }

  if (
    boqItem?.wbsNode?.path &&
    activity?.wbsNode?.path &&
    !isDescendantPath(activity.wbsNode.path, boqItem.wbsNode.path)
  ) {
    warnings.push({
      code: 'WBS_OUTSIDE_SUBTREE',
      severity: 'warning',
      message: `Activity WBS ${activity.wbsNode.code} is outside the BOQ item's WBS node ${boqItem.wbsNode.code}`,
      details: { itemWbsCode: boqItem.wbsNode.code, activityWbsCode: activity.wbsNode.code },
    });
  }

  if (location) {
    const outside = locationOutsideSubtrees({ boqItem, activity, location });
    if (outside) {
      warnings.push({
        code: 'LOCATION_OUTSIDE_SUBTREE',
        severity: 'warning',
        message: outside.message,
        details: outside.details,
      });
    }
  }

  return warnings;
};

/**
 * The location rule (§71): when the allocation names a location and the item
 * (or the activity) has one, the allocation's must be that location or a
 * descendant of it. Returns the breach, or null when there is none.
 */
const locationOutsideSubtrees = ({ boqItem, activity, location }) => {
  if (!location?.path) return null;
  const checks = [
    ['BOQ item', boqItem?.location],
    ['activity', activity?.location],
  ];
  for (const [owner, anchor] of checks) {
    if (anchor?.path && !isDescendantPath(location.path, anchor.path)) {
      return {
        message: `Allocation location "${location.name}" is outside the ${owner}'s location "${anchor.name}"`,
        details: { owner, locationId: location.id, anchorLocationId: anchor.id },
      };
    }
  }
  return null;
};

const assertLocationInSubtrees = ({ boqItem, activity, location }) => {
  const outside = locationOutsideSubtrees({ boqItem, activity, location });
  if (outside) {
    throw new HttpError(
      422,
      'LOCATION_OUTSIDE_SUBTREE',
      outside.message,
      outside.details,
    );
  }
};

const assertNoDuplicateActiveAllocation = async (
  { projectId, boqItemId, activityId, excludeAllocationId = null },
  tx = prisma,
) => {
  const duplicate = await tx.activityBoqAllocation.findFirst({
    where: {
      projectId,
      boqItemId,
      activityId,
      isActive: true,
      id: excludeAllocationId ? { not: excludeAllocationId } : undefined,
    },
  });

  if (duplicate) {
    throw duplicateActiveAllocationError();
  }
};

const handleAllocationWriteError = (error) => {
  if (error?.code !== 'P2002') throw error;

  const target = Array.isArray(error.meta?.target)
    ? error.meta.target
    : [String(error.meta?.target || '')];
  const targetText = target.join(' ').toLowerCase();
  const isActivePair =
    targetText.includes('activityboqallocation_active_pair_key') ||
    (targetText.includes('projectid') &&
      targetText.includes('boqitemid') &&
      targetText.includes('activityid'));

  if (isActivePair) {
    throw duplicateActiveAllocationError();
  }

  throw error;
};

const mapAllocation = (allocation) => ({
  id: allocation.id,
  projectId: allocation.projectId,
  boqItemId: allocation.boqItemId,
  activityId: allocation.activityId,
  quantity: allocation.quantity,
  amount: allocation.amount,
  weight: allocation.weight,
  basis: allocation.basis || DEFAULT_BASIS,
  source: allocation.source,
  status: allocation.status,
  isActive: allocation.isActive,
  notes: allocation.notes,
  locationId: allocation.locationId ?? null,
  unitCode: allocation.unitCode ?? null,
  suggestedBy: allocation.suggestedBy ?? null,
  confidence: allocation.confidence ?? null,
  importBatchId: allocation.importBatchId ?? null,
  supersededByAllocationId: allocation.supersededByAllocationId ?? null,
  submittedBy: allocation.submittedBy,
  submittedAt: allocation.submittedAt,
  approvedBy: allocation.approvedBy,
  approvedAt: allocation.approvedAt,
  rejectedBy: allocation.rejectedBy,
  rejectedAt: allocation.rejectedAt,
  rejectedReason: allocation.rejectedReason,
  createdBy: allocation.createdBy,
  updatedBy: allocation.updatedBy,
  createdAt: allocation.createdAt,
  updatedAt: allocation.updatedAt,
  location: allocation.location
    ? {
        id: allocation.location.id,
        code: allocation.location.code ?? null,
        name: allocation.location.name,
      }
    : null,
  boqItem: allocation.boqItem
    ? {
        id: allocation.boqItem.id,
        code: allocation.boqItem.code || allocation.boqItem.ref || '',
        description: allocation.boqItem.description,
        unit: allocation.boqItem.unit,
        unitCode: allocation.boqItem.unitCode ?? null,
        quantity: allocation.boqItem.qty,
        rate: allocation.boqItem.rate,
        amount: allocation.boqItem.amount,
        section: allocation.boqItem.section ?? null,
        sortOrder: allocation.boqItem.sortOrder,
        mappingRule: allocation.boqItem.mappingRule || 'required',
        wbsNodeId: allocation.boqItem.wbsNodeId ?? null,
        locationId: allocation.boqItem.locationId ?? null,
        costCodeId: allocation.boqItem.costCodeId ?? null,
      }
    : null,
  activity: allocation.activity
    ? {
        id: allocation.activity.id,
        // A single label to show, and the two identifiers behind it kept
        // apart: an imported activity has only a P6 id, one we created has
        // only an activityCode, and a reader reconciling a bill against a
        // programme needs to know which of the two they are holding.
        activityId:
          allocation.activity.activityCode ||
          allocation.activity.p6ActivityId ||
          allocation.activity.id,
        activityCode: allocation.activity.activityCode,
        p6ActivityId: allocation.activity.p6ActivityId ?? null,
        name: allocation.activity.name,
        wbsCode: allocation.activity.wbsCode,
        category: allocation.activity.category,
        sortOrder: allocation.activity.sortOrder,
        wbsNodeId: allocation.activity.wbsNodeId ?? null,
        locationId: allocation.activity.locationId ?? null,
        duration: allocation.activity.duration ?? null,
        startDate: allocation.activity.startDate ?? null,
        endDate: allocation.activity.endDate ?? null,
      }
    : null,
});

const emptyItemTotals = () => ({
  activeQuantity: 0,
  activeAmount: 0,
  approvedQuantity: 0,
  approvedAmount: 0,
  pendingAmount: 0,
  earnedValue: 0,
  allocationCount: 0,
});

/**
 * The mapping state of one row for the coverage counts (§69): n/a rows are
 * their own bucket; the rest read the approved share against the item.
 */
const mappingStateOf = ({ mappingRule, amount, approvedAmount, allocationCount }) => {
  if (mappingRule === NOT_APPLICABLE) return 'not_applicable';
  if (allocationCount === 0) return 'unmapped';
  if (approvedAmount > amount + MONEY_EPSILON) return 'over';
  if (amount - approvedAmount <= MONEY_EPSILON) return 'complete';
  return 'partial';
};

const emptyGroupTotals = (key, label, extra = {}) => ({
  key,
  label,
  ...extra,
  itemCount: 0,
  totalBoqQuantity: 0,
  totalBoqAmount: 0,
  approvedAllocatedQuantity: 0,
  approvedAllocatedAmount: 0,
  pendingAllocatedAmount: 0,
  unallocatedQuantity: 0,
  unallocatedAmount: 0,
  optionalUnallocatedQuantity: 0,
  optionalUnallocatedAmount: 0,
  notApplicableQuantity: 0,
  notApplicableAmount: 0,
  earnedValue: 0,
  certifiedValue: 0,
  coveragePct: 0,
  counts: { unmapped: 0, partial: 0, complete: 0, over: 0, notApplicable: 0 },
});

const addItemToGroup = (group, item) => {
  group.itemCount += 1;
  group.totalBoqQuantity += item.quantity;
  group.totalBoqAmount = addMoney(group.totalBoqAmount, item.amount);
  group.approvedAllocatedQuantity += item.approvedAllocatedQuantity;
  group.approvedAllocatedAmount = addMoney(
    group.approvedAllocatedAmount,
    item.approvedAllocatedAmount,
  );
  group.pendingAllocatedAmount = addMoney(
    group.pendingAllocatedAmount,
    item.pendingAllocatedAmount,
  );
  group.unallocatedQuantity += item.unallocatedQuantity;
  group.unallocatedAmount = addMoney(group.unallocatedAmount, item.unallocatedAmount);
  group.optionalUnallocatedQuantity += item.optionalUnallocatedQuantity;
  group.optionalUnallocatedAmount = addMoney(
    group.optionalUnallocatedAmount,
    item.optionalUnallocatedAmount,
  );
  group.notApplicableQuantity += item.notApplicableQuantity;
  group.notApplicableAmount = addMoney(
    group.notApplicableAmount,
    item.notApplicableAmount,
  );
  group.earnedValue = addMoney(group.earnedValue, item.earnedValue);
  group.certifiedValue = addMoney(group.certifiedValue, item.certifiedValue);
  const stateKey = item.mappingState === 'not_applicable' ? 'notApplicable' : item.mappingState;
  group.counts[stateKey] += 1;
  return group;
};

const finishGroup = (group) => {
  // Coverage is the approved share of what must (or may) be scheduled: the
  // n/a bucket is neither covered nor uncovered.
  const allocatable = subtractMoney(group.totalBoqAmount, group.notApplicableAmount);
  group.allocatableBoqAmount = allocatable;
  group.coveragePct =
    allocatable > MONEY_EPSILON
      ? Math.min(100, (group.approvedAllocatedAmount / allocatable) * 100)
      : group.totalBoqAmount > MONEY_EPSILON
        ? 100
        : 0;
  return group;
};

/**
 * Loads what a group-by needs to label its groups. Only the dimension asked
 * for is read, so the plain summary stays a three-query read.
 */
const loadGroupLabels = async ({ projectId, groupBy }, tx = prisma) => {
  if (groupBy === 'wbs' || groupBy === 'package') {
    const nodes = await tx.wbsNode.findMany({
      where: { projectId },
      select: { id: true, code: true, name: true, path: true, isPackage: true, depth: true, sortOrder: true },
      orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
    });
    return new Map(nodes.map((node) => [node.id, node]));
  }
  if (groupBy === 'location') {
    const locations = await tx.location.findMany({
      where: { projectId },
      select: { id: true, code: true, name: true, path: true, depth: true, sortOrder: true },
      orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    return new Map(locations.map((location) => [location.id, location]));
  }
  if (groupBy === 'costCode') {
    const ids = (
      await tx.boqItem.findMany({
        where: { projectId, isActive: true, costCodeId: { not: null } },
        select: { costCodeId: true },
        distinct: ['costCodeId'],
      })
    ).map((row) => row.costCodeId);
    if (ids.length === 0) return new Map();
    const codes = await tx.costCode.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, name: true },
    });
    return new Map(codes.map((code) => [code.id, code]));
  }
  return new Map();
};

const UNGROUPED = { key: '__none__', label: 'Unassigned' };

/**
 * The group one item falls into for a group-by. A package is the nearest
 * flagged ancestor of the item's WBS node (a flagged node is a work package
 * — there is no separate package entity), read from the node's path.
 */
const groupOfItem = ({ item, groupBy, labels }) => {
  if (groupBy === 'section') {
    const section = (item.section || '').trim();
    return section ? { key: section, label: section } : UNGROUPED;
  }
  if (groupBy === 'wbs') {
    const node = item.wbsNodeId ? labels.get(item.wbsNodeId) : null;
    return node
      ? { key: node.id, label: `${node.code} · ${node.name}`, code: node.code, path: node.path }
      : UNGROUPED;
  }
  if (groupBy === 'location') {
    const location = item.locationId ? labels.get(item.locationId) : null;
    return location
      ? { key: location.id, label: location.code ? `${location.code} · ${location.name}` : location.name, path: location.path }
      : UNGROUPED;
  }
  if (groupBy === 'costCode') {
    const costCode = item.costCodeId ? labels.get(item.costCodeId) : null;
    return costCode
      ? { key: costCode.id, label: `${costCode.code} · ${costCode.name}` }
      : UNGROUPED;
  }
  if (groupBy === 'package') {
    const node = item.wbsNodeId ? labels.get(item.wbsNodeId) : null;
    if (!node) return UNGROUPED;
    const chain = String(node.path || node.id).split(PATH_SEPARATOR).reverse();
    for (const id of chain) {
      const candidate = labels.get(id);
      if (candidate?.isPackage) {
        return { key: candidate.id, label: `${candidate.code} · ${candidate.name}`, code: candidate.code };
      }
    }
    return UNGROUPED;
  }
  return UNGROUPED;
};

/**
 * The certified basis of the coverage figures: IPC lines certified or paid on
 * an approved, active allocation. certifiedValue sums their currentCert; the
 * BOQ item detail (PC-5) counts their qty on the same rows.
 */
const certifiedIpcItemWhere = (projectId) => ({
  projectId,
  allocationId: { not: null },
  status: { in: CERTIFIED_IPC_STATUSES },
  allocation: {
    is: {
      status: 'approved',
      isActive: true,
    },
  },
});

/**
 * The coverage figures (§69). Per item and in total: BOQ amount, allocated
 * (approved / pending), unallocated, not-applicable, earned, certified, and
 * the mapping-state counts. Items whose rule is not_applicable are reported
 * in their own bucket and never as unallocated, so
 *
 *   BOQ total = approved allocated + unallocated + not applicable
 *
 * holds on every project. `groupBy` adds the same figures per WBS node,
 * section, location, cost code or package; `cutoffDate` reads the
 * allocations as they stood on that date (rows created after it are not
 * counted, and a row approved after it counts as pending). `activityIds`,
 * when given (an array), counts only the allocations to those active
 * activities: a rollback to a baselined revision asks what coverage the
 * activities it keeps would carry, before it writes anything.
 */
const buildAllocationSummary = async (
  { projectId, groupBy = 'none', cutoffDate = null, activityIds = null },
  tx = prisma,
) => {
  const group = GROUP_BY_OPTIONS.includes(groupBy) ? groupBy : 'none';
  const cutoff = cutoffDate ? new Date(cutoffDate) : null;
  if (cutoff && Number.isNaN(cutoff.getTime())) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'cutoffDate must be a valid date');
  }

  const [boqItems, allocations, certifiedItems, labels] = await Promise.all([
    tx.boqItem.findMany({
      where: { projectId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        code: true,
        ref: true,
        description: true,
        qty: true,
        amount: true,
        section: true,
        mappingRule: true,
        wbsNodeId: true,
        locationId: true,
        costCodeId: true,
        unitCode: true,
      },
    }),
    tx.activityBoqAllocation.findMany({
      where: {
        projectId,
        isActive: true,
        activity: Array.isArray(activityIds)
          ? { isActive: true, id: { in: activityIds } }
          : { isActive: true },
        ...(cutoff ? { createdAt: { lte: cutoff } } : {}),
      },
      select: {
        boqItemId: true,
        quantity: true,
        amount: true,
        status: true,
        approvedAt: true,
        activity: {
          select: {
            progress: {
              where: { status: 'approved' },
              orderBy: { updatedAt: 'desc' },
              take: 1,
              select: { pctComplete: true },
            },
          },
        },
      },
    }),
    tx.ipcItem.findMany({
      where: certifiedIpcItemWhere(projectId),
      select: {
        boqItemId: true,
        currentCert: true,
      },
    }),
    loadGroupLabels({ projectId, groupBy: group }, tx),
  ]);

  const byBoqItem = new Map();
  for (const allocation of allocations) {
    const current = byBoqItem.get(allocation.boqItemId) || emptyItemTotals();

    const quantity = toNumber(allocation.quantity);
    const amount = toMoneyNumber(allocation.amount);
    current.activeQuantity += quantity;
    current.activeAmount = addMoney(current.activeAmount, amount);
    current.allocationCount += 1;

    // On a cutoff, an approval that came later had not happened yet.
    const approvedByCutoff =
      allocation.status === 'approved' &&
      (!cutoff || !allocation.approvedAt || allocation.approvedAt <= cutoff);

    if (approvedByCutoff) {
      current.approvedQuantity += quantity;
      current.approvedAmount = addMoney(current.approvedAmount, amount);
      const pctComplete = toNumber(
        allocation.activity?.progress?.[0]?.pctComplete,
      );
      current.earnedValue = addMoney(
        current.earnedValue,
        multiplyMoney(amount, Math.min(100, Math.max(0, pctComplete)) / 100),
      );
    } else if (ACTIVE_STATUSES.includes(allocation.status)) {
      current.pendingAmount = addMoney(current.pendingAmount, amount);
    }

    byBoqItem.set(allocation.boqItemId, current);
  }

  const certifiedByBoqItem = certifiedItems.reduce((map, item) => {
    const current = map.get(item.boqItemId) || 0;
    map.set(item.boqItemId, addMoney(current, item.currentCert));
    return map;
  }, new Map());

  const items = boqItems.map((item) => {
    const totals = byBoqItem.get(item.id) || emptyItemTotals();
    const quantity = toNumber(item.qty);
    const amount = toMoneyNumber(item.amount);
    const mappingRule = item.mappingRule || 'required';
    const remainingQuantity = Math.max(0, quantity - totals.approvedQuantity);
    const remainingValue = Math.max(
      0,
      subtractMoney(amount, totals.approvedAmount),
    );
    // What is left of an n/a row is its own bucket, not a gap in coverage.
    const notApplicable = mappingRule === NOT_APPLICABLE;
    const unscheduledQuantity = notApplicable ? 0 : remainingQuantity;
    const unscheduledValue = notApplicable ? 0 : remainingValue;
    // What is left of an optional row stays inside "unallocated" (so BOQ
    // total = allocated + unallocated + n/a still holds) but is reported on
    // its own: readiness warns about it instead of blocking on it (§3).
    const optional = mappingRule === OPTIONAL;
    const optionalUnallocatedQuantity = optional ? remainingQuantity : 0;
    const optionalUnallocatedAmount = optional ? remainingValue : 0;

    return {
      boqItemId: item.id,
      code: item.code || item.ref || '',
      description: item.description,
      section: item.section ?? null,
      mappingRule,
      wbsNodeId: item.wbsNodeId ?? null,
      locationId: item.locationId ?? null,
      costCodeId: item.costCodeId ?? null,
      unitCode: item.unitCode ?? null,
      quantity,
      amount,
      activeAllocatedQuantity: totals.activeQuantity,
      activeAllocatedAmount: totals.activeAmount,
      approvedAllocatedQuantity: totals.approvedQuantity,
      approvedAllocatedAmount: totals.approvedAmount,
      pendingAllocatedAmount: totals.pendingAmount,
      scheduledQuantity: totals.approvedQuantity,
      scheduledValue: totals.approvedAmount,
      unscheduledQuantity,
      unscheduledValue,
      earnedValue: totals.earnedValue,
      certifiedValue: certifiedByBoqItem.get(item.id) || 0,
      unallocatedQuantity: unscheduledQuantity,
      unallocatedAmount: unscheduledValue,
      optionalUnallocatedQuantity,
      optionalUnallocatedAmount,
      notApplicableQuantity: notApplicable ? remainingQuantity : 0,
      notApplicableAmount: notApplicable ? remainingValue : 0,
      allocationCount: totals.allocationCount,
      mappingState: mappingStateOf({
        mappingRule,
        amount,
        approvedAmount: totals.approvedAmount,
        allocationCount: totals.allocationCount,
      }),
    };
  });

  const groups = new Map();
  const summary = items.reduce(
    (acc, item) => {
      acc.totalBoqQuantity += item.quantity;
      acc.totalBoqAmount = addMoney(acc.totalBoqAmount, item.amount);
      acc.activeAllocatedQuantity += item.activeAllocatedQuantity;
      acc.activeAllocatedAmount = addMoney(
        acc.activeAllocatedAmount,
        item.activeAllocatedAmount,
      );
      acc.approvedAllocatedQuantity += item.approvedAllocatedQuantity;
      acc.approvedAllocatedAmount = addMoney(
        acc.approvedAllocatedAmount,
        item.approvedAllocatedAmount,
      );
      acc.pendingAllocatedAmount = addMoney(
        acc.pendingAllocatedAmount,
        item.pendingAllocatedAmount,
      );
      acc.scheduledQuantity += item.scheduledQuantity;
      acc.scheduledValue = addMoney(acc.scheduledValue, item.scheduledValue);
      acc.unscheduledQuantity += item.unscheduledQuantity;
      acc.unscheduledValue = addMoney(
        acc.unscheduledValue,
        item.unscheduledValue,
      );
      acc.earnedValue = addMoney(acc.earnedValue, item.earnedValue);
      acc.certifiedValue = addMoney(acc.certifiedValue, item.certifiedValue);
      acc.unallocatedQuantity += item.unallocatedQuantity;
      acc.unallocatedAmount = addMoney(
        acc.unallocatedAmount,
        item.unallocatedAmount,
      );
      acc.optionalUnallocatedQuantity += item.optionalUnallocatedQuantity;
      acc.optionalUnallocatedAmount = addMoney(
        acc.optionalUnallocatedAmount,
        item.optionalUnallocatedAmount,
      );
      acc.notApplicableQuantity += item.notApplicableQuantity;
      acc.notApplicableAmount = addMoney(
        acc.notApplicableAmount,
        item.notApplicableAmount,
      );
      const stateKey =
        item.mappingState === 'not_applicable' ? 'notApplicable' : item.mappingState;
      acc.counts[stateKey] += 1;
      acc.items.push(item);

      if (group !== 'none') {
        const target = groupOfItem({ item, groupBy: group, labels });
        // The matrix files the row under its group by this key.
        item.groupKey = target.key;
        if (!groups.has(target.key)) {
          groups.set(target.key, emptyGroupTotals(target.key, target.label, {
            code: target.code ?? null,
            path: target.path ?? null,
          }));
        }
        addItemToGroup(groups.get(target.key), item);
      }
      return acc;
    },
    {
      totalBoqQuantity: 0,
      totalBoqAmount: 0,
      activeAllocatedQuantity: 0,
      activeAllocatedAmount: 0,
      approvedAllocatedQuantity: 0,
      approvedAllocatedAmount: 0,
      pendingAllocatedAmount: 0,
      scheduledQuantity: 0,
      scheduledValue: 0,
      unscheduledQuantity: 0,
      unscheduledValue: 0,
      earnedValue: 0,
      certifiedValue: 0,
      unallocatedQuantity: 0,
      unallocatedAmount: 0,
      optionalUnallocatedQuantity: 0,
      optionalUnallocatedAmount: 0,
      notApplicableQuantity: 0,
      notApplicableAmount: 0,
      counts: { unmapped: 0, partial: 0, complete: 0, over: 0, notApplicable: 0 },
      items: [],
    },
  );

  summary.allocatableBoqAmount = subtractMoney(
    summary.totalBoqAmount,
    summary.notApplicableAmount,
  );
  summary.coveragePct =
    summary.allocatableBoqAmount > MONEY_EPSILON
      ? Math.min(100, (summary.approvedAllocatedAmount / summary.allocatableBoqAmount) * 100)
      : summary.totalBoqAmount > MONEY_EPSILON
        ? 100
        : 0;
  summary.groupBy = group;
  summary.cutoffDate = cutoff ? cutoff.toISOString() : null;
  summary.groups = [...groups.values()].map(finishGroup);

  return summary;
};

const listAllocations = async ({
  orgId,
  projectId,
  status,
  boqItemId,
  activityId,
  includeInactive = false,
}) => {
  await ensureProject({ orgId, projectId });

  const where = {
    projectId,
    status: status || undefined,
    boqItemId: boqItemId || undefined,
    activityId: activityId || undefined,
    isActive: includeInactive ? undefined : true,
  };

  const [allocations, summary] = await Promise.all([
    prisma.activityBoqAllocation.findMany({
      where,
      include: allocationInclude,
      orderBy: [
        { boqItem: { sortOrder: 'asc' } },
        { activity: { sortOrder: 'asc' } },
        { createdAt: 'asc' },
      ],
    }),
    buildAllocationSummary({ projectId }),
  ]);

  return {
    allocations: allocations.map(mapAllocation),
    summary,
  };
};

const getCoverage = async ({ orgId, projectId, groupBy = 'none', cutoffDate = null }) => {
  await ensureProject({ orgId, projectId });
  if (groupBy && !GROUP_BY_OPTIONS.includes(groupBy)) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `groupBy must be one of ${GROUP_BY_OPTIONS.join(', ')}`,
    );
  }
  return buildAllocationSummary({ projectId, groupBy, cutoffDate });
};

const assertValidSuggestedBy = (suggestedBy) => {
  if (isProvided(suggestedBy) && !SUGGESTION_SOURCES.includes(suggestedBy)) {
    throw new HttpError(
      400,
      'INVALID_SUGGESTION_SOURCE',
      `suggestedBy must be one of ${SUGGESTION_SOURCES.join(', ')}`,
    );
  }
};

const normaliseConfidence = (confidence) => {
  if (!isProvided(confidence)) return null;
  const value = toNumber(confidence, NaN);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new HttpError(
      400,
      'INVALID_SUGGESTION_CONFIDENCE',
      'confidence must be a number between 0 and 1',
    );
  }
  return value;
};

/**
 * Creates a draft allocation inside an existing transaction. Every rule of
 * §70-§72 that refuses is applied here; the ones that warn are returned in
 * `warnings`. The mapping import and the bulk endpoint share this with the
 * single create so no path can skip a rule.
 */
const createAllocationInTx = async (
  tx,
  { orgId, projectId, userId, payload, importBatchId = null },
) => {
  const boqItem = await ensureBoqItem(
    { projectId, boqItemId: payload.boqItemId },
    tx,
  );
  const activity = await ensureActivity(
    { projectId, activityId: payload.activityId },
    tx,
  );

  assertMappingRuleAllows(boqItem);

  await assertNoDuplicateActiveAllocation(
    {
      projectId,
      boqItemId: payload.boqItemId,
      activityId: payload.activityId,
    },
    tx,
  );

  const basis = resolveBasis(payload);
  if (!basis) {
    throw new HttpError(
      400,
      'INVALID_ALLOCATION_VALUES',
      'Provide an allocation quantity, amount or weight',
    );
  }
  const { quantity, amount, weight } = deriveFigures({
    basis,
    quantity: payload.quantity,
    amount: payload.amount,
    weight: payload.weight,
    boqItem,
  });
  const source = payload.source || 'manual';

  if (quantity <= 0 || amount <= 0) {
    throw new HttpError(
      400,
      'INVALID_ALLOCATION_VALUES',
      'Allocation quantity and amount must be greater than zero',
    );
  }

  if (!VALID_SOURCES.includes(source)) {
    throw new HttpError(
      400,
      'INVALID_ALLOCATION_SOURCE',
      'Allocation source is invalid',
    );
  }
  assertValidSuggestedBy(payload.suggestedBy);
  const confidence = normaliseConfidence(payload.confidence);

  // The location rule blocks on create: a new row is never filed outside the
  // item's or the activity's zone.
  const location = isProvided(payload.locationId)
    ? await ensureLocation({ projectId, locationId: payload.locationId }, tx)
    : null;
  if (location) assertLocationInSubtrees({ boqItem, activity, location });

  const existingTotals = await getActiveTotalsForBoqItem(
    { boqItemId: payload.boqItemId },
    tx,
  );
  assertAllocationCapacity({
    boqItem,
    existingTotals,
    nextQuantity: quantity,
    nextAmount: amount,
  });

  let allocation;
  try {
    allocation = await tx.activityBoqAllocation.create({
      data: {
        projectId,
        boqItemId: payload.boqItemId,
        activityId: payload.activityId,
        quantity,
        amount,
        weight,
        basis,
        source,
        status: 'draft',
        notes: payload.notes?.trim() || null,
        locationId: location?.id ?? null,
        unitCode: boqItem.unitCode ?? null,
        suggestedBy: isProvided(payload.suggestedBy) ? payload.suggestedBy : null,
        confidence,
        importBatchId: importBatchId || null,
        createdBy: userId || null,
        updatedBy: userId || null,
      },
      include: allocationInclude,
    });
  } catch (error) {
    handleAllocationWriteError(error);
  }

  await approvalWorkflowService.recordTransition({
    tx,
    orgId,
    projectId,
    recordType: approvalWorkflowService.RECORD_TYPES.BOQ_ALLOCATION,
    recordId: allocation.id,
    fromStatus: null,
    toStatus: allocation.status,
    actorId: userId,
    metadata: {
      boqItemId: allocation.boqItemId,
      activityId: allocation.activityId,
      quantity,
      amount,
      basis,
      source,
      suggestedBy: allocation.suggestedBy,
      importBatchId: allocation.importBatchId,
    },
  });

  const warnings = collectMappingWarnings({ boqItem, activity });
  return { ...mapAllocation(allocation), warnings };
};

const createAllocation = async ({ orgId, projectId, userId, payload }) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    return createAllocationInTx(tx, { orgId, projectId, userId, payload });
  });

/**
 * Several drafts in one call, each judged on its own: a row that breaks a
 * rule is reported with its code and the others are still created. The
 * matrix's "allocate evenly / by duration / by remaining capacity" sends the
 * rows it computed here.
 */
const createAllocationsBulk = async ({ orgId, projectId, userId, allocations }) => {
  await ensureProject({ orgId, projectId });
  const created = [];
  const failed = [];
  for (const [index, payload] of allocations.entries()) {
    try {
      const allocation = await prisma.$transaction((tx) =>
        createAllocationInTx(tx, { orgId, projectId, userId, payload }),
      );
      created.push(allocation);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      failed.push({
        index,
        boqItemId: payload.boqItemId,
        activityId: payload.activityId,
        code: error.code,
        message: error.message,
        details: error.details ?? null,
      });
    }
  }
  return { created, failed, createdCount: created.length, failedCount: failed.length };
};

const updateAllocation = async ({
  orgId,
  projectId,
  allocationId,
  userId,
  payload,
}) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await ensureAllocation({ projectId, allocationId }, tx);

    if (existing.status !== 'draft') {
      throw new HttpError(
        400,
        'ALLOCATION_NOT_EDITABLE',
        'Only draft allocations can be edited',
      );
    }

    const nextBoqItemId = payload.boqItemId || existing.boqItemId;
    const nextActivityId = payload.activityId || existing.activityId;
    const boqItem = await ensureBoqItem(
      { projectId, boqItemId: nextBoqItemId },
      tx,
    );
    const activity = await ensureActivity(
      { projectId, activityId: nextActivityId },
      tx,
    );
    assertMappingRuleAllows(boqItem);

    await assertNoDuplicateActiveAllocation(
      {
        projectId,
        boqItemId: nextBoqItemId,
        activityId: nextActivityId,
        excludeAllocationId: allocationId,
      },
      tx,
    );

    const figuresChanged =
      payload.quantity !== undefined ||
      payload.amount !== undefined ||
      payload.weight !== undefined ||
      payload.boqItemId !== undefined ||
      payload.basis !== undefined;
    let quantity = toNumber(existing.quantity);
    let amount = toNumber(existing.amount);
    let weight = toNumber(existing.weight);
    let basis = existing.basis || DEFAULT_BASIS;
    if (figuresChanged) {
      // A typed figure moves the basis to itself; re-pointing the row at
      // another item keeps the basis and re-derives from that item. Only
      // what was typed, plus the stored basis figure, feeds the derivation:
      // a stale stored quantity must not survive an amount edit.
      basis =
        resolveBasis({
          basis: payload.basis,
          quantity: payload.quantity,
          amount: payload.amount,
          weight: payload.weight,
        }) || basis;
      const stored = basisFigures({ ...existing, basis });
      const derived = deriveFigures({
        basis,
        quantity: payload.quantity !== undefined ? payload.quantity : stored.quantity,
        amount: payload.amount !== undefined ? payload.amount : stored.amount,
        weight: payload.weight !== undefined ? payload.weight : stored.weight,
        boqItem,
      });
      quantity = derived.quantity;
      amount = derived.amount;
      weight = derived.weight;
    }

    if (quantity <= 0 || amount <= 0) {
      throw new HttpError(
        400,
        'INVALID_ALLOCATION_VALUES',
        'Allocation quantity and amount must be greater than zero',
      );
    }

    if (payload.source && !VALID_SOURCES.includes(payload.source)) {
      throw new HttpError(
        400,
        'INVALID_ALLOCATION_SOURCE',
        'Allocation source is invalid',
      );
    }

    let location;
    if (payload.locationId === null) {
      location = null;
    } else if (isProvided(payload.locationId)) {
      location = await ensureLocation({ projectId, locationId: payload.locationId }, tx);
      assertLocationInSubtrees({ boqItem, activity, location });
    } else {
      location = undefined;
    }

    const existingTotals = await getActiveTotalsForBoqItem(
      { boqItemId: nextBoqItemId, excludeAllocationId: allocationId },
      tx,
    );
    assertAllocationCapacity({
      boqItem,
      existingTotals,
      nextQuantity: quantity,
      nextAmount: amount,
    });

    let updated;
    try {
      updated = await tx.activityBoqAllocation.update({
        where: { id: allocationId },
        data: {
          boqItemId: nextBoqItemId,
          activityId: nextActivityId,
          quantity,
          amount,
          weight,
          basis,
          source: payload.source || existing.source,
          notes:
            payload.notes !== undefined
              ? payload.notes?.trim() || null
              : existing.notes,
          ...(location !== undefined ? { locationId: location?.id ?? null } : {}),
          unitCode: boqItem.unitCode ?? existing.unitCode ?? null,
          updatedBy: userId || null,
        },
        include: allocationInclude,
      });
    } catch (error) {
      handleAllocationWriteError(error);
    }

    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.BOQ_ALLOCATION,
      recordId: allocationId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      metadata: {
        boqItemId: existing.boqItemId,
        activityId: existing.activityId,
        quantity: existing.quantity,
        amount: existing.amount,
      },
    });

    const warnings = collectMappingWarnings({ boqItem, activity });
    return { ...mapAllocation(updated), warnings };
  });

const submitAllocation = async ({ orgId, projectId, allocationId, userId }) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await ensureAllocation({ projectId, allocationId }, tx);

    if (existing.status !== 'draft') {
      throw new HttpError(
        400,
        'INVALID_ALLOCATION_STATUS',
        'Only draft allocations can be submitted',
      );
    }

    await assertNoDuplicateActiveAllocation(
      {
        projectId,
        boqItemId: existing.boqItemId,
        activityId: existing.activityId,
        excludeAllocationId: allocationId,
      },
      tx,
    );

    const updated = await tx.activityBoqAllocation.update({
      where: { id: allocationId },
      data: {
        status: 'submitted',
        submittedBy: userId || null,
        submittedAt: new Date(),
        updatedBy: userId || null,
      },
      include: allocationInclude,
    });

    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.BOQ_ALLOCATION,
      recordId: allocationId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      metadata: {
        boqItemId: existing.boqItemId,
        activityId: existing.activityId,
        quantity: existing.quantity,
        amount: existing.amount,
      },
    });

    return mapAllocation(updated);
  });

const approveAllocation = async ({ orgId, projectId, allocationId, userId }) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await ensureAllocation({ projectId, allocationId }, tx);

    if (existing.status !== 'submitted') {
      throw new HttpError(
        400,
        'INVALID_ALLOCATION_STATUS',
        'Only submitted allocations can be approved',
      );
    }

    await assertNoDuplicateActiveAllocation(
      {
        projectId,
        boqItemId: existing.boqItemId,
        activityId: existing.activityId,
        excludeAllocationId: allocationId,
      },
      tx,
    );

    const boqItem = await ensureBoqItem(
      { projectId, boqItemId: existing.boqItemId },
      tx,
    );
    assertMappingRuleAllows(boqItem);
    const activity = await ensureActivity(
      { projectId, activityId: existing.activityId },
      tx,
    );
    const existingTotals = await getActiveTotalsForBoqItem(
      {
        boqItemId: existing.boqItemId,
        excludeAllocationId: allocationId,
        statuses: [APPROVED_STATUS],
      },
      tx,
    );
    assertAllocationCapacity({
      boqItem,
      existingTotals,
      nextQuantity: existing.quantity,
      nextAmount: existing.amount,
    });

    const updated = await tx.activityBoqAllocation.update({
      where: { id: allocationId },
      data: {
        status: 'approved',
        isActive: true,
        approvedBy: userId || null,
        approvedAt: new Date(),
        rejectedBy: null,
        rejectedAt: null,
        rejectedReason: null,
        updatedBy: userId || null,
      },
      include: allocationInclude,
    });

    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.BOQ_ALLOCATION,
      recordId: allocationId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      metadata: {
        boqItemId: existing.boqItemId,
        activityId: existing.activityId,
        quantity: existing.quantity,
        amount: existing.amount,
      },
    });

    // A legacy row filed before the location rule existed is not refused on
    // approval; it is approved and the breach is reported as a warning.
    const location = existing.locationId
      ? await tx.location.findUnique({
          where: { id: existing.locationId },
          select: { id: true, code: true, name: true, path: true },
        })
      : null;
    const warnings = collectMappingWarnings({ boqItem, activity, location });
    return { ...mapAllocation(updated), warnings };
  });

const rejectAllocation = async ({
  orgId,
  projectId,
  allocationId,
  userId,
  reason,
}) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await ensureAllocation({ projectId, allocationId }, tx);

    if (existing.status !== 'submitted') {
      throw new HttpError(
        400,
        'INVALID_ALLOCATION_STATUS',
        'Only submitted allocations can be rejected',
      );
    }

    if (!String(reason || '').trim()) {
      throw new HttpError(
        400,
        'REJECT_REASON_REQUIRED',
        'A rejection reason is required',
      );
    }

    const updated = await tx.activityBoqAllocation.update({
      where: { id: allocationId },
      data: {
        status: 'rejected',
        isActive: false,
        rejectedBy: userId || null,
        rejectedAt: new Date(),
        rejectedReason: String(reason).trim(),
        updatedBy: userId || null,
      },
      include: allocationInclude,
    });

    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.BOQ_ALLOCATION,
      recordId: allocationId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      reason: String(reason).trim(),
      metadata: {
        boqItemId: existing.boqItemId,
        activityId: existing.activityId,
        quantity: existing.quantity,
        amount: existing.amount,
      },
    });

    return mapAllocation(updated);
  });

/**
 * Sets the mapping rule (§66-§68) on a set of rows — by id, or every active
 * row of a section. Moving a row to not_applicable while it has an approved
 * allocation is refused: the approved row is an official EV basis and must be
 * rejected first. Drafts and submitted rows on such an item are left as they
 * are; they can no longer be approved (approve re-checks the rule).
 */
const setMappingRules = async ({ orgId, projectId, userId, payload }) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const rule = payload.rule;
    if (!MAPPING_RULES.includes(rule)) {
      throw new HttpError(
        400,
        'INVALID_MAPPING_RULE',
        `mappingRule must be one of ${MAPPING_RULES.join(', ')}`,
      );
    }

    const itemIds = Array.isArray(payload.itemIds) ? payload.itemIds.filter(Boolean) : [];
    const section = isProvided(payload.section) ? String(payload.section).trim() : null;
    if (itemIds.length === 0 && !section) {
      throw new HttpError(
        400,
        'VALIDATION_ERROR',
        'Name the BOQ items (itemIds) or a section to apply the rule to',
      );
    }

    // A mapping rule decides what the bill asks to be scheduled, so it is a
    // bill edit and a baselined project refuses it like any other row edit
    // (a comparison revision is the only way in, and it drops the column).
    // boq.service requires this module, so its lock reader is loaded here.
    const { getBoqBaselineLock } = require('./boq.service');
    const baseline = await getBoqBaselineLock(projectId, tx);
    if (baseline.locked) {
      throw new HttpError(
        409,
        'BOQ_BASELINE_LOCKED',
        'BOQ baseline is locked. Mapping rules cannot change on a baselined bill.',
        { baseline },
      );
    }

    const items = await tx.boqItem.findMany({
      where: {
        projectId,
        isActive: true,
        ...(itemIds.length > 0 ? { id: { in: itemIds } } : {}),
        ...(section ? { section: { equals: section, mode: 'insensitive' } } : {}),
      },
      select: { id: true, code: true, ref: true, mappingRule: true },
    });
    if (itemIds.length > 0 && items.length !== itemIds.length) {
      throw new HttpError(404, 'BOQ_ITEM_NOT_FOUND', 'BOQ item not found');
    }

    if (rule === NOT_APPLICABLE && items.length > 0) {
      const approved = await tx.activityBoqAllocation.findMany({
        where: {
          projectId,
          boqItemId: { in: items.map((item) => item.id) },
          isActive: true,
          status: APPROVED_STATUS,
        },
        select: { id: true, boqItemId: true },
      });
      if (approved.length > 0) {
        const blocked = [...new Set(approved.map((row) => row.boqItemId))];
        throw new HttpError(
          409,
          'MAPPING_RULE_HAS_APPROVED_ALLOCATION',
          'An item with an approved allocation cannot be marked not applicable until the allocation is rejected',
          {
            boqItemIds: blocked,
            codes: items
              .filter((item) => blocked.includes(item.id))
              .map((item) => item.code || item.ref || item.id),
            approvedAllocationIds: approved.map((row) => row.id),
          },
        );
      }
    }

    const changed = items.filter((item) => (item.mappingRule || 'required') !== rule);
    if (changed.length > 0) {
      await tx.boqItem.updateMany({
        where: { id: { in: changed.map((item) => item.id) } },
        data: { mappingRule: rule },
      });
    }

    return {
      rule,
      matched: items.length,
      updated: changed.length,
      itemIds: changed.map((item) => item.id),
      updatedBy: userId || null,
    };
  });

/**
 * After the item's rate (or quantity) changed while the bill was unlocked:
 * every draft row is re-derived from its basis so the figures still agree
 * with the item, and every approved row is reported — approved rows are
 * source rows for EV and IPC and are never rewritten here. Nothing is
 * refused; the caller passes the warnings on.
 */
const rederiveAllocationsForBoqItem = async ({ projectId, boqItemId, userId = null }, tx = prisma) => {
  const boqItem = await tx.boqItem.findFirst({
    where: { id: boqItemId, projectId },
    select: { id: true, code: true, ref: true, qty: true, rate: true, amount: true },
  });
  if (!boqItem) return { rederived: [], warnings: [] };

  const rows = await tx.activityBoqAllocation.findMany({
    where: { projectId, boqItemId, isActive: true },
    select: { id: true, status: true, basis: true, quantity: true, amount: true, weight: true, activityId: true },
  });

  const rederived = [];
  const warnings = [];
  for (const row of rows) {
    if (row.status === 'draft') {
      const basis = row.basis || DEFAULT_BASIS;
      const next = deriveFigures({ basis, ...basisFigures(row), boqItem });
      const unchanged =
        Math.abs(next.quantity - toNumber(row.quantity)) < EPSILON &&
        Math.abs(next.amount - toMoneyNumber(row.amount)) < MONEY_EPSILON / 10 &&
        Math.abs(next.weight - toNumber(row.weight)) < EPSILON;
      if (unchanged) continue;
      await tx.activityBoqAllocation.update({
        where: { id: row.id },
        data: { quantity: next.quantity, amount: next.amount, weight: next.weight, updatedBy: userId },
      });
      rederived.push({ allocationId: row.id, basis, before: { quantity: row.quantity, amount: toMoneyNumber(row.amount), weight: row.weight }, after: next });
    } else if (row.status === APPROVED_STATUS || row.status === 'submitted') {
      const basis = row.basis || DEFAULT_BASIS;
      const expected = deriveFigures({ basis, ...basisFigures(row), boqItem });
      const drifted =
        Math.abs(expected.quantity - toNumber(row.quantity)) >= EPSILON ||
        Math.abs(expected.amount - toMoneyNumber(row.amount)) >= MONEY_EPSILON / 10;
      if (!drifted) continue;
      warnings.push({
        code: 'ALLOCATION_RATE_DRIFT',
        severity: 'warning',
        message: `${row.status === APPROVED_STATUS ? 'Approved' : 'Submitted'} allocation on ${boqItem.code || boqItem.ref || boqItemId} no longer agrees with the item's rate and was not rewritten`,
        details: {
          allocationId: row.id,
          activityId: row.activityId,
          status: row.status,
          basis,
          stored: { quantity: row.quantity, amount: toMoneyNumber(row.amount) },
          expected: { quantity: expected.quantity, amount: expected.amount },
        },
      });
    }
  }
  return { rederived, warnings };
};

const getApprovedActivityAllocationTotals = async (
  { projectId, activityIds = null },
  tx = prisma,
) => {
  if (Array.isArray(activityIds) && activityIds.length === 0) {
    return new Map();
  }

  const where = {
    projectId,
    status: 'approved',
    isActive: true,
    activity: { isActive: true },
  };

  if (Array.isArray(activityIds)) {
    where.activityId = { in: activityIds };
  }

  const rows = await tx.activityBoqAllocation.findMany({
    where,
    select: {
      activityId: true,
      quantity: true,
      amount: true,
      weight: true,
    },
  });

  return rows.reduce((map, row) => {
    const current = map.get(row.activityId) || {
      quantity: 0,
      amount: 0,
      weight: 0,
      count: 0,
    };

    current.quantity += toNumber(row.quantity);
    current.amount = addMoney(current.amount, row.amount);
    current.weight += toNumber(row.weight);
    current.count += 1;
    map.set(row.activityId, current);
    return map;
  }, new Map());
};

module.exports = {
  GROUP_BY_OPTIONS,
  MAPPING_RULES,
  SUGGESTION_SOURCES,
  VALID_BASES,
  listAllocations,
  getCoverage,
  createAllocation,
  createAllocationInTx,
  createAllocationsBulk,
  updateAllocation,
  submitAllocation,
  approveAllocation,
  rejectAllocation,
  setMappingRules,
  rederiveAllocationsForBoqItem,
  buildAllocationSummary,
  certifiedIpcItemWhere,
  getApprovedActivityAllocationTotals,
  assertAllocationCapacity,
  assertMappingRuleAllows,
  collectMappingWarnings,
  computeDefaultAmount,
  computeDefaultWeight,
  deriveFigures,
  resolveBasis,
  mapAllocation,
  allocationInclude,
};
