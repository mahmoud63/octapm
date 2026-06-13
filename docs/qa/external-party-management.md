# External Party Management QA

Source of truth:

- Company records: `Company`
- Project role links: `ProjectParty`
- External user links: `CompanyMembership` and `ProjectPartyMember`
- Permission policy: `shared/permissions.json`

## Admin Setup

1. Sign in as PM.
2. Create or edit a project.
3. In Contract Parties, assign companies for Client / Owner, Consultant, Contractor, and one Subcontractor.
4. Save and reopen the project detail page.
5. Confirm the Contract Parties panel shows company-backed names, while legacy client/consultant/contractor text fields remain populated for compatibility.

## Invite Flow

1. Open User Management.
2. Invite a consultant user with a project selected and the Consultant project party selected.
3. Accept the invitation from the invite link.
4. Confirm the accepted user has an active `CompanyMembership` and `ProjectPartyMember`.
5. Repeat for a subcontractor persona.

## Workflow Routing

1. As PM or contractor, create an RFI and route it to the Consultant project party.
2. Sign in as the consultant user.
3. Confirm only RFIs routed to that consultant company are visible.
4. Answer the routed RFI.
5. Confirm the consultant cannot close, approve, reject, or archive the RFI.
6. Create a submittal and route the reviewer to the Consultant project party.
7. Confirm the consultant can review/approve/reject according to the party policy.

## Cross-Party Denial

1. Route one RFI to Consultant A and one RFI to Consultant B.
2. Sign in as a Consultant A user.
3. Confirm Consultant B records do not appear in list responses.
4. Call direct update/answer/review URLs for Consultant B records.
5. Confirm the API returns `403 PROJECT_PARTY_RECORD_ACCESS_DENIED`.

## Regression Checks

1. PM can list and manage all project parties.
2. Planning Engineer can read project party data where policy allows, but cannot onboard external users unless granted by the permission matrix.
3. Site Engineer cannot manage project party companies.
4. Project list includes projects where a user has a ProjectAssignment or active ProjectParty membership.
5. Unassigned users still receive `403 PROJECT_ACCESS_DENIED` for direct project URLs.
