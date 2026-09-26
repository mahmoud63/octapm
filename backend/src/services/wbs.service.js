const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const auditService = require("./audit.service");

/**
 * Project work breakdown structure (project-controls wave PC-1).
 *
 * `WbsNode` answers "what part of the scope?" for BOQ rows and activities. It
 * is stored like `Location`: a materialised path of ids so a subtree is one
 * prefix match and a move rewrites only the subtree. A node carries `orgId`
 * beside `projectId` with a composite foreign key to Project(id, orgId), so
 * a node can never be filed under another organisation's project.
 *
 * Nodes come from three places: a schedule import (activation upserts the
 * snapshot's WBS, `source = import`), the AI schedule generator (`ai`), and
 * the Structure page (`manual`). Whatever the source, `Activity.wbsCode` is
 * never rewritten here — activation only sets `Activity.wbsNodeId`.
 *
 * A work package is not a table of its own (control-model doc §1, decision
 * 3): it is a node flagged `isPackage`, optionally naming the party that
 * delivers it and the commitment it is delivered under.
 */

const WBS_STATUSES = Object.freeze({ ACTIVE: "active", ARCHIVED: "archived" });
const WBS_SOURCES = Object.freeze(["manual", "import", "ai"]);
const MAX_DEPTH = 12;
const PATH_SEPARATOR = "/";
const ENTITY_TYPE = "wbs_node";

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

const normalizeCode = (value) => {
  const code = trimOrNull(value);
  if (!code) {
    throw new HttpError(400, "WBS_NODE_CODE_REQUIRED", "WBS code is required");
  }
  if (code.length > 60) {
    throw new HttpError(400, "WBS_NODE_CODE_TOO_LONG", "WBS code must be 60 characters or fewer");
  }
  return code;
};

const normalizeName = (value) => {
  const name = trimOrNull(value);
  if (!name) {
    throw new HttpError(400, "WBS_NODE_NAME_REQUIRED", "WBS node name is required");
  }
  if (name.length > 160) {
    throw new HttpError(400, "WBS_NODE_NAME_TOO_LONG", "WBS node name must be 160 characters or fewer");
  }
  return name;
};

const isDescendantPath = (candidatePath, ancestorPath) =>
  candidatePath === ancestorPath || candidatePath.startsWith(`${ancestorPath}${PATH_SEPARATOR}`);

const serializeNode = (node, { childCount = 0, pathNames = [], activityCount = 0, boqItemCount = 0 } = {}) => ({
  id: node.id,
  projectId: node.projectId,
  parentId: node.parentId || null,
  code: node.code,
  name: node.name,
  path: node.path,
  pathNames,
  fullName: pathNames.length ? pathNames.join(" › ") : node.name,
  depth: node.depth,
  sortOrder: node.sortOrder,
  source: node.source,
  externalId: node.externalId || null,
  isPackage: Boolean(node.isPackage),
  ownerPartyId: node.ownerPartyId || null,
  commitmentId: node.commitmentId || null,
  status: node.status,
  childCount,
  activityCount,
  boqItemCount,
  createdBy: node.createdBy || null,
  updatedBy: node.updatedBy || null,
  archivedAt: toIso(node.archivedAt),
  archivedBy: node.archivedBy || null,
  createdAt: toIso(node.createdAt),
  updatedAt: toIso(node.updatedAt),
});

const nodeSummary = (node) => ({
  code: node.code,
  name: node.name,
  parentId: node.parentId || null,
  path: node.path,
  depth: node.depth,
  sortOrder: node.sortOrder,
  source: node.source,
  isPackage: Boolean(node.isPackage),
  ownerPartyId: node.ownerPartyId || null,
  commitmentId: node.commitmentId || null,
  status: node.status,
});

const compareSiblings = (a, b) =>
  a.sortOrder - b.sortOrder ||
  String(a.code).localeCompare(String(b.code), undefined, { numeric: true }) ||
  String(a.id).localeCompare(String(b.id));

/** Ordered flat rows and a nested tree from one project's node rows. */
const buildTree = (rows, counts = {}) => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const childrenOf = new Map();
  for (const row of rows) {
    const parentKey = row.parentId && byId.has(row.parentId) ? row.parentId : null;
    if (!childrenOf.has(parentKey)) childrenOf.set(parentKey, []);
    childrenOf.get(parentKey).push(row);
  }
  for (const siblings of childrenOf.values()) siblings.sort(compareSiblings);

  const flat = [];
  const visit = (parentKey, ancestors) =>
    (childrenOf.get(parentKey) || []).map((row) => {
      const pathNames = [...ancestors, row.name];
      const serialized = serializeNode(row, {
        childCount: (childrenOf.get(row.id) || []).length,
        pathNames,
        activityCount: counts.activities?.get(row.id) || 0,
        boqItemCount: counts.boqItems?.get(row.id) || 0,
      });
      flat.push(serialized);
      return { ...serialized, children: visit(row.id, pathNames) };
    });

  const tree = visit(null, []);
  return { flat, tree };
};

const countBy = (rows, key) => {
  const map = new Map();
  for (const row of rows) map.set(row[key], (row._count?._all ?? row._count ?? 0) || 0);
  return map;
};

const listWbsNodes = async ({ orgId, projectId, query = {} }) => {
  await ensureProject({ orgId, projectId });
  const where = { projectId };
  if (!query.includeArchived) where.status = WBS_STATUSES.ACTIVE;

  const [rows, activityGroups, boqGroups] = await Promise.all([
    prisma.wbsNode.findMany({
      where,
      orderBy: [{ depth: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
    }),
    prisma.activity.groupBy({
      by: ["wbsNodeId"],
      where: { projectId, isActive: true, wbsNodeId: { not: null } },
      _count: { _all: true },
    }),
    prisma.boqItem.groupBy({
      by: ["wbsNodeId"],
      where: { projectId, isActive: true, wbsNodeId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const { flat, tree } = buildTree(rows, {
    activities: countBy(activityGroups, "wbsNodeId"),
    boqItems: countBy(boqGroups, "wbsNodeId"),
  });
  const maxDepth = rows.reduce((max, row) => Math.max(max, row.depth), -1);

  return {
    items: flat,
    tree,
    summary: {
      total: rows.length,
      active: rows.filter((row) => row.status === WBS_STATUSES.ACTIVE).length,
      archived: rows.filter((row) => row.status === WBS_STATUSES.ARCHIVED).length,
      packages: rows.filter((row) => row.isPackage && row.status === WBS_STATUSES.ACTIVE).length,
      roots: tree.length,
      maxDepth: maxDepth + 1,
      linkedActivities: activityGroups.reduce((sum, group) => sum + (group._count?._all || 0), 0),
      linkedBoqItems: boqGroups.reduce((sum, group) => sum + (group._count?._all || 0), 0),
    },
  };
};

const findNode = async ({ tx = prisma, projectId, nodeId }) => {
  const node = await tx.wbsNode.findFirst({ where: { id: nodeId, projectId } });
  if (!node) {
    throw new HttpError(404, "WBS_NODE_NOT_FOUND", "WBS node not found");
  }
  return node;
};

const resolveParent = async ({ tx, projectId, parentId }) => {
  if (!parentId) return null;
  const parent = await tx.wbsNode.findFirst({ where: { id: parentId, projectId } });
  if (!parent) {
    throw new HttpError(400, "WBS_NODE_PARENT_INVALID", "Parent WBS node does not belong to this project");
  }
  if (parent.status !== WBS_STATUSES.ACTIVE) {
    throw new HttpError(409, "WBS_NODE_PARENT_ARCHIVED", "Cannot place a WBS node under an archived parent");
  }
  if (parent.depth + 1 >= MAX_DEPTH) {
    throw new HttpError(400, "WBS_NODE_DEPTH_EXCEEDED", `WBS depth is limited to ${MAX_DEPTH} levels`);
  }
  return parent;
};

const assertUniqueCode = async ({ tx, projectId, code, excludeId = null }) => {
  const duplicate = await tx.wbsNode.findFirst({
    where: { projectId, code, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (duplicate) {
    throw new HttpError(409, "WBS_NODE_DUPLICATE_CODE", `WBS code "${code}" already exists in this project`);
  }
};

/**
 * A package's owner must be a party on this project and its commitment a
 * commitment of this project — a node is the grouping, the commitment stays
 * the contractual truth, and a link to another project's contract would be a
 * second, wrong truth.
 */
const resolvePackageLinks = async ({ tx, projectId, payload, existing = null }) => {
  const data = {};
  if (payload.isPackage !== undefined) data.isPackage = Boolean(payload.isPackage);
  const isPackage = data.isPackage ?? Boolean(existing?.isPackage);

  if (payload.ownerPartyId !== undefined) {
    const ownerPartyId = trimOrNull(payload.ownerPartyId);
    if (ownerPartyId) {
      const party = await tx.projectParty.findFirst({ where: { id: ownerPartyId, projectId }, select: { id: true } });
      if (!party) {
        throw new HttpError(400, "WBS_PACKAGE_OWNER_INVALID", "Owner party does not belong to this project");
      }
    }
    data.ownerPartyId = ownerPartyId;
  }
  if (payload.commitmentId !== undefined) {
    const commitmentId = trimOrNull(payload.commitmentId);
    if (commitmentId) {
      const commitment = await tx.commitment.findFirst({ where: { id: commitmentId, projectId }, select: { id: true } });
      if (!commitment) {
        throw new HttpError(400, "WBS_PACKAGE_COMMITMENT_INVALID", "Commitment does not belong to this project");
      }
    }
    data.commitmentId = commitmentId;
  }
  // Owner and commitment describe a package; a plain node carries neither.
  if (!isPackage) {
    data.ownerPartyId = null;
    data.commitmentId = null;
  }
  return data;
};

const nextSortOrder = async ({ tx, projectId, parentId }) => {
  const last = await tx.wbsNode.findFirst({
    where: { projectId, parentId: parentId || null },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return last ? last.sortOrder + 1 : 0;
};

const recordAudit = ({ tx, orgId, projectId, node, action, actorId, actorRole, oldStatus = null, newStatus = null, reason = null, oldSummary = null, metadata = {} }) =>
  auditService.recordEvent({
    tx,
    orgId,
    projectId,
    entityType: ENTITY_TYPE,
    entityId: node.id,
    action,
    actorId,
    actorRole,
    oldStatus,
    newStatus,
    reason,
    oldSummary,
    newSummary: nodeSummary(node),
    summary: nodeSummary(node),
    metadata,
  });

const createWbsNode = async ({ orgId, projectId, payload = {}, userId = null, userRole = null }) => {
  await ensureProject({ orgId, projectId });
  const code = normalizeCode(payload.code);
  const name = normalizeName(payload.name);
  const parentId = trimOrNull(payload.parentId);
  const source = WBS_SOURCES.includes(payload.source) ? payload.source : "manual";

  const node = await prisma.$transaction(async (tx) => {
    const parent = await resolveParent({ tx, projectId, parentId });
    await assertUniqueCode({ tx, projectId, code });
    const packageData = await resolvePackageLinks({ tx, projectId, payload });
    const sortOrder =
      payload.sortOrder !== undefined && payload.sortOrder !== null
        ? Math.max(0, Math.trunc(Number(payload.sortOrder)) || 0)
        : await nextSortOrder({ tx, projectId, parentId });

    const created = await tx.wbsNode.create({
      data: {
        orgId,
        projectId,
        parentId: parent ? parent.id : null,
        code,
        name,
        depth: parent ? parent.depth + 1 : 0,
        path: "pending",
        sortOrder,
        source,
        externalId: trimOrNull(payload.externalId),
        status: WBS_STATUSES.ACTIVE,
        createdBy: userId || null,
        updatedBy: userId || null,
        ...packageData,
      },
    });
    const row = await tx.wbsNode.update({
      where: { id: created.id },
      data: { path: parent ? `${parent.path}${PATH_SEPARATOR}${created.id}` : created.id },
    });
    await recordAudit({ tx, orgId, projectId, node: row, action: auditService.ACTIONS.CREATED, actorId: userId, actorRole: userRole, newStatus: row.status });
    return row;
  });

  return serializeNode(node);
};

const loadSubtree = async ({ tx, projectId, path }) =>
  tx.wbsNode.findMany({
    where: { projectId, OR: [{ path }, { path: { startsWith: `${path}${PATH_SEPARATOR}` } }] },
  });

/**
 * Rename, recode, reorder, move, or flag a node. A move rewrites the path and
 * depth of every descendant in the same transaction, exactly as
 * `location.service.js` does, so no query ever sees a half-moved subtree.
 */
const updateWbsNode = async ({ orgId, projectId, nodeId, payload = {}, userId = null, userRole = null }) => {
  await ensureProject({ orgId, projectId });

  const updated = await prisma.$transaction(async (tx) => {
    const existing = await findNode({ tx, projectId, nodeId });
    if (existing.status !== WBS_STATUSES.ACTIVE) {
      throw new HttpError(409, "WBS_NODE_ARCHIVED", "Archived WBS nodes must be restored before they can be edited");
    }

    const data = { updatedBy: userId || null };
    if (payload.name !== undefined) data.name = normalizeName(payload.name);
    if (payload.code !== undefined) {
      data.code = normalizeCode(payload.code);
      if (data.code !== existing.code) await assertUniqueCode({ tx, projectId, code: data.code, excludeId: existing.id });
    }
    if (payload.sortOrder !== undefined && payload.sortOrder !== null) {
      data.sortOrder = Math.max(0, Math.trunc(Number(payload.sortOrder)) || 0);
    }
    Object.assign(data, await resolvePackageLinks({ tx, projectId, payload, existing }));

    const moving = payload.parentId !== undefined && (trimOrNull(payload.parentId) || null) !== (existing.parentId || null);
    if (moving) {
      const targetParentId = trimOrNull(payload.parentId);
      if (targetParentId === existing.id) {
        throw new HttpError(400, "WBS_NODE_INVALID_PARENT", "A WBS node cannot be its own parent");
      }
      const parent = await resolveParent({ tx, projectId, parentId: targetParentId });
      if (parent && isDescendantPath(parent.path, existing.path)) {
        throw new HttpError(400, "WBS_NODE_INVALID_PARENT", "A WBS node cannot be moved under one of its own descendants");
      }
      const newPath = parent ? `${parent.path}${PATH_SEPARATOR}${existing.id}` : existing.id;
      const newDepth = parent ? parent.depth + 1 : 0;
      const subtree = await loadSubtree({ tx, projectId, path: existing.path });
      const deepest = subtree.reduce((max, row) => Math.max(max, row.depth - existing.depth), 0);
      if (newDepth + deepest >= MAX_DEPTH) {
        throw new HttpError(400, "WBS_NODE_DEPTH_EXCEEDED", `Moving this node would exceed ${MAX_DEPTH} levels`);
      }
      for (const row of subtree) {
        if (row.id === existing.id) continue;
        await tx.wbsNode.update({
          where: { id: row.id },
          data: { path: row.path.replace(existing.path, newPath), depth: row.depth - existing.depth + newDepth },
        });
      }
      data.parentId = parent ? parent.id : null;
      data.path = newPath;
      data.depth = newDepth;
      if (payload.sortOrder === undefined) data.sortOrder = await nextSortOrder({ tx, projectId, parentId: targetParentId });
    }

    const row = await tx.wbsNode.update({ where: { id: existing.id }, data });
    await recordAudit({
      tx,
      orgId,
      projectId,
      node: row,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      actorRole: userRole,
      oldSummary: nodeSummary(existing),
      metadata: moving ? { moved: true, fromParentId: existing.parentId || null } : {},
    });
    return row;
  });

  return serializeNode(updated);
};

const setSubtreeStatus = async ({ tx, orgId, projectId, root, status, userId, userRole, reason }) => {
  const subtree = await loadSubtree({ tx, projectId, path: root.path });
  const now = new Date();
  const results = [];
  for (const row of subtree) {
    if (row.status === status) continue;
    const updated = await tx.wbsNode.update({
      where: { id: row.id },
      data: {
        status,
        archivedAt: status === WBS_STATUSES.ARCHIVED ? now : null,
        archivedBy: status === WBS_STATUSES.ARCHIVED ? userId || null : null,
        updatedBy: userId || null,
      },
    });
    results.push(updated);
    await recordAudit({
      tx,
      orgId,
      projectId,
      node: updated,
      action: status === WBS_STATUSES.ARCHIVED ? auditService.ACTIONS.ARCHIVED : auditService.ACTIONS.STATUS_CHANGED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: row.status,
      newStatus: status,
      reason,
      oldSummary: nodeSummary(row),
      metadata: { cascadedFrom: row.id === root.id ? null : root.id },
    });
  }
  return results;
};

/**
 * Archives a node and its subtree. Nothing is deleted and nothing linked is
 * touched: activities and BOQ rows keep their wbsNodeId, so an archived
 * branch can be restored with its links intact.
 */
const archiveWbsNode = async ({ orgId, projectId, nodeId, reason = null, userId = null, userRole = null }) => {
  await ensureProject({ orgId, projectId });
  const affected = await prisma.$transaction(async (tx) => {
    const existing = await findNode({ tx, projectId, nodeId });
    if (existing.status === WBS_STATUSES.ARCHIVED) return [];
    return setSubtreeStatus({ tx, orgId, projectId, root: existing, status: WBS_STATUSES.ARCHIVED, userId, userRole, reason: trimOrNull(reason) });
  });
  return {
    id: nodeId,
    status: WBS_STATUSES.ARCHIVED,
    archived: true,
    deleted: false,
    affectedCount: affected.length,
    affectedIds: affected.map((row) => row.id),
  };
};

const restoreWbsNode = async ({ orgId, projectId, nodeId, reason = null, userId = null, userRole = null }) => {
  await ensureProject({ orgId, projectId });
  const restored = await prisma.$transaction(async (tx) => {
    const existing = await findNode({ tx, projectId, nodeId });
    if (existing.status === WBS_STATUSES.ACTIVE) return existing;
    if (existing.parentId) {
      const parent = await tx.wbsNode.findFirst({ where: { id: existing.parentId, projectId }, select: { status: true } });
      if (parent && parent.status !== WBS_STATUSES.ACTIVE) {
        throw new HttpError(409, "WBS_NODE_PARENT_ARCHIVED", "Restore the parent WBS node first");
      }
    }
    const [row] = await setSubtreeStatus({ tx, orgId, projectId, root: existing, status: WBS_STATUSES.ACTIVE, userId, userRole, reason: trimOrNull(reason) });
    return row || existing;
  });
  return serializeNode(restored);
};

// ─── Population from schedule snapshots ──────────────────────────────────────

/**
 * One shape for the WBS nodes the three parsers write into a revision
 * snapshot: the XER and xlsx parsers emit `{ wbsId, parentWbsId, code, name,
 * seqNum }`, the P6 XML parser `{ objectId, parentObjectId, code, name }`.
 */
const normalizeSnapshotNode = (raw, index) => {
  const externalId = trimOrNull(raw?.wbsId ?? raw?.objectId ?? raw?.id);
  const code = trimOrNull(raw?.code) || externalId;
  if (!code) return null;
  return {
    externalId,
    parentExternalId: trimOrNull(raw?.parentWbsId ?? raw?.parentObjectId ?? raw?.parentId),
    code,
    name: trimOrNull(raw?.name) || code,
    seq: Number.isFinite(Number(raw?.seqNum ?? raw?.seq)) ? Number(raw?.seqNum ?? raw?.seq) : index,
  };
};

/**
 * Every prefix of a dotted code is a node: "1.2.3" yields 1, 1.2 and 1.2.3.
 * Used when a snapshot carries activities with WBS codes but no node list
 * (an MSPDI file, or a generated schedule).
 */
const nodesFromDottedCodes = (codes) => {
  const nodes = new Map();
  for (const raw of codes) {
    const parts = String(raw || "").split(".").map((part) => part.trim()).filter(Boolean);
    let parent = null;
    let code = "";
    for (const part of parts) {
      code = code ? `${code}.${part}` : part;
      if (!nodes.has(code)) {
        nodes.set(code, { externalId: code, parentExternalId: parent, code, name: code, seq: nodes.size });
      }
      parent = code;
    }
  }
  return [...nodes.values()];
};

/**
 * Upserts the snapshot's WBS into the project inside the caller's
 * transaction and returns lookups for linking activities.
 *
 * Rules, so a re-activation never undoes what a planner typed:
 *   - a node is matched by externalId first, then by code;
 *   - an existing node keeps its name, parent and position (manual edits win);
 *     only a missing externalId is filled in;
 *   - a new node is created under its snapshot parent, or at the root when the
 *     parent is unknown;
 *   - a code the project already uses for a *different* snapshot node is
 *     qualified with its parent's code ("03" under "1" becomes "1.03"), and
 *     a numeric suffix after that — the unique (projectId, code) stays true.
 */
const upsertNodesFromSnapshot = async ({ tx, orgId, projectId, nodes = [], activityCodes = [], source = "import", userId = null }) => {
  let list = (Array.isArray(nodes) ? nodes : []).map(normalizeSnapshotNode).filter(Boolean);
  if (!list.length) list = nodesFromDottedCodes(activityCodes.filter(Boolean));
  const result = { created: 0, existing: 0, byExternalId: new Map(), byCode: new Map() };
  if (!list.length) return result;

  const existingRows = await tx.wbsNode.findMany({ where: { projectId } });
  const existingByExternal = new Map(existingRows.filter((row) => row.externalId).map((row) => [row.externalId, row]));
  const existingByCode = new Map(existingRows.map((row) => [row.code, row]));
  const takenCodes = new Set(existingRows.map((row) => row.code));

  // Parents before children: depth from the snapshot's own parent chain.
  const byExternal = new Map(list.filter((node) => node.externalId).map((node) => [node.externalId, node]));
  const depthOf = (node, seen = new Set()) => {
    if (!node.parentExternalId || seen.has(node.externalId)) return 0;
    const parent = byExternal.get(node.parentExternalId);
    if (!parent || parent === node) return 0;
    seen.add(node.externalId);
    return depthOf(parent, seen) + 1;
  };
  const ordered = list
    .map((node, index) => ({ node, index, depth: depthOf(node) }))
    .sort((a, b) => a.depth - b.depth || a.node.seq - b.node.seq || a.index - b.index)
    .map((entry) => entry.node);

  const resolved = new Map(); // externalId -> row
  const claimedThisRun = new Map(); // code -> externalId that claimed it
  const sortOrders = new Map(); // parentId|null -> next sortOrder

  for (const node of ordered) {
    const parentRow = node.parentExternalId ? resolved.get(node.parentExternalId) || existingByExternal.get(node.parentExternalId) || null : null;
    let row = (node.externalId && existingByExternal.get(node.externalId)) || null;
    if (!row) {
      const byCodeRow = existingByCode.get(node.code);
      // A row with this code and no external id is the same node typed by
      // hand (or imported before external ids were kept); one with a
      // different external id is another node that happens to share the name.
      if (byCodeRow && (!byCodeRow.externalId || byCodeRow.externalId === node.externalId)) row = byCodeRow;
    }

    if (row) {
      if (!row.externalId && node.externalId) {
        row = await tx.wbsNode.update({ where: { id: row.id }, data: { externalId: node.externalId } });
        existingByExternal.set(node.externalId, row);
      }
      result.existing += 1;
    } else {
      let code = node.code;
      if (takenCodes.has(code) && claimedThisRun.get(code) !== node.externalId) {
        const qualified = parentRow ? `${parentRow.code}.${node.code}` : node.code;
        code = qualified;
        for (let n = 2; takenCodes.has(code); n += 1) code = `${qualified}-${n}`;
      }
      const parentKey = parentRow ? parentRow.id : null;
      if (!sortOrders.has(parentKey)) {
        const last = await tx.wbsNode.findFirst({ where: { projectId, parentId: parentKey }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
        sortOrders.set(parentKey, last ? last.sortOrder + 1 : 0);
      }
      const sortOrder = sortOrders.get(parentKey);
      sortOrders.set(parentKey, sortOrder + 1);

      const created = await tx.wbsNode.create({
        data: {
          orgId,
          projectId,
          parentId: parentKey,
          code,
          name: node.name,
          depth: parentRow ? parentRow.depth + 1 : 0,
          path: "pending",
          sortOrder,
          source,
          externalId: node.externalId,
          status: WBS_STATUSES.ACTIVE,
          createdBy: userId || null,
          updatedBy: userId || null,
        },
      });
      row = await tx.wbsNode.update({
        where: { id: created.id },
        data: { path: parentRow ? `${parentRow.path}${PATH_SEPARATOR}${created.id}` : created.id },
      });
      takenCodes.add(code);
      claimedThisRun.set(code, node.externalId);
      existingByCode.set(code, row);
      if (node.externalId) existingByExternal.set(node.externalId, row);
      result.created += 1;
    }

    if (node.externalId) {
      resolved.set(node.externalId, row);
      if (!result.byExternalId.has(node.externalId)) result.byExternalId.set(node.externalId, row);
    }
    // The snapshot's own code (before qualification) is what the activities
    // carry as wbsCode; keep the first node that answered to it.
    if (!result.byCode.has(node.code)) result.byCode.set(node.code, row);
    if (!result.byCode.has(row.code)) result.byCode.set(row.code, row);
  }

  return result;
};

/**
 * Sets Activity.wbsNodeId for the given activities from their wbsCode: the
 * code is looked up as an external id first, then as a node code. Nothing
 * else on the activity changes, and an activity whose code matches no node
 * keeps whatever link it had.
 */
const linkActivitiesToNodes = async ({ tx, lookups, activities = [] }) => {
  const idsByNode = new Map();
  for (const activity of activities) {
    const code = trimOrNull(activity.wbsCode);
    if (!code || !activity.id) continue;
    const node = lookups.byExternalId.get(code) || lookups.byCode.get(code) || null;
    if (!node) continue;
    if (!idsByNode.has(node.id)) idsByNode.set(node.id, []);
    idsByNode.get(node.id).push(activity.id);
  }
  let linked = 0;
  for (const [wbsNodeId, ids] of idsByNode) {
    const { count } = await tx.activity.updateMany({ where: { id: { in: ids } }, data: { wbsNodeId } });
    linked += count;
  }
  return { linked, unmatched: activities.filter((a) => trimOrNull(a.wbsCode) && !(lookups.byExternalId.has(a.wbsCode) || lookups.byCode.has(a.wbsCode))).length };
};

module.exports = {
  ENTITY_TYPE,
  MAX_DEPTH,
  WBS_SOURCES,
  WBS_STATUSES,
  archiveWbsNode,
  buildTree,
  createWbsNode,
  linkActivitiesToNodes,
  listWbsNodes,
  nodesFromDottedCodes,
  normalizeSnapshotNode,
  restoreWbsNode,
  serializeNode,
  updateWbsNode,
  upsertNodesFromSnapshot,
};
