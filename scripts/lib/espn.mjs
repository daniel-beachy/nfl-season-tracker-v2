/**
 * Keyless ESPN endpoint client.
 *
 * Every endpoint used here is public and requires no API key or auth header.
 * All network access for the project funnels through this module so the set of
 * external dependencies stays auditable and easy to swap.
 */

const UA =
  'Mozilla/5.0 (compatible; nfl-season-tracker/1.0; +https://github.com/daniel-beachy/nfl-season-tracker-2026)';

export const ENDPOINTS = {
  powerIndex: 'https://site.web.api.espn.com/apis/fitt/v3/sports/football/nfl/powerindex',
  teams: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams',
  leaders: (year, seasonType = 2) =>
    `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${year}/types/${seasonType}/leaders`,
  gameLog: (athleteId, year) =>
    `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${athleteId}/gamelog?season=${year}`,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch JSON with retry + exponential backoff. Returns null on 404 when allowed. */
export async function getJson(url, { retries = 4, timeoutMs = 25000, allow404 = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json', 'user-agent': UA },
      });
      clearTimeout(timer);
      if (res.status === 404) {
        if (allow404) return null;
        throw new Error(`404 for ${url}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const json = await res.json();
      if (json && json.error) {
        if (allow404) return null;
        throw new Error(`API error for ${url}: ${JSON.stringify(json.error)}`);
      }
      return json;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) await sleep(400 * 2 ** attempt + Math.random() * 250);
    }
  }
  throw lastErr;
}

/** Run tasks with bounded concurrency, preserving input order in the result. */
export async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/* -------------------------------------------------------------------------- */
/* Teams + colors                                                             */
/* -------------------------------------------------------------------------- */

export async function fetchTeams() {
  const raw = await getJson(ENDPOINTS.teams);
  const entries = raw?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const teams = entries.map(({ team }) => ({
    id: String(team.id),
    abbr: team.abbreviation,
    name: team.displayName,
    shortName: team.shortDisplayName,
    nickname: team.nickname ?? team.name,
    location: team.location,
    color: normalizeHex(team.color),
    altColor: normalizeHex(team.alternateColor),
    logo: team.logos?.find((l) => l.rel?.includes('default'))?.href ?? team.logos?.[0]?.href ?? null,
    logoDark:
      team.logos?.find((l) => l.rel?.includes('dark'))?.href ??
      team.logos?.find((l) => l.rel?.includes('default'))?.href ??
      null,
  }));
  teams.sort((a, b) => a.abbr.localeCompare(b.abbr));
  return teams;
}

function normalizeHex(value) {
  if (!value) return null;
  const hex = String(value).replace(/^#/, '').trim().toLowerCase();
  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : null;
}

/* -------------------------------------------------------------------------- */
/* Projections (FPI power index)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Field mapping confirmed against the live payload:
 *   projectedw          -> projected wins
 *   probwindiv          -> win division %
 *   probmakeplayoffs    -> make playoffs %
 *   probmaketitlegame   -> make Super Bowl % ("Prob Make Title Game")
 *   probwintitle        -> win Super Bowl %  ("Prob Win Title")
 */
export const PROJECTION_FIELDS = {
  projectedw: 'projWins',
  projectedl: 'projLosses',
  probwindiv: 'winDiv',
  probmakeplayoffs: 'makePlayoffs',
  probmaketitlegame: 'makeSB',
  probwintitle: 'winSB',
  probmakeconfchamp: 'makeConfChamp',
  probmakedivplayoffs: 'makeDivRound',
};

const FPI_FIELDS = { fpi: 'fpi', fpirank: 'fpiRank', numwins: 'w', numlosses: 'l', numties: 't' };

export async function fetchProjections(year) {
  const url = year ? `${ENDPOINTS.powerIndex}?season=${year}` : ENDPOINTS.powerIndex;
  const raw = await getJson(url);
  const projMeta = raw.categories?.find((c) => c.name === 'projections');
  const fpiMeta = raw.categories?.find((c) => c.name === 'fpi');
  if (!projMeta) throw new Error('powerindex payload missing "projections" category');

  const teams = {};
  for (const entry of raw.teams ?? []) {
    const abbr = entry.team?.abbreviation;
    if (!abbr) continue;
    const projValues = entry.categories?.find((c) => c.name === 'projections')?.values ?? [];
    const fpiValues = entry.categories?.find((c) => c.name === 'fpi')?.values ?? [];
    const record = {
      id: String(entry.team.id),
      conf: entry.team.group?.parent?.abbreviation ?? null,
      div: entry.team.group?.name ?? null,
    };
    projMeta.names.forEach((name, i) => {
      const key = PROJECTION_FIELDS[name];
      if (key) record[key] = round(projValues[i]);
    });
    fpiMeta?.names.forEach((name, i) => {
      const key = FPI_FIELDS[name];
      if (key) record[key] = round(fpiValues[i]);
    });
    teams[abbr] = record;
  }

  return {
    teams,
    season: {
      year: raw.requestedSeason?.year ?? raw.currentSeason?.year ?? year ?? null,
      currentYear: raw.currentSeason?.year ?? null,
      startDate: raw.requestedSeason?.startDate ?? null,
      endDate: raw.requestedSeason?.endDate ?? null,
      typeName: raw.requestedSeason?.type?.name ?? null,
      regularStart: raw.requestedSeason?.type?.startDate ?? null,
      regularEnd: raw.requestedSeason?.type?.endDate ?? null,
      week: raw.requestedSeason?.type?.week?.number ?? null,
    },
    lastUpdated: raw.lastUpdated ?? null,
  };
}

function round(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.round(Number(value) * 100) / 100;
}

/* -------------------------------------------------------------------------- */
/* Stat leaders                                                               */
/* -------------------------------------------------------------------------- */

/** Categories we surface, in display order, with a grouping used by the UI. */
export const LEADER_CATEGORIES = [
  { key: 'passingYards', group: 'Passing' },
  { key: 'passingTouchdowns', group: 'Passing' },
  { key: 'quarterbackRating', group: 'Passing', cumulative: false },
  { key: 'rushingYards', group: 'Rushing' },
  { key: 'rushingTouchdowns', group: 'Rushing' },
  { key: 'receivingYards', group: 'Receiving' },
  { key: 'receivingTouchdowns', group: 'Receiving' },
  { key: 'receptions', group: 'Receiving' },
  { key: 'totalTouchdowns', group: 'Scoring' },
  { key: 'totalPoints', group: 'Scoring' },
  { key: 'totalTackles', group: 'Defense' },
  { key: 'sacks', group: 'Defense' },
  { key: 'interceptions', group: 'Defense' },
  { key: 'passesDefended', group: 'Defense' },
  { key: 'kickoffYards', group: 'Special Teams' },
  { key: 'puntYards', group: 'Special Teams' },
];

const TEAM_ID_RE = /\/teams\/(\d+)/;
const ATHLETE_ID_RE = /\/athletes\/(\d+)/;

/**
 * Season-to-date leaders. Athlete + team references come back as `$ref` links;
 * team ids are parsed straight out of the URL (no extra request) and athlete
 * bios are resolved separately and cached across captures.
 */
export async function fetchLeaders(year, { seasonType = 2, topN = 10 } = {}) {
  const raw = await getJson(ENDPOINTS.leaders(year, seasonType), { allow404: true });
  if (!raw?.categories?.length) return null;

  const wanted = new Map(LEADER_CATEGORIES.map((c) => [c.key, c]));
  const categories = [];
  const byCategory = {};
  const athleteIds = new Set();

  for (const cat of raw.categories) {
    if (!wanted.has(cat.name)) continue;
    const rows = (cat.leaders ?? [])
      .slice(0, topN)
      .map((l) => {
        const athleteId = l.athlete?.$ref?.match(ATHLETE_ID_RE)?.[1];
        const teamId = l.team?.$ref?.match(TEAM_ID_RE)?.[1];
        if (!athleteId) return null;
        athleteIds.add(athleteId);
        return { id: athleteId, teamId: teamId ?? null, v: Number(l.value) };
      })
      .filter(Boolean);
    if (!rows.length) continue;
    categories.push({
      key: cat.name,
      name: cat.displayName,
      abbr: cat.abbreviation,
      group: wanted.get(cat.name).group,
      cumulative: wanted.get(cat.name).cumulative !== false,
    });
    byCategory[cat.name] = rows;
  }

  const order = new Map(LEADER_CATEGORIES.map((c, i) => [c.key, i]));
  categories.sort((a, b) => order.get(a.key) - order.get(b.key));
  return { categories, byCategory, athleteIds: [...athleteIds] };
}

/** Resolve athlete bios (name, position, headshot) for the given ids. */
export async function fetchAthletes(year, ids, existing = {}) {
  const missing = ids.filter((id) => !existing[id]?.name);
  const resolved = { ...existing };
  await mapPool(missing, 8, async (id) => {
    const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${year}/athletes/${id}?lang=en&region=us`;
    const a = await getJson(url, { allow404: true, retries: 2 });
    if (!a) return;
    resolved[id] = {
      name: a.displayName ?? a.fullName ?? `Athlete ${id}`,
      short: a.shortName ?? a.displayName ?? `Athlete ${id}`,
      pos: a.position?.abbreviation ?? null,
      jersey: a.jersey ?? null,
      headshot: a.headshot?.href ?? `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`,
    };
  });
  return resolved;
}

/**
 * Real per-game statistics for an athlete, keyed by regular-season week.
 * Used to reconstruct true week-by-week cumulative totals for past seasons.
 */
export async function fetchGameLog(athleteId, year) {
  const raw = await getJson(ENDPOINTS.gameLog(athleteId, year), { allow404: true, retries: 2 });
  if (!raw?.seasonTypes?.length) return null;
  const names = raw.names ?? [];
  const regular = raw.seasonTypes.find((s) => /regular season/i.test(s.displayName ?? ''));
  if (!regular) return null;
  const games = [];
  for (const cat of regular.categories ?? []) {
    for (const ev of cat.events ?? []) {
      const meta = raw.events?.[ev.eventId];
      if (!meta) continue;
      const stats = {};
      names.forEach((n, i) => {
        const v = Number(ev.stats?.[i]);
        // Duplicate labels exist (e.g. rushing YDS follows passing YDS); keep the first.
        if (!(n in stats) && Number.isFinite(v)) stats[n] = v;
      });
      games.push({ week: Number(meta.week), date: meta.gameDate, stats });
    }
  }
  games.sort((a, b) => a.week - b.week);
  return { names, games };
}
