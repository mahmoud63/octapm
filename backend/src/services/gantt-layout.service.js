const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { normalizeRoleId } = require("../config/permissions");

/**
 * Saved Gantt layouts (the P6 idea of a layout).
 *
 * A layout is a view, not schedule data: timescale, zoom, where the splitter
 * rests, whether the baseline and the resource histogram are shown, and which
 * WBS rows are collapsed. Anyone who can read the schedule can keep their own
 * and share one with the project; nothing here changes the schedule itself,
 * which is why reading the schedule is permission enough to manage them.
 *
 * Visibility follows the report builder's vocabulary so the product has one
 * answer to "who can see this": `private` is the author's own, `project` is
 * everyone who can open the project. There is no org-wide variant — a layout
 * names collapsed rows of one schedule, so it would not travel meaningfully.
 */

const VISIBILITIES = ["private", "project"];
const MAX_NAME = 60;
const MAX_LAYOUT_BYTES = 8_000;

const TIME_SCALES = ["day", "week", "month", "quarter"];
const HISTOGRAM_GROUPS = ["type", "resource"];

const clamp = (value, min, max, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

/**
 * Takes only the fields a layout is allowed to carry, at sane values.
 *
 * The client sends this straight from its own state, so it is untrusted input
 * like anything else: without this a layout could carry arbitrary JSON that
 * every other member of the project would then load.
 */
const normalizeLayout = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "LAYOUT_INVALID", "Layout must be an object");
  }

  const collapsed = Array.isArray(input.collapsed)
    ? input.collapsed
        .filter((id) => typeof id === "string" && id.length <= 200)
        .slice(0, 500)
    : [];

  const layout = {
    timeScale: TIME_SCALES.includes(input.timeScale) ? input.timeScale : "week",
    pxPerDay: clamp(input.pxPerDay, 1, 24, 10),
    gridWidth:
      input.gridWidth === null || input.gridWidth === undefined
        ? null
        : clamp(input.gridWidth, 100, 4000, null),
    showBaseline: Boolean(input.showBaseline),
    showHistogram: Boolean(input.showHistogram),
    histogramGroup: HISTOGRAM_GROUPS.includes(input.histogramGroup)
      ? input.histogramGroup
      : "type",
    collapsed,
  };

  if (JSON.stringify(layout).length > MAX_LAYOUT_BYTES) {
    throw new HttpError(400, "LAYOUT_TOO_LARGE", "Layout is too large to save");
  }

  return layout;
};

const normalizeName = (value) => {
  const name = String(value ?? "").trim();
  if (!name) throw new HttpError(400, "LAYOUT_NAME", "Give the layout a name");
  if (name.length > MAX_NAME) {
    throw new HttpError(400, "LAYOUT_NAME", `Keep the name under ${MAX_NAME} characters`);
  }
  return name;
};

const normalizeVisibility = (value, fallback = "private") => {
  const visibility = value === undefined ? fallback : String(value);
  if (!VISIBILITIES.includes(visibility)) {
    throw new HttpError(400, "LAYOUT_VISIBILITY", "Visibility must be private or project");
  }
  return visibility;
};

const serialize = (row, user) => ({
  id: row.id,
  name: row.name,
  visibility: row.visibility,
  layout: row.layoutJson,
  createdBy: row.createdBy || null,
  ownerName: row.owner?.name || null,
  isOwner: Boolean(user && row.createdBy === user.id),
  canManage: canManage({ user, row }),
  createdAt: row.createdAt?.toISOString() ?? null,
  updatedAt: row.updatedAt?.toISOString() ?? null,
});

/**
 * Who may change or remove a layout: its author, a company admin, or the PM —
 * the same rule the report builder applies to a shared report, so a shared
 * layout is never stranded when the person who made it leaves the project.
 */
const canManage = ({ user, row }) =>
  Boolean(user) &&
  (row.createdBy === user.id ||
    Boolean(user.isCompanyAdmin) ||
    normalizeRoleId(user.role) === "pm");

/** Rows this user may see in this project: their own, plus anything shared. */
const visibleWhere = ({ orgId, projectId, user }) => ({
  orgId,
  projectId,
  OR: [{ createdBy: user.id }, { visibility: "project" }],
});

/** The author's name, for "shared by" in the menu. */
const withOwner = async (rows) => {
  const ids = [...new Set(rows.map((row) => row.createdBy).filter(Boolean))];
  if (!ids.length) return rows;
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const byId = new Map(users.map((user) => [user.id, user]));
  return rows.map((row) => ({ ...row, owner: byId.get(row.createdBy) || null }));
};

const listLayouts = async ({ orgId, projectId, user }) => {
  const rows = await prisma.ganttLayout.findMany({
    where: visibleWhere({ orgId, projectId, user }),
    orderBy: [{ name: "asc" }],
  });
  return { items: (await withOwner(rows)).map((row) => serialize(row, user)) };
};

const getRow = async ({ orgId, projectId, user, layoutId }) => {
  const row = await prisma.ganttLayout.findFirst({
    where: { ...visibleWhere({ orgId, projectId, user }), id: layoutId },
  });
  if (!row) throw new HttpError(404, "LAYOUT_NOT_FOUND", "Layout not found");
  return row;
};

/**
 * Saves under a name. Saving again with the same name updates the author's own
 * layout rather than making a second one — the unique index on
 * (projectId, createdBy, name) is what makes that safe under a race.
 */
const saveLayoutFor = async ({ orgId, projectId, user, payload = {} }) => {
  const name = normalizeName(payload.name);
  const layout = normalizeLayout(payload.layout);
  const visibility = normalizeVisibility(payload.visibility);

  const existing = await prisma.ganttLayout.findFirst({
    where: { projectId, createdBy: user.id, name },
  });

  const row = existing
    ? await prisma.ganttLayout.update({
        where: { id: existing.id },
        data: { layoutJson: layout, visibility, updatedBy: user.id },
      })
    : await prisma.ganttLayout.create({
        data: {
          orgId,
          projectId,
          name,
          visibility,
          layoutJson: layout,
          createdBy: user.id,
          updatedBy: user.id,
        },
      });

  return serialize({ ...row, owner: { name: user.name } }, user);
};

const updateLayout = async ({ orgId, projectId, user, layoutId, payload = {} }) => {
  const row = await getRow({ orgId, projectId, user, layoutId });
  if (!canManage({ user, row })) {
    throw new HttpError(403, "LAYOUT_FORBIDDEN", "This layout belongs to someone else");
  }

  const data = { updatedBy: user.id };
  if (payload.name !== undefined) data.name = normalizeName(payload.name);
  if (payload.layout !== undefined) data.layoutJson = normalizeLayout(payload.layout);
  if (payload.visibility !== undefined) {
    data.visibility = normalizeVisibility(payload.visibility, row.visibility);
  }

  const updated = await prisma.ganttLayout.update({ where: { id: row.id }, data });
  return serialize(updated, user);
};

const deleteLayout = async ({ orgId, projectId, user, layoutId }) => {
  const row = await getRow({ orgId, projectId, user, layoutId });
  if (!canManage({ user, row })) {
    throw new HttpError(403, "LAYOUT_FORBIDDEN", "This layout belongs to someone else");
  }
  await prisma.ganttLayout.delete({ where: { id: row.id } });
  return { id: row.id };
};

module.exports = {
  VISIBILITIES,
  canManage,
  deleteLayout,
  listLayouts,
  normalizeLayout,
  saveLayoutFor,
  updateLayout,
};
