const feed = require("../weather-feed.service");

const body = (date, overrides = {}) => ({
  timezone: "Asia/Riyadh",
  daily: {
    time: [date],
    weather_code: [63],
    temperature_2m_max: [38.4],
    temperature_2m_min: [27.1],
    precipitation_sum: [14.2],
    wind_speed_10m_max: [31.5],
    wind_gusts_10m_max: [58.9],
    ...overrides,
  },
});

describe("weather feed", () => {
  it("fetches and normalises a day from the forecast endpoint", async () => {
    const calls = [];
    const fetchImpl = jest.fn(async (url) => {
      calls.push(url);
      return { ok: true, json: async () => body("2026-09-05") };
    });
    const weather = await feed.fetchDailyWeather({ latitude: 24.7, longitude: 46.7, date: "2026-09-05", timezone: "Asia/Riyadh", fetchImpl, now: new Date("2026-09-05T12:00:00Z") });
    expect(calls[0]).toContain("api.open-meteo.com/v1/forecast");
    expect(calls[0]).toContain("start_date=2026-09-05");
    expect(weather).toMatchObject({ source: "open-meteo", condition: "Rain", code: 63, tempMinC: 27.1, tempMaxC: 38.4, precipitationMm: 14.2, windMaxKph: 31.5, windGustKph: 58.9, timezone: "Asia/Riyadh" });
    expect(weather.summary).toBe("Rain · 27.1–38.4 °C · 14.2 mm rain · wind 31.5 km/h");
  });

  it("uses the archive endpoint for older days and fails cleanly", async () => {
    const fetchImpl = jest.fn(async (url) => ({ ok: true, json: async () => (url.includes("archive") ? body("2026-06-01") : { daily: { time: [] } }) }));
    const old = await feed.fetchDailyWeather({ latitude: 1, longitude: 2, date: "2026-06-01", fetchImpl, now: new Date("2026-09-05T12:00:00Z") });
    expect(fetchImpl.mock.calls[0][0]).toContain("archive-api.open-meteo.com");
    expect(old.condition).toBe("Rain");
    await expect(feed.fetchDailyWeather({ latitude: 1, longitude: 2, date: "2026-09-05", fetchImpl: async () => ({ ok: false, status: 500 }) })).rejects.toMatchObject({ code: "WEATHER_FEED_UNAVAILABLE" });
    await expect(feed.fetchDailyWeather({ latitude: 1, longitude: 2, date: "2026-09-05", fetchImpl: async () => ({ ok: true, json: async () => ({ daily: { time: ["2026-09-04"] } }) }) })).rejects.toMatchObject({ code: "WEATHER_FEED_NO_DATA" });
    await expect(feed.fetchDailyWeather({ latitude: null, longitude: 2, date: "2026-09-05", fetchImpl })).rejects.toMatchObject({ code: "WEATHER_COORDINATES_REQUIRED" });
  });

  it("flags rain, heat, cold and wind against the project thresholds", () => {
    const weather = { precipitationMm: 14.2, tempMinC: 27.1, tempMaxC: 41, windMaxKph: 31.5, windGustKph: 58.9 };
    const alerts = feed.evaluateThresholds(weather, { rainMm: 10, tempMaxC: 40, windKph: 50, tempMinC: 0 });
    expect(alerts.map((alert) => alert.metric)).toEqual(["rain", "heat", "wind"]);
    expect(alerts[0].message).toBe("Rainfall 14.2 mm reached the 10 mm threshold");
    expect(feed.evaluateThresholds({ precipitationMm: 2, tempMinC: -3, tempMaxC: 12, windMaxKph: 20 }, { tempMinC: 0 }).map((alert) => alert.metric)).toEqual(["cold"]);
    expect(feed.evaluateThresholds({ precipitationMm: 50 }, { rainMm: null })).toEqual([]);
    expect(feed.evaluateThresholds(null)).toEqual([]);
  });
});
