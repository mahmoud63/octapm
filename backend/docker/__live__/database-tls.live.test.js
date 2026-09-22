/**
 * What DATABASE_URL's TLS settings actually verify, on a real TLS-only
 * Postgres, through the real Prisma engine and the real node-postgres.
 *
 * The URL shape is read from .github/workflows/container-image.yml (the `base=`
 * line), because that is the contract CI and ECS use; this test is the local
 * proof that the shape authenticates the server and does not merely encrypt:
 *
 *   - Prisma trusts only the first certificate of the sslcert file, and by
 *     default (no sslaccept) accepts any certificate at all. So the contract
 *     carries sslaccept=strict and the image ships a single-root CA file
 *     picked out of the RDS bundle by docker/pick-rds-ca.cjs.
 *   - A CA that did not sign the server is refused with P1011 (asserted on the
 *     output, not just a non-zero exit, which a refused connection and a
 *     pending migration would both give).
 *   - node-postgres, given the same file as ssl.ca, reads every certificate
 *     of a bundle and verifies.
 *
 * Nothing here touches the shared local database: the cluster is a throwaway
 * embedded Postgres on a free port in the temp folder, removed afterwards.
 */
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Client } = require("pg");
const { liveDescribe, freePort } = require("../../src/__live__/helpers");
const { pick } = require("../pick-rds-ca.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "container-image.yml");
const PRISMA_CLI = require.resolve("prisma/build/index.js");
const REAL_CN = "Amazon RDS us-east-2 Root CA RSA2048 G1";

jest.setTimeout(180_000);

const findOpenssl = () => {
  const candidates = [
    process.env.OPENSSL_BIN,
    "openssl",
    "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe",
    "C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
  ].filter(Boolean);
  for (const bin of candidates) {
    const probe = spawnSync(bin, ["version"], { encoding: "utf8" });
    if (probe.status === 0) return bin;
  }
  throw new Error("openssl is needed to make the test certificates (set OPENSSL_BIN)");
};

/** The query string CI and ECS put on DATABASE_URL, as the workflow spells it. */
const contractQuery = () => {
  const text = fs.readFileSync(WORKFLOW, "utf8");
  const match = text.match(/^\s*base="postgresql:\/\/[^"?]+\?([^"]+)"/m);
  if (!match) throw new Error("no base= DATABASE_URL line in container-image.yml");
  if (!match[1].includes("sslcert=$CI_CA_PATH")) throw new Error(`unexpected contract query: ${match[1]}`);
  return match[1];
};

/** An embedded Postgres binary (postgres, initdb) for this platform. */
const postgresBinary = (name = "postgres") => {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  // The platform package's exports hide its files from require.resolve, so
  // look for it along the ordinary node_modules search path.
  const relative = path.join("@embedded-postgres", `${platform}-${process.arch}`, "native", "bin", exe);
  const found = require.resolve.paths("embedded-postgres")
    .map((dir) => path.join(dir, relative))
    .find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`no embedded Postgres binary ${relative}`);
  return found;
};

liveDescribe("database TLS contract (throwaway TLS-only Postgres)", () => {
  let dir;
  let openssl;
  let pgProcess;
  let port;
  const password = `pw${Date.now()}`;
  const file = (name) => path.join(dir, name).replace(/\\/g, "/");
  const read = (name) => fs.readFileSync(path.join(dir, name), "utf8");

  const ssl = (...args) => {
    const run = spawnSync(openssl, args, { cwd: dir, encoding: "utf8" });
    if (run.status !== 0) throw new Error(`openssl ${args.join(" ")}\n${run.stderr}`);
  };
  const makeCa = (name, cn) =>
    ssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", `/O=OctaPM test/CN=${cn}`,
      "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign",
      "-keyout", `${name}.key`, "-out", `${name}.crt`);

  const databaseUrl = (caFile, { host = "localhost", query = contractQuery() } = {}) =>
    `postgresql://postgres:${password}@${host}:${port}/postgres?` +
    query.replace("$CI_CA_PATH", encodeURIComponent(caFile));

  /** `prisma db execute`: one real connection through the schema engine. */
  const prismaConnect = (url) => {
    const run = spawnSync(process.execPath, [PRISMA_CLI, "db", "execute", "--url", url, "--stdin"], {
      input: "select 1;",
      encoding: "utf8",
      env: { ...process.env, CHECKPOINT_DISABLE: "1", DATABASE_URL: "" },
      timeout: 60_000,
    });
    return { code: run.status, output: `${run.stdout}\n${run.stderr}` };
  };

  const pgConnect = async (options) => {
    const client = new Client({ host: "localhost", port, user: "postgres", password, database: "postgres", ...options });
    client.on("error", () => {});
    try {
      await client.connect();
      const { rows } = await client.query("select ssl from pg_stat_ssl where pid = pg_backend_pid()");
      return { ok: true, ssl: rows[0] && rows[0].ssl };
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      await client.end().catch(() => {});
    }
  };

  beforeAll(async () => {
    openssl = findOpenssl();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "octapm-dbtls-"));

    // Three roots in RDS's naming, the real one in the middle: a reader that
    // takes only the first certificate lands on a decoy.
    makeCa("decoy", "Amazon RDS af-south-1 Root CA RSA2048 G1");
    makeCa("real", REAL_CN);
    makeCa("other", "Amazon RDS us-east-2 Root CA RSA4096 G1");
    // The server certificate names localhost only, so connecting by IP is a
    // hostname mismatch.
    ssl("req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-keyout", "server.key", "-out", "server.csr");
    fs.writeFileSync(path.join(dir, "server.ext"),
      "subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n");
    ssl("x509", "-req", "-in", "server.csr", "-CA", "real.crt", "-CAkey", "real.key", "-CAcreateserial",
      "-days", "2", "-extfile", "server.ext", "-out", "server.crt");
    fs.writeFileSync(path.join(dir, "bundle.pem"), read("decoy.crt") + read("real.crt") + read("other.crt"));
    fs.writeFileSync(path.join(dir, "decoy-only.pem"), read("decoy.crt"));

    // A fresh cluster from the embedded Postgres binaries (initdb directly:
    // the package's own wrapper is an ES module Jest cannot import), then the
    // server with ssl=on and a TLS-only pg_hba.
    port = await freePort();
    fs.writeFileSync(path.join(dir, "pwfile"), password);
    const init = spawnSync(postgresBinary("initdb"), [
      "-D", path.join(dir, "data"), "-U", "postgres", "--pwfile", path.join(dir, "pwfile"),
      "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C",
    ], { encoding: "utf8" });
    if (init.status !== 0) throw new Error(`initdb failed:\n${init.stdout}\n${init.stderr}`);
    fs.writeFileSync(path.join(dir, "data", "pg_hba.conf"),
      "hostnossl all all all reject\nhostssl all all all scram-sha-256\n");
    pgProcess = spawn(postgresBinary(), [
      "-D", path.join(dir, "data"), "-p", String(port), "-c", "listen_addresses=localhost",
      "-c", "ssl=on", "-c", `ssl_cert_file=${file("server.crt")}`, "-c", `ssl_key_file=${file("server.key")}`,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    pgProcess.stdout.on("data", (chunk) => { log += chunk; });
    pgProcess.stderr.on("data", (chunk) => { log += chunk; });
    const deadline = Date.now() + 30_000;
    for (;;) {
      if (/ready to accept connections/.test(log)) break;
      if (pgProcess.exitCode !== null || Date.now() > deadline) throw new Error(`postgres did not start:\n${log}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  });

  afterAll(async () => {
    if (pgProcess && pgProcess.exitCode === null) {
      const exited = new Promise((resolve) => pgProcess.once("exit", resolve));
      pgProcess.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    }
    if (dir) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  test("the server refuses plaintext, so every connection below is TLS", async () => {
    const plain = await pgConnect({ ssl: false });
    expect(plain.ok).toBe(false);
    expect(plain.error).toMatch(/no encryption|reject/i);
  });

  test("the contract URL connects with the single root the image picks out of the bundle", () => {
    fs.writeFileSync(path.join(dir, "rds-ca.pem"), pick(read("bundle.pem"), REAL_CN));
    const result = prismaConnect(databaseUrl(file("rds-ca.pem")));
    expect(result.output).not.toMatch(/P1011|P1001|error/i);
    expect(result.code).toBe(0);
  });

  test("the contract URL refuses a CA that did not sign the server (P1011)", () => {
    const result = prismaConnect(databaseUrl(file("decoy-only.pem")));
    expect(result.output).toMatch(/P1011/);
    expect(result.code).not.toBe(0);
  });

  test("the contract URL refuses the server's certificate for a host it does not name", () => {
    const result = prismaConnect(databaseUrl(file("real.crt"), { host: "127.0.0.1" }));
    expect(result.output).toMatch(/P1011|P1001/);
    expect(result.code).not.toBe(0);
  });

  test("Prisma reads only the first certificate of a bundle, which is why the image ships one", () => {
    const result = prismaConnect(databaseUrl(file("bundle.pem")));
    expect(result.output).toMatch(/P1011/);
  });

  test("without sslaccept=strict Prisma connects with any CA at all (why the contract carries it)", () => {
    const loose = contractQuery().replace(/&?sslaccept=strict/, "");
    const result = prismaConnect(databaseUrl(file("decoy-only.pem"), { query: loose }));
    expect(result.code).toBe(0);
  });

  test("node-postgres verifies against every certificate of a bundle", async () => {
    const bundle = await pgConnect({ ssl: { ca: read("bundle.pem"), rejectUnauthorized: true, servername: "localhost" } });
    expect(bundle).toEqual({ ok: true, ssl: true });
    const decoy = await pgConnect({ ssl: { ca: read("decoy-only.pem"), rejectUnauthorized: true, servername: "localhost" } });
    expect(decoy.ok).toBe(false);
    expect(decoy.error).toMatch(/certificate/i);
  });

  test("the picker refuses a bundle without the named root, a leaf, and a root that has expired", () => {
    const bundle = read("bundle.pem");
    expect(() => pick(bundle, "Amazon RDS eu-west-1 Root CA RSA2048 G1")).toThrow(
      /found 0[\s\S]*Amazon RDS af-south-1 Root CA RSA2048 G1[\s\S]*Amazon RDS us-east-2 Root CA RSA2048 G1/,
    );
    expect(() => pick(bundle, REAL_CN, new Date(Date.now() + 10 * 86_400_000))).toThrow(/expired/);
    expect(() => pick(read("server.crt"), "localhost")).toThrow(/not a CA/);
  });

  test("the picker's command line, as the Dockerfile runs it, prints one root or fails the build", () => {
    const cli = path.join(__dirname, "..", "pick-rds-ca.cjs");
    const ok = spawnSync(process.execPath, [cli, path.join(dir, "bundle.pem"), REAL_CN], { encoding: "utf8" });
    expect(ok.status).toBe(0);
    expect(ok.stdout.match(/BEGIN CERTIFICATE/g)).toHaveLength(1);
    expect(ok.stdout.trim()).toBe(read("real.crt").trim());
    const missing = spawnSync(process.execPath, [cli, path.join(dir, "bundle.pem"), "Amazon RDS eu-west-1 Root CA RSA2048 G1"], { encoding: "utf8" });
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toMatch(/expected exactly one certificate/);
  });
});
