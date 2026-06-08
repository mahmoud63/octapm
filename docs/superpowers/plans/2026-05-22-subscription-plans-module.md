# Subscription Plans Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Subscription Plans module from the PM Copilots BRD — 7-day trial with mandatory card-on-file, three paid tiers, 3-step checkout, payment validation/decline handling, cancellation, enterprise seat qualification, transaction history, trial-reminder emails, and feature gating — on top of the existing Express/Prisma/React stack.

**Architecture:** A single `Subscription` row per `Organisation` is the source of truth. Real **Stripe** handles money: a SetupIntent validates and saves the card during the trial (no charge); a Stripe Subscription is created only when the user picks a paid plan. Stripe **webhooks** keep our `Subscription`/`Invoice` rows in sync. A daily **scheduler** sends trial reminders and expires lapsed trials. A `subscriptionGate` middleware enforces read-only mode; per-route checks enforce project and AI-generation caps. Emails go through a **stub** email service (logs now, swap provider later).

**Tech Stack:** Node 20, Express 4, Prisma 6, `stripe` SDK, Jest, React 19, TanStack Query 5, `@stripe/stripe-js` + `@stripe/react-stripe-js`, axios, zod, shadcn/ui.

---

## Design Resolutions (read before starting)

The BRD has one internal contradiction. Page 6 says the card "will be
automatically charged at the end of the trial," but the **dominant** spec (pages
6–7, mockups) says trial-end → **lock features** → user must actively pick a plan
and complete checkout. **This plan implements the dominant flow: no auto-charge.**
Trial = card validated + saved (Stripe SetupIntent) + 7 days of access. At day 8
the trial is locked; the user subscribes manually. Flag this with the user if a
true auto-charge is wanted.

**Plan catalog** (code constants — plans are fixed, not user-data):

| Plan | rank | Projects | AI gen/mo | Seats | Monthly | Annual (/mo, −20%) |
|---|---|---|---|---|---|---|
| trial | 0 | 1 | 3 | 1 | — | — |
| individual | 1 | 3 | 10 | 1 | $49 | $39 |
| business | 2 | 25 | 150 | 10 | $499 | $399 |
| enterprise | 3 | ∞ | ∞ | ∞ | custom | custom |

Annual = `round(monthly × 0.8)`. Confirm exact figures with finance before launch.

**Subscription status values:** `incomplete` (registered, no card — no access) ·
`trialing` (in 7-day trial) · `active` (paid) · `past_due` (renewal charge failed,
Stripe retrying — keeps access, shows banner) · `canceled` (cancel-at-period-end
set, still inside paid period) · `expired` (trial lapsed or canceled period
elapsed — read-only). `hasAccess` = status ∈ {`trialing`,`active`,`past_due`,`canceled`}.

**Required environment variables** (`backend/.env`):
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_INDIVIDUAL_MONTHLY=price_...
STRIPE_PRICE_INDIVIDUAL_ANNUAL=price_...
STRIPE_PRICE_BUSINESS_MONTHLY=price_...
STRIPE_PRICE_BUSINESS_ANNUAL=price_...
```
`frontend/.env`: `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...`

**Prerequisite (manual, before Task 3):** In the Stripe dashboard create two
Products (Individual, Business), each with a monthly and an annual recurring
Price, and copy the four `price_...` IDs into `backend/.env`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `backend/prisma/schema.prisma` | `Subscription`, `PaymentMethod`, `Invoice`, `EnterpriseLead` models | Modify |
| `backend/src/config/plans.js` | Plan catalog + limits + Stripe price-ID map | Create |
| `backend/src/config/stripe.js` | Stripe SDK singleton | Create |
| `backend/src/services/email.service.js` | Stub email sender | Create |
| `backend/src/services/subscription.service.js` | All subscription business logic | Create |
| `backend/src/routes/billing.js` | `/api/v1/billing/*` endpoints | Create |
| `backend/src/routes/stripe-webhook.js` | `POST /api/v1/webhooks/stripe` (raw body) | Create |
| `backend/src/middleware/subscription-gate.js` | Read-only gate + project/AI caps | Create |
| `backend/src/jobs/billing-scheduler.js` | Daily trial-reminder + expiry job | Create |
| `backend/src/services/auth.service.js` | Create `Subscription` row on register | Modify |
| `backend/src/index.js` | Mount webhook (raw), billing routes, gate, scheduler | Modify |
| `backend/src/routes/projects.js` | Project-cap check on `POST /` | Modify |
| `backend/src/services/boq.service.js` | AI-generation cap check on upload | Modify |
| `frontend/src/services/billing/api.ts` + `types.ts` | Billing API client | Create |
| `frontend/src/features/billing/hooks/use-billing.ts` | TanStack Query hooks | Create |
| `frontend/src/features/billing/components/*` | Plans, checkout, billing tab, dialogs, banner | Create |
| `frontend/src/routes/_authenticated/billing/*` | Routes for plans + checkout | Create |
| `frontend/src/routes/_authenticated/settings/billing.tsx` | Billing settings tab | Create |

---

## Task 1: Database Schema — Subscription, PaymentMethod, Invoice, EnterpriseLead

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add the `subscription` + `enterpriseLeads` relations to `Organisation`**

In the `Organisation` model, add inside the relations block:
```prisma
  subscription    Subscription?
  enterpriseLeads EnterpriseLead[]
```

- [ ] **Step 2: Append the four new models at the end of `schema.prisma`**

```prisma
// ─── Subscription & Billing ───
model Subscription {
  id                   String    @id @default(uuid())
  orgId                String    @unique
  plan                 String    @default("trial")      // trial, individual, business, enterprise
  billingCycle         String?                          // monthly, annual
  status               String    @default("incomplete") // incomplete, trialing, active, past_due, canceled, expired
  seats                Int       @default(1)
  trialStartsAt        DateTime?
  trialEndsAt          DateTime?
  currentPeriodEnd     DateTime?
  cancelAtPeriodEnd    Boolean   @default(false)
  canceledAt           DateTime?
  aiGenerationsUsed    Int       @default(0)
  periodResetAt        DateTime?
  reminderDay5SentAt   DateTime?
  reminderDay7SentAt   DateTime?
  stripeCustomerId     String?
  stripeSubscriptionId String?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  org            Organisation    @relation(fields: [orgId], references: [id])
  paymentMethods PaymentMethod[]
  invoices       Invoice[]

  @@index([status])
  @@index([trialEndsAt])
}

model PaymentMethod {
  id                    String   @id @default(uuid())
  subscriptionId        String
  stripePaymentMethodId String
  brand                 String?
  last4                 String?
  expMonth              Int?
  expYear               Int?
  isDefault             Boolean  @default(true)
  createdAt             DateTime @default(now())

  subscription Subscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)

  @@index([subscriptionId])
}

model Invoice {
  id              String   @id @default(uuid())
  subscriptionId  String
  description     String
  amount          Float    @default(0)
  currency        String   @default("USD")
  status          String   @default("paid") // paid, failed
  periodLabel     String?
  stripeInvoiceId String?
  createdAt       DateTime @default(now())

  subscription Subscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)

  @@index([subscriptionId])
}

model EnterpriseLead {
  id        String   @id @default(uuid())
  orgId     String
  seatsBand String   // lte_100, gt_100
  status    String   @default("new") // new, contacted, closed
  createdAt DateTime @default(now())

  org Organisation @relation(fields: [orgId], references: [id])

  @@index([orgId])
}
```

- [ ] **Step 3: Run the migration**

Run:
```bash
cd backend && npx prisma migrate dev --name add_subscription_module
```
Expected: migration applied, Prisma client regenerated, no errors.

- [ ] **Step 4: Verify the client picked up the models**

Run:
```bash
cd backend && node -e "const{prisma}=require('./src/config/db');prisma.subscription.count().then(n=>{console.log('subscriptions:',n);process.exit(0)})"
```
Expected: `subscriptions: 0`.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(billing): add Subscription, PaymentMethod, Invoice, EnterpriseLead schema"
```

---

## Task 2: Plan Catalog + Email Stub Service

**Files:**
- Create: `backend/src/config/plans.js`
- Create: `backend/src/services/email.service.js`
- Create: `backend/src/config/__tests__/plans.test.js`

- [ ] **Step 1: Write the failing test `backend/src/config/__tests__/plans.test.js`**

```js
const { PLANS, planRank, getVisiblePlanIds, getPrice } = require('../plans');

describe('plan catalog', () => {
  it('ranks plans low→high', () => {
    expect(planRank('trial')).toBeLessThan(planRank('individual'));
    expect(planRank('individual')).toBeLessThan(planRank('business'));
    expect(planRank('business')).toBeLessThan(planRank('enterprise'));
  });

  it('annual price is 20% off monthly', () => {
    expect(getPrice('individual', 'monthly')).toBe(49);
    expect(getPrice('individual', 'annual')).toBe(39);
    expect(getPrice('business', 'monthly')).toBe(499);
    expect(getPrice('business', 'annual')).toBe(399);
  });
});

describe('getVisiblePlanIds', () => {
  it('shows all three paid tiers for a user with no active plan', () => {
    expect(getVisiblePlanIds(null)).toEqual(['individual', 'business', 'enterprise']);
    expect(getVisiblePlanIds('trial')).toEqual(['individual', 'business', 'enterprise']);
  });

  it('shows current + next-higher only for an active subscriber', () => {
    expect(getVisiblePlanIds('individual')).toEqual(['individual', 'business']);
    expect(getVisiblePlanIds('business')).toEqual(['business', 'enterprise']);
  });

  it('shows only the current plan at the highest tier', () => {
    expect(getVisiblePlanIds('enterprise')).toEqual(['enterprise']);
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `cd backend && npm test -- plans`
Expected: FAIL — `Cannot find module '../plans'`.

- [ ] **Step 3: Create `backend/src/config/plans.js`**

```js
// Fixed plan catalog. Limits drive feature gating; prices drive checkout display.
const PLANS = {
  trial: {
    id: 'trial', name: 'Trial', rank: 0,
    projectLimit: 1, aiLimit: 3, seats: 1,
    monthly: null, annual: null,
  },
  individual: {
    id: 'individual', name: 'Individual', rank: 1,
    projectLimit: 3, aiLimit: 10, seats: 1,
    monthly: 49, annual: 39,
  },
  business: {
    id: 'business', name: 'Business', rank: 2,
    projectLimit: 25, aiLimit: 150, seats: 10,
    monthly: 499, annual: 399,
  },
  enterprise: {
    id: 'enterprise', name: 'Enterprise', rank: 3,
    projectLimit: Infinity, aiLimit: Infinity, seats: Infinity,
    monthly: null, annual: null,
  },
};

const PAID_PLAN_ORDER = ['individual', 'business', 'enterprise'];

// Stripe price IDs by plan + cycle (set in backend/.env).
const STRIPE_PRICE_IDS = {
  individual: {
    monthly: process.env.STRIPE_PRICE_INDIVIDUAL_MONTHLY,
    annual: process.env.STRIPE_PRICE_INDIVIDUAL_ANNUAL,
  },
  business: {
    monthly: process.env.STRIPE_PRICE_BUSINESS_MONTHLY,
    annual: process.env.STRIPE_PRICE_BUSINESS_ANNUAL,
  },
};

function planRank(planId) {
  return PLANS[planId]?.rank ?? -1;
}

function getPrice(planId, cycle) {
  return PLANS[planId]?.[cycle] ?? null;
}

function getStripePriceId(planId, cycle) {
  return STRIPE_PRICE_IDS[planId]?.[cycle] ?? null;
}

/**
 * BRD plan-display rules:
 * - no active plan (null) or still on trial → all three paid tiers
 * - active subscriber → current plan + the next higher plan only
 * - highest tier → current plan only
 */
function getVisiblePlanIds(currentPlanId) {
  if (!currentPlanId || currentPlanId === 'trial') {
    return [...PAID_PLAN_ORDER];
  }
  const idx = PAID_PLAN_ORDER.indexOf(currentPlanId);
  if (idx === -1) return [...PAID_PLAN_ORDER];
  return PAID_PLAN_ORDER.slice(idx, idx + 2);
}

module.exports = {
  PLANS, PAID_PLAN_ORDER, STRIPE_PRICE_IDS,
  planRank, getPrice, getStripePriceId, getVisiblePlanIds,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm test -- plans`
Expected: PASS — all assertions green.

- [ ] **Step 5: Create the email stub `backend/src/services/email.service.js`**

```js
// Stub email service. Logs instead of sending. Swap the body of `sendEmail`
// for a real provider (SendGrid / SES) later — the interface stays the same.
async function sendEmail({ to, subject, body }) {
  console.log(`[email] → ${to} | ${subject}\n${body}\n`);
  return { delivered: true, to, subject };
}

const templates = {
  trialEndingIn2Days: (orgName) => ({
    subject: 'Your trial ends in 2 days',
    body: `Hi ${orgName}, your PM Copilots free trial ends in 2 days. Add a plan to keep your projects active.`,
  }),
  trialEndsTomorrow: (orgName) => ({
    subject: 'Your trial ends tomorrow',
    body: `Hi ${orgName}, your PM Copilots free trial ends tomorrow. Subscribe now to avoid losing access.`,
  }),
  subscriptionCanceled: (orgName, planName, endDate) => ({
    subject: 'Your subscription has been canceled',
    body: `Hi ${orgName}, your ${planName} subscription is canceled and will stay active until ${endDate}. Your project data is retained for 90 days.`,
  }),
  invoicePaid: (orgName, description, amount) => ({
    subject: 'Payment receipt',
    body: `Hi ${orgName}, we received your payment of $${amount} for ${description}. Thank you.`,
  }),
};

module.exports = { sendEmail, templates };
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/config/plans.js backend/src/config/__tests__/plans.test.js backend/src/services/email.service.js
git commit -m "feat(billing): plan catalog with display rules + stub email service"
```

---

## Task 3: Stripe SDK Singleton

**Files:**
- Modify: `backend/package.json` (add `stripe`)
- Create: `backend/src/config/stripe.js`

- [ ] **Step 1: Install the Stripe SDK**

Run: `cd backend && npm install stripe`
Expected: `stripe` added to `dependencies`.

- [ ] **Step 2: Create `backend/src/config/stripe.js`**

```js
const Stripe = require('stripe');
const { HttpError } = require('../utils/http-error');

let stripeClient = null;

function getStripe() {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new HttpError(500, 'CONFIG_ERROR', 'STRIPE_SECRET_KEY is not set');
  }
  stripeClient = new Stripe(key, { apiVersion: '2024-06-20' });
  return stripeClient;
}

module.exports = { getStripe };
```

- [ ] **Step 3: Verify the key loads**

With `STRIPE_SECRET_KEY` set in `backend/.env`, run:
```bash
cd backend && node -e "require('dotenv').config();const{getStripe}=require('./src/config/stripe');getStripe().customers.list({limit:1}).then(()=>{console.log('stripe ok');process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})"
```
Expected: `stripe ok`.

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/config/stripe.js
git commit -m "feat(billing): add Stripe SDK singleton"
```

---

## Task 4: Subscription Service — Core (read, ensure, plan display)

**Files:**
- Create: `backend/src/services/subscription.service.js`
- Modify: `backend/src/services/auth.service.js`

- [ ] **Step 1: Create `backend/src/services/subscription.service.js` with the core helpers**

```js
const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { getStripe } = require('../config/stripe');
const {
  PLANS, planRank, getPrice, getStripePriceId, getVisiblePlanIds,
} = require('../config/plans');
const { sendEmail, templates } = require('./email.service');

const TRIAL_DAYS = 7;
const ACCESS_STATUSES = ['trialing', 'active', 'past_due', 'canceled'];

const addDays = (date, days) =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

// Create an `incomplete` subscription row for a brand-new org.
async function ensureSubscription(orgId, tx = prisma) {
  const existing = await tx.subscription.findUnique({ where: { orgId } });
  if (existing) return existing;
  return tx.subscription.create({ data: { orgId, plan: 'trial', status: 'incomplete' } });
}

function isExpired(sub) {
  if (!sub) return true;
  if (!ACCESS_STATUSES.includes(sub.status)) return true;
  if (sub.status === 'trialing' && sub.trialEndsAt && new Date() > sub.trialEndsAt) {
    return true;
  }
  if (sub.status === 'canceled' && sub.currentPeriodEnd && new Date() > sub.currentPeriodEnd) {
    return true;
  }
  return false;
}

function serializeSubscription(sub, paymentMethod = null) {
  if (!sub) return null;
  const plan = PLANS[sub.plan] ?? PLANS.trial;
  return {
    id: sub.id,
    plan: sub.plan,
    planName: plan.name,
    billingCycle: sub.billingCycle,
    status: sub.status,
    hasAccess: !isExpired(sub),
    seats: sub.seats,
    projectLimit: plan.projectLimit === Infinity ? null : plan.projectLimit,
    aiLimit: plan.aiLimit === Infinity ? null : plan.aiLimit,
    aiGenerationsUsed: sub.aiGenerationsUsed,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    paymentMethod: paymentMethod
      ? { brand: paymentMethod.brand, last4: paymentMethod.last4,
          expMonth: paymentMethod.expMonth, expYear: paymentMethod.expYear }
      : null,
  };
}

async function getCurrentSubscription(orgId) {
  const sub = await ensureSubscription(orgId);
  const pm = await prisma.paymentMethod.findFirst({
    where: { subscriptionId: sub.id, isDefault: true },
  });
  return serializeSubscription(sub, pm);
}

// BRD plan-display rules: visible tiers depend on the user's current plan.
async function getPlansForOrg(orgId) {
  const sub = await ensureSubscription(orgId);
  const currentPlan =
    sub.status === 'active' || sub.status === 'canceled' || sub.status === 'past_due'
      ? sub.plan
      : null;
  const visibleIds = getVisiblePlanIds(currentPlan);

  return {
    currentPlan,
    plans: visibleIds.map((id) => {
      const p = PLANS[id];
      return {
        id, name: p.name,
        projectLimit: p.projectLimit === Infinity ? null : p.projectLimit,
        aiLimit: p.aiLimit === Infinity ? null : p.aiLimit,
        seats: p.seats === Infinity ? null : p.seats,
        monthly: getPrice(id, 'monthly'),
        annual: getPrice(id, 'annual'),
        isCurrent: id === currentPlan,
        isEnterprise: id === 'enterprise',
      };
    }),
  };
}

module.exports = {
  TRIAL_DAYS, ACCESS_STATUSES, addDays,
  ensureSubscription, isExpired, serializeSubscription,
  getCurrentSubscription, getPlansForOrg,
  // extended in Tasks 5–6:
};
```

- [ ] **Step 2: Create the `incomplete` subscription row on registration**

In `backend/src/services/auth.service.js`, import the helper at the top:
```js
const { ensureSubscription } = require('./subscription.service');
```
Then in `register`, inside the existing `prisma.$transaction` callback, after
`createdUser` is created, add:
```js
    await ensureSubscription(createdOrg.id, tx);
```
So every new org has a `Subscription` row in `incomplete` status.

- [ ] **Step 3: Verify**

Register a fresh org via `POST /auth/register`, then:
```bash
cd backend && node -e "const{prisma}=require('./src/config/db');prisma.subscription.findMany().then(r=>{console.log(r.map(s=>s.status));process.exit(0)})"
```
Expected: array includes `'incomplete'` for the new org.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/subscription.service.js backend/src/services/auth.service.js
git commit -m "feat(billing): subscription service core + create row on register"
```

---

## Task 5: Trial Activation (Stripe Customer + SetupIntent)

BRD: a valid card must be on file before the trial starts. We create a Stripe
Customer and a **SetupIntent** (validates + saves the card, no charge); after the
client confirms it, we attach the payment method and start the 7-day trial.

**Files:**
- Modify: `backend/src/services/subscription.service.js`

- [ ] **Step 1: Add `startTrialSetup` and `confirmTrial` to `subscription.service.js`**

Add before `module.exports`:
```js
// Step 1 of trial: ensure a Stripe customer + return a SetupIntent client secret.
async function startTrialSetup(orgId) {
  const sub = await ensureSubscription(orgId);
  if (sub.status !== 'incomplete' && sub.status !== 'expired') {
    throw new HttpError(409, 'TRIAL_NOT_AVAILABLE', 'Trial is not available for this account');
  }

  const stripe = getStripe();
  let customerId = sub.stripeCustomerId;
  if (!customerId) {
    const org = await prisma.organisation.findUnique({ where: { id: orgId } });
    const customer = await stripe.customers.create({
      name: org?.name ?? 'PM Copilots org',
      metadata: { orgId },
    });
    customerId = customer.id;
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ['card'],
    usage: 'off_session',
  });

  return { clientSecret: setupIntent.client_secret };
}

// Step 2 of trial: card confirmed client-side → save PM, start the 7-day trial.
async function confirmTrial(orgId, stripePaymentMethodId) {
  const sub = await ensureSubscription(orgId);
  if (sub.status !== 'incomplete' && sub.status !== 'expired') {
    throw new HttpError(409, 'TRIAL_NOT_AVAILABLE', 'Trial already started');
  }
  if (!stripePaymentMethodId) {
    throw new HttpError(400, 'PAYMENT_METHOD_REQUIRED', 'A payment method is required');
  }

  const stripe = getStripe();
  // Attach to the customer + verify it is a real, usable card.
  await stripe.paymentMethods.attach(stripePaymentMethodId, {
    customer: sub.stripeCustomerId,
  });
  const pm = await stripe.paymentMethods.retrieve(stripePaymentMethodId);
  await stripe.customers.update(sub.stripeCustomerId, {
    invoice_settings: { default_payment_method: stripePaymentMethodId },
  });

  const now = new Date();
  const trialEndsAt = addDays(now, TRIAL_DAYS);

  await prisma.$transaction(async (tx) => {
    await tx.paymentMethod.deleteMany({ where: { subscriptionId: sub.id } });
    await tx.paymentMethod.create({
      data: {
        subscriptionId: sub.id,
        stripePaymentMethodId,
        brand: pm.card?.brand ?? null,
        last4: pm.card?.last4 ?? null,
        expMonth: pm.card?.exp_month ?? null,
        expYear: pm.card?.exp_year ?? null,
        isDefault: true,
      },
    });
    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        plan: 'trial',
        status: 'trialing',
        trialStartsAt: now,
        trialEndsAt,
        periodResetAt: trialEndsAt,
        aiGenerationsUsed: 0,
        reminderDay5SentAt: null,
        reminderDay7SentAt: null,
      },
    });
  });

  return getCurrentSubscription(orgId);
}
```
Add `startTrialSetup` and `confirmTrial` to `module.exports`.

- [ ] **Step 2: Verify (Stripe test mode)**

Start the API. With a token for a freshly-registered org:
```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:5000/api/v1/billing/trial/start
```
(The route is built in Task 7 — verify there, or call `startTrialSetup` directly
in a `node -e` REPL.) Expected: a `clientSecret` beginning with `seti_..._secret_`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/subscription.service.js
git commit -m "feat(billing): trial activation via Stripe SetupIntent"
```

---

## Task 6: Subscribe, Cancel & Transaction History

**Files:**
- Modify: `backend/src/services/subscription.service.js`

- [ ] **Step 1: Add `subscribe`, `cancelSubscription`, `listInvoices`, `createEnterpriseLead`**

Add before `module.exports`:
```js
// Create (or upgrade) a paid Stripe subscription. Charges immediately.
async function subscribe(orgId, planId, billingCycle) {
  if (planId === 'enterprise') {
    throw new HttpError(400, 'ENTERPRISE_VIA_SALES', 'Enterprise plans are arranged via sales');
  }
  if (!PLANS[planId] || planId === 'trial') {
    throw new HttpError(400, 'INVALID_PLAN', 'Unknown plan');
  }
  if (!['monthly', 'annual'].includes(billingCycle)) {
    throw new HttpError(400, 'INVALID_CYCLE', 'billingCycle must be monthly or annual');
  }

  const sub = await ensureSubscription(orgId);
  const pm = await prisma.paymentMethod.findFirst({
    where: { subscriptionId: sub.id, isDefault: true },
  });
  if (!sub.stripeCustomerId || !pm) {
    throw new HttpError(400, 'PAYMENT_METHOD_REQUIRED', 'No payment method on file');
  }

  // No downgrades (BRD shows only current + higher).
  if (planRank(planId) < planRank(sub.plan) && sub.status === 'active') {
    throw new HttpError(400, 'DOWNGRADE_NOT_ALLOWED', 'Downgrades are not supported');
  }

  const priceId = getStripePriceId(planId, billingCycle);
  if (!priceId) {
    throw new HttpError(500, 'CONFIG_ERROR', `Missing Stripe price for ${planId}/${billingCycle}`);
  }

  const stripe = getStripe();
  let stripeSub;

  if (sub.stripeSubscriptionId && sub.status === 'active') {
    // Upgrade: swap the price on the existing Stripe subscription (prorated).
    const current = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    stripeSub = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      items: [{ id: current.items.data[0].id, price: priceId }],
      proration_behavior: 'always_invoice',
      default_payment_method: pm.stripePaymentMethodId,
    });
  } else {
    // New paid subscription — first invoice charged now.
    stripeSub = await stripe.subscriptions.create({
      customer: sub.stripeCustomerId,
      items: [{ price: priceId }],
      default_payment_method: pm.stripePaymentMethodId,
      payment_behavior: 'error_if_incomplete', // fail fast on a declined card
      expand: ['latest_invoice'],
    });
  }

  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      plan: planId,
      billingCycle,
      status: 'active',
      stripeSubscriptionId: stripeSub.id,
      currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      aiGenerationsUsed: 0,
      periodResetAt: new Date(stripeSub.current_period_end * 1000),
    },
  });

  return getCurrentSubscription(orgId);
}

// Cancel at period end — access continues until currentPeriodEnd.
async function cancelSubscription(orgId) {
  const sub = await ensureSubscription(orgId);
  if (sub.status !== 'active' || !sub.stripeSubscriptionId) {
    throw new HttpError(400, 'NO_ACTIVE_SUBSCRIPTION', 'No active subscription to cancel');
  }

  const stripe = getStripe();
  await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  const updated = await prisma.subscription.update({
    where: { id: sub.id },
    data: { status: 'canceled', cancelAtPeriodEnd: true, canceledAt: new Date() },
  });

  const org = await prisma.organisation.findUnique({ where: { id: orgId } });
  const planName = PLANS[updated.plan]?.name ?? updated.plan;
  const endDate = updated.currentPeriodEnd
    ? updated.currentPeriodEnd.toISOString().slice(0, 10)
    : 'the end of the billing period';
  const tpl = templates.subscriptionCanceled(org?.name ?? 'there', planName, endDate);
  await sendEmail({ to: orgEmail(orgId), ...tpl });

  return getCurrentSubscription(orgId);
}

// Helper: the org's PM email (first pm-role user).
async function orgEmail(orgId) {
  const user = await prisma.user.findFirst({
    where: { orgId, role: 'pm' },
    orderBy: { createdAt: 'asc' },
  });
  return user?.email ?? 'unknown@pmcopilots.local';
}

async function listInvoices(orgId) {
  const sub = await ensureSubscription(orgId);
  const invoices = await prisma.invoice.findMany({
    where: { subscriptionId: sub.id },
    orderBy: { createdAt: 'desc' },
  });
  return invoices.map((i) => ({
    id: i.id,
    date: i.createdAt,
    description: i.description,
    amount: i.amount,
    currency: i.currency,
    status: i.status,
  }));
}

async function createEnterpriseLead(orgId, seatsBand) {
  if (!['lte_100', 'gt_100'].includes(seatsBand)) {
    throw new HttpError(400, 'INVALID_SEATS_BAND', 'seatsBand must be lte_100 or gt_100');
  }
  const lead = await prisma.enterpriseLead.create({ data: { orgId, seatsBand } });
  return { id: lead.id, seatsBand: lead.seatsBand, status: lead.status };
}
```
> `orgEmail` is declared with `function` so hoisting makes it usable above.
Add `subscribe`, `cancelSubscription`, `listInvoices`, `createEnterpriseLead` to
`module.exports`.

- [ ] **Step 2: Verify a decline is surfaced**

`payment_behavior: 'error_if_incomplete'` makes Stripe throw a `StripeCardError`
when the card is declined. Confirm the route layer (Task 7) maps that to a clean
error — verified at the end of Task 7.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/subscription.service.js
git commit -m "feat(billing): subscribe, cancel, transaction history, enterprise lead"
```

---

## Task 7: Billing Routes

**Files:**
- Create: `backend/src/routes/billing.js`
- Modify: `backend/src/index.js`

- [ ] **Step 1: Create `backend/src/routes/billing.js`**

```js
const express = require('express');
const { body } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { HttpError } = require('../utils/http-error');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const subscriptionService = require('../services/subscription.service');

const router = express.Router();
router.use(authenticate);

// Map Stripe card errors to clean API errors (BRD payment-failure rules).
const handleStripeError = (err) => {
  if (err?.type === 'StripeCardError') {
    const declineMsg = 'Your card was declined. Please contact your card issuer.';
    return new HttpError(402, 'CARD_DECLINED', declineMsg);
  }
  return err;
};

router.get(
  '/subscription',
  asyncHandler(async (req, res) => {
    const data = await subscriptionService.getCurrentSubscription(req.user.orgId);
    return sendSuccess(res, data);
  }),
);

router.get(
  '/plans',
  asyncHandler(async (req, res) => {
    const data = await subscriptionService.getPlansForOrg(req.user.orgId);
    return sendSuccess(res, data);
  }),
);

router.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    const data = await subscriptionService.listInvoices(req.user.orgId);
    return sendSuccess(res, data);
  }),
);

router.post(
  '/trial/start',
  requireRoles('pm'),
  asyncHandler(async (req, res) => {
    const data = await subscriptionService.startTrialSetup(req.user.orgId);
    return sendSuccess(res, data);
  }),
);

router.post(
  '/trial/confirm',
  requireRoles('pm'),
  [body('paymentMethodId').isString().notEmpty(), validate],
  asyncHandler(async (req, res) => {
    try {
      const data = await subscriptionService.confirmTrial(
        req.user.orgId, req.body.paymentMethodId,
      );
      return sendSuccess(res, data);
    } catch (err) {
      throw handleStripeError(err);
    }
  }),
);

router.post(
  '/subscribe',
  requireRoles('pm'),
  [
    body('plan').isIn(['individual', 'business']),
    body('billingCycle').isIn(['monthly', 'annual']),
    validate,
  ],
  asyncHandler(async (req, res) => {
    try {
      const data = await subscriptionService.subscribe(
        req.user.orgId, req.body.plan, req.body.billingCycle,
      );
      return sendSuccess(res, data);
    } catch (err) {
      throw handleStripeError(err);
    }
  }),
);

router.post(
  '/cancel',
  requireRoles('pm'),
  asyncHandler(async (req, res) => {
    const data = await subscriptionService.cancelSubscription(req.user.orgId);
    return sendSuccess(res, data);
  }),
);

router.post(
  '/enterprise-lead',
  requireRoles('pm'),
  [body('seatsBand').isIn(['lte_100', 'gt_100']), validate],
  asyncHandler(async (req, res) => {
    const data = await subscriptionService.createEnterpriseLead(
      req.user.orgId, req.body.seatsBand,
    );
    return sendSuccess(res, data, 201);
  }),
);

module.exports = router;
```

- [ ] **Step 2: Mount the route in `backend/src/index.js`**

Add the require near the other route imports:
```js
const billingRoutes = require('./routes/billing');
```
Add the mount alongside the other `app.use('/api/v1/...')` lines:
```js
app.use('/api/v1/billing', billingRoutes);
```

- [ ] **Step 3: Verify the full trial flow**

Start the API. With a fresh PM token:
```bash
# 1. Start trial → get a SetupIntent client secret
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:5000/api/v1/billing/trial/start
# 2. Confirm the SetupIntent client-side with Stripe test card 4242 4242 4242 4242,
#    then send the resulting payment_method id:
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"paymentMethodId":"pm_..."}' \
  http://localhost:5000/api/v1/billing/trial/confirm
```
Expected: step 2 returns the subscription with `status:"trialing"`, a 7-day
`trialEndsAt`, and `paymentMethod.last4:"4242"`.
`GET /billing/plans` for this org → Expected: all three tiers (no active plan yet).

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/billing.js backend/src/index.js
git commit -m "feat(billing): /billing routes — subscription, plans, trial, subscribe, cancel"
```

---

## Task 8: Stripe Webhook Handler

Stripe webhooks keep our rows in sync with real billing events. The webhook
needs the **raw** request body for signature verification, so it must be mounted
**before** `express.json()`.

**Files:**
- Create: `backend/src/routes/stripe-webhook.js`
- Modify: `backend/src/index.js`

- [ ] **Step 1: Create `backend/src/routes/stripe-webhook.js`**

```js
const express = require('express');
const { getStripe } = require('../config/stripe');
const { prisma } = require('../config/db');
const { sendEmail, templates } = require('../services/email.service');

const router = express.Router();

// Mounted with express.raw — `req.body` is a Buffer here.
router.post('/', async (req, res) => {
  const stripe = getStripe();
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, sig, process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const obj = event.data.object;

    if (event.type === 'invoice.paid') {
      const sub = await prisma.subscription.findFirst({
        where: { stripeCustomerId: obj.customer },
      });
      if (sub) {
        await prisma.invoice.create({
          data: {
            subscriptionId: sub.id,
            description: obj.lines?.data?.[0]?.description || 'Subscription payment',
            amount: (obj.amount_paid ?? 0) / 100,
            currency: (obj.currency ?? 'usd').toUpperCase(),
            status: 'paid',
            periodLabel: obj.lines?.data?.[0]?.period
              ? new Date(obj.lines.data[0].period.start * 1000).toISOString().slice(0, 7)
              : null,
            stripeInvoiceId: obj.id,
          },
        });
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status: 'active',
            currentPeriodEnd: obj.lines?.data?.[0]?.period
              ? new Date(obj.lines.data[0].period.end * 1000)
              : sub.currentPeriodEnd,
          },
        });
      }
    }

    if (event.type === 'invoice.payment_failed') {
      const sub = await prisma.subscription.findFirst({
        where: { stripeCustomerId: obj.customer },
      });
      if (sub) {
        await prisma.invoice.create({
          data: {
            subscriptionId: sub.id,
            description: 'Failed subscription payment',
            amount: (obj.amount_due ?? 0) / 100,
            currency: (obj.currency ?? 'usd').toUpperCase(),
            status: 'failed',
            stripeInvoiceId: obj.id,
          },
        });
        await prisma.subscription.update({
          where: { id: sub.id }, data: { status: 'past_due' },
        });
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: obj.id },
      });
      if (sub) {
        await prisma.subscription.update({
          where: { id: sub.id }, data: { status: 'expired' },
        });
      }
    }
  } catch (err) {
    console.error('[stripe-webhook] handler error:', err);
    return res.status(500).send('handler error');
  }

  return res.json({ received: true });
});

module.exports = router;
```

- [ ] **Step 2: Mount it BEFORE `express.json()` in `backend/src/index.js`**

In `index.js`, the webhook must be registered before `app.use(express.json(...))`.
Add the require with the others, then add this line **immediately before**
`app.use(express.json({ limit: '10mb' }));`:
```js
app.use(
  '/api/v1/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  require('./routes/stripe-webhook'),
);
```

- [ ] **Step 3: Verify with the Stripe CLI**

In one terminal: `stripe listen --forward-to localhost:5000/api/v1/webhooks/stripe`
— copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET`. In another:
```bash
stripe trigger invoice.paid
```
Expected: API logs no signature error; an `Invoice` row appears
(`prisma.invoice.count()` increments).

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/stripe-webhook.js backend/src/index.js
git commit -m "feat(billing): Stripe webhook handler for invoice + subscription events"
```

---

## Task 9: Feature-Gating Middleware

Enforce the BRD caps: trial-end read-only mode, the per-plan project limit, and
the per-plan AI-generation cap.

**Files:**
- Create: `backend/src/middleware/subscription-gate.js`
- Modify: `backend/src/index.js`
- Modify: `backend/src/routes/projects.js`
- Modify: `backend/src/services/boq.service.js`

- [ ] **Step 1: Create `backend/src/middleware/subscription-gate.js`**

```js
const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { PLANS } = require('../config/plans');
const { ensureSubscription, isExpired } = require('../services/subscription.service');

// Block all write requests when the subscription has lapsed (read-only mode).
// GET requests always pass; billing + auth routes are exempt (set up via mount).
const subscriptionGate = async (req, res, next) => {
  try {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }
    if (!req.user) return next();

    const sub = await ensureSubscription(req.user.orgId);
    if (isExpired(sub)) {
      return next(new HttpError(
        402, 'SUBSCRIPTION_REQUIRED',
        'Your trial or subscription has ended. Subscribe to continue.',
      ));
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

// Enforce the per-plan project cap before creating a project.
const enforceProjectLimit = async (req, res, next) => {
  try {
    const sub = await ensureSubscription(req.user.orgId);
    const limit = PLANS[sub.plan]?.projectLimit ?? 0;
    if (limit !== Infinity) {
      const count = await prisma.project.count({ where: { orgId: req.user.orgId } });
      if (count >= limit) {
        return next(new HttpError(
          402, 'PROJECT_LIMIT_REACHED',
          `Your ${PLANS[sub.plan]?.name ?? 'current'} plan allows ${limit} project(s). Upgrade to add more.`,
        ));
      }
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

// Called from the BOQ service before an AI generation run.
async function assertAiQuota(orgId) {
  const sub = await ensureSubscription(orgId);
  const limit = PLANS[sub.plan]?.aiLimit ?? 0;
  if (limit === Infinity) return;
  if (sub.aiGenerationsUsed >= limit) {
    throw new HttpError(
      402, 'AI_LIMIT_REACHED',
      `Your plan allows ${limit} AI generations per period. Upgrade for more.`,
    );
  }
}

async function incrementAiUsage(orgId) {
  await prisma.subscription.updateMany({
    where: { orgId },
    data: { aiGenerationsUsed: { increment: 1 } },
  });
}

module.exports = { subscriptionGate, enforceProjectLimit, assertAiQuota, incrementAiUsage };
```

- [ ] **Step 2: Mount the gate in `backend/src/index.js`**

Mount `subscriptionGate` so it runs after auth but does not block `/billing` or
`/auth`. Apply it directly on the project routes mount — replace:
```js
app.use('/api/v1/projects', projectRoutes);
```
with:
```js
const { subscriptionGate } = require('./middleware/subscription-gate');
app.use('/api/v1/projects', subscriptionGate, projectRoutes);
app.use('/api/v1/users', subscriptionGate, userRoutes);
```
> Note: `userRoutes` is already mounted further down — remove the later duplicate
> `app.use('/api/v1/users', userRoutes);` line so users is mounted once, with the
> gate. `/billing` and `/auth` are intentionally **not** gated.

- [ ] **Step 3: Enforce the project cap in `routes/projects.js`**

In `backend/src/routes/projects.js`, import the middleware at the top:
```js
const { enforceProjectLimit } = require('../middleware/subscription-gate');
```
Then add `enforceProjectLimit` to the `POST /` route, after `requireRoles`:
```js
router.post(
  '/',
  requireRoles('pm', 'planning_eng'),
  enforceProjectLimit,
  [
    // ...existing validators unchanged...
```

- [ ] **Step 4: Enforce the AI cap in `boq.service.js`**

In `backend/src/services/boq.service.js`, import at the top:
```js
const { assertAiQuota, incrementAiUsage } = require('../middleware/subscription-gate');
```
In `processBoqUpload`, the project's `orgId` is needed — fetch it and check the
quota **before** kicking off the AI job. Add at the start of `processBoqUpload`,
before "Step 1: Parse":
```js
  const project = await prisma.project.findUnique({
    where: { id: projectId }, select: { orgId: true },
  });
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  await assertAiQuota(project.orgId);
```
Then in `processBoqAiAsync`, after the AI message succeeds (right after
`const parsed = JSON.parse(jsonMatch[0]);`), record the usage:
```js
    const proj = await prisma.project.findUnique({
      where: { id: projectId }, select: { orgId: true },
    });
    if (proj) await incrementAiUsage(proj.orgId);
```

- [ ] **Step 5: Verify**

- With an `expired` subscription (set `status='expired'` via Prisma Studio), any
  `POST /api/v1/projects` → Expected: `402 SUBSCRIPTION_REQUIRED`. A `GET` still works.
- On the `trial` plan, create a 2nd project → Expected: `402 PROJECT_LIMIT_REACHED`.
- On `trial`, run a 4th BOQ AI upload → Expected: `402 AI_LIMIT_REACHED`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/middleware/subscription-gate.js backend/src/index.js backend/src/routes/projects.js backend/src/services/boq.service.js
git commit -m "feat(billing): feature gating — read-only mode, project + AI caps"
```

---

## Task 10: Trial-Reminder & Expiry Scheduler

**Files:**
- Create: `backend/src/jobs/billing-scheduler.js`
- Modify: `backend/src/index.js`

- [ ] **Step 1: Create `backend/src/jobs/billing-scheduler.js`**

```js
const { prisma } = require('../config/db');
const { sendEmail, templates } = require('../services/email.service');

const DAY = 24 * 60 * 60 * 1000;

// One pass: send day-5/day-7 reminders, expire lapsed trials + canceled periods.
async function runBillingChecks(now = new Date()) {
  // Trial reminders.
  const trials = await prisma.subscription.findMany({
    where: { status: 'trialing', trialEndsAt: { not: null } },
    include: { org: true },
  });

  for (const sub of trials) {
    const msLeft = sub.trialEndsAt.getTime() - now.getTime();

    if (msLeft <= 0) {
      await prisma.subscription.update({
        where: { id: sub.id }, data: { status: 'expired' },
      });
      continue;
    }
    // Day 5 → ~2 days left.
    if (msLeft <= 2 * DAY && !sub.reminderDay5SentAt) {
      const tpl = templates.trialEndingIn2Days(sub.org?.name ?? 'there');
      await sendEmail({ to: await pmEmail(sub.orgId), ...tpl });
      await prisma.subscription.update({
        where: { id: sub.id }, data: { reminderDay5SentAt: now },
      });
    }
    // Day 7 → ~1 day left.
    if (msLeft <= 1 * DAY && !sub.reminderDay7SentAt) {
      const tpl = templates.trialEndsTomorrow(sub.org?.name ?? 'there');
      await sendEmail({ to: await pmEmail(sub.orgId), ...tpl });
      await prisma.subscription.update({
        where: { id: sub.id }, data: { reminderDay7SentAt: now },
      });
    }
  }

  // Canceled subscriptions whose paid period has elapsed → expired.
  await prisma.subscription.updateMany({
    where: { status: 'canceled', currentPeriodEnd: { lt: now } },
    data: { status: 'expired' },
  });
}

async function pmEmail(orgId) {
  const u = await prisma.user.findFirst({
    where: { orgId, role: 'pm' }, orderBy: { createdAt: 'asc' },
  });
  return u?.email ?? 'unknown@pmcopilots.local';
}

// Run once on boot, then every 24h.
function startBillingScheduler() {
  runBillingChecks().catch((e) => console.error('[billing-scheduler]', e));
  setInterval(() => {
    runBillingChecks().catch((e) => console.error('[billing-scheduler]', e));
  }, DAY);
}

module.exports = { runBillingChecks, startBillingScheduler };
```

- [ ] **Step 2: Start the scheduler in `backend/src/index.js`**

Near the bottom, after `httpServer.listen(...)`, add:
```js
const { startBillingScheduler } = require('./jobs/billing-scheduler');
startBillingScheduler();
```

- [ ] **Step 3: Verify**

In Prisma Studio set a `trialing` subscription's `trialEndsAt` to 1 day from now,
then run:
```bash
cd backend && node -e "require('dotenv').config();require('./src/jobs/billing-scheduler').runBillingChecks().then(()=>process.exit(0))"
```
Expected: console logs the `[email]` "trial ends tomorrow" line; `reminderDay7SentAt`
is set. Set `trialEndsAt` to the past → re-run → `status` becomes `expired`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/jobs/billing-scheduler.js backend/src/index.js
git commit -m "feat(billing): daily scheduler for trial reminders + expiry"
```

---

## Task 11: Frontend — Stripe Deps, Billing API & Hooks

**Files:**
- Modify: `frontend/package.json` (add Stripe libs)
- Create: `frontend/src/services/billing/types.ts`
- Create: `frontend/src/services/billing/api.ts`
- Create: `frontend/src/features/billing/hooks/use-billing.ts`

- [ ] **Step 1: Install Stripe libraries**

Run: `cd frontend && npm install @stripe/stripe-js @stripe/react-stripe-js`

- [ ] **Step 2: Create `frontend/src/services/billing/types.ts`**

```ts
export type PlanId = 'trial' | 'individual' | 'business' | 'enterprise'
export type BillingCycle = 'monthly' | 'annual'
export type SubStatus =
  | 'incomplete' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'

export interface Subscription {
  id: string
  plan: PlanId
  planName: string
  billingCycle: BillingCycle | null
  status: SubStatus
  hasAccess: boolean
  seats: number
  projectLimit: number | null
  aiLimit: number | null
  aiGenerationsUsed: number
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  paymentMethod: {
    brand: string | null; last4: string | null
    expMonth: number | null; expYear: number | null
  } | null
}

export interface PlanCard {
  id: PlanId
  name: string
  projectLimit: number | null
  aiLimit: number | null
  seats: number | null
  monthly: number | null
  annual: number | null
  isCurrent: boolean
  isEnterprise: boolean
}

export interface PlansResponse {
  currentPlan: PlanId | null
  plans: PlanCard[]
}

export interface Transaction {
  id: string
  date: string
  description: string
  amount: number
  currency: string
  status: 'paid' | 'failed'
}
```

- [ ] **Step 3: Create `frontend/src/services/billing/api.ts`**

```ts
import { apiClient } from '@/services/api/client'
import type {
  Subscription, PlansResponse, Transaction, BillingCycle,
} from './types'

const unwrap = <T>(r: { data: { data: T } }): T => r.data.data

export const getSubscription = () =>
  apiClient.get('/billing/subscription').then(unwrap<Subscription>)

export const getPlans = () =>
  apiClient.get('/billing/plans').then(unwrap<PlansResponse>)

export const getTransactions = () =>
  apiClient.get('/billing/transactions').then(unwrap<Transaction[]>)

export const startTrial = () =>
  apiClient.post('/billing/trial/start').then(unwrap<{ clientSecret: string }>)

export const confirmTrial = (paymentMethodId: string) =>
  apiClient
    .post('/billing/trial/confirm', { paymentMethodId })
    .then(unwrap<Subscription>)

export const subscribe = (plan: 'individual' | 'business', billingCycle: BillingCycle) =>
  apiClient.post('/billing/subscribe', { plan, billingCycle }).then(unwrap<Subscription>)

export const cancelSubscription = () =>
  apiClient.post('/billing/cancel').then(unwrap<Subscription>)

export const createEnterpriseLead = (seatsBand: 'lte_100' | 'gt_100') =>
  apiClient.post('/billing/enterprise-lead', { seatsBand }).then(unwrap)
```

- [ ] **Step 4: Create `frontend/src/features/billing/hooks/use-billing.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as billingApi from '@/services/billing/api'
import type { BillingCycle } from '@/services/billing/types'

export const useSubscription = () =>
  useQuery({ queryKey: ['billing', 'subscription'], queryFn: billingApi.getSubscription })

export const usePlans = () =>
  useQuery({ queryKey: ['billing', 'plans'], queryFn: billingApi.getPlans })

export const useTransactions = () =>
  useQuery({ queryKey: ['billing', 'transactions'], queryFn: billingApi.getTransactions })

const invalidate = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ queryKey: ['billing'] })

export const useStartTrial = () =>
  useMutation({ mutationFn: billingApi.startTrial })

export const useConfirmTrial = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: billingApi.confirmTrial,
    onSuccess: () => invalidate(qc),
  })
}

export const useSubscribe = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ plan, billingCycle }: {
      plan: 'individual' | 'business'; billingCycle: BillingCycle
    }) => billingApi.subscribe(plan, billingCycle),
    onSuccess: () => invalidate(qc),
  })
}

export const useCancelSubscription = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: billingApi.cancelSubscription,
    onSuccess: () => invalidate(qc),
  })
}

export const useEnterpriseLead = () =>
  useMutation({ mutationFn: billingApi.createEnterpriseLead })
```

- [ ] **Step 5: Verify**

Run `cd frontend && npm run build` — Expected: TypeScript compiles, no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/services/billing frontend/src/features/billing/hooks
git commit -m "feat(billing): frontend Stripe deps, billing API client + hooks"
```

---

## Task 12: Frontend — Plans Page + Enterprise Seat Modal

**Files:**
- Create: `frontend/src/features/billing/components/plans-grid.tsx`
- Create: `frontend/src/features/billing/components/enterprise-seat-dialog.tsx`
- Create: `frontend/src/features/billing/index.tsx`
- Create: `frontend/src/routes/_authenticated/billing/index.tsx`

- [ ] **Step 1: Create `enterprise-seat-dialog.tsx`**

```tsx
import { useState } from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useEnterpriseLead } from '../hooks/use-billing'

type Band = 'lte_100' | 'gt_100'

export function EnterpriseSeatDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [band, setBand] = useState<Band>('lte_100')
  const lead = useEnterpriseLead()

  const submit = () =>
    lead.mutate(band, {
      onSuccess: () => {
        toast.success('Thanks — our sales team will contact you within one business day.')
        onOpenChange(false)
      },
      onError: () => toast.error('Could not submit. Please try again.'),
    })

  const options: { value: Band; title: string; sub: string }[] = [
    { value: 'lte_100', title: '100 seats or fewer', sub: 'Standard enterprise management and SSO.' },
    { value: 'gt_100', title: 'More than 100 seats', sub: 'Volume licensing and multi-department governance.' },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enterprise Seat Configuration</DialogTitle>
          <DialogDescription>
            Select your team’s scale to unlock dedicated resources and custom governance.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          {options.map((o) => (
            <button
              key={o.value}
              type='button'
              onClick={() => setBand(o.value)}
              className={`w-full rounded-lg border p-4 text-left transition ${
                band === o.value ? 'border-primary ring-primary/30 ring-2' : 'border-border'
              }`}
            >
              <div className='font-medium'>{o.title}</div>
              <div className='text-muted-foreground text-sm'>{o.sub}</div>
            </button>
          ))}
        </div>
        <Button onClick={submit} disabled={lead.isPending}>
          {lead.isPending ? 'Submitting…' : 'Contact Sales'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Create `plans-grid.tsx`**

```tsx
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check } from 'lucide-react'
import { usePlans } from '../hooks/use-billing'
import { EnterpriseSeatDialog } from './enterprise-seat-dialog'
import type { PlanCard } from '@/services/billing/types'

const FEATURES: Record<string, string[]> = {
  individual: ['Full access to all modules', 'BOQ to CPM generation', 'Cost and progress tracking', '1 user seat', 'Email support'],
  business: ['Everything in Individual', 'Up to 10 user seats', 'Team collaboration and roles', 'Priority support'],
  enterprise: ['Everything in Business', 'Unlimited user seats', 'SSO, SOC2, audit logs, SLA', 'Dedicated account manager'],
}

export function PlansGrid() {
  const { data, isLoading } = usePlans()
  const navigate = useNavigate()
  const [enterpriseOpen, setEnterpriseOpen] = useState(false)

  if (isLoading || !data) return <div className='p-8 text-center'>Loading plans…</div>

  return (
    <div className='space-y-6'>
      <div className='grid gap-6 md:grid-cols-3'>
        {data.plans.map((plan) => (
          <PlanColumn
            key={plan.id}
            plan={plan}
            features={FEATURES[plan.id] ?? []}
            onChoose={() => {
              if (plan.isEnterprise) setEnterpriseOpen(true)
              else if (!plan.isCurrent) {
                navigate({ to: '/billing/checkout', search: { plan: plan.id } })
              }
            }}
          />
        ))}
      </div>
      <EnterpriseSeatDialog open={enterpriseOpen} onOpenChange={setEnterpriseOpen} />
    </div>
  )
}

function PlanColumn({
  plan, features, onChoose,
}: { plan: PlanCard; features: string[]; onChoose: () => void }) {
  return (
    <Card className={plan.isCurrent ? 'border-muted' : 'border-primary'}>
      <CardHeader>
        <div className='flex items-center justify-between'>
          <CardTitle>{plan.name}</CardTitle>
          {plan.isCurrent && <Badge variant='secondary'>Current plan</Badge>}
        </div>
        <div className='text-3xl font-bold'>
          {plan.isEnterprise ? 'Custom' : `$${plan.monthly}`}
          {!plan.isEnterprise && <span className='text-muted-foreground text-base'> /mo</span>}
        </div>
        <p className='text-muted-foreground text-sm'>
          {plan.projectLimit ? `Up to ${plan.projectLimit} projects` : 'Custom project volume'}
        </p>
      </CardHeader>
      <CardContent className='space-y-4'>
        <ul className='space-y-2 text-sm'>
          {features.map((f) => (
            <li key={f} className='flex gap-2'>
              <Check className='text-primary h-4 w-4 shrink-0' /> {f}
            </li>
          ))}
        </ul>
        <Button
          className='w-full'
          variant={plan.isCurrent ? 'outline' : 'default'}
          disabled={plan.isCurrent}
          onClick={onChoose}
        >
          {plan.isCurrent ? 'Active' : plan.isEnterprise ? 'Get Enterprise plan' : `Choose ${plan.name}`}
        </Button>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Create `frontend/src/features/billing/index.tsx`**

```tsx
import { PlansGrid } from './components/plans-grid'

export function BillingPlansPage() {
  return (
    <div className='mx-auto max-w-5xl p-6'>
      <h1 className='text-2xl font-bold'>Choose your plan</h1>
      <p className='text-muted-foreground mb-6'>
        Upgrade for more projects, AI generations, and team seats.
      </p>
      <PlansGrid />
    </div>
  )
}
```

- [ ] **Step 4: Create the route `frontend/src/routes/_authenticated/billing/index.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { BillingPlansPage } from '@/features/billing'

export const Route = createFileRoute('/_authenticated/billing/')({
  component: BillingPlansPage,
})
```

- [ ] **Step 5: Verify**

Run `cd frontend && npm run dev`. Navigate to `/billing`. Expected: three plan
cards for a no-active-plan org; clicking "Get Enterprise plan" opens the seat
dialog; "Choose Business" navigates toward `/billing/checkout?plan=business`.
For an org already on Individual, expected: only Individual + Business render.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/billing frontend/src/routes/_authenticated/billing
git commit -m "feat(billing): plans page with display rules + enterprise seat dialog"
```

---

## Task 13: Frontend — 3-Step Checkout Wizard (Stripe Elements)

The wizard: Step 1 plan (from query param) → Step 2 billing cycle → Step 3
payment with Stripe `CardElement`. For an org still on trial with a saved card,
the SetupIntent step is skipped and `subscribe` is called directly.

**Files:**
- Create: `frontend/src/features/billing/components/checkout-wizard.tsx`
- Create: `frontend/src/features/billing/components/payment-form.tsx`
- Create: `frontend/src/routes/_authenticated/billing/checkout.tsx`
- Create: `frontend/src/lib/stripe.ts`

- [ ] **Step 1: Create `frontend/src/lib/stripe.ts`**

```ts
import { loadStripe } from '@stripe/stripe-js'

export const stripePromise = loadStripe(
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string
)
```

- [ ] **Step 2: Create `payment-form.tsx`**

```tsx
import { useState } from 'react'
import { CardElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

type Props = {
  /** When set, confirm this SetupIntent then call onReady with the PM id. */
  setupClientSecret?: string
  /** Called once a usable payment method exists (or immediately if card on file). */
  onConfirmed: () => void
  submitLabel: string
  busy: boolean
  /** Server-side error to surface (decline / validation). */
  serverError?: string | null
}

export function PaymentForm({
  setupClientSecret, onConfirmed, submitLabel, busy, serverError,
}: Props) {
  const stripe = useStripe()
  const elements = useElements()
  const [cardError, setCardError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const handleSubmit = async () => {
    setCardError(null)
    if (!setupClientSecret) {
      // Card already on file — skip Stripe, proceed.
      onConfirmed()
      return
    }
    if (!stripe || !elements) return
    const card = elements.getElement(CardElement)
    if (!card) return

    setConfirming(true)
    const result = await stripe.confirmCardSetup(setupClientSecret, {
      payment_method: { card },
    })
    setConfirming(false)

    if (result.error) {
      // BRD: field-validation vs issuer-decline messages.
      setCardError(result.error.message ?? 'Please check your card details.')
      return
    }
    onConfirmed()
  }

  return (
    <div className='space-y-4'>
      {setupClientSecret && (
        <div className='rounded-md border p-3'>
          <CardElement options={{ hidePostalCode: false }} />
        </div>
      )}
      {cardError && (
        <Alert variant='destructive'><AlertDescription>{cardError}</AlertDescription></Alert>
      )}
      {serverError && (
        <Alert variant='destructive'><AlertDescription>{serverError}</AlertDescription></Alert>
      )}
      <Button
        className='w-full'
        disabled={busy || confirming || (!!setupClientSecret && !stripe)}
        onClick={handleSubmit}
      >
        {busy || confirming ? 'Processing…' : submitLabel}
      </Button>
      <p className='text-muted-foreground text-center text-xs'>
        Secured by Stripe · 256-bit encryption
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Create `checkout-wizard.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Elements } from '@stripe/react-stripe-js'
import { stripePromise } from '@/lib/stripe'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { PaymentForm } from './payment-form'
import { useSubscription, useSubscribe, useStartTrial } from '../hooks/use-billing'
import type { BillingCycle } from '@/services/billing/types'

const PRICES = {
  individual: { monthly: 49, annual: 39 },
  business: { monthly: 499, annual: 399 },
}

export function CheckoutWizard({ plan }: { plan: 'individual' | 'business' }) {
  const navigate = useNavigate()
  const { data: sub } = useSubscription()
  const subscribe = useSubscribe()
  const startTrial = useStartTrial()

  const [step, setStep] = useState<2 | 3>(2)
  const [cycle, setCycle] = useState<BillingCycle>('monthly')
  const [setupSecret, setSetupSecret] = useState<string | undefined>(undefined)
  const [serverError, setServerError] = useState<string | null>(null)

  const hasCardOnFile = Boolean(sub?.paymentMethod?.last4)
  const price = PRICES[plan][cycle]

  // Move to payment: if no card on file, fetch a SetupIntent first.
  const goToPayment = async () => {
    setServerError(null)
    if (!hasCardOnFile) {
      try {
        const { clientSecret } = await startTrial.mutateAsync()
        setSetupSecret(clientSecret)
      } catch {
        toast.error('Could not start payment setup.')
        return
      }
    }
    setStep(3)
  }

  const finish = () => {
    setServerError(null)
    subscribe.mutate(
      { plan, billingCycle: cycle },
      {
        onSuccess: () => {
          toast.success('Subscription active. Welcome aboard!')
          navigate({ to: '/settings/billing' })
        },
        onError: (err: any) => {
          const code = err?.response?.data?.error?.code
          const msg = err?.response?.data?.error?.message
          setServerError(
            code === 'CARD_DECLINED'
              ? 'Your card was declined. Please contact your card issuer.'
              : msg || 'Payment failed. Please try again.'
          )
        },
      }
    )
  }

  const planName = plan === 'individual' ? 'Individual' : 'Business'

  return (
    <div className='mx-auto max-w-2xl space-y-6 p-6'>
      <h1 className='text-2xl font-bold'>Subscribe to {planName}</h1>

      {step === 2 && (
        <Card>
          <CardHeader><CardTitle>Step 2 of 3 · Choose billing cycle</CardTitle></CardHeader>
          <CardContent className='space-y-3'>
            {(['monthly', 'annual'] as BillingCycle[]).map((c) => (
              <button
                key={c}
                type='button'
                onClick={() => setCycle(c)}
                className={`w-full rounded-lg border p-4 text-left ${
                  cycle === c ? 'border-primary ring-primary/30 ring-2' : 'border-border'
                }`}
              >
                <div className='flex justify-between font-medium'>
                  <span className='capitalize'>{c}</span>
                  <span>${PRICES[plan][c]} /mo</span>
                </div>
                {c === 'annual' && (
                  <div className='text-sm text-green-600'>Save 20% · billed yearly</div>
                )}
              </button>
            ))}
            <Button className='w-full' onClick={goToPayment} disabled={startTrial.isPending}>
              {startTrial.isPending ? 'Preparing…' : 'Continue to payment'}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader><CardTitle>Step 3 of 3 · Payment</CardTitle></CardHeader>
          <CardContent className='space-y-4'>
            <div className='bg-muted rounded-md p-4 text-sm'>
              <div className='flex justify-between'>
                <span>{planName} · {cycle}</span><span>${price} /mo</span>
              </div>
              {hasCardOnFile && (
                <div className='text-muted-foreground mt-2'>
                  Using card on file ending {sub?.paymentMethod?.last4}
                </div>
              )}
            </div>
            <Elements stripe={stripePromise}>
              <PaymentForm
                setupClientSecret={setupSecret}
                onConfirmed={finish}
                submitLabel={`Pay $${price}`}
                busy={subscribe.isPending}
                serverError={serverError}
              />
            </Elements>
            <Button variant='ghost' className='w-full' onClick={() => setStep(2)}>
              Back
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
```
> `CardElement` is rendered inside `<Elements>`. When a card is already on file
> (`hasCardOnFile`), `setupSecret` stays undefined and `PaymentForm` skips Stripe
> and calls `onConfirmed` straight away — the one-click flow from BRD page 7.

- [ ] **Step 4: Create the route `frontend/src/routes/_authenticated/billing/checkout.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { CheckoutWizard } from '@/features/billing/components/checkout-wizard'

type CheckoutSearch = { plan: 'individual' | 'business' }

export const Route = createFileRoute('/_authenticated/billing/checkout')({
  validateSearch: (search: Record<string, unknown>): CheckoutSearch => ({
    plan: search.plan === 'business' ? 'business' : 'individual',
  }),
  component: function CheckoutRoute() {
    const { plan } = Route.useSearch()
    return <CheckoutWizard plan={plan} />
  },
})
```

- [ ] **Step 5: Verify (Stripe test cards)**

`npm run dev`. From `/billing` choose Business → pick Annual → Continue → enter
test card `4242 4242 4242 4242` (any future expiry/CVC) → Pay.
Expected: success toast, redirect to `/settings/billing`, subscription now
`active`. Retry with decline card `4000 0000 0000 0002` → Expected: red alert
"Your card was declined. Please contact your card issuer." and no plan change.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/billing/components/checkout-wizard.tsx frontend/src/features/billing/components/payment-form.tsx frontend/src/routes/_authenticated/billing/checkout.tsx frontend/src/lib/stripe.ts
git commit -m "feat(billing): 3-step checkout wizard with Stripe Elements"
```

---

## Task 14: Frontend — Billing Settings Tab (Current Plan, Payment Method, Transactions, Cancel)

**Files:**
- Create: `frontend/src/features/billing/components/billing-settings.tsx`
- Create: `frontend/src/features/billing/components/cancel-subscription-dialog.tsx`
- Create: `frontend/src/routes/_authenticated/settings/billing.tsx`
- Modify: settings navigation (add a "Billing" entry)

- [ ] **Step 1: Create `cancel-subscription-dialog.tsx`**

```tsx
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useCancelSubscription } from '../hooks/use-billing'

type Props = {
  open: boolean
  onOpenChange: (o: boolean) => void
  planName: string
  periodEnd: string | null
}

export function CancelSubscriptionDialog({ open, onOpenChange, planName, periodEnd }: Props) {
  const cancel = useCancelSubscription()
  const endLabel = periodEnd
    ? new Date(periodEnd).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : 'the end of the billing period'

  const confirm = () =>
    cancel.mutate(undefined, {
      onSuccess: () => {
        toast.success('Subscription canceled.')
        onOpenChange(false)
      },
      onError: () => toast.error('Could not cancel. Please try again.'),
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Cancel your subscription?</DialogTitle></DialogHeader>
        <p className='text-sm'>
          Your <strong>{planName}</strong> subscription will remain active until{' '}
          <strong>{endLabel}</strong>. After that, your account will be downgraded
          and you will lose access to paid features.
        </p>
        <div className='bg-muted rounded-md p-3 text-sm'>
          <strong>Your data is safe.</strong> We’ll keep your projects for 90 days
          in case you change your mind.
        </div>
        <div className='space-y-2'>
          <Button className='w-full' onClick={() => onOpenChange(false)}>
            Keep subscription
          </Button>
          <Button
            variant='ghost'
            className='text-destructive w-full'
            onClick={confirm}
            disabled={cancel.isPending}
          >
            {cancel.isPending ? 'Canceling…' : 'Yes, cancel'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Create `billing-settings.tsx`**

```tsx
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useSubscription, useTransactions } from '../hooks/use-billing'
import { CancelSubscriptionDialog } from './cancel-subscription-dialog'

export function BillingSettings() {
  const { data: sub, isLoading } = useSubscription()
  const { data: transactions } = useTransactions()
  const navigate = useNavigate()
  const [cancelOpen, setCancelOpen] = useState(false)

  if (isLoading || !sub) return <div className='p-6'>Loading billing…</div>

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <CardTitle>Current plan</CardTitle>
            <Badge variant={sub.status === 'active' ? 'default' : 'secondary'}>
              {sub.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='text-lg font-semibold'>
            {sub.planName}{sub.billingCycle ? ` · ${sub.billingCycle}` : ''}
          </div>
          {sub.status === 'trialing' && sub.trialEndsAt && (
            <p className='text-muted-foreground text-sm'>
              Trial ends {new Date(sub.trialEndsAt).toLocaleDateString()}
            </p>
          )}
          {sub.cancelAtPeriodEnd && sub.currentPeriodEnd && (
            <p className='text-destructive text-sm'>
              Cancels on {new Date(sub.currentPeriodEnd).toLocaleDateString()}
            </p>
          )}
          <div className='flex gap-2'>
            <Button onClick={() => navigate({ to: '/billing' })}>
              {sub.status === 'active' ? 'Change plan' : 'View plans'}
            </Button>
            {sub.status === 'active' && !sub.cancelAtPeriodEnd && (
              <Button variant='outline' onClick={() => setCancelOpen(true)}>
                Cancel subscription
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Payment method</CardTitle></CardHeader>
        <CardContent>
          {sub.paymentMethod?.last4 ? (
            <p className='text-sm'>
              {sub.paymentMethod.brand?.toUpperCase()} ···· {sub.paymentMethod.last4}
              {' '}(exp {sub.paymentMethod.expMonth}/{sub.paymentMethod.expYear})
            </p>
          ) : (
            <p className='text-muted-foreground text-sm'>No card on file.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Transaction history</CardTitle></CardHeader>
        <CardContent>
          {!transactions?.length ? (
            <p className='text-muted-foreground text-sm'>No payments yet.</p>
          ) : (
            <ul className='divide-y'>
              {transactions.map((t) => (
                <li key={t.id} className='flex items-center justify-between py-3'>
                  <div>
                    <div className='font-medium'>{t.description}</div>
                    <div className='text-muted-foreground text-sm'>
                      {new Date(t.date).toLocaleDateString()}
                    </div>
                  </div>
                  <div className={t.status === 'failed' ? 'text-destructive' : ''}>
                    ${t.amount.toFixed(2)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <CancelSubscriptionDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        planName={sub.planName}
        periodEnd={sub.currentPeriodEnd}
      />
    </div>
  )
}
```

- [ ] **Step 3: Create the route `frontend/src/routes/_authenticated/settings/billing.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { BillingSettings } from '@/features/billing/components/billing-settings'

export const Route = createFileRoute('/_authenticated/settings/billing')({
  component: BillingSettings,
})
```

- [ ] **Step 4: Add "Billing" to the settings navigation**

The settings layout uses a sidebar nav (`frontend/src/routes/_authenticated/settings/route.tsx`
or a `settings/components` nav list). Read it and add an item linking to
`/settings/billing` labelled "Billing", matching the existing entries
(Account, Appearance, Display, Notifications).

- [ ] **Step 5: Verify**

`npm run dev` → Settings → Billing. Expected: current plan card, payment-method
card, transaction list. For an `active` subscription, "Cancel subscription" opens
the dialog showing the period-end date and the 90-day data-retention note;
"Yes, cancel" flips the plan to `canceled` with a "Cancels on …" line.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/billing/components/billing-settings.tsx frontend/src/features/billing/components/cancel-subscription-dialog.tsx frontend/src/routes/_authenticated/settings/billing.tsx frontend/src/routes/_authenticated/settings
git commit -m "feat(billing): billing settings tab — plan, card, transactions, cancel"
```

---

## Task 15: Frontend — Trial-Ended Banner + Trial Start Gate

BRD: when the trial ends, every page shows a persistent banner with a "Subscribe
now" CTA. Also: a brand-new org (no card) must be routed to start the trial.

**Files:**
- Create: `frontend/src/features/billing/components/subscription-banner.tsx`
- Create: `frontend/src/features/billing/components/start-trial-card.tsx`
- Modify: `frontend/src/components/layout/top-navbar.tsx` (render the banner)

- [ ] **Step 1: Create `subscription-banner.tsx`**

```tsx
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { useSubscription } from '../hooks/use-billing'

// Persistent banner shown when the trial/subscription has lapsed.
export function SubscriptionBanner() {
  const { data: sub } = useSubscription()
  const navigate = useNavigate()
  if (!sub) return null

  if (sub.status === 'expired' || sub.status === 'incomplete') {
    const msg =
      sub.status === 'incomplete'
        ? 'Start your free trial to begin using PM Copilots.'
        : 'Your free trial has ended. Subscribe to continue using PM Copilots.'
    return (
      <div className='bg-destructive text-destructive-foreground flex items-center justify-between gap-4 px-4 py-2 text-sm'>
        <span>{msg}</span>
        <Button size='sm' variant='secondary' onClick={() => navigate({ to: '/billing' })}>
          Subscribe now
        </Button>
      </div>
    )
  }

  if (sub.status === 'past_due') {
    return (
      <div className='flex items-center justify-between gap-4 bg-amber-500 px-4 py-2 text-sm text-white'>
        <span>Your last payment failed. Update your card to keep access.</span>
        <Button size='sm' variant='secondary' onClick={() => navigate({ to: '/settings/billing' })}>
          Fix payment
        </Button>
      </div>
    )
  }
  return null
}
```

- [ ] **Step 2: Create `start-trial-card.tsx`** (used inside the Plans page for `incomplete` orgs)

```tsx
import { useState } from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { stripePromise } from '@/lib/stripe'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { PaymentForm } from './payment-form'
import { useStartTrial, useConfirmTrial } from '../hooks/use-billing'

// Card-capture step that begins the 7-day trial (Stripe SetupIntent, no charge).
export function StartTrialCard() {
  const startTrial = useStartTrial()
  const confirmTrial = useConfirmTrial()
  const [secret, setSecret] = useState<string | undefined>(undefined)

  const begin = async () => {
    try {
      const { clientSecret } = await startTrial.mutateAsync()
      setSecret(clientSecret)
    } catch {
      toast.error('Could not start the trial. Please try again.')
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Start your 7-day free trial</CardTitle></CardHeader>
      <CardContent className='space-y-4'>
        <p className='text-muted-foreground text-sm'>
          Your card will not be charged during the trial. You can cancel any time
          before day 7 at no cost.
        </p>
        {!secret ? (
          <button
            className='bg-primary text-primary-foreground w-full rounded-md py-2'
            onClick={begin}
            disabled={startTrial.isPending}
          >
            {startTrial.isPending ? 'Preparing…' : 'Add card & start trial'}
          </button>
        ) : (
          <Elements stripe={stripePromise}>
            <PaymentForm
              setupClientSecret={secret}
              submitLabel='Start free trial'
              busy={confirmTrial.isPending}
              onConfirmed={() => {
                // PaymentForm confirmed the SetupIntent; retrieve the PM id from it.
                // confirmCardSetup returns the setupIntent — capture it via a ref-less
                // approach: re-confirm is idempotent, so we read it here instead.
                toast.message('Finishing trial setup…')
              }}
            />
          </Elements>
        )}
      </CardContent>
    </Card>
  )
}
```
> **Note for the executor:** `PaymentForm.onConfirmed` currently receives no args.
> To pass the confirmed `payment_method` id to `confirmTrial`, widen
> `PaymentForm`'s `onConfirmed` to `(paymentMethodId?: string) => void` and, in
> `payment-form.tsx`, call `onConfirmed(result.setupIntent?.payment_method as string)`
> after a successful `confirmCardSetup`. Then here:
> `onConfirmed={(pmId) => pmId && confirmTrial.mutate(pmId, { onSuccess: ... })}`.
> Apply that small signature change as part of this step and re-verify Task 13
> still compiles (its `onConfirmed={finish}` ignores the arg — fine).

- [ ] **Step 3: Show `StartTrialCard` for `incomplete` orgs on the Plans page**

In `frontend/src/features/billing/index.tsx`, read the subscription via
`useSubscription()`. When `status === 'incomplete'`, render `<StartTrialCard />`
above `<PlansGrid />` (the user must start the trial before subscribing).

- [ ] **Step 4: Render the banner globally**

In `frontend/src/components/layout/top-navbar.tsx`, import and render
`<SubscriptionBanner />` at the very top of the returned layout so it appears on
every authenticated page.

- [ ] **Step 5: Verify**

- New org (status `incomplete`): banner reads "Start your free trial…"; `/billing`
  shows the Start-Trial card; adding test card `4242…` flips status to `trialing`,
  banner disappears.
- Force `status='expired'` in Prisma Studio: banner reads "Your free trial has
  ended…", "Subscribe now" routes to `/billing`, and any write action returns the
  `402 SUBSCRIPTION_REQUIRED` handled by Task 9.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/billing/components/subscription-banner.tsx frontend/src/features/billing/components/start-trial-card.tsx frontend/src/features/billing/components/payment-form.tsx frontend/src/features/billing/index.tsx frontend/src/components/layout/top-navbar.tsx
git commit -m "feat(billing): trial-ended banner + trial start gate"
```

---

## Self-Review

**Spec coverage (BRD Subscription Plans Module):**
- 7-day trial + mandatory card before trial — Tasks 5, 7, 15. ✓
- Trial activation flow (card form → validate → create record) — Tasks 5, 13, 15. ✓
- "Card not charged during trial / cancel anytime" copy — Task 15 Step 2. ✓
- Trial limit (1 project) — Task 9 (`PLANS.trial.projectLimit = 1`). ✓
- Trial end → lock paid features, read-only — Task 9 `subscriptionGate` + `isExpired`. ✓
- Persistent "trial ended / Subscribe now" banner — Task 15. ✓
- Trial reminder emails day 5 / day 7 — Task 10. ✓
- Plans (Individual $49 / Business $499 / Enterprise custom; annual −20%) — Task 2 catalog. ✓
- Plan display rules (new=all 3; active=current+next; highest=current only) — Task 2 `getVisiblePlanIds`, Task 4 `getPlansForOrg`, Task 12. ✓
- 3-step checkout (plan → cycle → payment) — Task 13. ✓
- Saved-card one-click vs new-card path — Task 13 (`hasCardOnFile`). ✓
- Payment validation messages + issuer decline ("Your card was declined…") — Task 7 `handleStripeError`, Task 13 `serverError`, Task 6 `error_if_incomplete`. ✓
- Payment failure → stay on current plan, retry — Task 6 (no DB write before charge succeeds) + Task 13 retry. ✓
- Cancellation popup (title/body/buttons, 90-day retention) + cancel-at-period-end + confirmation email — Tasks 6, 14. ✓
- After cancel → read-only at period end — Task 10 (`canceled` → `expired`) + Task 9. ✓
- Enterprise: "Get Enterprise plan" → seat qualification (≤100 / >100) → Contact Sales — Tasks 6, 12. ✓
- Transaction history (date / description / amount) — Tasks 6, 8, 14. ✓
- Upgrade prorate ("charged the prorated difference") — Task 6 `proration_behavior: 'always_invoice'`. ✓

**Placeholder scan:** No TBD/TODO. The one signature refinement (`PaymentForm.onConfirmed`
gaining an optional `paymentMethodId`) is spelled out with exact code in Task 15 Step 2.

**Type consistency:** `Subscription`/`PlanCard`/`Transaction` (Task 11 `types.ts`)
are consumed unchanged in Tasks 12–15. Backend `serializeSubscription` shape
(Task 4) matches the frontend `Subscription` interface field-for-field. Status
strings (`incomplete`/`trialing`/`active`/`past_due`/`canceled`/`expired`) are
identical across `schema.prisma`, `subscription.service.js`, `subscription-gate.js`,
`billing-scheduler.js`, and `types.ts`. `getVisiblePlanIds` (Task 2) feeds
`getPlansForOrg` (Task 4) with no signature drift.

**Open item for the user:** the BRD's "auto-charge at trial end" line is
**not** implemented (see Design Resolutions). Confirm the lock-and-subscribe flow
is acceptable, or a follow-up task is needed to auto-create a Stripe subscription
at trial end.

---

## Execution Handoff (covers BOTH plans)

Plan A (`2026-05-22-brd-gaps-user-project-boq.md`) is small and low-risk — do it
first. Plan B (this file) is a large standalone subsystem — do it second, ideally
in an isolated worktree.

Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review
between tasks, fast iteration. REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`.

**2. Inline Execution** — execute tasks in this session with checkpoints for
review. REQUIRED SUB-SKILL: `superpowers:executing-plans`.

Which approach do you want — and shall I start with Plan A?
