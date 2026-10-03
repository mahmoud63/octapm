/**
 * CERT-2 isolation sweep: an `activityId` sent beside `activityIds` /
 * `activityLinks` on a drawing was neither stored (the links name the
 * primary activity) nor checked. It must name one of the drawing's own
 * project's activities, refused as the links' own check refuses a missing one.
 */
const { referenceCounterMock } = require("./helpers/reference-counter-mock");

const mockPrisma = {
  ...referenceCounterMock(),
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn(async () => ({ id: "project-1", orgId: "org-1" })) },
  activity: { findMany: jest.fn() },
  drawingRecord: { create: jest.fn(async ({ data }) => ({ id: "drawing-1", ...data })), findFirst: jest.fn(), update: jest.fn(async ({ data }) => ({ id: "drawing-1", ...data })) },
};
const mockWorkflow = {
  RECORD_TYPES: { DRAWING: "drawing" },
  workflowAssignmentData: jest.fn(async () => ({})),
  attachWorkflowDetailsToRecords: jest.fn(async ({ records }) => records),
  recordDocumentRevisions: jest.fn(async () => ({})),
  recordWorkflowHistory: jest.fn(async () => ({})),
  syncWorkflowReferences: jest.fn(async () => ({})),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../workflow-support.service", () => ({
  ...mockWorkflow,
  primaryActivityIdFromPayload: jest.requireActual("../workflow-support.service").primaryActivityIdFromPayload,
}));

const drawingService = require("../drawing.service");

const OWN = "own-activity";
const OWN_2 = "own-activity-2";
const FOREIGN = "foreign-activity";

beforeEach(() => {
  jest.clearAllMocks();
  // The project has its own two activities; any other id is another company's or none at all.
  mockPrisma.activity.findMany.mockImplementation(({ where }) => Promise.resolve(where.id.in.filter((id) => [OWN, OWN_2].includes(id) && where.projectId === "project-1").map((id) => ({ id }))));
  mockPrisma.drawingRecord.findFirst.mockResolvedValue({ id: "drawing-1", projectId: "project-1", activityId: OWN_2, drawingNumber: "S-101", title: "Foundation", status: "active" });
});

describe("drawing activity references (CERT-2)", () => {
  it("refuses another project's activityId beside activityIds on create, before anything is written", async () => {
    await expect(
      drawingService.createDrawing({ orgId: "org-1", projectId: "project-1", payload: { drawingNumber: "S-101", title: "Foundation", activityId: FOREIGN, activityIds: [OWN_2] } }),
    ).rejects.toMatchObject({ status: 400, code: "WORKFLOW_ACTIVITY_NOT_FOUND" });
    expect(mockPrisma.activity.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [FOREIGN] }, projectId: "project-1" } }));
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.drawingRecord.create).not.toHaveBeenCalled();
  });

  it("refuses it on update too", async () => {
    await expect(
      drawingService.updateDrawing({ orgId: "org-1", projectId: "project-1", drawingId: "drawing-1", payload: { title: "Foundation rev", activityId: FOREIGN, activityIds: [OWN_2] } }),
    ).rejects.toMatchObject({ status: 400, code: "WORKFLOW_ACTIVITY_NOT_FOUND" });
    expect(mockPrisma.drawingRecord.update).not.toHaveBeenCalled();
  });

  it("keeps the project's own activityId working, the links naming the primary activity", async () => {
    await drawingService.createDrawing({ orgId: "org-1", projectId: "project-1", payload: { drawingNumber: "S-102", title: "Pile caps", activityId: OWN, activityIds: [OWN_2] } });
    expect(mockPrisma.drawingRecord.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ activityId: OWN_2 }) }));
    await drawingService.createDrawing({ orgId: "org-1", projectId: "project-1", payload: { drawingNumber: "S-103", title: "Slab", activityId: OWN } });
    expect(mockPrisma.drawingRecord.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ activityId: OWN }) }));
    // No activityId at all: nothing to check.
    mockPrisma.activity.findMany.mockClear();
    await drawingService.createDrawing({ orgId: "org-1", projectId: "project-1", payload: { drawingNumber: "S-104", title: "Roof" } });
    expect(mockPrisma.activity.findMany).not.toHaveBeenCalled();
  });
});
