/**
 * Stat-leader helpers shared by the capture and backfill scripts.
 *
 * ESPN's leaders endpoint reports season-to-date totals only. To reconstruct a
 * week-by-week series for a season that has already been played we sum each
 * athlete's real per-game log. Category keys mostly match gamelog stat names
 * one-for-one; the resolvers below cover the handful that don't.
 */

const num = (v) => (Number.isFinite(v) ? v : 0);

/**
 * Per-category accumulators.
 * `game` extracts a per-game contribution; `finish` turns cumulative component
 * totals into the displayed value (used for rate stats such as passer rating).
 */
export const LEADER_RESOLVERS = {
  quarterbackRating: {
    components: ['completions', 'passingAttempts', 'passingYards', 'passingTouchdowns', 'interceptions'],
    finish: (c) => passerRating(c),
    precision: 1,
  },
  totalTouchdowns: {
    game: (s) =>
      num(s.rushingTouchdowns) +
      num(s.receivingTouchdowns) +
      num(s.kickReturnTouchdowns) +
      num(s.puntReturnTouchdowns) +
      num(s.interceptionTouchdowns) +
      num(s.fumbleReturnTouchdowns),
  },
  totalPoints: {
    game: (s) =>
      'totalKickingPoints' in s
        ? num(s.totalKickingPoints)
        : 6 * (num(s.rushingTouchdowns) + num(s.receivingTouchdowns) + num(s.kickReturnTouchdowns) + num(s.puntReturnTouchdowns)),
  },
};

/** Standard NFL passer rating; each component is clamped to [0, 2.375]. */
export function passerRating({ completions, passingAttempts, passingYards, passingTouchdowns, interceptions }) {
  const att = num(passingAttempts);
  if (att <= 0) return 0;
  const clamp = (x) => Math.max(0, Math.min(2.375, x));
  const a = clamp((num(completions) / att - 0.3) * 5);
  const b = clamp((num(passingYards) / att - 3) * 0.25);
  const c = clamp((num(passingTouchdowns) / att) * 20);
  const d = clamp(2.375 - (num(interceptions) / att) * 25);
  return ((a + b + c + d) / 6) * 100;
}

/**
 * Build cumulative-by-week values for one category.
 * @returns {Map<number, number>} completed week -> cumulative value
 */
export function cumulativeByWeek(categoryKey, gameLog, maxWeek) {
  const resolver = LEADER_RESOLVERS[categoryKey];
  const series = new Map();
  if (!gameLog?.games?.length) return series;

  if (resolver?.components) {
    const totals = Object.fromEntries(resolver.components.map((c) => [c, 0]));
    let cursor = 0;
    for (let week = 1; week <= maxWeek; week++) {
      while (cursor < gameLog.games.length && gameLog.games[cursor].week <= week) {
        const s = gameLog.games[cursor].stats;
        for (const c of resolver.components) totals[c] += num(s[c]);
        cursor++;
      }
      series.set(week, round(resolver.finish(totals), resolver.precision ?? 1));
    }
    return series;
  }

  const extract = resolver?.game ?? ((s) => num(s[categoryKey]));
  let total = 0;
  let cursor = 0;
  for (let week = 1; week <= maxWeek; week++) {
    while (cursor < gameLog.games.length && gameLog.games[cursor].week <= week) {
      total += extract(gameLog.games[cursor].stats);
      cursor++;
    }
    series.set(week, round(total, 2));
  }
  return series;
}

/** True when a category's weekly history can be rebuilt from game logs. */
export function isReconstructable(categoryKey, sampleNames = []) {
  if (LEADER_RESOLVERS[categoryKey]) return true;
  return sampleNames.includes(categoryKey);
}

function round(v, digits = 2) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
