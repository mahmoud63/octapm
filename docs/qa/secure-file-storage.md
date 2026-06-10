# Secure File Storage QA

Scope: BOQ uploads, schedule generation uploads, P6/MSP/progress imports, workflow evidence, and site-reporting photos.

## Automated Checks

1. Run focused backend regression:
   `node ../node_modules/jest/bin/jest.js --runTestsByPath src/services/__tests__/file-storage.service.test.js src/services/__tests__/boq.service.test.js src/routes/__tests__/boq-upload-storage.test.js --runInBand`
2. Run Prisma validation:
   `npx prisma validate --schema prisma/schema.prisma`
3. Run OpenAPI validation:
   `node scripts/validate-openapi.js`

Expected:

- Upload routes use temporary disk files; request file objects do not expose `buffer`.
- Clean files create `ProjectDocument` metadata with `scanStatus="clean"`, SHA-256, private object key, retention expiry, and uploaded user.
- EICAR test strings return `FILE_VIRUS_DETECTED` and create no clean document row.
- Claimed Excel/PDF/image/XML types with mismatched magic bytes return `FILE_TYPE_MISMATCH`.
- BOQ revisions store `sourceDocumentId` and link the document to the created revision.

## Manual QA

1. Sign in as PM and upload a realistic BOQ workbook under 50 MB. Confirm the BOQ revision appears, the upload response includes `document.documentId`, and the document row is linked to the BOQ revision.
2. Upload a fake `.xlsx` renamed from a text file. Confirm the API returns the standard error envelope with `FILE_TYPE_MISMATCH` and the frontend shows a clear processing failure.
3. Upload an EICAR test file with an allowed extension in a non-production test environment. Confirm `FILE_VIRUS_DETECTED`.
4. Upload P6 XER, P6 XML, MSP XML, and progress import files. Confirm imports still stage revisions or progress submissions and create private document metadata.
5. Upload site-reporting photos from a site engineer account and workflow evidence from an allowed role. Confirm downloads work through authenticated API URLs and S3-backed environments redirect to short-lived presigned URLs.
6. Check S3 bucket settings in production: public access blocked, versioning enabled, TLS-only bucket policy present, server-side encryption enabled, and lifecycle retention matches release policy.
