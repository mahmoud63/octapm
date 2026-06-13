const mockPrisma = {
  $transaction: jest.fn(),
  user: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  userSetting: {
    create: jest.fn(),
    upsert: jest.fn(),
  },
};

jest.mock("../../config/db", () => ({
  prisma: mockPrisma,
}));

const userSettingsService = require("../user-settings.service");

const baseUser = {
  id: "user-1",
  orgId: "org-1",
  name: "Planner One",
  email: "planner@example.com",
  phone: null,
  role: "planning_eng",
  status: "active",
  lastLogin: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

const settingsRow = {
  id: "settings-1",
  orgId: "org-1",
  userId: "user-1",
  profileUsername: "Planner",
  profileBio: "Schedule lead",
  profileUrls: [{ value: "https://example.com" }],
  dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
  language: "en",
  appearanceTheme: "dark",
  appearanceFont: "inter",
  displayItems: ["dashboard", "projects"],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

describe("user settings service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates default settings on first authenticated read", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ ...baseUser, settings: null });
    mockPrisma.userSetting.create.mockResolvedValue({
      ...settingsRow,
      profileUsername: "Planner One",
      profileBio: null,
      profileUrls: [],
      dateOfBirth: null,
      displayItems: userSettingsService.DEFAULT_DISPLAY_ITEMS,
    });

    const result = await userSettingsService.getUserSettings({
      orgId: "org-1",
      userId: "user-1",
    });

    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: "user-1", orgId: "org-1" },
      include: { settings: true },
    });
    expect(mockPrisma.userSetting.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: "org-1",
        userId: "user-1",
        profileUsername: "Planner One",
      }),
    });
    expect(result.profile.email).toBe("planner@example.com");
    expect(result.display.items).toEqual(
      userSettingsService.DEFAULT_DISPLAY_ITEMS,
    );
  });

  it("updates account settings only after a scoped user lookup", async () => {
    const tx = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          ...baseUser,
          settings: settingsRow,
        }),
        update: jest.fn().mockResolvedValue({
          ...baseUser,
          name: "Updated Planner",
        }),
      },
      userSetting: {
        upsert: jest.fn().mockResolvedValue({
          ...settingsRow,
          language: "fr",
        }),
      },
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await userSettingsService.updateAccountSettings({
      orgId: "org-1",
      userId: "user-1",
      payload: {
        name: "Updated Planner",
        dob: "1990-01-01T00:00:00.000Z",
        language: "fr",
      },
    });

    expect(tx.user.findFirst).toHaveBeenCalledWith({
      where: { id: "user-1", orgId: "org-1" },
      include: { settings: true },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { name: "Updated Planner" },
    });
    expect(tx.userSetting.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      create: expect.objectContaining({
        orgId: "org-1",
        userId: "user-1",
        language: "fr",
      }),
      update: expect.objectContaining({ language: "fr" }),
    });
    expect(result.user.name).toBe("Updated Planner");
    expect(result.account.language).toBe("fr");
  });

  it("rejects updates when the user is outside the organization scope", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    await expect(
      userSettingsService.updateProfileSettings({
        orgId: "org-1",
        userId: "user-2",
        payload: { username: "Other User", bio: "", urls: [] },
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: "USER_NOT_FOUND",
    });

    expect(mockPrisma.userSetting.upsert).not.toHaveBeenCalled();
  });

  it("rejects empty display updates", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      ...baseUser,
      settings: settingsRow,
    });

    await expect(
      userSettingsService.updateDisplaySettings({
        orgId: "org-1",
        userId: "user-1",
        payload: { items: [] },
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "USER_SETTINGS_DISPLAY_EMPTY",
    });

    expect(mockPrisma.userSetting.upsert).not.toHaveBeenCalled();
  });
});
