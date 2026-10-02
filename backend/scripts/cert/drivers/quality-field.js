'use strict';

/**
 * Quality and field records of a project, made by the people who would make
 * them: the quality engineer, the site engineer, the planner and the PM.
 *
 *   checklist templates   company-wide (once per company) and per project:
 *                         ITP with hold / witness points, inspection, form
 *                         (a permit to work — the product has no permit
 *                         module), toolbox talk; active, draft, archived,
 *                         duplicated; their sections and items
 *   checklist instances   scheduled, in progress, complete (pass and fail),
 *                         closed, void, reopened; answers, signatures (each
 *                         with its attachment and gallery photo), photos on an
 *                         answer, a deficiency raised from a failed item, a
 *                         recurring talk that schedules its successor
 *   legacy ITP register   pending, passed, failed, waived
 *   NCRs                  major and minor; open, submitted, closed (approved),
 *                         rejected (back to open), reopened; photos and a
 *                         report attached, closeout evidence uploaded through
 *                         the workflow store as the closeout dialog does
 *   punch items           draft, open, ready for review, closed, in dispute,
 *                         void, reopened; bulk; distributed
 *   observations          one per observation type the product offers
 *   defects               open, in progress, closed
 *   material tests        pending, pass, fail (cube tests are a test type)
 *   safety incidents      open, investigating, submitted, closed, rejected,
 *                         reopened, archived
 *   weather delays        contractual and not, linked to activities
 *   site photos           images attached to a location / activity (the
 *                         gallery), a caption and tags edited afterwards, and
 *                         the site-reporting photo store
 *
 * Every text carries a canary; a second run of the driver numbers its
 * canaries apart from the first (…-R2-…), so a record's canary stays its own.
 *
 * Open ITP hold points block progress approval on their activity (409
 * ITP_HOLD_POINT_OPEN). This driver leaves them on the project's LAST activity
 * only: the failed hold point and the still-scheduled ITP both go there, and a
 * re-run voids a still-pending ITP an earlier run left on another activity.
 * The activities are named in ctx.refs.qualityField.holdPointActivities
 * (holdPointActivity keeps the first, for older readers).
 *
 * Failure policy. The records of the area are created by plain calls: a
 * refusal fails the run. A 5xx is never silent: it is written to the notes as
 * a FINDING and fails the step. Read-only checks (exports, hold points, the
 * gallery, health) are made with `check`: a refusal there is a FINDING note
 * and the run goes on.
 */

const zlib = require('zlib');
const { ApiError } = require('../lib/api');

/**
 * Prisma errors the API hands back as a 500 when the database is busy (an
 * interactive transaction that outlived its 5 s, a write conflict, a pool
 * timeout). Only reads and idempotent writes (GET, PUT, a download) are tried
 * again. A POST, PATCH, DELETE or upload is not: the product stores files and
 * sends notifications outside its transaction, so the record may already be
 * there, and a second attempt would make a copy that is never recorded.
 */
const BUSY_CODES = new Set(['P2028', 'P2034', 'P2024']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const describe = (error) => String(error?.message || error).replace(/\s+/g, ' ').slice(0, 260);
const steady = (session, ctx) => {
  const wrap = (fn, idempotent) => async (...args) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await fn(...args);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status < 500) throw error;
        const busy = BUSY_CODES.has(error.code);
        const again = idempotent && busy && attempt < 3;
        ctx.note(`FINDING 5xx${busy ? ' from a busy database' : ''}${again ? ' (read tried again)' : ''}: ${describe(error)}`);
        error.noted = true;
        if (!again) throw error;
        await sleep(1500 * attempt);
      }
    }
  };
  return {
    ...session,
    GET: wrap(session.GET, true),
    PUT: wrap(session.PUT, true),
    download: wrap(session.download, true),
    POST: wrap(session.POST, false),
    PATCH: wrap(session.PATCH, false),
    DELETE: wrap(session.DELETE, false),
    upload: wrap(session.upload, false),
  };
};

const rowsOf = (data) => (Array.isArray(data) ? data : data?.rows || data?.items || data?.records || data?.files || data?.locations || []);

// ── small real files ───────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
/** A valid 1x1 PNG whose text chunk carries `text`, so no two uploads are the same bytes. */
const png = (text) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  const seed = crc32(Buffer.from(text, 'latin1'));
  const pixel = Buffer.from([0, seed & 0xff, (seed >>> 8) & 0xff, (seed >>> 16) & 0xff]);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('tEXt', Buffer.from(`Comment\0${text}`, 'latin1')),
    pngChunk('IDAT', zlib.deflateSync(pixel)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};
/** A minimal one-page PDF with `text` on the page. */
const pdf = (text) => {
  const stream = `BT /F1 11 Tf 40 780 Td (${String(text).replace(/[()\\]/g, ' ')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
};

// ── what the checklists ask ────────────────────────────────────────────────

const itpSections = (mark) => [
  {
    title: `Before the pour — ${mark}`,
    description: 'Checks the site engineer makes and the quality engineer releases.',
    items: [
      { label: 'Reinforcement fixed to drawing, cover and laps checked', responseType: 'pass_fail', isHoldPoint: true, reference: `Spec 03 20 00 ${mark}` },
      { label: 'Formwork line, level and tightness', responseType: 'pass_fail' },
      { label: 'Consultant present for the pour', responseType: 'yes_no', inspectionPointType: 'witness' },
      { label: 'Embedded items and sleeves in place', responseType: 'checkbox' },
    ],
  },
  {
    title: `During the pour — ${mark}`,
    items: [
      { label: 'Slump at discharge', responseType: 'number', options: { min: 75, max: 125, unit: 'mm' } },
      { label: 'Concrete grade delivered', responseType: 'choice', options: ['C30', 'C35', 'C40'] },
      { label: 'Date of pour', responseType: 'date', required: false },
      { label: `Remarks — ${mark}`, responseType: 'text', required: false },
      { label: 'Photo of the pour face', responseType: 'photo', required: false },
    ],
  },
];
const inspectionSections = (mark) => [
  {
    title: `Blockwork inspection — ${mark}`,
    items: [
      { label: 'Setting out and bond', responseType: 'pass_fail' },
      { label: 'Plumb and level within tolerance', responseType: 'pass_fail' },
      { label: 'Wall ties and movement joints', responseType: 'yes_no' },
      { label: `Notes — ${mark}`, responseType: 'text', required: false },
    ],
  },
];
const permitSections = (mark) => [
  {
    title: `Permit to work — hot works — ${mark}`,
    items: [
      { label: 'Area cleared of combustibles', responseType: 'yes_no' },
      { label: 'Extinguisher at the work face', responseType: 'checkbox' },
      { label: 'Fire watch (minutes after work)', responseType: 'number', options: { min: 30, max: 120, unit: 'min' } },
      { label: 'Permit valid until', responseType: 'date' },
      { label: `Work described — ${mark}`, responseType: 'text' },
      { label: 'Permit holder signature', responseType: 'signature', required: false },
    ],
  },
];
const talkSections = (mark) => [
  {
    title: `Toolbox talk — ${mark}`,
    items: [
      { label: 'Topic delivered', responseType: 'choice', options: ['Working at height', 'Excavations', 'Lifting operations', 'Housekeeping'] },
      { label: 'Crew understood the controls', responseType: 'yes_no' },
      { label: 'Number attending', responseType: 'number', options: { min: 1, max: 200 } },
      { label: `Points raised by the crew — ${mark}`, responseType: 'text', required: false },
    ],
  },
];

const run = async (ctx) => {
  const { P, rng, company } = ctx;
  const pm = steady(ctx.who('pm'), ctx);
  const planner = steady(ctx.who('planner'), ctx);
  const qs = steady(ctx.who('qs'), ctx);
  const site = steady(ctx.who('site'), ctx);
  const quality = steady(ctx.who('quality'), ctx);
  const ids = { pm: ctx.userId('pm'), site: ctx.userId('site'), quality: ctx.userId('quality'), qs: ctx.userId('qs') };
  const subcontractor = ctx.companyRefs.directory?.subcontractor || null;
  const supplier = ctx.companyRefs.directory?.supplier || null;

  /** A read the product must answer: a refusal or a 5xx is a FINDING, and the run goes on. */
  const check = async (label, fn) => {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      ctx.note(error.noted ? `${label}: failed with the 5xx noted above; run continued` : `FINDING ${label} refused: ${describe(error)}`);
      return null;
    }
  };
  /** Records an id once (responses, attachments and photos come back from several calls). */
  const remember = (type, id) => {
    if (!id) return null;
    if (!(ctx.records[type] || []).includes(id)) ctx.record(type, id);
    return id;
  };

  // A second run numbers its canaries apart from the first.
  const state = (ctx.refs.qualityField = ctx.refs.qualityField || { runs: 0 });
  state.runs += 1;
  const tag = (type) => ctx.canary(state.runs > 1 ? `${type}-r${state.runs}` : type);
  // Offline-replay keys are unique per run even if a killed run left its canaries unrecorded.
  const nonce = `${Date.now().toString(36)}${rng.int(100, 999)}`;
  const requestKey = (mark) => `${mark}-${nonce}`.slice(0, 120);

  // Earlier versions of this driver recorded unified Attachment ids (the
  // closeout response lists them first) as workflow_attachment. Only this
  // driver records that type; ids that are also attachments are taken out of it.
  {
    const unified = new Set(ctx.records.attachment || []);
    const before = ctx.records.workflow_attachment || [];
    const kept = before.filter((id) => !unified.has(id));
    if (kept.length !== before.length) {
      ctx.records.workflow_attachment = kept;
      ctx.note(`inventory: ${before.length - kept.length} attachment id(s) an earlier run recorded as workflow_attachment were removed from that type (they stay under attachment)`);
    }
  }

  const activityCodes = Object.keys(ctx.refs.activities || {}).sort();
  if (!activityCodes.length) throw new Error('quality-field: the project has no activities');
  const activityId = (i) => ctx.refs.activities[activityCodes[i % activityCodes.length]];
  const lastActivityCode = activityCodes[activityCodes.length - 1];
  const lastActivityId = ctx.refs.activities[lastActivityCode];
  // Spread over the schedule, never the last activity (that one carries the open hold points).
  let turn = rng.int(0, activityCodes.length);
  const anyActivity = () => {
    turn += 3;
    return ctx.refs.activities[activityCodes[turn % Math.max(1, activityCodes.length - 1)]];
  };

  // ── files ────────────────────────────────────────────────────────────────
  const madePhotos = [];
  const fileOf = (kind, label) => {
    const mark = tag(`${label}-file`);
    return kind === 'pdf'
      ? { mark, filename: `${mark}.pdf`, contentType: 'application/pdf', body: pdf(`${label} evidence ${mark}`) }
      : { mark, filename: `${mark}.png`, contentType: 'image/png', body: png(mark) };
  };
  /** Attaches a file to a record; images become photos of the project. */
  const attach = async (who, recordType, recordId, { kind = 'png', caption = null, fields = {} } = {}) => {
    const file = fileOf(kind, recordType);
    const result = await who.upload('POST', `${P}/attachments`, {
      field: 'files',
      filename: file.filename,
      contentType: file.contentType,
      body: file.body,
      fields: { recordType, recordId, caption: caption || `${recordType} ${kind === 'pdf' ? 'document' : 'photo'} — ${file.mark}`, ...fields },
    });
    const item = rowsOf(result)[0];
    if (!item?.id) throw new Error(`quality-field: attaching to ${recordType} ${recordId} returned no attachment: ${JSON.stringify(result).slice(0, 200)}`);
    remember('attachment', item.id);
    remember('project_document', item.documentId);
    if (item.photo?.id) {
      remember('photo', item.photo.id);
      madePhotos.push(item.photo.id);
    } else if (kind === 'png') {
      ctx.note(`FINDING an image attached to ${recordType} ${recordId} made no gallery photo (attachment ${item.id})`);
    }
    return item;
  };
  /** Closeout evidence through the workflow store, as the product's closeout dialog sends it. */
  const workflowUpload = async (who, label, kind = 'pdf') => {
    const file = fileOf(kind, label);
    const result = await who.upload('POST', `${P}/workflow/uploads`, { field: 'files', filename: file.filename, contentType: file.contentType, body: file.body });
    const item = rowsOf(result)[0];
    if (!item?.documentId) throw new Error(`quality-field: the workflow upload returned no document: ${JSON.stringify(result).slice(0, 200)}`);
    remember('project_document', item.documentId);
    return { fileName: item.fileName, fileUrl: item.fileUrl, storageKey: item.storageKey || item.documentId, mimeType: item.mimeType, sizeBytes: item.sizeBytes, description: `Closeout evidence — ${tag('evidence-note')}` };
  };
  /**
   * The evidence list of an NCR or incident merges unified attachments (they
   * carry attachmentId) with the WorkflowAttachment rows its closeout wrote.
   * Only the latter are workflow_attachment records.
   */
  const recordWorkflowRows = (record) => {
    for (const row of record?.attachments || []) if (row?.id && !row.attachmentId) remember('workflow_attachment', row.id);
  };
  /** The activity links a workflow record carries (WorkflowActivityLink rows). */
  const recordActivityLinks = (record) => {
    for (const link of record?.activityLinks || []) if (link?.id) remember('workflow_activity_link', link.id);
  };

  // ── a place on site (other drivers may have made the project's locations) ──
  let locationId = null;
  {
    const existing = rowsOf(await site.GET(`${P}/locations`));
    const mine = existing.find((row) => row.code === 'QF-YARD');
    if (mine) locationId = mine.id;
    else {
      const created = await site.POST(`${P}/locations`, { name: `Site yard and laydown ${tag('location')}`.slice(0, 120), code: 'QF-YARD', kind: 'area', description: `Where field records of this driver are pinned — ${tag('location')}` });
      if (!created?.id) throw new Error(`quality-field: the location create returned no id: ${JSON.stringify(created).slice(0, 200)}`);
      locationId = ctx.record('location', created.id);
    }
    state.locationId = locationId;
  }

  // ── checklist templates ──────────────────────────────────────────────────
  /** A template, its sections and its items. */
  const recordTemplate = (template, scope = 'project') => {
    const options = scope === 'company' ? { scope: 'company' } : undefined;
    ctx.record('form_template', template.id, options);
    for (const section of template.sections || []) {
      if (section.id) ctx.record('form_section', section.id, options);
      for (const item of section.items || []) if (item.id) ctx.record('form_item', item.id, options);
    }
    return template;
  };

  // Company-wide templates: once per company, by the company administrator (the PM persona).
  ctx.companyRefs.formTemplates = ctx.companyRefs.formTemplates || {};
  if (!ctx.companyRefs.formTemplates.inspection) {
    const created = await pm.POST('/company/form-templates', {
      name: `Company housekeeping inspection ${company.canary}-FORM_TEMPLATE-1`,
      description: `Company-wide checklist ${company.canary}-FORM_TEMPLATE-1`,
      trade: 'General',
      type: 'inspection',
      status: 'active',
      settings: { instructions: `Walk the whole floor. ${company.canary}-FORM_TEMPLATE-1` },
      sections: [{ title: `Housekeeping ${company.canary}`, items: [{ label: 'Access routes clear', responseType: 'pass_fail' }, { label: 'Waste segregated', responseType: 'yes_no' }, { label: `Remarks ${company.canary}`, responseType: 'text', required: false }] }],
    });
    ctx.companyRefs.formTemplates.inspection = recordTemplate(created, 'company').id;
  }
  if (!ctx.companyRefs.formTemplates.talk) {
    const created = await pm.POST('/company/form-templates', {
      name: `Company induction talk ${company.canary}-FORM_TEMPLATE-2`,
      description: `Company-wide toolbox talk ${company.canary}-FORM_TEMPLATE-2`,
      type: 'talk',
      status: 'draft',
      sections: [{ title: `Induction ${company.canary}`, items: [{ label: 'Site rules explained', responseType: 'yes_no' }] }],
    });
    ctx.companyRefs.formTemplates.talk = recordTemplate(created, 'company').id;
  }
  if (!ctx.companyRefs.formTemplates.starters) {
    // The product seeds only the starters the company does not have yet; it may make none.
    const seeded = await pm.POST('/company/form-templates/starters', {});
    ctx.companyRefs.formTemplates.starters = rowsOf(seeded).map((row) => row.id);
    for (const row of rowsOf(seeded)) {
      recordTemplate(row, 'company');
      // The starters come with fixed words; the description is the one place a canary fits.
      await pm.PATCH(`/company/form-templates/${row.id}`, { description: `Starter checklist ${company.canary}-FORM_TEMPLATE-STARTER` });
    }
  }

  // Project templates: by the quality engineer and the QS (template administration).
  const makeTemplate = async (who, { type, label, sections, status = 'active', settings = undefined, trade = null }) => {
    const mark = tag('form-template');
    const created = await who.POST(`${P}/forms/templates`, {
      name: `${label} ${mark}`,
      description: `${label} for this project — ${mark}`,
      trade,
      type,
      status,
      ...(settings ? { settings } : {}),
      sections: sections(mark),
    });
    return recordTemplate(created);
  };
  const templates = {
    itp: await makeTemplate(quality, { type: 'itp', label: 'Concrete pour ITP', sections: itpSections, trade: 'Concrete', settings: { requireSignatures: ['inspector'], deficiencyTarget: 'punch_item', instructions: `No pour before the hold point is released. ${tag('form-template')}` } }),
    inspection: await makeTemplate(quality, { type: 'inspection', label: 'Blockwork inspection', sections: inspectionSections, trade: 'Masonry', settings: { deficiencyTarget: 'observation' } }),
    form: await makeTemplate(qs, { type: 'form', label: 'Hot works permit', sections: permitSections, trade: 'General' }),
    talk: await makeTemplate(quality, { type: 'talk', label: 'Weekly toolbox talk', sections: talkSections, settings: { requireSignatures: ['attendee'] } }),
  };
  state.templates = Object.fromEntries(Object.entries(templates).map(([key, template]) => [key, template.id]));
  // A draft (cannot be used yet), one archived, one duplicated and renamed.
  const draft = await makeTemplate(quality, { type: 'inspection', label: 'Waterproofing inspection (draft)', sections: inspectionSections, status: 'draft' });
  await quality.PATCH(`${P}/forms/templates/${draft.id}`, { description: `Still being written — ${tag('form-template')}`, trade: 'Waterproofing' });
  const retired = await makeTemplate(quality, { type: 'form', label: 'Superseded permit', sections: permitSections });
  const archived = await quality.DELETE(`${P}/forms/templates/${retired.id}`);
  if (archived?.status !== 'archived') ctx.note(`FINDING archiving template ${retired.id} answered ${JSON.stringify(archived).slice(0, 160)}`);
  const copy = await quality.POST(`${P}/forms/templates/${templates.inspection.id}/duplicate`, { name: `Blockwork inspection (copy) ${tag('form-template')}` });
  recordTemplate(copy);
  state.templateStates = { draft: draft.id, archived: retired.id, duplicate: copy.id };

  // ── checklist instances ──────────────────────────────────────────────────
  const itemsOf = (template) => (template.sections || []).flatMap((section) => section.items || []);
  const signatureImage = () => `data:image/png;base64,${png(tag('signature')).toString('base64')}`;
  const recordResponses = (instance) => {
    for (const section of instance?.sections || []) for (const item of section.items || []) remember('form_item_response', item.response?.id);
  };
  const SIGNER = { inspector: quality, approver: pm, attendee: site, witness: site, subcontractor: site };
  const SIGNER_PERSONA = { inspector: 'quality', approver: 'pm', attendee: 'site', witness: 'site', subcontractor: 'site' };
  const signAs = async (instanceId, role, extra = {}) => {
    const signed = await SIGNER[role].POST(`${P}/forms/${instanceId}/signatures`, {
      role,
      image: signatureImage(),
      signerName: `${ctx.person(SIGNER_PERSONA[role]).name} ${tag('signature')}`.slice(0, 200),
      signerCompany: `${company.name || company.code} ${tag('signature')}`.slice(0, 200),
      ...extra,
    });
    if (!signed?.signature?.id) throw new Error(`quality-field: signing ${instanceId} as ${role} returned no signature`);
    ctx.record('signature', signed.signature.id);
    remember('project_document', signed.signature.documentId);
    recordResponses(signed.instance); // a signature item is answered by the signature
    return signed;
  };
  /** Each signature is also an attachment (role signature) and, being a PNG, a gallery photo. */
  const recordInstanceFiles = async (instanceId) => {
    const listed = rowsOf(await quality.GET(`${P}/attachments?recordType=form_instance&recordId=${instanceId}`));
    for (const row of listed) {
      remember('attachment', row.id);
      remember('project_document', row.documentId);
      if (row.photo?.id) {
        remember('photo', row.photo.id);
        if (!madePhotos.includes(row.photo.id)) madePhotos.push(row.photo.id);
      }
    }
  };
  /** One answer per item; `fail` names the kind of item to answer badly. */
  const answers = (template, { fail = null, only = null } = {}) => {
    const out = [];
    let failed = false;
    for (const item of itemsOf(template)) {
      if (only !== null && out.length >= only) break;
      let value;
      switch (item.responseType) {
        case 'pass_fail': {
          const bad = !failed && ((fail === 'hold' && item.isHoldPoint) || (fail === 'item' && !item.isHoldPoint));
          value = bad ? 'fail' : 'pass';
          if (bad) failed = true;
          break;
        }
        case 'yes_no':
          value = 'yes';
          break;
        case 'checkbox':
          value = 'checked';
          break;
        case 'number': {
          const low = Number(item.options?.min ?? 1);
          const high = Number(item.options?.max ?? low + 10);
          value = rng.int(low, high);
          break;
        }
        case 'choice':
          value = rng.pick(item.options || []);
          break;
        case 'date':
          value = ctx.today;
          break;
        case 'text':
          value = `Recorded on site — ${tag('form-answer')}`;
          break;
        default:
          continue; // photo and signature items are answered by an upload and a signature
      }
      out.push({ itemId: item.id, value, note: value === 'fail' ? `Rejected: rework before re-inspection — ${tag('form-answer')}` : out.length % 3 === 0 ? `Checked — ${tag('form-answer')}` : undefined });
    }
    return out;
  };
  /**
   * One instance driven to `plan`:
   *   scheduled | in_progress | complete | complete_fail | complete_fail_hold | closed | void | reopened
   */
  const makeInstance = async (template, plan, { activity = null, title, recurrence = null, schedule = 0, photo = false } = {}) => {
    const created = await site.POST(`${P}/forms`, {
      templateId: template.id,
      title: `${title} ${tag('form-instance')}`.slice(0, 200),
      activityId: activity,
      locationId,
      assigneeUserId: ids.site,
      assigneeCompanyId: subcontractor,
      inspectorUserId: ids.quality,
      approverUserId: ids.pm,
      scheduledFor: schedule >= 0 ? ctx.daysAhead(schedule) : ctx.daysAgo(-schedule),
      dueDate: schedule >= 0 ? ctx.daysAhead(schedule + 2) : ctx.daysAgo(-schedule - 2),
      ...(recurrence ? { recurrence } : {}),
    });
    ctx.record('form_instance', created.id);
    const result = { id: created.id, ref: created.ref, plan, activityId: activity };
    if (plan === 'scheduled') {
      // Still to be done: rescheduled once, as a planner of the week would.
      await site.PATCH(`${P}/forms/${created.id}`, { dueDate: schedule >= 0 ? ctx.daysAhead(schedule + 4) : ctx.daysAgo(-schedule - 1), title: `${title} (rescheduled) ${tag('form-instance')}`.slice(0, 200) });
      return result;
    }
    if (plan === 'void') {
      await quality.POST(`${P}/forms/${created.id}/void`, { reason: `Raised against the wrong area — ${tag('form-instance')}` });
      return result;
    }
    await site.POST(`${P}/forms/${created.id}/start`);
    if (plan === 'in_progress') {
      recordResponses(await site.PUT(`${P}/forms/${created.id}/responses`, { responses: answers(template, { only: 2 }) }));
      return result;
    }
    const fail = plan === 'complete_fail_hold' ? 'hold' : plan === 'complete_fail' ? 'item' : null;
    const responses = answers(template, { fail });
    let answered = await site.PUT(`${P}/forms/${created.id}/responses`, { responses });
    // A photo item is answered by a photo on its response.
    const photoItem = photo ? itemsOf(template).find((item) => item.responseType === 'photo') : null;
    if (photoItem) {
      answered = await site.PUT(`${P}/forms/${created.id}/responses`, { responses: [{ itemId: photoItem.id, value: 'provided', note: `Photo taken at the face — ${tag('form-answer')}` }] });
      const response = (answered.sections || []).flatMap((section) => section.items).find((item) => item.id === photoItem.id)?.response;
      if (!response?.id) throw new Error(`quality-field: the photo answer on ${created.ref} returned no response`);
      await attach(site, 'form_response', response.id, { fields: { tags: 'inspection,pour', ...(locationId ? { locationId } : {}) } });
    }
    recordResponses(answered);
    // A signature item, then the signatures the template requires.
    const signatureItem = itemsOf(template).find((item) => item.responseType === 'signature');
    let signatures = 0;
    if (signatureItem) {
      await signAs(created.id, 'subcontractor', { itemId: signatureItem.id });
      signatures += 1;
    }
    for (const role of template.settings?.requireSignatures || []) {
      await signAs(created.id, role);
      signatures += 1;
    }
    if (template.type === 'talk') {
      await signAs(created.id, 'witness');
      signatures += 1;
    }
    const completed = await site.POST(`${P}/forms/${created.id}/complete`);
    recordResponses(completed);
    if (completed?.nextInstance?.id) {
      ctx.record('form_instance', completed.nextInstance.id);
      result.nextInstanceId = completed.nextInstance.id;
    }
    if (fail) {
      // The failed item becomes a punch item or an observation, as the template says.
      const failedItem = responses.find((entry) => entry.value === 'fail');
      const target = template.settings?.deficiencyTarget === 'observation' ? 'observation' : 'punch_item';
      const raised = await site.POST(`${P}/forms/${created.id}/items/${failedItem.itemId}/deficiency`, {
        target,
        ...(target === 'observation' ? { observationType: 'quality', hazard: `Defective work ${tag('punch-item')}`.slice(0, 120), contributingCondition: `Found during ${created.ref} — ${tag('punch-item')}` } : {}),
        title: `Deficiency from ${created.ref} ${tag('punch-item')}`.slice(0, 200),
        priority: 'high',
        trade: 'Concrete',
        locationText: `Grid ${rng.pick(['A', 'B', 'C', 'D'])}${rng.int(1, 9)} ${tag('punch-item')}`,
        assigneeCompanyId: subcontractor,
        assigneeUserId: ids.site,
        managerUserId: ids.pm,
        finalApproverUserId: ids.quality,
        dueDate: ctx.daysAhead(7),
      });
      if (!raised?.record?.id) throw new Error(`quality-field: the deficiency on ${created.ref} returned no record`);
      ctx.record('punch_item', raised.record.id);
      result.deficiencyId = raised.record.id;
      recordResponses(raised.instance);
      await attach(quality, 'form_instance', created.id, { kind: 'pdf' });
    }
    if (signatures) await recordInstanceFiles(created.id);
    if (fail || plan === 'complete') return result; // left complete (a failed one with outcome fail)
    await quality.POST(`${P}/forms/${created.id}/close`, { reason: `Accepted — ${tag('form-instance')}` });
    if (plan === 'reopened') await quality.POST(`${P}/forms/${created.id}/reopen`, { reason: `Re-inspection asked for by the consultant — ${tag('form-instance')}` });
    return result;
  };

  // An earlier run may have left a still-pending ITP on another activity (older
  // versions put the scheduled one there). It would block progress approval
  // where nobody expects it, so it is voided; its record stays.
  const previousItps = state.instances?.itp || [];
  for (const made of previousItps) {
    if (!made.activityId || made.activityId === lastActivityId || made.plan !== 'scheduled') continue;
    const open = await quality.GET(`${P}/forms/hold-points?activityId=${made.activityId}`);
    const mine = (open?.holdPoints || []).find((point) => point.instanceId === made.id);
    if (!mine || !['scheduled', 'in_progress'].includes(mine.status)) continue;
    await quality.POST(`${P}/forms/${made.id}/void`, { reason: `Superseded: the pending ITP now sits on the hold-point activity — ${tag('form-instance')}` });
    made.plan = 'void';
    ctx.note(`voided ${mine.ref} from an earlier run: its ${mine.state} hold point blocked progress approval on activity ${made.activityId}`);
  }

  state.instances = {};
  const drive = async (key, template, plans, options) => {
    state.instances[key] = [];
    for (const [i, plan] of plans.entries()) {
      const made = await makeInstance(template, plan, options(i, plan));
      state.instances[key].push(made);
    }
  };
  // ITPs hang on activities; the failed hold point and the pending one go on the last activity only.
  const itpPlans = ['closed', 'complete_fail_hold', 'scheduled', 'in_progress', 'void', 'reopened'].slice(0, ctx.count(2, 6));
  await drive('itp', templates.itp, itpPlans, (i, plan) => ({
    activity: plan === 'complete_fail_hold' || plan === 'scheduled' ? lastActivityId : activityId(i),
    title: 'Pour ITP',
    schedule: plan === 'scheduled' ? 5 + i : -i,
    photo: plan === 'closed',
  }));
  const holdPointActivities = [...new Set([...(state.holdPointActivities || (state.holdPointActivity ? [state.holdPointActivity] : [])), ...(itpPlans.some((plan) => ['complete_fail_hold', 'scheduled'].includes(plan)) ? [lastActivityCode] : [])])];
  state.holdPointActivities = holdPointActivities;
  if (holdPointActivities.length) state.holdPointActivity = holdPointActivities.includes(lastActivityCode) ? lastActivityCode : holdPointActivities[0];
  const inspectionPlans = ['complete_fail', 'closed', 'scheduled', 'void'].slice(0, ctx.count(1, 4));
  await drive('inspection', templates.inspection, inspectionPlans, (i, plan) => ({ activity: anyActivity(), title: 'Blockwork inspection', schedule: plan === 'scheduled' ? -3 : 0 })); // the scheduled one is overdue
  const permitPlans = ['closed', 'in_progress', 'scheduled'].slice(0, ctx.count(1, 3));
  await drive('form', templates.form, permitPlans, (i) => ({ activity: anyActivity(), title: 'Hot works permit', schedule: i }));
  const talkPlans = ['closed', 'complete', 'scheduled', 'complete'].slice(0, ctx.count(1, 4));
  await drive('talk', templates.talk, talkPlans, (i) => ({ title: 'Toolbox talk', schedule: -7 * i, recurrence: i === 1 ? { every: 'week', interval: 1, until: ctx.daysAhead(60) } : null }));
  // An instance of the company's own checklist, read through the project.
  const companyTemplate = await site.GET(`${P}/forms/templates/${ctx.companyRefs.formTemplates.inspection}`);
  await drive('company', companyTemplate, ['complete'], () => ({ activity: anyActivity(), title: 'Housekeeping inspection' }));

  // What the product gives back for an instance: its PDF, and the hold points open on the activities.
  const exported = await check('form export.pdf', () => quality.download(`${P}/forms/${state.instances.itp[0].id}/export.pdf?includePhotos=true`));
  if (exported && exported.subarray(0, 4).toString('latin1') !== '%PDF') ctx.note('FINDING form export.pdf did not return a PDF');
  if (itpPlans.some((plan) => ['complete_fail_hold', 'scheduled'].includes(plan))) {
    const open = await check('hold points', () => site.GET(`${P}/forms/hold-points?activityId=${lastActivityId}`));
    if (open && !open.open) ctx.note(`FINDING the failed or pending hold point on ${lastActivityCode} is not reported open: ${JSON.stringify(open).slice(0, 200)}`);
  }
  for (const made of state.instances.itp) {
    if (made.activityId === lastActivityId) continue;
    const open = await check('hold points', () => site.GET(`${P}/forms/hold-points?activityId=${made.activityId}`));
    if (open?.open) ctx.note(`hold points still open on activity ${made.activityId} (not the hold-point activity): ${JSON.stringify(open.holdPoints || []).slice(0, 200)}`);
  }

  // ── the legacy ITP register (feeds the quality score: 15 per failed) ─────
  const ITP_PLANS = [['hold', 'passed'], ['witness', 'pending'], ['review', 'failed'], ['hold', 'waived'], ['witness', 'passed']];
  for (const [i, [pointType, target]] of ITP_PLANS.slice(0, ctx.count(2, 5)).entries()) {
    const mark = tag('itp-record');
    const created = await quality.POST(`${P}/itp`, {
      title: `${['Rebar inspection before pour', 'Cube sampling witness', 'Waterproofing review', 'Backfill compaction hold', 'Blockwork first course witness'][i]} ${mark}`,
      pointType,
      status: 'pending',
      activityId: activityId(i + 2),
      dueDate: ctx.daysAhead(3 + i),
      inspectionDate: ctx.daysAgo(i),
      inspector: `${ctx.person('quality').name} ${mark}`,
      notes: `Inspection and test plan point — ${mark}`,
      comment: `Raised from the ITP schedule — ${mark}`,
      assigneeUserId: ids.site,
      ownerUserId: ids.quality,
      assigneeCompanyId: subcontractor,
    });
    ctx.record('itp_record', created.id);
    recordActivityLinks(created);
    if (target !== 'pending') {
      await site.PATCH(`${P}/itp/${created.id}`, { status: target, inspectionDate: ctx.today, comment: `${target === 'failed' ? 'Not accepted' : target === 'waived' ? 'Waived by the consultant' : 'Accepted'} — ${tag('itp-record')}` });
    }
    if (i === 0) await attach(site, 'itp', created.id, { kind: 'pdf' });
  }

  // ── NCRs ─────────────────────────────────────────────────────────────────
  const NCR_PLANS = [['major', 'closed'], ['minor', 'open'], ['minor', 'submitted'], ['major', 'rejected'], ['minor', 'reopened']];
  const NCR_TEXT = ['Honeycombing on the east face of the pad footing', 'Block joints wider than tolerance at level 1', 'Cover to slab reinforcement below drawing', 'Wrong grade of membrane delivered and laid', 'Door frames fixed out of plumb'];
  state.ncr = [];
  for (const [i, [severity, target]] of NCR_PLANS.slice(0, ctx.count(2, 5)).entries()) {
    const mark = tag('ncr');
    const raiser = i % 2 ? quality : site;
    let ncr = await raiser.POST(`${P}/ncr`, {
      severity,
      description: `${NCR_TEXT[i]} — ${mark}`,
      disposition: `Repair to the approved method statement — ${mark}`,
      responsible: `Subcontractor foreman ${mark}`,
      assigneeUserId: ids.site,
      assigneeCompanyId: subcontractor,
      activityId: activityId(i + 1),
      dueDate: ctx.daysAhead(10 + i),
      comment: `Raised after inspection — ${mark}`,
    });
    ctx.record('ncr_record', ncr.id);
    recordActivityLinks(ncr);
    state.ncr.push({ id: ncr.id, ref: ncr.ref, severity, plan: target });
    await attach(raiser, 'ncr', ncr.id, { fields: locationId ? { locationId, tags: 'ncr,defect' } : { tags: 'ncr,defect' } });
    if (i === 1) await quality.PATCH(`${P}/ncr/${ncr.id}`, { responsible: `Blockwork subcontractor ${tag('ncr')}`, comment: `Responsibility corrected — ${tag('ncr')}`, dueDate: ctx.daysAhead(14) });
    if (target === 'open') continue;
    // The closeout is sent by the person the NCR is assigned to: the repair report
    // attached to the NCR, and the closeout evidence uploaded as the dialog does.
    await attach(site, 'ncr', ncr.id, { kind: 'pdf' });
    ncr = await site.POST(`${P}/ncr/${ncr.id}/${i % 2 ? 'submit' : 'close'}`, {
      closureComment: `Defective work cut out and made good; re-inspected — ${tag('ncr')}`,
      responsible: `Subcontractor foreman ${mark}`,
      dueDate: ctx.daysAhead(10 + i),
      attachmentRefs: [await workflowUpload(site, 'ncr-closeout')],
    });
    if (ncr?.status !== 'submitted') ctx.note(`FINDING NCR closeout left ${ncr?.ref} ${ncr?.status}, not submitted`);
    recordWorkflowRows(ncr);
    if (target === 'submitted') continue;
    if (target === 'rejected') {
      await quality.POST(`${P}/ncr/${ncr.id}/reject`, { reason: `The repair is not to the approved method — ${tag('ncr')}` });
      continue;
    }
    await quality.POST(`${P}/ncr/${ncr.id}/approve`, { comment: `Repair accepted — ${tag('ncr')}` });
    if (target === 'reopened') await pm.POST(`${P}/ncr/${ncr.id}/reopen`, { reason: `The defect has shown again — ${tag('ncr')}` });
  }

  // ── punch items ──────────────────────────────────────────────────────────
  const step = (who, itemId, action, reason = undefined) => who.POST(`${P}/punch/${itemId}/transition`, { action, ...(reason ? { reason } : {}) });
  const PUNCH_TEXT = ['Remove formwork debris from the excavation', 'Touch up paint at stair core', 'Seal penetrations at riser', 'Replace cracked floor tile', 'Fix loose handrail bracket', 'Clean silicone smears off glazing', 'Adjust door closer'];
  const walk = async (itemId, target) => {
    if (target === 'draft') return;
    await step(site, itemId, 'open');
    if (target === 'open') return;
    if (target === 'void') {
      await step(quality, itemId, 'void', `Duplicate of another item — ${tag('punch-item')}`);
      return;
    }
    if (target === 'in_dispute') {
      await step(site, itemId, 'dispute', `Not in the subcontract scope — ${tag('punch-item')}`);
      return;
    }
    await step(site, itemId, 'ready_for_review');
    if (target === 'ready_for_review') return;
    await step(quality, itemId, 'close', `Verified on the walk-down — ${tag('punch-item')}`); // only the final approver may
    if (target === 'reopened') await step(site, itemId, 'reopen', `Came loose again — ${tag('punch-item')}`);
  };
  const PUNCH_PLANS = ['closed', 'open', 'ready_for_review', 'draft', 'in_dispute', 'void', 'reopened'];
  state.punch = [];
  for (const [i, target] of PUNCH_PLANS.slice(0, ctx.count(3, 7)).entries()) {
    const mark = tag('punch-item');
    const created = await (i === 3 ? qs : site).POST(`${P}/punch`, {
      title: `${PUNCH_TEXT[i]} ${mark}`.slice(0, 200),
      description: `Snag found on the walk-round — ${mark}`,
      kind: 'punch',
      priority: ['normal', 'high', 'low', 'urgent'][i % 4],
      trade: ['Carpentry', 'Painting', 'MEP', 'Tiling'][i % 4],
      locationText: `Level ${1 + (i % 3)}, grid ${rng.pick(['A', 'B', 'C'])}${rng.int(1, 8)} ${mark}`,
      ...(locationId ? { locationId } : {}),
      activityId: activityId(i + 3),
      assigneeCompanyId: subcontractor,
      assigneeUserId: ids.site,
      managerUserId: ids.pm,
      finalApproverUserId: ids.quality,
      dueDate: i === 1 ? ctx.daysAgo(4) : ctx.daysAhead(5 + i), // one overdue
      clientRequestId: requestKey(mark),
    });
    if (created.replayed) throw new Error(`quality-field: punch ${mark} was answered as a replay of ${created.ref}`);
    ctx.record('punch_item', created.id);
    recordActivityLinks(created);
    state.punch.push({ id: created.id, ref: created.ref, plan: target });
    if (i < 2) await attach(site, 'punch_item', created.id, { fields: { tags: 'punch,snag', ...(locationId ? { locationId } : {}) } });
    if (i === 1) await site.PATCH(`${P}/punch/${created.id}`, { description: `Snag found on the walk-round; access needed from level 2 — ${tag('punch-item')}`, priority: 'urgent' });
    await walk(created.id, target);
  }
  // Several at once, already open, then sent to the people who must clear them.
  const bulkMarks = [tag('punch-item'), tag('punch-item')];
  const bulk = await site.POST(`${P}/punch/bulk`, {
    items: [
      { title: `Make good plaster at socket boxes ${bulkMarks[0]}`, description: `Listed on the pre-handover walk — ${bulkMarks[0]}`, clientRequestId: requestKey(bulkMarks[0]) },
      { title: `Label distribution board circuits ${bulkMarks[1]}`, description: `Listed on the pre-handover walk — ${bulkMarks[1]}`, clientRequestId: requestKey(bulkMarks[1]) },
    ],
    defaults: { priority: 'low', trade: 'Electrical', status: 'open', activityId: activityId(4), assigneeUserId: ids.site, assigneeCompanyId: supplier || subcontractor },
  });
  const bulkIds = rowsOf(bulk).map((row) => row.id).filter(Boolean);
  if (bulkIds.length !== 2) throw new Error(`quality-field: punch bulk made ${bulkIds.length} item(s), not 2: ${JSON.stringify(bulk).slice(0, 200)}`);
  for (const id of bulkIds) ctx.record('punch_item', id);
  state.bulkPunch = bulkIds;
  // Only the two bulk items: an empty list would distribute every open item of the project.
  const distributed = await site.POST(`${P}/punch/distribute`, { itemIds: bulkIds, userIds: [ids.site], message: `Please clear before handover — ${tag('punch-item')}`, kind: 'punch' });
  state.distributed = { items: bulkIds.length, answer: JSON.stringify(distributed).slice(0, 120) };

  // ── observations: one of each type the product offers ────────────────────
  const OBSERVATIONS = [
    ['safety', 'Unguarded edge at the excavation', 'open'],
    ['quality', 'Curing not maintained on the slab', 'closed'],
    ['environmental', 'Fuel stored without a bund', 'ready_for_review'],
    ['work_to_complete', 'Kerb run stopped short of the gate', 'void'],
    ['commissioning', 'Pump set not yet flushed', 'draft'],
  ];
  state.observations = [];
  for (const [i, [observationType, text, target]] of OBSERVATIONS.slice(0, ctx.count(2, 5)).entries()) {
    const mark = tag('observation');
    const created = await (i % 2 ? site : quality).POST(`${P}/punch`, {
      title: `${text} ${mark}`.slice(0, 200),
      description: `Observed on the daily walk — ${mark}`,
      kind: 'observation',
      observationType,
      hazard: observationType === 'safety' ? `Fall into excavation ${mark}`.slice(0, 120) : null,
      contributingCondition: `Barriers moved for plant access — ${mark}`,
      priority: observationType === 'safety' ? 'urgent' : 'normal',
      ...(locationId ? { locationId } : {}),
      locationText: `North boundary ${mark}`,
      activityId: activityId(i + 5),
      assigneeUserId: ids.site,
      managerUserId: ids.pm,
      dueDate: ctx.daysAhead(2 + i),
      clientRequestId: requestKey(mark),
    });
    if (created.replayed) throw new Error(`quality-field: observation ${mark} was answered as a replay of ${created.ref}`);
    ctx.record('punch_item', created.id);
    recordActivityLinks(created);
    state.observations.push({ id: created.id, ref: created.ref, type: observationType, plan: target });
    if (i === 0) await attach(quality, 'punch_item', created.id, { fields: { tags: 'observation,safety' } });
    // No final approver here: a PM or quality engineer closes it.
    if (target === 'draft') continue;
    await step(site, created.id, 'open');
    if (target === 'ready_for_review') await step(site, created.id, 'ready_for_review');
    if (target === 'closed') await step(pm, created.id, 'close', `Made safe — ${tag('observation')}`);
    if (target === 'void') await step(pm, created.id, 'void', `Recorded twice — ${tag('observation')}`);
  }
  const listing = await check('punch export.csv', () => quality.download(`${P}/punch/export.csv?kind=all`));
  if (listing && !listing.length) ctx.note('FINDING punch export.csv is empty');

  // ── defects ──────────────────────────────────────────────────────────────
  const DEFECTS = [['minor', 'closed', 'Hairline crack in blinding'], ['major', 'open', 'Slab level out by 15 mm at grid C'], ['critical', 'in_progress', 'Exposed reinforcement at column base'], ['minor', 'open', 'Chipped arris on precast stair']];
  for (const [i, [severity, target, text]] of DEFECTS.slice(0, ctx.count(2, 4)).entries()) {
    const mark = tag('defect-record');
    const created = await qs.POST(`${P}/defects`, {
      title: `${text} ${mark}`,
      severity,
      status: 'open',
      activityId: activityId(i + 6),
      trade: `Concrete ${mark}`,
      location: `Grid ${rng.pick(['A', 'B', 'C'])}${rng.int(1, 9)} ${mark}`,
      assignee: `Concrete gang ${mark}`,
      notes: `Logged at the weekly quality walk — ${mark}`,
      comment: `Opened — ${mark}`,
      dueDate: ctx.daysAhead(6 + i),
      targetCloseBy: ctx.daysAhead(9 + i),
      assigneeUserId: ids.site,
      assigneeCompanyId: subcontractor,
    });
    ctx.record('defect_record', created.id);
    recordActivityLinks(created);
    if (i === 0) await attach(site, 'defect', created.id);
    if (target === 'open') continue;
    await site.PATCH(`${P}/defects/${created.id}`, { status: 'in_progress', comment: `Repair started — ${tag('defect-record')}` });
    if (target === 'closed') await pm.PATCH(`${P}/defects/${created.id}`, { status: 'closed', closedDate: ctx.today, comment: `Accepted — ${tag('defect-record')}` });
  }

  // ── material tests (cube tests are a test type) ──────────────────────────
  const TESTS = [
    ['Concrete cube test, 28 days', 'pass', '>= 35 MPa', '38.4 MPa'],
    ['Concrete cube test, 7 days', 'pending', '>= 23 MPa', null],
    ['Reinforcement tensile test', 'fail', '>= 500 MPa yield', '471 MPa'],
    ['Slump test at discharge', 'pass', '100 +/- 25 mm', '110 mm'],
    ['Field density, backfill layer 2', 'pending', '>= 95% MDD', null],
  ];
  for (const [i, [testType, target, specValue, actualValue]] of TESTS.slice(0, ctx.count(2, 5)).entries()) {
    const mark = tag('material-test');
    const created = await quality.POST(`${P}/material-tests`, {
      testType: `${testType} ${mark}`,
      result: 'pending',
      activityId: activityId(i + 1),
      testDate: ctx.daysAgo(2 + i),
      dueDate: ctx.daysAhead(1 + i),
      specValue: `${specValue} ${mark}`,
      labName: `City Materials Laboratory ${mark}`,
      millCertRef: `MC-${1000 + i} ${mark}`,
      notes: `Sample set ${i + 1} — ${mark}`,
      comment: `Samples taken — ${mark}`,
      assigneeUserId: ids.quality,
    });
    ctx.record('material_test', created.id);
    recordActivityLinks(created);
    if (i === 0) await attach(quality, 'material_test', created.id, { kind: 'pdf' });
    if (target !== 'pending') {
      await (i % 2 ? site : quality).PATCH(`${P}/material-tests/${created.id}`, { result: target, actualValue: `${actualValue} ${tag('material-test')}`, comment: `Laboratory report received — ${tag('material-test')}` });
    }
  }

  // ── safety incidents and near misses ─────────────────────────────────────
  const INCIDENTS = [
    ['near_miss', 'closed', 'Pallet slipped from the forks during offloading'],
    ['first_aid', 'open', 'Cut to hand while fixing reinforcement'],
    ['near_miss', 'archived', 'Entered twice in error'],
    ['lti', 'investigating', 'Operative fell from a hop-up, sprained ankle'],
    ['near_miss', 'submitted', 'Reversing dumper with no banksman'],
    ['first_aid', 'rejected', 'Dust in eye while cutting blocks'],
    ['near_miss', 'reopened', 'Scaffold tie removed by another trade'],
  ];
  state.safety = [];
  let closeouts = 0;
  for (const [i, [incidentType, target, text]] of INCIDENTS.slice(0, ctx.count(2, 7)).entries()) {
    const mark = tag('safety-incident');
    let incident = await site.POST(`${P}/safety`, {
      incidentType,
      title: `${text} ${mark}`,
      date: ctx.daysAgo(1 + i),
      activityId: activityId(i),
      responsible: `Site supervisor ${mark}`,
      investigation: `Statements taken from the crew — ${mark}`,
      severity: ['low', 'medium', 'high'][i % 3],
      dueDate: ctx.daysAhead(4 + i),
      lostDays: incidentType === 'lti' ? rng.int(1, 5) : 0,
      comment: `Reported the same shift — ${mark}`,
      assigneeUserId: ids.site,
      assigneeCompanyId: subcontractor,
      status: target === 'investigating' ? 'investigating' : 'open',
    });
    ctx.record('safety_incident', incident.id);
    recordActivityLinks(incident);
    state.safety.push({ id: incident.id, ref: incident.ref, type: incidentType, plan: target });
    if (i < 2) await attach(site, 'safety_incident', incident.id, { fields: { tags: 'safety' } });
    if (target === 'open' || target === 'investigating') {
      if (i === 1) await quality.PATCH(`${P}/safety/${incident.id}`, { comment: `First aider's report added — ${tag('safety-incident')}`, lostDays: 0 });
      continue;
    }
    if (target === 'archived') {
      await pm.DELETE(`${P}/safety/${incident.id}`); // a withdrawn incident is archived, not removed
      continue;
    }
    const evidence = await workflowUpload(site, 'safety');
    incident = await site.POST(`${P}/safety/${incident.id}/${closeouts % 2 ? 'submit' : 'close'}`, {
      closureComment: `Corrective actions briefed and in place — ${tag('safety-incident')}`,
      responsible: `Site supervisor ${mark}`,
      dueDate: ctx.daysAhead(4 + i),
      attachmentRefs: [evidence],
    });
    closeouts += 1;
    recordWorkflowRows(incident);
    if (target === 'submitted') continue;
    if (target === 'rejected') {
      await quality.POST(`${P}/safety/${incident.id}/reject`, { reason: `No evidence that the crew was briefed — ${tag('safety-incident')}` });
      continue;
    }
    await quality.POST(`${P}/safety/${incident.id}/approve`, { comment: `Closed out — ${tag('safety-incident')}` });
    if (target === 'reopened') await pm.POST(`${P}/safety/${incident.id}/reopen`, { reason: `The same hazard was seen again — ${tag('safety-incident')}` });
  }

  // ── weather delays ───────────────────────────────────────────────────────
  const WEATHER = [['Heavy rain: site flooded, excavation pumped out', 1.5, true], ['High wind: tower crane stood down', 0.5, true], ['Heat: afternoon working stopped by order', 1, false], ['Sandstorm: external works stopped', 2, true]];
  state.weather = [];
  for (const [i, [text, delayDays, contractual]] of WEATHER.slice(0, ctx.count(1, 4)).entries()) {
    const mark = tag('weather-delay');
    const date = ctx.daysAgo(3 + 4 * i);
    const body = { description: `${text} — ${mark}`, date, delayDays, contractual };
    if (i % 2) body.affectedActivityIds = [activityId(i), activityId(i + 1)];
    else body.activityLinks = [{ activityId: activityId(i), delayStart: date, delayEnd: date, delayDays, notes: `Stood down all day — ${mark}` }];
    const created = await planner.POST(`${P}/weather-delays`, body);
    ctx.record('weather_delay', created.id);
    for (const link of created.activityLinks || []) if (link?.id) remember('weather_delay_activity_link', link.id);
    state.weather.push(created.id);
    // The route accepts any non-negative number of days (isFloat); the record keeps whole days.
    if (Number(created.delayDays) !== delayDays) ctx.note(`FINDING weather delay sent with delayDays ${delayDays} was stored with ${created.delayDays} (POST ${P}/weather-delays answered ${created.id})`);
    if (i === 0) {
      await attach(planner, 'weather_delay', created.id, { kind: 'pdf' });
      await attach(planner, 'weather_delay', created.id);
    }
    if (i === 1) await qs.PATCH(`${P}/weather-delays/${created.id}`, { delayDays: 1, description: `${text}; a full day lost after inspection — ${tag('weather-delay')}` });
  }
  {
    // The allowance rule: a warning at 70% of the contractual allowance used.
    const listed = await planner.GET(`${P}/weather-delays`);
    const summary = listed?.summary;
    if (summary) {
      const used = rowsOf(listed).filter((row) => row.contractual).reduce((sum, row) => sum + (Number(row.delayDays) || 0), 0);
      if (Number(summary.contractualUsed) !== used) ctx.note(`FINDING weather summary contractualUsed ${summary.contractualUsed} is not the sum of contractual delays ${used}`);
      if (Boolean(summary.warning) !== Number(summary.consumedPct) >= 70) ctx.note(`FINDING weather warning ${summary.warning} at ${summary.consumedPct}% of the allowance (the rule warns from 70%)`);
      state.weatherSummary = { allowance: summary.allowance, contractualUsed: summary.contractualUsed, consumedPct: summary.consumedPct, warning: summary.warning };
    } else ctx.note(`weather delays answered no summary: ${JSON.stringify(listed).slice(0, 160)}`);
  }

  // ── site photos ──────────────────────────────────────────────────────────
  // The gallery is every image attached anywhere on the project; these hang on the place and on activities.
  state.photos = [];
  for (let i = 0, n = ctx.count(1, 4); i < n; i += 1) {
    const onLocation = i % 2 === 0;
    const item = await attach(onLocation ? site : planner, onLocation ? 'location' : 'activity', onLocation ? locationId : activityId(i), {
      caption: `Progress photo ${i + 1} — ${tag('photo')}`,
      fields: { role: 'photo', tags: 'progress,site', locationId },
    });
    if (!item.photo?.id) continue; // noted as a FINDING by attach
    state.photos.push(item.photo.id);
    if (i === 0) {
      await site.PATCH(`${P}/photos/${item.photo.id}`, { caption: `North elevation after the pour — ${tag('photo')}`, tags: ['progress', 'north-elevation', 'pour'], takenAt: new Date(Date.now() - 3_600_000).toISOString() });
      const bytes = await check('photo file', () => site.download(`${P}/photos/${item.photo.id}/file`));
      if (bytes && bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') ctx.note('FINDING the photo file is not the PNG that was uploaded');
    }
  }
  {
    // Every photo this run made (signatures included) is in the gallery, page after page.
    const seen = new Set();
    let signaturePhotos = 0;
    let cursor = null;
    for (let page = 0; page < 50; page += 1) {
      const listed = await check('photo gallery', () => site.GET(`${P}/photos?limit=200${cursor ? `&cursor=${cursor}` : ''}`));
      if (!listed) break;
      for (const row of rowsOf(listed)) {
        seen.add(row.id);
        if ((row.records || []).some((link) => link.role === 'signature')) signaturePhotos += 1;
      }
      cursor = listed.pagination?.nextCursor || null;
      if (!cursor) break;
    }
    const missing = madePhotos.filter((id) => !seen.has(id));
    if (seen.size && missing.length) ctx.note(`FINDING ${missing.length} photo(s) made by this run are not in the project gallery: ${missing.slice(0, 3).join(', ')}`);
    state.gallery = { photos: seen.size, signaturePhotos };
  }
  // The site-reporting photo store (what daily reports and diaries point at).
  state.sitePhotoKeys = state.sitePhotoKeys || [];
  for (let i = 0, n = ctx.count(1, 2); i < n; i += 1) {
    const file = fileOf('png', 'site-photo');
    const stored = await site.upload('POST', `${P}/site-reporting/uploads`, { field: 'files', filename: file.filename, contentType: file.contentType, body: file.body });
    const rows = rowsOf(stored);
    if (!rows.length || !rows[0].documentId) throw new Error(`quality-field: the site-reporting upload returned no document: ${JSON.stringify(stored).slice(0, 200)}`);
    for (const row of rows) remember('project_document', row.documentId);
    state.sitePhotoKeys.push(...rows.map((row) => row.key));
  }

  // ── the quality score and the project health, as the product reports them ──
  const dashboard = await quality.GET(`${P}/quality/dashboard`);
  const metrics = dashboard?.metrics || {};
  const ncrs = rowsOf(await quality.GET(`${P}/ncr`));
  const itps = rowsOf(await quality.GET(`${P}/itp`));
  const incidents = rowsOf(await quality.GET(`${P}/safety?includeArchived=true`));
  // An archived or void record is withdrawn: it does not count (quality.service.js).
  const live = (rows) => rows.filter((row) => row.status !== 'archived' && row.status !== 'void');
  const qualityRule = (ncrRows, itpRows) => {
    const major = ncrRows.filter((row) => row.severity === 'major').length;
    const minor = ncrRows.filter((row) => row.severity === 'minor').length;
    const failed = itpRows.filter((row) => row.status === 'failed').length;
    return { major, minor, failed, score: Math.max(0, 100 - 20 * major - 8 * minor - 15 * failed) };
  };
  const safetyRule = (rows) => {
    const lti = rows.filter((row) => row.incidentType === 'lti').length;
    const fatal = rows.filter((row) => row.incidentType === 'fatality').length;
    const open = rows.filter((row) => row.status !== 'closed').length;
    return { lti, fatal, open, score: Math.max(0, Math.min(100, 100 - 100 * fatal - 20 * lti - 5 * open)) };
  };
  const expected = qualityRule(live(ncrs), live(itps));
  const liveIncidents = live(incidents);
  const archivedIncidents = incidents.length - liveIncidents.length;
  ctx.note(`quality score ${metrics.qualityScore} (major NCRs ${metrics.majorNcrs}, minor ${metrics.minorNcrs}, failed ITPs ${metrics.failedItps}); safety incidents ${metrics.safetyIncidents}, open ${metrics.safetyOpen}, archived ${archivedIncidents}; open punch ${metrics.openDefects}, open observations ${metrics.observationsOpen}`);
  if (Number(metrics.qualityScore) !== expected.score) ctx.note(`FINDING quality score ${metrics.qualityScore} is not 100 - 20x${expected.major} - 8x${expected.minor} - 15x${expected.failed} = ${expected.score}`);
  const safetyOpen = liveIncidents.filter((row) => row.status !== 'closed').length;
  if (Number(metrics.safetyOpen) !== safetyOpen) ctx.note(`FINDING quality dashboard safetyOpen ${metrics.safetyOpen}, the incident list says ${safetyOpen} open (archived excluded)`);
  const health = await check('project health', () => pm.GET(`${P}/health`));
  if (health) {
    const dimension = (key) => (health.dimensions || []).find((row) => row.key === key);
    ctx.note(`project health: overall ${health.overallScore}, quality ${dimension('quality')?.score}, safety ${dimension('safety')?.score}`);
    if (dimension('quality') && Number(dimension('quality').score) !== expected.score) ctx.note(`FINDING health quality ${dimension('quality').score} differs from the quality rule ${expected.score} (dashboard ${metrics.qualityScore})`);
    const safetyExpected = safetyRule(liveIncidents);
    if (dimension('safety') && Number(dimension('safety').score) !== safetyExpected.score) {
      const withArchived = safetyRule(incidents).score;
      ctx.note(
        `FINDING health safety ${dimension('safety').score} is not 100 - 100x${safetyExpected.fatal} - 20x${safetyExpected.lti} - 5x${safetyExpected.open} open = ${safetyExpected.score} over live incidents` +
          (archivedIncidents && Number(dimension('safety').score) === withArchived ? `; it counts the ${archivedIncidents} archived incident(s) as open investigations (= ${withArchived}), which the quality dashboard excludes` : ''),
      );
    }
  }
  state.score = { quality: metrics.qualityScore, expected: expected.score, major: expected.major, minor: expected.minor, failedItps: expected.failed, safetyOpen: metrics.safetyOpen, archivedIncidents };
};

module.exports = { name: 'quality-field', needs: ['foundation'], depths: ['standard'], run };
