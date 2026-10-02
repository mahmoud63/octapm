'use strict';

/**
 * Collaboration, risk, reporting and administration.
 *
 * Per project: meetings (attendees, agenda, decisions, action items, minutes,
 * distribution), tasks, risks, comments with mentions, record follows,
 * conversations and messages, notifications, saved reports with a disabled
 * schedule, project custom fields and their values, a custom permission
 * template with a per-user override, workflow templates and instances.
 *
 * Once per company (ids kept in ctx.companyRefs.collab): a company custom
 * field, a company workflow template, a company-wide saved report, company
 * conversations, a notification preference, one paused webhook and one API
 * key.
 *
 * Every list of states below is ordered so that the low end of each count
 * already leaves the whole mix behind.
 *
 * Re-runnable: names that the product keeps unique (permission templates,
 * custom-field keys) carry a run counter kept in ctx.refs.collab.runs;
 * company-level records are found again by name before they are created.
 */

const PERSONAS = ['pm', 'planner', 'qs', 'cost', 'procurement', 'warehouse', 'site', 'quality', 'finance'];

/** Companies whose webhook was already asked for in this loader run. */
const webhookTried = new Set();

const listOf = (data) =>
  Array.isArray(data)
    ? data
    : data?.items || data?.rows || data?.records || data?.meetings || data?.tasks || data?.risks || data?.comments || data?.conversations || data?.messages || [];

/** A one-page PDF whose only text is `text`. */
const pdfOf = (text) => {
  const safe = String(text).replace(/[()\\]/g, ' ');
  const stream = `BT /F1 11 Tf 40 760 Td (${safe}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
};

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const MEETING_STATES = ['distributed', 'draft', 'finalized', 'archived', 'distributed', 'finalized'];
const MEETING_TYPES = ['progress', 'coordination', 'safety', 'commercial', 'quality', 'design'];
const MEETING_SUBJECTS = ['Weekly progress meeting', 'Trade coordination meeting', 'Site safety meeting', 'Commercial review', 'Quality review', 'Design coordination'];
const AGENDA = ['Progress against the lookahead', 'Open RFIs and submittals', 'Safety observations', 'Procurement and deliveries', 'Variations and claims', 'Programme for the next two weeks'];

const TASK_STATES = ['todo', 'in_progress', 'done', 'canceled', 'archived', 'blocked', 'done', 'todo', 'in_progress'];
const TASK_LABELS = ['action', 'field', 'procurement', 'quality', 'safety', 'commercial', 'document'];
const TASK_PRIORITIES = ['medium', 'high', 'low', 'critical'];
const TASK_SUBJECTS = ['Chase the outstanding shop drawings', 'Re-brief the lifting plan', 'Confirm delivery slot with the supplier', 'Close out the snag list', 'Update the method statement', 'Price the instructed variation', 'File the signed inspection requests', 'Survey the as-built levels', 'Book the concrete pump'];

const RISK_STATES = ['open', 'monitoring', 'submitted', 'closed', 'rejected', 'reopened', 'archived', 'open'];
const LEVELS = ['low', 'medium', 'high'];
const RISK_SUBJECTS = ['Late delivery of reinforcement', 'Ground water higher than the report', 'Shortage of skilled labour', 'Design information released late', 'Adverse weather during the pours', 'Utility diversion not complete', 'Subcontractor insolvency', 'Access restricted by the neighbouring works'];

const run = async (ctx) => {
  const { P, rng, company } = ctx;
  const projectId = ctx.project.id;
  const pm = ctx.who('pm');
  const planner = ctx.who('planner');
  const pmId = ctx.userId('pm');

  // ── what this run is, and what earlier runs left ─────────────────────────
  const state = (ctx.refs.collab = ctx.refs.collab || { runs: 0 });
  state.runs = (state.runs || 0) + 1;
  const tag = `R${state.runs}`;
  const co = (ctx.companyRefs.collab = ctx.companyRefs.collab || {});
  const keyBase = `cx_${ctx.project.key.replace(/[^0-9a-z]+/gi, '_')}_r${state.runs}`.toLowerCase();

  const activities = Object.entries(ctx.refs.activities || {});
  if (!activities.length) throw new Error('collaboration-admin: the project has no activities');
  const act = (i) => activities[((i % activities.length) + activities.length) % activities.length];

  // ── the people: personas who can open this project ───────────────────────
  const team = listOf(await pm.GET(`${P}/team`));
  const onTeam = new Set(team.map((row) => row.userId));
  const seen = new Set();
  const members = [];
  for (const key of PERSONAS) {
    const person = ctx.person(key);
    if (!person || seen.has(person.id)) continue;
    if (!(onTeam.has(person.id) || person.role === 'pm')) continue;
    seen.add(person.id);
    members.push(person);
  }
  const sessionOf = (person) => ctx.who(person.persona);
  const colleagues = members.filter((person) => person.id !== pmId);
  const member = (i) => members[((i % members.length) + members.length) % members.length];
  /** Somebody other than `person` when the company has anybody else. */
  const otherThan = (person, i = 0) => {
    const rest = members.filter((candidate) => candidate.id !== person.id);
    return rest.length ? rest[i % rest.length] : person;
  };
  /** The persona's person when they can open the project, the PM otherwise. */
  const onProject = (key) => (members.some((person) => person.id === ctx.userId(key)) ? ctx.person(key) : ctx.person('pm'));
  const site = onProject('site');
  const qs = onProject('qs');
  const quality = onProject('quality');
  const plannerPerson = onProject('planner');

  const made = { meetings: {}, tasks: {}, risks: {}, comments: [], conversations: {}, reports: [], customFields: {}, workflow: {} };

  // ════════════════════════════════════════════════════════════════════════
  // Once per company
  // ════════════════════════════════════════════════════════════════════════

  // A company custom field on tasks (optional, so no other driver's writes are refused).
  if (!co.customFieldId) {
    await ctx.attempt('company custom field', async () => {
      const existing = listOf(await pm.GET('/company/custom-fields?recordType=task&includeArchived=true')).find((row) => row.key === 'cert_company_reference');
      const row =
        existing ||
        (await pm.POST('/company/custom-fields', {
          recordType: 'task',
          type: 'text',
          key: 'cert_company_reference',
          label: `Company reference ${company.canary}`,
          description: `Company-wide field — ${company.canary}-CUSTOM_FIELD_DEFINITION`,
          required: false,
          position: 900,
        }));
      co.customFieldId = row.id;
      co.customFieldKey = row.key;
      ctx.record('custom_field_definition', row.id, { scope: 'company' });
    });
  }

  // A company workflow template: not the default and without rules, so it is never picked automatically.
  if (!co.workflowTemplateId) {
    await ctx.attempt('company workflow template', async () => {
      const name = `${company.canary} correspondence close-out (company)`;
      const existing = listOf(await pm.GET('/company/workflow-templates?tool=correspondence&includeArchived=true')).find((row) => row.name === name);
      const row =
        existing ||
        (await pm.POST('/company/workflow-templates', {
          tool: 'correspondence',
          name,
          description: `Company route — ${company.canary}-WORKFLOW_TEMPLATE`,
          isDefault: false,
          priority: 0,
          rules: [],
          steps: [
            {
              key: 'pm_closeout',
              name: 'PM close-out',
              type: 'response',
              assignees: [{ type: 'role', role: 'pm' }],
              days: 7,
              responses: [
                { key: 'close', label: 'Close', next: 'end_success', tone: 'positive' },
                { key: 'keep_open', label: 'Keep open', next: 'end_fail', tone: 'negative', requireComment: true },
              ],
            },
          ],
        }));
      co.workflowTemplateId = row.id;
      ctx.record('workflow_template', row.id, { scope: 'company' });
    });
  }

  // A company fieldset holding that field (not the default), and a correspondence record type.
  if (!co.fieldsetId && co.customFieldId) {
    await ctx.attempt('company fieldset', async () => {
      const name = `${company.canary} task fields`;
      const existing = listOf(await pm.GET('/company/custom-fieldsets?recordType=task&includeArchived=true')).find((row) => row.name === name);
      const row =
        existing ||
        (await pm.POST('/company/custom-fieldsets', {
          recordType: 'task',
          name,
          description: `Company fieldset — ${company.canary}-CUSTOM_FIELDSET`,
          isDefault: false,
          fields: [{ fieldId: co.customFieldId, required: false, hidden: false }],
        }));
      co.fieldsetId = row.id;
      ctx.record('custom_fieldset', row.id, { scope: 'company' });
    });
  }
  if (!co.recordTypeKey) {
    await ctx.attempt('company record type', async () => {
      const existing = listOf(await pm.GET('/company/record-types?tool=correspondence&includeArchived=true')).find((row) => row.key === 'cert_site_instruction');
      const row =
        existing ||
        (await pm.POST('/company/record-types', {
          tool: 'correspondence',
          key: 'cert_site_instruction',
          label: `Site instruction ${company.canary}`,
          description: `A letter that instructs work — ${company.canary}-RECORD_TYPE_DEFINITION`,
          position: 5,
        }));
      co.recordTypeId = row.id;
      co.recordTypeKey = row.key;
      ctx.record('record_type_definition', row.id, { scope: 'company' });
    });
  }

  // One outbound webhook per company: a single specific event type, paused at once.
  // Tried once per company in a loader run; the refusal (if any) is kept for the report.
  if (!co.webhookId && !webhookTried.has(company.code)) {
    webhookTried.add(company.code);
    const url = `https://hooks.c${company.code}.octapm-cert.test/hook`;
    const existing = listOf(await pm.GET('/integrations/webhooks')).find((row) => row.url === url);
    if (existing) {
      if (existing.status !== 'paused') await pm.PATCH(`/integrations/webhooks/${existing.id}`, { status: 'paused' });
      co.webhookId = existing.id;
    } else {
      const created = await ctx.attempt('webhook subscription', () =>
        pm.POST('/integrations/webhooks', {
          name: `${company.canary} RFI created`,
          description: `Certification subscription — ${company.canary}-WEBHOOK_SUBSCRIPTION`,
          url,
          eventTypes: ['rfi.created'],
          status: 'paused',
        })
      );
      if (created?.id) {
        // The create ignores `status`; pause before anything else happens, and never leave it active.
        let paused = null;
        try {
          paused = await pm.PATCH(`/integrations/webhooks/${created.id}`, { status: 'paused' });
        } catch (error) {
          await pm.send('DELETE', `/integrations/webhooks/${created.id}`);
          throw error;
        }
        if (paused?.status !== 'paused') {
          await pm.send('DELETE', `/integrations/webhooks/${created.id}`);
          throw new Error(`collaboration-admin: webhook ${created.id} did not pause (status ${paused?.status}); it was removed`);
        }
        if (created.status && created.status !== 'paused') ctx.note(`webhook: POST with status "paused" answered status "${created.status}"; paused by PATCH straight after`);
        co.webhookId = created.id;
        delete co.webhookRefused;
        ctx.record('webhook_subscription', created.id, { scope: 'company' });
      } else {
        co.webhookRefused = ctx.notes[ctx.notes.length - 1] || true;
      }
    }
  }

  // One API key per company. The key itself is used once for a read and then dropped: it is never stored or printed.
  if (!co.apiClientId) {
    await ctx.attempt('api client', async () => {
      const name = `${company.canary} reporting key`;
      const existing = listOf(await pm.GET('/integrations/api-clients')).find((row) => row.name === name);
      if (existing) {
        co.apiClientId = existing.id;
        return;
      }
      const created = await pm.POST('/integrations/api-clients', {
        name,
        description: `Read-only key for tasks, risks and meetings — ${company.canary}-API_CLIENT`,
        scopes: ['task:read', 'risk:read', 'meeting:read'],
        expiresAt: `${ctx.daysAhead(180)}T00:00:00.000Z`,
      });
      co.apiClientId = created.id;
      co.apiClientPrefix = created.keyPrefix || null;
      ctx.record('api_client', created.id, { scope: 'company' });
      if (created.token) {
        const read = await pm.send('GET', `${P}/risks`, undefined, { token: created.token });
        if (read.status !== 200) ctx.note(`api client: a risk:read key read ${P}/risks -> ${read.status} ${read.body?.error?.code || ''}`);
        const write = await pm.send('POST', `${P}/risks`, { description: `${company.canary}-API_CLIENT must not be written` }, { token: created.token });
        if (write.status < 400) ctx.note(`api client: a read-only key created a risk (${write.status}) — id ${write.body?.data?.id}`);
        if (write.status >= 500) ctx.note(`api client: read-only key write -> ${write.status}`);
      }
    });
  }

  // Company conversations: one direct, one group, both outside any project.
  if (!co.conversations && colleagues.length) {
    await ctx.attempt('company conversations', async () => {
      const other = colleagues[0];
      const direct = await pm.POST('/conversations', { kind: 'direct', memberUserIds: [other.id], message: `Company direct message — ${company.canary}-CONVERSATION_MESSAGE-D` });
      const group = await pm.POST('/conversations', {
        kind: 'group',
        title: `${company.canary} management team`,
        memberUserIds: colleagues.slice(0, 5).map((person) => person.id),
        message: `Company group message — ${company.canary}-CONVERSATION_MESSAGE-G`,
      });
      co.conversations = { direct: direct.id, group: group.id };
      ctx.record('conversation', direct.id, { scope: 'company' });
      ctx.record('conversation', group.id, { scope: 'company' });
    });
  }

  // A company-wide saved report (no project).
  if (!co.reportId) {
    await ctx.attempt('company report', async () => {
      const name = `${company.canary} open tasks, all projects`;
      const existing = listOf(await pm.GET('/reports?source=task')).find((row) => row.name === name);
      const row =
        existing ||
        (await pm.POST('/reports', {
          name,
          description: `Company-wide — ${company.canary}-REPORT_DEFINITION`,
          source: 'task',
          columns: ['project.name', 'taskNumber', 'title', 'status', 'priority', 'dueDate'],
          filters: [{ field: 'status', op: 'nin', value: ['done', 'canceled'] }],
          sort: { field: 'dueDate', dir: 'asc' },
          visibility: 'org',
        }));
      co.reportId = row.id;
      ctx.record('report_definition', row.id, { scope: 'company' });
    });
  }

  // One person's notification preferences (their own setting; nothing else depends on it).
  if (!co.preferencesSet) {
    await ctx.attempt('notification preferences', async () => {
      const person = colleagues[0] || members[0];
      const saved = await sessionOf(person).PUT('/notifications/preferences', {
        preferences: [
          { category: 'comment', inAppEnabled: true, emailEnabled: false, digestEnabled: true },
          { category: 'due', dueSoonDays: 5, quietHoursStart: '20:00', quietHoursEnd: '06:00' },
        ],
      });
      co.preferencesSet = person.id;
      for (const row of listOf(saved?.preferences || saved)) if (row?.id) ctx.record('notification_preference', row.id, { scope: 'company' });
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Meetings
  // ════════════════════════════════════════════════════════════════════════
  const meetingMakers = [plannerPerson, site, quality, ctx.person('pm')];
  const meetings = [];
  const nMeetings = ctx.count(4, 6);
  for (let i = 0; i < nMeetings; i += 1) {
    const target = MEETING_STATES[i % MEETING_STATES.length];
    const maker = meetingMakers[i % meetingMakers.length];
    const who = sessionOf(maker);
    const [code, activityId] = act(i * 3);
    const attending = [ctx.person('pm'), ...rng.shuffle(colleagues).slice(0, rng.int(1, 5))];
    if (!attending.some((person) => person.id === maker.id)) attending.push(maker);
    const owners = attending.length > 1 ? attending : members;
    const nActions = rng.int(1, 3);
    const created = await who.POST(`${P}/meetings`, {
      title: `${MEETING_SUBJECTS[i % MEETING_SUBJECTS.length]} ${tag}-${i + 1} — ${ctx.canary('meeting')}`,
      meetingType: MEETING_TYPES[i % MEETING_TYPES.length],
      status: 'draft',
      chairId: pmId,
      activityId,
      scheduledAt: `${ctx.daysAgo(3 + i * 7)}T08:00:00.000Z`,
      location: `Site office, room ${1 + (i % 3)} — ${ctx.canary('meeting_location')}`,
      objective: `Review of ${code} and the coming fortnight — ${ctx.canary('meeting_objective')}`,
      attendees: [
        ...attending.map((person, index) => ({
          userId: person.id,
          role: person.id === pmId ? 'Chair' : person.id === maker.id ? 'Minutes' : 'Attendee',
          attendanceStatus: index % 4 === 3 ? 'absent' : 'attended',
          distributionRequired: true,
        })),
        // Somebody from outside, by name only: no address, so nothing can be sent to them.
        { name: `Client representative ${ctx.canary('meeting_attendee')}`, companyName: `${company.canary} Property Group`, role: 'Client', attendanceStatus: 'apology', distributionRequired: false },
      ],
      agendaItems: Array.from({ length: rng.int(2, 4) }, (_, k) => ({
        title: `${AGENDA[(i + k) % AGENDA.length]} — ${ctx.canary('meeting_agenda_item')}`,
        sortOrder: k + 1,
        status: ['covered', 'open', 'deferred'][k % 3],
        activityId: act(i * 3 + k)[1],
        presenterId: attending[k % attending.length].id,
        notes: `Notes ${ctx.canary('meeting_agenda_note')}`,
      })),
      decisions: [
        {
          title: `Decision on ${code} — ${ctx.canary('meeting_decision')}`,
          decision: `Proceed as discussed; sequence confirmed. ${ctx.canary('meeting_decision_text')}`,
          impact: `None on the completion date. ${ctx.canary('meeting_decision_impact')}`,
          activityId,
          decidedById: pmId,
          decidedAt: `${ctx.daysAgo(3 + i * 7)}T09:00:00.000Z`,
        },
      ],
      actionItems: Array.from({ length: nActions }, (_, k) => ({
        itemNumber: String(k + 1),
        title: `${TASK_SUBJECTS[(i + k) % TASK_SUBJECTS.length]} — ${ctx.canary('meeting_action_item')}`,
        description: `Raised in the meeting. ${ctx.canary('meeting_action_description')}`,
        ownerId: owners[(k + 1) % owners.length].id,
        dueDate: ctx.daysAhead(3 + k * 4 - i),
        priority: ['medium', 'high', 'low'][k % 3],
        status: k === 2 ? 'in_progress' : 'open',
        activityId: act(i * 3 + k)[1],
        // The first action of every meeting also becomes a task.
        createTask: k === 0,
      })),
    });
    ctx.record('meeting', created.id);
    let full = await who.GET(`${P}/meetings/${created.id}`);
    for (const row of full.attendees || []) if (row.id) ctx.record('meeting_attendee', row.id);
    for (const row of full.agendaItems || []) if (row.id) ctx.record('meeting_agenda_item', row.id);
    for (const row of full.decisions || []) if (row.id) ctx.record('meeting_decision', row.id);
    for (const row of full.actionItems || []) {
      if (row.id) ctx.record('meeting_action_item', row.id);
      if (row.taskId) ctx.record('task', row.taskId);
    }

    // Somebody who attended comments on the minutes.
    const commenter = otherThan(maker, i);
    const remark = await sessionOf(commenter).POST(`${P}/meetings/${created.id}/comments`, { body: `Please correct item 1 before the minutes go out. ${ctx.canary('meeting_comment')}`, activityId });
    const remarkId = remark?.id && remark.id !== created.id ? remark.id : (remark?.comments || []).slice(-1)[0]?.id;
    if (remarkId) ctx.record('meeting_comment', remarkId);

    if (target !== 'draft') {
      full = await who.PATCH(`${P}/meetings/${created.id}`, {
        status: 'finalized',
        minutesText: `Minutes agreed. Actions as listed. ${ctx.canary('meeting_minutes')}`,
        startedAt: `${ctx.daysAgo(3 + i * 7)}T08:05:00.000Z`,
        endedAt: `${ctx.daysAgo(3 + i * 7)}T09:10:00.000Z`,
        nextMeetingAt: `${ctx.daysAhead(4)}T08:00:00.000Z`,
      });
    }
    if (target === 'distributed' || target === 'archived') {
      // To the attendees only: no outside address is ever named.
      const distributor = i % 2 === 0 ? planner : pm;
      await distributor.POST(`${P}/meetings/${created.id}/distribute`, { includeAttendees: true, message: `Minutes attached. ${ctx.canary('meeting_distribution')}` });
      full = await who.GET(`${P}/meetings/${created.id}`);
      for (const row of full.distributions || []) if (row.id) ctx.record('meeting_distribution', row.id);
    }
    if (target === 'archived') await pm.DELETE(`${P}/meetings/${created.id}`);
    meetings.push({ id: created.id, state: target, activityId });
    (made.meetings[target] = made.meetings[target] || []).push(created.id);
  }

  // A file on the first meeting (the signed attendance sheet).
  await ctx.attempt('meeting attachment', async () => {
    const name = `${ctx.canary('meeting_file')}-attendance.png`;
    const uploaded = await sessionOf(plannerPerson).upload('POST', `${P}/attachments`, {
      field: 'files',
      filename: name,
      contentType: 'image/png',
      body: PNG_1X1,
      fields: { recordType: 'meeting', recordId: meetings[0].id, caption: `Signed attendance sheet ${ctx.canary('meeting_file_caption')}` },
    });
    for (const row of listOf(uploaded)) {
      if (row.id) ctx.record('attachment', row.id);
      if (row.documentId) ctx.record('project_document', row.documentId);
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // Tasks
  // ════════════════════════════════════════════════════════════════════════
  const taskMakers = [ctx.person('pm'), plannerPerson, site, quality];
  const canClose = (person) => ['pm', 'planning_eng', 'site_engineer', 'quality_engineer'].includes(person.role);
  const tasks = [];
  const nTasks = ctx.count(6, 9);
  for (let i = 0; i < nTasks; i += 1) {
    const target = TASK_STATES[i % TASK_STATES.length];
    const maker = taskMakers[i % taskMakers.length];
    const who = sessionOf(maker);
    const assignee = otherThan(maker, i);
    const [, activityId] = act(i * 2 + 1);
    // Both mounts lead to the same service: the company-level one names the project in the body.
    const mount = i % 2 === 0 ? '/tasks' : `${P}/tasks`;
    const created = await who.POST(mount, {
      title: `${TASK_SUBJECTS[i % TASK_SUBJECTS.length]} ${tag}-${i + 1} — ${ctx.canary('task')}`,
      description: `What is needed and by when. ${ctx.canary('task_description')}`,
      label: TASK_LABELS[i % TASK_LABELS.length],
      priority: TASK_PRIORITIES[i % TASK_PRIORITIES.length],
      status: 'todo',
      // Every third task is already overdue.
      dueDate: i % 3 === 2 ? ctx.daysAgo(2 + i) : ctx.daysAhead(3 + i * 2),
      projectId,
      activityId,
      assigneeId: assignee.id,
    });
    ctx.record('task', created.id);

    if (i % 2 === 0) {
      const note = await sessionOf(assignee).POST(`${mount}/${created.id}/comments`, { body: `Started; will report back tomorrow. ${ctx.canary('task_comment')}` });
      const noteId = note?.id && note.id !== created.id ? note.id : (note?.comments || []).slice(-1)[0]?.id;
      if (noteId) ctx.record('task_comment', noteId);
    }

    if (target === 'in_progress' || target === 'blocked' || target === 'canceled') {
      await who.PATCH(`${mount}/${created.id}`, { status: target, comment: `Moved to ${target}. ${ctx.canary('task_status_comment')}` });
    } else if (target === 'done') {
      const closer = canClose(assignee) ? assignee : maker;
      await sessionOf(closer).POST(`${mount}/${created.id}/close`, { comment: `Done and checked. ${ctx.canary('task_close_comment')}` });
    } else if (target === 'archived') {
      await pm.DELETE(`${mount}/${created.id}`);
    }
    tasks.push({ id: created.id, state: target, makerId: maker.id, assigneeId: assignee.id });
    (made.tasks[target] = made.tasks[target] || []).push(created.id);
  }

  // A small PDF on the first task, then named on the task itself.
  await ctx.attempt('task attachment', async () => {
    const first = tasks[0];
    const name = `${ctx.canary('task_file')}-briefing.pdf`;
    const uploaded = await pm.upload('POST', `${P}/attachments`, {
      field: 'files',
      filename: name,
      contentType: 'application/pdf',
      body: pdfOf(`Briefing note ${ctx.canary('task_file_content')}`),
      fields: { recordType: 'task', recordId: first.id, caption: `Briefing note ${ctx.canary('task_file_caption')}` },
    });
    const rows = listOf(uploaded);
    for (const row of rows) {
      if (row.id) ctx.record('attachment', row.id);
      if (row.documentId) ctx.record('project_document', row.documentId);
    }
    const documentId = rows[0]?.documentId;
    if (documentId) {
      const linked = await ctx.attempt('task attachment link', () => pm.POST(`/tasks/${first.id}/attachments`, { attachments: [{ projectDocumentId: documentId, fileName: name }] }));
      for (const row of listOf(linked?.attachments || linked)) if (row?.id && row.id !== first.id) ctx.record('task_attachment', row.id);
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // Risks
  // ════════════════════════════════════════════════════════════════════════
  const riskMakers = [plannerPerson, qs, ctx.person('pm')];
  const risks = [];
  const nRisks = ctx.count(7, 8);
  for (let i = 0; i < nRisks; i += 1) {
    const target = RISK_STATES[i % RISK_STATES.length];
    const maker = riskMakers[i % riskMakers.length];
    const who = sessionOf(maker);
    const [code, activityId] = act(i * 4 + 2);
    const second = act(i * 4 + 3);
    const probability = LEVELS[i % 3];
    const impact = LEVELS[(i + 1) % 3];
    const created = await who.POST(`${P}/risks`, {
      description: `${RISK_SUBJECTS[i % RISK_SUBJECTS.length]} (${code}) ${tag}-${i + 1} — ${ctx.canary('risk')}`,
      probability,
      impact,
      mitigation: `Order early and hold a buffer on site. ${ctx.canary('risk_mitigation')}`,
      responsePlan: `Weekly review with the supplier; alternative source identified. ${ctx.canary('risk_response_plan')}`,
      phase: ['Substructure', 'Superstructure', 'Finishes'][i % 3],
      owner: maker.name,
      dueDate: ctx.daysAhead(10 + i * 3),
      status: target === 'monitoring' ? 'monitoring' : 'open',
      activityId,
      activityLinks: [
        { activityId, relationType: 'affects', scheduleImpactDays: 2 + i, costImpact: 1500 * (i + 1), notes: `Main exposure. ${ctx.canary('risk_activity_link')}` },
        ...(second[1] !== activityId ? [{ activityId: second[1], relationType: 'affects', scheduleImpactDays: 1, costImpact: 500, notes: `Knock-on. ${ctx.canary('risk_activity_link')}` }] : []),
      ],
    });
    ctx.record('risk', created.id);
    for (const link of created.activityLinks || []) if (link.id) ctx.record('risk_activity_link', link.id);

    if (target === 'monitoring') {
      await who.PATCH(`${P}/risks/${created.id}`, {
        escalationLevel: 'watch',
        escalationNotes: `Watching the supplier's programme. ${ctx.canary('risk_escalation')}`,
        residualProbability: 'low',
        residualImpact: 'medium',
        residualDescription: `After mitigation. ${ctx.canary('risk_residual')}`,
      });
    }
    if (['submitted', 'closed', 'rejected', 'reopened'].includes(target)) {
      await who.POST(`${P}/risks/${created.id}/submit`, {
        closeoutComment: `The exposure has passed; propose to close. ${ctx.canary('risk_closeout')}`,
        responsePlan: `Buffer stock delivered. ${ctx.canary('risk_response_plan')}`,
        dueDate: ctx.daysAhead(5),
      });
    }
    if (target === 'closed' || target === 'reopened') await pm.POST(`${P}/risks/${created.id}/approve`, { comment: `Agreed, closed. ${ctx.canary('risk_approval')}` });
    if (target === 'rejected') await pm.POST(`${P}/risks/${created.id}/reject`, { reason: `Not yet: the second delivery is still outstanding. ${ctx.canary('risk_rejection')}` });
    if (target === 'reopened') await pm.POST(`${P}/risks/${created.id}/reopen`, { reason: `The supplier slipped again. ${ctx.canary('risk_reopen')}` });
    if (target === 'archived') await pm.DELETE(`${P}/risks/${created.id}`);
    risks.push({ id: created.id, state: target });
    (made.risks[target] = made.risks[target] || []).push(created.id);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Comments, mentions, follows
  // ════════════════════════════════════════════════════════════════════════
  const liveTask = tasks.find((task) => task.state !== 'archived');
  const liveRisk = risks.find((risk) => risk.state !== 'archived');
  const liveMeeting = meetings.find((meeting) => meeting.state !== 'archived');
  const targets = [
    ...Array.from({ length: ctx.count(2, 4) }, (_, k) => ({ recordType: 'activity', recordId: act(k * 5)[1] })),
    { recordType: 'task', recordId: liveTask.id },
    { recordType: 'risk', recordId: liveRisk.id },
    { recordType: 'meeting', recordId: liveMeeting.id },
  ];
  // Records other drivers left, when they did.
  const optional = [];
  for (const [recordType, key] of [['rfi', 'rfi'], ['ncr', 'ncr_record'], ['ncr', 'ncr'], ['submittal', 'submittal'], ['punch_item', 'punch_item']]) {
    const id = (ctx.records[key] || [])[0];
    if (id && !optional.some((row) => row.recordType === recordType)) optional.push({ recordType, recordId: id, optional: true });
  }
  const threads = [];
  for (const [index, target] of [...targets, ...optional].entries()) {
    // On another driver's record the PM writes and the site engineer is mentioned: both can read every module.
    const author = target.optional ? ctx.person('pm') : member(index);
    const mentioned = target.optional ? site : otherThan(author, index);
    const post = () =>
      sessionOf(author).POST(`${P}/comments`, {
        recordType: target.recordType,
        recordId: target.recordId,
        body: `Please look at this before Thursday. ${ctx.canary('comment')}`,
        mentionUserIds: mentioned.id === author.id ? [] : [mentioned.id],
      });
    const top = target.optional ? await ctx.attempt(`comment on ${target.recordType}`, post) : await post();
    if (!top?.id) continue;
    ctx.record('comment', top.id);
    for (const mention of top.mentions || []) if (mention.id) ctx.record('comment_mention', mention.id);
    // The person mentioned answers in the thread.
    const reply = await ctx.attempt(`reply on ${target.recordType}`, () =>
      sessionOf(mentioned).POST(`${P}/comments`, {
        recordType: target.recordType,
        recordId: target.recordId,
        parentId: top.id,
        body: `Seen, thank you — I will deal with it. ${ctx.canary('comment_reply')}`,
      })
    );
    if (reply?.id) ctx.record('comment', reply.id);
    threads.push({ ...target, top, reply, author, mentioned });
    made.comments.push(top.id);
  }
  // One comment edited by its author, one reply removed by its author.
  if (threads[0]) await sessionOf(threads[0].author).PATCH(`${P}/comments/${threads[0].top.id}`, { body: `Edited: please look at this before Wednesday. ${ctx.canary('comment_edit')}` });
  const removable = threads.find((thread, index) => index > 0 && thread.reply?.id);
  if (removable) {
    await sessionOf(removable.mentioned).DELETE(`${P}/comments/${removable.reply.id}`);
    made.deletedComment = removable.reply.id;
  }

  // Follows: two people follow each record; one of them then stops following the first.
  // (Authors, people mentioned and assignees follow on their own; those rows are not recorded here.)
  const subscriptionIds = new Set(ctx.records.record_subscription || []);
  const follow = async (person, target, on) => {
    const put = () => sessionOf(person).PUT(`${P}/subscriptions`, { recordType: target.recordType, recordId: target.recordId, follow: on });
    const result = target.optional ? await ctx.attempt(`follow ${target.recordType}`, put) : await put();
    const id = result?.subscription?.id;
    if (id && !subscriptionIds.has(id)) {
      subscriptionIds.add(id);
      ctx.record('record_subscription', id);
    }
    return result;
  };
  for (const [index, target] of targets.entries()) {
    await follow(member(index + 2), target, true);
    await follow(member(index + 3), target, true);
  }
  for (const target of optional) await follow(site, target, true);
  await follow(member(2), targets[0], false);
  made.unfollowed = { ...targets[0], userId: member(2).id };
  await sessionOf(member(2)).GET(`${P}/subscriptions?recordType=${targets[0].recordType}&recordId=${targets[0].recordId}`);
  await sessionOf(member(3)).GET(`${P}/subscriptions/mine?limit=100`);

  // ════════════════════════════════════════════════════════════════════════
  // Conversations and messages
  // ════════════════════════════════════════════════════════════════════════
  if (colleagues.length) {
    const talk = async (conversationId, count, people) => {
      const sent = [];
      for (let k = 0; k < count; k += 1) {
        const speaker = people[k % people.length];
        const other = people[(k + 1) % people.length];
        const message = await sessionOf(speaker).POST(`/conversations/${conversationId}/messages`, {
          body: `Update ${k + 1}: all in hand. ${ctx.canary('conversation_message')}`,
          mentionUserIds: k % 2 === 0 && other.id !== speaker.id ? [other.id] : [],
          ...(k === 1 ? { linkedRecord: { recordType: 'task', recordId: liveTask.id, projectId, title: `Task ${ctx.canary('conversation_link')}` } } : {}),
        });
        if (message?.id) {
          ctx.record('conversation_message', message.id);
          sent.push({ id: message.id, speaker });
        }
      }
      return sent;
    };

    const nGroups = ctx.count(2, 3);
    for (let g = 0; g < nGroups; g += 1) {
      const invited = rng.shuffle(colleagues).slice(0, rng.int(1, 5));
      const group = await pm.POST('/conversations', {
        kind: 'group',
        projectId,
        title: `${['Site team', 'Commercial team', 'Handover team'][g % 3]} ${tag} — ${ctx.canary('conversation')}`,
        memberUserIds: invited.map((person) => person.id),
        message: `Opening the thread. ${ctx.canary('conversation_message')}`,
      });
      ctx.record('conversation', group.id);
      const people = [ctx.person('pm'), ...invited];
      const sent = await talk(group.id, ctx.count(3, 6), people);
      // An edit and a removal, each by the author.
      if (sent[0]) await sessionOf(sent[0].speaker).PATCH(`/conversations/${group.id}/messages/${sent[0].id}`, { body: `Edited update. ${ctx.canary('conversation_message_edit')}` });
      if (sent.length > 2) await sessionOf(sent[2].speaker).DELETE(`/conversations/${group.id}/messages/${sent[2].id}`);
      await sessionOf(invited[0]).POST(`/conversations/${group.id}/read`);
      await sessionOf(invited[0]).PATCH(`/conversations/${group.id}/me`, { starred: true, muted: g % 2 === 1 });
      if (g === 0 && colleagues.length > invited.length) {
        const late = colleagues.find((person) => !invited.some((row) => row.id === person.id));
        await pm.POST(`/conversations/${group.id}/members`, { userIds: [late.id] });
      }
      // The last group is archived.
      if (g === nGroups - 1) await pm.PATCH(`/conversations/${group.id}`, { archived: true });
      (made.conversations[g === nGroups - 1 ? 'archived' : 'group'] = made.conversations[g === nGroups - 1 ? 'archived' : 'group'] || []).push(group.id);
    }

    // A direct conversation on the project (found again on a later run: one per pair and project).
    const a = colleagues[0];
    const b = otherThan(a, 1);
    const direct = await sessionOf(a).POST('/conversations', { kind: 'direct', projectId, memberUserIds: [b.id], message: `Can you call me about the pour? ${ctx.canary('conversation_message')}` });
    if (!(ctx.records.conversation || []).includes(direct.id)) ctx.record('conversation', direct.id);
    await talk(direct.id, 2, [b, a]);
    made.conversations.direct = direct.id;

    // A conversation about one record (found again on a later run: one per record).
    const about = await planner.POST('/conversations', {
      kind: 'record',
      projectId,
      recordType: 'activity',
      recordId: act(1)[1],
      memberUserIds: colleagues.slice(0, 3).map((person) => person.id),
      message: `Thread on this activity. ${ctx.canary('conversation_message')}`,
    });
    if (!(ctx.records.conversation || []).includes(about.id)) ctx.record('conversation', about.id);
    made.conversations.record = about.id;
  } else {
    ctx.note('conversations: the company has nobody but the owner on this project; none created');
  }

  // ════════════════════════════════════════════════════════════════════════
  // Reports: saved definitions, a run, a disabled schedule
  // ════════════════════════════════════════════════════════════════════════
  const sources = new Map(((await pm.GET('/reports/sources')).sources || []).map((source) => [source.key, new Set((source.columns || []).map((column) => column.key))]));
  const columnsOf = (source, wanted) => wanted.filter((key) => sources.get(source)?.has(key));
  const REPORTS = [
    { by: plannerPerson, source: 'task', visibility: 'project', label: 'Open tasks by due date', columns: ['taskNumber', 'title', 'status', 'priority', 'assignee.name', 'dueDate', 'overdue'], filters: [{ field: 'status', op: 'nin', value: ['canceled'] }], sort: { field: 'dueDate', dir: 'asc' } },
    { by: qs, source: 'risk', visibility: 'private', label: 'Risk register by severity', columns: ['ref', 'description', 'probability', 'impact', 'severity', 'status', 'owner', 'dueDate'], filters: [{ field: 'status', op: 'in', value: ['open', 'monitoring', 'submitted'] }], groupBy: 'status', aggregates: [{ fn: 'count' }] },
    { by: ctx.person('pm'), source: 'activity', visibility: 'org', label: 'Critical activities', columns: ['activityCode', 'name', 'wbsCode', 'startDate', 'endDate', 'totalFloat', 'isCritical', 'pctComplete', 'status'], filters: [], sort: { field: 'activityCode', dir: 'asc' } },
  ];
  const nReports = REPORTS.length;
  for (let i = 0; i < nReports; i += 1) {
    const spec = REPORTS[i];
    const who = sessionOf(spec.by);
    const payload = {
      name: `${spec.label} ${tag} — ${ctx.canary('report_definition')}`,
      description: `Saved for the weekly review. ${ctx.canary('report_description')}`,
      source: spec.source,
      projectId,
      columns: columnsOf(spec.source, spec.columns),
      filters: spec.filters,
      ...(spec.sort ? { sort: spec.sort } : {}),
      ...(spec.groupBy ? { groupBy: spec.groupBy, aggregates: spec.aggregates } : {}),
      visibility: spec.visibility,
    };
    await who.POST('/reports/preview', { source: payload.source, projectId, columns: payload.columns, filters: payload.filters, limit: 20 });
    const report = await who.POST('/reports', payload);
    ctx.record('report_definition', report.id);
    made.reports.push({ id: report.id, source: spec.source, visibility: spec.visibility, ownerId: spec.by.id });
    const result = await who.POST(`/reports/${report.id}/run`, { limit: 50 });
    if (i === 0) {
      const rows = listOf(result);
      if (!rows.length && !result?.total && !result?.rowCount) ctx.note(`report ${spec.source}: the run returned no rows`);
      await who.PUT(`/reports/${report.id}`, { description: `Reviewed every Monday. ${ctx.canary('report_description')}` });
      // A stored run of the report (rendered at once; nothing is delivered).
      const stored = await ctx.attempt('report run', () => who.POST(`/reports/${report.id}/runs`, { format: 'xlsx', deliver: false }));
      if (stored?.id) ctx.record('report_run', stored.id);
    }
  }
  // One schedule, created disabled: it never runs.
  {
    const first = made.reports[0];
    const owner = members.find((person) => person.id === first.ownerId) || ctx.person('pm');
    // Scheduling is for pm, planner, qs, cost, procurement and finance; the PM stands in otherwise.
    const scheduler = ['pm', 'planning_eng', 'qs', 'cost_controller', 'procurement', 'finance'].includes(owner.role) ? sessionOf(owner) : pm;
    const schedule = await scheduler.POST(`/reports/${first.id}/schedules`, {
      frequency: 'weekly',
      dayOfWeek: 1,
      hour: 7,
      minute: 0,
      timezone: 'UTC',
      format: 'xlsx',
      recipients: { userIds: [pmId], roles: [], emails: [] },
      enabled: false,
    });
    ctx.record('report_schedule', schedule.id);
    if (schedule.enabled !== false || schedule.nextRunAt) {
      await scheduler.PATCH(`/reports/${first.id}/schedules/${schedule.id}`, { enabled: false });
      ctx.note(`report schedule ${schedule.id}: created with enabled:false but answered enabled=${schedule.enabled} nextRunAt=${schedule.nextRunAt}; disabled by PATCH`);
    }
    made.reportScheduleId = schedule.id;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Custom fields on this project, and values on its records
  // ════════════════════════════════════════════════════════════════════════
  const FIELDS = [
    { recordType: 'task', type: 'text', label: 'Site reference', key: `${keyBase}_site_ref` },
    { recordType: 'risk', type: 'select', label: 'Risk category', key: `${keyBase}_category`, options: ['Commercial', 'Programme', 'Safety', 'Design'] },
    { recordType: 'meeting', type: 'number', label: 'People present', key: `${keyBase}_present`, validation: { min: 0, max: 500 } },
    { recordType: 'activity', type: 'date', label: 'Permit expiry', key: `${keyBase}_permit` },
    { recordType: 'task', type: 'boolean', label: 'Client witnessed', key: `${keyBase}_witness` },
  ];
  const fields = [];
  const nFields = FIELDS.length;
  for (let i = 0; i < nFields; i += 1) {
    const spec = FIELDS[i];
    const definition = await pm.POST(`${P}/custom-fields/definitions`, {
      recordType: spec.recordType,
      type: spec.type,
      key: spec.key,
      label: `${spec.label} ${tag} ${ctx.canary('custom_field_definition')}`,
      description: `Project field. ${ctx.canary('custom_field_description')}`,
      ...(spec.options ? { options: spec.options } : {}),
      ...(spec.validation ? { validation: spec.validation } : {}),
      required: false,
      position: 10 + i,
    });
    ctx.record('custom_field_definition', definition.id);
    fields.push({ ...spec, id: definition.id, key: definition.key || spec.key });
  }
  // The company's task fieldset is the one this project uses (it holds the optional company field only).
  if (co.fieldsetId) {
    await ctx.attempt('project fieldset', async () => {
      const assigned = await pm.PUT(`${P}/custom-fields/assignments`, { recordType: 'task', fieldsetId: co.fieldsetId });
      made.customFields.projectFieldset = { recordType: 'task', fieldsetId: co.fieldsetId };
      for (const row of listOf(assigned)) if (row.id) ctx.record('project_fieldset', row.id);
    });
  }
  const valueOf = (field) =>
    field.type === 'text' ? `Ref ${ctx.canary('custom_field_value')}` : field.type === 'select' ? field.options[rng.int(0, field.options.length - 1)] : field.type === 'number' ? rng.int(4, 18) : field.type === 'date' ? ctx.daysAhead(30) : true;
  const holders = { task: liveTask.id, risk: liveRisk.id, meeting: liveMeeting.id, activity: act(0)[1] };
  for (const recordType of Object.keys(holders)) {
    const mine = fields.filter((field) => field.recordType === recordType);
    if (!mine.length) continue;
    const values = Object.fromEntries(mine.map((field) => [field.key, valueOf(field)]));
    // The company-wide task field takes a value too.
    if (recordType === 'task' && co.customFieldKey) values[co.customFieldKey] = `Company ref ${ctx.canary('custom_field_value')}`;
    const saved = await pm.PUT(`${P}/custom-fields/values/${recordType}/${holders[recordType]}`, { values, partial: true });
    for (const row of saved?.rows || saved?.valueRows || []) if (row.id) ctx.record('custom_field_value', row.id);
    (made.customFields[recordType] = made.customFields[recordType] || []).push({ recordId: holders[recordType], keys: Object.keys(values) });
  }
  // The last field is archived again: a definition nobody uses any more.
  if (fields.length >= 5) {
    await pm.DELETE(`${P}/custom-fields/definitions/${fields[4].id}`);
    made.customFields.archivedDefinition = fields[4].id;
  }

  // ════════════════════════════════════════════════════════════════════════
  // A custom permission template and one person's override on this project
  // ════════════════════════════════════════════════════════════════════════
  await ctx.attempt('permission template and override', async () => {
    const personaIds = new Set(company.people.filter((person) => person.persona).map((person) => person.id));
    // Prefer a member of staff nobody signs in as, so no persona's own rights move.
    const staff = team.find((row) => !row.isCompanyAdmin && row.orgRole !== 'pm' && row.source === 'assignment' && !personaIds.has(row.userId));
    const fallback = ['warehouse', 'procurement', 'finance', 'cost', 'quality', 'qs', 'site']
      .filter((key) => ctx.hasPersona(key))
      .map((key) => ctx.person(key))
      .find((person) => !person.isAdmin && person.role !== 'pm' && onTeam.has(person.id));
    const target = staff ? { userId: staff.userId, role: staff.orgRole, email: staff.email, persona: null } : fallback ? { userId: fallback.id, role: fallback.role, email: fallback.email, persona: fallback.persona } : null;
    if (!target) {
      ctx.note('permission override: nobody on this project but administrators and project managers; skipped');
      return;
    }
    // For a member of staff the template really adds something. For a persona
    // it only restates what every role already may do, so later drivers and
    // role tests see that persona unchanged.
    const grants = target.persona ? [{ module: 'task', transition: 'task.comment' }] : [{ module: 'meeting', transition: 'meeting.distribute' }];
    const overrideGrants = target.persona ? ['meeting|transition:meeting.comment'] : ['task|transition:task.close'];
    const template = await pm.POST('/permissions/templates', {
      name: `Field coordinator ${ctx.project.key} ${tag} ${ctx.canary('permission_template')}`.slice(0, 120),
      description: `Custom template for one project. ${ctx.canary('permission_template_description')}`,
      kind: 'internal',
      baseRole: target.role,
      tools: [
        { module: 'meeting', level: 'standard' },
        { module: 'task', level: 'standard' },
      ],
      grants,
    });
    ctx.record('permission_template', template.id, { scope: 'company' });
    // A copy that is archived again: a retired template.
    const copy = await pm.POST(`/permissions/templates/${template.id}/duplicate`, { name: `Field coordinator copy ${ctx.project.key} ${tag} ${ctx.canary('permission_template')}`.slice(0, 120) });
    ctx.record('permission_template', copy.id, { scope: 'company' });
    await pm.DELETE(`/permissions/templates/${copy.id}`);
    const assigned = await pm.PUT(`${P}/team/${target.userId}/permissions`, { templateId: template.id, overrides: { tools: { conversation: 'standard' }, grants: overrideGrants } });
    if (assigned?.id) ctx.record('project_user_permission', assigned.id);
    made.permission = { templateId: template.id, archivedTemplateId: copy.id, userId: target.userId, email: target.email, persona: target.persona, additive: !target.persona, grants, overrideGrants };
  });

  // ════════════════════════════════════════════════════════════════════════
  // Workflow templates and instances (on correspondence made here)
  // ════════════════════════════════════════════════════════════════════════
  await ctx.attempt('workflow templates and instances', async () => {
    // Neither template is a default and neither has rules: they start only when named.
    const template = await pm.POST(`${P}/workflows/templates`, {
      tool: 'correspondence',
      name: `Correspondence review ${tag} — ${ctx.canary('workflow_template')}`,
      description: `Site review, then the PM closes. ${ctx.canary('workflow_template_description')}`,
      isDefault: false,
      priority: 0,
      rules: [],
      steps: [
        {
          key: 'site_review',
          name: 'Site review',
          type: 'response',
          assignees: [{ type: 'user', userId: site.id }],
          days: 3,
          responses: [
            { key: 'forward', label: 'Forward to the PM', next: 'pm_closeout', tone: 'positive' },
            { key: 'return', label: 'Return', next: 'end_fail', tone: 'negative', requireComment: true },
          ],
        },
        {
          key: 'pm_closeout',
          name: 'PM close-out',
          type: 'response',
          assignees: [{ type: 'user', userId: pmId }],
          days: 5,
          responses: [
            { key: 'close', label: 'Close', next: 'end_success', tone: 'positive' },
            { key: 'keep_open', label: 'Keep open', next: 'end_fail', tone: 'negative', requireComment: true },
          ],
        },
      ],
    });
    ctx.record('workflow_template', template.id);
    const retired = await pm.POST(`${P}/workflows/templates`, {
      tool: 'submittal',
      name: `Submittal second review ${tag} — ${ctx.canary('workflow_template')}`,
      description: `Retired route. ${ctx.canary('workflow_template_description')}`,
      isDefault: false,
      steps: [{ key: 'review', name: 'Second review', type: 'response', assignees: [{ type: 'role', role: 'pm' }], days: 10, responses: [{ key: 'approve', label: 'Approve', next: 'end_success' }, { key: 'reject', label: 'Reject', next: 'end_fail', requireComment: true }] }],
    });
    ctx.record('workflow_template', retired.id);
    await pm.DELETE(`${P}/workflows/templates/${retired.id}`);
    made.workflow = { templateId: template.id, archivedTemplateId: retired.id, instances: {} };

    const OUTCOMES = ['running', 'cancelled', 'succeeded', 'failed'];
    const nInstances = OUTCOMES.length;
    for (let i = 0; i < nInstances; i += 1) {
      const outcome = OUTCOMES[i];
      const [, activityId] = act(i * 6 + 4);
      const letter = await sessionOf(plannerPerson).POST(`${P}/correspondence`, {
        direction: i % 2 === 0 ? 'outgoing' : 'incoming',
        type: ['letter', 'notice', 'memo', 'email'][i % 4],
        // The first letter is of the company's own record type.
        ...(i === 0 && co.recordTypeKey ? { recordTypeKey: co.recordTypeKey } : {}),
        subject: `Access to the east boundary ${tag}-${i + 1} — ${ctx.canary('correspondence')}`,
        owner: plannerPerson.name,
        activityId,
        date: ctx.daysAgo(4 + i),
        dueDate: ctx.daysAhead(6 + i),
        status: 'open',
        comment: `Logged for the workflow. ${ctx.canary('correspondence_comment')}`,
      });
      ctx.record('correspondence', letter.id);
      let instance = await pm.POST(`${P}/workflows/instances`, { tool: 'correspondence', recordId: letter.id, templateId: template.id });
      ctx.record('workflow_instance', instance.id);
      const siteSession = sessionOf(site);
      if (outcome === 'cancelled') {
        instance = await pm.POST(`${P}/workflows/instances/${instance.id}/cancel`, { reason: `Superseded by a later letter. ${ctx.canary('workflow_cancel')}` });
      } else if (outcome === 'failed') {
        instance = await siteSession.POST(`${P}/workflows/instances/${instance.id}/respond`, { response: 'return', comment: `Wrong drawing referenced. ${ctx.canary('workflow_response')}` });
      } else {
        instance = await siteSession.POST(`${P}/workflows/instances/${instance.id}/respond`, { response: 'forward', comment: `Checked on site. ${ctx.canary('workflow_response')}` });
        if (outcome === 'succeeded') instance = await pm.POST(`${P}/workflows/instances/${instance.id}/respond`, { response: 'close', comment: `Closed. ${ctx.canary('workflow_response')}` });
      }
      for (const step of instance?.steps || []) for (const assignment of step.assignments || []) if (assignment.id) ctx.record('workflow_step_assignment', assignment.id);
      if (instance?.status && instance.status !== outcome) ctx.note(`workflow instance ${instance.id}: expected ${outcome}, is ${instance.status}`);
      if (instance?.applyStatus === 'failed') ctx.note(`workflow instance ${instance.id}: outcome not applied — ${instance.applyError}`);
      made.workflow.instances[outcome] = { instanceId: instance.id, correspondenceId: letter.id };
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // Notifications: what two people now see; some read, one archived
  // ════════════════════════════════════════════════════════════════════════
  await ctx.attempt('notification due scan', () => pm.POST('/notifications/scan-due', { projectId, horizonDays: 7 }));
  const readers = [colleagues[0] || ctx.person('pm'), ctx.person('pm')].filter((person, index, list) => list.findIndex((row) => row.id === person.id) === index);
  const known = new Set(ctx.records.notification || []);
  const counts = [];
  for (const [index, person] of readers.entries()) {
    const who = sessionOf(person);
    const rows = listOf(await who.GET(`/notifications?status=all&limit=100&projectId=${projectId}`));
    const summary = await who.GET('/notifications/summary');
    counts.push(`${person.persona}: ${rows.length} on this project (${rows.filter((row) => !row.readAt && row.status !== 'read').length} unread), ${summary?.unread ?? '?'} unread in all`);
    for (const row of rows.slice(0, 10)) {
      if (row.id && !known.has(row.id)) {
        known.add(row.id);
        ctx.record('notification', row.id);
      }
    }
    // The first reader reads two and archives a third; the second reads one.
    const toRead = rows.slice(0, index === 0 ? 2 : 1);
    for (const row of toRead) await who.PATCH(`/notifications/${row.id}/read`, { read: true });
    if (index === 0 && rows[2]) await who.PATCH(`/notifications/${rows[2].id}/archive`);
    if (index === 0 && rows[0]) await who.GET(`/notifications/${rows[0].id}`);
  }
  ctx.note(`notifications ${tag} — ${counts.join('; ')}`);

  // ── what later drivers and the attacks can pick up by name ───────────────
  Object.assign(state, {
    meetings: made.meetings,
    tasks: made.tasks,
    risks: made.risks,
    comments: made.comments,
    deletedComment: made.deletedComment || state.deletedComment || null,
    unfollowed: made.unfollowed || null,
    conversations: made.conversations,
    reports: made.reports,
    reportScheduleId: made.reportScheduleId,
    customFields: made.customFields,
    permission: made.permission || state.permission || null,
    workflow: made.workflow?.templateId ? made.workflow : state.workflow || null,
  });
};

module.exports = { name: 'collaboration-admin', needs: ['foundation'], depths: ['standard'], run };
