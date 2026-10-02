'use strict';

/**
 * Documents and design: everything a project files, asks and issues.
 *
 *   attachments     on activities, bill rows, the project, a location and on
 *                   every record made here (PDF, text and PNG; one linked
 *                   to a second record by its document id)
 *   RFIs            raised on an activity with a due date, then left in a mix
 *                   of states: closed, open with a discussion, answered,
 *                   draft, rejected, overdue, reopened, converted to a change
 *                   order, archived — the ball in court moves with each step
 *   submittals      a workflow template, packages, and submittals left
 *                   approved, pending, under review, rejected, resubmitted,
 *                   sent back, decided step by step, archived
 *   drawings        the legacy register with file revisions (uploaded, in
 *                   review, approved, superseded) and drawing sets (a PDF is
 *                   uploaded; processing needs the job worker, so a set stays
 *                   wherever it got to); sheets, markups and pins only where
 *                   a published sheet exists
 *   transmittals    pending acknowledgement and acknowledged
 *   correspondence  letters, e-mails, memos and notices, in and out, open
 *                   and closed
 *   specifications  a specification PDF filed on the project and offered to
 *                   the index (indexing needs extracted text: the worker)
 *   register/search the register, the dashboard, the attachment search, the
 *                   global search and the content search, asked at the end
 *                   for this run's canaries
 *
 * Every file made here carries its canary in its name and in its bytes.
 * Nothing is looked up by a fixed number, so the driver can run again: each
 * run makes a new batch, and the codes it generates carry the run counter.
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
const RFI_FLOWS = ['closed', 'open', 'answered', 'draft', 'rejected', 'overdue', 'reopened', 'converted', 'archived'];
const PRIORITIES = ['normal', 'high', 'urgent', 'low'];

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

const DRAWING_TITLES = [
  ['S', 'Foundation layout, grid A-D', 'issued'],
  ['A', 'Ground floor general arrangement', 'in_review'],
  ['M', 'First fix services coordination', 'superseded'],
  ['C', 'External works and drainage layout', 'cancelled'],
  ['E', 'Lighting and small power layout', 'uploaded'],
];

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
  for (const key of ['items', 'rows', 'records', 'rfis', 'submittals', 'drawings', 'transmittals', 'correspondence', 'sets', 'sheets', 'packages', 'locations']) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
};

/**
 * An interactive transaction that ran past its time limit answers 500 (P2028)
 * and writes nothing. Under a loaded API that is not rare, so such a call is
 * made again — and every time it happens it is written to the notes, because
 * a 500 is a finding, not noise.
 */
const expired = (error) => error?.name === 'ApiError' && error.status >= 500 && /P2028|P2034|transaction/i.test(`${error.code} ${error.serverMessage}`);
const steady = (ctx, session) => {
  const again = (method) => async (...args) => {
    for (let tries = 1; ; tries += 1) {
      try {
        return await session[method](...args);
      } catch (error) {
        if (!expired(error) || tries >= 4) throw error;
        ctx.note(`5xx, asked again (${tries}): ${error.message}`.slice(0, 260));
        await new Promise((resolve) => setTimeout(resolve, 500 * tries));
      }
    }
  };
  return { ...session, GET: again('GET'), POST: again('POST'), PATCH: again('PATCH'), PUT: again('PUT'), DELETE: again('DELETE'), upload: again('upload'), download: again('download') };
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
  const made = { rfis: {}, submittals: {}, drawings: {}, transmittals: {}, correspondence: {}, packages: [], templates: [], sets: [], revisions: {}, documents: [] };
  /** Remembers a record under the state it was left in; a second one in the same state gets a suffix. */
  const keep = (group, name, id) => {
    let key = name;
    for (let n = 2; group[key]; n += 1) key = `${name}_${n}`;
    group[key] = id;
  };

  const activityCodes = Object.keys(ctx.refs.activities || {});
  if (!activityCodes.length) throw new Error('documents: the foundation driver left no activities');
  const activityAt = (i) => ctx.refs.activities[activityCodes[i % activityCodes.length]];
  const boqCodes = Object.keys(ctx.refs.boq || {});
  const party = (kind) => `${ctx.company.canary} ${{ client: 'Property Group', consultant: 'Consulting Engineers', subcontractor: 'Concrete Works', supplier: 'Steel & Cement Supply' }[kind]}`;

  /** Attaches one file to a record; returns the attachment (with its documentId). */
  const attach = async (who, recordType, recordId, file, fields = {}) => {
    const out = await who.upload('POST', `${P}/attachments`, { field: 'files', ...file, fields: { recordType, recordId, ...fields } });
    const item = (out?.items || [])[0];
    if (!item?.id) throw new Error(`documents: attaching to ${recordType} ${recordId} answered without an attachment`);
    ctx.record('attachment', item.id);
    const documentId = item.documentId || item.document?.id;
    if (documentId) {
      ctx.record('project_document', documentId);
      made.documents.push(documentId);
    }
    const photoId = item.photo?.id || item.document?.photo?.id;
    if (photoId) ctx.record('photo', photoId);
    return { ...item, documentId };
  };

  /** Uploads a file as a revision of a document-control record. */
  const uploadRevision = async (who, recordType, recordId, revision, file, fields = {}) => {
    const out = await who.upload('POST', `${P}/doc-control/${recordType}/${recordId}/revisions/upload`, { field: 'file', ...file, fields: { revision, ...fields } });
    const row = out?.revision || out;
    if (!row?.id) throw new Error(`documents: revision ${revision} of ${recordType} ${recordId} answered without an id`);
    ctx.record('document_revision', row.id);
    const documentId = out?.document?.documentId || out?.document?.id || row.projectDocumentId;
    if (documentId) {
      ctx.record('project_document', documentId);
      made.documents.push(documentId);
    }
    return { ...row, documentId };
  };

  // ── a place on the project, for the records that name one ─────────────────
  let location = null;
  const places = await ctx.attempt('locations', () => site.GET(`${P}/locations`));
  const flat = [];
  const walk = (nodes) => {
    for (const node of nodes || []) {
      flat.push(node);
      walk(node.children);
    }
  };
  walk(listOf(places));
  location = flat.find((l) => l.code === 'DOC-GRID-AD') || null;
  if (!location) {
    const canary = ctx.canary('location');
    location = await ctx.attempt('location', () =>
      planner.POST(`${P}/locations`, { name: `Foundation zone grid A-D ${canary}`.slice(0, 120), code: 'DOC-GRID-AD', kind: 'zone', description: `Pad and strip foundations between grids A and D — ${canary}` })
    );
    if (location?.id) ctx.record('location', location.id);
  }
  location = location?.id ? location : flat[0] || null;

  // ── attachments on what foundation left ───────────────────────────────────
  for (let i = 0; i < ctx.count(1, 3); i += 1) {
    const canary = ctx.canary('activity-file');
    const file = i % 3 === 1 ? pngFile(canary) : i % 3 === 2 ? textFile(canary, 'Method statement note') : pdfFile(canary, 'Method statement for the activity');
    await attach(planner, 'activity', activityAt(i * 2), file, { caption: `Method statement — ${canary}`, role: i % 3 === 1 ? 'photo' : 'reference', ...(i % 3 === 1 ? { tags: 'site,progress' } : {}) });
  }
  for (let i = 0; i < Math.min(boqCodes.length, ctx.count(1, 2)); i += 1) {
    const canary = ctx.canary('boq-file');
    await attach(qs, 'boq_item', ctx.refs.boq[boqCodes[(i * 3) % boqCodes.length]], i ? textFile(canary, 'Rate build-up') : pdfFile(canary, 'Measurement sheet'), { caption: `Take-off — ${canary}`, role: 'evidence' });
  }
  if (location?.id) {
    const canary = ctx.canary('location-file');
    await ctx.attempt('attachment on the location', () => attach(site, 'location', location.id, pngFile(canary), { caption: `Zone photo — ${canary}`, locationId: location.id, tags: 'zone' }));
  }

  // ── RFIs ──────────────────────────────────────────────────────────────────
  const rfiCount = ctx.count(4, RFI_FLOWS.length);
  for (let i = 0; i < rfiCount; i += 1) {
    const flow = RFI_FLOWS[i % RFI_FLOWS.length];
    const [topic, discipline, specSection] = RFI_TOPICS[i % RFI_TOPICS.length];
    const canary = ctx.canary('rfi');
    const raiser = i % 2 ? quality : site;
    const activityId = activityAt(i);
    const R = (id) => `${P}/rfi/${id}`;
    const asked = {
      subject: `${topic} — ${canary}`,
      question: `Please confirm: ${topic.toLowerCase()}. The drawings and the specification disagree. ${canary}`,
      priority: PRIORITIES[i % PRIORITIES.length],
      discipline,
      specSection,
      status: 'open',
      managerUserId: user.pm,
      assigneeUserIds: [user.planner],
      distributionUserIds: [user.qs],
      activityId,
      ...(i % 3 === 0 ? { activityLinks: [{ activityId, relationType: 'impacted', scheduleImpactDays: 2, notes: canary }] } : {}),
      ...(location?.id ? { locationId: location.id } : {}),
      costImpact: i % 2 === 0,
      ...(i % 2 === 0 ? { costImpactAmount: 1500 + i * 250 } : {}),
      scheduleImpactFlag: i % 3 === 0,
      raisedDate: ctx.daysAgo(flow === 'overdue' ? 20 : 6),
      dueDate: flow === 'overdue' ? ctx.daysAgo(5) : ctx.daysAhead(7 + i),
      responseRequiredBy: flow === 'overdue' ? ctx.daysAgo(5) : ctx.daysAhead(7 + i),
      comment: `Raised from site — ${canary}`,
    };
    let rfi = null;
    let kept = flow;
    if (flow === 'draft') {
      // The routes offer a draft; where the product refuses one, the RFI is raised open with nobody asked yet.
      rfi = await ctx.attempt('rfi raised as a draft', () => raiser.POST(`${P}/rfi`, { ...asked, status: 'draft' }));
      if (!rfi) {
        kept = 'unassigned';
        const { managerUserId, assigneeUserIds, distributionUserIds, ...bare } = asked;
        rfi = await raiser.POST(`${P}/rfi`, bare);
      }
    } else {
      rfi = await raiser.POST(`${P}/rfi`, asked);
    }
    ctx.record('rfi', rfi.id);
    keep(made.rfis, kept, rfi.id);

    if (i < 2) {
      const fileCanary = ctx.canary('rfi-file');
      await attach(raiser, 'rfi', rfi.id, i ? pngFile(fileCanary) : pdfFile(fileCanary, `Sketch for ${topic}`), { caption: `Marked-up sketch — ${fileCanary}` });
    }
    if (i === 0) {
      const fileCanary = ctx.canary('rfi-revision');
      await uploadRevision(raiser, 'rfi', rfi.id, 'Q1', pdfFile(fileCanary, `Question sheet for ${topic}`), { title: `Question sheet — ${fileCanary}`, notes: fileCanary, folderPath: '/RFI/Structure', category: 'RFI' });
    }

    const answer = (how) =>
      how === 'response'
        ? planner.POST(`${R(rfi.id)}/responses`, { body: `Proceed as the specification states; the drawing will be revised. ${canary}`, isOfficial: true })
        : planner.POST(`${R(rfi.id)}/answer`, { response: `Proceed as the specification states; the drawing will be revised. ${canary}`, answeredDate: ctx.today, comment: canary });

    if (flow === 'closed') {
      // Approving the answer is what closes an RFI.
      await answer('answer');
      await pm.POST(`${R(rfi.id)}/approve`, { comment: `Answer accepted — ${canary}` });
      await ctx.attempt('rfi pdf', () => pm.download(`${R(rfi.id)}/export.pdf`));
    } else if (flow === 'open') {
      const first = await planner.POST(`${R(rfi.id)}/responses`, { body: `Checking with the design team. ${canary}` });
      const second = await raiser.POST(`${R(rfi.id)}/responses`, { body: `Site needs this before the pour. ${canary}` });
      const responses = second?.responses || first?.responses || [];
      if (responses[0]?.id) await ctx.attempt('rfi response edit', () => planner.PATCH(`${R(rfi.id)}/responses/${responses[0].id}`, { body: `Checking with the design team; answer expected this week. ${canary}` }));
      // The ball moves to whoever is asked next.
      await ctx.attempt('rfi people', () => pm.PUT(`${R(rfi.id)}/people`, { managerUserId: user.pm, assigneeUserIds: [user.quality, user.planner], distributionUserIds: [user.qs, user.site] }));
    } else if (flow === 'answered') {
      // Answered in the thread; the manager then makes that reply the official answer.
      const thread = await planner.POST(`${R(rfi.id)}/responses`, { body: `Proceed as the specification states; the drawing will be revised. ${canary}` });
      const reply = (thread?.responses || []).slice(-1)[0];
      if (reply?.id) await pm.POST(`${R(rfi.id)}/responses/${reply.id}/official`, {});
      else await answer('answer');
    } else if (flow === 'draft') {
      await ctx.attempt('rfi edit', () => raiser.PATCH(`${R(rfi.id)}`, { question: `Still being written; nobody has been asked yet. ${canary}`, comment: canary }));
    } else if (flow === 'rejected') {
      await answer('response');
      await pm.POST(`${R(rfi.id)}/reject`, { reason: `The answer does not address the question — ${canary}` });
    } else if (flow === 'overdue') {
      await raiser.POST(`${R(rfi.id)}/submit`, { comment: `Sent again, the answer is late — ${canary}` });
    } else if (flow === 'reopened') {
      await answer('answer');
      await pm.POST(`${R(rfi.id)}/close`, { comment: `Closed — ${canary}` });
      await pm.POST(`${R(rfi.id)}/reopen`, { reason: `Site found the same clash on the next bay — ${canary}` });
    } else if (flow === 'converted') {
      await answer('answer');
      const converted = await ctx.attempt('rfi to change order', () => qs.POST(`${R(rfi.id)}/convert-to-change`, { description: `Variation from the RFI answer — ${canary}`, category: 'rfi', value: 1500 + i * 250 }));
      const changeOrderId = converted?.changeOrder?.id || converted?.id;
      if (changeOrderId) {
        ctx.record('change_order', changeOrderId);
        made.rfiChangeOrder = changeOrderId;
      }
    } else if (flow === 'archived') {
      await ctx.attempt('rfi archive', () => pm.DELETE(`${R(rfi.id)}`));
    }

    // Every reply in the thread, the official answer included, is a row of its own.
    if (flow !== 'archived') {
      const thread = await ctx.attempt('rfi responses', () => raiser.GET(`${R(rfi.id)}/responses`));
      for (const response of listOf(thread)) ctx.record('rfi_response', response.id);
    }
  }

  // ── submittals: a workflow template, then the submittals and their packages ──
  const templateCanary = ctx.canary('submittal-template');
  const template = await planner.POST(`${P}/submittals/workflow-templates`, {
    name: `Technical then PM review r${runNo} ${templateCanary}`.slice(0, 120),
    description: `Two steps: technical check, then the project manager — ${templateCanary}`,
    isDefault: false,
    steps: [
      { name: 'Technical check', mode: 'sequential', days: 5, assignees: [{ type: 'user', userId: user.qs }] },
      { name: 'Project manager', mode: 'sequential', days: 3, assignees: [{ type: 'user', userId: user.pm }] },
    ],
  });
  ctx.record('submittal_workflow_template', template.id);
  made.templates.push(template.id);
  await ctx.attempt('template edit', () => planner.PATCH(`${P}/submittals/workflow-templates/${template.id}`, { description: `Technical check, then the project manager (edited) — ${templateCanary}` }));
  if (ctx.count(0, 1)) {
    const spareCanary = ctx.canary('submittal-template');
    const spare = await ctx.attempt('spare template', () =>
      planner.POST(`${P}/submittals/workflow-templates`, { name: `Single review r${runNo} ${spareCanary}`.slice(0, 120), description: spareCanary, steps: [{ name: 'Review', mode: 'parallel', days: 7, assignees: [{ type: 'role', role: 'pm' }, { type: 'user', userId: user.planner }] }] })
    );
    if (spare?.id) {
      ctx.record('submittal_workflow_template', spare.id);
      made.templates.push(spare.id);
      await ctx.attempt('template archive', () => planner.DELETE(`${P}/submittals/workflow-templates/${spare.id}`));
    }
  }

  const S = (id) => `${P}/submittals/${id}`;
  const newSubmittal = async (i, raiser, extra = {}) => {
    const [topic, discipline, specRef] = SUBMITTAL_TOPICS[i % SUBMITTAL_TOPICS.length];
    const canary = ctx.canary('submittal');
    const row = await raiser.POST(`${P}/submittals`, {
      title: `${topic} — ${canary}`,
      specRef,
      discipline,
      activityId: activityAt(i + 1),
      managerUserId: user.pm,
      distributionUserIds: [user.qs],
      leadTimeWeeks: 2 + (i % 4),
      reviewDays: 7,
      requiredOnSite: ctx.daysAhead(45 + i * 3),
      dueDate: ctx.daysAhead(10 + i),
      comment: `For approval — ${canary}`,
      ...extra,
    });
    ctx.record('submittal', row.id);
    return { id: row.id, canary, topic };
  };

  const submittalCount = ctx.count(4, SUBMITTAL_FLOWS.length);
  for (let i = 0; i < submittalCount; i += 1) {
    const flow = SUBMITTAL_FLOWS[i % SUBMITTAL_FLOWS.length];
    const raiser = i % 2 ? quality : site;
    const stepped = flow === 'step_approved' || flow === 'step_rejected';
    const sub = await newSubmittal(i, raiser, stepped ? { workflowTemplateId: template.id } : {});
    keep(made.submittals, flow, sub.id);
    const { canary } = sub;

    // The submission itself: a revision file, and on some an attachment as well.
    const fileCanary = ctx.canary('submittal-revision');
    const rev0 = await uploadRevision(raiser, 'submittal', sub.id, '0', pdfFile(fileCanary, `${sub.topic} rev 0`), { title: `${sub.topic} rev 0 — ${fileCanary}`, notes: fileCanary, folderPath: '/Submittals/Materials', category: 'Submittals' });
    made.revisions[`submittal:${flow}:0`] = rev0.id;
    if (i % 2 === 0) {
      const attCanary = ctx.canary('submittal-file');
      await attach(raiser, 'submittal', sub.id, i % 4 === 0 ? textFile(attCanary, 'Covering note') : pngFile(attCanary), { caption: `Covering note — ${attCanary}` });
    }
    if (flow === 'pending') continue;
    if (flow === 'archived') {
      await ctx.attempt('submittal archive', () => pm.DELETE(S(sub.id)));
      continue;
    }

    await raiser.POST(`${S(sub.id)}/submit`, { comment: `Submitted for review — ${canary}` });
    if (flow === 'approved') {
      await qs.POST(`${S(sub.id)}/review`, { comment: `Checked against the specification — ${canary}` });
      await pm.POST(`${S(sub.id)}/approve`, { comment: `Approved — ${canary}` });
    } else if (flow === 'rejected') {
      await pm.POST(`${S(sub.id)}/reject`, { reason: `Wrong grade certified; resubmit — ${canary}` });
    } else if (flow === 'resubmitted') {
      await pm.POST(`${S(sub.id)}/reject`, { reason: `Certificate out of date — ${canary}` });
      const secondCanary = ctx.canary('submittal-revision');
      const rev1 = await uploadRevision(raiser, 'submittal', sub.id, '1', pdfFile(secondCanary, `${sub.topic} rev 1`), { title: `${sub.topic} rev 1 — ${secondCanary}`, notes: secondCanary });
      made.revisions[`submittal:${flow}:1`] = rev1.id;
      await raiser.POST(`${S(sub.id)}/resubmit`, { reason: `Current certificate attached — ${canary}` });
      await qs.POST(`${S(sub.id)}/review`, { comment: `Rev 1 checked — ${canary}` });
      await pm.POST(`${S(sub.id)}/approve`, { comment: `Rev 1 approved — ${canary}` });
    } else if (flow === 'sent_back') {
      await pm.POST(`${S(sub.id)}/resubmit`, { reason: `Add the test report and send again — ${canary}` });
    } else if (flow === 'step_approved') {
      await ctx.attempt('submittal step 1', () => qs.POST(`${S(sub.id)}/decide`, { decision: 'approve', responseCode: 'approved_as_noted', comment: `Technically acceptable, see notes — ${canary}` }));
      await ctx.attempt('submittal step 2', () => pm.POST(`${S(sub.id)}/decide`, { decision: 'approve', responseCode: 'approved', comment: `Approved — ${canary}` }));
    } else if (flow === 'step_rejected') {
      await ctx.attempt('submittal step reject', () => qs.POST(`${S(sub.id)}/decide`, { decision: 'reject', responseCode: 'revise_resubmit', comment: `Dimensions missing; revise and resubmit — ${canary}` }));
    }
    if (flow === 'under_review') {
      await ctx.attempt('submittal people', () => pm.PUT(`${S(sub.id)}/people`, { managerUserId: user.pm, distributionUserIds: [user.qs, user.site] }));
    }
  }

  const packageCount = ctx.count(1, 2);
  for (let p = 0; p < packageCount; p += 1) {
    const canary = ctx.canary('submittal-package');
    const members = [];
    for (let k = 0; k < 2; k += 1) members.push(await newSubmittal(p * 3 + k + 2, site, p === 0 ? { workflowTemplateId: template.id } : {}));
    const pack = await site.POST(`${P}/submittals/packages`, {
      name: `Package ${p + 1} r${runNo} ${canary}`,
      description: `Submitted together — ${canary}`,
      activityId: activityAt(p + 3),
      requiredOnSite: ctx.daysAhead(50),
      managerUserId: user.pm,
      submittalIds: [members[0].id],
    });
    ctx.record('submittal_package', pack.id);
    made.packages.push(pack.id);
    await site.POST(`${P}/submittals/packages/${pack.id}/items`, { submittalIds: [members[1].id] });
    await ctx.attempt('package edit', () => site.PATCH(`${P}/submittals/packages/${pack.id}`, { description: `Submitted together (edited) — ${canary}` }));
    if (p === 0) {
      // Submitted as one, and the first step decided for every member at once.
      await ctx.attempt('package submit', () => site.POST(`${P}/submittals/packages/${pack.id}/submit`, { comment: `Package submitted — ${canary}` }));
      await ctx.attempt('package decide', () => qs.POST(`${P}/submittals/packages/${pack.id}/decide`, { decision: 'approve', responseCode: 'approved', comment: `Package checked — ${canary}` }));
    } else {
      // Left open; one member taken out again.
      await ctx.attempt('package remove item', () => site.DELETE(`${P}/submittals/packages/${pack.id}/items/${members[1].id}`));
    }
  }

  // ── drawings: the register and its revisions ──────────────────────────────
  const D = `${P}/doc-control`;
  const drawingCount = ctx.count(2, DRAWING_TITLES.length);
  for (let i = 0; i < drawingCount; i += 1) {
    const [letter, title, flow] = DRAWING_TITLES[i % DRAWING_TITLES.length];
    const canary = ctx.canary('drawing');
    const number = `${letter}-${101 + i}-R${runNo}`;
    const drawing = await planner.POST(`${P}/drawings`, {
      drawingNumber: number,
      title: `${title} — ${canary}`,
      status: 'active',
      activityId: activityAt(i + 2),
      activityIds: [activityAt(i + 2)],
      issueDate: ctx.daysAgo(30 - i),
      comment: `Registered — ${canary}`,
    });
    ctx.record('drawing_record', drawing.id);
    keep(made.drawings, flow, drawing.id);

    const revision = async (label, who = site) => {
      const fileCanary = ctx.canary('drawing-revision');
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
    const review = (row, who = site) => who.POST(`${D}/revisions/${row.id}/submit-review`, { comment: `For review — ${canary}`, reviewDueAt: ctx.daysAhead(5) });
    const approve = (row) => pm.POST(`${D}/revisions/${row.id}/approve`, { comment: `Approved for construction — ${canary}` });

    if (flow === 'issued') {
      const a = await revision('A');
      await review(a);
      await approve(a);
      const b = await revision('B');
      await review(b);
      await approve(b);
      await revision('C');
      const fileCanary = ctx.canary('drawing-file');
      await attach(planner, 'drawing', drawing.id, textFile(fileCanary, `Issue note for ${number}`), { caption: `Issue note — ${fileCanary}` });
      const bytes = await ctx.attempt('revision download', () => pm.download(`${D}/revisions/${b.id}/download`));
      if (bytes && !bytes.includes(Buffer.from(ctx.project.canary))) ctx.note(`revision ${b.id} downloaded without its canary`);
      await ctx.attempt('revision preview', () => pm.download(`${D}/revisions/${b.id}/preview`));
    } else if (flow === 'in_review') {
      await review(await revision('A', planner), planner);
    } else if (flow === 'superseded') {
      const a = await revision('A');
      await review(a);
      await approve(a);
      await ctx.attempt('revision supersede', () => pm.POST(`${D}/revisions/${a.id}/supersede`, { reason: `Replaced by the coordinated set — ${canary}` }));
      await ctx.attempt('drawing superseded', () => planner.PATCH(`${P}/drawings/${drawing.id}`, { status: 'superseded', comment: `Superseded — ${canary}` }));
    } else if (flow === 'cancelled') {
      // A revision that points at a file already on the project (the JSON route), then the drawing is cancelled.
      const fileCanary = ctx.canary('drawing-file');
      const filed = await attach(planner, 'drawing', drawing.id, pdfFile(fileCanary, `${number} preliminary`), { caption: `Preliminary — ${fileCanary}`, role: 'reference' });
      const linked = await ctx.attempt('revision from a filed document', () =>
        planner.POST(`${D}/drawing/${drawing.id}/revisions`, { revision: 'P1', projectDocumentId: filed.documentId, title: `${title} rev P1 — ${fileCanary}`, notes: fileCanary, status: 'submitted', folderPath: '/Drawings/Preliminary', category: 'Drawings' })
      );
      if (linked?.id) {
        ctx.record('document_revision', linked.id);
        made.revisions[`drawing:${flow}:P1`] = linked.id;
      }
      await ctx.attempt('drawing cancelled', () => planner.PATCH(`${P}/drawings/${drawing.id}`, { status: 'cancelled', comment: `Scope removed — ${canary}` }));
    } else {
      await revision('A');
    }
  }

  // ── drawing sets: uploaded; processing is the worker's ────────────────────
  const setCount = ctx.count(1, 2);
  for (let i = 0; i < setCount; i += 1) {
    const canary = ctx.canary('drawing-set');
    const body = pdf([
      [`S-20${i + 1} FOUNDATION PLAN`, 'Rev A', canary, 'Scale 1:100'],
      [`S-20${i + 2} COLUMN SCHEDULE`, 'Rev A', canary, 'Scale 1:50'],
    ]);
    const set = await planner.upload('POST', `${P}/drawings/sets`, {
      field: 'file',
      filename: `${canary}.pdf`,
      contentType: 'application/pdf',
      body,
      fields: { name: `Structural set ${i + 1} r${runNo} ${canary}`, discipline: 'structural', purpose: i ? 'SHOP' : 'IFC', description: `Issued for construction — ${canary}`, receivedAt: ctx.daysAgo(3), issuedAt: ctx.daysAgo(4) },
    });
    ctx.record('drawing_set', set.id);
    made.sets.push(set.id);
    const sourceId = set.sourceDocumentId || set.sourceDocument?.id;
    if (sourceId) {
      ctx.record('project_document', sourceId);
      made.documents.push(sourceId);
    }
    await ctx.attempt('drawing set edit', () => planner.PATCH(`${P}/drawings/sets/${set.id}`, { description: `Issued for construction (edited) — ${canary}` }));
    const fileCanary = ctx.canary('drawing-set-file');
    await ctx.attempt('attachment on the drawing set', () => attach(planner, 'drawing_set', set.id, textFile(fileCanary, 'Set cover sheet'), { caption: `Cover sheet — ${fileCanary}` }));
    const after = await ctx.attempt('drawing set read', () => planner.GET(`${P}/drawings/sets/${set.id}`));
    if (i === 0 && after && ['review', 'published'].includes(after.status)) {
      // Only where something processed the set: name the pages and publish.
      const pages = after.revisions || [];
      await ctx.attempt('drawing set review', () => planner.PATCH(`${P}/drawings/sets/${set.id}/revisions`, { updates: pages.map((page, n) => ({ id: page.id, number: page.number || `S-${runNo}${i}${n + 1}`, title: page.title || `Sheet ${n + 1} ${canary}`.slice(0, 200), revision: page.revision || 'A' })) }));
      const published = await ctx.attempt('drawing set publish', () => planner.POST(`${P}/drawings/sets/${set.id}/publish`, {}));
      if (published) for (const page of pages) ctx.record('sheet_revision', page.id);
    } else if (i === 0) {
      ctx.note(`drawing set ${set.id} is ${after?.status || set.status}: publishing waits for the job worker`);
    }
  }

  // Sheets exist only where a set was processed and published.
  try {
    const sheets = listOf(await planner.GET(`${P}/drawings/sheets?status=all`));
    if (!sheets.length) {
      ctx.note('no sheets on the project (drawing sets were not processed): sheet revisions, markups and pins were not made');
    } else {
      const sheet = sheets[0];
      ctx.record('sheet', sheet.id);
      const canary = ctx.canary('sheet');
      const added = await ctx.attempt('sheet revision', () =>
        planner.upload('POST', `${P}/drawings/sheets/${sheet.id}/revisions`, { field: 'file', ...pdfFile(canary, `${sheet.number} revised`), fields: { revision: `R${runNo}`, title: `${sheet.title || sheet.number} ${canary}`.slice(0, 200) } })
      );
      const addedId = added?.revision?.id || added?.id;
      if (addedId) ctx.record('sheet_revision', addedId);
      const markup = await ctx.attempt('markup', () =>
        site.PUT(`${P}/drawings/sheets/${sheet.id}/markups/mine`, { name: `Site notes ${canary}`.slice(0, 120), shapes: [{ type: 'text', x: 0.3, y: 0.4, text: canary }, { type: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.1 }] })
      );
      const markupId = markup?.id || markup?.markup?.id;
      if (markupId) {
        ctx.record('markup', markupId);
        await ctx.attempt('markup publish', () => planner.POST(`${P}/drawings/sheets/${sheet.id}/markups/${markupId}/publish`, { name: `Published notes ${canary}`.slice(0, 120) }));
      }
      const pinTarget = made.rfis.open || made.rfis.closed;
      if (pinTarget) {
        const pin = await ctx.attempt('pin', () => site.POST(`${P}/drawings/sheets/${sheet.id}/pins`, { x: 0.42, y: 0.37, recordType: 'rfi', recordId: pinTarget, label: canary.slice(-40) }));
        const pinId = pin?.id || pin?.pin?.id;
        if (pinId) ctx.record('pin', pinId);
      }
    }
  } catch (error) {
    ctx.note(`sheets: ${String(error.message || error).slice(0, 200)}`);
  }

  // ── a file put in the workflow store first, cited afterwards by its key ───
  const receiptCanary = ctx.canary('workflow-file');
  const stored = await ctx.attempt('workflow upload', () => site.upload('POST', `${P}/workflow/uploads`, { field: 'files', ...textFile(receiptCanary, 'Courier receipt') }));
  const receipt = (Array.isArray(stored) ? stored : stored?.items || [])[0] || null;
  if (receipt?.documentId) {
    ctx.record('project_document', receipt.documentId);
    made.documents.push(receipt.documentId);
    await ctx.attempt('workflow file download', () => site.download(`${P}/workflow/uploads/${receipt.key || receipt.documentId}`));
  }

  // ── transmittals ──────────────────────────────────────────────────────────
  const transmittalCount = ctx.count(2, TRANSMITTAL_SUBJECTS.length);
  for (let i = 0; i < transmittalCount; i += 1) {
    const canary = ctx.canary('transmittal');
    const acknowledged = i % 2 === 1;
    const row = await planner.POST(`${P}/transmittals`, {
      subject: `${TRANSMITTAL_SUBJECTS[i % TRANSMITTAL_SUBJECTS.length]} — ${canary}`,
      sender: `${ctx.company.canary} site office`,
      recipient: party(i % 2 ? 'consultant' : 'client'),
      method: TRANSMITTAL_METHODS[i % TRANSMITTAL_METHODS.length],
      status: 'pending_ack',
      transmittedOn: ctx.daysAgo(10 - i),
      dueDate: ctx.daysAhead(4 + i),
      activityIds: [activityAt(i + 4)],
      comment: `Issued — ${canary}`,
      ...(i === 1 && receipt ? { attachmentRefs: [{ fileName: receipt.fileName, storageKey: receipt.storageKey || receipt.key, mimeType: receipt.mimeType, sizeBytes: receipt.sizeBytes, description: `Courier receipt — ${receiptCanary}` }] } : {}),
    });
    ctx.record('transmittal', row.id);
    keep(made.transmittals, acknowledged ? 'acknowledged' : 'pending_ack', row.id);
    if (i === 0) {
      // Filed as an attachment, then made a revision of the transmittal by its document id and sent for review.
      const fileCanary = ctx.canary('transmittal-file');
      const filed = await attach(planner, 'transmittal', row.id, pdfFile(fileCanary, 'Transmittal cover sheet'), { caption: `Cover sheet — ${fileCanary}` });
      const rev = await planner.POST(`${D}/transmittal/${row.id}/revisions`, { revision: 'A', projectDocumentId: filed.documentId, title: `Transmittal cover sheet — ${fileCanary}`, fileName: `${fileCanary}.pdf`, notes: fileCanary, status: 'submitted', folderPath: '/Transmittals/Client', category: 'Transmittals' });
      ctx.record('document_revision', rev.id);
      made.revisions['transmittal:A:submitted'] = rev.id;
    }
    if (i === 1) {
      const fileCanary = ctx.canary('transmittal-revision');
      const rev = await uploadRevision(planner, 'transmittal', row.id, 'A', textFile(fileCanary, 'Delivery note'), { title: `Delivery note — ${fileCanary}`, notes: fileCanary });
      made.revisions['transmittal:A:uploaded'] = rev.id;
    }
    if (acknowledged) await pm.PATCH(`${P}/transmittals/${row.id}`, { status: 'acknowledged', acknowledgedOn: ctx.daysAgo(1), comment: `Acknowledged by the recipient — ${canary}` });
  }

  // ── correspondence ────────────────────────────────────────────────────────
  const letterCount = ctx.count(3, LETTERS.length);
  let filedLetter = null;
  for (let i = 0; i < letterCount; i += 1) {
    const [direction, type, subject] = LETTERS[i % LETTERS.length];
    const canary = ctx.canary('correspondence');
    const closing = i % 3 === 1;
    const row = await (i % 2 ? site : pm).POST(`${P}/correspondence`, {
      direction,
      type,
      subject: `${subject} — ${canary}`,
      date: ctx.daysAgo(12 - i),
      responseRequiredBy: ctx.daysAhead(i % 2 ? 3 : -2),
      status: 'open',
      activityId: activityAt(i + 5),
      comment: `${direction === 'incoming' ? 'Received from' : 'Sent to'} ${party(i % 2 ? 'consultant' : 'client')} — ${canary}`,
    });
    ctx.record('correspondence', row.id);
    keep(made.correspondence, `${closing ? 'closed' : 'open'}_${direction}_${type}`, row.id);
    if (i === 0) {
      const fileCanary = ctx.canary('correspondence-file');
      filedLetter = await attach(pm, 'correspondence', row.id, pdfFile(fileCanary, subject, [`To: ${party('client')}`]), { caption: `Signed letter — ${fileCanary}`, role: 'signature' });
    } else if (i === 1 && filedLetter?.documentId) {
      // The same file filed on a second record: linked by its document id, not uploaded again.
      const link = await ctx.attempt('attachment by document id', () => pm.upload('POST', `${P}/attachments`, { fields: { recordType: 'correspondence', recordId: row.id, documentIds: [filedLetter.documentId], caption: `See also — ${canary}` } }));
      for (const item of link?.items || []) ctx.record('attachment', item.id);
    }
    if (closing) await pm.PATCH(`${P}/correspondence/${row.id}`, { status: 'closed', responseDate: ctx.today, comment: `Answered and closed — ${canary}` });
  }

  // ── the specification ─────────────────────────────────────────────────────
  const specCanary = ctx.canary('specification');
  const spec = await attach(pm, 'project', ctx.project.id, { filename: `${specCanary}.pdf`, contentType: 'application/pdf', body: pdf(SPEC_PAGES(specCanary)) }, { caption: `Project specification — ${specCanary}`, role: 'reference' });
  if (spec.documentId) {
    const queued = await ctx.attempt('text extraction', () => planner.POST(`${P}/documents/${spec.documentId}/extract`, {}));
    const indexed = await ctx.attempt('specification index', () => planner.POST(`${P}/specifications/index`, { documentIds: [spec.documentId] }));
    const sectionsMade = indexed?.sections || 0;
    if (!sectionsMade) ctx.note(`specification ${spec.documentId} not indexed (${indexed?.documents?.[0]?.error || 'no sections'}); extraction ${queued?.status || 'not queued'} — sections need the job worker`);
  }
  const sections = listOf(await ctx.attempt('specification sections', () => site.GET(`${P}/specifications`)));
  for (const section of sections) ctx.record('spec_section', section.id);
  if (sections[0]?.id) {
    await ctx.attempt('specification section', () => site.GET(`${P}/specifications/${sections[0].id}`));
    const canary = ctx.canary('rfi');
    const raised = await ctx.attempt('rfi from a specification section', () => site.POST(`${P}/specifications/${sections[0].id}/rfi`, { subject: `Clarify section ${sections[0].code || ''} — ${canary}`.slice(0, 200), question: `The section and the drawings disagree. ${canary}`, priority: 'normal' }));
    const raisedId = raised?.rfi?.id || raised?.id;
    if (raisedId) ctx.record('rfi', raisedId);
  }
  await ctx.attempt('specification status', () => site.GET(`${P}/specifications/status`));
  await ctx.attempt('specification documents', () => site.GET(`${P}/specifications/documents`));
  await ctx.attempt('specification scope gaps', () => planner.GET(`${P}/specifications/scope-gaps`));

  // ── reading it all back: lists, register, searches ────────────────────────
  const mark = ctx.project.canary;
  const need = (label, rows, ids) => {
    const have = new Set(rows.map((row) => row.recordId || row.id));
    const missing = ids.filter((id) => id && !have.has(id));
    if (missing.length) throw new Error(`documents: ${label} does not list ${missing.length} of this run's records (${missing[0]})`);
  };
  // An archived record leaves the lists; a draft is its author's alone.
  const live = (group) => Object.entries(group).filter(([flow]) => !flow.startsWith('archived') && !flow.startsWith('draft')).map(([, id]) => id);

  need('the RFI list', listOf(await pm.GET(`${P}/rfi?limit=100&sortBy=created&sortDir=desc`)), live(made.rfis));
  need('the submittal list', listOf(await pm.GET(`${P}/submittals?limit=100&sortBy=created&sortDir=desc`)), live(made.submittals));
  need('the drawing list', listOf(await site.GET(`${P}/drawings`)), Object.values(made.drawings));
  need('the transmittal list', listOf(await qs.GET(`${P}/transmittals`)), Object.values(made.transmittals));
  need('the correspondence list', listOf(await qs.GET(`${P}/correspondence`)), Object.values(made.correspondence));
  need('the drawing set list', listOf(await site.GET(`${P}/drawings/sets`)), made.sets);
  need('the package list', listOf(await qs.GET(`${P}/submittals/packages`)), made.packages);
  need('the template list', listOf(await qs.GET(`${P}/submittals/workflow-templates?scope=project&includeArchived=true`)), made.templates);

  const register = listOf(await pm.GET(`${D}/register?search=${encodeURIComponent(mark.toLowerCase())}`));
  need('the document register (searched by canary)', register, [...live(made.rfis), ...live(made.submittals), ...Object.values(made.drawings), ...Object.values(made.transmittals), ...Object.values(made.correspondence)]);
  for (const folder of ['drawings', 'submittals', 'rfi', 'transmittals', 'correspondence']) await ctx.attempt(`register folder ${folder}`, () => qs.GET(`${D}/register?folder=${folder}`));
  await ctx.attempt('register by type and status', () => qs.GET(`${D}/register?recordType=drawing&status=approved`));
  await ctx.attempt('document control dashboard', () => qs.GET(`${D}/dashboard`));
  await ctx.attempt('attachments of a record', () => pm.GET(`${P}/attachments?recordType=project&recordId=${ctx.project.id}`));

  const evidence = await ctx.attempt('attachment search', () => pm.GET(`${P}/attachments/search?q=${encodeURIComponent(mark)}&limit=100`));
  const found = { register: register.length, attachments: listOf(evidence).length };
  if (spec.documentId) {
    const bytes = await ctx.attempt('document download', () => pm.download(`${P}/attachments/documents/${spec.documentId}`));
    if (bytes && !bytes.includes(Buffer.from(specCanary))) throw new Error('documents: the specification came back without its canary');
  }
  const global = await ctx.attempt('global search', () => pm.GET(`/search?q=${encodeURIComponent(mark)}&projectId=${ctx.project.id}&limit=50`));
  found.global = listOf(global?.results || global).length;
  const content = await ctx.attempt('document content search', () => pm.GET(`${P}/documents/search?q=${encodeURIComponent(specCanary)}&limit=50`));
  found.content = listOf(content).length;
  const index = await ctx.attempt('document index status', () => pm.GET(`${P}/documents/index-status`));
  if (spec.documentId) await ctx.attempt('document text', () => pm.GET(`${P}/documents/${spec.documentId}/text`));
  ctx.note(`canary search: register ${found.register}, attachment search ${found.attachments}, global search ${found.global}, content search ${found.content}${found.content ? '' : ` (text index: ${JSON.stringify(index?.counts || index?.byStatus || index || {}).slice(0, 120)})`}`);

  state.last = { run: runNo, ...made, documents: made.documents.slice(0, 20), location: location?.id || null };
};

module.exports = { name: 'documents', needs: ['foundation'], depths: ['standard'], run };
