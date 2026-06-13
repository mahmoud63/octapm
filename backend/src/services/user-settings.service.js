const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");

const LANGUAGES = new Set([
  "en",
  "fr",
  "de",
  "es",
  "pt",
  "ru",
  "ja",
  "ko",
  "zh",
]);
const THEMES = new Set(["light", "dark", "system"]);
const FONTS = new Set(["inter", "manrope", "system"]);
const DISPLAY_ITEMS = new Set([
  "dashboard",
  "projects",
  "tasks",
  "apps",
  "chats",
  "users",
  "help-center",
]);

const DEFAULT_DISPLAY_ITEMS = [
  "dashboard",
  "projects",
  "tasks",
  "apps",
  "chats",
  "users",
  "help-center",
];

const trim = (value) =>
  typeof value === "string" ? value.trim() : value || null;

const asIso = (value) => {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
};

const sanitizeUser = (user) => ({
  id: user.id,
  orgId: user.orgId,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  status: user.status,
  lastLogin: user.lastLogin,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const defaultUsernameFor = (user) =>
  (trim(user.name) || user.email?.split("@")[0] || "user").slice(0, 30);

const normalizeUrls = (urls) => {
  if (!Array.isArray(urls)) return [];
  return urls
    .map((item) =>
      typeof item === "string"
        ? { value: trim(item) }
        : { value: trim(item?.value) },
    )
    .filter((item) => item.value)
    .slice(0, 10);
};

const normalizeDisplayItems = (items) => {
  if (!Array.isArray(items)) return DEFAULT_DISPLAY_ITEMS;
  const normalized = [
    ...new Set(items.filter((item) => DISPLAY_ITEMS.has(item))),
  ];
  return normalized.length ? normalized : DEFAULT_DISPLAY_ITEMS;
};

const normalizeDisplayItemsForUpdate = (items) => {
  if (!Array.isArray(items)) return [];
  return [...new Set(items.filter((item) => DISPLAY_ITEMS.has(item)))];
};

const normalizeLanguage = (language) =>
  LANGUAGES.has(language) ? language : "en";

const normalizeTheme = (theme) => (THEMES.has(theme) ? theme : "dark");

const normalizeFont = (font) => (FONTS.has(font) ? font : "inter");

const serializeSettings = (user, settings = {}) => ({
  user: sanitizeUser(user),
  profile: {
    username: settings.profileUsername || defaultUsernameFor(user),
    email: user.email,
    bio: settings.profileBio || "",
    urls: normalizeUrls(settings.profileUrls),
  },
  account: {
    name: user.name,
    dob: asIso(settings.dateOfBirth),
    language: normalizeLanguage(settings.language),
  },
  appearance: {
    theme: normalizeTheme(settings.appearanceTheme),
    font: normalizeFont(settings.appearanceFont),
  },
  display: {
    items: normalizeDisplayItems(settings.displayItems),
  },
});

const loadScopedUser = async ({ tx = prisma, orgId, userId }) => {
  const user = await tx.user.findFirst({
    where: { id: userId, orgId },
    include: { settings: true },
  });

  if (!user) {
    throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  }

  return user;
};

const createDefaultSettings = async ({ tx = prisma, user }) =>
  tx.userSetting.create({
    data: {
      orgId: user.orgId,
      userId: user.id,
      profileUsername: defaultUsernameFor(user),
      displayItems: DEFAULT_DISPLAY_ITEMS,
    },
  });

const ensureSettings = async ({ tx = prisma, user }) =>
  user.settings || createDefaultSettings({ tx, user });

const upsertSettings = ({ tx = prisma, orgId, userId, data }) =>
  tx.userSetting.upsert({
    where: { userId },
    create: { orgId, userId, ...data },
    update: data,
  });

const getUserSettings = async ({ orgId, userId }) => {
  const user = await loadScopedUser({ orgId, userId });
  const settings = await ensureSettings({ user });
  return serializeSettings(user, settings);
};

const updateProfileSettings = async ({ orgId, userId, payload }) => {
  const user = await loadScopedUser({ orgId, userId });
  const settings = await upsertSettings({
    orgId,
    userId,
    data: {
      profileUsername: trim(payload.username),
      profileBio: trim(payload.bio) || "",
      profileUrls: normalizeUrls(payload.urls),
    },
  });

  return serializeSettings(user, settings);
};

const updateAccountSettings = async ({ orgId, userId, payload }) =>
  prisma.$transaction(async (tx) => {
    await loadScopedUser({ tx, orgId, userId });
    const user = await tx.user.update({
      where: { id: userId },
      data: { name: trim(payload.name) },
    });
    const settings = await upsertSettings({
      tx,
      orgId,
      userId,
      data: {
        dateOfBirth: payload.dob ? new Date(payload.dob) : null,
        language: normalizeLanguage(payload.language),
      },
    });

    return serializeSettings(user, settings);
  });

const updateAppearanceSettings = async ({ orgId, userId, payload }) => {
  const user = await loadScopedUser({ orgId, userId });
  const settings = await upsertSettings({
    orgId,
    userId,
    data: {
      appearanceTheme: normalizeTheme(payload.theme),
      appearanceFont: normalizeFont(payload.font),
    },
  });

  return serializeSettings(user, settings);
};

const updateDisplaySettings = async ({ orgId, userId, payload }) => {
  const user = await loadScopedUser({ orgId, userId });
  const items = normalizeDisplayItemsForUpdate(payload.items);
  if (!items.length) {
    throw new HttpError(
      400,
      "USER_SETTINGS_DISPLAY_EMPTY",
      "At least one navigation item must be selected",
    );
  }

  const settings = await upsertSettings({
    orgId,
    userId,
    data: { displayItems: items },
  });

  return serializeSettings(user, settings);
};

module.exports = {
  DEFAULT_DISPLAY_ITEMS,
  DISPLAY_ITEMS,
  FONTS,
  LANGUAGES,
  THEMES,
  getUserSettings,
  updateAccountSettings,
  updateAppearanceSettings,
  updateDisplaySettings,
  updateProfileSettings,
};
