'use strict';

const { ORG_NAME, ORG_SLUG, EMAIL_SUFFIX } = require('../lib/cert-env');
const { BILLING_MIX, PERSONAS, PROJECT_LIMIT, ROLES, SEAT_LADDER, buildPopulation, summarise } = require('../lib/spec');

describe('the certification population', () => {
  const population = buildPopulation();
  const { companies, multi } = population;
  const bySize = (size) => companies.filter((c) => c.size === size);

  it('is the same population every time it is built', () => {
    expect(JSON.stringify(buildPopulation())).toBe(JSON.stringify(population));
  });

  it('holds a hundred companies: twenty small, fifty medium, thirty large', () => {
    expect(companies).toHaveLength(100);
    expect([bySize('small').length, bySize('medium').length, bySize('large').length]).toEqual([20, 50, 30]);
  });

  it('gives every company and person the certification naming rule, with nothing repeated', () => {
    for (const company of companies) {
      expect([company.code, ORG_SLUG.test(company.slug), ORG_NAME.test(company.name)]).toEqual([company.code, true, true]);
      expect(company.name).not.toMatch(/E2E|LiveTest|Fixture Co|Demo|UAT/);
    }
    const everyone = [...companies.flatMap((c) => c.people), ...multi];
    for (const person of everyone) expect([person.email, person.email.endsWith(EMAIL_SUFFIX)]).toEqual([person.email, true]);
    const unique = (list) => new Set(list).size === list.length;
    expect(unique(companies.map((c) => c.id))).toBe(true);
    expect(unique(companies.map((c) => c.slug))).toBe(true);
    expect(unique(companies.map((c) => c.name))).toBe(true);
    expect(unique(everyone.map((p) => p.email))).toBe(true);
    expect(unique(everyone.map((p) => p.id))).toBe(true);
    expect(unique(companies.flatMap((c) => c.projects.map((p) => p.canary)))).toBe(true);
    expect(unique(companies.map((c) => c.subscription.stripeCustomerId))).toBe(true);
  });

  it('keeps each class inside the sizes the brief gives', () => {
    for (const c of bySize('small')) expect([c.code, c.people.length >= 2 && c.people.length <= 5, c.projects.length >= 1 && c.projects.length <= 3]).toEqual([c.code, true, true]);
    for (const c of bySize('medium')) expect([c.code, c.people.length >= 10 && c.people.length <= 30]).toEqual([c.code, true]);
    for (const c of bySize('large')) expect([c.code, c.people.length >= 30, c.projects.length >= 2]).toEqual([c.code, true, true]);
    expect(bySize('large').filter((c) => c.people.length > 100).length).toBeGreaterThanOrEqual(3);
    // A medium company holds three to ten projects unless its plan allows fewer.
    for (const c of bySize('medium')) {
      const most = Math.min(10, PROJECT_LIMIT[c.subscription.plan]);
      expect([c.code, c.projects.length >= Math.min(3, most) && c.projects.length <= most]).toEqual([c.code, true]);
    }
  });

  it('never gives a company more projects than its plan allows', () => {
    for (const c of companies) expect([c.code, c.projects.length <= PROJECT_LIMIT[c.subscription.plan]]).toEqual([c.code, true]);
  });

  it('gives each company exactly one owner, who is a company administrator', () => {
    for (const c of companies) {
      const owners = c.people.filter((p) => p.isOwner);
      expect([c.code, owners.length, owners[0]?.isAdmin]).toEqual([c.code, 1, true]);
    }
  });

  it('separates company administration from the PM role', () => {
    const larger = companies.filter((c) => c.size !== 'small');
    // Somewhere: an owner who is not a PM, an administrator who is not a PM, and a PM who is not an administrator.
    expect(larger.some((c) => c.people.find((p) => p.isOwner).role !== 'pm')).toBe(true);
    expect(larger.some((c) => c.people.some((p) => p.isAdmin && !p.isOwner && p.role !== 'pm'))).toBe(true);
    expect(larger.some((c) => c.people.some((p) => p.role === 'pm' && !p.isAdmin))).toBe(true);
  });

  it('gives every medium and large company the nine personas, and uses every role', () => {
    for (const c of companies.filter((x) => x.size !== 'small')) {
      for (const persona of PERSONAS) {
        const person = c.people.find((p) => p.email === `${persona.key}@${c.domain}`);
        expect([c.code, persona.key, person?.role]).toEqual([c.code, persona.key, persona.role]);
      }
    }
    const used = new Set(companies.flatMap((c) => c.people.map((p) => p.role)));
    expect([...used].sort()).toEqual([...ROLES].sort());
  });

  it('uses exactly the billing mix, with seats from the ladder', () => {
    for (const size of ['small', 'medium', 'large']) {
      const want = BILLING_MIX[size].map((b) => `${b.plan}/${b.state}/${b.plan === 'trial' ? null : b.cycle}`).sort();
      const got = bySize(size).map((c) => `${c.subscription.plan}/${c.subscription.state}/${c.subscription.billingCycle}`).sort();
      expect(got).toEqual(want);
    }
    for (const c of companies) expect([c.code, SEAT_LADDER.includes(c.subscription.seats)]).toEqual([c.code, true]);
    expect(new Set(companies.map((c) => c.subscription.seats)).size).toBeGreaterThanOrEqual(6);
    // Some companies hold more people than seats; most do not.
    const over = companies.filter((c) => c.people.length > c.subscription.seats).length;
    expect(over).toBeGreaterThan(5);
  });

  it('varies currency, time zone, stage and contract type', () => {
    const summary = summarise(population);
    expect(Object.keys(summary.byCurrency).length).toBeGreaterThanOrEqual(12);
    expect(Object.keys(summary.byTimezone).length).toBeGreaterThanOrEqual(15);
    expect(summary.byTimezone['(none)']).toBeGreaterThanOrEqual(5);
    expect(Object.keys(summary.projectsByStage).sort()).toEqual(['active', 'archived', 'completed', 'on_hold', 'planning']);
    expect(summary.projectsWithoutOwnZone).toBeGreaterThan(50);
    expect(new Set(companies.flatMap((c) => c.projects.map((p) => p.contractType))).size).toBe(7);
  });

  it('puts user A in two companies, B in five and C in ten, with a different role in each', () => {
    const find = (key) => multi.find((m) => m.key === key);
    for (const [key, total] of [['user.a', 2], ['user.b', 5], ['user.c', 10]]) {
      const person = find(key);
      expect([key, person.memberships.length, new Set(person.memberships.map((m) => m.orgId)).size]).toEqual([key, total, total]);
    }
    expect(new Set(find('user.a').memberships.map((m) => m.role)).size).toBe(2);
    expect(new Set(find('user.b').memberships.map((m) => m.role)).size).toBe(5);
    // Ten companies, nine roles: C holds every role, one of them twice.
    expect(new Set(find('user.c').memberships.map((m) => m.role)).size).toBe(9);
    // An administrator in one company is a plain member in the others.
    expect(find('user.c').memberships.filter((m) => m.isAdmin)).toHaveLength(1);
    for (const person of multi) {
      expect(person.memberships.length).toBeGreaterThanOrEqual(2);
      expect(person.homeOrgId).toBe(person.memberships[0].orgId);
    }
  });
});
