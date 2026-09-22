const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildPgConfig, createRealtimeAdapter, resolveRealtimeAdapterMode } = require("../adapter");

/**
 * The production DATABASE_URL is written for Prisma, whose `sslcert` is the CA
 * that signs the server's certificate. node-postgres reads the same parameter
 * as a client certificate, so the URL cannot go to pg.Pool as it is: the
 * adapter's connection would fail TLS and realtime would quietly stay inside
 * each task. These cases pin the translation.
 */
describe("realtime adapter configuration", () => {
  let caFile;

  beforeAll(() => {
    caFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "octapm-ca-")), "rds-ca.pem");
    fs.writeFileSync(caFile, "-----BEGIN CERTIFICATE-----\nTEST-CA\n-----END CERTIFICATE-----\n");
  });

  it("turns Prisma's sslcert into the trusted CA, checks the host, and never sends a client certificate", () => {
    const url =
      `postgresql://octapm_app:p%40ss%2Fword@db.abc123.us-east-2.rds.amazonaws.com:5432/octapm` +
      `?sslmode=require&sslcert=${encodeURIComponent(caFile)}&connection_limit=10&pool_timeout=10&schema=public&sslaccept=strict`;
    const config = buildPgConfig(url);

    expect(config).toMatchObject({
      host: "db.abc123.us-east-2.rds.amazonaws.com",
      port: 5432,
      user: "octapm_app",
      password: "p@ss/word",
      database: "octapm",
    });
    expect(config.ssl).toEqual({
      ca: fs.readFileSync(caFile, "utf8"),
      rejectUnauthorized: true,
      servername: "db.abc123.us-east-2.rds.amazonaws.com",
    });
    expect(config.ssl.cert).toBeUndefined();
    expect(config.ssl.key).toBeUndefined();
    // Nothing Prisma-only survives, and there is no connection string for pg to re-parse.
    expect(config.connectionString).toBeUndefined();
    const flat = JSON.stringify(config);
    for (const param of ["connection_limit", "pool_timeout", "sslaccept", "sslcert", "schema"]) expect(flat).not.toContain(param);
  });

  it("still verifies the certificate when no CA file is named", () => {
    const config = buildPgConfig("postgresql://u:p@db.example.com/octapm?sslmode=require");
    expect(config.ssl).toEqual({ rejectUnauthorized: true, servername: "db.example.com" });
  });

  it("keeps a local URL plain, as Prisma's own connection is", () => {
    const config = buildPgConfig("postgresql://postgres:secret@localhost:55432/octapm_verify?connection_limit=5");
    expect(config).toMatchObject({ host: "localhost", port: 55432, database: "octapm_verify", ssl: false });
  });

  it("follows a non-public Prisma schema with the search path", () => {
    expect(buildPgConfig("postgresql://u:p@h/db?schema=tenant_a").options).toBe("-c search_path=tenant_a");
  });

  it("is in-memory outside production and Postgres in production, unless told otherwise", () => {
    expect(resolveRealtimeAdapterMode({})).toBe("memory");
    expect(resolveRealtimeAdapterMode({ NODE_ENV: "development" })).toBe("memory");
    expect(resolveRealtimeAdapterMode({ NODE_ENV: "production" })).toBe("postgres");
    expect(resolveRealtimeAdapterMode({ NODE_ENV: "production", REALTIME_ADAPTER: "memory" })).toBe("memory");
    expect(resolveRealtimeAdapterMode({ REALTIME_ADAPTER: "Postgres" })).toBe("postgres");
    expect(() => resolveRealtimeAdapterMode({ REALTIME_ADAPTER: "redis" })).toThrow(/REALTIME_ADAPTER/);
    // Development builds nothing and loads neither package.
    expect(createRealtimeAdapter({ NODE_ENV: "development" })).toBeNull();
  });
});
