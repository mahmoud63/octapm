const {
  ALL_ACTIONS,
  ALL_ROLES,
  can,
  canParty,
  normalizeRoleId,
  normalizePartyRoleId,
  permissionPolicy,
} = require("../permissions");

const expectedPolicies = [
  {
    module: "schedule",
    action: "approve",
    transition: "revision.approve",
    allowed: ["pm"],
  },
  {
    module: "progress",
    action: "submit",
    transition: "submission.submit",
    allowed: ["pm", "planning_eng", "site_engineer"],
  },
  {
    module: "progress",
    action: "approve",
    transition: "submission.approve",
    allowed: ["pm", "planning_eng", "qs"],
  },
  {
    module: "boq",
    action: "approve",
    transition: "allocation.approve",
    allowed: ["pm", "qs"],
  },
  {
    module: "boq",
    action: "approve",
    transition: "allocation.reject",
    allowed: ["pm", "qs"],
  },
  {
    module: "ipc",
    action: "certify",
    transition: "period.certify",
    allowed: ["pm", "finance"],
  },
  {
    module: "ipc",
    action: "approve",
    transition: "payment.record",
    allowed: ["finance"],
  },
  {
    module: "eot",
    action: "submit",
    transition: "eot.submit",
    allowed: ["pm", "planning_eng", "qs"],
  },
  {
    module: "cost",
    action: "update",
    transition: "activity_cost.update",
    allowed: ["pm", "qs", "cost_controller"],
  },
  {
    module: "procurement",
    action: "create",
    transition: "po.issue",
    allowed: ["pm", "procurement"],
  },
  {
    module: "procurement",
    action: "submit",
    transition: "receipt.post",
    allowed: ["pm", "procurement", "warehouse"],
  },
  {
    module: "procurement",
    action: "submit",
    transition: "material.use",
    allowed: ["pm", "warehouse", "site_engineer"],
  },
  {
    module: "procurement",
    action: "update",
    transition: "alert.acknowledge",
    allowed: ["pm", "planning_eng", "procurement", "warehouse"],
  },
  {
    module: "procurement",
    action: "update",
    transition: "alert.resolve",
    allowed: ["pm", "planning_eng", "procurement", "warehouse"],
  },
  {
    module: "risk",
    action: "create",
    allowed: ["pm", "planning_eng", "qs"],
  },
  {
    module: "risk",
    action: "submit",
    transition: "risk.submit",
    allowed: ["pm", "planning_eng", "qs"],
  },
  {
    module: "risk",
    action: "approve",
    transition: "risk.approve",
    allowed: ["pm"],
  },
  {
    module: "risk",
    action: "approve",
    transition: "risk.reject",
    allowed: ["pm"],
  },
  {
    module: "user_management",
    action: "create",
    allowed: ["pm"],
  },
  {
    module: "rfi",
    action: "create",
    allowed: ["pm", "planning_eng", "site_engineer"],
  },
  {
    module: "rfi",
    action: "submit",
    transition: "rfi.answer",
    allowed: ["pm", "planning_eng", "site_engineer"],
  },
  {
    module: "rfi",
    action: "approve",
    transition: "rfi.close",
    allowed: ["pm"],
  },
  {
    module: "rfi",
    action: "delete",
    allowed: ["pm"],
  },
  {
    module: "submittal",
    action: "update",
    allowed: ["pm", "planning_eng", "site_engineer"],
  },
  {
    module: "submittal",
    action: "submit",
    transition: "submittal.review",
    allowed: ["pm", "planning_eng", "qs"],
  },
  {
    module: "document_control",
    action: "read",
    allowed: [
      "pm",
      "planning_eng",
      "qs",
      "cost_controller",
      "procurement",
      "warehouse",
      "site_engineer",
      "finance",
    ],
  },
  {
    module: "document_control",
    action: "submit",
    transition: "document.revision.submit_review",
    allowed: ["pm", "planning_eng", "site_engineer"],
  },
  {
    module: "document_control",
    action: "approve",
    transition: "document.revision.approve",
    allowed: ["pm"],
  },
  {
    module: "ncr",
    action: "create",
    allowed: ["pm", "planning_eng", "site_engineer"],
  },
  {
    module: "ncr",
    action: "submit",
    transition: "ncr.close",
    allowed: ["pm", "planning_eng", "site_engineer"],
  },
  {
    module: "ncr",
    action: "approve",
    transition: "ncr.reopen",
    allowed: ["pm"],
  },
  {
    module: "ncr",
    action: "delete",
    allowed: ["pm"],
  },
  {
    module: "safety",
    action: "create",
    allowed: ["pm", "site_engineer"],
  },
  {
    module: "safety",
    action: "update",
    allowed: ["pm", "site_engineer"],
  },
  {
    module: "safety",
    action: "submit",
    transition: "safety.close",
    allowed: ["pm", "site_engineer"],
  },
  {
    module: "safety",
    action: "approve",
    transition: "safety.reopen",
    allowed: ["pm"],
  },
  {
    module: "safety",
    action: "delete",
    allowed: ["pm"],
  },
  {
    module: "meeting",
    action: "create",
    allowed: ["pm", "planning_eng", "site_engineer"],
  },
  {
    module: "meeting",
    action: "submit",
    transition: "meeting.distribute",
    allowed: ["pm", "planning_eng"],
  },
  {
    module: "meeting",
    action: "submit",
    transition: "meeting.comment",
    allowed: [
      "pm",
      "planning_eng",
      "qs",
      "cost_controller",
      "procurement",
      "warehouse",
      "site_engineer",
      "finance",
    ],
  },
];

describe("module/action permission matrix", () => {
  it("declares every required action for every module", () => {
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
    "matches expected $module $action authority for all roles",
    ({ module, action, transition, allowed }) => {
      ALL_ROLES.forEach((role) => {
        expect(can({ role, module, action, transition })).toBe(
          allowed.includes(role),
        );
      });
    },
  );

  it("normalizes Project Manager display values to the canonical pm role", () => {
    expect(normalizeRoleId("Project Manager")).toBe("pm");
    expect(
      can({
        role: "Project Manager",
        module: "schedule",
        action: "approve",
        transition: "revision.approve",
      }),
    ).toBe(true);
  });

  it("declares scoped permissions for every project party role", () => {
    expect(permissionPolicy.partyRoles.map((role) => role.id)).toEqual([
      "owner",
      "consultant",
      "contractor",
      "subcontractor",
    ]);

    expect(normalizePartyRoleId("Main Contractor")).toBe("contractor");
    expect(normalizePartyRoleId("Subcontractor")).toBe("subcontractor");
  });

  it("allows external parties only through their scoped project-party policy", () => {
    expect(
      canParty({
        partyRole: "consultant",
        module: "submittal",
        action: "submit",
        transition: "submittal.review",
      }),
    ).toBe(true);
    expect(
      canParty({
        partyRole: "consultant",
        module: "submittal",
        action: "approve",
        transition: "submittal.approve",
      }),
    ).toBe(true);
    expect(
      canParty({
        partyRole: "subcontractor",
        module: "submittal",
        action: "approve",
        transition: "submittal.approve",
      }),
    ).toBe(false);
    expect(
      canParty({
        partyRole: "owner",
        module: "project_parties",
        action: "create",
      }),
    ).toBe(false);
    expect(
      canParty({
        partyRole: "consultant",
        module: "meeting",
        action: "submit",
        transition: "meeting.distribute",
      }),
    ).toBe(true);
    expect(
      canParty({
        partyRole: "subcontractor",
        module: "meeting",
        action: "submit",
        transition: "meeting.comment",
      }),
    ).toBe(true);
  });
});
