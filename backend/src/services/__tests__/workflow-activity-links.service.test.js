/**
 * CERT-2 existence oracle: a workflow record's row carries its primary
 * activity (the first activity link, or the body's activityId), and the row
 * was written before syncWorkflowReferences checked the links. Another
 * company's activity passed the foreign key and was then refused 400 by the
 * links' check; an activity that exists nowhere failed the foreign key first
 * (500, P2003). Every record type now checks every activity it will name —
 * activityId, activityIds[], activityLinks[].activityId — before anything is
 * written (workflow-support.assertPayloadActivity), so both answer the same
 * 400 WORKFLOW_ACTIVITY_NOT_FOUND, no transaction is opened and no reference
 * number is drawn.
 *
 * The real workflow-support runs against a stubbed Prisma whose project has
 * one activity (OWN); any other id is another company's or none at all.
 */
const mockPrisma = {
  $transaction: jest.fn(async () => {
    throw new Error("the transaction must not be opened");
  }),
  project: { findFirst: jest.fn(async () => ({ id: "project-1", orgId: "org-1" })) },
  activity: { findMany: jest.fn() },
};
const ROW_MODELS = ["rfi", "submittal", "correspondence", "defectRecord", "itpRecord", "materialTest", "drawingRecord", "ncrRecord", "safetyIncident", "transmittal"];
for (const model of ROW_MODELS) {
  mockPrisma[model] = {
    findFirst: jest.fn(async () => ({ id: "record-1", projectId: "project-1", status: "open", activityId: null, archivedAt: null })),
    create: jest.fn(),
    update: jest.fn(),
  };
}
const mockNextRef = jest.fn(async () => "REF-001");

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../../utils/reference-number", () => ({ nextRef: mockNextRef, nextReference: mockNextRef }));

const OWN = "11111111-1111-4111-8111-111111111111";
const ELSEWHERE = "22222222-2222-4222-8222-222222222222";

const scope = { orgId: "org-1", projectId: "project-1", userId: "user-1", userRole: "pm" };
const types = [
  ["rfi", "rfi", () => require("../rfi.service"), "createRfi", "updateRfi", "rfiId", { subject: "Level", question: "Which?" }],
  ["submittal", "submittal", () => require("../submittal.service"), "createSubmittal", "updateSubmittal", "submittalId", { title: "Mill certificate" }],
  ["correspondence", "correspondence", () => require("../correspondence.service"), "createCorrespondence", "updateCorrespondence", "correspondenceId", { direction: "outgoing", type: "letter", subject: "Notice" }],
  ["defect", "defectRecord", () => require("../defect.service"), "createDefect", "updateDefect", "defectId", { title: "Crack" }],
  ["itp", "itpRecord", () => require("../itp.service"), "createItp", "updateItp", "itpId", { title: "Rebar check" }],
  ["material test", "materialTest", () => require("../material-test.service"), "createMaterialTest", "updateMaterialTest", "testId", { testType: "Cube" }],
  ["drawing", "drawingRecord", () => require("../drawing.service"), "createDrawing", "updateDrawing", "drawingId", { drawingNumber: "S-101", title: "Foundation" }],
  ["NCR", "ncrRecord", () => require("../ncr.service"), "createNcr", "updateNcr", "ncrId", { description: "Honeycombing" }],
  ["safety incident", "safetyIncident", () => require("../safety.service"), "createSafetyIncident", "updateSafetyIncident", "incidentId", { incidentType: "near_miss", title: "Slip" }],
  ["transmittal", "transmittal", () => require("../transmittal.service"), "createTransmittal", "updateTransmittal", "transmittalId", { subject: "Drawings", sender: "A", recipient: "B" }],
];
const naming = [
  ["activityId", (id) => ({ activityId: id })],
  ["activityIds[]", (id) => ({ activityIds: [id] })],
  ["activityLinks[].activityId", (id) => ({ activityLinks: [{ activityId: id }] })],
  ["activityLinks[] beside the project's own activityId", (id) => ({ activityId: OWN, activityLinks: [{ activityId: OWN }, { activityId: id }] })],
];
const notOneString = [
  ["activityId: [id]", { activityId: [OWN] }],
  ["activityLinks[].activityId: [id]", { activityLinks: [{ activityId: [OWN] }] }],
  ["activityLinks[].activityId: {}", { activityLinks: [{ activityId: { not: "x" } }] }],
  ["activityLinks[].activityId: 12345", { activityLinks: [{ activityId: 12345 }] }],
];

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.activity.findMany.mockImplementation(async ({ where }) => (where.projectId === "project-1" ? where.id.in.filter((id) => id === OWN).map((id) => ({ id })) : []));
});

const refusedBeforeAnyWrite = async (promise, model) => {
  await expect(promise).rejects.toMatchObject({ status: 400, code: "WORKFLOW_ACTIVITY_NOT_FOUND", message: "One or more linked activities were not found in this project" });
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  expect(mockPrisma[model].create).not.toHaveBeenCalled();
  expect(mockPrisma[model].update).not.toHaveBeenCalled();
  expect(mockNextRef).not.toHaveBeenCalled();
};

describe.each(types)("%s: every activity it names is checked before anything is written (CERT-2)", (_label, model, load, create, update, idKey, base) => {
  test.each(naming)("create refuses an activity outside the project in %s", async (_field, wrap) => {
    await refusedBeforeAnyWrite(load()[create]({ ...scope, payload: { ...base, ...wrap(ELSEWHERE) } }), model);
    expect(mockPrisma.activity.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ projectId: "project-1", id: { in: expect.arrayContaining([ELSEWHERE]) } }) }));
  });

  test.each(naming)("update refuses an activity outside the project in %s", async (_field, wrap) => {
    await refusedBeforeAnyWrite(load()[update]({ ...scope, [idKey]: "record-1", payload: wrap(ELSEWHERE) }), model);
  });

  test.each(notOneString)("a value that is not one string is refused alike: %s", async (_field, payload) => {
    await refusedBeforeAnyWrite(load()[create]({ ...scope, payload: { ...base, ...payload } }), model);
  });
});
