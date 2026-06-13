const normalizeBoqCode = (value) => {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  return normalized ? normalized.toUpperCase() : "";
};

const activeBoqCodeKey = (value, isActive = true) => {
  const code = normalizeBoqCode(value);
  return isActive && code ? code : null;
};

module.exports = {
  activeBoqCodeKey,
  normalizeBoqCode,
};
