'use strict';

/**
 * Rules the cross-company sweeps share for reading an answer.
 *
 * canaryDisclosed — the victim's canary text in an answer counts only when the
 *   request did not send it itself: a search echoes its own query back. A
 *   longer canary that merely starts with the one sent (a record whose title
 *   carries it) is the victim's data and does count.
 *
 * controlRoute / sameAnswer — the random-id control. The request is sent again
 *   with each of the victim's identifiers replaced by a random one. When the
 *   two answers are the same — once timestamps are set aside and each
 *   identifier is read as its counterpart (an answer may echo the id it was
 *   given) — the route cannot tell the victim's record from one that does not
 *   exist: the caller's own company filter answered, with no data and no
 *   existence oracle.
 */

const { randomUUID } = require('crypto');

const TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})/g;

const canaryTokens = (text, code) => String(text ?? '').match(new RegExp(`CANARY-${code}-[A-Za-z0-9_-]+`, 'g')) || [];

const canaryDisclosed = (text, sentText, code) => {
  const sent = new Set(canaryTokens(decodeURIComponentSafe(sentText), code));
  return canaryTokens(text, code).some((token) => !sent.has(token));
};

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(String(value ?? ''));
  } catch {
    return String(value ?? '');
  }
}

/** The route with each victim identifier swapped for a random one, and the swaps made. */
const controlRoute = (route, victimIds) => {
  const swaps = victimIds.map((id) => [id, randomUUID()]);
  return { route: swaps.reduce((r, [from, to]) => r.split(from).join(to), route), swaps };
};

const normalise = (text, ids) => ids.reduce((t, id, i) => t.split(id).join(`<id${i}>`), String(text ?? '').replace(TIMESTAMP, '<time>'));

/** Same status and the same body once timestamps and swapped identifiers are set aside. */
const sameAnswer = (original, control, swaps) =>
  Boolean(control) &&
  control.status === original.status &&
  normalise(original.text, swaps.map(([from]) => from)) === normalise(control.text, swaps.map(([, to]) => to));

module.exports = { canaryDisclosed, controlRoute, sameAnswer };
