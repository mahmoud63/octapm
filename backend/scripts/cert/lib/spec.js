'use strict';

/**
 * The certification population, as plain data.
 *
 * A hundred construction companies that differ from one another the way real
 * customers do: size, people, roles, plan, billing state, seats, currency,
 * time zone, number and stage of projects. Nothing here touches a database;
 * `buildPopulation()` returns the same population every time it is called, so
 * a generator can create it, a checker can compare a database against it, and
 * a report can describe it, all from one source.
 *
 * The naming rule the certification guard relies on is applied here and
 * nowhere else: every address ends `.octapm-cert.test`, every company's slug
 * is `cert-NNN-…` and its name ends `(CERT-NNN)`.
 */

const crypto = require('crypto');
const { EMAIL_SUFFIX } = require('./cert-env');

const SEED = 'octapm-cert-population-v1';
const COMPANIES = 100;

/** A UUID (version 5 layout) from a name: the same name always gives the same id. */
const idFor = (name) => {
  const hash = crypto.createHash('sha1').update(`${SEED}:${name}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

/** A repeatable random source for one label. */
const rngFor = (label) => {
  let state = crypto.createHash('sha1').update(`${SEED}:rng:${label}`).digest().readUInt32LE(0);
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    shuffle: (list) => {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
};

const pad = (n) => String(n).padStart(3, '0');
const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// ── vocabulary ─────────────────────────────────────────────────────────────

const PREFIXES = [
  'Harbor', 'Summit', 'Ironbridge', 'Meridian', 'Cedar Ridge', 'Atlas', 'Northgate', 'Al Noor', 'Delta', 'Keystone',
  'Granite Peak', 'Bluewater', 'Falcon', 'Redwood', 'Pinnacle', 'Crescent', 'Orion', 'Sahara', 'Nile Valley', 'Gulf Horizon',
  'Thames', 'Hudson', 'Bayou', 'Magnolia', 'Lone Star', 'Cascade', 'Sierra', 'Maple Leaf', 'Aurora', 'Stonebridge',
  'Kingsway', 'Blackrock', 'Al Waha', 'Corniche', 'Riverbend', 'Highland', 'Oakmont', 'Terra Firma', 'Vanguard', 'Zenith',
  'Petra', 'Olympus', 'Brightwater', 'Copperfield', 'Dunmore', 'Eastlake', 'Fairmont', 'Greystone', 'Hawthorne', 'Ibis',
];
const SUFFIXES = [
  'Construction', 'Builders', 'Contracting', 'Engineering & Construction', 'General Contractors',
  'Infrastructure', 'Civil Works', 'Developments', 'Building Group', 'Constructors',
];

const FIRST_NAMES = [
  'Layla', 'Omar', 'Sara', 'Yusuf', 'Mariam', 'Khalid', 'Noor', 'Hassan', 'Amira', 'Tariq',
  'James', 'Emily', 'Michael', 'Olivia', 'Daniel', 'Sophie', 'William', 'Grace', 'Thomas', 'Chloe',
  'Carlos', 'Lucia', 'Mateo', 'Elena', 'Diego', 'Priya', 'Arjun', 'Anika', 'Rohan', 'Meera',
  'Kenji', 'Yuki', 'Hiro', 'Aiko', 'Chen', 'Mei', 'Liam', 'Ava', 'Noah', 'Isla',
  'Fatima', 'Ibrahim', 'Zainab', 'Mustafa', 'Huda', 'Samir', 'Rania', 'Bilal', 'Dina', 'Karim',
];
const LAST_NAMES = [
  'Haddad', 'Mansour', 'Farouk', 'Nasser', 'Aziz', 'Rahman', 'Saleh', 'Khoury', 'Darwish', 'Sabry',
  'Carter', 'Bennett', 'Hughes', 'Foster', 'Reed', 'Morgan', 'Hayes', 'Ward', 'Brooks', 'Price',
  'Mendoza', 'Vargas', 'Rojas', 'Navarro', 'Castillo', 'Sharma', 'Iyer', 'Kapoor', 'Menon', 'Reddy',
  'Tanaka', 'Sato', 'Mori', 'Ito', 'Wang', 'Liu', 'Walsh', 'Byrne', 'Doyle', 'Nolan',
  'Okafor', 'Mensah', 'Adeyemi', 'Kamau', 'Petrov', 'Novak', 'Lindqvist', 'Jensen', 'Moreau', 'Fischer',
];

/** The nine workspace roles of shared/permissions.json. */
const ROLES = ['pm', 'planning_eng', 'qs', 'cost_controller', 'procurement', 'warehouse', 'site_engineer', 'quality_engineer', 'finance'];

/** The persona addresses the lifecycle drivers sign in with: <key>@cNNN.octapm-cert.test. */
const PERSONAS = [
  { key: 'pm', role: 'pm', title: 'Project Manager' },
  { key: 'planner', role: 'planning_eng', title: 'Planning Engineer' },
  { key: 'qs', role: 'qs', title: 'Quantity Surveyor' },
  { key: 'cost', role: 'cost_controller', title: 'Cost Controller' },
  { key: 'procurement', role: 'procurement', title: 'Procurement Officer' },
  { key: 'warehouse', role: 'warehouse', title: 'Warehouse Keeper' },
  { key: 'site', role: 'site_engineer', title: 'Site Engineer' },
  { key: 'quality', role: 'quality_engineer', title: 'Quality Engineer' },
  { key: 'finance', role: 'finance', title: 'Finance Officer' },
];
/** In a small company the owner is the PM; the next people, in this order. */
const SMALL_ORDER = ['pm', 'site', 'qs', 'finance', 'procurement'];
/** How the other staff of a larger company spread over the roles (site staff dominate). */
const STAFF_ROLE_WEIGHTS = [
  ['site_engineer', 34], ['qs', 12], ['planning_eng', 8], ['cost_controller', 7], ['procurement', 9],
  ['warehouse', 8], ['quality_engineer', 9], ['finance', 6], ['pm', 7],
];

/** Currency → the time zones a company billing in it plausibly works in. Weights sum to 100. */
const MARKETS = [
  { currency: 'USD', weight: 28, zones: ['America/Chicago', 'America/New_York', 'America/Los_Angeles', 'America/Denver', 'Pacific/Honolulu'], cities: ['Baton Rouge', 'Houston', 'New York', 'Los Angeles', 'Denver', 'Honolulu'] },
  { currency: 'AED', weight: 12, zones: ['Asia/Dubai'], cities: ['Dubai', 'Abu Dhabi', 'Sharjah'] },
  { currency: 'SAR', weight: 10, zones: ['Asia/Riyadh'], cities: ['Riyadh', 'Jeddah', 'Dammam'] },
  { currency: 'EUR', weight: 9, zones: ['Europe/Berlin', 'Europe/Paris', 'Europe/Madrid', 'Europe/Athens'], cities: ['Berlin', 'Lyon', 'Valencia', 'Athens'] },
  { currency: 'GBP', weight: 8, zones: ['Europe/London'], cities: ['London', 'Manchester', 'Glasgow'] },
  { currency: 'EGP', weight: 8, zones: ['Africa/Cairo'], cities: ['Cairo', 'Alexandria', 'New Administrative Capital'] },
  { currency: 'CAD', weight: 5, zones: ['America/Toronto', 'America/Vancouver', 'America/St_Johns'], cities: ['Toronto', 'Vancouver', "St. John's"] },
  { currency: 'AUD', weight: 5, zones: ['Australia/Sydney', 'Australia/Perth', 'Australia/Adelaide'], cities: ['Sydney', 'Perth', 'Adelaide'] },
  { currency: 'QAR', weight: 4, zones: ['Asia/Qatar'], cities: ['Doha', 'Lusail'] },
  { currency: 'KWD', weight: 3, zones: ['Asia/Kuwait'], cities: ['Kuwait City'] },
  { currency: 'INR', weight: 3, zones: ['Asia/Kolkata'], cities: ['Mumbai', 'Bengaluru'] },
  { currency: 'JPY', weight: 2, zones: ['Asia/Tokyo'], cities: ['Tokyo', 'Osaka'] },
  { currency: 'NZD', weight: 2, zones: ['Pacific/Auckland'], cities: ['Auckland', 'Wellington'] },
  { currency: 'NPR', weight: 1, zones: ['Asia/Kathmandu'], cities: ['Kathmandu'] },
];

const PROJECT_NAMES = [
  'Riverside Tower', 'Marina Residences', 'Central Hospital Extension', 'Airport Cargo Terminal', 'Northern Ring Road Section 4',
  'Lakeside Villas Phase 2', 'Harbour Bridge Rehabilitation', 'University Science Block', 'Metro Depot', 'Desalination Plant Upgrade',
  'City Mall Fit-Out', 'Logistics Park Warehouse B', 'Wastewater Treatment Works', 'Heritage Hotel Refurbishment', 'Solar Farm Substation',
  'Coastal Road Widening', 'Business Bay Office Tower', 'Stadium East Stand', 'School Campus Block C', 'Data Centre Shell and Core',
  'Industrial Estate Roads', 'Port Quay Wall Extension', 'Hilltop Reservoir', 'Residential Tower B', 'Community Clinic',
  'Bus Rapid Transit Stations', 'Convention Centre Hall 3', 'Cold Storage Facility', 'Pedestrian Underpass', 'Old Town Streetscape',
  'Tunnel Ventilation Building', 'Mixed-Use Podium', 'Staff Housing Compound', 'Pump Station No. 7', 'Rail Overbridge',
  'Courthouse Annex', 'Shopping Arcade Renovation', 'Fire Station', 'Technology Park Building 5', 'Flood Defence Wall',
];
const PROJECT_TYPES = ['building', 'infrastructure', 'residential', 'industrial', 'fit_out', 'roads', 'utilities', 'healthcare', 'education'];
const CONTRACT_TYPES = ['lump_sum', 'unit_rate', 'remeasurement', 'cost_plus', 'design_build', 'epc', 'other'];
const CALENDARS = ['five_day', 'six_day', 'seven_day'];
const CLIENTS = ['Municipality', 'Ministry of Works', 'Port Authority', 'Property Group', 'Health Authority', 'University Estates', 'Transit Agency', 'Utilities Company', 'Development Fund', 'Holdings'];

// ── billing ────────────────────────────────────────────────────────────────

/** The seat ladder the brief names. */
const SEAT_LADDER = [1, 2, 5, 10, 25, 50, 100];

/**
 * Every company's plan and final billing state, by size class. Realistic
 * only: a company that never started a trial cannot hold work (the product
 * refuses its writes), so that state is covered by the onboarding test, not
 * by one of the hundred.
 *
 * `state` is what the generator leaves the company in once its data exists:
 *   active            paying, period end in the future
 *   trialing          card trial running
 *   trial_lapsed      trial end passed, not yet swept (the gate already refuses)
 *   past_due          a payment failed
 *   canceled_running  cancelled, paid period still running
 *   canceled_lapsed   cancelled, paid period over, not yet swept
 *   expired           no access to writes
 */
const BILLING_MIX = {
  small: [
    ...Array(4).fill({ plan: 'trial', state: 'trialing' }),
    { plan: 'trial', state: 'trial_lapsed' },
    { plan: 'trial', state: 'expired' },
    ...Array(5).fill({ plan: 'individual', state: 'active', cycle: 'monthly' }),
    ...Array(3).fill({ plan: 'individual', state: 'active', cycle: 'annual' }),
    { plan: 'individual', state: 'past_due', cycle: 'monthly' },
    { plan: 'individual', state: 'canceled_running', cycle: 'monthly' },
    { plan: 'individual', state: 'expired', cycle: 'annual' },
    ...Array(3).fill({ plan: 'business', state: 'active', cycle: 'monthly' }),
  ],
  medium: [
    ...Array(20).fill({ plan: 'business', state: 'active', cycle: 'monthly' }),
    ...Array(10).fill({ plan: 'business', state: 'active', cycle: 'annual' }),
    ...Array(3).fill({ plan: 'business', state: 'past_due', cycle: 'monthly' }),
    ...Array(3).fill({ plan: 'business', state: 'canceled_running', cycle: 'monthly' }),
    ...Array(2).fill({ plan: 'business', state: 'canceled_lapsed', cycle: 'annual' }),
    ...Array(2).fill({ plan: 'business', state: 'expired', cycle: 'monthly' }),
    ...Array(8).fill({ plan: 'enterprise', state: 'active', cycle: 'annual' }),
    ...Array(2).fill({ plan: 'individual', state: 'active', cycle: 'monthly' }),
  ],
  large: [
    ...Array(15).fill({ plan: 'enterprise', state: 'active', cycle: 'annual' }),
    ...Array(7).fill({ plan: 'business', state: 'active', cycle: 'monthly' }),
    ...Array(4).fill({ plan: 'business', state: 'active', cycle: 'annual' }),
    ...Array(2).fill({ plan: 'business', state: 'past_due', cycle: 'monthly' }),
    { plan: 'business', state: 'canceled_running', cycle: 'annual' },
    { plan: 'business', state: 'expired', cycle: 'monthly' },
  ],
};

const PROJECT_LIMIT = { trial: 1, individual: 3, business: 25, enterprise: Infinity };
const CARD_BRANDS = ['visa', 'mastercard', 'amex'];

const sizeOf = (n) => (n <= 20 ? 'small' : n <= 70 ? 'medium' : 'large');

// ── people ─────────────────────────────────────────────────────────────────

const weighted = (rng, table) => {
  const total = table.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * total;
  for (const [value, weight] of table) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return table[table.length - 1][0];
};

const personName = (rng) => `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;

/** How many people a company has, by class — every allowed count is used somewhere. */
const headcount = (n, size, rng) => {
  if (size === 'small') return 2 + ((n - 1) % 4); // 2..5
  if (size === 'medium') return 10 + (((n - 21) * 7) % 21); // 10..30
  // large: thirty to a hundred and more; three of them above a hundred
  const above = { 71: 104, 85: 110, 100: 127 };
  return above[n] || rng.int(30, 98);
};

const buildPeople = ({ n, size, orgId, domain, rng }) => {
  const count = headcount(n, size, rng);
  const people = [];
  const used = new Set();
  const add = ({ key, role, name, isAdmin = false, isOwner = false, persona = null }) => {
    const email = `${key}@${domain}`;
    if (used.has(email)) throw new Error(`duplicate address ${email}`);
    used.add(email);
    people.push({
      id: idFor(`user:${email}`),
      membershipId: idFor(`membership:${orgId}:${email}`),
      orgId,
      email,
      name,
      role,
      isAdmin: isAdmin || isOwner,
      isOwner,
      persona,
    });
  };

  if (size === 'small') {
    // The owner runs the jobs: PM, company administrator and owner in one person.
    SMALL_ORDER.slice(0, count).forEach((key, i) => {
      const persona = PERSONAS.find((p) => p.key === key);
      add({ key, role: persona.role, name: personName(rng), isOwner: i === 0, persona: key });
    });
    return people;
  }

  // A larger company: an owner who is not always the PM, the nine personas,
  // then staff. Company administration is not the PM role: the PM persona is
  // an administrator, one finance officer sometimes is, other PMs are not.
  const ownerRole = ['pm', 'pm', 'pm', 'finance', 'cost_controller', 'qs'][n % 6];
  add({ key: 'owner', role: ownerRole, name: personName(rng), isOwner: true });
  for (const persona of PERSONAS) {
    add({
      key: persona.key,
      role: persona.role,
      name: personName(rng),
      isAdmin: persona.key === 'pm' || (persona.key === 'finance' && n % 3 === 0),
      persona: persona.key,
    });
  }
  let serial = 0;
  while (people.length < count) {
    const name = personName(rng);
    serial += 1;
    const key = `${slugify(name).replace(/-/g, '.')}.${serial}`;
    add({ key, role: weighted(rng, STAFF_ROLE_WEIGHTS), name });
  }
  return people;
};

// ── projects ───────────────────────────────────────────────────────────────

const iso = (date) => date.toISOString().slice(0, 10);
const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000);

const projectCount = (n, size, plan, rng) => {
  const wanted = size === 'small' ? 1 + ((n - 1) % 3) : size === 'medium' ? 3 + ((n - 21) % 8) : rng.int(6, 20);
  return Math.min(wanted, PROJECT_LIMIT[plan]);
};

/**
 * What a project holds once the generator has finished with it:
 *   certified  the full known-answer lifecycle (finance reconciled on paper)
 *   standard   one or more of every record type, sizes varied
 *   light      a bill, a programme and a little cost
 *   empty      just created: a planning-stage job
 *
 * The certified lifecycle needs the nine personas, so it runs in medium and
 * large companies: one in six of them, on their first project.
 */
const depthOf = (n, index, size, stage) => {
  if (stage === 'planning') return 'empty';
  if (index === 0) return size !== 'small' && n % 6 === 3 ? 'certified' : 'standard';
  if (index === 1) return 'standard';
  return index % 3 === 0 ? 'standard' : 'light';
};

const STAGES = ['active', 'active', 'active', 'active', 'planning', 'on_hold', 'completed', 'active', 'archived', 'active'];

const buildProjects = ({ n, size, org, market, plan, rng, asOf }) => {
  const count = projectCount(n, size, plan, rng);
  const names = rng.shuffle(PROJECT_NAMES);
  const projects = [];
  for (let i = 0; i < count; i += 1) {
    // The first project of every company is a live job; later ones vary.
    const stage = i === 0 ? 'active' : STAGES[(n + i * 3) % STAGES.length];
    const months = rng.int(6, 36);
    const startOffset =
      stage === 'planning' ? rng.int(20, 120) : stage === 'completed' || stage === 'archived' ? -rng.int(months * 30 + 30, months * 30 + 400) : -rng.int(30, Math.max(60, months * 20));
    const start = addDays(asOf, startOffset);
    const end = addDays(start, months * 30);
    const ownZone = rng.chance(0.65);
    const ownCurrency = rng.chance(0.12);
    const otherMarket = rng.pick(MARKETS);
    const magnitude = { JPY: 150, INR: 80, EGP: 50, NPR: 130 }[org.currency] || 1;
    const value = Math.round((rng.int(4, 900) * 100_000 * magnitude) / 1000) * 1000;
    const code = `${pad(n)}-${String(i + 1).padStart(2, '0')}`;
    projects.push({
      key: code,
      name: `${names[i % names.length]}${i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : ''}`,
      type: rng.pick(PROJECT_TYPES),
      location: rng.pick(market.cities),
      clientName: `${rng.pick(market.cities)} ${rng.pick(CLIENTS)}`,
      contractType: CONTRACT_TYPES[(n + i) % CONTRACT_TYPES.length],
      contractNumber: `CN-${code}`,
      startDate: iso(start),
      endDate: iso(end),
      duration: months,
      durationUnit: 'months',
      contractValue: value,
      currency: ownCurrency ? otherMarket.currency : org.currency,
      // A project without its own zone falls back to the company's, then to UTC.
      timezone: ownZone ? rng.pick(ownCurrency ? otherMarket.zones : market.zones) : null,
      defaultRetentionRate: [0, 5, 5, 10, 2.5][(n + i) % 5],
      projectCalendar: CALENDARS[(n + i) % CALENDARS.length],
      reportingCutoffDay: [null, 25, 28, 1, 15][(n * 3 + i) % 5],
      stage,
      depth: depthOf(n, i, size, stage),
      canary: `CANARY-${pad(n)}-P${String(i + 1).padStart(2, '0')}-${idFor(`canary:${code}`).slice(0, 8)}`,
    });
  }
  return projects;
};

// ── companies ──────────────────────────────────────────────────────────────

const currencyDeck = () => {
  const deck = MARKETS.flatMap((market) => Array(market.weight).fill(market));
  if (deck.length !== COMPANIES) throw new Error(`market weights sum to ${deck.length}, not ${COMPANIES}`);
  return rngFor('markets').shuffle(deck);
};

const billingDeck = () => {
  const out = {};
  for (const [size, list] of Object.entries(BILLING_MIX)) out[size] = rngFor(`billing:${size}`).shuffle(list);
  return out;
};

const seatsFor = (plan, members, n) => {
  if (plan === 'trial') return 1;
  const fits = SEAT_LADDER.find((s) => s >= members) || SEAT_LADDER[SEAT_LADDER.length - 1];
  // One company in five holds more people than seats — the case the seat rule exists for.
  const short = n % 5 === 0;
  if (plan === 'individual') return short ? 1 : Math.min(fits, 5);
  if (!short) return fits;
  const lower = SEAT_LADDER[Math.max(0, SEAT_LADDER.indexOf(fits) - 1)];
  return lower;
};

/**
 * The whole population. `asOf` anchors the project dates and billing periods
 * (default: the fixed certification date), so two calls agree.
 */
const buildPopulation = ({ asOf = new Date('2026-10-02T12:00:00.000Z') } = {}) => {
  const markets = currencyDeck();
  const billing = billingDeck();
  const cursor = { small: 0, medium: 0, large: 0 };
  const companies = [];

  for (let n = 1; n <= COMPANIES; n += 1) {
    const size = sizeOf(n);
    const rng = rngFor(`company:${n}`);
    const base = `${PREFIXES[(n - 1) % PREFIXES.length]} ${SUFFIXES[((n - 1) * 3 + Math.floor((n - 1) / PREFIXES.length)) % SUFFIXES.length]}`;
    const code = pad(n);
    const market = markets[n - 1];
    const orgId = idFor(`org:${code}`);
    const domain = `c${code}${EMAIL_SUFFIX}`;
    const bill = billing[size][cursor[size]];
    cursor[size] += 1;

    const org = {
      n,
      code,
      size,
      id: orgId,
      name: `${base} (CERT-${code})`,
      slug: `cert-${code}-${slugify(base)}`,
      domain,
      currency: market.currency,
      // One company in twelve never chose a zone: its projects fall back to UTC.
      timezone: n % 12 === 0 ? null : rng.pick(market.zones),
      canary: `CANARY-${code}-ORG-${idFor(`canary:org:${code}`).slice(0, 8)}`,
    };
    const people = buildPeople({ n, size, orgId, domain, rng });
    const projects = buildProjects({ n, size, org, market, plan: bill.plan, rng, asOf });
    const paid = bill.plan !== 'trial';
    const subscription = {
      id: idFor(`subscription:${code}`),
      plan: bill.plan,
      state: bill.state,
      billingCycle: paid ? bill.cycle : null,
      seats: seatsFor(bill.plan, people.length, n),
      stripeCustomerId: `cus_cert${code}`,
      stripeSubscriptionId: paid ? `sub_cert${code}` : null,
      card: { brand: CARD_BRANDS[n % CARD_BRANDS.length], last4: String(1000 + ((n * 37) % 9000)), expMonth: 1 + (n % 12), expYear: 2028 + (n % 4) },
      aiGenerationsUsed: bill.plan === 'enterprise' ? rng.int(0, 400) : rng.int(0, 3),
    };
    companies.push({ ...org, subscription, people, projects });
  }

  // ── people who belong to several companies, with a different role in each ──
  const byCode = new Map(companies.map((c) => [c.n, c]));
  const multi = [];
  const addMulti = (key, name, placements) => {
    const email = `${key}@multi${EMAIL_SUFFIX}`;
    const roles = placements.map((p) => p.role);
    if (new Set(roles).size !== roles.length && placements.length <= ROLES.length) throw new Error(`${key}: roles repeat`);
    const id = idFor(`user:${email}`);
    multi.push({
      id,
      key,
      email,
      name,
      homeOrgId: byCode.get(placements[0].n).id,
      homeRole: placements[0].role,
      memberships: placements.map((p) => ({
        id: idFor(`membership:${byCode.get(p.n).id}:${email}`),
        orgId: byCode.get(p.n).id,
        code: pad(p.n),
        role: p.role,
        isAdmin: Boolean(p.isAdmin),
        isOwner: false,
      })),
    });
  };
  addMulti('user.a', 'Avery Two-Companies', [
    { n: 4, role: 'pm', isAdmin: true },
    { n: 37, role: 'site_engineer' },
  ]);
  addMulti('user.b', 'Blake Five-Companies', [
    { n: 12, role: 'qs' },
    { n: 29, role: 'finance' },
    { n: 48, role: 'procurement' },
    { n: 77, role: 'site_engineer' },
    { n: 95, role: 'pm' },
  ]);
  addMulti('user.c', 'Casey Ten-Companies', [
    { n: 7, role: 'pm', isAdmin: true },
    { n: 19, role: 'site_engineer' },
    { n: 23, role: 'planning_eng' },
    { n: 34, role: 'qs' },
    { n: 45, role: 'cost_controller' },
    { n: 56, role: 'procurement' },
    { n: 67, role: 'warehouse' },
    { n: 78, role: 'quality_engineer' },
    { n: 89, role: 'finance' },
    { n: 100, role: 'site_engineer' },
  ]);
  // Twenty more people who work for two or three companies — consultants, shared staff.
  const drift = rngFor('multi:drift');
  for (let k = 1; k <= 20; k += 1) {
    const total = 2 + (k % 2);
    const orgs = drift.shuffle(companies.map((c) => c.n)).slice(0, total);
    const roles = drift.shuffle(ROLES).slice(0, total);
    addMulti(`shared.${String(k).padStart(2, '0')}`, personName(drift), orgs.map((n, i) => ({ n, role: roles[i] })));
  }

  return { asOf: asOf.toISOString(), companies, multi };
};

/** Counts and spreads, for the matrix report and the checker. */
const summarise = (population) => {
  const tally = (list, key) => list.reduce((acc, item) => ({ ...acc, [key(item)]: (acc[key(item)] || 0) + 1 }), {});
  const { companies, multi } = population;
  const people = companies.flatMap((c) => c.people);
  const projects = companies.flatMap((c) => c.projects);
  return {
    companies: companies.length,
    bySize: tally(companies, (c) => c.size),
    people: people.length,
    peopleInSeveralCompanies: multi.length,
    memberships: people.length + multi.reduce((sum, m) => sum + m.memberships.length, 0),
    headcount: { min: Math.min(...companies.map((c) => c.people.length)), max: Math.max(...companies.map((c) => c.people.length)) },
    byRole: tally(people, (p) => p.role),
    projects: projects.length,
    projectsByStage: tally(projects, (p) => p.stage),
    projectsByDepth: tally(projects, (p) => p.depth),
    byPlan: tally(companies, (c) => c.subscription.plan),
    byBillingState: tally(companies, (c) => `${c.subscription.plan}/${c.subscription.state}`),
    bySeats: tally(companies, (c) => c.subscription.seats),
    overSeats: companies.filter((c) => c.people.length > c.subscription.seats).length,
    byCurrency: tally(companies, (c) => c.currency),
    byTimezone: tally(companies, (c) => c.timezone || '(none)'),
    projectsWithoutOwnZone: projects.filter((p) => !p.timezone).length,
    ownersWhoAreNotPm: companies.filter((c) => c.people.find((p) => p.isOwner).role !== 'pm').length,
  };
};

module.exports = {
  BILLING_MIX,
  COMPANIES,
  PERSONAS,
  PROJECT_LIMIT,
  ROLES,
  SEAT_LADDER,
  buildPopulation,
  idFor,
  pad,
  rngFor,
  summarise,
};
