/**
 * The task API mounted outside a project honours an API key's project list
 * (Phase 21D, CX21-486).
 */
const mockPrisma = {
  task: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
  project: { findFirst: jest.fn(async () => ({ id: "p2", orgId: "org-1" })) },
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
};
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
const service = require("../task.service");

describe("Phase 21D — integrity (release challenge, eighth pass)", () => {
  it("CX21-486: a key's task list is narrowed to its projects, and a task cannot be created on another", async () => {
    await service.listTasks({ orgId: "org-1", userId: "u1", role: "pm", query: {}, projectIds: ["p1"] });
    expect(mockPrisma.task.findMany.mock.calls.at(-1)[0].where).toMatchObject({ projectId: { in: ["p1"] } });
    await expect(service.createTask({ orgId: "org-1", payload: { projectId: "p2", title: "Snag" }, userId: "u1", userRole: "pm", allowedProjectIds: ["p1"] })).rejects.toMatchObject({ code: "FORBIDDEN_PROJECT", status: 403 });
  });
});
