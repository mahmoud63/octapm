# QA / UAT Checklist

## Authentication
- [ ] Register a new user.
- [ ] Log in with valid credentials.
- [ ] Reject invalid credentials with structured error.
- [ ] Refresh session without exposing refresh token in response body.
- [ ] Log out and confirm revoked session.
- [ ] Request password reset and complete reset through email provider.
- [ ] Accept invitation token and join correct company/project.

## Company / Project Setup
- [ ] Create company profile.
- [ ] Add company users.
- [ ] Create project with dates, budget, location, and team.
- [ ] Edit project metadata.
- [ ] Archive/close project and verify dashboards exclude archived items.
- [ ] Confirm users cannot access unassigned projects.

## User Roles / Permissions
- [ ] PM can access all project modules.
- [ ] Planning Engineer can manage schedule/progress within allowed scope.
- [ ] QS/Cost Controller/Finance visibility matches financial permissions.
- [ ] Procurement/Warehouse visibility matches procurement and material permissions.
- [ ] Site Engineer can submit assigned progress/site reports only.
- [ ] Consultant/subcontractor can only access party-routed RFIs/submittals/documents.
- [ ] Cross-company and cross-project API requests are denied.

## Documents
- [ ] Upload document.
- [ ] Download document.
- [ ] Preview document.
- [ ] Edit metadata.
- [ ] Search/filter by status/category.
- [ ] Create revision and supersede previous revision.
- [ ] Verify drawing revision behavior.
- [ ] Verify denied users cannot download files.

## RFIs
- [ ] Create RFI.
- [ ] Verify numbering.
- [ ] Assign responsible party.
- [ ] Add due date and attachments.
- [ ] Submit question.
- [ ] Respond as responsible party.
- [ ] Review/approve/reject response.
- [ ] Close RFI.
- [ ] Verify overdue tracking, notifications, and audit trail.

## Submittals
- [ ] Create submittal package.
- [ ] Attach documents.
- [ ] Submit for consultant review.
- [ ] Approve, reject, and request resubmission.
- [ ] Verify revision tracking.
- [ ] Verify due dates, notifications, and audit history.

## Daily Reports
- [ ] Create daily report.
- [ ] Record weather.
- [ ] Record manpower and equipment.
- [ ] Record work performed by activity.
- [ ] Record material deliveries.
- [ ] Upload site photos.
- [ ] Record delays/issues and safety observations.
- [ ] Submit for approval/signoff.
- [ ] Export/share report.

## Tasks
- [ ] Create task.
- [ ] Assign task.
- [ ] Set due date, priority, and status.
- [ ] Add comments and attachments.
- [ ] Verify overdue tracking and notifications.
- [ ] Verify project-scoped task access.

## Schedule
- [ ] Import P6 XER, P6 XML, and MSP XML samples.
- [ ] Generate AI schedule if enabled.
- [ ] Verify activities, dependencies, milestones, and critical path.
- [ ] Update progress.
- [ ] Verify baseline vs actual.
- [ ] Verify EV metrics and schedule reports.

## Cost / Change Orders
- [ ] Create budget/cost codes.
- [ ] Record commitments and actual costs.
- [ ] Create change request with cost and schedule impact.
- [ ] Approve/reject change order.
- [ ] Verify budget/contract updates only after approval.
- [ ] Create IPC/payment application.
- [ ] Verify retention and payment status.
- [ ] Verify financial audit trail and role visibility.

## QA/QC
- [ ] Create inspection/checklist.
- [ ] Create NCR.
- [ ] Attach photo evidence.
- [ ] Assign responsible party and due date.
- [ ] Close with approval.
- [ ] Verify quality score and dashboard impact.

## Safety
- [ ] Create incident/observation.
- [ ] Add corrective action.
- [ ] Assign responsible party.
- [ ] Attach photos.
- [ ] Close and report.

## Dashboards
- [ ] Verify executive/project dashboard numbers against source records.
- [ ] Verify open RFIs and pending submittals.
- [ ] Verify overdue tasks and document status.
- [ ] Verify cost variance, schedule status, and safety issues.

## Search / Filtering
- [ ] Global search returns only permitted records.
- [ ] Project search filters by project.
- [ ] Document search filters by metadata/status.
- [ ] Lists filter by assignee, status, date, company, and project.

## Notifications
- [ ] In-app assignment notification.
- [ ] Email assignment notification.
- [ ] Due date reminder.
- [ ] Approval notification.
- [ ] Overdue alert.
- [ ] Notification does not leak records to unauthorized users.

## File Uploads
- [ ] Accept allowed file types.
- [ ] Reject disallowed file types.
- [ ] Verify size limits.
- [ ] Verify private storage path.
- [ ] Verify malware/magic-byte checks where configured.

## Mobile / Tablet
- [ ] Project dashboard usable on tablet.
- [ ] Daily report usable on tablet/phone.
- [ ] Progress update usable on tablet/phone.
- [ ] Photo upload works from field device.
- [ ] No critical text overlap or clipped controls.

## Security
- [ ] Run auth negative tests.
- [ ] Run role negative tests.
- [ ] Run cross-project/company API negative tests.
- [ ] Run file access negative tests.
- [ ] Run secret hygiene validator.
- [ ] Confirm no secrets appear in logs or reports.

## Regression
- [ ] Backend Jest green.
- [ ] Frontend lint green.
- [ ] Typecheck green.
- [ ] Build green.
- [ ] OpenAPI validate green.
- [ ] Prisma validate green.

## Deployment Smoke Test
- [ ] Deploy certified commit to staging.
- [ ] Health check passes.
- [ ] Authenticated smoke user logs in.
- [ ] Smoke project opens.
- [ ] BOQ and schedule load.
- [ ] Notification provider test passes.
- [ ] Rollback rehearsal completed.
