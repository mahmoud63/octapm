const { prisma } = require('../config/db');

/**
 * Derive a 2-letter uppercase prefix from a BOQ item description.
 * Uses the first two alphabetic characters of the first word.
 * "Concrete Works" -> "CO", "Steel Works" -> "ST", "1.2 Excavation" -> "EX".
 */
function deriveActivityPrefix(description) {
  const words = String(description ?? '').trim().split(/\s+/);
  for (const word of words) {
    const letters = word.replace(/[^a-zA-Z]/g, '').toUpperCase();
    if (letters.length >= 2) return letters.slice(0, 2);
    if (letters.length === 1) return `${letters}X`;
  }
  return 'AC';
}

/** Format a code: prefix + zero-padded 3-digit sequence. (CO, 1) -> "CO-001" */
function formatActivityCode(prefix, sequence) {
  return `${prefix}-${String(sequence).padStart(3, '0')}`;
}

/**
 * Compute the next sequential activity code for a project, scoped by prefix.
 * Pass the same `tx` used by surrounding writes so in-flight rows are counted.
 */
async function nextActivityCode(projectId, description, tx = prisma) {
  const prefix = deriveActivityPrefix(description);
  const existing = await tx.activity.findMany({
    where: {
      projectId,
      isActive: true,
      OR: [
        { wbsCode: { startsWith: `${prefix}-` } },
        { p6ActivityId: { startsWith: `${prefix}-` } },
      ],
    },
    select: { wbsCode: true, p6ActivityId: true },
  });

  let max = 0;
  for (const activity of existing) {
    const code = activity.wbsCode || activity.p6ActivityId || '';
    const n = parseInt(code.slice(prefix.length + 1), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }

  return formatActivityCode(prefix, max + 1);
}

module.exports = { deriveActivityPrefix, formatActivityCode, nextActivityCode };
