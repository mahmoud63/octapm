# Document Control Workflows QA

## Manual Drawing Revision Scenario

1. Open Document Control > Register and select the Drawings folder.
2. Create or select a drawing record. Confirm the selected document panel shows metadata, revision history, preview area, and upload controls without requiring raw record IDs.
3. Upload a PDF revision `A` with category, folder path, discipline, review due date, and notes through the upload form.
4. Confirm the API stores a private `ProjectDocument`, creates a `DocumentRevision`, and returns preview/download URLs under `/api/v1/projects/:projectId/doc-control/revisions/:revisionId`.
5. Submit revision `A` for review if uploaded only, then approve it as PM. Confirm it is marked `Latest`, previewable in the side panel, and downloadable.
6. Upload revision `B`, approve it as PM, and confirm revision `A` becomes `superseded` and read-only while revision `B` becomes `Latest`.
7. Sign in as Site Engineer and confirm only the current approved revision is visible/downloadable; direct access to revision `A` download or preview returns 403.
8. Verify upload, submit-review, approval, and supersede events appear in audit/history with actor role and reason/comment.

## RFI Lifecycle Scenario

1. Create an RFI, submit it, answer it with a response and attachment, then close it as PM.
2. Reopen the RFI as PM with a reason and verify history/approval events show the reopen.
3. Confirm overdue open RFIs appear in the workspace dashboard queue.

## Submittal Lifecycle Scenario

1. Create a submittal, select it from the Register, upload a file revision with metadata, then submit it for review.
2. Record a review comment while it remains under review.
3. Approve, reject, or request resubmission as PM and confirm each decision is auditable.
4. Confirm overdue pending/under-review/resubmit submittals appear in the workspace dashboard queue.

## Folder and Preview Scenario

1. Filter the Register by All documents, Drawings, Submittals, RFI, Transmittals, and Correspondence folders.
2. Confirm folder counts update with the current register filters and search terms.
3. Preview PDF, image, and text revisions inline; confirm unsupported Office/Excel files show a download fallback.
4. Confirm preview uses `/preview` and download uses `/download`, both behind project membership and document-control read permission.
