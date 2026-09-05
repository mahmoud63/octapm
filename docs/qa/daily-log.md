# Project daily log (OCTA-FLD-DAILY-022)

One log per project per day with typed sections — **manpower, equipment, deliveries, visitors, delays, notes** — instead of free JSON. Weather is filled from a feed by the site's coordinates (breaches raise a suggested weather delay), yesterday's crews and plant copy forward, collaborators (contractor / subcontractor parties) log their own rows for the site team to review, and the day goes out as a PDF to the distribution list by hand or every evening.

## Where

Project → Site Reporting → **Daily Log** (first tab). Notification links open the day: `/projects/:id/site-reporting?date=YYYY-MM-DD`.

## Roles

| Action | Base roles | Party templates |
| --- | --- | --- |
| Read | progress readers | owner, consultant, contractor, subcontractor |
| Add / edit / delete entries (`daily_log.submit`) | PM, planning, site engineer | contractor, subcontractor (own company's rows only; they are **submitted** and need review) |
| Weather, summary, register a weather delay (`daily_log.update`) | PM, planning, site engineer | — |
| Accept / return collaborator rows, confirm suggestions (`daily_log.entry_review`) | PM, planning, site engineer | — |
| Submit the day (`daily_log.submit`) | PM, planning, site engineer | — |
| Approve / reopen the day (`daily_log.approve`) | PM | — |
| Send the PDF (`daily_log.distribute`) | PM, planning, site engineer | — |
| Settings (`daily_log.configure`) | PM | — |

Staff entries are approved as they are written. A party user sees only their own company's rows. An approved day is locked; a submitted day is locked for party users.

## Weather

- Settings → latitude / longitude / time zone. The feed is Open-Meteo (no key); `WEATHER_FEED_ENABLED=false` switches it off server-wide, the project switch turns it off per project.
- A `daily_log.weather` job per organisation runs every 30 minutes (today, and yesterday until its figures are final). **Fetch** on the weather card does it on demand. Hand-entered weather is never overwritten by the job.
- Thresholds (rain ≥ mm, low ≤ °C, high ≥ °C, wind ≥ km/h) → one **suggested** weather delay per day (`source = weather_feed`, status draft) for the site team to confirm (set hours lost, Accept) or dismiss. A confirmed weather delay can be put on the contractual **weather delay register** (Commercial → Weather Delays) with one click; days default to hours lost ÷ 8.

## Copy previous day

**Copy previous day** brings manpower and equipment (configurable) from the most recent day in the last two weeks that has them; a section that already has rows today is skipped. Party users copy their own rows only.

## Distribution

- Settings → roles (in-app + email through notifications) and external addresses (plain-text digest of the day, since they have no login). The PDF is filed on the day (Evidence) and linked from the distribution record.
- **Send PDF** sends now with an optional message and extra addresses. **Send automatically at HH:mm** (site time) queues a `daily_log.distribute` job once the project's local clock passes the time and the day has content and has not gone out yet.

## Manpower report

**Manpower report** (button on the panel): worker-days, man-hours, days and average per day by company, trade, company × trade or activity over a date range, with a per-day chart — from approved and submitted manpower rows.

## Walkthrough

1. Settings: coordinates, time zone, thresholds, distribution roles/emails, 18:00 auto send.
2. Open today, press **Fetch** — weather fills; if it rained ≥ threshold a *Suggested* delay appears under Delays.
3. **Copy previous day**, adjust crews, add deliveries/visitors/notes. As a subcontractor party user, add manpower — it shows *Awaiting review*; as site engineer, Accept or Return with a reason.
4. Edit the suggested delay (hours lost), **Confirm**, then **Register** to place it on the weather-delay register.
5. **Submit day** → PM **Approve day** (pending rows are approved with it). **Send PDF** → notification + emails; the PDF appears under the day's Evidence.
6. **Manpower report** by company across the last 30 days.

## Verification

- `backend`: `npx jest src/services/__tests__/daily-log.service.test.js src/services/__tests__/weather-feed.service.test.js` (staff vs party entries, replay, locks, copy-forward, weather + suggestion, submit/approve/reopen, manpower report, distribution with PDF + emails, scheduled queueing, register hand-off, settings validation).
- `frontend`: `node scripts/daily-log-ui.test.mjs`.
- OpenAPI: `node scripts/validate-openapi.js` (18 `/daily-logs` routes under **Site Reporting**).
