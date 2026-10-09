'use strict';

/**
 * A check whose expectation was the identity contract from before D-ID-1
 * (owner decision, CERT-3 plan §2.2/§2.6): adding a person creates an account
 * (201), an existing identity is answered 202, the administrator sets a
 * password (POST /users/:id/reset-password), a suspended person is brought
 * back by a new invitation, SSO may provision an account. D-ID-1 replaced that
 * contract, so such a check is not run and not counted — neither passed nor
 * failed — but reported as SUPERSEDED BY D-ID-1 with its reason, where it
 * stood and again at the end of the run. The new contract is judged by the
 * D-ID-1 proof, not here.
 */

const list = [];

const superseded = (name, reason) => {
  list.push({ name, reason });
  console.log(`SUPERSEDED  ${name}\n        SUPERSEDED BY D-ID-1: ${reason}`);
};

/** Prints the superseded checks of this run (nothing when there are none) and returns them. */
const reportSuperseded = (label) => {
  if (!list.length) return [];
  console.log(`\n${label}: superseded by D-ID-1 — ${list.length} (not run and not counted: the contract they asserted was replaced)`);
  for (const s of list) console.log(`  SUPERSEDED  ${s.name}\n              ${s.reason}`);
  return list.slice();
};

module.exports = { reportSuperseded, superseded };
