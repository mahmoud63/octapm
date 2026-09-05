# Custom fields, fieldsets and record types (OCTA-PLAT-FIELDS-025)

## Where

- **Company › Custom fields** (`/company/custom-fields`): pick a record type, then manage its **Fields** (shown on every project), **Fieldsets** (which fields a project or record type shows, with required / hidden overrides and a default) and, for correspondence, **Record types** (a named kind — *Site Instruction* — with its own fieldset and default direction / kind).
- **Project › Team › Custom fields** (PM): fields only this project needs, and the fieldset each record type uses here (falls back to the company default).
- **On records**: every workflow register (RFIs, submittals, NCRs, ITPs, drawings, transmittals, correspondence, safety, material tests…) shows a **Custom fields** block in the selected row's details; the RFI, submittal and punch-item dialogs, the change-order register, commitments and pay applications show it in their side column. Editing follows the record's own module permission; without it the values are read-only.
- **On create**: the RFI form shows the fields that apply (defaults pre-filled, required ones checked before the RFI is created, values saved right after); the correspondence form offers the company's record types and applies their defaults.
- **Reports**: every custom field of a source's record type is a column (`custom.<key>`), filterable and groupable; people and companies show by name; XLSX / PDF include them.
- **Workflow rules**: templates can test `custom.<key>` (the tools endpoint lists them under the tool's context fields), so *Change orders with Funding source = contingency* can take their own route.

## Record types that take fields

`rfi`, `submittal`, `punch_item` (punch and observations), `form_instance`, `ncr`, `material_test`, `safety_incident`, `drawing`, `transmittal`, `correspondence`, `change_order`, `commitment`, `sub_pay_app`, `ipc_certificate`, `task`, `risk`, `procurement_order`, `meeting`, `daily_log`, `activity` (`GET /company/custom-fields/record-types`). At most 60 active fields per record type.

## Field definitions

`label`, `key` (slug from the label, immutable, unique per record type), `type` — text, long text, number, money, date, yes / no, pick one, pick many, person, company, link — `options` (pick one / many), `required`, `hidden` (kept for reports, never shown), `default`, `validation` (min / max for numbers and dates, min / max length and a regex pattern for text), `condition` (shown — and required — only when `{ field, op, value }` holds against the record's standard fields and the other custom values, e.g. *Owner rep* only when `priority = urgent`), `position`. The type can change only while no record holds a value (409 `CUSTOM_FIELD_IN_USE`); archiving keeps stored values.

## Effective schema

`GET /projects/{id}/custom-fields/schema?recordType&recordTypeKey` resolves, in order: the record type's fieldset → the project's assigned fieldset → the record type's default fieldset → every active field. A fieldset lists field ids in order with optional `required` / `hidden` overrides; project-only fields are always appended. Archived fieldsets and fields drop out.

## Values

`GET/PUT /projects/{id}/custom-fields/values/{recordType}/{recordId}` (bulk: `GET …/values?recordType&recordIds=`). Writes are validated against the schema — type coercion (`1,250.456` → `1250.46` for money, dates to `YYYY-MM-DD`, comma lists for pick-many, ids for people / companies), option membership, min / max, patterns, required-when-visible — and every problem is returned at once (400 `CUSTOM_FIELD_INVALID` with `details.problems`). `null` removes a value; `partial: true` keeps keys not sent. Changes are audited **on the record itself** (`entityType = rfi`, summary lists the fields), so they show in the record's history. Values sit in `CustomFieldValue` (one row per record and field, `valueJson` with a GIN index).

## Permissions

`custom_field` module: read for every role and party; create / update / delete and `custom_field.manage` for PM (project fields and assignments). Company fields, fieldsets and record types: company admins. Reading and writing a record's values follows the record's own module (`rfi.read` / `rfi.update`…).

## Walkthrough

1. Company › Custom fields → *RFIs* → New field *Contract clause* (text, required) and *Claim value* (money, min 0). Open any project → Doc control › RFIs → New RFI: both fields appear under *Additional fields*; *Contract clause* blocks creation until filled.
2. *Correspondence* → New field *Instructed by* (person) and *Zone* (pick one: North, South) → Fieldsets → New fieldset *Site instruction* with *Instructed by* required and *Zone* hidden → Record types → New *Site Instruction* (fieldset *Site instruction*, defaults outgoing / notice). On a project, Doc control › Correspondence → pick *Site Instruction* → Add → the row's details show *Instructed by* required.
3. Reports → New report → source *RFIs* → columns *Contract clause*, *Claim value* → filter *Claim value at least 10,000* → group by *Contract clause* → XLSX.
4. Company › Workflows → a change-order template rule on *Funding source (custom)* `equals contingency`.

## Tests

`backend/src/services/__tests__/custom-field.service.test.js` (definition validation and keys, schema from company + project fields, fieldsets, record types and project assignment, value coercion / required / conditional / unknown keys, upsert + audit, report columns and display names, workflow context) and `frontend/scripts/custom-fields-ui.test.mjs`.
