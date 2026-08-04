/**
 * Season phase + snapshot cadence.
 *
 * Captures run weekly during the regular season and playoffs, monthly during
 * the offseason/preseason. Snapshots are taken on Wednesdays, before the
 * Thursday night game that opens the next week, so a Wednesday capture during
 * week N reflects games completed through week N-1. Snapshots are therefore
 * labelled by the last *completed* week, which keeps projections and stat
 * leaders on a single, truthful timeline.
 *
 * The period key makes repeated workflow runs idempotent: a run landing in a
 * period that was already captured replaces that snapshot instead of appending.
 */

export const PHASES = {
  PRESEASON: 'preseason',
  REGULAR: 'regular',
  POSTSEASON: 'postseason',
  OFFSEASON: 'offseason',
};

/** Regular season is 18 weeks; the playoffs add 4 more rounds. */
export const REGULAR_WEEKS = 18;
export const POSTSEASON_ROUNDS = 4;
export const PLAYOFF_LABELS = ['Wild Card', 'Divisional', 'Conf Champ', 'Super Bowl'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** NFL week 1 kicks off the Thursday after the first Monday in September. */
export function regularSeasonStart(year, apiStartIso) {
  if (apiStartIso) {
    const d = new Date(apiStartIso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const sept = new Date(Date.UTC(year, 8, 1));
  const dow = sept.getUTCDay();
  const firstMonday = 1 + ((8 - dow) % 7);
  return new Date(Date.UTC(year, 8, firstMonday + 3, 0, 0, 0));
}

/**
 * Where a season stands at a given moment.
 * `completedWeek` is the last week whose games have finished (0 before week 1).
 */
export function describeSeason(year, now = new Date(), apiSeason = {}) {
  const start = regularSeasonStart(year, apiSeason.regularStart);
  const msPerWeek = 7 * 24 * 3600 * 1000;
  const started = now >= start;

  if (!started) {
    const preseasonStart = new Date(start.getTime() - 42 * 24 * 3600 * 1000);
    return {
      phase: now >= preseasonStart ? PHASES.PRESEASON : PHASES.OFFSEASON,
      week: 0,
      completedWeek: 0,
      started: false,
      start: start.toISOString(),
      cadence: 'monthly',
    };
  }

  // Weeks run Thursday-to-Wednesday; a Wednesday capture closes out the prior week.
  const currentWeek = Math.floor((now - start) / msPerWeek) + 1;
  const completedWeek = Math.max(0, currentWeek - 1);

  if (currentWeek <= REGULAR_WEEKS + 1) {
    return {
      phase: completedWeek === 0 ? PHASES.PRESEASON : PHASES.REGULAR,
      week: currentWeek,
      completedWeek,
      started: true,
      start: start.toISOString(),
      cadence: completedWeek === 0 ? 'monthly' : 'weekly',
    };
  }

  const round = currentWeek - REGULAR_WEEKS - 1;
  if (round <= POSTSEASON_ROUNDS) {
    return {
      phase: PHASES.POSTSEASON,
      week: currentWeek,
      completedWeek: REGULAR_WEEKS + round - 1,
      playoffRound: round,
      started: true,
      start: start.toISOString(),
      cadence: 'weekly',
    };
  }

  return {
    phase: PHASES.OFFSEASON,
    week: null,
    completedWeek: REGULAR_WEEKS + POSTSEASON_ROUNDS,
    started: true,
    start: start.toISOString(),
    cadence: 'monthly',
  };
}

/**
 * The NFL "data season" for a calendar date: the 2025 season runs from about
 * March 2025 through February 2026, so January and February belong to the
 * previous league year.
 */
export function activeSeasonYear(now = new Date()) {
  const y = now.getUTCFullYear();
  return now.getUTCMonth() <= 1 ? y - 1 : y;
}

/** Snapshot id for the period a capture belongs to. */
export function periodKey(year, info, now = new Date()) {
  if (info.cadence === 'weekly') return `${year}-w${String(info.completedWeek).padStart(2, '0')}`;
  return `${year}-m${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Human label for the x-axis. */
export function periodLabel(info, now = new Date()) {
  if (info.cadence === 'weekly') return weekLabel(info.completedWeek);
  return `${MONTHS[now.getUTCMonth()]} '${String(now.getUTCFullYear()).slice(2)}`;
}

export function weekLabel(completedWeek) {
  if (completedWeek <= 0) return 'Preseason';
  if (completedWeek <= REGULAR_WEEKS) return `Wk ${completedWeek}`;
  return PLAYOFF_LABELS[completedWeek - REGULAR_WEEKS - 1] ?? `Wk ${completedWeek}`;
}

export function monthLabel(date) {
  return `${MONTHS[date.getUTCMonth()]} '${String(date.getUTCFullYear()).slice(2)}`;
}

/**
 * Sort order across mixed cadences. Monthly snapshots taken before week 1 must
 * precede the weekly series, and monthly snapshots taken after the season ends
 * must follow it, so the rank is encoded above the value.
 */
export const ORDER_RANK = { PRE: 0, WEEKLY: 1_000_000, POST: 2_000_000 };

export function monthlyOrder(date, afterSeason = false) {
  return (afterSeason ? ORDER_RANK.POST : ORDER_RANK.PRE) + date.getUTCFullYear() * 12 + date.getUTCMonth();
}

export function weeklyOrder(completedWeek) {
  return ORDER_RANK.WEEKLY + completedWeek;
}

export function sortOrder(info, now = new Date()) {
  if (info.cadence === 'weekly') return weeklyOrder(info.completedWeek);
  return monthlyOrder(now, info.started);
}
