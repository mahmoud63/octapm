const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");

/**
 * Every identifier a request asks a record to point at must belong to the
 * caller's own organisation (and, for project records, to the record's own
 * project). Without this check a record could be pointed at another company's
 * person, company, package or activity, and the product then served that
 * company's names, e-mail addresses and records back (certification findings
 * L3, L4, L6, L7, L8 and the CERT-2 injection sweep).
 *
 * A foreign id and an id that exists nowhere get the same 404, so the answer
 * never tells whether something exists in another company.
 *
 * People are checked by membership, not by their home workspace: a person who
 * belongs to several companies is a valid reference in each of them, and in
 * no other.
 */

const listOf = (values) => (Array.isArray(values) ? values : values instanceof Set ? [...values] : [values]);

const idsOf = (values) => [
  ...new Set(
    listOf(values)
      .filter((value) => typeof value === "string" && value.trim() !== "")
      .map((value) => value.trim()),
  ),
];

const refuse = (code, message) => {
  throw new HttpError(404, code, message);
};

// A value that is not an identifier — an array, a number, an object — names
// no record, so it is refused like a missing one rather than dropped: a
// dropped value skipped the check while the code that stored or looked it up
// read it differently (certification CERT-2: ["<another company's id>"]
// passed every helper and reached the write, or a 500 from the database).
const assertIdentifiers = (values, code, message) => {
  if (listOf(values).some((value) => value !== null && value !== undefined && typeof value !== "string")) refuse(code, message);
};

/** People who are members of the organisation (any membership that has not ended). */
const assertMembers = async ({ tx = prisma, orgId, userIds, code = "USER_NOT_FOUND", message = "One or more people are not members of this organisation" }) => {
  assertIdentifiers(userIds, code, message);
  const wanted = idsOf(userIds);
  if (!wanted.length) return [];
  if (!orgId) refuse(code, message);
  const rows = await tx.organizationMembership.findMany({
    where: { orgId, userId: { in: wanted }, status: { not: "left" } },
    select: { userId: true },
  });
  if (new Set(rows.map((row) => row.userId)).size !== wanted.length) refuse(code, message);
  return wanted;
};

/** Companies of the organisation's directory. */
const assertCompanies = async ({ tx = prisma, orgId, companyIds, code = "COMPANY_NOT_FOUND", message = "Company not found" }) => {
  assertIdentifiers(companyIds, code, message);
  const wanted = idsOf(companyIds);
  if (!wanted.length) return [];
  if (!orgId) refuse(code, message);
  const rows = await tx.company.findMany({ where: { id: { in: wanted }, orgId }, select: { id: true } });
  if (rows.length !== wanted.length) refuse(code, message);
  return wanted;
};

/** Rows of a project-scoped model that belong to the given project. */
const assertProjectRows = async ({ tx = prisma, model, projectId, ids, code, message }) => {
  assertIdentifiers(ids, code, message);
  const wanted = idsOf(ids);
  if (!wanted.length) return [];
  if (!projectId || !tx[model]?.findMany) refuse(code, message);
  const rows = await tx[model].findMany({ where: { id: { in: wanted }, projectId }, select: { id: true } });
  if (rows.length !== wanted.length) refuse(code, message);
  return wanted;
};

module.exports = { assertCompanies, assertMembers, assertProjectRows, idsOf };
