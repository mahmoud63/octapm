/**
 * A generated reference must never collide with one already issued.
 *
 * Bid packages numbered themselves `count + 1`. That is only ever right while
 * nothing has been deleted: the seeded project held 53 packages numbered up to
 * 73, so the next one asked for number 54 — which already existed — and every
 * attempt to raise a package died on the unique `(projectId, ref)` with an
 * HTTP 500. Not an edge case: one deletion is enough, and it stays broken
 * until enough packages are created to climb past the gap
 * (OCTA-API-REFNUM-111).
 *
 * The rule is that the next number is one past the **highest already used**.
 * The purchase-order and goods-receipt sequences already work this way; this
 * holds the bid sequence to the same standard.
 *
 * Runs against the real database, because the defect is in what the query
 * returns and a mocked count would just restate the assumption.
 */

jest.unmock("../../config/db");
jest.setTimeout(30_000);

const { prisma } = require("../../config/db");
const bidService = require("../bid.service");

describe("generated references do not collide after a deletion", () => {
  let project;
  const created = [];

  beforeAll(async () => {
    project = await prisma.project.findFirst({
      where: { name: "Riverside Tower" },
      select: { id: true, orgId: true },
    });
  });

  afterAll(async () => {
    // Leave the workspace as we found it.
    if (created.length) {
      await prisma.bidPackage.deleteMany({ where: { id: { in: created } } });
    }
  });

  it("has the seeded project to work against", () => {
    expect(project?.id).toBeTruthy();
  });

  it("numbers past the highest, not past the count", async () => {
    const before = await prisma.bidPackage.aggregate({
      where: { projectId: project.id },
      _max: { number: true },
    });
    const count = await prisma.bidPackage.count({ where: { projectId: project.id } });
    const highest = before._max.number ?? 0;

    // The fixture only proves anything if the two disagree — which they do
    // exactly when something has been deleted.
    expect(highest).toBeGreaterThan(count);

    const pkg = await bidService.createPackage({
      orgId: project.orgId,
      projectId: project.id,
      payload: { title: `Numbering guard ${Date.now().toString(36)}`, commitmentType: "subcontract" },
      actor: null,
    });
    created.push(pkg.id);

    expect(pkg.number).toBe(highest + 1);
    expect(pkg.ref).toBe(`BP-${String(highest + 1).padStart(3, "0")}`);
  });

  it("keeps climbing when called again", async () => {
    const first = await bidService.createPackage({
      orgId: project.orgId,
      projectId: project.id,
      payload: { title: `Numbering guard a ${Date.now().toString(36)}`, commitmentType: "subcontract" },
      actor: null,
    });
    created.push(first.id);
    const second = await bidService.createPackage({
      orgId: project.orgId,
      projectId: project.id,
      payload: { title: `Numbering guard b ${Date.now().toString(36)}`, commitmentType: "subcontract" },
      actor: null,
    });
    created.push(second.id);

    expect(second.number).toBe(first.number + 1);
  });
});
