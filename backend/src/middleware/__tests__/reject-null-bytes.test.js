const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const multer = require("multer");
const request = require("supertest");
const { rejectNullBytes, requestHasDisallowed, requestRefusal, hasDisallowed, inspectValue, MAX_BODY_DEPTH } = require("../reject-null-bytes");
const { errorHandler } = require("../error-handler");

/**
 * CERT-2: a NUL (U+0000) in any field reaches Postgres and answers 500
 * (22P05 / 22021); a lone UTF-16 surrogate fails in the query engine
 * (InvalidArg, 500). The guard refuses the request with 400 VALIDATION_ERROR
 * before any route runs, whether the character is in the JSON body (at any
 * depth), a query parameter, the path or an object key — and, run again after
 * multer, in a multipart body's text fields and file names — and lets every
 * clean request through.
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(rejectNullBytes);
  app.all("/projects/:projectId/echo/:id", (req, res) => res.json({ ok: true, body: req.body, query: req.query, params: req.params }));
  app.use(errorHandler);
  return app;
}

const nested = (depth, leaf) => {
  let value = leaf;
  for (let i = 0; i < depth; i += 1) value = i % 2 ? [value] : { n: value };
  return value;
};

describe("reject-null-bytes guard (CERT-2)", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
  });

  const refusedBody = (res) => res.status === 400 && res.body?.error?.code === "VALIDATION_ERROR";

  it("refuses a NUL in a top-level text body field", async () => {
    const res = await request(buildApp()).post("/projects/p1/echo/x").send({ subject: "a\u0000b" });
    expect(refusedBody(res)).toBe(true);
  });

  it("refuses a NUL nested in a JSON object or array body field", async () => {
    for (const body of [{ evidence: { note: "n\u0000ul" } }, { items: ["ok", "bad\u0000"] }, { nested: { a: { b: ["\u0000"] } } }, { "key\u0000": "v" }]) {
      const res = await request(buildApp()).post("/projects/p1/echo/x").send(body);
      expect(refusedBody(res)).toBe(true);
    }
  });

  it.each([12, 13, 20, 200, 5000])("refuses a NUL nested %i levels deep (the scan has no depth limit)", async (depth) => {
    const res = await request(buildApp()).post("/projects/p1/echo/x").send({ documentsJson: nested(depth, "a\u0000b") });
    expect(refusedBody(res)).toBe(true);
  });

  it("refuses a NUL in an object key nested deeper than the old limit", async () => {
    let value = { "k\u0000": 1 };
    for (let i = 0; i < 30; i += 1) value = { n: value };
    expect(refusedBody(await request(buildApp()).post("/projects/p1/echo/x").send(value))).toBe(true);
  });

  it("refuses a lone UTF-16 surrogate in a value or a key, at any depth", async () => {
    for (const body of [{ subject: "a\ud800b" }, { subject: "a\udc00" }, { subject: "\udbff" }, { deep: nested(40, "x\udfffy") }, { "k\ud801": "v" }]) {
      const res = await request(buildApp()).post("/projects/p1/echo/x").set("content-type", "application/json").send(JSON.stringify(body));
      expect(refusedBody(res)).toBe(true);
    }
  });

  it("lets a well-formed surrogate pair (an emoji) and other non-ASCII text through", async () => {
    const res = await request(buildApp()).post("/projects/p1/echo/x").send({ subject: "Pour complete 👍 — façade, 東京" });
    expect(res.status).toBe(200);
    expect(res.body.body.subject).toBe("Pour complete 👍 — façade, 東京");
  });

  it("refuses a NUL in a query parameter (raw %00 and nested array)", async () => {
    expect(refusedBody(await request(buildApp()).get("/projects/p1/echo/x?search=a%00b"))).toBe(true);
    expect(refusedBody(await request(buildApp()).get("/projects/p1/echo/x?activityId=a%00&activityId=b"))).toBe(true);
  });

  it("refuses a NUL in a path segment", async () => {
    expect(refusedBody(await request(buildApp()).get("/projects/p1/echo/%00"))).toBe(true);
  });

  it("lets a clean request through unchanged", async () => {
    const res = await request(buildApp()).post("/projects/p1/echo/abc?search=hello&n=3").send({ subject: "Clean subject", evidence: { note: "fine" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, body: { subject: "Clean subject" }, params: { id: "abc" } });
  });

  /**
   * robustness-6: a NUL-free body nested 5,000 levels passed the guard and
   * the Prisma client's recursive serialiser answered 500 "Maximum call stack
   * size exceeded" (an array nested 5,000 levels in a text field did the same
   * in express-validator's sanitizer). The guard refuses a body nested deeper
   * than MAX_BODY_DEPTH in the same walk; the deepest body any client sends
   * is 6 levels.
   */
  // A body nested exactly `levels` deep: the body is level 1, documentsJson's outermost object level 2, …
  const deepText = (levels, leaf = '"leaf"') => `{"documentsJson":${'{"n":'.repeat(levels - 1)}${leaf}${"}".repeat(levels - 1)}}`;

  it("lets a body nested exactly MAX_BODY_DEPTH levels through, and refuses one level more", async () => {
    expect(MAX_BODY_DEPTH).toBe(256);
    expect(inspectValue(JSON.parse(deepText(MAX_BODY_DEPTH)))).toBe(null);
    expect(inspectValue(JSON.parse(deepText(MAX_BODY_DEPTH + 1)))).toBe("depth");
    const at = await request(buildApp()).post("/projects/p1/echo/x").set("content-type", "application/json").send(deepText(MAX_BODY_DEPTH));
    expect(at.status).toBe(200);
    const over = await request(buildApp()).post("/projects/p1/echo/x").set("content-type", "application/json").send(deepText(MAX_BODY_DEPTH + 1));
    expect(refusedBody(over)).toBe(true);
    expect(over.body.error.message).toBe(`The request body is nested more than ${MAX_BODY_DEPTH} levels deep.`);
  });

  // (The test app's express.json() keeps its default 100 kB limit: 15,000 levels is 75 kB of "{"n":".)
  it.each([1000, 5000, 15000])("refuses a NUL-free body nested %i levels, objects or arrays", async (levels) => {
    const objects = await request(buildApp()).post("/projects/p1/echo/x").set("content-type", "application/json").send(deepText(levels));
    expect(refusedBody(objects)).toBe(true);
    const arrays = await request(buildApp()).post("/projects/p1/echo/x").set("content-type", "application/json").send(`{"subject":${"[".repeat(levels)}1${"]".repeat(levels)}}`);
    expect(refusedBody(arrays)).toBe(true);
  });

  it("measures depth the same way in an array of objects and an object of arrays", () => {
    const mixed = (levels) => {
      let value = "leaf";
      for (let i = 0; i < levels; i += 1) value = i % 2 ? [value] : { n: value };
      return value;
    };
    expect(inspectValue(mixed(MAX_BODY_DEPTH))).toBe(null);
    expect(inspectValue(mixed(MAX_BODY_DEPTH + 1))).toBe("depth");
    expect(inspectValue({ wide: Array.from({ length: 10000 }, (_, i) => ({ i, tags: ["a", "b"] })) })).toBe(null);
  });

  it.each([
    ['{"subject":{"toString":null}}'],
    ['{"owner":{"toString":0}}'],
    ['{"method":{"toString":"x"}}'],
    ['{"lines":[{"amount":{"valueOf":1,"toString":false}}]}'],
    ['{"meta":{"deep":[{"valueOf":null}]}}'],
  ])("refuses an object with its own toString / valueOf key (%s): every conversion of it throws", async (text) => {
    const res = await request(buildApp()).post("/projects/p1/echo/x").set("content-type", "application/json").send(text);
    expect(refusedBody(res)).toBe(true);
    expect(res.body.error.message).toBe("The request contains a field named toString or valueOf, which is not allowed.");
  });

  it("lets the words toString and valueOf through as values, and keys that only resemble them", async () => {
    const res = await request(buildApp()).post("/projects/p1/echo/x").send({ subject: "toString", note: "valueOf", meta: { tostring: 1, to_string: 2, ToString: 3 } });
    expect(res.status).toBe(200);
  });

  it("hasDisallowed scans iteratively: a structure far deeper than a recursion could follow", () => {
    let value = "clean";
    for (let i = 0; i < 100000; i += 1) value = [value];
    expect(hasDisallowed(value)).toBe(false);
    let bad = "a\u0000";
    for (let i = 0; i < 100000; i += 1) bad = { n: bad };
    expect(hasDisallowed(bad)).toBe(true);
  });
});

describe("reject-null-bytes guard after multer (CERT-2)", () => {
  let dir;
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "r5-upload-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const buildUploadApp = () => {
    const app = express();
    app.use(express.json());
    app.use(rejectNullBytes); // the application-level guard sees nothing of a multipart body
    const upload = multer({ storage: multer.diskStorage({ destination: dir, filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random()}.bin`) }) });
    app.post("/upload", upload.array("files", 5), rejectNullBytes, (req, res) => res.json({ ok: true, caption: req.body.caption, names: (req.files || []).map((f) => f.originalname) }));
    app.use(errorHandler);
    return app;
  };
  const leftOnDisk = () => fs.readdirSync(dir);

  it("refuses a NUL in a multipart text field (caption, clientRequestId, recordId) and keeps no file", async () => {
    for (const field of ["caption", "clientRequestId", "recordId"]) {
      const res = await request(buildUploadApp()).post("/upload").field(field, "r5\u0000x").attach("files", Buffer.from("hello"), "note.txt");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(leftOnDisk()).toEqual([]);
  });

  it("refuses a NUL in a file's name given as filename* (RFC 5987), and removes the file multer wrote", async () => {
    const boundary = "----r5boundary";
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename*=UTF-8''a%00b.txt\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`,
      "latin1",
    );
    const res = await request(buildUploadApp()).post("/upload").set("content-type", `multipart/form-data; boundary=${boundary}`).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(leftOnDisk()).toEqual([]);
  });

  it("lets a clean multipart upload through, its file kept for the route", async () => {
    const res = await request(buildUploadApp()).post("/upload").field("caption", "Level 2 slab 👍").attach("files", Buffer.from("hello"), "note.txt");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, caption: "Level 2 slab 👍", names: ["note.txt"] });
    expect(leftOnDisk().length).toBe(1);
  });

  /**
   * robustness-6: multer builds an object with no prototype for a field named
   * "x[k]" (express-validator's next standard check then throws "Cannot
   * convert object to primitive value", a 500) and an array for "x[]",
   * "x[0]" or a field sent twice. A multipart field is one string; only the
   * attachment door's lists (tags, documentIds) may be repeated strings.
   */
  const buildFieldsApp = () => {
    const app = express();
    app.use(express.json());
    app.use(rejectNullBytes);
    const upload = multer({ storage: multer.diskStorage({ destination: dir, filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random()}.bin`) }) });
    app.post("/upload", upload.array("files", 5), rejectNullBytes, (req, res) => res.json({ ok: true, fields: Object.fromEntries(Object.entries(req.body)) }));
    app.use(errorHandler);
    return app;
  };

  it.each([
    ["caption[k]", "caption"],
    ["recordId[k]", "recordId"],
    ["pageNumber[k]", "pageNumber"],
    ["caption[]", "caption"],
    ["caption[0]", "caption"],
    ["tags[k]", "tags"],
    ["tags[0][k]", "tags"],
  ])("refuses a multipart field %s with 400 naming %s, and keeps no file", async (name, field) => {
    const res = await request(buildFieldsApp()).post("/upload").field(name, "1").attach("files", Buffer.from("hello"), "note.txt");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details).toEqual([{ field, message: "must be text", location: "body" }]);
    expect(leftOnDisk()).toEqual([]);
  });

  it("refuses a text field sent twice, and takes repeated tags and documentIds as lists", async () => {
    const twice = await request(buildFieldsApp()).post("/upload").field("caption", "a").field("caption", "b").attach("files", Buffer.from("x"), "a.txt");
    expect(twice.status).toBe(400);
    expect(twice.body.error.details[0].field).toBe("caption");
    const lists = await request(buildFieldsApp())
      .post("/upload")
      .field("recordType", "rfi")
      .field("caption", "Level 2")
      .field("tags", "pour")
      .field("tags", "slab")
      .field("documentIds", "d1")
      .field("documentIds", "d2")
      .attach("files", Buffer.from("x"), "a.txt");
    expect(lists.status).toBe(200);
    expect(lists.body.fields).toEqual({ recordType: "rfi", caption: "Level 2", tags: ["pour", "slab"], documentIds: ["d1", "d2"] });
  });

  it("requestHasDisallowed reads the body, the query, the URL and the files' names", () => {
    const req = (extra) => ({ originalUrl: "/x", query: {}, body: {}, ...extra });
    expect(requestHasDisallowed(req({}))).toBe(false);
    expect(requestHasDisallowed(req({ body: { a: nested(30, "\u0000") } }))).toBe(true);
    expect(requestHasDisallowed(req({ query: { q: "\ud800" } }))).toBe(true);
    expect(requestHasDisallowed(req({ originalUrl: "/x?a=%00" }))).toBe(true);
    expect(requestHasDisallowed(req({ files: [{ originalname: "a\u0000.pdf", fieldname: "files" }] }))).toBe(true);
    expect(requestHasDisallowed(req({ files: { attachments: [{ originalname: "ok.pdf", fieldname: "f\u0000" }] } }))).toBe(true);
    expect(requestHasDisallowed(req({ file: { originalname: "ok.pdf", fieldname: "file" } }))).toBe(false);
  });

  it("requestRefusal without characters judges only the body's shape (the inbound e-mail door, before verification)", () => {
    const req = (extra) => ({ originalUrl: "/x", query: {}, body: {}, headers: { "content-type": "multipart/form-data; boundary=x" }, ...extra });
    const deep = JSON.parse(`${'{"n":'.repeat(300)}1${"}".repeat(300)}`);
    expect(requestRefusal(req({ body: { subject: "a\u0000" } }), { characters: false })).toBe(null);
    expect(requestRefusal(req({ body: { subject: "a\u0000" } }))?.message).toBe("The request contains a disallowed character.");
    expect(requestRefusal(req({ body: { signature: { timestamp: { toString: null } } } }), { characters: false })?.status).toBe(400);
    expect(requestRefusal(req({ body: deep }), { characters: false })?.status).toBe(400);
    // A provider's multipart form is the inbound door's own to read.
    const form = Object.assign(Object.create(null), { to: ["a@x.test", "b@x.test"] });
    expect(requestRefusal(req({ body: form }), { multipartText: false })).toBe(null);
    expect(requestRefusal(req({ body: form }))?.details).toEqual([{ field: "to", message: "must be text", location: "body" }]);
  });

  /**
   * availability-7: multer builds an array from a bracketed index as written,
   * so "x[100000000]" is an array of length 100,000,001 holding one element.
   * The walk counted to its length — 3.7 s of CPU for a request of a few
   * bytes, on the inbound e-mail door before the provider is verified. Only
   * the elements present are visited now, and a list field with a gap is no
   * repeated field of text.
   */
  const timedRequest = async (send) => {
    const started = Date.now();
    const res = await send();
    return { res, ms: Date.now() - started };
  };

  it("answers a field with a far bracketed index at once, refused as not text, and keeps no file", async () => {
    for (const name of ["zz[100000000]", "zz[4294967294]", "caption[100000000]"]) {
      const { res, ms } = await timedRequest(() => request(buildFieldsApp()).post("/upload").field(name, "1").attach("files", Buffer.from("x"), "a.txt"));
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ field: name.split("[")[0], message: "must be text", location: "body" }]);
      expect(ms).toBeLessThan(1000);
    }
    expect(leftOnDisk()).toEqual([]);
  });

  it("still refuses a NUL, a lone surrogate, a body too deep and a toString key held at a far index", async () => {
    const nul = await timedRequest(() => request(buildFieldsApp()).post("/upload").field("zz[100000000]", "a\u0000b").attach("files", Buffer.from("x"), "a.txt"));
    expect(nul.res.status).toBe(400);
    expect(nul.res.body.error.message).toBe("The request contains a disallowed character.");
    expect(nul.ms).toBeLessThan(1000);
    const key = await timedRequest(() => request(buildFieldsApp()).post("/upload").field("zz[100000000][toString]", "1").attach("files", Buffer.from("x"), "a.txt"));
    expect(key.res.status).toBe(400);
    expect(key.res.body.error.message).toBe("The request contains a field named toString or valueOf, which is not allowed.");
    expect(key.ms).toBeLessThan(1000);
    expect(leftOnDisk()).toEqual([]);
    // The same walk, on the parsed values.
    const far = (value, index = 4294967294) => {
      const list = [];
      list[index] = value;
      return list;
    };
    const started = Date.now();
    expect(inspectValue({ f: far("a\u0000b") })).toBe("character");
    expect(inspectValue({ f: far("\ud800") })).toBe("character");
    expect(inspectValue({ f: far(nested(MAX_BODY_DEPTH + 5, "x")) })).toBe("depth");
    expect(inspectValue({ f: far({ valueOf: 1 }) })).toBe("key");
    expect(inspectValue({ f: far("fine") })).toBe(null);
    expect(hasDisallowed(far("\u0000", 100000000))).toBe(true);
    expect(requestRefusal({ originalUrl: "/x", query: {}, body: { f: far("x") }, headers: { "content-type": "multipart/form-data; boundary=x" } }, { characters: false, multipartText: false })).toBe(null);
    expect(Date.now() - started).toBeLessThan(1000);
    // Elements before the gap and after it are both judged.
    const both = ["ok", "fine"];
    both[50000000] = "late\u0000";
    expect(inspectValue({ f: both })).toBe("character");
    const early = ["a\u0000"];
    early[50000000] = "fine";
    expect(inspectValue({ f: early })).toBe("character");
  });

  it("refuses a list field with a gap as not text; repeated tags are still a list", async () => {
    const gap = await timedRequest(() => request(buildFieldsApp()).post("/upload").field("tags[0]", "pour").field("tags[100000000]", "slab").attach("files", Buffer.from("x"), "a.txt"));
    expect(gap.res.status).toBe(400);
    expect(gap.res.body.error.details).toEqual([{ field: "tags", message: "must be text", location: "body" }]);
    expect(gap.ms).toBeLessThan(1000);
    const far = await request(buildFieldsApp()).post("/upload").field("documentIds[100000000]", "d1").attach("files", Buffer.from("x"), "a.txt");
    expect(far.status).toBe(400);
    expect(far.body.error.details).toEqual([{ field: "documentIds", message: "must be text", location: "body" }]);
    const listed = await request(buildFieldsApp()).post("/upload").field("tags[0]", "pour").field("tags[1]", "slab").field("tags", "deck").attach("files", Buffer.from("x"), "a.txt");
    expect(listed.status).toBe(200);
    expect(listed.body.fields.tags).toEqual(["pour", "slab", "deck"]);
    expect(leftOnDisk().length).toBe(1);
  });

  it("walks a dense array by index as before: a NUL at its end is found", () => {
    const list = Array.from({ length: 100000 }, () => "v");
    list.push("z\u0000");
    expect(inspectValue({ list })).toBe("character");
    expect(inspectValue({ list: list.slice(0, -1) })).toBe(null);
  });
});
