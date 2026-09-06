/* Ad-hoc probe: how stored project dates render in a browser's local timezone. */
const { prisma } = require("./harness");

(async () => {
  const row = await prisma.project.findFirst({
    where: { name: "Riverside Tower" },
    select: { startDate: true, endDate: true, dataDate: true, baselineDate: true },
  });

  console.log("Local timezone:", Intl.DateTimeFormat().resolvedOptions().timeZone);
  console.log("");
  console.log("field           stored (UTC)              toLocaleDateString()");
  for (const [key, value] of Object.entries(row)) {
    if (!value) continue;
    console.log(
      `${key.padEnd(15)} ${value.toISOString().padEnd(25)} ${new Date(value).toLocaleDateString("en-US")}`,
    );
  }
  await prisma.$disconnect();
})().catch(async (error) => {
  console.error(error.message);
  await prisma.$disconnect();
  process.exitCode = 1;
});
