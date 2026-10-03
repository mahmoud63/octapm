'use strict';

/**
 * Certification R4 follow-up: a person assigned to a submittal's review step
 * opens the submittal (R4) — and reads its files, which the document rule
 * routed by party only, so the reviewer could open the record but not what it
 * was asked to review.
 *
 *   $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/submittal-reviewer-files-proof.js
 *
 * Set-up on 072-01: the PM makes a review route whose only step is the
 * consultant party; SUB-X raises and submits a submittal under it (owner
 * SUB-X, no reviewer or approver party: the consultant is a step reviewer
 * only) and attaches a file to it.
 * Allowed: the consultant reads the file through /attachments/documents/:id.
 * Refused: SUB-Y (neither routed nor assigned) is refused the same file.
 * Exit 0 when both hold; 2 when SUB-Y reads it; 3 when the consultant cannot.
 */

const pv = require('../leads/lib/party-visibility');

const main = async () => {
  const s = await pv.setup({ log: () => {} });
  const P = s.projectId;
  const tag = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const ok = (res) => res.status >= 200 && res.status < 300;
  const need = (res, what) => {
    if (!ok(res)) throw new Error(`set-up: ${what} answered ${res.status} ${JSON.stringify(res.body?.error || '').slice(0, 300)}`);
    return res.body?.data;
  };

  const route = need(await s.pm.send('POST', `/projects/${P}/submittals/workflow-templates`, { name: `R4 files ${tag}`, description: 'Consultant step only.', isDefault: false, steps: [{ name: 'Consultant review', mode: 'sequential', days: 5, assignees: [{ type: 'party_role', role: 'consultant' }] }] }), 'the PM creating the review route');
  const submittal = need(await s.subX.send('POST', `/projects/${P}/submittals`, { title: `R4 files ${tag}`, workflowTemplateId: route.id }), 'SUB-X raising the submittal');
  need(await s.subX.send('POST', `/projects/${P}/submittals/${submittal.id}/submit`, { revision: 'A' }), 'SUB-X submitting');
  const me = await s.consultant.GET('/auth/me');
  const now = need(await s.pm.send('GET', `/projects/${P}/submittals/${submittal.id}`), 'the PM reading the submittal');
  const assigned = (now?.activeStep?.assignments || []).some((row) => row.userId === me.id);
  if (!assigned || now.reviewerPartyId || now.approverPartyId) throw new Error(`set-up: the consultant is not (only) a step reviewer: assigned ${assigned}, reviewer ${now.reviewerPartyId}, approver ${now.approverPartyId}`);

  const attached = need(await s.subX.send('POST', `/projects/${P}/attachments`, undefined, {
    form: pv.api.multipart({ field: 'files', filename: `r4-files-${tag}.txt`, contentType: 'text/plain', body: Buffer.from(`Shop drawing notes ${tag}`), fields: { recordType: 'submittal', recordId: submittal.id, caption: 'for review' } }),
  }), 'SUB-X attaching the file');
  const documentId = (attached?.items || attached?.attachments || [])[0]?.documentId ?? (attached?.items || [])[0]?.id;
  if (!documentId) throw new Error(`set-up: no document id in ${JSON.stringify(attached).slice(0, 300)}`);

  const asConsultant = await s.consultant.send('GET', `/projects/${P}/attachments/documents/${documentId}`, undefined, { binary: true });
  const asSubY = await s.subY.send('GET', `/projects/${P}/attachments/documents/${documentId}`, undefined, { binary: true });
  const asSubX = await s.subX.send('GET', `/projects/${P}/attachments/documents/${documentId}`, undefined, { binary: true });
  console.log(`consultant (step reviewer): ${asConsultant.status}; SUB-Y (not routed, not assigned): ${asSubY.status}; SUB-X (owner): ${asSubX.status}`);
  const allowed = asConsultant.status === 200 && asSubX.status === 200;
  const refused = [403, 404].includes(asSubY.status);
  console.log(`allowed (the reviewer and the owner read the file): ${allowed ? 'HOLDS' : 'FAILS'}; refused (SUB-Y): ${refused ? 'HOLDS' : 'FAILS'}`);
  process.exitCode = !refused ? 2 : !allowed ? 3 : 0;
};

pv.main(main);
