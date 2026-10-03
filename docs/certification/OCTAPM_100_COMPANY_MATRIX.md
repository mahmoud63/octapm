# OctaPM certification — the hundred-company matrix

Generated 2026-10-03T20:06:06.100Z by `backend/scripts/cert/matrix-report.js` from the certification database
(`octapm_cert`), read in one read-only transaction. The specification the population was built from is
`backend/scripts/cert/lib/spec.js`; where the database differs from it, this document says so.

## Totals

| | Specification | Database |
|---|---|---|
| Companies | 100 | 100 |
| People | 3008 | 3008 |
| Memberships | 3052 | 3052 |
| Projects | 718 | 732 |
| Project team assignments | — | 9256 |
| Rows that belong to a company (all tables) | — | 2995633 |
| Tables with rows | — | 198 of 241 that belong to a company |

## Projects against the specification

Every project was compared by name with its company's specification. Every difference is explained.

- The certified project of each certified company (14) is built by the known-answer lifecycle under its own name, with a second project its security stage tests isolation on — one specified project, two in the database, hence 732 against 718:
  - 021: "Marina Residences" built by the lifecycle as "OCTA PHASE21 GREENFIELD C021" and "OCTA PHASE21 ISOLATION C021"
  - 027: "Lakeside Villas Phase 2" built by the lifecycle as "OCTA PHASE21 GREENFIELD C027" and "OCTA PHASE21 ISOLATION C027"
  - 033: "Northern Ring Road Section 4" built by the lifecycle as "OCTA PHASE21 GREENFIELD C033" and "OCTA PHASE21 ISOLATION C033"
  - 039: "Fire Station" built by the lifecycle as "OCTA PHASE21 GREENFIELD C039" and "OCTA PHASE21 ISOLATION C039"
  - 045: "Pedestrian Underpass" built by the lifecycle as "OCTA PHASE21 GREENFIELD C045" and "OCTA PHASE21 ISOLATION C045"
  - 051: "Data Centre Shell and Core" built by the lifecycle as "OCTA PHASE21 GREENFIELD C051" and "OCTA PHASE21 ISOLATION C051"
  - 057: "Business Bay Office Tower" built by the lifecycle as "OCTA PHASE21 GREENFIELD C057" and "OCTA PHASE21 ISOLATION C057"
  - 063: "Rail Overbridge" built by the lifecycle as "OCTA PHASE21 GREENFIELD C063" and "OCTA PHASE21 ISOLATION C063"
  - 069: "Logistics Park Warehouse B" built by the lifecycle as "OCTA PHASE21 GREENFIELD C069" and "OCTA PHASE21 ISOLATION C069"
  - 075: "Heritage Hotel Refurbishment" built by the lifecycle as "OCTA PHASE21 ISOLATION C075" and "OCTA PHASE21 GREENFIELD C075"
  - 081: "Pedestrian Underpass" built by the lifecycle as "OCTA PHASE21 GREENFIELD C081" and "OCTA PHASE21 ISOLATION C081"
  - 087: "Industrial Estate Roads" built by the lifecycle as "OCTA PHASE21 GREENFIELD C087" and "OCTA PHASE21 ISOLATION C087"
  - 093: "School Campus Block C" built by the lifecycle as "OCTA PHASE21 GREENFIELD C093" and "OCTA PHASE21 ISOLATION C093"
  - 099: "Airport Cargo Terminal" built by the lifecycle as "OCTA PHASE21 GREENFIELD C099" and "OCTA PHASE21 ISOLATION C099"

## By size

| Size | Companies | People per company | Projects per company | Roles in use per company | Plans |
|---|---|---|---|---|---|
| small | 20 | 2–8 | 1–3 | 2–5 | individual 11, trial 6, business 3 |
| medium | 50 | 10–27 | 3–10 | 9–9 | business 40, enterprise 8, individual 2 |
| large | 30 | 32–129 | 6–20 | 9–9 | business 15, enterprise 15 |

## How the companies differ

- **Currency** (14): USD 28, AED 12, SAR 10, EUR 9, EGP 8, GBP 8, AUD 5, CAD 5, QAR 4, INR 3, KWD 3, NZD 2, JPY 2, NPR 1.
- **Time zone** (24): Asia/Dubai 12, Africa/Cairo 8, (none chosen) 8, Asia/Riyadh 8, America/Los_Angeles 8, Pacific/Honolulu 6, Europe/London 6, America/Chicago 5, Asia/Qatar 4, Asia/Kolkata 3, Asia/Kuwait 3, Europe/Berlin 3, Australia/Perth 3, America/New_York 3, Europe/Athens 3, America/Denver 3, America/Vancouver 3, Europe/Madrid 2, Pacific/Auckland 2, Australia/Adelaide 2, Asia/Tokyo 2, Asia/Kathmandu 1, Europe/Paris 1, America/Toronto 1.
- **Plan and billing state**: business/active 44, enterprise/active 23, individual/active 10, business/canceled 6, trial/trialing 5, business/past_due 5, business/expired 3, individual/expired 1, trial/expired 1, individual/canceled 1, individual/past_due 1.
- **Seats**: 25 seats 24, 10 seats 21, 100 seats 16, 5 seats 15, 50 seats 14, 1 seats 7, 2 seats 3. Companies with more active people than seats: 38.
- **Project state**: active 535, archived (archived) 75, completed 58, on_hold 64.
- **Projects without their own time zone** (they fall back to the company's, then UTC): 18.
- **Membership state**: member/active 2909, member/suspended 143.
- **Owner is not a PM** in 41 companies; company administration is held by non-PM people in some and withheld from some PMs (see the specification's tests).

## People who belong to several companies

A role in one company must grant nothing in another. `*` marks company administration.

| Person | Companies | Distinct roles | Where (company:role) |
|---|---|---|---|
| user.c@multi.octapm-cert.test | 10 | 9 | 007:pm*, 019:site_engineer, 023:planning_eng, 034:qs, 045:cost_controller, 056:procurement, 067:warehouse, 078:quality_engineer, 089:finance, 100:site_engineer (suspended) |
| user.b@multi.octapm-cert.test | 5 | 5 | 012:qs, 029:finance, 048:procurement, 077:site_engineer, 095:pm |
| shared.01@multi.octapm-cert.test | 3 | 3 | 014:finance, 056:qs, 089:warehouse |
| shared.03@multi.octapm-cert.test | 3 | 3 | 033:finance, 054:warehouse, 078:site_engineer |
| shared.05@multi.octapm-cert.test | 3 | 3 | 047:quality_engineer, 063:qs, 092:pm |
| shared.07@multi.octapm-cert.test | 3 | 3 | 004:procurement, 056:pm, 079:finance |
| shared.09@multi.octapm-cert.test | 3 | 3 | 009:qs, 063:cost_controller, 065:planning_eng |
| shared.11@multi.octapm-cert.test | 3 | 3 | 036:procurement, 075:planning_eng, 083:cost_controller |
| shared.13@multi.octapm-cert.test | 3 | 3 | 001:procurement, 022:finance, 062:quality_engineer |
| shared.15@multi.octapm-cert.test | 3 | 3 | 022:warehouse, 024:site_engineer, 094:planning_eng |
| shared.17@multi.octapm-cert.test | 3 | 3 | 010:finance, 028:procurement, 082:cost_controller |
| shared.19@multi.octapm-cert.test | 3 | 3 | 007:finance, 037:qs, 058:pm |
| shared.02@multi.octapm-cert.test | 2 | 2 | 008:procurement, 040:planning_eng |
| shared.04@multi.octapm-cert.test | 2 | 2 | 044:planning_eng, 099:pm |
| shared.06@multi.octapm-cert.test | 2 | 2 | 005:procurement, 100:cost_controller |
| shared.08@multi.octapm-cert.test | 2 | 2 | 054:procurement, 074:qs |
| shared.10@multi.octapm-cert.test | 2 | 2 | 010:pm, 027:quality_engineer |
| shared.12@multi.octapm-cert.test | 2 | 2 | 006:pm, 085:quality_engineer |
| shared.14@multi.octapm-cert.test | 2 | 2 | 013:finance, 043:cost_controller |
| shared.16@multi.octapm-cert.test | 2 | 2 | 072:pm, 099:site_engineer |
| shared.18@multi.octapm-cert.test | 2 | 2 | 035:site_engineer, 067:quality_engineer |
| shared.20@multi.octapm-cert.test | 2 | 2 | 004:finance, 072:cost_controller |
| user.a@multi.octapm-cert.test | 2 | 2 | 004:pm*, 037:site_engineer |

## The hundred companies

| Code | Company | Size | People (active / not) | Roles | Admins | Plan / state / seats | Currency | Time zone | Projects (archived) | Rows | Record types |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 001 | Harbor Construction | small | 3 / 0 | 3 | 1 | individual / active / 2 | USD | Pacific/Honolulu | 1 (0) | 7228 | 195 |
| 002 | Summit Engineering & Construction | small | 3 / 0 | 3 | 1 | trial / trialing / 1 | EGP | Africa/Cairo | 1 (0) | 7142 | 194 |
| 003 | Ironbridge Civil Works | small | 4 / 0 | 4 | 1 | individual / expired / 5 | AED | Asia/Dubai | 3 (0) | 15104 | 197 |
| 004 | Meridian Constructors | small | 8 / 0 | 5 | 2 | business / active / 5 | EUR | Europe/Madrid | 1 (0) | 7861 | 197 |
| 005 | Cedar Ridge Contracting | small | 3 / 0 | 3 | 1 | trial / expired / 1 | INR | Asia/Kolkata | 1 (0) | 7073 | 193 |
| 006 | Atlas Infrastructure | small | 4 / 0 | 3 | 1 | business / active / 5 | AED | Asia/Dubai | 3 (0) | 14362 | 195 |
| 007 | Northgate Building Group | small | 6 / 0 | 4 | 2 | individual / active / 5 | KWD | Asia/Kuwait | 1 (0) | 8086 | 197 |
| 008 | Al Noor Builders | small | 6 / 0 | 5 | 1 | individual / active / 5 | NPR | Asia/Kathmandu | 2 (0) | 14564 | 197 |
| 009 | Delta General Contractors | small | 3 / 0 | 3 | 1 | trial / trialing / 1 | AED | Asia/Dubai | 1 (0) | 6950 | 194 |
| 010 | Keystone Developments | small | 5 / 0 | 4 | 1 | individual / active / 1 | GBP | Europe/London | 1 (0) | 7641 | 195 |
| 011 | Granite Peak Construction | small | 4 / 0 | 4 | 1 | individual / active / 5 | INR | Asia/Kolkata | 2 (0) | 7224 | 196 |
| 012 | Bluewater Engineering & Construction | small | 6 / 0 | 5 | 1 | trial / trialing / 1 | USD | — | 1 (0) | 7514 | 195 |
| 013 | Falcon Civil Works | small | 3 / 0 | 3 | 1 | trial / trialing / 1 | EUR | Europe/Berlin | 1 (0) | 6756 | 194 |
| 014 | Redwood Constructors | small | 4 / 0 | 4 | 1 | individual / active / 5 | KWD | Asia/Kuwait | 2 (0) | 14264 | 195 |
| 015 | Pinnacle Contracting | small | 4 / 0 | 4 | 1 | business / active / 2 | EGP | Africa/Cairo | 3 (1) | 14456 | 197 |
| 016 | Crescent Infrastructure | small | 5 / 0 | 5 | 1 | individual / canceled / 5 | USD | Pacific/Honolulu | 1 (0) | 7545 | 197 |
| 017 | Orion Building Group | small | 2 / 0 | 2 | 1 | individual / active / 2 | NZD | Pacific/Auckland | 2 (0) | 13977 | 195 |
| 018 | Sahara Builders | small | 3 / 0 | 3 | 1 | individual / active / 5 | USD | Pacific/Honolulu | 3 (0) | 14484 | 195 |
| 019 | Nile Valley General Contractors | small | 5 / 0 | 4 | 1 | individual / past_due / 5 | USD | America/Chicago | 1 (0) | 7466 | 197 |
| 020 | Gulf Horizon Developments | small | 5 / 0 | 5 | 1 | trial / trialing / 1 | SAR | Asia/Riyadh | 1 (0) | 7631 | 194 |
| 021 | Thames Construction | medium | 10 / 0 | 9 | 2 | business / active / 10 | AED | Asia/Dubai | 4 (1) | 1296 | 116 |
| 022 | Hudson Engineering & Construction | medium | 17 / 2 | 9 | 3 | business / expired / 25 | NZD | Pacific/Auckland | 4 (1) | 24966 | 198 |
| 023 | Bayou Civil Works | medium | 22 / 3 | 9 | 2 | business / active / 25 | SAR | Asia/Riyadh | 5 (0) | 25596 | 198 |
| 024 | Magnolia Constructors | medium | 11 / 0 | 9 | 2 | business / active / 10 | USD | — | 6 (0) | 24203 | 198 |
| 025 | Lone Star Contracting | medium | 15 / 2 | 9 | 3 | business / active / 10 | USD | Pacific/Honolulu | 7 (1) | 25984 | 198 |
| 026 | Cascade Infrastructure | medium | 21 / 3 | 9 | 2 | business / past_due / 25 | USD | America/Los_Angeles | 8 (1) | 25871 | 198 |
| 027 | Sierra Building Group | medium | 11 / 0 | 9 | 2 | enterprise / active / 10 | USD | America/Los_Angeles | 10 (2) | 25168 | 198 |
| 028 | Maple Leaf Builders | medium | 16 / 2 | 9 | 3 | business / active / 25 | USD | America/Los_Angeles | 10 (0) | 39963 | 198 |
| 029 | Aurora General Contractors | medium | 22 / 3 | 9 | 2 | individual / active / 5 | EUR | Europe/Paris | 3 (0) | 16720 | 198 |
| 030 | Stonebridge Developments | medium | 10 / 0 | 9 | 2 | enterprise / active / 5 | EGP | Africa/Cairo | 4 (0) | 24366 | 198 |
| 031 | Kingsway Construction | medium | 15 / 2 | 9 | 3 | enterprise / active / 25 | AED | Asia/Dubai | 5 (0) | 16884 | 198 |
| 032 | Blackrock Engineering & Construction | medium | 21 / 3 | 9 | 2 | enterprise / active / 25 | AED | Asia/Dubai | 6 (1) | 25836 | 198 |
| 033 | Al Waha Civil Works | medium | 11 / 0 | 9 | 2 | business / active / 10 | AED | Asia/Dubai | 8 (2) | 23880 | 198 |
| 034 | Corniche Constructors | medium | 16 / 2 | 9 | 3 | business / past_due / 25 | USD | America/Los_Angeles | 8 (0) | 34298 | 198 |
| 035 | Riverbend Contracting | medium | 22 / 3 | 9 | 2 | business / active / 10 | INR | Asia/Kolkata | 9 (1) | 24095 | 198 |
| 036 | Highland Infrastructure | medium | 11 / 0 | 9 | 2 | business / active / 10 | GBP | — | 10 (1) | 32519 | 198 |
| 037 | Oakmont Building Group | medium | 17 / 2 | 9 | 3 | business / canceled / 25 | AUD | Australia/Perth | 3 (0) | 16281 | 198 |
| 038 | Terra Firma Builders | medium | 21 / 3 | 9 | 2 | individual / active / 5 | EGP | Africa/Cairo | 3 (0) | 18116 | 198 |
| 039 | Vanguard General Contractors | medium | 10 / 0 | 9 | 2 | business / canceled / 10 | AUD | Australia/Adelaide | 6 (2) | 16820 | 198 |
| 040 | Zenith Developments | medium | 16 / 2 | 9 | 3 | business / active / 10 | SAR | Asia/Riyadh | 6 (0) | 24045 | 198 |
| 041 | Petra Construction | medium | 21 / 3 | 9 | 2 | enterprise / active / 25 | EUR | Europe/Madrid | 7 (0) | 26221 | 198 |
| 042 | Olympus Engineering & Construction | medium | 10 / 0 | 9 | 2 | business / active / 10 | USD | America/Los_Angeles | 8 (1) | 32584 | 198 |
| 043 | Brightwater Civil Works | medium | 16 / 2 | 9 | 3 | business / active / 25 | AED | Asia/Dubai | 9 (1) | 32933 | 198 |
| 044 | Copperfield Constructors | medium | 22 / 3 | 9 | 2 | business / active / 25 | EGP | Africa/Cairo | 10 (1) | 43781 | 198 |
| 045 | Dunmore Contracting | medium | 11 / 0 | 9 | 2 | business / active / 5 | SAR | Asia/Riyadh | 4 (2) | 9111 | 198 |
| 046 | Eastlake Infrastructure | medium | 15 / 2 | 9 | 3 | business / canceled / 25 | USD | America/New_York | 4 (0) | 23124 | 198 |
| 047 | Fairmont Building Group | medium | 22 / 3 | 9 | 2 | enterprise / active / 25 | EUR | Europe/Athens | 5 (0) | 24582 | 198 |
| 048 | Greystone Builders | medium | 11 / 0 | 9 | 2 | business / active / 10 | CAD | — | 6 (0) | 24348 | 198 |
| 049 | Hawthorne General Contractors | medium | 15 / 2 | 9 | 3 | enterprise / active / 25 | EGP | Africa/Cairo | 7 (1) | 32829 | 198 |
| 050 | Ibis Developments | medium | 21 / 3 | 9 | 2 | business / active / 10 | SAR | Asia/Riyadh | 8 (1) | 34420 | 198 |
| 051 | Harbor Builders | medium | 10 / 0 | 9 | 2 | business / active / 10 | SAR | Asia/Riyadh | 10 (1) | 16555 | 198 |
| 052 | Summit General Contractors | medium | 15 / 2 | 9 | 3 | business / active / 25 | USD | America/Chicago | 10 (1) | 38643 | 198 |
| 053 | Ironbridge Developments | medium | 21 / 3 | 9 | 2 | business / past_due / 25 | USD | America/New_York | 3 (0) | 16960 | 198 |
| 054 | Meridian Construction | medium | 12 / 0 | 9 | 2 | business / active / 10 | USD | America/Denver | 4 (0) | 23666 | 198 |
| 055 | Cedar Ridge Engineering & Construction | medium | 15 / 2 | 9 | 3 | business / active / 10 | AED | Asia/Dubai | 5 (1) | 18608 | 198 |
| 056 | Atlas Civil Works | medium | 24 / 3 | 9 | 2 | business / active / 25 | USD | America/Los_Angeles | 6 (1) | 30092 | 198 |
| 057 | Northgate Constructors | medium | 10 / 0 | 9 | 2 | business / active / 10 | CAD | America/Vancouver | 8 (1) | 24294 | 198 |
| 058 | Al Noor Contracting | medium | 16 / 2 | 9 | 3 | business / active / 25 | EUR | Europe/Athens | 8 (0) | 33319 | 198 |
| 059 | Delta Infrastructure | medium | 21 / 3 | 9 | 2 | business / active / 25 | USD | America/Chicago | 9 (1) | 37014 | 198 |
| 060 | Keystone Building Group | medium | 10 / 0 | 9 | 2 | business / active / 5 | SAR | — | 10 (1) | 39832 | 198 |
| 061 | Granite Peak Builders | medium | 15 / 2 | 9 | 3 | business / canceled / 25 | USD | America/Los_Angeles | 3 (0) | 8893 | 198 |
| 062 | Bluewater General Contractors | medium | 22 / 3 | 9 | 2 | business / expired / 25 | AUD | Australia/Perth | 4 (1) | 24421 | 198 |
| 063 | Falcon Developments | medium | 12 / 0 | 9 | 2 | business / active / 10 | EUR | Europe/Athens | 6 (1) | 17508 | 198 |
| 064 | Redwood Construction | medium | 15 / 2 | 9 | 3 | business / canceled / 25 | SAR | Asia/Riyadh | 6 (0) | 25315 | 198 |
| 065 | Pinnacle Engineering & Construction | medium | 22 / 3 | 9 | 2 | business / active / 10 | CAD | America/Vancouver | 7 (1) | 25405 | 198 |
| 066 | Crescent Civil Works | medium | 10 / 0 | 9 | 2 | business / active / 10 | AED | Asia/Dubai | 8 (1) | 24240 | 198 |
| 067 | Orion Constructors | medium | 17 / 2 | 9 | 3 | business / active / 25 | USD | America/Denver | 9 (1) | 36817 | 198 |
| 068 | Sahara Contracting | medium | 21 / 3 | 9 | 2 | enterprise / active / 25 | GBP | Europe/London | 10 (0) | 41411 | 198 |
| 069 | Nile Valley Infrastructure | medium | 10 / 0 | 9 | 2 | business / active / 10 | GBP | Europe/London | 4 (1) | 8766 | 197 |
| 070 | Gulf Horizon Building Group | medium | 15 / 2 | 9 | 3 | business / active / 10 | QAR | Asia/Qatar | 4 (0) | 23127 | 198 |
| 071 | Thames Builders | large | 101 / 3 | 9 | 2 | business / active / 100 | USD | America/Los_Angeles | 17 (1) | 67771 | 198 |
| 072 | Hudson General Contractors | large | 85 / 1 | 9 | 2 | business / past_due / 100 | SAR | — | 13 (2) | 66259 | 198 |
| 073 | Bayou Developments | large | 45 / 2 | 9 | 3 | business / active / 50 | USD | Pacific/Honolulu | 14 (1) | 52857 | 198 |
| 074 | Magnolia Construction | large | 33 / 3 | 9 | 2 | business / active / 50 | USD | America/Denver | 19 (2) | 71928 | 198 |
| 075 | Lone Star Engineering & Construction | large | 86 / 1 | 9 | 2 | enterprise / active / 50 | KWD | Asia/Kuwait | 20 (3) | 68220 | 198 |
| 076 | Cascade Civil Works | large | 40 / 2 | 9 | 3 | enterprise / active / 50 | QAR | Asia/Qatar | 6 (1) | 28361 | 198 |
| 077 | Sierra Constructors | large | 90 / 3 | 9 | 2 | business / active / 100 | CAD | America/Vancouver | 11 (1) | 45139 | 198 |
| 078 | Maple Leaf Contracting | large | 70 / 1 | 9 | 2 | enterprise / active / 100 | QAR | Asia/Qatar | 6 (0) | 31022 | 198 |
| 079 | Aurora Infrastructure | large | 94 / 2 | 9 | 3 | business / active / 100 | GBP | Europe/London | 17 (2) | 68586 | 198 |
| 080 | Stonebridge Building Group | large | 51 / 3 | 9 | 2 | business / past_due / 50 | AUD | Australia/Perth | 7 (1) | 36846 | 198 |
| 081 | Kingsway Builders | large | 96 / 1 | 9 | 2 | business / expired / 100 | EGP | Africa/Cairo | 14 (2) | 44315 | 198 |
| 082 | Blackrock General Contractors | large | 55 / 2 | 9 | 3 | enterprise / active / 100 | AUD | Australia/Adelaide | 18 (2) | 63558 | 198 |
| 083 | Al Waha Developments | large | 39 / 3 | 9 | 2 | business / canceled / 50 | USD | America/Chicago | 11 (1) | 44653 | 198 |
| 084 | Corniche Construction | large | 79 / 1 | 9 | 2 | enterprise / active / 100 | USD | — | 7 (0) | 41350 | 198 |
| 085 | Riverbend Engineering & Construction | large | 109 / 2 | 9 | 3 | enterprise / active / 50 | USD | Pacific/Honolulu | 14 (2) | 62066 | 198 |
| 086 | Highland Civil Works | large | 46 / 3 | 9 | 2 | enterprise / active / 50 | JPY | Asia/Tokyo | 20 (2) | 74075 | 198 |
| 087 | Oakmont Constructors | large | 51 / 1 | 9 | 2 | enterprise / active / 100 | EGP | Africa/Cairo | 10 (2) | 33247 | 198 |
| 088 | Terra Firma Contracting | large | 82 / 2 | 9 | 3 | business / active / 100 | GBP | Europe/London | 9 (0) | 45347 | 198 |
| 089 | Vanguard Infrastructure | large | 51 / 3 | 9 | 2 | business / active / 100 | JPY | Asia/Tokyo | 13 (1) | 60535 | 198 |
| 090 | Zenith Building Group | large | 65 / 1 | 9 | 2 | business / active / 50 | USD | America/Chicago | 18 (2) | 72300 | 198 |
| 091 | Petra Builders | large | 30 / 2 | 9 | 3 | enterprise / active / 50 | QAR | Asia/Qatar | 11 (1) | 35761 | 198 |
| 092 | Olympus General Contractors | large | 44 / 3 | 9 | 2 | enterprise / active / 50 | AED | Asia/Dubai | 10 (1) | 47596 | 198 |
| 093 | Brightwater Developments | large | 91 / 1 | 9 | 2 | enterprise / active / 100 | SAR | Asia/Riyadh | 12 (2) | 46824 | 198 |
| 094 | Copperfield Construction | large | 64 / 2 | 9 | 3 | enterprise / active / 100 | AED | Asia/Dubai | 10 (1) | 48751 | 198 |
| 095 | Dunmore Engineering & Construction | large | 71 / 3 | 9 | 2 | enterprise / active / 50 | USD | America/New_York | 8 (1) | 33830 | 198 |
| 096 | Eastlake Civil Works | large | 68 / 1 | 9 | 2 | business / active / 100 | GBP | — | 17 (2) | 63749 | 198 |
| 097 | Fairmont Constructors | large | 59 / 2 | 9 | 3 | business / active / 100 | EUR | Europe/Berlin | 19 (2) | 75028 | 198 |
| 098 | Greystone Contracting | large | 69 / 3 | 9 | 2 | enterprise / active / 100 | CAD | America/Toronto | 6 (0) | 33143 | 198 |
| 099 | Hawthorne Infrastructure | large | 41 / 1 | 9 | 2 | enterprise / active / 50 | EUR | Europe/Berlin | 7 (2) | 23063 | 198 |
| 100 | Ibis Building Group | large | 126 / 3 | 9 | 3 | business / active / 50 | GBP | Europe/London | 9 (1) | 46399 | 198 |

## Record types and how many companies hold them

Every table that belongs to a company, with its rows and the number of companies that have at least one row in it.
This is the ground the isolation tests stand on: a record type a company has no row of cannot be attacked in that company.

| Record type | Rows | Companies |
|---|---|---|
| notification | 447241 | 100 |
| notification_delivery_attempt | 408002 | 100 |
| outbound_event | 362581 | 100 |
| audit_event | 344273 | 100 |
| record_history_snapshot | 344273 | 100 |
| record_subscription | 110247 | 100 |
| approval_workflow_event | 99729 | 100 |
| workflow_status_history | 61088 | 100 |
| ipc_item | 40496 | 100 |
| project_document | 34105 | 100 |
| background_job | 33448 | 100 |
| ipc_item_progress_link | 25181 | 100 |
| document_text | 23418 | 100 |
| workflow_activity_link | 22947 | 100 |
| attachment | 22855 | 100 |
| document_revision | 21069 | 100 |
| cost_ledger_entry | 15649 | 100 |
| auth_audit_event | 12424 | 100 |
| stock_transaction | 12373 | 100 |
| punch_item_event | 11208 | 100 |
| procurement_po_line | 11006 | 100 |
| project_assignment | 9256 | 100 |
| photo | 9224 | 100 |
| activity_boq_allocation | 9081 | 100 |
| workflow_attachment | 8995 | 100 |
| meeting_attendee | 8708 | 100 |
| commitment_sov_line | 8517 | 100 |
| time_entry | 8283 | 100 |
| task_history | 8076 | 100 |
| boq_item | 7923 | 100 |
| direct_cost_line | 7536 | 100 |
| activity_assignment | 7269 | 100 |
| activity | 7269 | 100 |
| sub_pay_app_line | 7075 | 100 |
| progress_submission | 7025 | 100 |
| rfi_assignee | 6687 | 100 |
| procurement_order | 6679 | 100 |
| activity_dependency | 6610 | 100 |
| prequal_criterion | 6363 | 100 |
| location | 5848 | 100 |
| bid_line | 5644 | 100 |
| change_order_activity_link | 5222 | 100 |
| meeting_agenda_item | 4959 | 100 |
| direct_cost | 4794 | 100 |
| task_comment | 4640 | 100 |
| project_cost_code | 4627 | 100 |
| budget_line | 4627 | 100 |
| task | 4435 | 100 |
| commitment | 4432 | 100 |
| submittal | 4396 | 100 |
| cost_record | 4368 | 100 |
| daily_log_note | 4314 | 100 |
| punch_item | 4142 | 100 |
| stock_balance | 4018 | 100 |
| meeting_distribution | 3984 | 100 |
| change_order | 3739 | 100 |
| bid_invitation | 3617 | 100 |
| activity_progress | 3528 | 100 |
| rfi | 3260 | 100 |
| meeting_action_item | 3246 | 100 |
| inventory_item | 3214 | 100 |
| delivery_receipt_line | 3143 | 100 |
| organization_membership | 3052 | 100 |
| user | 3008 | 100 |
| daily_log_manpower | 2940 | 100 |
| sub_pay_app | 2939 | 100 |
| correspondence | 2918 | 100 |
| commercial_attachment_ref | 2915 | 100 |
| budget_line_change | 2895 | 100 |
| bid_package_line | 2748 | 100 |
| warehouse_location | 2723 | 100 |
| rfi_response | 2713 | 100 |
| refresh_session | 2667 | 100 |
| bid | 2642 | 100 |
| procurement_lead_time_alert | 2594 | 100 |
| budget_revision | 2589 | 100 |
| daily_log_delivery | 2507 | 100 |
| project_party | 2371 | 100 |
| ipc_certificate | 2336 | 100 |
| procurement_package | 2286 | 100 |
| cash_flow_entry | 2244 | 100 |
| daily_log_equipment | 2230 | 100 |
| weather_delay_activity_link | 2093 | 100 |
| delivery_receipt | 1992 | 100 |
| unit_of_measure | 1898 | 100 |
| company | 1850 | 100 |
| permission_template | 1850 | 100 |
| timesheet | 1829 | 100 |
| drawing_record | 1801 | 100 |
| weather_delay | 1785 | 100 |
| bid_package | 1639 | 100 |
| meeting | 1635 | 100 |
| meeting_decision | 1635 | 100 |
| procurement_supplier | 1631 | 100 |
| worker | 1532 | 100 |
| daily_log | 1482 | 100 |
| safety_incident | 1436 | 100 |
| sub_pay_app_payment | 1314 | 100 |
| daily_log_delay | 1263 | 100 |
| ipc_invoice | 1188 | 100 |
| warehouse | 1187 | 100 |
| transmittal | 1170 | 100 |
| ncr_record | 1167 | 100 |
| itp_record | 1158 | 100 |
| material_test | 1142 | 100 |
| defect_record | 993 | 100 |
| project | 732 | 100 |
| vendor_prequalification | 707 | 100 |
| cost_code | 700 | 100 |
| prime_contract | 339 | 100 |
| organisation | 100 | 100 |
| subscription | 100 | 100 |
| scope_matrix_item | 25350 | 99 |
| form_item_response | 14712 | 99 |
| form_item | 14698 | 99 |
| evaluation_criterion | 7800 | 99 |
| comment | 7636 | 99 |
| closeout_item | 6500 | 99 |
| conversation_message | 6383 | 99 |
| conversation_member | 5878 | 99 |
| risk_activity_link | 5179 | 99 |
| change_event_line | 4881 | 99 |
| wbs_node | 4860 | 99 |
| activity_cost_loading | 4317 | 99 |
| form_instance | 4185 | 99 |
| form_section | 3392 | 99 |
| quantity_progress_entry | 3353 | 99 |
| comment_mention | 3261 | 99 |
| change_event | 3097 | 99 |
| form_template | 2770 | 99 |
| risk | 2752 | 99 |
| submittal_step | 2600 | 99 |
| submittal_step_assignment | 2600 | 99 |
| commitment_change_order | 2448 | 99 |
| signature | 2355 | 99 |
| daily_log_quantity | 2118 | 99 |
| activity_progress_method | 2115 | 99 |
| budget_line_activity_allocation | 1963 | 99 |
| rfq | 1950 | 99 |
| workflow_step_assignment | 1950 | 99 |
| custom_field_value | 1950 | 99 |
| custom_field_definition | 1724 | 99 |
| conversation | 1670 | 99 |
| stock_transfer_line | 1625 | 99 |
| meeting_comment | 1621 | 99 |
| daily_log_visitor | 1499 | 99 |
| weekly_report | 1466 | 99 |
| reporting_period | 1396 | 99 |
| eot_claim | 1300 | 99 |
| eot_claim_activity_link | 1300 | 99 |
| eot_claim_weather_delay_link | 1300 | 99 |
| stock_transfer | 1300 | 99 |
| direct_cost_payment | 1300 | 99 |
| permission_template_tool | 1300 | 99 |
| workflow_instance | 1300 | 99 |
| long_lead_item | 1284 | 99 |
| notification_preference | 1188 | 99 |
| crew_member | 1137 | 99 |
| daily_report | 1135 | 99 |
| site_diary | 1133 | 99 |
| report_definition | 1074 | 99 |
| project_party_member | 1031 | 99 |
| scope_matrix | 975 | 99 |
| subcontract_closeout | 975 | 99 |
| gantt_layout | 975 | 99 |
| subcontractor_evaluation | 975 | 99 |
| activity_material | 940 | 99 |
| workflow_template | 749 | 99 |
| burn_rate_entry | 670 | 99 |
| budget_snapshot | 650 | 99 |
| permission_template_grant | 650 | 99 |
| submittal_package | 650 | 99 |
| submittal_workflow_template | 650 | 99 |
| bid_addendum | 650 | 99 |
| bid_question | 650 | 99 |
| schedule_revision | 646 | 99 |
| company_membership | 528 | 99 |
| change_order_allocation_link | 485 | 99 |
| drawing_set | 481 | 99 |
| task_attachment | 325 | 99 |
| ev_period_snapshot | 325 | 99 |
| activity_equipment_usage | 325 | 99 |
| crew | 325 | 99 |
| project_user_permission | 325 | 99 |
| report_schedule | 325 | 99 |
| report_run | 325 | 99 |
| project_fieldset | 325 | 99 |
| contract_profile | 325 | 99 |
| api_client | 198 | 99 |
| payment_method | 99 | 99 |
| custom_fieldset | 99 | 99 |
| record_type_definition | 99 | 99 |
| webhook_subscription | 99 | 99 |
| prime_contract_advance | 1542 | 96 |
| invoice | 273 | 94 |
| ipc_payment | 1448 | 90 |
| ipc_retention_release | 245 | 87 |
| invitation_token | 120 | 80 |

**Tables with no row in any company (43):** user_setting, password_reset_token, boq_revision, boq_item_code_integrity_report, boq_activity, extra_services_config, sub_valuation, sub_valuation_activity_link, sub_valuation_allocation_link, material_master, inventory_count, inventory_count_line, equipment, activity_equipment, activity_material_usage, resource_allocation, push_subscription, commercial_correspondence_link, enterprise_lead, company_equipment, project_template, sheet, sheet_revision, markup, pin, sheet_reference, spec_section, bim_model, bim_element, bim_element_link, inbound_email, lookahead, lookahead_item, project_exception, sso_ticket, document_chunk, project_health_snapshot, webhook_delivery, accounting_connection, accounting_code_mapping, accounting_sync, assistant_conversation, assistant_message.

