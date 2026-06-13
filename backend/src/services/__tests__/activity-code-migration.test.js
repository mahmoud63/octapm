const fs = require('fs');
const path = require('path');

describe('activity code migration', () => {
  const migrationPath = path.join(
    __dirname,
    '../../../prisma/migrations/20260611113000_add_activity_code_and_project_data_date/migration.sql',
  );

  it('backfills first-class activity codes and enforces active project uniqueness', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('ADD COLUMN "activityCode" TEXT');
    expect(sql).toContain('ADD COLUMN "dataDate" TIMESTAMP(3)');
    expect(sql).toContain('accepted_boq_codes');
    expect(sql).toContain('unique_active_wbs_codes');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "Activity_projectId_active_activityCode_key"',
    );
    expect(sql).toContain(
      'WHERE "isActive" = true AND "activityCode" IS NOT NULL',
    );
  });
});
