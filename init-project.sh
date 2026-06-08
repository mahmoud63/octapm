#!/bin/bash
# PMcopilots — Project Initialization Script
# Run this ONCE to scaffold the monorepo structure

set -e
echo "🏗  PMcopilots — Initializing project..."

# ─── Root ───
mkdir -p docs

# ─── Backend (Express.js + Prisma) ───
echo "📦 Setting up backend..."
mkdir -p backend/src/{config,middleware,routes,services,parsers,utils}
mkdir -p backend/prisma

cat > backend/package.json << 'EOF'
{
  "name": "pmcopilots-backend",
  "version": "1.0.0",
  "description": "PMcopilots Express.js REST API",
  "main": "src/index.js",
  "scripts": {
    "dev": "nodemon src/index.js",
    "start": "node src/index.js",
    "db:migrate": "npx prisma migrate dev",
    "db:seed": "node prisma/seed.js",
    "db:studio": "npx prisma studio"
  },
  "dependencies": {
    "express": "^4.21.0",
    "@prisma/client": "^6.0.0",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.0",
    "cors": "^2.8.5",
    "helmet": "^8.0.0",
    "morgan": "^1.10.0",
    "multer": "^1.4.5-lts.1",
    "express-validator": "^7.2.0",
    "dotenv": "^16.4.0",
    "socket.io": "^4.8.0",
    "xlsx": "^0.18.5",
    "xml2js": "^0.6.0"
  },
  "devDependencies": {
    "prisma": "^6.0.0",
    "nodemon": "^3.1.0"
  }
}
EOF

cat > backend/.env.example << 'EOF'
DATABASE_URL="postgresql://postgres:password@localhost:5432/pmcopilots"
JWT_SECRET="your-secret-key-change-this"
JWT_REFRESH_SECRET="your-refresh-secret-change-this"
JWT_EXPIRY="15m"
JWT_REFRESH_EXPIRY="7d"
PORT=5000
NODE_ENV=development

# AI Provider (primary)
AI_PROVIDER=claude
ANTHROPIC_API_KEY=your-key-here

# AI Provider (fallback)
OPENAI_API_KEY=your-key-here

# File Storage
S3_BUCKET=pmcopilots-uploads
S3_REGION=me-south-1
S3_ACCESS_KEY=your-key
S3_SECRET_KEY=your-secret
EOF

cat > backend/src/index.js << 'EOF'
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:5173' }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// TODO: Mount route modules here
// app.use('/api/v1/auth', require('./routes/auth'));
// app.use('/api/v1/users', require('./routes/users'));
// app.use('/api/v1/projects', require('./routes/projects'));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    error: { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Something went wrong' }
  });
});

// Make io accessible in routes
app.set('io', io);

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`🚀 PMcopilots API running on port ${PORT}`);
});
EOF

# Prisma schema with core entities
cat > backend/prisma/schema.prisma << 'EOF'
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Organisation & Users ───
model Organisation {
  id        String   @id @default(uuid())
  name      String
  plan      String   @default("standard")
  status    String   @default("active")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  users    User[]
  projects Project[]
}

model User {
  id           String   @id @default(uuid())
  orgId        String
  name         String
  email        String   @unique
  phone        String?
  passwordHash String
  role         String   @default("site_engineer") // super_admin, pm, planning_eng, qs, cost_controller, procurement, warehouse, site_engineer, finance
  status       String   @default("active")
  lastLogin    DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  org               Organisation       @relation(fields: [orgId], references: [id])
  projectAssignments ProjectAssignment[]
  dailyReports      DailyReport[]

  @@index([orgId])
  @@index([email])
}

// ─── Projects ───
model Project {
  id            String   @id @default(uuid())
  orgId         String
  name          String
  type          String?
  location      String?
  startDate     DateTime?
  duration      Int?
  durationUnit  String   @default("months")
  contractValue Float?
  currency      String   @default("USD")
  status        String   @default("active")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  org                Organisation       @relation(fields: [orgId], references: [id])
  assignments        ProjectAssignment[]
  boqItems           BoqItem[]
  activities         Activity[]
  scheduleRevisions  ScheduleRevision[]
  costRecords        CostRecord[]
  changeOrders       ChangeOrder[]
  ipcItems           IpcItem[]
  subValuations      SubValuation[]
  procurementOrders  ProcurementOrder[]
  materialMaster     MaterialMaster[]
  ncrRecords         NcrRecord[]
  rfis               Rfi[]
  dailyReports       DailyReport[]
  siteDiary          SiteDiary[]

  @@index([orgId])
}

model ProjectAssignment {
  id        String @id @default(uuid())
  projectId String
  userId    String
  role      String // role within this project

  project Project @relation(fields: [projectId], references: [id])
  user    User    @relation(fields: [userId], references: [id])

  @@unique([projectId, userId])
}

// ─── BOQ ───
model BoqItem {
  id          String @id @default(uuid())
  projectId   String
  ref         String?
  description String
  unit        String?
  qty         Float   @default(0)
  rate        Float   @default(0)
  amount      Float   @default(0)
  section     String?
  sortOrder   Int     @default(0)

  project  Project   @relation(fields: [projectId], references: [id])
  ipcItems IpcItem[]

  @@index([projectId])
}

// ─── Activities (THE CORE — everything links here) ───
model Activity {
  id           String  @id @default(uuid())
  projectId    String
  name         String
  wbsCode      String?
  duration     Int     @default(0)
  earlyStart   Int?
  earlyFinish  Int?
  lateStart    Int?
  lateFinish   Int?
  totalFloat   Int?
  budget       Float   @default(0)
  isMilestone  Boolean @default(false)
  isCritical   Boolean @default(false)
  predecessors String? // comma-separated: "ACT-01 FS, ACT-02 SS+2"
  batchId      String? // for chunked generation: B1, B2, etc.
  sortOrder    Int     @default(0)

  project           Project            @relation(fields: [projectId], references: [id])
  progress          ActivityProgress[]
  costRecords       CostRecord[]
  procurementOrders ProcurementOrder[]
  ncrRecords        NcrRecord[]
  dailyReports      DailyReport[]

  @@index([projectId])
  @@index([projectId, isCritical])
}

model ActivityProgress {
  id           String   @id @default(uuid())
  activityId   String
  pctComplete  Float    @default(0)
  actualCost   Float?
  actualStart  DateTime?
  actualFinish DateTime?
  notes        String?
  updatedBy    String?
  updatedAt    DateTime @default(now())

  activity Activity @relation(fields: [activityId], references: [id])

  @@index([activityId])
}

// ─── Schedule Revisions ───
model ScheduleRevision {
  id            String   @id @default(uuid())
  projectId     String
  label         String?
  activityCount Int      @default(0)
  criticalCount Int      @default(0)
  totalBudget   Float    @default(0)
  snapshotJson  Json?
  createdAt     DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id])

  @@index([projectId])
}

// ─── Cost Control ───
model CostRecord {
  id          String @id @default(uuid())
  activityId  String
  projectId   String
  labour      Float  @default(0)
  material    Float  @default(0)
  equipment   Float  @default(0)
  subcontract Float  @default(0)
  indirect    Float  @default(0)
  overhead    Float  @default(0)
  contingency Float  @default(0)
  budget      Float  @default(0)
  committed   Float  @default(0)
  actual      Float  @default(0)
  forecast    Float  @default(0)

  activity Activity @relation(fields: [activityId], references: [id])
  project  Project  @relation(fields: [projectId], references: [id])

  @@index([activityId])
  @@index([projectId])
}

// ─── Commercial ───
model ChangeOrder {
  id             String   @id @default(uuid())
  projectId      String
  ref            String
  description    String
  value          Float    @default(0)
  status         String   @default("pending") // pending, approved, rejected
  scheduleImpact Int      @default(0)
  submittedDate  DateTime?
  approvedDate   DateTime?
  raisedBy       String?

  project Project @relation(fields: [projectId], references: [id])
  @@index([projectId])
}

model IpcItem {
  id             String @id @default(uuid())
  projectId      String
  boqItemId      String
  previousCert   Float  @default(0)
  currentCert    Float  @default(0)
  cumulativeCert Float  @default(0)
  retention      Float  @default(0)

  project Project @relation(fields: [projectId], references: [id])
  boqItem BoqItem @relation(fields: [boqItemId], references: [id])
  @@index([projectId])
}

model SubValuation {
  id            String   @id @default(uuid())
  projectId     String
  subcontractor String
  period        String
  workDone      Float    @default(0)
  materialsOnSite Float  @default(0)
  retention     Float    @default(0)
  backCharges   Float    @default(0)
  netPayable    Float    @default(0)
  status        String   @default("draft")
  certDate      DateTime?
  payDate       DateTime?

  project Project @relation(fields: [projectId], references: [id])
  @@index([projectId])
}

// ─── Procurement ───
model ProcurementOrder {
  id           String   @id @default(uuid())
  projectId    String
  activityId   String?
  ref          String
  item         String
  supplier     String?
  status       String   @default("planned")
  leadWeeks    Int      @default(0)
  value        Float    @default(0)
  deliveryDate DateTime?

  project  Project   @relation(fields: [projectId], references: [id])
  activity Activity? @relation(fields: [activityId], references: [id])
  @@index([projectId])
}

model MaterialMaster {
  id           String @id @default(uuid())
  projectId    String
  code         String
  name         String
  spec         String?
  unit         String
  category     String?
  supplier     String?
  leadWeeks    Int    @default(0)
  unitCost     Float  @default(0)
  reorderPoint Float  @default(0)

  project Project @relation(fields: [projectId], references: [id])
  @@index([projectId])
}

// ─── Quality ───
model NcrRecord {
  id          String @id @default(uuid())
  projectId   String
  activityId  String?
  ref         String
  severity    String // major, minor
  description String?
  disposition String?
  status      String @default("open")
  responsible String?

  project  Project   @relation(fields: [projectId], references: [id])
  activity Activity? @relation(fields: [activityId], references: [id])
  @@index([projectId])
}

// ─── Document Control ───
model Rfi {
  id             String   @id @default(uuid())
  projectId      String
  ref            String
  subject        String
  discipline     String?
  priority       String   @default("normal")
  status         String   @default("open")
  scheduleImpact Int      @default(0)
  raisedDate     DateTime?
  dueDate        DateTime?
  answeredDate   DateTime?

  project Project @relation(fields: [projectId], references: [id])
  @@index([projectId])
}

// ─── Mobile: Daily Reports ───
model DailyReport {
  id          String   @id @default(uuid())
  projectId   String
  activityId  String
  engineerId  String
  date        DateTime
  pctProgress Float    @default(0)
  notes       String?
  photosJson  Json?    // array of photo URLs
  materialsJson Json?  // array of { materialId, qty, unit }
  equipmentJson Json?  // array of { equipmentId, hours }
  createdAt   DateTime @default(now())

  project  Project  @relation(fields: [projectId], references: [id])
  activity Activity @relation(fields: [activityId], references: [id])
  engineer User     @relation(fields: [engineerId], references: [id])
  @@index([projectId])
  @@index([activityId])
  @@index([engineerId])
}

// ─── Site Operations ───
model SiteDiary {
  id           String   @id @default(uuid())
  projectId    String
  date         DateTime
  weather      String?
  workers      Int      @default(0)
  visitors     String?
  workDone     String?
  issues       String?
  instructions String?

  project Project @relation(fields: [projectId], references: [id])
  @@index([projectId])
}
EOF

# ─── Frontend placeholder ───
echo "⚛️  Setting up frontend placeholder..."
mkdir -p frontend

cat > frontend/README.md << 'EOF'
# PMcopilots Frontend

## Setup with shadcn/ui Admin Template

Run these commands to scaffold the frontend:

```bash
# Option 1: Clone shadcn-admin (recommended)
npx degit salimi-my/shadcn-admin frontend-temp
cp -r frontend-temp/* .
rm -rf frontend-temp
npm install

# Option 2: Start fresh with Vite + shadcn/ui
npm create vite@latest . -- --template react-ts
npm install
npx shadcn@latest init
npx shadcn@latest add sidebar-07  # collapsible sidebar
npx shadcn@latest add table card chart dialog sheet tabs badge avatar dropdown-menu
npm install recharts @tanstack/react-table zustand axios socket.io-client
```

## Key Packages
- `shadcn/ui` — Component library (copy-paste, you own the code)
- `recharts` — Charts (S-curves, bar charts, EVM)
- `@tanstack/react-table` — Data tables for 50+ module views
- `zustand` — Lightweight state management
- `axios` — API client
- `socket.io-client` — Real-time dashboard updates

## Available Scripts
- `npm run dev` — Start dev server (http://localhost:5173)
- `npm run build` — Production build
EOF

echo ""
echo "✅ PMcopilots project scaffolded!"
echo ""
echo "Next steps:"
echo "  1. cd backend && cp .env.example .env && edit .env with your DB credentials"
echo "  2. cd backend && npm install && npx prisma migrate dev --name init"
echo "  3. cd frontend && follow README.md to set up shadcn-admin template"
echo "  4. Start building! Backend: npm run dev | Frontend: npm run dev"
