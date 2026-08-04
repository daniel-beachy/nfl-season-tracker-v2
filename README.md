# NFL Season Tracker

A static dashboard that tracks how every NFL team's playoff and championship
outlook — and the league's statistical leaders — move over the course of a
season. Data is captured as periodic JSON snapshots committed to this repo by a
scheduled GitHub Action, so the live site is a plain static build with **no
backend, no database and no API keys**.

**Live site:** https://daniel-beachy.github.io/nfl-season-tracker-2026/

---

## What it shows

Two tabs, both scoped to the season chosen in the header (the current season is
the default, and the choice is reflected in the URL as `?season=YYYY`).

### Projections

| Chart | Detail |
| --- | --- |
| Win the Super Bowl | One chart, all 32 teams. Probabilities sum to 100%. |
| Reach the Super Bowl | Two charts, AFC and NFC, 16 teams each. |
| Make the playoffs | Two charts, AFC and NFC. Seven berths per conference. |
| Win the division | Eight charts, four teams each, re-normalised to 100% per division. |
| Projected win total | Expected regular-season wins, week over week. |

### Stat Leaders

Top ten per category, as both a week-over-week line chart and a current-total
leaderboard with week-over-week deltas. Categories cover passing, rushing,
receiving, scoring, defence and special teams — everything ESPN publishes.

Lines are drawn in each team's own colour. Hovering a line or a legend chip
isolates it, clicking a chip hides it, and alt-clicking isolates it.

---

## Architecture

```
scripts/                 Node capture pipeline (no build step, plain ESM)
  lib/espn.mjs           the only module that touches the network
  lib/season.mjs         phase / cadence / snapshot labelling
  lib/store.mjs          JSON persistence + index rebuild
  lib/simulate.mjs       Monte Carlo season simulator (2025 backfill only)
  lib/leaders.mjs        cumulative leader maths, passer rating
  capture.mjs            what the scheduled workflow runs
  backfill-2025.mjs      one-time 2025 reconstruction
  validate-data.mjs      structural + probability invariants

public/data/             the committed dataset the site reads
  index.json             season list, current season, snapshot counts
  teams.json             32 teams: colours, logos, names
  seasons/YYYY.json      every snapshot for that season

src/                     Vite + React 18 + Chart.js 4 front end
```

### Snapshot model

Every capture appends one record per season keyed by period:

* `{year}-w{NN}` weekly during the regular season and playoffs
* `{year}-m{YYYYMM}` monthly in the offseason and preseason

Re-running inside the same period **replaces** that period's snapshot instead of
appending a duplicate, so the workflow is safe to retry or trigger by hand.

Snapshots are labelled by the last **completed** week, not the upcoming one. A
Wednesday capture during week 8 reflects games through week 7 and is therefore
labelled `Wk 7`. This keeps projections and stat leaders on one truthful
timeline and makes the cumulative leader charts start at zero.

### Capture schedule

`.github/workflows/capture.yml` runs:

* `0 14 * * 3` — Wednesday 14:00 UTC (09:00 ET). Every game of the previous week
  has been played and the numbers have settled, but that week's Thursday night
  game has not yet kicked off.
* `0 14 1 * *` — the first of each month, which covers the offseason and
  preseason where ESPN refreshes its projections only occasionally.

The script decides its own cadence from the calendar, so the monthly cron is a
no-op duplicate during the season.

---

## Data sources

All ESPN, all keyless, all undocumented.

| Purpose | Endpoint |
| --- | --- |
| Projections | `site.web.api.espn.com/apis/fitt/v3/sports/football/nfl/powerindex` |
| Stat leaders | `sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{YEAR}/types/2/leaders` |
| Teams + colours | `site.api.espn.com/apis/site/v2/sports/football/nfl/teams` |

The `powerindex` `projections` category is mapped as:

| ESPN field | Used as |
| --- | --- |
| `probwintitle` | Win the Super Bowl |
| `probmaketitlegame` | Reach the Super Bowl |
| `probmakeplayoffs` | Make the playoffs |
| `probwindiv` | Win the division |
| `projectedw` | Projected win total |

Passing `?season=YYYY` returns that season's final values; without it the
endpoint returns the current season.

---

## Real vs. mocked data

**2026 (current) — fully real.** Captured live from ESPN on the schedule above.

**2025 — a deliberate split, surfaced in the UI:**

* **Stat leaders are real.** ESPN publishes only season totals, not weekly
  history, so the backfill pulls every leader's per-game log and re-accumulates
  it week by week. The week-18 totals match ESPN's published season totals
  exactly.
* **Projections are mocked.** ESPN does not publish historical weekly odds, so
  they are reconstructed with a Monte Carlo simulation: 4,000 seasons per
  checkpoint over the *real* remaining schedule, seeded with real FPI ratings and
  the real results to date. The curves are plausible and end on the real outcome,
  but they are not ESPN's actual week-by-week numbers.

The season dropdown labels 2025 as *"mocked, not fully accurate"* and a banner
explains the split on every tab.

### Invariants

`scripts/validate-data.mjs` enforces, for every snapshot:

* Win-Super-Bowl probabilities sum to 100 across 32 teams
* Reach-Super-Bowl sums to 200 (one champion per conference)
* Make-playoffs sums to 1400 (14 berths)
* Win-division sums to 100 within each division
* Cumulative leader values never decrease week over week

It runs after every capture and again before every deploy.

---

## Theming and colour

Dark and light themes, toggled in the header and persisted in `localStorage`,
with the choice applied before first paint to avoid a flash.

Several NFL primaries are near-black and several alternates are pure white, so
each team's colour is resolved per theme: the primary is used when its luminance
falls inside a legible band, otherwise the alternate, otherwise the colour is
shaded until it does. The 32 colours are then assigned league-wide in one pass so
that a team looks identical in every chart, with teams swapping to their
alternate — and finally to a shaded variant — when they would otherwise collide.
Where two lines in the same chart are still close, they get different dash
patterns.

---

## Local development

```bash
npm install
npm run dev        # http://localhost:5180/nfl-season-tracker-2026/
npm run build      # static output in dist/
npm run preview
```

Data commands:

```bash
npm run capture              # snapshot the active season
npm run capture -- --season 2026
npm run capture:teams        # refresh team metadata only
npm run backfill             # rebuild the 2025 season (one-time, slow)
npm run validate             # check every invariant
```

`BASE_PATH` controls the Vite base path and defaults to
`/nfl-season-tracker-2026/`; the deploy workflow sets it from the repository
name, so a fork deploys correctly without any edits.

---

## Adding a new season

Nothing to do. When ESPN rolls over to the next season, `capture.mjs` detects it,
creates `public/data/seasons/{year}.json`, adds it to `index.json`, and the
dropdown picks it up on the next deploy.

---

Not affiliated with the NFL or ESPN. Data belongs to its respective owners and
is used here for a non-commercial hobby project.
