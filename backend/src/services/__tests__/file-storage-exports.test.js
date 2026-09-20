const fileStorageService = require("../file-storage.service");
const attachmentService = require("../attachment.service");

/**
 * What other services are allowed to reach for.
 *
 * `getProjectDocumentFile` was defined in file-storage.service.js and left out
 * of its `module.exports`, so every caller resolved `undefined` and threw
 * "fileStorageService.getProjectDocumentFile is not a function" at request
 * time. The effect was total and silent to the type system: no photograph,
 * no thumbnail and no attachment could be served — `GET /projects/:id/photos/
 * :photoId/thumbnail` and `/file` both answered 500, as did document text
 * extraction.
 *
 * Nothing in the unit suite noticed, because every test that touches storage
 * mocks it. This test asserts the contract itself: the functions other
 * services call must actually be on the module.
 */
describe("the file storage service exports what other services call", () => {
  it("serves a project document, which photos, attachments and document text all need", () => {
    expect(typeof fileStorageService.getProjectDocumentFile).toBe("function");
  });

  it("exports every getter a route can reach", () => {
    for (const name of [
      "getProjectDocumentFile",
      "getWorkflowFile",
      "getSiteReportingFile",
      "getBimModelFile",
      "getBoqUploadFile",
      "getImportUploadFile",
      "getScheduleGenerationFile",
    ]) {
      // Jest's expect takes no message, so the name goes in the value.
      expect({ name, type: typeof fileStorageService[name] }).toEqual({ name, type: "function" });
    }
  });

  it("leaves no attachment path calling something that is not there", () => {
    // The three call sites in attachment.service.js and the one in
    // document-text.service.js all resolve through this single export.
    expect(typeof attachmentService.getPhotoFile).toBe("function");
    expect(typeof fileStorageService.getProjectDocumentFile).toBe("function");
  });
});
