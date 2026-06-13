import { createRequire } from 'node:module'

const backendRequire = createRequire(
  new URL('../../backend/package.json', import.meta.url)
)
const { PrismaClient } = backendRequire('@prisma/client')
const bcrypt = backendRequire('bcryptjs')

const prisma = new PrismaClient()

const PASSWORD = process.env.UAT_SEED_PASSWORD || 'UatPassw0rd!'
const ORG_NAME = process.env.UAT_SEED_ORG_NAME || 'PMcopilots UAT Fixtures'
const PROJECT_NAME = process.env.UAT_SEED_PROJECT_NAME || 'UAT Regression Tower'
const RESTRICTED_PROJECT_NAME =
  process.env.UAT_SEED_RESTRICTED_PROJECT_NAME || 'UAT Restricted Project'

const personas = [
  ['pm', 'UAT Project Manager', 'uat.pm@pmcopilots.test', 'pm'],
  [
    'planning',
    'UAT Planning Engineer',
    'uat.planning@pmcopilots.test',
    'planning_eng',
  ],
  ['qs', 'UAT Quantity Surveyor', 'uat.qs@pmcopilots.test', 'qs'],
  [
    'costController',
    'UAT Cost Controller',
    'uat.cost@pmcopilots.test',
    'cost_controller',
  ],
  ['procurement', 'UAT Procurement', 'uat.procurement@pmcopilots.test', 'procurement'],
  ['warehouse', 'UAT Warehouse', 'uat.warehouse@pmcopilots.test', 'warehouse'],
  ['siteEngineer', 'UAT Site Engineer', 'uat.site@pmcopilots.test', 'site_engineer'],
  ['finance', 'UAT Finance', 'uat.finance@pmcopilots.test', 'finance'],
]

const date = (value) => new Date(`${value}T00:00:00.000Z`)

async function findOrCreateOrganisation() {
  const existing = await prisma.organisation.findFirst({
    where: { name: ORG_NAME },
  })

  if (existing) {
    return prisma.organisation.update({
      where: { id: existing.id },
      data: { status: 'active', plan: existing.plan || 'standard' },
    })
  }

  return prisma.organisation.create({
    data: { name: ORG_NAME, status: 'active', plan: 'standard' },
  })
}

async function ensureSubscription(orgId) {
  if (!prisma.subscription?.upsert) return null

  return prisma.subscription.upsert({
    where: { orgId },
    create: {
      orgId,
      status: 'active',
      plan: 'standard',
    },
    update: {
      status: 'active',
      plan: 'standard',
    },
  })
}

async function upsertUsers(orgId) {
  const passwordHash = await bcrypt.hash(PASSWORD, 12)
  const users = {}

  for (const [id, name, email, role] of personas) {
    users[id] = await prisma.user.upsert({
      where: { email },
      create: {
        orgId,
        name,
        email,
        role,
        status: 'active',
        passwordHash,
      },
      update: {
        orgId,
        name,
        role,
        status: 'active',
        passwordHash,
      },
    })
  }

  return users
}

async function findOrCreateProject(orgId, name, data) {
  const existing = await prisma.project.findFirst({
    where: { orgId, name },
  })

  if (existing) {
    return prisma.project.update({
      where: { id: existing.id },
      data,
    })
  }

  return prisma.project.create({
    data: {
      orgId,
      name,
      ...data,
    },
  })
}

async function upsertProjectAssignment({ projectId, userId, role }) {
  return prisma.projectAssignment.upsert({
    where: { projectId_userId: { projectId, userId } },
    create: { projectId, userId, role },
    update: { role },
  })
}

async function findOrCreateActivity(projectId, payload) {
  const existing = await prisma.activity.findFirst({
    where: { projectId, activityCode: payload.activityCode },
  })

  if (existing) {
    return prisma.activity.update({
      where: { id: existing.id },
      data: payload,
    })
  }

  return prisma.activity.create({
    data: {
      projectId,
      ...payload,
    },
  })
}

async function upsertActivityAssignment({ activityId, userId }) {
  return prisma.activityAssignment.upsert({
    where: { activityId_userId: { activityId, userId } },
    create: { activityId, userId },
    update: {},
  })
}

async function ensureBoqItem(projectId) {
  const existing = await prisma.boqItem.findFirst({
    where: { projectId, code: 'UAT-001', isActive: true },
  })
  const data = {
    activeCodeKey: 'UAT-001',
    description: 'UAT concrete package',
    qty: 100,
    unit: 'm3',
    rate: 1500,
    amount: 150000,
    section: 'Concrete',
    isManual: true,
    isActive: true,
    baselineLocked: true,
    sortOrder: 1,
  }

  if (existing) {
    return prisma.boqItem.update({
      where: { id: existing.id },
      data,
    })
  }

  return prisma.boqItem.create({
    data: {
      projectId,
      code: 'UAT-001',
      ...data,
    },
  })
}

async function ensureApprovedAllocation({ projectId, boqItemId, activityId, userId }) {
  const existing = await prisma.activityBoqAllocation.findFirst({
    where: { projectId, boqItemId, activityId, isActive: true },
  })
  const data = {
    quantity: 100,
    amount: 150000,
    weight: 100,
    source: 'manual',
    status: 'approved',
    isActive: true,
    notes: 'Seeded for UAT regression',
    submittedBy: userId,
    submittedAt: new Date(),
    approvedBy: userId,
    approvedAt: new Date(),
    updatedBy: userId,
  }

  if (existing) {
    return prisma.activityBoqAllocation.update({
      where: { id: existing.id },
      data,
    })
  }

  return prisma.activityBoqAllocation.create({
    data: {
      projectId,
      boqItemId,
      activityId,
      createdBy: userId,
      ...data,
    },
  })
}

async function ensureApprovedProgress({ projectId, activityId, userId }) {
  const existing = await prisma.activityProgress.findFirst({
    where: { activityId, status: 'approved' },
    orderBy: { updatedAt: 'desc' },
  })
  const data = {
    pctComplete: 80,
    actualCost: 82000,
    progressMethod: 'percent',
    source: 'manual',
    status: 'approved',
    approvedBy: userId,
    approvedAt: new Date(),
    notes: 'Seeded approved progress for IPC UAT',
    updatedBy: userId,
    updatedAt: new Date(),
  }

  if (existing) {
    return prisma.activityProgress.update({
      where: { id: existing.id },
      data,
    })
  }

  return prisma.activityProgress.create({
    data: {
      activityId,
      ...data,
    },
  })
}

async function ensureCostRecord({ projectId, activityId }) {
  const existing = await prisma.costRecord.findFirst({
    where: { projectId, activityId },
  })
  const data = {
    labour: 25000,
    material: 48000,
    equipment: 9000,
    subcontract: 0,
    indirect: 2000,
    overhead: 3000,
    contingency: 1000,
    budget: 150000,
    committed: 110000,
    actual: 87000,
    actualThroughDate: date('2026-02-15'),
    forecast: 152000,
  }

  if (existing) {
    return prisma.costRecord.update({
      where: { id: existing.id },
      data,
    })
  }

  return prisma.costRecord.create({
    data: {
      projectId,
      activityId,
      ...data,
    },
  })
}

async function ensureScheduleRevision({ projectId, activityCount, userId }) {
  await prisma.scheduleRevision.updateMany({
    where: { projectId },
    data: { isActive: false },
  })

  const existing = await prisma.scheduleRevision.findFirst({
    where: { projectId, label: 'UAT Baseline' },
  })
  const data = {
    activityCount,
    criticalCount: 1,
    totalBudget: 150000,
    snapshotJson: {
      projectSummary: 'Seeded UAT baseline for regression evidence.',
      risks: [],
      milestones: [],
      wbs: [{ code: 'UAT', name: 'UAT Work', level: 1 }],
      resourceSummary: [],
      longLeadItems: [],
      assumptions: [],
      criticalPath: ['UAT-001'],
    },
    source: 'uat_fixture',
    isActive: true,
    status: 'approved',
    approvedBy: userId,
    approvedAt: new Date(),
    activationComment: 'Seeded active baseline for UAT regression.',
  }

  if (existing) {
    return prisma.scheduleRevision.update({
      where: { id: existing.id },
      data,
    })
  }

  return prisma.scheduleRevision.create({
    data: {
      projectId,
      label: 'UAT Baseline',
      ...data,
    },
  })
}

async function main() {
  const org = await findOrCreateOrganisation()
  await ensureSubscription(org.id)
  const users = await upsertUsers(org.id)

  const project = await findOrCreateProject(org.id, PROJECT_NAME, {
    type: 'High-rise',
    location: 'Baton Rouge, LA',
    clientName: 'UAT Owner',
    consultantName: 'UAT Consultant',
    contractorName: 'UAT Contractor',
    contractType: 'lump_sum',
    contractNumber: 'UAT-2026-001',
    startDate: date('2026-01-05'),
    endDate: date('2026-12-18'),
    completionDate: date('2026-12-18'),
    baselineDate: date('2026-01-05'),
    dataDate: date('2026-02-15'),
    duration: 248,
    durationUnit: 'days',
    contractValue: 150000,
    defaultRetentionRate: 5,
    ldRatePerDay: 2500,
    weatherAllowanceDays: 20,
    projectCalendar: 'five_day',
    reportingCutoffDay: 25,
    currency: 'USD',
    status: 'active',
    archivedAt: null,
    archivedBy: null,
  })

  const restrictedProject = await findOrCreateProject(
    org.id,
    RESTRICTED_PROJECT_NAME,
    {
      type: 'Restricted',
      location: 'Baton Rouge, LA',
      clientName: 'Restricted Owner',
      contractorName: 'Restricted Contractor',
      startDate: date('2026-03-02'),
      endDate: date('2026-08-28'),
      duration: 130,
      durationUnit: 'days',
      contractValue: 50000,
      currency: 'USD',
      status: 'active',
      archivedAt: null,
      archivedBy: null,
    }
  )

  await Promise.all(
    Object.entries(users).map(([, user]) =>
      upsertProjectAssignment({
        projectId: project.id,
        userId: user.id,
        role: user.role,
      })
    )
  )
  await upsertProjectAssignment({
    projectId: restrictedProject.id,
    userId: users.pm.id,
    role: 'pm',
  })

  const activity = await findOrCreateActivity(project.id, {
    name: 'UAT concrete pour',
    activityCode: 'UAT-001',
    wbsCode: 'UAT.01',
    calendarId: 'five_day',
    category: 'structural',
    startDate: date('2026-01-12'),
    endDate: date('2026-02-20'),
    duration: 30,
    earlyStart: 0,
    earlyFinish: 30,
    baselineStart: 0,
    baselineFinish: 30,
    lateStart: 0,
    lateFinish: 30,
    totalFloat: 0,
    budget: 150000,
    isMilestone: false,
    isCritical: true,
    isActive: true,
    sortOrder: 1,
  })

  await upsertActivityAssignment({
    activityId: activity.id,
    userId: users.siteEngineer.id,
  })
  await upsertActivityAssignment({
    activityId: activity.id,
    userId: users.pm.id,
  })

  const boqItem = await ensureBoqItem(project.id)
  const allocation = await ensureApprovedAllocation({
    projectId: project.id,
    boqItemId: boqItem.id,
    activityId: activity.id,
    userId: users.pm.id,
  })
  await ensureApprovedProgress({
    projectId: project.id,
    activityId: activity.id,
    userId: users.pm.id,
  })
  await ensureCostRecord({ projectId: project.id, activityId: activity.id })
  await ensureScheduleRevision({
    projectId: project.id,
    activityCount: 1,
    userId: users.pm.id,
  })

  const summary = {
    organisationId: org.id,
    projectId: project.id,
    restrictedProjectId: restrictedProject.id,
    activityId: activity.id,
    boqItemId: boqItem.id,
    allocationId: allocation.id,
    personas: Object.fromEntries(
      Object.entries(users).map(([id, user]) => [id, { id: user.id, email: user.email }])
    ),
    password: PASSWORD,
  }

  console.log(JSON.stringify(summary, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
