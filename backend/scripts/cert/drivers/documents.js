'use strict';

/**
 * Documents and design: everything a project files, asks and issues.
 *
 *   attachments     on activities, bill rows, the project, a location and on
 *                   every record made here (PDF, text and PNG; one linked
 *                   to a second record by its document id)
 *   RFIs            raised on an activity with a due date, then left in every
 *                   state the product has: closed, open with a discussion,
 *                   answered, rejected (back to open), overdue, reopened,
 *                   converted to a change order, archived — the ball in court
 *                   moves with each step. One more is raised with nobody asked
 *                   yet: a draft is asked for first, and the product refuses
 *                   it although its routes offer it (a finding, noted).
 *   submittals      two workflow templates (one archived), two packages (one
 *                   submitted and decided at once, one open with a member
 *                   taken out), and submittals left approved, pending, under
 *                   review, rejected, resubmitted and approved, sent back,
 *                   decided step by step (approved, rejected), archived
 *   drawings        the legacy register with file revisions (uploaded, in
 *                   review, approved, superseded, cancelled) and drawing sets
 *                   (a PDF is uploaded; processing needs the job worker, so a
 *                   set stays wherever it got to); sheets, markups and pins
 *                   only where this run's set was processed and published
 *   transmittals    pending acknowledgement and acknowledged
 *   correspondence  letters, e-mails, memos and notices, in and out, open
 *                   and closed
 *   specifications  a specification PDF filed on the project and offered to
 *                   the index (indexing needs extracted text: the worker)
 *   register/search the register, the dashboard, the attachment search, the
 *                   global search and the content search, asked at the end
 *                   for this run's canaries; every record's state is read
 *                   back and a state that differs from the one asked for is
 *                   written to the notes
 *
 * Every file made here carries its canary in its name and in its bytes.
 * Nothing is looked up by a fixed number, so the driver can run again: each
 * run makes a new batch. The codes it generates carry the run counter, and so
 * do its canaries from the second run on (…-RFI-R2-1), so a canary names one
 * record however often the driver ran.
 *
 * Failure policy. The records of the area are made without a safety net: a
 * refusal or a 5xx on one fails the run. Only a step the product may
 * legitimately refuse here (one that needs the job worker or an AI provider,
 * or a status the product does not offer) goes through `optional`, and a 5xx
 * there is still written to the notes as a product 5xx. A write is never
 * sent twice — a write that answered 5xx may have written part of its record
 * — and a read that answers 5xx is asked again, with a note each time.
 */

// ── files ────────────────────────────────────────────────────────────────────

const esc = (value) => String(value).replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '-');

/** A small valid PDF: one page per entry of `pages`, each a list of text lines. */
const pdf = (pages) => {
  const objects = [null, '<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (const lines of pages) {
    const pageNo = objects.length;
    const stream = `BT /F1 11 Tf 56 780 Td 15 TL ${lines.map((line) => `(${esc(line)}) Tj T*`).join(' ')} ET`;
    kids.push(`${pageNo} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageNo + 1} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let n = 1; n < objects.length; n += 1) {
    offsets.push(Buffer.byteLength(out));
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A 1x1 PNG whose text chunk carries `comment`. */
const png = (comment) => {
  const zlib = require('zlib');
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
    chunk('tEXt', Buffer.from(`Comment\0${comment}`, 'latin1')),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, 0x13, 0xc1, 0xce]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const pdfFile = (canary, title, extra = []) => ({
  filename: `${canary}.pdf`,
  contentType: 'application/pdf',
  body: pdf([[title, canary, ...extra]]),
});
const textFile = (canary, title, extra = []) => ({
  filename: `${canary}.txt`,
  contentType: 'text/plain',
  body: Buffer.from(`${[title, canary, ...extra].join('\n')}\n`, 'utf8'),
});
const pngFile = (canary) => ({ filename: `${canary}.png`, contentType: 'image/png', body: png(canary) });

// ── what the records are about ───────────────────────────────────────────────

const RFI_TOPICS = [
  ['Founding level against the borehole log', 'structural', '03 30 00'],
  ['Lap length of column starter bars', 'structural', '03 20 00'],
  ['Sleeve positions through the shear wall', 'mechanical', '23 05 00'],
  ['Movement joint spacing in blockwork', 'architectural', '04 20 00'],
  ['Screed thickness over floor conduits', 'finishing', '09 60 00'],
  ['Kerb radius at the site entrance', 'civil', '32 16 00'],
  ['Fire stopping at riser penetrations', 'mechanical', '07 84 00'],
  ['Foundation detail for lighting columns', 'electrical', '26 56 00'],
  ['Waterproofing upstand at the podium edge', 'architectural', '07 10 00'],
];
/** Every standard project gets every flow; extra RFIs repeat the first ones. */
const RFI_FLOWS = ['closed', 'open', 'answered', 'draft', 'rejected', 'overdue', 'reopened', 'converted', 'archived'];
const PRIORITIES = ['normal', 'high', 'urgent', 'low'];
/** The state each flow leaves an RFI in (`unassigned` is the draft the product refused). */
const RFI_STATE = { closed: 'closed', open: 'open', answered: 'answered', draft: 'draft', unassigned: 'open', rejected: 'open', overdue: 'open', reopened: 'open', converted: 'answered', archived: 'archived' };

const SUBMITTAL_TOPICS = [
  ['Cement OPC 42.5N mill certificate', 'structural', '03 30 00'],
  ['Reinforcement bar bending schedule', 'structural', '03 20 00'],
  ['Concrete mix design C35', 'structural', '03 30 00'],
  ['Blockwork unit sample and test report', 'architectural', '04 20 00'],
  ['Waterproofing membrane data sheet', 'architectural', '07 10 00'],
  ['Ceramic floor tile sample board', 'finishing', '09 30 00'],
  ['Emulsion paint colour schedule', 'finishing', '09 90 00'],
  ['Conduit and trunking shop drawing', 'electrical', '26 05 00'],
  ['Kerb unit technical submission', 'civil', '32 16 00'],
];
const SUBMITTAL_FLOWS = ['approved', 'pending', 'under_review', 'rejected', 'resubmitted', 'sent_back', 'step_approved', 'step_rejected', 'archived'];
/** [status, response code] each flow leaves a submittal in. */
const SUBMITTAL_STATE = {
  approved: ['approved', 'approved'],
  pending: ['pending', null],
  under_review: ['under_review', null],
  rejected: ['rejected', 'rejected'],
  resubmitted: ['approved', 'approved'],
  sent_back: ['resubmit', 'revise_resubmit'],
  step_approved: ['approved', 'approved'],
  step_rejected: ['resubmit', 'revise_resubmit'],
  archived: ['archived', null],
};

const DRAWING_TITLES = [
  ['S', 'Foundation layout, grid A-D', 'issued'],
  ['A', 'Ground floor general arrangement', 'in_review'],
  ['M', 'First fix services coordination', 'superseded'],
  ['C', 'External works and drainage layout', 'cancelled'],
  ['E', 'Lighting and small power layout', 'uploaded'],
];
/** [drawing status, latest revision label and status] each flow leaves a drawing in. */
const DRAWING_STATE = {
  issued: ['active', 'C', 'uploaded'],
  in_review: ['active', 'A', 'submitted'],
  superseded: ['superseded', null, null],
  cancelled: ['cancelled', 'P1', 'submitted'],
  uploaded: ['active', 'A', 'uploaded'],
};

const TRANSMITTAL_SUBJECTS = ['Issue of drawings for construction', 'Material submittals for review', 'As-built records for the handover file', 'Method statements for comment', 'Test certificates for the record'];
const TRANSMITTAL_METHODS = ['email', 'courier', 'hand'];

const LETTERS = [
  ['outgoing', 'letter', 'Instruction to lower the founding level'],
  ['incoming', 'letter', 'Consultant comments on the concrete mix'],
  ['outgoing', 'notice', 'Notice of delay to site access'],
  ['incoming', 'email', 'Client query on the finishes programme'],
  ['outgoing', 'memo', 'Site memo on working hours'],
  ['incoming', 'notice', 'Authority notice on road closure'],
];

const SPEC_PAGES = (canary) => [
  [
    'PROJECT SPECIFICATION', canary, '',
    'SECTION 03 30 00 CAST-IN-PLACE CONCRETE', 'PART 1 - GENERAL',
    '1.1 Summary: structural concrete for foundations, columns, beams and slabs.',
    '1.2 Submittals: mix designs, mill certificates and cube test results.',
    'PART 2 - PRODUCTS', '2.1 Cement: ordinary Portland cement 42.5N.', '2.2 Aggregates: crushed rock, 20 mm maximum.',
    'PART 3 - EXECUTION', '3.1 Placing: no free fall above 1.5 m.', '3.2 Curing: seven days minimum.', 'END OF SECTION',
  ],
  [
    canary, 'SECTION 04 20 00 UNIT MASONRY', 'PART 1 - GENERAL', '1.1 Summary: concrete blockwork walls 200 mm.',
    'PART 2 - PRODUCTS', '2.1 Blocks: 7 N/mm2 solid concrete blocks.', 'PART 3 - EXECUTION', '3.1 Movement joints at 6 m centres.', 'END OF SECTION',
    'SECTION 09 90 00 PAINTING AND COATING', 'PART 1 - GENERAL', '1.1 Summary: emulsion paint to plastered walls.',
    'PART 2 - PRODUCTS', '2.1 Paint: three coats vinyl emulsion.', 'PART 3 - EXECUTION', '3.1 Apply to dry surfaces only.', 'END OF SECTION',
  ],
];

const listOf = (data) => {
  if (Array.isArray(data)) return data;
  for (const key of ['items', 'rows', 'records', 'rfis', 'submittals', 'drawings', 'transmittals', 'correspondence', 'sets', 'sheets', 'packages', 'locations', 'results']) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isApiError = (error) => error?.name === 'ApiError';

/**
 * A person's session as this driver uses it. A read that answers 5xx is asked
 * again (up to three times), and every 5xx is written to the notes: a 5xx is
 * a finding, not noise. A write is sent once: several routes write part of
 * their record outside the transaction that failed (the stored file before
 * the attachment, the RFI before its notifications, the change order before
 * the RFI points at it), so a second send could leave an unrecorded twin. A
 * write that answers 5xx is noted with its route and fails the step.
 */
const steady = (ctx, session) => {
  const read = (method) => async (...args) => {
    for (let tries = 1; ; tries += 1) {
      try {
        return await session[method](...args);
      } catch (error) {
        if (!isApiError(error) || error.status < 500) throw error;
        ctx.note(`product 5xx on a read${tries < 3 ? ', asked again' : ''} (${tries}): ${error.message}`.slice(0, 400));
        if (tries >= 3) throw error;
        await sleep(500 * tries);
      }
    }
  };
  const write = (method) => async (...args) => {
    try {
      return await session[method](...args);
    } catch (error) {
      if (isApiError(error) && error.status >= 500) ctx.note(`product 5xx on a write, not sent again: ${error.message}`.slice(0, 400));
      throw error;
    }
  };
  return { ...session, GET: read('GET'), download: read('download'), POST: write('POST'), PATCH: write('PATCH'), PUT: write('PUT'), DELETE: write('DELETE'), upload: write('upload') };
};

// ── the driver ───────────────────────────────────────────────────────────────

const run = async (ctx) => {
  const { P } = ctx;
  const pm = steady(ctx, ctx.who('pm'));
  const planner = steady(ctx, ctx.who('planner'));
  const qs = steady(ctx, ctx.who('qs'));
  const site = steady(ctx, ctx.who('site'));
  const quality = steady(ctx, ctx.who('quality'));
  const user = { pm: ctx.userId('pm'), planner: ctx.userId('planner'), qs: ctx.userId('qs'), site: ctx.userId('site'), quality: ctx.userId('quality') };

  const state = (ctx.refs.documents = ctx.refs.documents || {});
  state.runs = (state.runs || 0) + 1;
  const runNo = state.runs;
  /** This run's canaries: from the second run on they carry the run, so no two records share one. */
  const canary = (type) => ctx.canary(runNo > 1 ? `${type}-r${runNo}` : type);

  /**
   * A step the product may legitimately refuse here. A refusal is a note; a
   * 5xx is a note marked as a product 5xx; anything that is not an API answer
   * (a programming error) is thrown.
   */
  const optional = async (label, fn) => {
    try {
      return await fn();
    } catch (error) {
      if (!isApiError(error)) throw error;
      ctx.note(`${error.status >= 500 ? 'PRODUCT 5xx — ' : ''}${label}: ${error.status} ${error.code} ${error.serverMessage}`.slice(0, 400));
      return null;
    }
  };

  const made = { rfis: {}, submittals: {}, drawings: {}, transmittals: {}, correspondence: {}, packages: [], templates: [], sets: [], revisions: {}, documents: [] };
  const recorded = { document_revision: new Set(), project_document: new Set(), attachment: new Set(), workflow_attachment: new Set() };
  /** Records an id once per run. */
  const once = (type, id) => {
    const seen = recorded[type];
    if (seen) {
      if (seen.has(id)) return id;
      seen.add(id);
    }
    return ctx.record(type, id);
  };
  const keepDocument = (documentId) => {
    if (!documentId) return;
    if (!recorded.project_document.has(documentId)) made.documents.push(documentId);
    once('project_document', documentId);
  };
  /** Remembers a record under the state it was left in; a second one in the same state gets a suffix. */
  const keep = (group, name, id) => {
    let key = name;
    for (let n = 2; group[key]; n += 1) key = `${name}_${n}`;
    group[key] = id;
  };
  const flowOf = (key) => key.replace(/_\d+$/, '');
  const required = (value, what) => {
    if (!value) throw new Error(`documents: ${what} answered without an id`);
    return value;
  };

  const activityCodes = Object.keys(ctx.refs.activities || {});
  if (!activityCodes.length) throw new Error('documents: the foundation driver left no activities');
  const activityAt = (i) => ctx.refs.activities[activityCodes[i % activityCodes.length]];
  const boqCodes = Object.keys(ctx.refs.boq || {});
  if (!boqCodes.length) throw new Error('documents: the foundation driver left no bill rows');
  const party = (kind) => `${ctx.company.canary} ${{ client: 'Property Group', consultant: 'Consulting Engineers', subcontractor: 'Concrete Works', supplier: 'Steel & Cement Supply' }[kind]}`;

  /** Attaches one file to a record (or links filed documents); returns the first attachment, with its documentId. */
  const attach = async (who, recordType, recordId, file, fields = {}) => {
    const out = await who.upload('POST', `${P}/attachments`, { field: 'files', ...file, fields: { recordType, recordId, ...fields } });
    const items = out?.items || [];
    if (!items[0]?.id) throw new Error(`documents: attaching to ${recordType} ${recordId} answered without an attachment`);
    for (const item of items) {
      once('attachment', item.id);
      keepDocument(item.documentId || item.document?.id);
      const photoId = item.photo?.id || item.document?.photo?.id;
      if (photoId) ctx.record('photo', photoId);
    }
    return { ...items[0], documentId: items[0].documentId || items[0].document?.id };
  };

  /** Uploads a file as a revision of a document-control record. */
  const uploadRevision = async (who, recordType, recordId, revision, file, fields = {}) => {
    const out = await who.upload('POST', `${P}/doc-control/${recordType}/${recordId}/revisions/upload`, { field: 'file', ...file, fields: { revision, ...fields } });
    const row = out?.revision || out;
    required(row?.id, `revision ${revision} of ${recordType} ${recordId}`);
    once('document_revision', row.id);
    const documentId = out?.document?.documentId || out?.document?.id || row.projectDocumentId;
    keepDocument(documentId);
    return { ...row, documentId };
  };

  // ── a place on the project, for the records that name one ─────────────────
  // Looked up by its code so that a second run uses the same zone.
  const flat = [];
  const walk = (nodes) => {
    for (const node of nodes || []) {
      flat.push(node);
      walk(node.children);
    }
  };
  walk(listOf(await site.GET(`${P}/locations`)));
  let location = flat.find((l) => l.code === 'DOC-GRID-AD') || null;
  if (!location) {
    const locationCanary = canary('location');
    location = await planner.POST(`${P}/locations`, { name: `Foundation zone grid A-D ${locationCanary}`.slice(0, 120), code: 'DOC-GRID-AD', kind: 'zone', description: `Pad and strip foundations between grids A and D — ${locationCanary}` });
    ctx.record('location', required(location?.id, 'the location'));
  }

  // ── attachments on what foundation left ───────────────────────────────────
  for (let i = 0; i < ctx.count(2, 3); i += 1) {
    const fileCanary = canary('activity-file');
    const file = i % 3 === 1 ? pngFile(fileCanary) : i % 3 === 2 ? textFile(fileCanary, 'Method statement note') : pdfFile(fileCanary, 'Method statement for the activity');
    await attach(planner, 'activity', activityAt(i * 2), file, { caption: `Method statement — ${fileCanary}`, role: i % 3 === 1 ? 'photo' : 'reference', ...(i % 3 === 1 ? { tags: 'site,progress' } : {}) });
  }
  for (let i = 0; i < Math.min(boqCodes.length, ctx.count(1, 2)); i += 1) {
    const fileCanary = canary('boq-file');
    await attach(qs, 'boq_item', ctx.refs.boq[boqCodes[(i * 3) % boqCodes.length]], i ? textFile(fileCanary, 'Rate build-up') : pdfFile(fileCanary, 'Measurement sheet'), { caption: `Take-off — ${fileCanary}`, role: 'evidence' });
  }
  {
    const fileCanary = canary('location-file');
    await attach(site, 'location', location.id, pngFile(fileCanary), { caption: `Zone photo — ${fileCanary}`, locationId: location.id, tags: 'zone' });
  }

  // ── RFIs ──────────────────────────────────────────────────────────────────
  const rfiCount = RFI_FLOWS.length + ctx.count(0, 2);
  for (let i = 0; i < rfiCount; i += 1) {
    const flow = RFI_FLOWS[i % RFI_FLOWS.length];
    const [topic, discipline, specSection] = RFI_TOPICS[i % RFI_TOPICS.length];
    const rfiCanary = canary('rfi');
    const raiser = i % 2 ? quality : site;
    const activityId = activityAt(i);
    const R = (id) => `${P}/rfi/${id}`;
    const asked = {
      subject: `${topic} — ${rfiCanary}`,
      question: `Please confirm: ${topic.toLowerCase()}. The drawings and the specification disagree. ${rfiCanary}`,
      priority: PRIORITIES[i % PRIORITIES.length],
      discipline,
      specSection,
      status: 'open',
      managerUserId: user.pm,
      assigneeUserIds: [user.planner],
      distributionUserIds: [user.qs],
      activityId,
      ...(i % 3 === 0 ? { activityLinks: [{ activityId, relationType: 'impacted', scheduleImpactDays: 2, notes: rfiCanary }] } : {}),
      locationId: location.id,
      costImpact: i % 2 === 0,
      ...(i % 2 === 0 ? { costImpactAmount: 1500 + i * 250 } : {}),
      scheduleImpactFlag: i % 3 === 0,
      raisedDate: ctx.daysAgo(flow === 'overdue' ? 20 : 6),
      dueDate: flow === 'overdue' ? ctx.daysAgo(5) : ctx.daysAhead(7 + i),
      responseRequiredBy: flow === 'overdue' ? ctx.daysAgo(5) : ctx.daysAhead(7 + i),
      comment: `Raised from site — ${rfiCanary}`,
    };
    let rfi = null;
    let kept = flow;
    if (flow === 'draft') {
      // routes/rfi.js offers "draft" on create, but the approval-workflow table has no rule from
      // nothing to draft. Asked as a probe: a refusal is a product finding, and the RFI is then
      // raised open with nobody asked yet. Anything else than that refusal fails the run.
      const probe = await raiser.send('POST', `${P}/rfi`, { ...asked, status: 'draft' });
      if (probe.status >= 200 && probe.status < 300 && probe.body?.data?.id) {
        rfi = probe.body.data;
      } else if (probe.status === 409 && probe.body?.error?.code === 'APPROVAL_WORKFLOW_INVALID_TRANSITION') {
        ctx.note(`product: POST /rfi with status "draft" (offered by its validator) is refused 409 ${probe.body.error.code}; raised open with nobody asked instead`);
        kept = 'unassigned';
        const { managerUserId, assigneeUserIds, distributionUserIds, ...bare } = asked;
        rfi = await raiser.POST(`${P}/rfi`, bare);
      } else {
        throw new Error(`documents: POST ${P}/rfi (draft) -> ${probe.status} ${JSON.stringify(probe.body?.error || probe.text).slice(0, 300)}`);
      }
    } else {
      rfi = await raiser.POST(`${P}/rfi`, asked);
    }
    ctx.record('rfi', required(rfi?.id, 'an RFI'));
    keep(made.rfis, kept, rfi.id);

    if (i < 2) {
      const fileCanary = canary('rfi-file');
      await attach(raiser, 'rfi', rfi.id, i ? pngFile(fileCanary) : pdfFile(fileCanary, `Sketch for ${topic}`), { caption: `Marked-up sketch — ${fileCanary}` });
    }
    if (i === 0) {
      const fileCanary = canary('rfi-revision');
      await uploadRevision(raiser, 'rfi', rfi.id, 'Q1', pdfFile(fileCanary, `Question sheet for ${topic}`), { title: `Question sheet — ${fileCanary}`, notes: fileCanary, folderPath: '/RFI/Structure', category: 'RFI' });
    }

    const answer = (how) =>
      how === 'response'
        ? planner.POST(`${R(rfi.id)}/responses`, { body: `Proceed as the specification states; the drawing will be revised. ${rfiCanary}`, isOfficial: true })
        : planner.POST(`${R(rfi.id)}/answer`, { response: `Proceed as the specification states; the drawing will be revised. ${rfiCanary}`, answeredDate: ctx.today, comment: rfiCanary });

    if (flow === 'closed') {
      // Approving the answer is what closes an RFI.
      await answer('answer');
      await pm.POST(`${R(rfi.id)}/approve`, { comment: `Answer accepted — ${rfiCanary}` });
      const bytes = await pm.download(`${R(rfi.id)}/export.pdf`);
      if (!bytes?.length) throw new Error(`documents: the PDF export of RFI ${rfi.id} came back empty`);
    } else if (flow === 'open') {
      const first = await planner.POST(`${R(rfi.id)}/responses`, { body: `Checking with the design team. ${rfiCanary}` });
      const second = await raiser.POST(`${R(rfi.id)}/responses`, { body: `Site needs this before the pour. ${rfiCanary}` });
      const responses = second?.responses || first?.responses || [];
      const mine = responses.find((r) => String(r.body || '').startsWith('Checking with the design team')) || responses[0];
      if (!mine?.id) throw new Error(`documents: the discussion on RFI ${rfi.id} answered without its responses`);
      await planner.PATCH(`${R(rfi.id)}/responses/${mine.id}`, { body: `Checking with the design team; answer expected this week. ${rfiCanary}` });
      // The ball moves to whoever is asked next.
      await pm.PUT(`${R(rfi.id)}/people`, { managerUserId: user.pm, assigneeUserIds: [user.quality, user.planner], distributionUserIds: [user.qs, user.site] });
    } else if (flow === 'answered') {
      // Answered in the thread; the manager then makes that reply the official answer.
      const thread = await planner.POST(`${R(rfi.id)}/responses`, { body: `Proceed as the specification states; the drawing will be revised. ${rfiCanary}` });
      const reply = (thread?.responses || []).slice(-1)[0];
      if (!reply?.id) throw new Error(`documents: the reply on RFI ${rfi.id} answered without its responses`);
      await pm.POST(`${R(rfi.id)}/responses/${reply.id}/official`, {});
    } else if (flow === 'draft') {
      // Still being written (or, where the draft was refused, open with nobody asked).
      await raiser.PATCH(`${R(rfi.id)}`, { question: `Still being written; nobody has been asked yet. ${rfiCanary}`, comment: rfiCanary });
    } else if (flow === 'rejected') {
      await answer('response');
      await pm.POST(`${R(rfi.id)}/reject`, { reason: `The answer does not address the question — ${rfiCanary}` });
    } else if (flow === 'overdue') {
      await raiser.POST(`${R(rfi.id)}/submit`, { comment: `Sent again, the answer is late — ${rfiCanary}` });
    } else if (flow === 'reopened') {
      await answer('answer');
      await pm.POST(`${R(rfi.id)}/close`, { comment: `Closed — ${rfiCanary}` });
      await pm.POST(`${R(rfi.id)}/reopen`, { reason: `Site found the same clash on the next bay — ${rfiCanary}` });
    } else if (flow === 'converted') {
      await answer('answer');
      const converted = await qs.POST(`${R(rfi.id)}/convert-to-change`, { description: `Variation from the RFI answer — ${rfiCanary}`, category: 'rfi', value: 1500 + i * 250 });
      const changeOrderId = required(converted?.changeOrder?.id, `converting RFI ${rfi.id} to a change order`);
      ctx.record('change_order', changeOrderId);
      made.rfiChangeOrders = [...(made.rfiChangeOrders || []), changeOrderId];
    } else if (flow === 'archived') {
      await pm.DELETE(`${R(rfi.id)}`);
    }

    // Every reply in the thread, the official answer included, is a row of its own (an archived RFI has none).
    if (flow !== 'archived') for (const response of listOf(await raiser.GET(`${R(rfi.id)}/responses`))) ctx.record('rfi_response', response.id);
  }

  // ── submittals: workflow templates, then the submittals and their packages ──
  const templateCanary = canary('submittal-template');
  const template = await planner.POST(`${P}/submittals/workflow-templates`, {
    name: `Technical then PM review r${runNo} ${templateCanary}`.slice(0, 120),
    description: `Two steps: technical check, then the project manager — ${templateCanary}`,
    isDefault: false,
    steps: [
      { name: `Technical check ${templateCanary}`, mode: 'sequential', days: 5, assignees: [{ type: 'user', userId: user.qs }] },
      { name: `Project manager ${templateCanary}`, mode: 'sequential', days: 3, assignees: [{ type: 'user', userId: user.pm }] },
    ],
  });
  ctx.record('submittal_workflow_template', required(template?.id, 'a submittal workflow template'));
  made.templates.push(template.id);
  await planner.PATCH(`${P}/submittals/workflow-templates/${template.id}`, { description: `Technical check, then the project manager (edited) — ${templateCanary}` });
  {
    // A second template, archived: the list keeps it under includeArchived.
    const spareCanary = canary('submittal-template');
    const spare = await planner.POST(`${P}/submittals/workflow-templates`, { name: `Single review r${runNo} ${spareCanary}`.slice(0, 120), description: spareCanary, steps: [{ name: `Review ${spareCanary}`, mode: 'parallel', days: 7, assignees: [{ type: 'role', role: 'pm' }, { type: 'user', userId: user.planner }] }] });
    ctx.record('submittal_workflow_template', required(spare?.id, 'the spare submittal template'));
    made.templates.push(spare.id);
    await planner.DELETE(`${P}/submittals/workflow-templates/${spare.id}`);
  }

  const S = (id) => `${P}/submittals/${id}`;
  const newSubmittal = async (i, raiser, extra = {}) => {
    const [topic, discipline, specRef] = SUBMITTAL_TOPICS[i % SUBMITTAL_TOPICS.length];
    const subCanary = canary('submittal');
    const row = await raiser.POST(`${P}/submittals`, {
      title: `${topic} — ${subCanary}`,
      specRef,
      discipline,
      activityId: activityAt(i + 1),
      managerUserId: user.pm,
      distributionUserIds: [user.qs],
      leadTimeWeeks: 2 + (i % 4),
      reviewDays: 7,
      requiredOnSite: ctx.daysAhead(45 + i * 3),
      dueDate: ctx.daysAhead(10 + i),
      comment: `For approval — ${subCanary}`,
      ...extra,
    });
    ctx.record('submittal', required(row?.id, 'a submittal'));
    return { id: row.id, canary: subCanary, topic };
  };

  const submittalCount = SUBMITTAL_FLOWS.length + ctx.count(0, 1);
  for (let i = 0; i < submittalCount; i += 1) {
    const flow = SUBMITTAL_FLOWS[i % SUBMITTAL_FLOWS.length];
    const raiser = i % 2 ? quality : site;
    const stepped = flow === 'step_approved' || flow === 'step_rejected';
    const sub = await newSubmittal(i, raiser, stepped ? { workflowTemplateId: template.id } : {});
    keep(made.submittals, flow, sub.id);
    const subCanary = sub.canary;

    // The submission itself: a revision file, and on some an attachment as well.
    const fileCanary = canary('submittal-revision');
    const rev0 = await uploadRevision(raiser, 'submittal', sub.id, '0', pdfFile(fileCanary, `${sub.topic} rev 0`), { title: `${sub.topic} rev 0 — ${fileCanary}`, notes: fileCanary, folderPath: '/Submittals/Materials', category: 'Submittals' });
    made.revisions[`submittal:${flow}:0`] = rev0.id;
    if (i % 2 === 0) {
      const attCanary = canary('submittal-file');
      await attach(raiser, 'submittal', sub.id, i % 4 === 0 ? textFile(attCanary, 'Covering note') : pngFile(attCanary), { caption: `Covering note — ${attCanary}` });
    }
    if (flow === 'pending') continue;
    if (flow === 'archived') {
      await pm.DELETE(S(sub.id));
      continue;
    }

    await raiser.POST(`${S(sub.id)}/submit`, { comment: `Submitted for review — ${subCanary}` });
    if (flow === 'approved') {
      await qs.POST(`${S(sub.id)}/review`, { comment: `Checked against the specification — ${subCanary}` });
      await pm.POST(`${S(sub.id)}/approve`, { comment: `Approved — ${subCanary}` });
    } else if (flow === 'rejected') {
      await pm.POST(`${S(sub.id)}/reject`, { reason: `Wrong grade certified; resubmit — ${subCanary}` });
    } else if (flow === 'resubmitted') {
      await pm.POST(`${S(sub.id)}/reject`, { reason: `Certificate out of date — ${subCanary}` });
      const secondCanary = canary('submittal-revision');
      const rev1 = await uploadRevision(raiser, 'submittal', sub.id, '1', pdfFile(secondCanary, `${sub.topic} rev 1`), { title: `${sub.topic} rev 1 — ${secondCanary}`, notes: secondCanary });
      made.revisions[`submittal:${flow}:1`] = rev1.id;
      await raiser.POST(`${S(sub.id)}/resubmit`, { reason: `Current certificate attached — ${subCanary}` });
      await qs.POST(`${S(sub.id)}/review`, { comment: `Rev 1 checked — ${subCanary}` });
      await pm.POST(`${S(sub.id)}/approve`, { comment: `Rev 1 approved — ${subCanary}` });
    } else if (flow === 'sent_back') {
      await pm.POST(`${S(sub.id)}/resubmit`, { reason: `Add the test report and send again — ${subCanary}` });
    } else if (flow === 'step_approved') {
      await qs.POST(`${S(sub.id)}/decide`, { decision: 'approve', responseCode: 'approved_as_noted', comment: `Technically acceptable, see notes — ${subCanary}` });
      await pm.POST(`${S(sub.id)}/decide`, { decision: 'approve', responseCode: 'approved', comment: `Approved — ${subCanary}` });
    } else if (flow === 'step_rejected') {
      await qs.POST(`${S(sub.id)}/decide`, { decision: 'reject', responseCode: 'revise_resubmit', comment: `Dimensions missing; revise and resubmit — ${subCanary}` });
    } else if (flow === 'under_review') {
      await pm.PUT(`${S(sub.id)}/people`, { managerUserId: user.pm, distributionUserIds: [user.qs, user.site] });
    }
  }

  /** A package answer lists what happened to each member; a member that failed is a failure of the step. */
  const membersDone = (label, answer, key) => {
    const results = answer?.results;
    if (!Array.isArray(results)) throw new Error(`documents: ${label} answered without its per-member results`);
    for (const row of results) {
      if (row[key] === false) throw new Error(`documents: ${label}: member ${row.ref || row.submittalId} was not ${key}: ${row.error || 'no reason given'}`);
      if (row.skipped) ctx.note(`${label}: member ${row.ref || row.submittalId} skipped (${row.reason})`);
    }
    return results;
  };

  const packageCount = 2;
  for (let p = 0; p < packageCount; p += 1) {
    const packCanary = canary('submittal-package');
    const members = [];
    for (let k = 0; k < 2; k += 1) members.push(await newSubmittal(p * 3 + k + 2, site, p === 0 ? { workflowTemplateId: template.id } : {}));
    const pack = await site.POST(`${P}/submittals/packages`, {
      name: `Package ${p + 1} r${runNo} ${packCanary}`,
      description: `Submitted together — ${packCanary}`,
      activityId: activityAt(p + 3),
      requiredOnSite: ctx.daysAhead(50),
      managerUserId: user.pm,
      submittalIds: [members[0].id],
    });
    ctx.record('submittal_package', required(pack?.id, 'a submittal package'));
    made.packages.push(pack.id);
    await site.POST(`${P}/submittals/packages/${pack.id}/items`, { submittalIds: [members[1].id] });
    await site.PATCH(`${P}/submittals/packages/${pack.id}`, { description: `Submitted together (edited) — ${packCanary}` });
    if (p === 0) {
      // Submitted as one, and the first step decided for every member at once.
      membersDone('package submit', await site.POST(`${P}/submittals/packages/${pack.id}/submit`, { comment: `Package submitted — ${packCanary}` }), 'submitted');
      membersDone('package decide', await qs.POST(`${P}/submittals/packages/${pack.id}/decide`, { decision: 'approve', responseCode: 'approved', comment: `Package checked — ${packCanary}` }), 'decided');
    } else {
      // Left open; one member taken out again.
      await site.DELETE(`${P}/submittals/packages/${pack.id}/items/${members[1].id}`);
    }
  }

  // ── drawings: the register and its revisions ──────────────────────────────
  const D = `${P}/doc-control`;
  const drawingCount = DRAWING_TITLES.length + ctx.count(0, 1);
  for (let i = 0; i < drawingCount; i += 1) {
    const [letter, title, flow] = DRAWING_TITLES[i % DRAWING_TITLES.length];
    const drawingCanary = canary('drawing');
    const number = `${letter}-${101 + i}-R${runNo}`;
    const drawing = await planner.POST(`${P}/drawings`, {
      drawingNumber: number,
      title: `${title} — ${drawingCanary}`,
      status: 'active',
      activityId: activityAt(i + 2),
      activityIds: [activityAt(i + 2)],
      issueDate: ctx.daysAgo(30 - i),
      comment: `Registered — ${drawingCanary}`,
    });
    ctx.record('drawing_record', required(drawing?.id, 'a drawing'));
    keep(made.drawings, flow, drawing.id);

    const revision = async (label, who = site) => {
      const fileCanary = canary('drawing-revision');
      const row = await uploadRevision(who, 'drawing', drawing.id, label, pdfFile(fileCanary, `${number} rev ${label}`, [title]), {
        title: `${title} rev ${label} — ${fileCanary}`,
        notes: `Rev ${label} — ${fileCanary}`,
        documentNumber: number,
        discipline: { S: 'structural', A: 'architectural', M: 'mechanical', C: 'civil', E: 'electrical' }[letter],
        folderPath: `/Drawings/${letter}`,
        category: 'Drawings',
      });
      made.revisions[`drawing:${flow}:${label}`] = row.id;
      return row;
    };
    const review = (row, who = site) => who.POST(`${D}/revisions/${row.id}/submit-review`, { comment: `For review — ${drawingCanary}`, reviewDueAt: ctx.daysAhead(5) });
    const approve = (row) => pm.POST(`${D}/revisions/${row.id}/approve`, { comment: `Approved for construction — ${drawingCanary}` });

    if (flow === 'issued') {
      const a = await revision('A');
      await review(a);
      await approve(a);
      const b = await revision('B');
      await review(b);
      await approve(b);
      await revision('C');
      const fileCanary = canary('drawing-file');
      await attach(planner, 'drawing', drawing.id, textFile(fileCanary, `Issue note for ${number}`), { caption: `Issue note — ${fileCanary}` });
      const bytes = await pm.download(`${D}/revisions/${b.id}/download`);
      if (!bytes.includes(Buffer.from(ctx.project.canary))) throw new Error(`documents: revision ${b.id} downloaded without its canary`);
      await pm.download(`${D}/revisions/${b.id}/preview`);
    } else if (flow === 'in_review') {
      await review(await revision('A', planner), planner);
    } else if (flow === 'superseded') {
      const a = await revision('A');
      await review(a);
      await approve(a);
      await pm.POST(`${D}/revisions/${a.id}/supersede`, { reason: `Replaced by the coordinated set — ${drawingCanary}` });
      await planner.PATCH(`${P}/drawings/${drawing.id}`, { status: 'superseded', comment: `Superseded — ${drawingCanary}` });
    } else if (flow === 'cancelled') {
      // A revision that points at a file already on the project (the JSON route), then the drawing is cancelled.
      const fileCanary = canary('drawing-file');
      const filed = await attach(planner, 'drawing', drawing.id, pdfFile(fileCanary, `${number} preliminary`), { caption: `Preliminary — ${fileCanary}`, role: 'reference' });
      const linked = await planner.POST(`${D}/drawing/${drawing.id}/revisions`, { revision: 'P1', projectDocumentId: required(filed.documentId, 'the preliminary drawing file'), title: `${title} rev P1 — ${fileCanary}`, notes: fileCanary, status: 'submitted', folderPath: '/Drawings/Preliminary', category: 'Drawings' });
      once('document_revision', required(linked?.id, `revision P1 of drawing ${drawing.id}`));
      made.revisions[`drawing:${flow}:P1`] = linked.id;
      await planner.PATCH(`${P}/drawings/${drawing.id}`, { status: 'cancelled', comment: `Scope removed — ${drawingCanary}` });
    } else {
      await revision('A');
    }
  }

  // ── drawing sets: uploaded; processing is the worker's ────────────────────
  const setCount = ctx.count(1, 2);
  for (let i = 0; i < setCount; i += 1) {
    const setCanary = canary('drawing-set');
    // Sheet numbers carry the run and the set, so a set published by a later run lands on sheets of its own.
    const sheetNo = (n) => `S-${runNo * 100 + (i + 1) * 10 + n}`;
    const body = pdf([
      [`${sheetNo(1)} FOUNDATION PLAN`, 'Rev A', setCanary, 'Scale 1:100'],
      [`${sheetNo(2)} COLUMN SCHEDULE`, 'Rev A', setCanary, 'Scale 1:50'],
    ]);
    const set = await planner.upload('POST', `${P}/drawings/sets`, {
      field: 'file',
      filename: `${setCanary}.pdf`,
      contentType: 'application/pdf',
      body,
      fields: { name: `Structural set ${i + 1} r${runNo} ${setCanary}`, discipline: 'structural', purpose: i ? 'SHOP' : 'IFC', description: `Issued for construction — ${setCanary}`, receivedAt: ctx.daysAgo(3), issuedAt: ctx.daysAgo(4) },
    });
    ctx.record('drawing_set', required(set?.id, 'a drawing set'));
    made.sets.push(set.id);
    keepDocument(set.sourceDocumentId || set.sourceDocument?.id);
    await planner.PATCH(`${P}/drawings/sets/${set.id}`, { description: `Issued for construction (edited) — ${setCanary}` });
    const fileCanary = canary('drawing-set-file');
    await attach(planner, 'drawing_set', set.id, textFile(fileCanary, 'Set cover sheet'), { caption: `Cover sheet — ${fileCanary}` });
    const after = await planner.GET(`${P}/drawings/sets/${set.id}`);
    if (i === 0 && ['review', 'published'].includes(after?.status)) {
      // Only where something processed the set: name the pages and publish.
      const pages = after.revisions || [];
      if (after.status === 'review') {
        await planner.PATCH(`${P}/drawings/sets/${set.id}/revisions`, { updates: pages.map((page, n) => ({ id: page.id, number: page.number || sheetNo(n + 1), title: page.title || `Sheet ${n + 1} ${setCanary}`.slice(0, 200), revision: page.revision || 'A' })) });
        await planner.POST(`${P}/drawings/sets/${set.id}/publish`, {});
      }
      for (const page of pages) ctx.record('sheet_revision', page.id);
    } else if (i === 0) {
      ctx.note(`drawing set ${set.id} is ${after?.status || set.status}: publishing waits for the job worker`);
    }
  }

  // Sheets exist only where this run's set was processed and published; earlier runs' sheets are not touched.
  const sheets = [];
  for (const setId of made.sets) sheets.push(...listOf(await planner.GET(`${P}/drawings/sheets?status=all&setId=${setId}`)));
  if (!sheets.length) {
    ctx.note("no sheets from this run's drawing sets (the sets were not processed): sheet revisions, markups and pins were not made");
  } else {
    for (const sheet of sheets) ctx.record('sheet', sheet.id);
    const sheet = sheets[0];
    const sheetCanary = canary('sheet');
    const added = await planner.upload('POST', `${P}/drawings/sheets/${sheet.id}/revisions`, { field: 'file', ...pdfFile(sheetCanary, `${sheet.number} revised`), fields: { revision: `R${runNo}`, title: `${sheet.title || sheet.number} ${sheetCanary}`.slice(0, 200) } });
    ctx.record('sheet_revision', required(added?.revision?.id || added?.id, `a revision of sheet ${sheet.id}`));
    // The markup is the site engineer's own layer; only its author may publish it.
    const markup = await site.PUT(`${P}/drawings/sheets/${sheet.id}/markups/mine`, { name: `Site notes ${sheetCanary}`.slice(0, 120), shapes: [{ type: 'text', x: 0.3, y: 0.4, text: sheetCanary }, { type: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.1 }] });
    const markupId = required(markup?.id || markup?.markup?.id, `the markup on sheet ${sheet.id}`);
    ctx.record('markup', markupId);
    await site.POST(`${P}/drawings/sheets/${sheet.id}/markups/${markupId}/publish`, { name: `Published notes ${sheetCanary}`.slice(0, 120) });
    const pinTarget = made.rfis.open || made.rfis.closed;
    const pin = await site.POST(`${P}/drawings/sheets/${sheet.id}/pins`, { x: 0.42, y: 0.37, recordType: 'rfi', recordId: pinTarget, label: sheetCanary.slice(-40) });
    ctx.record('pin', required(pin?.id || pin?.pin?.id, `the pin on sheet ${sheet.id}`));
  }

  // ── a file put in the workflow store first, cited afterwards by its key ───
  const receiptCanary = canary('workflow-file');
  const stored = await site.upload('POST', `${P}/workflow/uploads`, { field: 'files', ...textFile(receiptCanary, 'Courier receipt') });
  const receipt = (Array.isArray(stored) ? stored : stored?.items || [])[0] || null;
  keepDocument(required(receipt?.documentId, 'the workflow upload'));
  const receiptBytes = await site.download(`${P}/workflow/uploads/${receipt.key || receipt.documentId}`);
  if (!receiptBytes.includes(Buffer.from(receiptCanary))) throw new Error('documents: the workflow upload came back without its canary');

  // ── transmittals ──────────────────────────────────────────────────────────
  const transmittalCount = ctx.count(2, TRANSMITTAL_SUBJECTS.length);
  for (let i = 0; i < transmittalCount; i += 1) {
    const trmCanary = canary('transmittal');
    const acknowledged = i % 2 === 1;
    const row = await planner.POST(`${P}/transmittals`, {
      subject: `${TRANSMITTAL_SUBJECTS[i % TRANSMITTAL_SUBJECTS.length]} — ${trmCanary}`,
      sender: `${ctx.company.canary} site office`,
      recipient: party(i % 2 ? 'consultant' : 'client'),
      method: TRANSMITTAL_METHODS[i % TRANSMITTAL_METHODS.length],
      status: 'pending_ack',
      transmittedOn: ctx.daysAgo(10 - i),
      dueDate: ctx.daysAhead(4 + i),
      activityIds: [activityAt(i + 4)],
      comment: `Issued — ${trmCanary}`,
      ...(i === 1 ? { attachmentRefs: [{ fileName: receipt.fileName, storageKey: receipt.storageKey || receipt.key, mimeType: receipt.mimeType, sizeBytes: receipt.sizeBytes, description: `Courier receipt — ${receiptCanary}` }] } : {}),
    });
    ctx.record('transmittal', required(row?.id, 'a transmittal'));
    keep(made.transmittals, acknowledged ? 'acknowledged' : 'pending_ack', row.id);
    if (i === 0) {
      // Filed as an attachment, then made a revision of the transmittal by its document id and sent for review.
      const fileCanary = canary('transmittal-file');
      const filed = await attach(planner, 'transmittal', row.id, pdfFile(fileCanary, 'Transmittal cover sheet'), { caption: `Cover sheet — ${fileCanary}` });
      const rev = await planner.POST(`${D}/transmittal/${row.id}/revisions`, { revision: 'A', projectDocumentId: required(filed.documentId, 'the transmittal cover sheet'), title: `Transmittal cover sheet — ${fileCanary}`, fileName: `${fileCanary}.pdf`, notes: fileCanary, status: 'submitted', folderPath: '/Transmittals/Client', category: 'Transmittals' });
      once('document_revision', required(rev?.id, `revision A of transmittal ${row.id}`));
      made.revisions['transmittal:A:submitted'] = rev.id;
    }
    if (i === 1) {
      const fileCanary = canary('transmittal-revision');
      const rev = await uploadRevision(planner, 'transmittal', row.id, 'A', textFile(fileCanary, 'Delivery note'), { title: `Delivery note — ${fileCanary}`, notes: fileCanary });
      made.revisions['transmittal:A:uploaded'] = rev.id;
    }
    if (acknowledged) await pm.PATCH(`${P}/transmittals/${row.id}`, { status: 'acknowledged', acknowledgedOn: ctx.daysAgo(1), comment: `Acknowledged by the recipient — ${trmCanary}` });
  }

  // ── correspondence ────────────────────────────────────────────────────────
  const letterCount = ctx.count(4, LETTERS.length);
  let filedLetter = null;
  for (let i = 0; i < letterCount; i += 1) {
    const [direction, type, subject] = LETTERS[i % LETTERS.length];
    const corCanary = canary('correspondence');
    const closing = i % 3 === 1;
    const row = await (i % 2 ? site : pm).POST(`${P}/correspondence`, {
      direction,
      type,
      subject: `${subject} — ${corCanary}`,
      date: ctx.daysAgo(12 - i),
      responseRequiredBy: ctx.daysAhead(i % 2 ? 3 : -2),
      status: 'open',
      activityId: activityAt(i + 5),
      comment: `${direction === 'incoming' ? 'Received from' : 'Sent to'} ${party(i % 2 ? 'consultant' : 'client')} — ${corCanary}`,
    });
    ctx.record('correspondence', required(row?.id, 'a letter'));
    keep(made.correspondence, `${closing ? 'closed' : 'open'}_${direction}_${type}`, row.id);
    if (i === 0) {
      const fileCanary = canary('correspondence-file');
      filedLetter = await attach(pm, 'correspondence', row.id, pdfFile(fileCanary, subject, [`To: ${party('client')}`]), { caption: `Signed letter — ${fileCanary}`, role: 'signature' });
    } else if (i === 1) {
      // The same file filed on a second record: linked by its document id, not uploaded again.
      const link = await pm.upload('POST', `${P}/attachments`, { fields: { recordType: 'correspondence', recordId: row.id, documentIds: [required(filedLetter?.documentId, 'the signed letter')], caption: `See also — ${corCanary}` } });
      const items = link?.items || [];
      if (!items.length) throw new Error(`documents: linking document ${filedLetter.documentId} to letter ${row.id} answered without an attachment`);
      for (const item of items) once('attachment', item.id);
    }
    if (closing) await pm.PATCH(`${P}/correspondence/${row.id}`, { status: 'closed', responseDate: ctx.today, comment: `Answered and closed — ${corCanary}` });
  }

  // ── the specification ─────────────────────────────────────────────────────
  const specCanary = canary('specification');
  const spec = await attach(pm, 'project', ctx.project.id, { filename: `${specCanary}.pdf`, contentType: 'application/pdf', body: pdf(SPEC_PAGES(specCanary)) }, { caption: `Project specification — ${specCanary}`, role: 'reference' });
  required(spec.documentId, 'the specification');
  const queued = await planner.POST(`${P}/documents/${spec.documentId}/extract`, {});
  // Indexing reads the extracted text, which the job worker writes: without it the index answers per document.
  const indexed = await planner.POST(`${P}/specifications/index`, { documentIds: [spec.documentId] });
  if (!indexed?.sections) ctx.note(`specification ${spec.documentId} not indexed (${indexed?.documents?.[0]?.error || 'no sections'}); extraction ${queued?.status || 'not queued'} — sections need the job worker`);
  // Only this run's specification: earlier runs' sections are theirs.
  const sections = listOf(await site.GET(`${P}/specifications?documentId=${spec.documentId}`));
  for (const section of sections) ctx.record('spec_section', section.id);
  if (sections[0]?.id) {
    await site.GET(`${P}/specifications/${sections[0].id}`);
    const sectionCanary = canary('rfi');
    // raiseRfi asks createRfi for a draft, which the workflow table refuses (the same finding as above).
    const raised = await optional('rfi from a specification section', () => site.POST(`${P}/specifications/${sections[0].id}/rfi`, { subject: `Clarify section ${sections[0].code || ''} — ${sectionCanary}`.slice(0, 200), question: `The section and the drawings disagree. ${sectionCanary}`, priority: 'normal' }));
    const raisedId = raised?.record?.id || raised?.rfi?.id || raised?.id;
    if (raisedId) ctx.record('rfi', raisedId);
  }
  await site.GET(`${P}/specifications/status`);
  await site.GET(`${P}/specifications/documents`);
  await planner.GET(`${P}/specifications/scope-gaps`);

  // ── reading it all back: lists, register, searches ────────────────────────
  const mark = ctx.project.canary;
  const need = (label, rows, ids) => {
    const have = new Set(rows.map((row) => row.recordId || row.id));
    const missing = ids.filter((id) => id && !have.has(id));
    if (missing.length) throw new Error(`documents: ${label} does not list ${missing.length} of this run's records (${missing[0]})`);
  };
  // An archived record leaves the lists; a draft is its author's alone.
  const live = (group) => Object.entries(group).filter(([flow]) => !flow.startsWith('archived') && !flow.startsWith('draft')).map(([, id]) => id);

  const rfiList = listOf(await pm.GET(`${P}/rfi?limit=100&sortBy=created&sortDir=desc`));
  need('the RFI list', rfiList, live(made.rfis));
  const submittalList = listOf(await pm.GET(`${P}/submittals?limit=100&sortBy=created&sortDir=desc`));
  need('the submittal list', submittalList, live(made.submittals));
  const drawingList = listOf(await site.GET(`${P}/drawings`));
  need('the drawing list', drawingList, Object.values(made.drawings));
  const transmittalList = listOf(await qs.GET(`${P}/transmittals`));
  need('the transmittal list', transmittalList, Object.values(made.transmittals));
  const letterList = listOf(await qs.GET(`${P}/correspondence`));
  need('the correspondence list', letterList, Object.values(made.correspondence));
  need('the drawing set list', listOf(await site.GET(`${P}/drawings/sets`)), made.sets);
  const packageList = listOf(await qs.GET(`${P}/submittals/packages`));
  need('the package list', packageList, made.packages);
  need('the template list', listOf(await qs.GET(`${P}/submittals/workflow-templates?scope=project&includeArchived=true`)), made.templates);

  const register = listOf(await pm.GET(`${D}/register?search=${encodeURIComponent(mark.toLowerCase())}`));
  need('the document register (searched by canary)', register, [...live(made.rfis), ...live(made.submittals), ...Object.values(made.drawings), ...Object.values(made.transmittals), ...Object.values(made.correspondence)]);
  // The register also lists rows no earlier answer named: the revision each record is given when it
  // is made (no file), and the workflow attachment a revision upload files on its record (as does the
  // receipt a transmittal cites). A file attached through /attachments carries attachmentId and is
  // already recorded as an attachment.
  const ours = new Set([...Object.values(made.rfis), ...Object.values(made.submittals), ...Object.values(made.drawings), ...Object.values(made.transmittals), ...Object.values(made.correspondence)]);
  for (const row of register) {
    if (!ours.has(row.recordId)) continue;
    for (const rev of row.revisions || []) if (rev.id) once('document_revision', rev.id);
    for (const file of row.attachments || []) if (file.id && !file.attachmentId) once('workflow_attachment', file.id);
  }

  // ── the states, read back: every record is where its flow left it ─────────
  const drift = [];
  for (const [key, id] of Object.entries(made.rfis)) {
    const flow = flowOf(key);
    const row = await pm.GET(`${P}/rfi/${id}`);
    if (row.status !== RFI_STATE[flow]) drift.push(`RFI ${row.ref} (${key}) is ${row.status}, expected ${RFI_STATE[flow]}`);
    if (flow === 'overdue' && !row.isOverdue) drift.push(`RFI ${row.ref} (${key}) is not overdue`);
    if (flow === 'converted' && !row.changeOrderId) drift.push(`RFI ${row.ref} (${key}) has no change order`);
  }
  for (const [key, id] of Object.entries(made.submittals)) {
    const [status, code] = SUBMITTAL_STATE[flowOf(key)];
    const row = await pm.GET(`${S(id)}`);
    if (row.status !== status) drift.push(`submittal ${row.ref} (${key}) is ${row.status}, expected ${status}`);
    else if ((row.responseCode || null) !== code) drift.push(`product: submittal ${row.ref} (${key}) is ${row.status} with response code ${row.responseCode}, expected ${code}`);
  }
  for (const [n, id] of made.packages.entries()) {
    const row = packageList.find((p) => p.id === id) || (await qs.GET(`${P}/submittals/packages/${id}`));
    const want = n === 0 ? 'submitted' : 'open';
    if (row.status !== want) drift.push(`package ${row.ref} is ${row.status}, expected ${want}`);
  }
  for (const [key, id] of Object.entries(made.drawings)) {
    const [status, label, revStatus] = DRAWING_STATE[flowOf(key)];
    const row = drawingList.find((d) => d.id === id);
    if (row?.status !== status) drift.push(`drawing ${row?.drawingNumber} (${key}) is ${row?.status}, expected ${status}`);
    if (!label) continue;
    const entry = register.find((r) => r.recordId === id);
    const latest = (entry?.revisions || []).filter((r) => r.revision === label).sort((a, b) => Number(b.isLatest) - Number(a.isLatest))[0];
    if (latest?.status !== revStatus) drift.push(`drawing ${row?.drawingNumber} (${key}) revision ${label} is ${latest?.status}, expected ${revStatus}`);
  }
  for (const [key, id] of Object.entries(made.transmittals)) {
    const row = transmittalList.find((t) => t.id === id);
    if (row?.status !== flowOf(key)) drift.push(`transmittal ${row?.ref} is ${row?.status}, expected ${flowOf(key)}`);
  }
  for (const [key, id] of Object.entries(made.correspondence)) {
    const row = letterList.find((c) => c.id === id);
    const want = key.startsWith('closed') ? 'closed' : 'open';
    if (row?.status !== want) drift.push(`letter ${row?.ref} is ${row?.status}, expected ${want}`);
  }
  for (const line of drift) ctx.note(`state: ${line}`.slice(0, 300));

  for (const folder of ['drawings', 'submittals', 'rfi', 'transmittals', 'correspondence']) await qs.GET(`${D}/register?folder=${folder}`);
  await qs.GET(`${D}/register?recordType=drawing&status=approved`);
  await qs.GET(`${D}/dashboard`);
  // An attachment row names the record it hangs on as recordId; it is matched by its own id.
  const onProject = listOf(await pm.GET(`${P}/attachments?recordType=project&recordId=${ctx.project.id}`));
  need('the attachments of the project', onProject.map((row) => ({ id: row.id })), [spec.id]);

  const evidence = await pm.GET(`${P}/attachments/search?q=${encodeURIComponent(mark)}&limit=100`);
  const found = { register: register.length, attachments: listOf(evidence).length };
  const specBytes = await pm.download(`${P}/attachments/documents/${spec.documentId}`);
  if (!specBytes.includes(Buffer.from(specCanary))) throw new Error('documents: the specification came back without its canary');
  const global = await pm.GET(`/search?q=${encodeURIComponent(mark)}&projectId=${ctx.project.id}&limit=50`);
  found.global = listOf(global?.results || global).length;
  const content = await pm.GET(`${P}/documents/search?q=${encodeURIComponent(specCanary)}&limit=50`);
  found.content = listOf(content).length;
  const index = await pm.GET(`${P}/documents/index-status`);
  await pm.GET(`${P}/documents/${spec.documentId}/text`);
  ctx.note(`canary search: register ${found.register}, attachment search ${found.attachments}, global search ${found.global}, content search ${found.content}${found.content ? '' : ` (text index: ${JSON.stringify(index?.counts || index?.byStatus || index || {}).slice(0, 120)})`}`);

  state.last = { run: runNo, ...made, documents: made.documents.slice(0, 20), location: location.id };
};

module.exports = { name: 'documents', needs: ['foundation'], depths: ['standard'], run };
