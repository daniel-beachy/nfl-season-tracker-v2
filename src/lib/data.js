/**
 * Static data access.
 *
 * All data is pre-generated JSON committed to the repo and served alongside the
 * app, so there are no runtime API calls, keys or CORS concerns.
 */

const BASE = import.meta.env.BASE_URL ?? '/';

const cache = new Map();

async function loadJson(relativePath) {
  if (cache.has(relativePath)) return cache.get(relativePath);
  const promise = fetch(`${BASE}data/${relativePath}`, { cache: 'no-cache' }).then((res) => {
    if (!res.ok) throw new Error(`Could not load ${relativePath} (${res.status})`);
    return res.json();
  });
  cache.set(relativePath, promise);
  return promise;
}

export const loadIndex = () => loadJson('index.json');
export const loadTeams = () => loadJson('teams.json');
export const loadSeason = (year) => loadJson(`seasons/${year}.json`);

/* -------------------------------------------------------------------------- */
/* Derived views                                                              */
/* -------------------------------------------------------------------------- */

export const CONFERENCES = ['AFC', 'NFC'];
export const DIVISIONS = [
  'AFC East', 'AFC North', 'AFC South', 'AFC West',
  'NFC East', 'NFC North', 'NFC South', 'NFC West',
];

/** Team abbreviations for a conference, alphabetical. */
export function teamsInConference(teamMeta, conf) {
  return Object.keys(teamMeta ?? {})
    .filter((abbr) => teamMeta[abbr]?.conf === conf)
    .sort();
}

export function teamsInDivision(teamMeta, division) {
  return Object.keys(teamMeta ?? {})
    .filter((abbr) => teamMeta[abbr]?.div === division)
    .sort();
}

/**
 * Build chart-ready series.
 * @returns {{labels: string[], series: {abbr: string, values: (number|null)[]}[]}}
 */
export function buildSeries(snapshots, abbrs, field) {
  const labels = snapshots.map((s) => s.label);
  const series = abbrs.map((abbr) => ({
    abbr,
    values: snapshots.map((s) => {
      const v = s.teams?.[abbr]?.[field];
      return v === undefined ? null : v;
    }),
  }));
  return { labels, series };
}

/**
 * Division odds are re-normalised to sum to 100% at each snapshot. The upstream
 * values already do so, but rounding and any future source change should not be
 * able to produce a division whose four lines add up to something else.
 */
export function buildNormalizedDivisionSeries(snapshots, abbrs, field = 'winDiv') {
  const labels = snapshots.map((s) => s.label);
  const series = abbrs.map((abbr) => ({ abbr, values: [] }));
  snapshots.forEach((snap, i) => {
    const raw = abbrs.map((abbr) => snap.teams?.[abbr]?.[field] ?? null);
    const total = raw.reduce((sum, v) => sum + (v ?? 0), 0);
    raw.forEach((v, j) => {
      series[j].values[i] = v === null ? null : total > 0 ? Math.round((v / total) * 1000) / 10 : 0;
    });
  });
  return { labels, series };
}

/** Rows for the current leaderboard, newest snapshot first. */
export function currentLeaders(seasonData, categoryKey) {
  const snaps = seasonData?.leaders?.snapshots ?? [];
  if (!snaps.length) return [];
  const latest = snaps[snaps.length - 1];
  const previous = snaps[snaps.length - 2];
  const prevByAthlete = new Map((previous?.byCategory?.[categoryKey] ?? []).map((r) => [r.id, r.v]));
  return (latest.byCategory?.[categoryKey] ?? []).map((row, i) => ({
    ...row,
    rank: i + 1,
    delta: prevByAthlete.has(row.id) ? Math.round((row.v - prevByAthlete.get(row.id)) * 100) / 100 : null,
    athlete: seasonData.leaders.athletes?.[row.id] ?? null,
  }));
}

/**
 * Time series for a leader category. Athletes are the union of everyone who has
 * appeared in the top ten at any point, so a player who fades is still drawn.
 */
export function buildLeaderSeries(seasonData, categoryKey) {
  const snaps = seasonData?.leaders?.snapshots ?? [];
  const labels = snaps.map((s) => s.label);
  const ids = new Set();
  for (const snap of snaps) for (const row of snap.byCategory?.[categoryKey] ?? []) ids.add(row.id);

  const latest = snaps[snaps.length - 1]?.byCategory?.[categoryKey] ?? [];
  const latestOrder = new Map(latest.map((r, i) => [r.id, i]));

  const series = [...ids].map((id) => {
    const values = snaps.map((snap) => {
      const row = snap.byCategory?.[categoryKey]?.find((r) => r.id === id);
      return row ? row.v : null;
    });
    const athlete = seasonData.leaders.athletes?.[id] ?? null;
    const team = snaps.map((s) => s.byCategory?.[categoryKey]?.find((r) => r.id === id)?.team).filter(Boolean).pop();
    return {
      id,
      abbr: team ?? athlete?.team ?? null,
      label: athlete?.short ?? athlete?.name ?? id,
      fullName: athlete?.name ?? id,
      values,
      rank: latestOrder.has(id) ? latestOrder.get(id) : 999,
    };
  });

  series.sort((a, b) => a.rank - b.rank);
  return { labels, series };
}
