/**
 * Proves the live-test kit itself before anything is built on it: a real API
 * process on a free port, a throwaway organisation that can sign in over HTTP,
 * a graceful signal delivered through the bridge, and a clean teardown.
 */
const { prisma } = require("../config/db");
const { createLiveOrg, dropLiveOrg, freePort, liveDescribe, spawnNode, waitForHttp } = require("./helpers");

liveDescribe("live-test kit", () => {
  let live;
  let api;

  afterAll(async () => {
    if (api) await api.kill();
    if (live) await dropLiveOrg(prisma, live.org.id);
    await prisma.$disconnect();
  });

  it("runs a real API, signs a throwaway organisation in, and stops it by signal", async () => {
    live = await createLiveOrg(prisma);
    const port = await freePort();
    api = spawnNode("src/index.js", { env: { PORT: String(port) } });
    await api.waitForOutput(/running on port/);
    await waitForHttp(`http://127.0.0.1:${port}/api/health`);

    const login = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: live.user.email, password: live.password }),
    });
    expect(login.status).toBe(200);

    const me = await fetch(`http://127.0.0.1:${port}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${live.token}` },
    });
    expect(me.status).toBe(200);

    await api.signal("SIGTERM");
    const { code } = await api.exited;
    expect(code).toBe(0);
    api = null;
  });

  it("deletes the organisation it made, and refuses one it did not", async () => {
    const orgId = live.org.id;
    await dropLiveOrg(prisma, orgId);
    live = null;
    expect(await prisma.organisation.findUnique({ where: { id: orgId } })).toBeNull();

    const other = await prisma.organisation.findFirst({ where: { NOT: { name: { startsWith: "LiveTest " } } }, select: { id: true } });
    if (other) await expect(dropLiveOrg(prisma, other.id)).rejects.toThrow(/not a LiveTest organisation/);
  });
});
