const { prisma } = require('../config/db');

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0,O,1,I

function generateActivityCode() {
  let code = 'AC-';
  for (let i = 0; i < 5; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

async function generateUniqueActivityCode(projectId) {
  let code;
  let attempts = 0;
  do {
    code = generateActivityCode();
    const existing = await prisma.boqActivity.findFirst({
      where: { projectId, activityCode: code },
      select: { id: true },
    });
    attempts++;
    if (attempts > 100) throw new Error('Failed to generate unique activity code');
    if (!existing) break;
  } while (true);
  return code;
}

module.exports = { generateActivityCode, generateUniqueActivityCode };
