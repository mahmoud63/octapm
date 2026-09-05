# Company workspace (OCTA-ADM-COMPANY-007)

Organisation-level masters defined once and reused on every project.

## Model

| Table / column | Purpose |
| --- | --- |
| `Company.isVendor`, `trades[]`, `vendorProfileJson`, `contactName` | Vendor profile on the existing Company row (`{ leadTimeReliability, paymentTerms, notes }`). |
| `ProcurementSupplier.companyId` | Project supplier → org vendor. Migration links by case-insensitive name; new suppliers link automatically or via `companyId`. |
| `CostCode` | `(orgId, code)` unique; `category` labour / material / equipment / subcontract / indirect / overhead / contingency / other; optional `parentId`. |
| `CompanyEquipment` | Master name + standard rate; `Equipment.companyEquipmentId` links project rows. |
| `ProjectTemplate` | `settingsJson` (field defaults), `partiesJson` (role, company, access level, permission template), `foldersJson`, `locationsJson` (tree), `assignmentsJson` (user, role, permission template), `isDefault`. |
| `Project.templateId`, `Project.documentFoldersJson` | Origin template and predefined document folders. |

## API (`/api/v1/company`)

Reads are open to every authenticated user (pickers); writes need a company
admin or PM (`requireCompanyAdmin`).

| Method | Path |
| --- | --- |
| GET | `/directory?search&status&vendorsOnly` |
| GET | `/vendors?search&trade&includeInactive` · GET `/vendors/migration-report` · POST `/vendors` · PATCH `/vendors/:id` |
| GET | `/cost-codes?search&category&includeArchived` · POST `/cost-codes` · POST `/cost-codes/import { rows[] }` · PATCH `/cost-codes/:id` |
| GET | `/equipment?search&includeArchived` · POST `/equipment` · PATCH `/equipment/:id` |
| GET | `/project-templates` · POST · GET/PATCH/DELETE `/project-templates/:id` · POST `/project-templates/:id/create-project` |

`POST /projects/:id/procurement/suppliers` accepts `companyId` (name and
contact copied from the vendor); `POST /projects/:id/equipment` accepts
`companyEquipmentId` (name/rate copied from the master, rate overridable).

Every write records an `AuthAuditEvent` (`vendor`, `cost_code`,
`company_equipment`, `project_template`).

## Create project from template

`createProjectFromTemplate` merges template `settings` under the request body
(request wins, empty strings fall back to the template), creates the project
through `project.service.createProject`, then:

1. parties via `upsertProjectPartyWithTx` with their `permissionTemplateId`;
2. `documentFoldersJson` and `templateId` on the project;
3. team `assignments` → `ProjectAssignment` (+ `ProjectUserPermission` when a
   permission template is set);
4. locations through `location.service.createLocation` (own transactions,
   audited), after the project transaction commits.

The response carries `applied: { parties, folders, locations, assignments }`.

## Migration

`20260905210000_add_company_workspace`: one vendor per organisation and
supplier name (case-insensitive; earliest supplier's contact details win),
suppliers linked, trades aggregated from `tradeCategories`; one equipment
master per organisation and equipment name, project rows linked.
`GET /company/vendors/migration-report` lists merged vendors (several project
suppliers → one vendor) and unlinked suppliers.

## Frontend

- Sidebar **Company** → `/company/{directory,vendors,cost-codes,equipment,templates,permissions}`
  (`features/company`, gated to company admins/PMs; Permissions reuses the
  template editor from PERM-003).
- New Project dialog: "Start from a template" pre-fills fields and creates via
  the template endpoint.
- Project Equipment: "From company list" picker; Activity materials: vendor
  names suggested in the supplier field.

## Manual QA

1. Create vendor "Acme Steel" with trades; on two projects add a supplier named
   "acme steel" → both link to the vendor; the consolidation report shows one
   merged vendor with two suppliers.
2. Import cost codes with `parentCode`; children show their parent code.
3. Add "Tower crane" to company equipment; on a project pick it from the list —
   name and rate pre-fill, rate can be changed.
4. Build a template with an owner party (company + external permission
   template), folders and a two-level location tree; create a project from it
   → parties, folders, locations and the creator's assignment are in place.
5. A QS cannot open `/company/*` (redirected) but still sees vendors in the
   material supplier suggestions.

## Known limits

- Cost codes are a master list only; linking CostRecord/BOQ items to codes is a
  later card (financial parity).
- Template `assignments` reference existing users; role-based defaults for
  future members are not stored.
