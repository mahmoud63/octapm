const express = require("express");
const multer = require("multer");
const request = require("supertest");
const { Prisma } = require("@prisma/client");
const { errorHandler, toClientError, isDatabaseInputError, isQueryFault } = require("../error-handler");
const { HttpError } = require("../../utils/http-error");

/**
 * CERT-2: no input may answer 5xx, and no answer carries Prisma's text.
 *
 * A value of the request the database cannot take — a date that is not a
 * date, an array where one value belongs, a NUL, a lone surrogate, a figure
 * beyond its column — reaches Prisma and used to answer 500 with Prisma's own
 * message (outside production). Each class is now 400 VALIDATION_ERROR with a
 * generic sentence in every environment; P2002 stays 409 CONFLICT and P2025
 * 404 NOT_FOUND without Prisma's words; a genuine server fault stays 500 and
 * still never echoes Prisma. busboy's refusal of a malformed multipart body
 * is 400.
 */

const clientVersion = "6.19.3";
const known = (code, message = `Invalid \`prisma.thing.create()\` invocation: code ${code} on column "secret_column"`, meta) =>
  new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion, meta });
const unknown = (pgCode, pgMessage = "detail") =>
  new Prisma.PrismaClientUnknownRequestError(
    `\nInvalid \`tx.attachment.upsert()\` invocation in\nC:\\x\\src\\services\\attachment.service.js:486:46\n\nError occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "${pgCode}", message: "${pgMessage}", severity: "ERROR", detail: None, column: None, hint: None }), transient: false })`,
    { clientVersion },
  );
const validation = (text) =>
  new Prisma.PrismaClientValidationError(`\nInvalid \`tx.project.update()\` invocation in\nC:\\x\\src\\services\\project.service.js:778:24\n\n${text}`, { clientVersion });

/** Prisma's words, the engine's, the database's or a source path: none may reach a client. */
const PRISMA_TEXT = /Invalid `|invocation|prisma|Prisma|PostgresError|ConnectorError|secret_column|\.service\.js|P20\d\d|InvalidArg|22P05|22021|22003|INT4|ToSql/;

const ENVIRONMENTS = ["development", "production", "test"];

const answerFor = async (err, env) => {
  process.env.NODE_ENV = env;
  const app = express();
  app.get("/boom", (_req, _res, next) => next(err));
  app.use(errorHandler);
  return request(app).get("/boom");
};

describe("error handler — values the database cannot take (CERT-2)", () => {
  const original = process.env.NODE_ENV;
  let stderr;
  let consoleError;
  beforeEach(() => {
    stderr = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    stderr.mockRestore();
    consoleError.mockRestore();
    process.env.NODE_ENV = original;
  });

  const INPUT_ERRORS = [
    ["PrismaClientValidationError: a Date object that is invalid", () => validation("Invalid value for argument `startDate`: Provided Date object is invalid. Expected Date.")],
    ["PrismaClientValidationError: an array where one value belongs", () => validation("Argument `ref`: Invalid value provided. Expected String, provided (String, String).")],
    ["P2000 value too long", () => known("P2000")],
    ["P2003 foreign key", () => known("P2003", "Foreign key constraint violated on the constraint: `Rfi_activityId_fkey`", { field_name: "Rfi_activityId_fkey (index)" })],
    ["P2006 invalid value", () => known("P2006")],
    ["P2007 data validation", () => known("P2007")],
    ["P2019 input error", () => known("P2019")],
    ["P2020 value out of range", () => known("P2020")],
    ["P2023 inconsistent column data", () => known("P2023")],
    ["InvalidArg: a lone UTF-16 surrogate", () => known("InvalidArg", "Invalid `tx.rfi.create()` invocation: Failed to convert JavaScript value `String \"\\ud800\"` into rust type `String`")],
    ["Postgres 22003 numeric overflow", () => unknown("22003", "numeric field overflow")],
    ["Postgres 22021 invalid byte sequence (NUL in text)", () => unknown("22021", "invalid byte sequence for encoding \\\"UTF8\\\": 0x00")],
    ["Postgres 22P05 unsupported Unicode escape (NUL in JSON)", () => unknown("22P05", "unsupported Unicode escape sequence")],
    ["Postgres 22007 invalid datetime format", () => unknown("22007", "invalid input syntax for type timestamp")],
    ["Postgres 22008 datetime field overflow", () => unknown("22008", "date/time field value out of range")],
    ["Postgres 22001 string too long", () => unknown("22001", "value too long for type character varying(40)")],
    ["Postgres 22P02 invalid text representation", () => unknown("22P02", "invalid input syntax for type uuid")],
    ["P2010 raw query failed with 22P05 (meta.code)", () => known("P2010", "Raw query failed. Code: `22P05`. Message: `unsupported Unicode escape sequence`", { code: "22P05", message: "unsupported Unicode escape sequence" })],
    ["P2010 raw query failed with 22021 (message only)", () => known("P2010", "Raw query failed. Code: `22021`. Message: `invalid byte sequence`")],
    [
      "the engine's ToSql conversion error (an integer too large for an INT4 column)",
      () =>
        new Prisma.PrismaClientUnknownRequestError(
          "\nInvalid `tx.activity.update()` invocation in\nC:\\x\\src\\services\\activity.service.js:575:5\n\nError occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(Error { kind: ToSql(0), cause: Some(Error { kind: ConversionError(\"Unable to fit integer value '8640000000000000' into an INT4 (32-bit signed integer).\"), original_code: None, original_message: None }) }), transient: false })",
          { clientVersion },
        ),
    ],
  ];

  describe.each(ENVIRONMENTS)("in %s", (env) => {
    it.each(INPUT_ERRORS)("%s answers 400 VALIDATION_ERROR with no Prisma text", async (_label, make) => {
      const res = await answerFor(make(), env);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.message).toBe("The request contains a value that cannot be stored.");
      expect(res.text).not.toMatch(PRISMA_TEXT);
    });

    it("P2002 stays 409 CONFLICT, without Prisma's message", async () => {
      const res = await answerFor(known("P2002", "Unique constraint failed on the fields: (`projectId`,`ref`)", { target: ["projectId", "ref"] }), env);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
      expect(res.text).not.toMatch(PRISMA_TEXT);
      expect(res.text).not.toMatch(/Unique constraint|projectId/);
    });

    it("P2025 stays 404 NOT_FOUND, without Prisma's message", async () => {
      const res = await answerFor(known("P2025", "An operation failed because it depends on one or more records that were required but not found. Record to update not found."), env);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
      expect(res.text).not.toMatch(/Record to update|records that were required/);
    });

    const SERVER_FAULTS = [
      ["P2024 connection pool timeout", () => known("P2024", "Timed out fetching a new connection from the connection pool. secret_column")],
      ["P2034 write conflict", () => known("P2034")],
      ["PrismaClientUnknownRequestError 40001 serialization failure", () => unknown("40001", "could not serialize access")],
      ["PrismaClientUnknownRequestError 23514 check violation", () => unknown("23514", "new row violates check constraint")],
      ["PrismaClientInitializationError", () => new Prisma.PrismaClientInitializationError("Can't reach database server at `db.internal:5432` prisma", clientVersion)],
      ["PrismaClientRustPanicError", () => new Prisma.PrismaClientRustPanicError("PANIC: secret_column in query engine", clientVersion)],
    ];
    it.each(SERVER_FAULTS)("a genuine server fault (%s) stays 500 INTERNAL_ERROR and never echoes Prisma", async (_label, make) => {
      const res = await answerFor(make(), env);
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("INTERNAL_ERROR");
      expect(res.text).not.toMatch(PRISMA_TEXT);
      expect(res.text).not.toMatch(/db\.internal|PANIC|serialize|check constraint/);
    });
  });

  it("outside production a non-Prisma fault is still shown to the developer as it was", async () => {
    const res = await answerFor(new TypeError("payload.notes.trim is not a function"), "development");
    expect(res.status).toBe(500);
    expect(res.text).toContain("payload.notes.trim is not a function");
  });

  it("in production a database input refusal is logged as a warning line with the Prisma error kept", async () => {
    await answerFor(unknown("22P05", "unsupported Unicode escape sequence"), "production");
    const lines = stderr.mock.calls.map(([chunk]) => String(chunk));
    const line = lines.map((l) => JSON.parse(l)).find((l) => l.msg === "database_input_refused");
    expect(line).toBeDefined();
    expect(line.level).toBe("warn");
    expect(line.status).toBe(400);
    expect(line.message).toContain("22P05");
  });

  it("classifies exactly: an input class is input, a fault is not, a non-Prisma error is not", () => {
    // A validation error whose explanation is not one of Prisma's value
    // refusals is no longer assumed to be the caller's (robustness-6): "x"
    // names no value, so it is a fault.
    expect(isDatabaseInputError(validation("x"))).toBe(false);
    expect(isDatabaseInputError(validation("Argument `ref`: Invalid value provided. Expected String, provided (String, String)."))).toBe(true);
    expect(isDatabaseInputError(unknown("22003"))).toBe(true);
    expect(isDatabaseInputError(unknown("40001"))).toBe(false);
    expect(isDatabaseInputError(known("P2024"))).toBe(false);
    expect(isDatabaseInputError(Object.assign(new Error("PostgresError { code: \"22003\""), { code: "22003" }))).toBe(false);
    expect(toClientError(new HttpError(422, "X", "kept")).message).toBe("kept");
  });
});

/**
 * CERT-2 robustness-6: a PrismaClientValidationError is either a VALUE the
 * request carried (answered 400) or the service's own query naming what the
 * schema does not have (a code fault: 500, error-level log, production
 * alerting sees it). Every PrismaClientValidationError used to be answered
 * 400, which hid the second class. The texts below are Prisma 6.19's own,
 * captured from the client on the certification database (scratchpad
 * r6/prisma-classes.js): the rendered query, then the explanation as the
 * last line.
 */
describe("error handler — a value refusal and a code fault are told apart (CERT-2)", () => {
  const original = process.env.NODE_ENV;
  let stderr;
  let consoleError;
  beforeEach(() => {
    stderr = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    stderr.mockRestore();
    consoleError.mockRestore();
    process.env.NODE_ENV = original;
  });

  /** As Prisma renders it: the invocation, the query with the request's values, a blank line, the explanation. */
  const rendered = (query, explanation) =>
    new Prisma.PrismaClientValidationError(`\nInvalid \`tx.rfi.create()\` invocation in\nC:\\x\\src\\services\\rfi.service.js:367:34\n\n${query}\n\n${explanation}`, { clientVersion });

  const VALUE_REFUSALS = [
    ["an invalid Date", "Invalid value for argument `createdAt`: Provided Date object is invalid. Expected Date."],
    ["an array where a string belongs", "Argument `name`: Invalid value provided. Expected StringFilter or String, provided (String, String)."],
    ["a string where an Int belongs", "Argument `take`: Invalid value provided. Expected Int, provided String."],
    ["a string that is not a DateTime", "Invalid value for argument `createdAt`: input contains invalid characters. Expected ISO-8601 DateTime."],
    ["a number where a string belongs", "Argument `name`: Invalid value provided. Expected StringFilter or String, provided Int."],
    ["a boolean where a string belongs", "Argument `id`: Invalid value provided. Expected StringFilter or String, provided Boolean."],
    ["null in a list of strings", "Argument `in`: Invalid value provided. Expected ListStringFieldRefInput, provided (String, Null)."],
    ["a word outside an enum", "Invalid value for argument `role`. Expected ProjectPartyRole."],
    ["a string that is not a Decimal", "Invalid value for argument `tax`: invalid digit found in string. Expected decimal String."],
    ["null for a required column", "Argument `subject` must not be null."],
  ];
  const QUERY_FAULTS = [
    ["an unknown argument", "Unknown argument `bogusColumn`. Available options are marked with ?."],
    ["a missing argument", "Argument `where` is missing."],
    ["an unknown field in select", "Unknown field `bogusField` for select statement on model `Project`. Available options are marked with ?."],
    ["an unknown relation in include", "Unknown field `bogusRelation` for include statement on model `Project`. Available options are marked with ?."],
    ["a where-unique without its unique field", "Argument `where` of type ProjectWhereUniqueInput needs at least one of `id`, `inboundEmailToken` or `id_orgId` arguments. Available options are marked with ?."],
    ["select and include together", "Please either use `include` or `select`, but not both at the same time."],
    ["an explanation Prisma has not been seen to give", "Something new from the engine."],
  ];

  describe.each(ENVIRONMENTS)("in %s", (env) => {
    it.each(VALUE_REFUSALS)("a value refusal (%s) answers 400 VALIDATION_ERROR, the generic sentence, no Prisma text", async (_label, explanation) => {
      const err = rendered('{\n  data: {\n    subject: "kept"\n  }\n}', explanation);
      expect(isDatabaseInputError(err)).toBe(true);
      expect(isQueryFault(err)).toBe(false);
      const res = await answerFor(err, env);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.message).toBe("The request contains a value that cannot be stored.");
      expect(res.text).not.toMatch(PRISMA_TEXT);
      expect(res.text).not.toMatch(/Argument `|Expected |Provided Date/);
    });

    it.each(QUERY_FAULTS)("a code fault (%s) answers 500 INTERNAL_ERROR, the catalogue's sentence, no Prisma text", async (_label, explanation) => {
      const err = rendered("{\n  where: {\n    bogusColumn: 1\n  }\n}", explanation);
      expect(isDatabaseInputError(err)).toBe(false);
      expect(isQueryFault(err)).toBe(true);
      const res = await answerFor(err, env);
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("INTERNAL_ERROR");
      expect(res.text).not.toMatch(PRISMA_TEXT);
      expect(res.text).not.toMatch(/Unknown (argument|field)|is missing|bogus|Available options/);
    });
  });

  it("only Prisma's explanation counts: a request value that reads like a value refusal does not excuse a fault", () => {
    const err = rendered('{\n  where: {\n    name: "Invalid value provided. Expected String\\n\\nArgument `x`: Invalid value",\n    bogusColumn: 1\n  }\n}', "Unknown argument `bogusColumn`. Available options are marked with ?.");
    expect(isDatabaseInputError(err)).toBe(false);
    expect(isQueryFault(err)).toBe(true);
  });

  it("the engine's refusal to convert a Date outside years 1-9999, or a Decimal NaN, is the caller's value: 400 (the dateInput backstop)", async () => {
    const conversion = (type, value) =>
      new Prisma.PrismaClientUnknownRequestError(
        `\nInvalid \`prisma.rfi.findMany()\` invocation in\nC:\\x\\src\\services\\rfi.service.js:300:16\n\n  297 const page = await prisma.rfi.findMany(\nCould not convert argument value Object {"$type": String("${type}"), "value": String("${value}")} to ArgumentValue.`,
        { clientVersion },
      );
    for (const env of ENVIRONMENTS) {
      for (const err of [conversion("DateTime", "+010000-01-01T13:59:59.000Z"), conversion("DateTime", "-000001-12-31T10:00:00.000Z"), conversion("Decimal", "NaN"), conversion("Decimal", "Infinity")]) {
        expect(isDatabaseInputError(err)).toBe(true);
        const res = await answerFor(err, env);
        expect(res.status).toBe(400);
        expect(res.body.error.message).toBe("The request contains a value that cannot be stored.");
        expect(res.text).not.toMatch(/\$type|ArgumentValue|010000|invocation/);
      }
    }
    // The same words outside the explanation, or another kind of engine error, are not taken for it.
    expect(isDatabaseInputError(unknown("40001", 'Could not convert argument value Object {"$type": String("DateTime")'))).toBe(false);
  });

  it("in production a code fault is logged at error level as database_query_fault, with Prisma's text kept in the log only", async () => {
    const res = await answerFor(rendered("{}", "Unknown argument `bogusColumn`. Available options are marked with ?."), "production");
    expect(res.status).toBe(500);
    const lines = stderr.mock.calls.map(([chunk]) => JSON.parse(String(chunk)));
    const line = lines.find((l) => l.msg === "database_query_fault");
    expect(line).toBeDefined();
    expect(line.level).toBe("error");
    expect(line.status).toBe(500);
    expect(line.message).toContain("Unknown argument `bogusColumn`");
    expect(lines.some((l) => l.msg === "database_input_refused")).toBe(false);
  });

  it("in production a value refusal stays a warning line, not an error", async () => {
    await answerFor(rendered("{}", "Argument `take`: Invalid value provided. Expected Int, provided String."), "production");
    const lines = stderr.mock.calls.map(([chunk]) => JSON.parse(String(chunk)));
    expect(lines.map((l) => [l.msg, l.level])).toEqual([["database_input_refused", "warn"]]);
  });

  it("outside production a code fault is printed for the developer, while the client still sees no Prisma text", async () => {
    const res = await answerFor(rendered("{}", "Argument `where` is missing."), "development");
    expect(res.status).toBe(500);
    expect(res.text).not.toMatch(/is missing|Invalid `/);
    expect(consoleError.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("Argument `where` is missing.");
  });
});

describe("error handler — a multipart body busboy cannot parse (CERT-2)", () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  const buildApp = () => {
    const app = express();
    app.post("/upload", multer({ storage: multer.memoryStorage() }).single("file"), (req, res) => res.json({ ok: true, name: req.file?.originalname }));
    app.use(errorHandler);
    return app;
  };
  const raw = (filenameBytes) => {
    const boundary = "----r5boundary";
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="`, "latin1");
    const rest = Buffer.from(`"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`, "latin1");
    return { boundary, body: Buffer.concat([head, filenameBytes, rest]) };
  };

  it.each(ENVIRONMENTS)("a NUL in a part's filename header answers 400 VALIDATION_ERROR, not 500 (%s)", async (env) => {
    process.env.NODE_ENV = env;
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    const { boundary, body } = raw(Buffer.from([0x61, 0x00, 0x62, 0x2e, 0x74, 0x78, 0x74]));
    const res = await request(buildApp()).post("/upload").set("content-type", `multipart/form-data; boundary=${boundary}`).send(body);
    consoleError.mockRestore();
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toBe("The multipart body is malformed.");
  });

  it("a body cut short answers 400, a clean upload is accepted", async () => {
    process.env.NODE_ENV = "development";
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    const { boundary, body } = raw(Buffer.from("clean.txt"));
    const cut = await request(buildApp()).post("/upload").set("content-type", `multipart/form-data; boundary=${boundary}`).send(body.subarray(0, body.length - 20));
    const clean = await request(buildApp()).post("/upload").set("content-type", `multipart/form-data; boundary=${boundary}`).send(body);
    consoleError.mockRestore();
    expect(cut.status).toBe(400);
    expect(clean.status).toBe(200);
    expect(clean.body.name).toBe("clean.txt");
  });

  it("the same sentence raised outside busboy is not taken for a parse error", () => {
    process.env.NODE_ENV = "production";
    const clientError = toClientError(new Error("Malformed part header"));
    expect(clientError.status).toBe(500);
  });
});
