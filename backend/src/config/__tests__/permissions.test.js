const {
  ALL_ACTIONS,
  ALL_ROLES,
  can,
  permissionPolicy,
} = require('../permissions');

const expectedPolicies = [
  {
    module: 'schedule',
    action: 'approve',
    transition: 'revision.approve',
    allowed: ['pm'],
  },
  {
    module: 'progress',
    action: 'submit',
    transition: 'submission.submit',
    allowed: ['pm', 'planning_eng', 'site_engineer'],
  },
  {
    module: 'progress',
    action: 'approve',
    transition: 'submission.approve',
    allowed: ['pm', 'planning_eng', 'qs'],
  },
  {
    module: 'ipc',
    action: 'certify',
    transition: 'period.certify',
    allowed: ['pm', 'finance'],
  },
  {
    module: 'cost',
    action: 'update',
    transition: 'activity_cost.update',
    allowed: ['pm', 'qs', 'cost_controller'],
  },
  {
    module: 'procurement',
    action: 'create',
    transition: 'po.issue',
    allowed: ['pm', 'procurement'],
  },
  {
    module: 'procurement',
    action: 'submit',
    transition: 'receipt.post',
    allowed: ['pm', 'procurement', 'warehouse'],
  },
  {
    module: 'procurement',
    action: 'submit',
    transition: 'material.use',
    allowed: ['pm', 'warehouse', 'site_engineer'],
  },
  {
    module: 'user_management',
    action: 'create',
    allowed: ['pm'],
  },
  {
    module: 'rfi',
    action: 'create',
    allowed: ['pm', 'planning_eng', 'site_engineer'],
  },
  {
    module: 'rfi',
    action: 'delete',
    allowed: ['pm'],
  },
  {
    module: 'submittal',
    action: 'update',
    allowed: ['pm', 'planning_eng', 'site_engineer'],
  },
  {
    module: 'ncr',
    action: 'create',
    allowed: ['pm', 'planning_eng', 'site_engineer'],
  },
  {
    module: 'ncr',
    action: 'delete',
    allowed: ['pm'],
  },
  {
    module: 'safety',
    action: 'create',
    allowed: ['pm', 'site_engineer'],
  },
  {
    module: 'safety',
    action: 'update',
    allowed: ['pm', 'site_engineer'],
  },
  {
    module: 'safety',
    action: 'delete',
    allowed: ['pm'],
  },
];

describe('module/action permission matrix', () => {
  it('declares every required action for every module', () => {
    Object.entries(permissionPolicy.modules).forEach(
      ([moduleName, modulePolicy]) => {
        ALL_ACTIONS.forEach((action) => {
          expect(Array.isArray(modulePolicy.actions[action])).toBe(true);
        });
        expect(moduleName).toBeTruthy();
      },
    );
  });

  it.each(expectedPolicies)(
    'matches expected $module $action authority for all roles',
    ({ module, action, transition, allowed }) => {
      ALL_ROLES.forEach((role) => {
        expect(can({ role, module, action, transition })).toBe(
          allowed.includes(role),
        );
      });
    },
  );
});
