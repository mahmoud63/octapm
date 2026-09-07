const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { addMoney, toMoneyNumber } = require("../utils/money");
const { createPdf } = require("../utils/pdf-writer");
const scopeService = require("./scope-matrix.service");

/**
 * The subcontract agreement, assembled rather than typed (OCTA-SUB-DOC-055).
 *
 * Everything a subcontract says is already somewhere in the system by the time
 * it is written: our company details, the vendor's profile, the project, the
 * value from the award, the schedule of values, the activities it is tied to,
 * the retention and payment terms on the commitment, the insurance it demands,
 * and the scope matrix agreed before any of it. Re-keying all of that into a
 * Word template is where contracts drift from the records they are supposed to
 * describe.
 *
 * So this reads those records and prints an agreement. It generates a document
 * for review and signature — it does not decide anything, and every clause it
 * writes is traceable to a record somebody already approved.
 */

const money = (value, currency = "USD") =>
  `${currency} ${toMoneyNumber(value, 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "—";

const trimOrNull = (value) => {
  const text = String(value ?? "").trim();
  return text ? text : null;
};

/**
 * The standard obligations.
 *
 * These are the paragraphs every subcontract of ours carries, with the numbers
 * that vary filled in from the commitment. They are here rather than in a
 * template file because they reference the record: change the retention rate
 * on the commitment and the retention clause changes with it.
 */
const clauses = ({ commitment, project, contract }) => {
  const rate = Number(commitment.retentionRate) || 0;
  const terms = trimOrNull(commitment.paymentTerms) || "30 days from certification";

  return [
    {
      heading: "Payment",
      body: [
        `The Subcontractor shall be paid against payment applications made on the Schedule of Values set out in this Agreement. Payment terms are ${terms}.`,
        `Each application shall be measured against work approved as complete. Amounts claimed in excess of approved progress will not be certified.`,
      ],
    },
    {
      heading: "Retention",
      body: [
        rate > 0
          ? `Retention of ${rate}% shall be deducted from each certified amount and released in accordance with the Contract, subject to the closeout requirements below.`
          : "No retention is deducted under this Agreement.",
      ],
    },
    {
      heading: "Changes",
      body: [
        "No variation to the Works shall be undertaken without a subcontract change order approved in writing. Work performed without an approved change order is at the Subcontractor's risk and shall not be certified.",
        "An approved change order adjusts the Schedule of Values and the Subcontract Sum accordingly.",
      ],
    },
    {
      heading: "Safety",
      body: [
        "The Subcontractor is responsible for the safety of its personnel and for compliance with the project safety plan, including task-specific risk assessments and the provision of personal protective equipment except where the Responsibility Matrix states otherwise.",
        "Incidents and near misses shall be reported the same day.",
      ],
    },
    {
      heading: "Quality",
      body: [
        "The Works shall be executed in accordance with the specification and approved submittals. Inspection requests shall be raised with the notice period stated in the Responsibility Matrix.",
        "Non-conformances shall be closed out at the Subcontractor's cost where they arise from its work.",
      ],
    },
    {
      heading: "Insurance",
      body: [
        "The Subcontractor shall maintain the insurances listed below for the duration of the Works and provide valid certificates before commencing on site. Payment applications will not be certified while a required insurance has lapsed.",
      ],
    },
    {
      heading: "Submittals",
      body: [
        "Shop drawings, material samples and method statements shall be submitted for approval in accordance with the Responsibility Matrix and the project submittal schedule, and in sufficient time not to delay the Works.",
      ],
    },
    {
      heading: "Closeout",
      body: [
        "Final payment and release of retention are conditional on: the punch list being closed, as-built records submitted, operation and maintenance manuals and warranties handed over, training delivered where required, and all insurance and statutory documents being complete and current.",
      ],
    },
    {
      heading: "Governing terms",
      body: [
        contract
          ? `This Agreement is subject to the terms of the main contract between ${project.orgName} and the Client, contract reference ${contract.ref}.`
          : `This Agreement is subject to the terms of the main contract for ${project.name}.`,
      ],
    },
  ];
};

// ─── assembling ────────────────────────────────────────────────────────────

const load = async ({ orgId, projectId, commitmentId }) => {
  const commitment = await prisma.commitment.findFirst({
    where: { id: commitmentId, projectId, orgId },
    include: {
      vendorCompany: true,
      lines: {
        orderBy: [{ sortOrder: "asc" }, { lineNumber: "asc" }],
        include: {
          activity: { select: { id: true, name: true, activityCode: true, startDate: true, endDate: true } },
          costCode: { select: { code: true, name: true } },
        },
      },
      changeOrders: { where: { status: "approved" }, orderBy: [{ number: "asc" }] },
      scopeMatrix: { include: { items: { orderBy: [{ sortOrder: "asc" }] } } },
    },
  });
  if (!commitment) throw new HttpError(404, "COMMITMENT_NOT_FOUND", "Commitment not found");

  const [project, org, contract] = await Promise.all([
    prisma.project.findFirst({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        location: true,
        contractNumber: true,
        currency: true,
        startDate: true,
        endDate: true,
      },
    }),
    prisma.organisation.findFirst({
      where: { id: orgId },
      select: { id: true, name: true },
    }),
    prisma.primeContract.findFirst({
      where: { projectId },
      select: { ref: true, title: true },
    }),
  ]);

  return { commitment, project: { ...project, orgName: org?.name ?? "" }, org, contract };
};

/**
 * What is still missing before the agreement is worth printing.
 *
 * Named rather than counted, because "not ready" without a list is a dead end.
 * None of these blocks generation — a draft for review is exactly what somebody
 * wants while they chase the gaps — but they are printed on the document as
 * outstanding so nobody signs it by mistake.
 */
const readinessOf = ({ commitment }) => {
  const gaps = [];
  if (!commitment.vendorCompanyId) gaps.push("No subcontractor company is named on the commitment");
  if (!commitment.lines.length) gaps.push("The schedule of values is empty");
  if (!commitment.startDate || !commitment.endDate) gaps.push("The period of the works is not set");
  if (!trimOrNull(commitment.paymentTerms)) gaps.push("Payment terms are not stated");

  const matrix = commitment.scopeMatrix;
  if (!matrix) {
    gaps.push("No scope and responsibility matrix has been drawn up");
  } else {
    if (matrix.status !== "agreed") gaps.push("The scope matrix has not been agreed");
    const unowned = matrix.items.filter(
      (item) => scopeService.ALLOCATED_KINDS.includes(item.kind) && !item.responsibility
    );
    if (unowned.length) {
      gaps.push(
        unowned.length === 1
          ? "1 scope row still has nobody against it"
          : `${unowned.length} scope rows still have nobody against them`
      );
    }
  }

  const insurances = Array.isArray(commitment.insuranceJson) ? commitment.insuranceJson : [];
  const missingCover = insurances.filter((entry) => entry.required && !entry.documentId);
  if (missingCover.length) {
    gaps.push(
      missingCover.length === 1
        ? "A required insurance certificate is not on file"
        : `${missingCover.length} required insurance certificates are not on file`
    );
  }

  return { ready: gaps.length === 0, gaps };
};

const totalsOf = ({ commitment }) => {
  const original = commitment.lines.reduce((sum, line) => addMoney(sum, line.amount), 0);
  const changes = commitment.changeOrders.reduce((sum, co) => addMoney(sum, co.value), 0);
  return { original, changes, revised: addMoney(original, changes) };
};

/** Everything the agreement says, as data — so the UI can preview it. */
const buildAgreement = async ({ orgId, projectId, commitmentId }) => {
  const loaded = await load({ orgId, projectId, commitmentId });
  const { commitment, project, contract } = loaded;
  const totals = totalsOf(loaded);
  const matrix = commitment.scopeMatrix;
  const items = matrix?.items ?? [];

  const byKind = (kind) => items.filter((item) => item.kind === kind);

  // Milestones come off the activities the schedule of values is tied to:
  // the programme already says when the work happens.
  const activities = new Map();
  for (const line of commitment.lines) {
    if (line.activity && !activities.has(line.activity.id)) activities.set(line.activity.id, line.activity);
  }

  return {
    readiness: readinessOf(loaded),
    header: {
      title: `Subcontract Agreement — ${commitment.title}`,
      ref: commitment.ref,
      date: new Date().toISOString(),
      status: commitment.status,
    },
    parties: {
      contractor: { name: project.orgName },
      subcontractor: {
        name: commitment.vendorCompany?.name ?? commitment.supplier ?? "Not named",
        legalName: commitment.vendorCompany?.legalName ?? null,
        registrationNumber: commitment.vendorCompany?.registrationNumber ?? null,
        taxNumber: commitment.vendorCompany?.taxNumber ?? null,
        address: commitment.vendorCompany?.address ?? null,
        contactName: commitment.vendorCompany?.contactName ?? null,
        email: commitment.vendorCompany?.email ?? null,
        phone: commitment.vendorCompany?.phone ?? null,
      },
    },
    project: {
      name: project.name,
      address: project.location,
      mainContract: contract?.ref ?? project.contractNumber ?? null,
    },
    money: {
      currency: commitment.currency,
      original: totals.original,
      approvedChanges: totals.changes,
      revised: totals.revised,
      retentionRate: Number(commitment.retentionRate) || 0,
      paymentTerms: commitment.paymentTerms,
    },
    period: {
      start: commitment.startDate?.toISOString() ?? null,
      end: commitment.endDate?.toISOString() ?? null,
    },
    scheduleOfValues: commitment.lines.map((line) => ({
      lineNumber: line.lineNumber,
      description: line.description,
      costCode: line.costCode?.code ?? null,
      activity: line.activity ? `${line.activity.activityCode ?? ""} ${line.activity.name}`.trim() : null,
      unit: line.unit,
      qty: Number(line.qty) || 0,
      rate: toMoneyNumber(line.rate),
      amount: toMoneyNumber(line.amount),
    })),
    changeOrders: commitment.changeOrders.map((co) => ({
      ref: co.ref,
      title: co.title,
      value: toMoneyNumber(co.value),
    })),
    milestones: [...activities.values()].map((activity) => ({
      code: activity.activityCode,
      name: activity.name,
      start: activity.startDate?.toISOString() ?? null,
      finish: activity.endDate?.toISOString() ?? null,
    })),
    scope: {
      status: matrix?.status ?? null,
      works: byKind("scope").map((item) => ({
        description: item.description,
        section: item.section,
        responsibility: item.responsibility,
        responsibilityLabel: item.responsibility
          ? scopeService.PARTY_LABEL[item.responsibility]
          : null,
        notes: item.notes,
      })),
      responsibilities: byKind("responsibility").map((item) => ({
        description: item.description,
        section: item.section,
        responsibility: item.responsibility,
        responsibilityLabel: item.responsibility
          ? scopeService.PARTY_LABEL[item.responsibility]
          : null,
        notes: item.notes,
      })),
      inclusions: byKind("inclusion").map((item) => item.description),
      exclusions: byKind("exclusion").map((item) => item.description),
      clarifications: byKind("clarification").map((item) => item.description),
      interfaces: byKind("interface").map((item) => item.description),
    },
    insurance: (Array.isArray(commitment.insuranceJson) ? commitment.insuranceJson : []).map(
      (entry) => ({
        type: entry.type,
        required: Boolean(entry.required),
        onFile: Boolean(entry.documentId),
        expiresAt: entry.expiresAt ?? null,
        note: entry.note ?? null,
      })
    ),
    clauses: clauses({ commitment, project, contract }),
  };
};

// ─── printing ──────────────────────────────────────────────────────────────

const INSURANCE_LABEL = {
  general_liability: "General liability",
  workers_compensation: "Workers' compensation",
  auto: "Motor",
  umbrella: "Umbrella",
  professional: "Professional indemnity",
  builders_risk: "Contract works",
  bond: "Performance bond",
  other: "Other",
};

const exportAgreementPdf = async ({ orgId, projectId, commitmentId }) => {
  const data = await buildAgreement({ orgId, projectId, commitmentId });
  const currency = data.money.currency;

  const doc = createPdf({
    title: data.header.title,
    author: data.parties.contractor.name,
    pageSize: "A4",
    footer: `${data.project.name} · ${data.header.ref} · generated ${formatDate(new Date())}`,
  });

  doc.heading(`Subcontract Agreement · ${data.header.ref}`);
  doc.paragraph(data.header.title, { bold: true });

  // Said on the face of the document, so a draft cannot be mistaken for a
  // contract ready to sign.
  if (!data.readiness.ready) {
    doc.spacer(4);
    doc.paragraph("DRAFT — not for signature. Outstanding before issue:", { bold: true });
    for (const gap of data.readiness.gaps) doc.paragraph(`•  ${gap}`, { indent: 10 });
  }

  doc.heading("Parties", { level: 2 });
  doc.keyValues([
    ["Contractor", data.parties.contractor.name],
    ["Subcontractor", data.parties.subcontractor.name],
    ["Registered name", data.parties.subcontractor.legalName || "—"],
    ["Registration no.", data.parties.subcontractor.registrationNumber || "—"],
    ["Tax no.", data.parties.subcontractor.taxNumber || "—"],
    ["Address", data.parties.subcontractor.address || "—"],
    [
      "Contact",
      [data.parties.subcontractor.contactName, data.parties.subcontractor.email, data.parties.subcontractor.phone]
        .filter(Boolean)
        .join(" · ") || "—",
    ],
  ]);

  doc.heading("Project", { level: 2 });
  doc.keyValues([
    ["Project", data.project.name],
    ["Address", data.project.address || "—"],
    ["Main contract", data.project.mainContract || "—"],
    ["Period of the works", `${formatDate(data.period.start)} → ${formatDate(data.period.end)}`],
  ]);

  doc.heading("Subcontract sum", { level: 2 });
  doc.keyValues([
    ["Original sum", money(data.money.original, currency)],
    ["Approved changes", money(data.money.approvedChanges, currency)],
    ["Subcontract sum", money(data.money.revised, currency)],
    ["Retention", `${data.money.retentionRate}%`],
    ["Payment terms", data.money.paymentTerms || "—"],
  ]);

  doc.heading("Schedule of values", { level: 2 });
  doc.table({
    columns: [
      { key: (line) => String(line.lineNumber), label: "#", width: 22 },
      { key: "description", label: "Description", width: 1 },
      { key: (line) => line.activity || "—", label: "Activity", width: 130 },
      { key: (line) => `${line.qty} ${line.unit ?? ""}`.trim(), label: "Quantity", width: 70 },
      { key: (line) => money(line.rate, ""), label: "Rate", width: 60 },
      { key: (line) => money(line.amount, ""), label: "Amount", width: 75 },
    ],
    rows: data.scheduleOfValues,
    size: 8,
  });

  if (data.changeOrders.length) {
    doc.heading("Approved change orders", { level: 2 });
    doc.table({
      columns: [
        { key: "ref", label: "Ref", width: 90 },
        { key: "title", label: "Description", width: 1 },
        { key: (co) => money(co.value, ""), label: "Value", width: 80 },
      ],
      rows: data.changeOrders,
      size: 8,
    });
  }

  doc.heading("Scope of work", { level: 2 });
  if (data.scope.works.length) {
    doc.table({
      columns: [
        { key: "description", label: "Item", width: 1 },
        { key: (row) => row.responsibilityLabel || "Not allocated", label: "By", width: 110 },
        { key: (row) => row.notes || "", label: "Notes", width: 150 },
      ],
      rows: data.scope.works,
      size: 8,
    });
  } else {
    doc.paragraph("No scope items have been recorded.");
  }

  const list = (heading, entries) => {
    if (!entries.length) return;
    doc.heading(heading, { level: 2 });
    for (const entry of entries) doc.paragraph(`•  ${entry}`, { indent: 10 });
  };
  list("Inclusions", data.scope.inclusions);
  list("Exclusions", data.scope.exclusions);
  list("Clarifications", data.scope.clarifications);
  list("Interfaces with other trades", data.scope.interfaces);

  doc.heading("Responsibility matrix", { level: 2 });
  if (data.scope.responsibilities.length) {
    doc.table({
      columns: [
        { key: "description", label: "Responsibility", width: 1 },
        { key: (row) => row.section || "", label: "Area", width: 90 },
        { key: (row) => row.responsibilityLabel || "Not allocated", label: "By", width: 110 },
        { key: (row) => row.notes || "", label: "Notes", width: 140 },
      ],
      rows: data.scope.responsibilities,
      size: 8,
    });
  } else {
    doc.paragraph("No responsibilities have been allocated.");
  }

  if (data.milestones.length) {
    doc.heading("Programme", { level: 2 });
    doc.table({
      columns: [
        { key: (row) => row.code || "—", label: "Activity", width: 80 },
        { key: "name", label: "Description", width: 1 },
        { key: (row) => formatDate(row.start), label: "Start", width: 90 },
        { key: (row) => formatDate(row.finish), label: "Finish", width: 90 },
      ],
      rows: data.milestones,
      size: 8,
    });
  }

  for (const clause of data.clauses) {
    doc.heading(clause.heading, { level: 2 });
    for (const paragraph of clause.body) doc.paragraph(paragraph);
  }

  doc.heading("Insurances required", { level: 2 });
  if (data.insurance.length) {
    doc.table({
      columns: [
        { key: (row) => INSURANCE_LABEL[row.type] || row.type, label: "Cover", width: 1 },
        { key: (row) => (row.required ? "Required" : "Optional"), label: "Status", width: 80 },
        { key: (row) => (row.onFile ? "On file" : "Outstanding"), label: "Certificate", width: 90 },
        { key: (row) => formatDate(row.expiresAt), label: "Expires", width: 90 },
      ],
      rows: data.insurance,
      size: 8,
    });
  } else {
    doc.paragraph("No insurances have been specified on this commitment.");
  }

  doc.heading("Signatures", { level: 2 });
  doc.spacer(10);
  doc.table({
    columns: [
      { key: "party", label: "For", width: 1 },
      { key: "name", label: "Name", width: 140 },
      { key: "signature", label: "Signature", width: 140 },
      { key: "date", label: "Date", width: 80 },
    ],
    rows: [
      { party: data.parties.contractor.name, name: "", signature: "", date: "" },
      { party: data.parties.subcontractor.name, name: "", signature: "", date: "" },
    ],
    size: 9,
    zebra: false,
  });

  return {
    fileName: `${data.header.ref}-subcontract-agreement.pdf`,
    buffer: doc.render(),
  };
};

module.exports = {
  buildAgreement,
  clauses,
  exportAgreementPdf,
  readinessOf,
  totalsOf,
};
