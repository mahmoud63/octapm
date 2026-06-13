const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../../../');

const readFrontendFile = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('BOQ frontend activity-code integrity', () => {
  it('keeps generated activity codes read-only in BOQ entry points', () => {
    const grid = readFrontendFile(
      'frontend/src/features/boq/components/boq-editable-grid.tsx',
    );
    const addRowDialog = readFrontendFile(
      'frontend/src/features/boq/components/boq-add-row-dialog.tsx',
    );
    const schema = readFrontendFile('frontend/src/features/boq/data/schema.ts');

    const activityCodeCell = grid.match(
      /field='activityCode'[\s\S]*?onSave=\{\(\) => \{\}\}/,
    );

    expect(activityCodeCell?.[0]).toContain('readOnly');
    expect(grid).not.toContain("handleUpdateActivity(act.id, 'activityCode'");
    expect(addRowDialog).not.toContain("name='activityCode'");
    expect(schema).not.toMatch(
      /CreateBoqItemInputSchema[\s\S]*activityCode[\s\S]*CreateBoqActivityInputSchema/,
    );
    expect(schema).not.toMatch(
      /UpdateBoqActivityInputSchema[\s\S]*activityCode[\s\S]*export type/,
    );
  });

  it('labels BOQ activity helpers as draft allocation links with explicit value states', () => {
    const grid = readFrontendFile(
      'frontend/src/features/boq/components/boq-editable-grid.tsx',
    );
    const panel = readFrontendFile(
      'frontend/src/features/boq/components/boq-allocation-panel.tsx',
    );
    const uploadZone = readFrontendFile(
      'frontend/src/features/boq/components/boq-upload-zone.tsx',
    );
    const boqPage = readFrontendFile(
      'frontend/src/features/boq/components/boq-page.tsx',
    );

    expect(grid).toContain('Draft allocation link');
    expect(grid).toContain('Approved');
    expect(grid).toContain('Pending');
    expect(grid).toContain('Unalloc.');
    expect(panel).toContain('BOQ Allocation Workflow');
    expect(panel).toContain('Approved EV/IPC');
    expect(panel).toContain('Create Draft');
    expect(panel).not.toContain('Activity BOQ Allocation');
    expect(panel).toMatch(/allocation\.status === 'submitted'[\s\S]*approveAllocation/);
    expect(uploadZone).toContain('draft allocation links');
    expect(boqPage).toContain('draft activity suggestions');
  });
});
