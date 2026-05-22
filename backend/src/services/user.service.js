const bcrypt = require('bcryptjs');
const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');

const ALLOWED_ROLES = [
  'pm',
  'planning_eng',
  'qs',
  'cost_controller',
  'procurement',
  'warehouse',
  'site_engineer',
  'finance',
];

const sanitizeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  status: user.status,
  lastLogin: user.lastLogin,
  createdAt: user.createdAt,
  projectCount: user._count?.projectAssignments ?? 0,
});

const listUsers = async ({ orgId, query }) => {
  const take = 20;
  const where = { orgId };

  if (query.status) where.status = query.status;
  if (query.role) where.role = query.role;

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { email: { contains: query.search, mode: 'insensitive' } },
      { phone: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const users = await prisma.user.findMany({
    where,
    take: take + 1,
    include: { _count: { select: { projectAssignments: true } } },
    orderBy: { createdAt: 'desc' },
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  let nextCursor = null;
  if (users.length > take) {
    nextCursor = users.pop().id;
  }

  return {
    items: users.map(sanitizeUser),
    pagination: { limit: take, nextCursor },
  };
};

const createUser = async ({ orgId, payload }) => {
  const existing = await prisma.user.findUnique({
    where: { email: payload.email },
  });
  if (existing) {
    throw new HttpError(409, 'EMAIL_EXISTS', 'Email already exists');
  }

  const role =
    payload.role && ALLOWED_ROLES.includes(payload.role)
      ? payload.role
      : 'site_engineer';

  const passwordHash = await bcrypt.hash(payload.password, 12);

  const user = await prisma.user.create({
    data: {
      orgId,
      name: payload.name,
      email: payload.email,
      phone: payload.phone ?? null,
      passwordHash,
      role,
      status: 'active',
    },
    include: { _count: { select: { projectAssignments: true } } },
  });

  return sanitizeUser(user);
};

const getUserById = async ({ orgId, userId }) => {
  const user = await prisma.user.findFirst({
    where: { id: userId, orgId },
    include: { _count: { select: { projectAssignments: true } } },
  });

  if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
  return sanitizeUser(user);
};

const deactivateUser = async ({ orgId, userId }) => {
  const user = await prisma.user.findFirst({ where: { id: userId, orgId } });
  if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
  if (user.status === 'inactive') {
    throw new HttpError(400, 'ALREADY_INACTIVE', 'User is already inactive');
  }

  const [updated] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { status: 'inactive' },
      include: { _count: { select: { projectAssignments: true } } },
    }),
    prisma.projectAssignment.deleteMany({ where: { userId } }),
    prisma.activityAssignment.deleteMany({ where: { userId } }),
  ]);

  return sanitizeUser(updated);
};

const activateUser = async ({ orgId, userId }) => {
  const user = await prisma.user.findFirst({ where: { id: userId, orgId } });
  if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
  if (user.status === 'active') {
    throw new HttpError(400, 'ALREADY_ACTIVE', 'User is already active');
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { status: 'active' },
    include: { _count: { select: { projectAssignments: true } } },
  });

  return sanitizeUser(updated);
};

const updateUser = async ({ orgId, userId, payload }) => {
  const user = await prisma.user.findFirst({ where: { id: userId, orgId } });
  if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');

  const data = {};
  if (payload.name !== undefined) data.name = payload.name;
  if (payload.phone !== undefined) data.phone = payload.phone || null;

  if (payload.email !== undefined) {
    const normalized = payload.email.trim().toLowerCase();
    if (normalized !== user.email) {
      const clash = await prisma.user.findUnique({ where: { email: normalized } });
      if (clash) throw new HttpError(409, 'EMAIL_EXISTS', 'Email already exists');
      data.email = normalized;
    }
  }

  if (payload.role !== undefined) {
    if (!ALLOWED_ROLES.includes(payload.role)) {
      throw new HttpError(400, 'INVALID_ROLE', 'Role is invalid');
    }
    data.role = payload.role;
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    include: { _count: { select: { projectAssignments: true } } },
  });

  return sanitizeUser(updated);
};

module.exports = {
  listUsers,
  createUser,
  getUserById,
  updateUser,
  deactivateUser,
  activateUser,
};
