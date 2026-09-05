# Contract intelligence: notices and EOT entitlement (OCTA-AI-CONTRACT-032)

Commercial › **Contract** holds the contract profile and the notice monitor;
every EOT claim gets an **Entitlement** tab. Every model output is a
proposal — clauses are confirmed, notices are sent, claim text is applied —
by a person; without a provider each feature still works from the record.

## Contract profile (`ContractProfile`, one per project)

| Field | Notes |
| --- | --- |
| `form` | `fidic_1999`, `fidic_2017`, `nec4`, `jct_2016`, `aia_a201`, `custom`. Choosing a form fills its usual periods and clause references (FIDIC 1999: 28-day notice under Sub-Clause 20.1, 42-day particulars; NEC4: 8 weeks under Clause 61.3; JCT: forthwith; AIA: 21 days). |
| `delayNoticeDays`, `claimParticularsDays`, `variationNoticeDays`, `responseDays`, `paymentDays`, `defectsLiabilityDays`, `ldCapPct` | Edited to match the particular conditions. |
| `documentIds` | The conditions of contract from the project documents (picked by search); their text comes from the document extraction (OCTA-DOC-TEXT-010). |
| `clausesJson` | `{ id, category, reference, title, summary, days, excerpt, documentId, status, source }` — categories notice, eot, variation, payment, ld, retention, defects, suspension, force_majeure, dispute, other; status draft → confirmed / rejected; source model / heuristic / manual. |

**Read clauses from the documents** (`POST …/contract/extract`): each
document's text is read in ~14k-character windows (`AI_CONTRACT_WINDOWS`,
default 8 in total) with a strict prompt (quote references verbatim, convert
weeks to days, no invention); results are merged by category + reference,
stored as **draft** clauses next to the ones already confirmed, with
`suggestedPeriods` the person can apply to the profile. Without a provider a
**text scan** finds sentences that pair a notice / EOT / variation / LD /
payment / defects term with a period.

## Notice monitor (`GET …/contract/notices`)

Events: contractual weather delays, change orders (not rejected), RFIs with
a schedule impact, EOT claims (earliest delay start) and incoming contractual
correspondence. Each gets the period that applies (delay → notice period,
variation → variation period, incoming → its *response required by* or the
response period), the deadline and the notice that served it — an outgoing
contractual correspondence **linked** to the record
(`CommercialCorrespondenceLink`, relation `notice`), else one that **cites
the reference** in subject / body, else one on the **same activity** within
the period + 30 days; an incoming notice is served by its response date.
Status: `served`, `late` (served after the deadline, with the days late),
`due` (days left), `missed`, `not_required` (non-contractual weather).
Summary counts and *due within 7 days*.

**Draft notice** (`POST …/contract/notices/draft`): the event facts (dates,
recorded delay, deadline, particulars period), the parties from the project
and the relevant clauses go to the model; the letter comes back with the
clause references it cites. Without a provider the standard template is
used. **Create as outgoing notice** (`POST …/contract/notices`) creates the
correspondence (outgoing, type notice, `contractualNotice`) through the
correspondence service and links it to the event, so the monitor turns
green.

## EOT entitlement (`POST /projects/{id}/eot/{claimId}/ai/assess`)

Inputs: the claim (event, days claimed / requested, entitlement summary),
the affected activities with float and critical-path impact, the linked
weather delays, the notice status of the claim and of its weather delays
(from the monitor), the evidence in the delay window (daily-log delay
entries, attachments, linked letters) and the confirmed EOT / notice / force
majeure / LD clauses. Output: `entitlement` (likely / partial / unlikely),
`recommendedDays`, `basis`, `gaps`, `concurrency`, `noticeCompliance`,
`narrative`, `claimLetter`. The record-based fallback recommends the
critical-path impact days and lists the gaps (no notice, notice late, no
critical-path impact, no attachments, no daily-log entries, no confirmed EOT
clause). **Apply** (`POST …/ai/apply`) writes the kept analysis and / or
claim letter onto a draft claim through `eot.updateEotClaim`.

## Storage, permissions

Runs are stored as `AssistantConversation` kinds `contract_extract`,
`contract_notice` (on the event) and `contract_eot` (on the claim) and can be
rated. Profile read → `eot.read`; profile save / extract → `eot.update`;
notice draft / create → `document_control.create`; assess → `eot.read`;
apply → `eot.update`; every model call also needs `assistant.read`.

## Walkthrough

1. Commercial › Contract → form *FIDIC 1999* → periods 28 / 42 / 28 / 42 →
   search "conditions" → add the contract PDF → *Read clauses from the
   documents* → Sub-Clause 20.1 (28 days), 8.4, 8.7, 14.7 (56 days) proposed
   → *Use the periods found* → confirm the clauses → save.
2. The notice monitor lists the sandstorm delay as *Served* (linked
   COR-010), VO-003 as *Served late* (16 days), RFI-009 as *Due* (17 days
   left) and EOT-001 as *Missed*.
3. RFI-009 → *Draft notice* → the letter cites Sub-Clause 20.1 with the
   event date and the 42-day particulars → *Create as outgoing notice* →
   COR-012 appears in correspondence, linked, and the row turns *Served*.
4. Commercial › EOT → EOT-001 › Entitlement → *Assess* → partial, 9 of 12
   days recommended, gap "notice not served within 28 days", concurrency with
   the sandstorm → edit the narrative → *Use as analysis* / *Use as claim
   letter* on the draft claim.
5. Unset the provider keys → extraction scans the text, the notice comes
   from the template, the assessment is built from the record.

## Tests

`backend/src/services/__tests__/contract.service.test.js` (defaults and
presets, form change and confirm; extraction through the model with merge,
suggested periods and storage, and the text-scan fallback; monitor statuses
served / late / due / missed / answered incoming with ordering and counts;
notice template and model draft, creation with correspondence + link; EOT
assessment fallback with gaps and evidence, model assessment, apply) and
`frontend/scripts/contract-ui.test.mjs`.
