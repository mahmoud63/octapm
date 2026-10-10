'use strict';

/**
 * CERT-3 deep population, 087-EXTRAS (plan §3.2, "Also in 087"): no project of
 * its own; it works on the projects of 087-EXC, 087-SCH and 087-HLT (run-all.js
 * runs it after them) and on the certified project (read only: a report
 * definition is a saved query, nothing of the project is written).
 *
 *   - Permission templates (company level, made by the PM, a company admin):
 *       T-NOBOQ   one member denied boq:read: an internal template on the
 *                 site_engineer base with the BOQ tool at "none". Given to the
 *                 staff site engineer tariq.okafor.2 on 087-EXC and 087-SCH (the
 *                 BOQ withholding probes: field-controls.js WP9.handling.boqWithheldRead
 *                 and WP9.notices.siteEngineerWithoutBoqRead on 087-EXC;
 *                 schedule.js WP2.quantityView.withoutBoqRead on 087-SCH's A310 item).
 *       T-EXPORT  one member with cost:export but denied risk:read: the
 *                 site_engineer base, a cost|action:export grant, the risk tool
 *                 at "none". Given to the staff site engineer arjun.kamau.7 on
 *                 087-EXC (WP9.export.sheetGate; 087-EXC holds risks in every state).
 *     The effect is asserted, not just the assignment: GET /boq answers 403 to
 *     the first on both projects; GET /risks answers 403 to the second, whose
 *     BOQ still answers 200; and the second's project export is judged against
 *     the answer book's WP9.export.sheetGate (R3-9; round 2 R2-B1): DONE when it
 *     answers '200' with no sheet named Risks (the leaf's value check); BLOCKED
 *     HR-K7 (export gate and content) only when the answer, { answer, sheets },
 *     is exactly the leaf's `today` (HEAD: '200' and all six sheets, Risks
 *     included, in the export service's order); any other answer fails.
 *   - A party guest with no procurement or change-order read: a consultant
 *     party (a directory company of this build) carrying an external template
 *     (consultant base, procurement and change_order at "none"); the guest is
 *     brought in by D-ID-1 invitation and acceptance onto that party on
 *     087-EXC, and is also a member of the same company's consultant party on
 *     087-HLT, for WP-9 health's "the party guest sees supply-chain top risks"
 *     (builders' adjudication 087-EXC/HLT item 9, R3-5). On each project:
 *     purchase orders and change orders answer 403 to the guest, RFIs 200, and
 *     the guest is there through the party and its template only.
 *     The guest's address carries the build state's creation stamp
 *     (cert3.087-extras.guest.<yymmddhhmmss>@c087...), so a build started
 *     afresh never re-invites an existing person, and a resumed one keeps them.
 *   - One QS with the commercial notification category switched off (in-app,
 *     e-mail and push off; field-controls.js WP9.workflowNotifications.commercialOptOut):
 *     the staff QS lucia.haddad.20, put on 087-EXC as QS so that, project-scoped
 *     (HR-K4), exception.opened would otherwise reach them. Not 087-EXC's own QS
 *     persona (WP9.notices.criticalOpeningCount note) and not the creating QS
 *     of 087-COM (the qs persona).
 *   - Report definitions, private, project and organisation, owned by the QS
 *     persona, on the certified project (WP9 reportBuilder figures), with a weekly
 *     schedule whose recipient is the cost controller persona, not the owner
 *     (WP9.reportBuilder.scheduledRecipientDownload). Like the definitions
 *     (adopted by name), the schedule is adopted, by its recipient and
 *     frequency (the enabled weekly schedule to the cost controller, exactly
 *     one; R3-17), never made twice.
 *
 * The people are NAMED by spec key (R3-17), asserted to be active staff of
 * their role and not 087-OTH's five (087-OTH asserts its people stay assigned
 * only there). Every find by identity (templates, the guest company, report
 * definitions, parties, the schedule) asserts that at most one record matches
 * (lanes.atMostOne; R2-D).
 *
 * Run alone: node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/build/087-extras.js
 */

const XLSX = require('@e965/xlsx');
const lib = require('./lib');
const { atMostOne } = require('./lanes'); // G6 / R2-D: every find by identity names at most one record

const CERTIFIED = 'OCTA PHASE21 GREENFIELD C087';
const FC = lib.answers.fieldControls;
/**
 * WP9.export.sheetGate (field-controls.js; R2-B1): value 'one permission per sheet', whose value check is
 * "answer '200' and no sheet named Risks" (the leaf's note); today { answer: '200', sheets: [the six sheets
 * of HEAD's export, Risks included] }, HR-K7's known answer.
 */
const SHEET_GATE = FC.WP9.export.sheetGate;
const RISK_SHEET = 'Risks'; // the sheet the leaf's value check names (export.service.js's risk worksheet)
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** The named staff (R3-17): spec keys of 087's population. */
const PEOPLE = {
  noBoq: { key: 'tariq.okafor.2', role: 'site_engineer' },
  exportNoRisk: { key: 'arjun.kamau.7', role: 'site_engineer' },
  optOutQs: { key: 'lucia.haddad.20', role: 'qs' },
};
const listOf = (data) => {
  if (Array.isArray(data)) return data;
  for (const key of ['items', 'rows', 'templates', 'parties', 'preferences', 'schedules', 'data']) if (Array.isArray(data?.[key])) return data[key];
  return [];
};

lib.main('087-EXTRAS', async (b) => {
  // The answer book agrees with itself before anything is judged against it.
  const today = SHEET_GATE.today || {};
  b.assert(today.answer === '200' && Array.isArray(today.sheets) && today.sheets.length === FC.WP9.export.sheets.value && today.sheets.filter((n) => n === RISK_SHEET).length === 1,
    `WP9.export.sheetGate.today is HEAD's answer: '200' with all ${FC.WP9.export.sheets.value} sheets (WP9.export.sheets), ${RISK_SHEET} among them once`, today);
  const exc = b.other('087-EXC');
  const sch = b.other('087-SCH');
  const hlt = b.other('087-HLT');
  const oth = b.other('087-OTH');
  b.assert(Boolean(exc.projectId && sch.projectId && hlt.projectId), `087-EXC (${exc.projectId}), 087-SCH (${sch.projectId}) and 087-HLT (${hlt.projectId}) are built before 087-EXTRAS`);
  // 087-OTH's five: its four named staff and its invited finance officer (read only).
  const othPeople = new Set([...Object.values(oth.out('staff.named').people || {}).map((p) => p.userId), oth.out('finance.staff').userId].filter(Boolean));
  b.assert(othPeople.size === FC.WP9.workflowNotifications.otherProjectStaffHeadcount.value, `087-OTH's ${FC.WP9.workflowNotifications.otherProjectStaffHeadcount.value} people are known (found ${othPeople.size})`);
  const stamp = String(b.state.createdAt || '').replace(/\D/g, '').slice(2, 14); // yymmddhhmmss of this build's state
  b.assert(/^\d{12}$/.test(stamp), `the build state carries its creation time (${b.state.createdAt})`);

  // ── the people: named active staff, not 087-OTH's ──
  const people = await b.step('people', async (s) => {
    const assignable = listOf(await s.get('pm', `${exc.P}/team/assignable`));
    const active = new Set(assignable.map((u) => u.userId));
    const onExc = new Set(listOf(await s.get('pm', `${exc.P}/team`)).map((m) => m.userId));
    const qsPersona = b.person('qs');
    const out = {};
    for (const [slot, { key, role }] of Object.entries(PEOPLE)) {
      const person = b.person(key);
      const staff = b.company.staff(role).filter((p) => p.key === key);
      s.assert(staff.length === 1 && person.role === role && !person.persona && !person.isOwner && !person.isAdmin, `${key} is one of 087's ${role} staff (no persona, not the owner, no company administration)`, { role: person.role, persona: person.persona, isAdmin: person.isAdmin });
      s.assert(active.has(person.id) || onExc.has(person.id), `${key} (${slot}) is active in 087`);
      s.assert(!othPeople.has(person.id), `${key} (${slot}) is not one of 087-OTH's people`);
      out[slot] = { key, userId: person.id };
    }
    s.assert(out.optOutQs.userId !== qsPersona.id, 'the opted-out QS is not the qs persona (087-EXC\'s QS and 087-COM\'s creating QS)');
    s.assert(new Set(Object.values(out).map((p) => p.userId)).size === Object.keys(out).length, 'three different people');
    return out;
  });

  // ── permission templates ──
  const templates = await b.step('templates', async (s) => {
    const list = async (s2) => listOf(await s2.get('pm', '/permissions/templates?includeArchived=true'));
    const make = async (key, payload, fields) => {
      const name = b.name(payload.label);
      const { label, ...rest } = payload;
      const data = await s.create(`template.${key}`, 'pm', '/permissions/templates', { name, ...rest }, {
        fields: { name, ...fields },
        get: (id) => `/permissions/templates/${id}`,
        adopt: true,
        find: async (s2) => atMostOne(s2, await list(s2), (t) => t.name === name, `permission template "${name}"`),
      });
      return { id: data.id, name };
    };
    const noBoq = await make('NOBOQ', {
      label: 'Site engineer without BOQ read', description: b.name('Denies boq:read'), kind: 'internal', baseRole: 'site_engineer',
      tools: [{ module: 'boq', level: 'none' }],
    }, { kind: 'internal', baseRole: 'site_engineer' });
    const exportNoRisk = await make('EXPORT', {
      label: 'Cost export without risk read', description: b.name('Grants cost:export, denies risk:read'), kind: 'internal', baseRole: 'site_engineer',
      tools: [{ module: 'risk', level: 'none' }], grants: [{ module: 'cost', action: 'export' }],
    }, { kind: 'internal', baseRole: 'site_engineer' });
    const guest = await make('GUEST', {
      label: 'Guest without procurement or change-order read', description: b.name('Party guest: no procurement, no change orders'), kind: 'external', basePartyRole: 'consultant',
      tools: [{ module: 'procurement', level: 'none' }, { module: 'change_order', level: 'none' }],
    }, { kind: 'external', basePartyRole: 'consultant' });
    // The tools and grants as stored.
    const check = async (t, tools, grants = []) => {
      const row = await s.get('pm', `/permissions/templates/${t.id}`);
      const stored = Object.fromEntries((row.tools || []).map((x) => [x.module, x.level]));
      for (const [module, level] of Object.entries(tools)) s.assert(stored[module] === level, `${t.name}: ${module} at ${level} (stored ${stored[module]})`, row.tools);
      const keys = (row.grants || []).map((g) => g.key || `${g.module}|${g.transition ? `transition:${g.transition}` : `action:${g.action}`}`);
      for (const g of grants) s.assert(keys.includes(g), `${t.name}: grant ${g}`, row.grants);
    };
    await check(noBoq, { boq: 'none' });
    await check(exportNoRisk, { risk: 'none' }, ['cost|action:export']);
    await check(guest, { procurement: 'none', change_order: 'none' });
    return { noBoq, exportNoRisk, guest };
  });

  // ── the members on 087-EXC (and the BOQ-denied one on 087-SCH), each with their template ──
  const teamRow = async (s2, project, userId) => {
    const rows = listOf(await s2.get('pm', `${project.P}/team`)).filter((m) => m.userId === userId);
    return rows.length === 1 ? rows[0] : null;
  };
  const addMember = async (s, name, project, userId, role) => s.create(name, 'pm', `${project.P}/team`, { userId, role }, {
    expect: [201, 200],
    named: false,
    get: null, // re-read live by the step's verify
    idOf: (d) => d?.userId ?? null,
    fields: { userId, assignmentRole: role },
    // Interrupted: the assignment is found by user id on the project's team (POST /team answers 200 for a member already there).
    find: async (s2) => teamRow(s2, project, userId),
  });
  const giveTemplate = async (s, name, project, userId, template) => s.act(name, 'pm', 'PUT', `${project.P}/team/${userId}/permissions`, { templateId: template.id }, {
    fields: { 'template.id': template.id },
    verify: async (s2) => (await teamRow(s2, project, userId))?.template?.id === template.id,
  });
  await b.step('members', async (s) => {
    await addMember(s, 'member.noBoq.exc', exc, people.noBoq.userId, 'site_engineer');
    await giveTemplate(s, 'template.noBoq.exc', exc, people.noBoq.userId, templates.noBoq);
    await addMember(s, 'member.noBoq.sch', sch, people.noBoq.userId, 'site_engineer');
    await giveTemplate(s, 'template.noBoq.sch', sch, people.noBoq.userId, templates.noBoq);
    await addMember(s, 'member.exportNoRisk.exc', exc, people.exportNoRisk.userId, 'site_engineer');
    await giveTemplate(s, 'template.exportNoRisk.exc', exc, people.exportNoRisk.userId, templates.exportNoRisk);
    await addMember(s, 'member.optOutQs.exc', exc, people.optOutQs.userId, 'qs');
    // The effect, as each member reads: the BOQ refused to the first (on both projects), the risk register to the second.
    for (const project of [exc, sch]) {
      const res = await s.send(people.noBoq.key, 'GET', `${project.P}/boq`);
      s.assert(res.status === 403, `${people.noBoq.key} is refused the BOQ of ${project.code} (got ${lib.said(res)})`);
    }
    const risks = await s.send(people.exportNoRisk.key, 'GET', `${exc.P}/risks`);
    s.assert(risks.status === 403, `${people.exportNoRisk.key} is refused the risk register of 087-EXC (got ${lib.said(risks)})`);
    const boqForExporter = await s.send(people.exportNoRisk.key, 'GET', `${exc.P}/boq`);
    s.assert(boqForExporter.status === 200, `${people.exportNoRisk.key} still reads the BOQ of 087-EXC (got ${lib.said(boqForExporter)})`);
    return { noBoq: people.noBoq.userId, exportNoRisk: people.exportNoRisk.userId, optOutQs: people.optOutQs.userId };
  }, {
    needs: ['people', 'templates'],
    verify: async (s, out) => {
      if ((await teamRow(s, exc, out.noBoq))?.template?.id !== templates.noBoq.id) return 'the BOQ-denied member lost the template on 087-EXC';
      if ((await teamRow(s, sch, out.noBoq))?.template?.id !== templates.noBoq.id) return 'the BOQ-denied member lost the template on 087-SCH';
      if ((await teamRow(s, exc, out.exportNoRisk))?.template?.id !== templates.exportNoRisk.id) return 'the export member lost the template on 087-EXC';
      if ((await teamRow(s, exc, out.optOutQs))?.assignmentRole !== 'qs') return 'the opted-out QS is no longer on 087-EXC as QS';
      return true;
    },
  });

  // ── the export effect (R3-9; R2-B1): judged against WP9.export.sheetGate, its value check and its `today` ──
  await b.step('export.sheet-gate', async (s) => {
    const key = people.exportNoRisk.key;
    const route = `${exc.P}/export/xlsx`;
    const session = await b.session(key);
    const res = b._track(await session.send('GET', route, undefined, { binary: true }), `${key} GET ${route}`);
    b.requests += 1;
    s.assert(res.status === 200 && Buffer.isBuffer(res.buffer), `${key} exports 087-EXC (cost:export): 200 with a workbook, as both the leaf's value and its today answer (got ${lib.said(res)})`);
    const sheets = XLSX.read(res.buffer, { type: 'buffer', bookSheets: true }).SheetNames;
    // The answer in the leaf's terms: { answer: said(res), sheets: the workbook's sheet names in order }.
    const observed = { answer: lib.said(res), sheets };
    // WP9.export.sheetGate's value check: '200' and no sheet named Risks for a member denied risk:read.
    if (observed.answer === '200' && !sheets.includes(RISK_SHEET)) return observed;
    // HR-K7's known answer, exactly the leaf's today: one gate for the whole workbook (cost:export), so the member
    // receives all six sheets, Risks included, in the export service's order.
    if (sameJson(observed, { answer: SHEET_GATE.today.answer, sheets: SHEET_GATE.today.sheets })) {
      s.blocked('HR-K7', { expected: SHEET_GATE.value, valueCheck: `answer '200' and no sheet named ${RISK_SHEET}`, today: SHEET_GATE.today, ...observed, note: `the project export has one gate (cost:export) and no per-sheet permission: ${key}, denied risk:read, receives all ${sheets.length} sheets, ${RISK_SHEET} included (WP9.export.sheetGate.today)` });
    }
    s.assert(false, `the export of ${key} is neither the answer book's WP9.export.sheetGate ('200' and no sheet named ${RISK_SHEET}) nor exactly its today (HR-K7's known answer)`, { observed, today: SHEET_GATE.today });
    return null;
  }, { needs: ['members'] });

  // ── the party guest: a consultant party of one directory company on 087-EXC and on 087-HLT ──
  const guestCompany = await b.step('guest.company', async (s) => {
    const name = b.name('Guest consultant');
    const search = `/companies?limit=100&search=${encodeURIComponent(name)}`;
    const company = await s.create('guest.company', 'pm', '/companies', { name, type: 'external', email: 'guest.087extras@parties.c087.octapm-cert.test', status: 'active' }, {
      fields: { name, type: 'external' },
      get: search,
      adopt: true,
      find: async (s2) => atMostOne(s2, listOf(await s2.get('pm', search)), (row) => row.name === name, `directory company "${name}"`),
    });
    return { companyId: company.id, name };
  });
  /** The consultant party of the guest company on a project, with the guest template (exactly one; adopted, never a second). */
  const guestParty = async (project, tag) => b.step(`guest.party.${tag}`, async (s) => {
    const partyOf = async (s2) => {
      const rows = listOf(await s2.get('pm', `${project.P}/parties`)).filter((row) => row.companyId === guestCompany.companyId && row.role === 'consultant');
      if (rows.length > 1) throw new lib.BuildError(`${project.code}: ${rows.length} consultant parties of ${guestCompany.name}; resolve by hand`);
      return rows[0] || null;
    };
    const party = await s.create(`guest.party.${tag}`, 'pm', `${project.P}/parties`, { role: 'consultant', companyId: guestCompany.companyId, accessLevel: 'read_only', contactName: b.name('Guest reviewer') }, {
      fields: { role: 'consultant', companyId: guestCompany.companyId, status: 'active' },
      get: `${project.P}/parties`,
      adopt: true,
      find: partyOf,
    });
    await s.act(`guest.party.${tag}.template`, 'pm', 'PUT', `${project.P}/team/parties/${party.id}/permissions`, { templateId: templates.guest.id }, {
      fields: { 'template.id': templates.guest.id },
      verify: async (s2) => listOf((await s2.get('pm', `${project.P}/team`))?.parties).find((p) => p.id === party.id)?.template?.id === templates.guest.id,
    });
    return { projectId: project.projectId, partyId: party.id };
  }, { needs: ['templates', 'guest.company'] });
  const excParty = await guestParty(exc, 'exc');
  const hltParty = await guestParty(hlt, 'hlt');

  /**
   * The members of a consultant party, as the API gives the rows (company-party.service.js
   * sanitizeMember: id, userId, role, status, ...; R3-4: never a default). The party holds exactly
   * one active member, the guest; a removed member reads status 'inactive' (removeProjectPartyMember)
   * and is not held. Returns { members } when that holds, else { problem, members }.
   */
  const partyMembers = async (s, project, partyId, guestId) => {
    const parties = listOf(await s.get('pm', `${project.P}/parties`)).filter((p) => p.id === partyId);
    if (parties.length !== 1) return { problem: `the consultant party ${partyId} is on ${project.code} ${parties.length} times, not once`, members: [] };
    const members = (parties[0].members || []).map((m) => ({ id: m.id ?? null, userId: m.userId ?? null, role: m.role ?? null, status: m.status ?? null }));
    const active = members.filter((m) => m.status === 'active');
    if (active.length !== 1 || active[0].userId !== guestId) return { problem: `the consultant party on ${project.code} holds ${active.length} active member(s), not exactly one, the guest ${guestId} (read ${JSON.stringify(members)})`, members };
    return { members };
  };
  /** What the guest reaches on a project: the party's one active member, on it through the party and its template only; POs and COs 403, RFIs 200. */
  const guestAccess = async (s, project, partyId, guestId) => {
    const held = await partyMembers(s, project, partyId, guestId);
    s.assert(!held.problem, held.problem || `the consultant party on ${project.code} holds exactly one active member, the guest`, held.members);
    const team = listOf(await s.get('pm', `${project.P}/team`)).filter((m) => m.userId === guestId);
    s.assert(team.length === 1 && !team[0].assignmentRole && team[0].source === 'party_template', `the guest is on ${project.code} through the party and its template only (read ${JSON.stringify(team)})`);
    const said = {};
    for (const [key, route, want] of [['purchaseOrders', `${project.P}/procurement/purchase-orders`, 403], ['changeOrders', `${project.P}/change-orders`, 403], ['rfis', `${project.P}/rfi`, 200]]) {
      const res = await s.send('guest', 'GET', route);
      said[key] = lib.said(res);
      s.assert(res.status === want, `on ${project.code} the guest's GET ${key} answers ${want} (got ${said[key]})`);
    }
    return { said, members: held.members };
  };
  /** On a resume: the party still holds exactly one active member, the guest (read live). */
  const verifyGuestParty = (project, partyId) => async (s, out) => {
    const held = await partyMembers(s, project, partyId, out.guestId);
    return held.problem ? held.problem : true;
  };

  // The guest: a person NOT in the population, by D-ID-1 invitation and acceptance onto the 087-EXC party.
  if (excParty) {
    await b.invite('guest', {
      inviter: 'pm',
      email: `cert3.${b.code.toLowerCase()}.guest.${stamp}@${b.company.domain}`,
      role: 'site_engineer',
      name: b.name('Party guest'),
      projectId: exc.projectId,
      projectPartyId: excParty.partyId,
    });
    await b.step('guest.access', async (s) => {
      const guestId = await b.userId('guest');
      const access = await guestAccess(s, exc, excParty.partyId, guestId);
      return { guestId, partyId: excParty.partyId, said: access.said, members: access.members };
    }, { needs: ['guest.party.exc', 'invite.guest'], verify: verifyGuestParty(exc, excParty.partyId) });
  }

  // The same guest on 087-HLT's consultant party (R3-5: WP-9 health reads 087-HLT's card), added as a party member.
  if (hltParty && excParty) {
    await b.step('guest.hlt', async (s) => {
      const guestId = await b.userId('guest');
      const P = `${hlt.P}/parties/${hltParty.partyId}`;
      // An interrupted add is adopted from the guest's member row as the API gives it (company-party.service.js
      // sanitizeMember: id, userId, role, status, ...), at most one; never a default (R3-4).
      const memberOf = async (s2) => {
        const parties = listOf(await s2.get('pm', `${hlt.P}/parties`)).filter((p) => p.id === hltParty.partyId);
        return atMostOne(s2, parties[0]?.members || [], (m) => m.userId === guestId, 'the guest\'s membership of the 087-HLT consultant party');
      };
      await s.create('guest.hlt.member', 'pm', `${P}/members`, { userId: guestId }, {
        named: false,
        // POST .../members answers { id, status } (company-party.service.js addProjectPartyMember); the adopted row carries both too.
        fields: { id: lib.is.present, status: 'active' },
        get: null, // read live below and by the step's verify
        find: memberOf,
      });
      const access = await guestAccess(s, hlt, hltParty.partyId, guestId);
      return { guestId, partyId: hltParty.partyId, said: access.said, members: access.members };
    }, {
      needs: ['guest.party.hlt', 'invite.guest'],
      verify: verifyGuestParty(hlt, hltParty.partyId),
    });
  }

  // ── the QS with the commercial category off (in-app, e-mail and push) ──
  const commercialOff = async (s2, key) => {
    const rows = listOf(await s2.get(key, '/notifications/preferences')).filter((p) => p.category === 'commercial');
    return rows.length === 1 && rows[0].inAppEnabled === false && rows[0].emailEnabled === false ? rows[0] : null;
  };
  await b.step('opt-out', async (s) => {
    const key = people.optOutQs.key;
    const data = await s.act('opt-out.commercial', key, 'PUT', '/notifications/preferences', {
      preferences: [{ category: 'commercial', inAppEnabled: false, emailEnabled: false, pushEnabled: false }],
    }, {
      fields: { '$status': 200 },
      // Interrupted: the preference is read back; commercial off means the PUT took effect.
      verify: async (s2) => Boolean(await commercialOff(s2, key)),
    });
    const commercial = await commercialOff(s, key);
    s.assert(Boolean(commercial), `${key}'s commercial category is off (in-app and e-mail)`);
    return { userId: people.optOutQs.userId, key, category: 'commercial', answer: Array.isArray(data) ? data.length : null };
  }, {
    needs: ['members'],
    verify: async (s, out) => Boolean(await commercialOff(s, out.key)) || `${out.key}'s commercial category is on again`,
  });

  // ── report definitions on the certified project, and a schedule to someone other than the owner ──
  await b.step('reports', async (s) => {
    const certified = listOf(await s.get('qs', `/projects?limit=100&search=${encodeURIComponent(CERTIFIED)}`)).filter((p) => p.name === CERTIFIED && !p.archivedAt);
    s.assert(certified.length === 1, `the certified project ${CERTIFIED} is visible to the QS once (found ${certified.length})`);
    const projectId = certified[0].id;
    const ownerId = await b.userId('qs');
    const recipientId = await b.userId('cost');
    s.assert(ownerId !== recipientId, 'the schedule recipient is not the owner');
    const list = async (s2) => listOf(await s2.get('qs', `/reports?projectId=${projectId}`));
    const define = async (key, visibility, source, extra = {}) => {
      const name = b.name(`Report ${key}`);
      const data = await s.create(`report.${key.replace(/\s+/g, '-')}`, 'qs', '/reports', { name, description: b.name(`${visibility} report on the certified project`), source, projectId, visibility, ...extra }, {
        fields: { name, visibility, source, projectId },
        adopt: true,
        find: async (s2) => atMostOne(s2, await list(s2), (r) => r.name === name, `report definition "${name}"`),
      });
      return { id: data.id, name, visibility, source };
    };
    // WP9.reportBuilder: 14 activities (complete 1, in progress 2, todo 11), total duration 95; Original 1,700,000.00, actual 71,160.00, committed 100,000.00.
    const priv = await define('private activities', 'private', 'activity');
    const proj = await define('project activities', 'project', 'activity', { groupBy: 'status', aggregates: [{ fn: 'sum', field: 'duration' }] });
    const org = await define('organisation budget', 'org', 'budget_line', { aggregates: [{ fn: 'sum', field: 'originalBudget' }, { fn: 'sum', field: 'actual' }, { fn: 'sum', field: 'committed' }] });
    const recipientsOf = (row) => row?.recipients?.userIds || row?.recipientsJson?.userIds || [];
    // The schedule that sends: enabled, weekly, to the cost controller, found by its recipient and frequency
    // (R3-17), exactly one. Like the definitions it hangs on (adopted by name), it is adopted, never made twice.
    const scheduleOf = async (s2) => {
      const rows = listOf(await s2.get('qs', `/reports/${org.id}/schedules`)).filter((row) => row.enabled === true && row.frequency === 'weekly' && recipientsOf(row).includes(recipientId));
      if (rows.length > 1) throw new lib.BuildError(`report.schedule: ${rows.length} enabled weekly schedules to ${recipientId} on ${org.name}; resolve by hand`);
      return rows[0] || null;
    };
    const schedule = await s.create('report.schedule', 'qs', `/reports/${org.id}/schedules`, {
      frequency: 'weekly', dayOfWeek: 1, hour: 7, minute: 0, timezone: 'Africa/Cairo', format: 'both', recipients: { userIds: [recipientId] }, enabled: true,
    }, {
      named: false,
      get: () => `/reports/${org.id}/schedules`,
      fields: { frequency: 'weekly', enabled: true, format: 'both' },
      adopt: true,
      find: scheduleOf,
    });
    const stored = await scheduleOf(s);
    s.assert(stored?.id === schedule.id, `the weekly schedule to the cost controller is ${schedule.id} (found ${stored?.id})`);
    const recipients = recipientsOf(stored);
    s.assert(recipients.includes(recipientId) && !recipients.includes(ownerId), `the schedule goes to the cost controller (${recipientId}), not the owner (read ${JSON.stringify(stored?.recipients || stored?.recipientsJson)})`);
    return { projectId, ownerId, recipientId, definitions: { private: priv.id, project: proj.id, org: org.id }, scheduleId: schedule.id };
  });
});
