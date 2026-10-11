/**
 * Notification e-mails link on the recipient's own surface (domain
 * architecture §28–29): a consultant's on the External Collaboration Portal,
 * the contractor's on the application. The surface is recorded on the row
 * when it is written (link-audience.service), never guessed from an address.
 */
const ORIGINAL = { ...process.env };

describe("notification e-mail links", () => {
  let service;
  beforeAll(() => {
    process.env = { ...ORIGINAL, WEB_APP_URL: "https://app.octapm.com", PORTAL_URL: "https://portal.octapm.com" };
    jest.resetModules();
    service = require("../notification.service");
  });
  afterAll(() => {
    process.env = ORIGINAL;
  });

  const row = (metadataJson) => ({
    message: "RFI-005 submitted for your review",
    actionUrl: "/o/octapm-demo/projects/p1/reviews?recordId=s1",
    metadataJson,
  });

  it("opens a consultant's review on the portal, at the exact record", () => {
    expect(service.deliveryBody(row({ surface: "portal" }))).toContain(
      "Open in OctaPM: https://portal.octapm.com/o/octapm-demo/projects/p1/reviews?recordId=s1",
    );
  });

  it("opens the contractor's on the application", () => {
    expect(service.deliveryBody(row({}))).toContain("Open in OctaPM: https://app.octapm.com/o/octapm-demo/projects/p1/reviews?recordId=s1");
    expect(service.deliveryBody(row(null))).toContain("https://app.octapm.com/");
  });

  it("never repeats a stored link that is not an application path", () => {
    const body = service.deliveryBody({ message: "x", actionUrl: "https://evil.example.com/phish", metadataJson: {} });
    expect(body).not.toContain("evil.example.com");
    expect(body).toContain("Open in OctaPM: https://app.octapm.com");
  });

  it("accepts only the portal as another surface; anything else is the application", () => {
    expect(service.deliveryBody(row({ surface: "admin" }))).toContain("https://app.octapm.com/");
  });
});

describe("link audience", () => {
  const { portalRecipients } = require("../link-audience.service");
  const tx = ({ partyMembers, assignments }) => ({
    projectPartyMember: { findMany: async () => partyMembers.map((userId) => ({ userId })) },
    projectAssignment: { findMany: async () => assignments.map((userId) => ({ userId })) },
  });

  it("puts a project-party member with no project assignment (a consultant) on the portal", async () => {
    const ids = await portalRecipients({ tx: tx({ partyMembers: ["consultant", "both"], assignments: ["both", "pm"] }), projectId: "p1", userIds: ["consultant", "both", "pm"] });
    expect([...ids]).toEqual(["consultant"]);
  });

  it("decides nothing without a project", async () => {
    expect((await portalRecipients({ tx: tx({ partyMembers: ["c"], assignments: [] }), projectId: null, userIds: ["c"] })).size).toBe(0);
  });
});
