const { HttpError } = require("../utils/http-error");

/**
 * Daily weather by coordinates (OCTA-FLD-DAILY-022).
 *
 * Uses the Open-Meteo forecast API (no key) for recent days and its archive
 * API for older dates. The result is normalised so the daily log stores the
 * same shape whether the numbers came from the feed or were typed in.
 */

const FORECAST_URL = process.env.WEATHER_FEED_FORECAST_URL || "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = process.env.WEATHER_FEED_ARCHIVE_URL || "https://archive-api.open-meteo.com/v1/archive";
const TIMEOUT_MS = Number(process.env.WEATHER_FEED_TIMEOUT_MS) || 10_000;
const ARCHIVE_AFTER_DAYS = 5;

/** WMO weather interpretation codes → short labels. */
const CONDITIONS = Object.freeze({
  0: "Clear",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Heavy freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Heavy freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Violent showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with heavy hail",
});

const DEFAULT_THRESHOLDS = Object.freeze({
  rainMm: 10,
  tempMinC: 0,
  tempMaxC: 40,
  windKph: 50,
});

const isEnabled = () => String(process.env.WEATHER_FEED_ENABLED ?? "true").toLowerCase() !== "false";

const conditionFor = (code) => (code === null || code === undefined ? null : CONDITIONS[Number(code)] || `Code ${code}`);

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 10) / 10 : null;
};

const daysBetween = (from, to) => Math.round((to.getTime() - from.getTime()) / 86_400_000);

const pickEndpoint = (dateKey, now = new Date()) => {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return daysBetween(date, today) > ARCHIVE_AFTER_DAYS ? ARCHIVE_URL : FORECAST_URL;
};

/** Turns an Open-Meteo daily response into the log's weather shape. */
const normalizeDaily = (body, dateKey) => {
  const daily = body?.daily || {};
  const index = Array.isArray(daily.time) ? daily.time.indexOf(dateKey) : -1;
  if (index < 0) return null;
  const at = (key) => (Array.isArray(daily[key]) ? daily[key][index] : null);
  const code = at("weather_code");
  const weather = {
    source: "open-meteo",
    date: dateKey,
    code: code === null || code === undefined ? null : Number(code),
    condition: conditionFor(code),
    tempMinC: numberOrNull(at("temperature_2m_min")),
    tempMaxC: numberOrNull(at("temperature_2m_max")),
    precipitationMm: numberOrNull(at("precipitation_sum")),
    windMaxKph: numberOrNull(at("wind_speed_10m_max")),
    windGustKph: numberOrNull(at("wind_gusts_10m_max")),
    timezone: body.timezone || null,
    fetchedAt: new Date().toISOString(),
  };
  weather.summary = summarize(weather);
  return weather;
};

const summarize = (weather) => {
  if (!weather) return null;
  const parts = [];
  if (weather.condition) parts.push(weather.condition);
  if (weather.tempMinC !== null && weather.tempMaxC !== null) parts.push(`${weather.tempMinC}–${weather.tempMaxC} °C`);
  else if (weather.tempMaxC !== null) parts.push(`${weather.tempMaxC} °C`);
  if (weather.precipitationMm !== null && weather.precipitationMm > 0) parts.push(`${weather.precipitationMm} mm rain`);
  if (weather.windMaxKph !== null) parts.push(`wind ${weather.windMaxKph} km/h`);
  return parts.join(" · ") || null;
};

/**
 * Fetches the daily figures for one date. `fetchImpl` is injectable for tests.
 */
const fetchDailyWeather = async ({ latitude, longitude, date, timezone = "auto", fetchImpl = globalThis.fetch, now = new Date() }) => {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
    throw new HttpError(400, "WEATHER_COORDINATES_REQUIRED", "Set the site latitude and longitude first");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    throw new HttpError(400, "INVALID_DATE", "Date must be YYYY-MM-DD");
  }
  const url = new URL(pickEndpoint(date, now));
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max");
  url.searchParams.set("timezone", timezone || "auto");
  url.searchParams.set("start_date", date);
  url.searchParams.set("end_date", date);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(url.toString(), { signal: controller.signal, headers: { accept: "application/json" } });
  } catch (error) {
    const failure = new HttpError(502, "WEATHER_FEED_UNAVAILABLE", "The weather service did not answer");
    failure.details = { reason: error?.name === "AbortError" ? "timeout" : error?.message };
    throw failure;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const failure = new HttpError(502, "WEATHER_FEED_UNAVAILABLE", "The weather service rejected the request");
    failure.details = { status: response.status };
    throw failure;
  }
  const body = await response.json();
  const weather = normalizeDaily(body, date);
  if (!weather) {
    throw new HttpError(502, "WEATHER_FEED_NO_DATA", "The weather service has no figures for that day yet");
  }
  return weather;
};

/**
 * Compares a day's figures against the project's thresholds. Returns one alert
 * per breached metric; an empty array means nothing to flag.
 */
const evaluateThresholds = (weather, thresholds = {}) => {
  if (!weather) return [];
  const limits = { ...DEFAULT_THRESHOLDS, ...(thresholds || {}) };
  const alerts = [];
  const rain = numberOrNull(weather.precipitationMm);
  if (rain !== null && limits.rainMm !== null && limits.rainMm !== undefined && rain >= Number(limits.rainMm)) {
    alerts.push({ metric: "rain", value: rain, threshold: Number(limits.rainMm), message: `Rainfall ${rain} mm reached the ${limits.rainMm} mm threshold` });
  }
  const tempMin = numberOrNull(weather.tempMinC);
  if (tempMin !== null && limits.tempMinC !== null && limits.tempMinC !== undefined && tempMin <= Number(limits.tempMinC)) {
    alerts.push({ metric: "cold", value: tempMin, threshold: Number(limits.tempMinC), message: `Low of ${tempMin} °C is at or below the ${limits.tempMinC} °C threshold` });
  }
  const tempMax = numberOrNull(weather.tempMaxC);
  if (tempMax !== null && limits.tempMaxC !== null && limits.tempMaxC !== undefined && tempMax >= Number(limits.tempMaxC)) {
    alerts.push({ metric: "heat", value: tempMax, threshold: Number(limits.tempMaxC), message: `High of ${tempMax} °C reached the ${limits.tempMaxC} °C threshold` });
  }
  const wind = numberOrNull(weather.windGustKph ?? weather.windMaxKph);
  if (wind !== null && limits.windKph !== null && limits.windKph !== undefined && wind >= Number(limits.windKph)) {
    alerts.push({ metric: "wind", value: wind, threshold: Number(limits.windKph), message: `Wind ${wind} km/h reached the ${limits.windKph} km/h threshold` });
  }
  return alerts;
};

module.exports = {
  CONDITIONS,
  DEFAULT_THRESHOLDS,
  conditionFor,
  evaluateThresholds,
  fetchDailyWeather,
  isEnabled,
  normalizeDaily,
  summarize,
};
