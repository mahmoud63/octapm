const { openApiSpec } = require("../../openapi/spec");
const { sendError, sendSuccess } = require("../api-response");
const { ERROR_CODE_CATALOG } = require("../error-codes");
const { HttpError } = require("../http-error");

const createResponse = () => {
  const res = {
    status: jest.fn(() => res),
    json: jest.fn(() => res),
  };
  return res;
};

describe("API response helpers", () => {
  it("wraps success responses in the standard envelope", () => {
    const res = createResponse();

    sendSuccess(res, { ok: true }, 201);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { ok: true },
    });
  });

  it("normalizes legacy sendError arguments to the error envelope", () => {
    const res = createResponse();

    sendError(res, 403, "PROJECT_ACCESS_DENIED", "Project is private", {
      projectId: "project-1",
    });

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: "PROJECT_ACCESS_DENIED",
        message: "Project is private",
        details: { projectId: "project-1" },
      },
    });
  });

  it("normalizes Error-like objects and can suppress details", () => {
    const res = createResponse();
    const err = new HttpError(0, undefined, undefined, {
      secret: "hidden",
    });

    sendError(res, err, undefined, undefined, undefined, {
      includeDetails: false,
    });

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected server error",
      },
    });
  });

  it("documents the runtime error code catalog in OpenAPI", () => {
    const documentedCodes = openApiSpec.components.schemas.ErrorCode.enum || [];

    expect(documentedCodes).toEqual(
      expect.arrayContaining(Object.keys(ERROR_CODE_CATALOG)),
    );
  });
});
