# Private Runtime Storage Policy

Private uploaded project documents are runtime data, not source. This covers BOQ workbooks, schedule/progress imports, workflow evidence, document-control revisions, and site-reporting photos stored under local private storage paths.

## Source-Control Policy

- Do not commit files under `backend/storage/private-documents/` or `storage/private-documents/`.
- Use `ProjectDocument` metadata for org/project ownership, document type, scan status, retention policy, and storage object keys.
- Keep upload/download access behind authenticated project-scoped APIs. A valid document key must not grant access outside its `orgId` and `projectId`.
- Store production files in the approved S3-compatible private bucket with public access blocked, TLS-only access, server-side encryption, and short-lived presigned downloads.
- Store local development files only in ignored runtime storage or an explicit external directory configured with `FILE_STORAGE_LOCAL_DIR`, `SITE_REPORT_UPLOAD_DIR`, or `WORKFLOW_UPLOAD_DIR`.

## Repository Guard

Quality Gates runs:

```bash
npm run security:test:private-storage
npm run security:validate:private-storage
```

For local pre-commit checks, run:

```bash
npm run security:validate:private-storage:staged
```

The validator fails when private runtime storage files are tracked, and `--staged` fails when a staged add/rename/modify targets those paths.

## Cleanup And History Decision

Current tree cleanup must use `git rm --cached` so local copies are not deleted accidentally while the files are removed from the next source tree.

Because private uploaded documents were already tracked, history purging is required before any public repository handoff, broad clone distribution, or production launch sign-off that treats Git history as clean. Security/DevOps should coordinate the purge with repository owners using an approved history-rewrite process such as `git filter-repo` or BFG, rotate any affected credentials if documents contained them, force-push only after stakeholder approval, and require every clone/fork/cache owner to reclone or garbage-collect old objects.

Record the purge ticket, owner, date, and verification command output outside the repository. Do not store private file names, content, hashes, or sensitive excerpts in source-controlled sign-off notes.
