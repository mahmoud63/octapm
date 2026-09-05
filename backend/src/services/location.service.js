const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const auditService = require("./audit.service");

/**
 * Project location tree (site > building > level > zone > room ...).
 *
 * Locations are the spatial key every field record (punch items, inspections,
 * observations, photos, daily entries) references. The tree is stored with a
 * materialized path of ids (`rootId/childId/grandchildId`) so subtree queries
 * are a single prefix match and moves only rewrite the affected subtree.
 */

const LOCATION_STATUSES = Object.freeze({
  ACTIVE: "active",
  ARCHIVED: "archived",
});

const LOCATION_KINDS = Object.freeze([
  "site",
  "building",
  "level",
  "zone",
  "room",
  "area",
  "external",
]);

const MAX_DEPTH = 8;
const PATH_SEPARATOR = "/";

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const toIso = (value) => value?.toISOString?.() || value || null;

const ensureProject = async ({ tx = prisma, orgId, projectId }) => {
  const project = await tx.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true, orgId: true },
  });

  if (!project) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  }

  return project;
};

const normalizeKind = (value, fallback = "area") => {
  const kind = trimOrNull(value)?.toLowerCase() || fallback;
  if (!LOCATION_KINDS.includes(kind)) {
    throw new HttpError(
      400,
      "LOCATION_KIND_INVALID",
      `Location kind must be one of: ${LOCATION_KINDS.join(", ")}`,
    );
  }
  return kind;
};

const normalizeName = (value) => {
  const name = trimOrNull(value);
  if (!name) {
    throw new HttpError(
      400,
      "LOCATION_NAME_REQUIRED",
      "Location name is required",
    );
  }
  if (name.length > 120) {
    throw new HttpError(
      400,
      "LOCATION_NAME_TOO_LONG",
      "Location name must be 120 characters or fewer",
    );
  }
  return name;
};

const normalizeCode = (value) => {
  const code = trimOrNull(value);
  if (code && code.length > 40) {
    throw new HttpError(
      400,
      "LOCATION_CODE_TOO_LONG",
      "Location code must be 40 characters or fewer",
    );
  }
  return code ? code.toUpperCase() : null;
};

const isDescendantPath = (candidatePath, ancestorPath) =>
  candidatePath === ancestorPath ||
  candidatePath.startsWith(`${ancestorPath}${PATH_SEPARATOR}`);

const serializeLocation = (location, { childCount = 0, pathNames = [] } = {}) => ({
  id: location.id,
  projectId: location.projectId,
  parentId: location.parentId || null,
  name: location.name,
  code: location.code || null,
  kind: location.kind,
  path: location.path,
  pathNames,
  fullName: pathNames.length ? pathNames.join(" › ") : location.name,
  depth: location.depth,
  sortOrder: location.sortOrder,
  status: location.status,
  description: location.description || null,
  childCount,
  createdBy: location.createdBy || null,
  updatedBy: location.updatedBy || null,
  archivedAt: toIso(location.archivedAt),
  archivedBy: location.archivedBy || null,
  createdAt: toIso(location.createdAt),
  updatedAt: toIso(location.updatedAt),
});

const locationSummary = (location) => ({
  name: location.name,
  code: location.code || null,
  kind: location.kind,
  parentId: location.parentId || null,
  path: location.path,
  depth: location.depth,
  sortOrder: location.sortOrder,
  status: location.status,
});

const compareSiblings = (a, b) =>
  a.sortOrder - b.sortOrder ||
  a.name.localeCompare(b.name) ||
  String(a.id).localeCompare(String(b.id));

/**
 * Builds ordered flat rows (depth-first, sibling order respected) and a nested
 * tree from a list of location rows belonging to one project.
 */
const buildTree = (rows) => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const childrenOf = new Map();

  for (const row of rows) {
    const parentKey = row.parentId && byId.has(row.parentId) ? row.parentId : null;
    if (!childrenOf.has(parentKey)) childrenOf.set(parentKey, []);
    childrenOf.get(parentKey).push(row);
  }

  for (const siblings of childrenOf.values()) siblings.sort(compareSiblings);

  const flat = [];
  const visit = (parentKey, ancestors) => {
    const siblings = childrenOf.get(parentKey) || [];
    return siblings.map((row) => {
      const pathNames = [...ancestors, row.name];
      const childCount = (childrenOf.get(row.id) || []).length;
      const serialized = serializeLocation(row, { childCount, pathNames });
      flat.push(serialized);
      return { ...serialized, children: visit(row.id, pathNames) };
    });
  };

  const tree = visit(null, []);
  return { flat, tree };
};

const listLocations = async ({ orgId, projectId, query = {} }) => {
  await ensureProject({ orgId, projectId });

  const where = { projectId };
  if (!query.includeArchived) where.status = LOCATION_STATUSES.ACTIVE;

  const rows = await prisma.location.findMany({
    where,
    orderBy: [{ depth: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });

  const { flat, tree } = buildTree(rows);
  const maxDepth = rows.reduce((max, row) => Math.max(max, row.depth), -1);

  return {
    items: flat,
    tree,
    summary: {
      total: rows.length,
      active: rows.filter((row) => row.status === LOCATION_STATUSES.ACTIVE)
        .length,
      archived: rows.filter((row) => row.status === LOCATION_STATUSES.ARCHIVED)
        .length,
      roots: tree.length,
      maxDepth: maxDepth + 1,
    },
  };
};

const findLocation = async ({ tx = prisma, projectId, locationId }) => {
  const location = await tx.location.findFirst({
    where: { id: locationId, projectId },
  });

  if (!location) {
    throw new HttpError(404, "LOCATION_NOT_FOUND", "Location not found");
  }

  return location;
};

const resolveParent = async ({ tx, projectId, parentId }) => {
  if (!parentId) return null;
  const parent = await tx.location.findFirst({
    where: { id: parentId, projectId },
  });

  if (!parent) {
    throw new HttpError(
      400,
      "LOCATION_PARENT_INVALID",
      "Parent location does not belong to this project",
    );
  }
  if (parent.status !== LOCATION_STATUSES.ACTIVE) {
    throw new HttpError(
      409,
      "LOCATION_PARENT_ARCHIVED",
      "Cannot place a location under an archived parent",
    );
  }
  if (parent.depth + 1 >= MAX_DEPTH) {
    throw new HttpError(
      400,
      "LOCATION_DEPTH_EXCEEDED",
      `Location tree depth is limited to ${MAX_DEPTH} levels`,
    );
  }

  return parent;
};

const assertUniqueSiblingName = async ({
  tx,
  projectId,
  parentId,
  name,
  excludeId = null,
}) => {
  const duplicate = await tx.location.findFirst({
    where: {
      projectId,
      parentId: parentId || null,
      name: { equals: name, mode: "insensitive" },
      status: LOCATION_STATUSES.ACTIVE,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new HttpError(
      409,
      "LOCATION_DUPLICATE_NAME",
      "A location with this name already exists at the same level",
    );
  }
};

const assertUniqueCode = async ({ tx, projectId, code, excludeId = null }) => {
  if (!code) return;
  const duplicate = await tx.location.findFirst({
    where: {
      projectId,
      code,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new HttpError(
      409,
      "LOCATION_DUPLICATE_CODE",
      "A location with this code already exists in this project",
    );
  }
};

const nextSortOrder = async ({ tx, projectId, parentId }) => {
  const last = await tx.location.findFirst({
    where: { projectId, parentId: parentId || null },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return last ? last.sortOrder + 1 : 0;
};

const recordAudit = ({
  tx,
  orgId,
  projectId,
  location,
  action,
  actorId,
  actorRole,
  oldStatus = null,
  newStatus = null,
  reason = null,
  oldSummary = null,
  metadata = {},
}) =>
  auditService.recordEvent({
    tx,
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.LOCATION,
    entityId: location.id,
    action,
    actorId,
    actorRole,
    oldStatus,
    newStatus,
    reason,
    oldSummary,
    newSummary: locationSummary(location),
    summary: locationSummary(location),
    metadata,
  });

const createLocation = async ({
  orgId,
  projectId,
  payload = {},
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const name = normalizeName(payload.name);
  const code = normalizeCode(payload.code);
  const kind = normalizeKind(payload.kind);
  const description = trimOrNull(payload.description);
  const parentId = trimOrNull(payload.parentId);

  const location = await prisma.$transaction(async (tx) => {
    const parent = await resolveParent({ tx, projectId, parentId });
    await assertUniqueSiblingName({ tx, projectId, parentId, name });
    await assertUniqueCode({ tx, projectId, code });

    const sortOrder =
      payload.sortOrder !== undefined && payload.sortOrder !== null
        ? Math.max(0, Math.trunc(Number(payload.sortOrder)) || 0)
        : await nextSortOrder({ tx, projectId, parentId });

    const created = await tx.location.create({
      data: {
        orgId,
        projectId,
        parentId: parent ? parent.id : null,
        name,
        code,
        kind,
        description,
        depth: parent ? parent.depth + 1 : 0,
        path: "pending",
        sortOrder,
        status: LOCATION_STATUSES.ACTIVE,
        createdBy: userId || null,
        updatedBy: userId || null,
      },
    });

    const path = parent
      ? `${parent.path}${PATH_SEPARATOR}${created.id}`
      : created.id;
    const row = await tx.location.update({
      where: { id: created.id },
      data: { path },
    });

    await recordAudit({
      tx,
      orgId,
      projectId,
      location: row,
      action: auditService.ACTIONS.CREATED,
      actorId: userId,
      actorRole: userRole,
      newStatus: row.status,
    });

    return row;
  });

  return serializeLocation(location);
};

const loadSubtree = async ({ tx, projectId, path }) =>
  tx.location.findMany({
    where: {
      projectId,
      OR: [{ path }, { path: { startsWith: `${path}${PATH_SEPARATOR}` } }],
    },
  });

const updateLocation = async ({
  orgId,
  projectId,
  locationId,
  payload = {},
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const updated = await prisma.$transaction(async (tx) => {
    const existing = await findLocation({ tx, projectId, locationId });
    if (existing.status !== LOCATION_STATUSES.ACTIVE) {
      throw new HttpError(
        409,
        "LOCATION_ARCHIVED",
        "Archived locations must be restored before they can be edited",
      );
    }

    const data = { updatedBy: userId || null };
    const name =
      payload.name !== undefined ? normalizeName(payload.name) : existing.name;
    if (payload.name !== undefined) data.name = name;
    if (payload.code !== undefined) data.code = normalizeCode(payload.code);
    if (payload.kind !== undefined) data.kind = normalizeKind(payload.kind);
    if (payload.description !== undefined) {
      data.description = trimOrNull(payload.description);
    }
    if (payload.sortOrder !== undefined && payload.sortOrder !== null) {
      data.sortOrder = Math.max(0, Math.trunc(Number(payload.sortOrder)) || 0);
    }

    const moving =
      payload.parentId !== undefined &&
      (trimOrNull(payload.parentId) || null) !== (existing.parentId || null);
    const targetParentId = moving
      ? trimOrNull(payload.parentId)
      : existing.parentId || null;

    let parent = null;
    if (moving) {
      if (targetParentId === existing.id) {
        throw new HttpError(
          400,
          "LOCATION_INVALID_PARENT",
          "A location cannot be its own parent",
        );
      }
      parent = await resolveParent({ tx, projectId, parentId: targetParentId });
      if (parent && isDescendantPath(parent.path, existing.path)) {
        throw new HttpError(
          400,
          "LOCATION_INVALID_PARENT",
          "A location cannot be moved under one of its own descendants",
        );
      }
    }

    if (payload.name !== undefined || moving) {
      await assertUniqueSiblingName({
        tx,
        projectId,
        parentId: targetParentId,
        name,
        excludeId: existing.id,
      });
    }
    if (payload.code !== undefined) {
      await assertUniqueCode({
        tx,
        projectId,
        code: data.code,
        excludeId: existing.id,
      });
    }

    if (moving) {
      const newPath = parent
        ? `${parent.path}${PATH_SEPARATOR}${existing.id}`
        : existing.id;
      const newDepth = parent ? parent.depth + 1 : 0;
      const subtree = await loadSubtree({ tx, projectId, path: existing.path });
      const deepest = subtree.reduce(
        (max, row) => Math.max(max, row.depth - existing.depth),
        0,
      );
      if (newDepth + deepest >= MAX_DEPTH) {
        throw new HttpError(
          400,
          "LOCATION_DEPTH_EXCEEDED",
          `Moving this location would exceed ${MAX_DEPTH} levels`,
        );
      }

      for (const row of subtree) {
        if (row.id === existing.id) continue;
        await tx.location.update({
          where: { id: row.id },
          data: {
            path: row.path.replace(existing.path, newPath),
            depth: row.depth - existing.depth + newDepth,
          },
        });
      }

      data.parentId = parent ? parent.id : null;
      data.path = newPath;
      data.depth = newDepth;
      if (payload.sortOrder === undefined) {
        data.sortOrder = await nextSortOrder({
          tx,
          projectId,
          parentId: targetParentId,
        });
      }
    }

    const row = await tx.location.update({
      where: { id: existing.id },
      data,
    });

    await recordAudit({
      tx,
      orgId,
      projectId,
      location: row,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      actorRole: userRole,
      oldSummary: locationSummary(existing),
      metadata: moving
        ? { moved: true, fromParentId: existing.parentId || null }
        : {},
    });

    return row;
  });

  return serializeLocation(updated);
};

const reorderLocations = async ({
  orgId,
  projectId,
  payload = {},
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });
  const parentId = trimOrNull(payload.parentId);
  const orderedIds = [...new Set((payload.orderedIds || []).filter(Boolean))];

  if (!orderedIds.length) {
    throw new HttpError(
      400,
      "LOCATION_REORDER_EMPTY",
      "orderedIds must contain at least one location id",
    );
  }

  const rows = await prisma.$transaction(async (tx) => {
    const siblings = await tx.location.findMany({
      where: { projectId, parentId: parentId || null, id: { in: orderedIds } },
    });
    if (siblings.length !== orderedIds.length) {
      throw new HttpError(
        400,
        "LOCATION_REORDER_INVALID",
        "orderedIds must all be direct children of the same parent",
      );
    }

    const updates = [];
    for (const [index, id] of orderedIds.entries()) {
      const row = await tx.location.update({
        where: { id },
        data: { sortOrder: index, updatedBy: userId || null },
      });
      updates.push(row);
    }

    for (const row of updates) {
      await recordAudit({
        tx,
        orgId,
        projectId,
        location: row,
        action: auditService.ACTIONS.UPDATED,
        actorId: userId,
        actorRole: userRole,
        metadata: { reordered: true },
      });
    }

    return updates;
  });

  return rows.map((row) => serializeLocation(row));
};

const setSubtreeStatus = async ({
  tx,
  orgId,
  projectId,
  root,
  status,
  userId,
  userRole,
  reason,
}) => {
  const subtree = await loadSubtree({ tx, projectId, path: root.path });
  const now = new Date();
  const results = [];

  for (const row of subtree) {
    if (row.status === status) continue;
    const updated = await tx.location.update({
      where: { id: row.id },
      data: {
        status,
        archivedAt: status === LOCATION_STATUSES.ARCHIVED ? now : null,
        archivedBy:
          status === LOCATION_STATUSES.ARCHIVED ? userId || null : null,
        updatedBy: userId || null,
      },
    });
    results.push(updated);
    await recordAudit({
      tx,
      orgId,
      projectId,
      location: updated,
      action:
        status === LOCATION_STATUSES.ARCHIVED
          ? auditService.ACTIONS.ARCHIVED
          : auditService.ACTIONS.STATUS_CHANGED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: row.status,
      newStatus: status,
      reason,
      oldSummary: locationSummary(row),
      metadata: { cascadedFrom: row.id === root.id ? null : root.id },
    });
  }

  return results;
};

const archiveLocation = async ({
  orgId,
  projectId,
  locationId,
  reason = null,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const affected = await prisma.$transaction(async (tx) => {
    const existing = await findLocation({ tx, projectId, locationId });
    if (existing.status === LOCATION_STATUSES.ARCHIVED) {
      return [];
    }
    return setSubtreeStatus({
      tx,
      orgId,
      projectId,
      root: existing,
      status: LOCATION_STATUSES.ARCHIVED,
      userId,
      userRole,
      reason: trimOrNull(reason),
    });
  });

  return {
    id: locationId,
    status: LOCATION_STATUSES.ARCHIVED,
    archived: true,
    deleted: false,
    affectedCount: affected.length,
    affectedIds: affected.map((row) => row.id),
  };
};

const restoreLocation = async ({
  orgId,
  projectId,
  locationId,
  reason = null,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const restored = await prisma.$transaction(async (tx) => {
    const existing = await findLocation({ tx, projectId, locationId });
    if (existing.status === LOCATION_STATUSES.ACTIVE) return existing;

    if (existing.parentId) {
      const parent = await tx.location.findFirst({
        where: { id: existing.parentId, projectId },
        select: { status: true },
      });
      if (parent && parent.status !== LOCATION_STATUSES.ACTIVE) {
        throw new HttpError(
          409,
          "LOCATION_PARENT_ARCHIVED",
          "Restore the parent location first",
        );
      }
    }

    const [row] = await setSubtreeStatus({
      tx,
      orgId,
      projectId,
      root: existing,
      status: LOCATION_STATUSES.ACTIVE,
      userId,
      userRole,
      reason: trimOrNull(reason),
    });
    return row || existing;
  });

  return serializeLocation(restored);
};

module.exports = {
  LOCATION_KINDS,
  LOCATION_STATUSES,
  MAX_DEPTH,
  archiveLocation,
  buildTree,
  createLocation,
  listLocations,
  reorderLocations,
  restoreLocation,
  serializeLocation,
  updateLocation,
};
