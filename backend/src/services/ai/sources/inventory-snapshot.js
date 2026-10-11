/**
 * Company inventory as OctaPM computes it (AI-7, Inventory): the analytics
 * GET /inventory/analytics returns — stock value by warehouse, low stock,
 * out of stock, overstock, slow-moving and issued value. The AI explains
 * these figures; inventory valuation stays the inventory service's.
 *
 * Only with inventory:read (the inventory routes' own permission), failing
 * closed. Inventory is a company screen, so this is read with the caller's
 * request rather than one project's view.
 */
const { hasPermission } = require("../../../middleware/rbac");

const LIST = 10;
const num = (value, digits = 0) => (value === null || value === undefined ? "—" : Number(value).toLocaleString("en-US", { maximumFractionDigits: digits }));
const fact = (line) => `FACT: ${line}`;
const itemLine = (item) => `${item.sku ? `${item.sku} ` : ""}${item.name}: on hand ${num(item.onHand)} ${item.unit || ""}, reorder level ${num(item.reorderLevel)}, min ${num(item.minStock)}, max ${num(item.maxStock)}, lead time ${item.leadTimeDays ?? "—"} days, value ${num(item.value, 2)}`;

const inventorySources = async ({ req }) => {
  if (!req?.user || !hasPermission(req, "inventory", "read")) return [];
  const analytics = require("../../inventory-analytics.service");
  const data = await analytics.getAnalytics({ orgId: req.user.orgId, projectId: null, projectIds: null });
  const headline = data?.headline || {};
  const lines = [
    fact(`Inventory value ${num(headline.totalValue, 2)} across ${num(headline.warehouseCount)} warehouses and ${num(headline.itemCount)} items; ${num(headline.lowStock)} low stock, ${num(headline.outOfStock)} out of stock, ${num(headline.overstock)} overstock; damaged ${num(headline.damagedValue, 2)}, quarantined ${num(headline.quarantinedValue, 2)}, issued ${num(headline.issuedValue, 2)}`),
    ...(data?.byWarehouse || []).map((warehouse) => fact(`Warehouse ${warehouse.name} (${warehouse.kind}): value ${num(warehouse.value, 2)}, ${warehouse.lines} lines, ${warehouse.share}% of stock value`)),
    ...(data?.outOfStock || []).slice(0, LIST).map((item) => fact(`OUT OF STOCK: ${itemLine(item)}, shortfall ${num(item.shortfall)}`)),
    ...(data?.lowStock || []).slice(0, LIST).map((item) => fact(`LOW STOCK: ${itemLine(item)}, shortfall ${num(item.shortfall)}`)),
    ...(data?.overstock || []).slice(0, LIST).map((item) => fact(`OVERSTOCK: ${itemLine(item)}, excess ${num(item.excess)} (${num(item.excessValue, 2)})`)),
    ...(data?.slowMoving || []).slice(0, 5).map((item) => fact(`SLOW MOVING: ${itemLine(item)}`)),
  ];
  return [{ id: `${req.user.orgId}:inventory`, type: "inventory_facts", typeLabel: "Inventory (OctaPM analytics)", title: "Company inventory", ref: null, status: null, projectId: null, projectName: null, url: null, snippet: null, text: lines.join("\n") }];
};

const ORG_BUILDERS = Object.freeze({ inventory: inventorySources });

/** The company screen's own results (no project), decided on the caller's request. */
const orgModuleSources = async ({ req, moduleKey }) => {
  const build = ORG_BUILDERS[moduleKey];
  return build ? build({ req }) : [];
};

module.exports = { inventorySources, orgModuleSources };
