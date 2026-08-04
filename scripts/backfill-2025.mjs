#!/usr/bin/env node
/**
 * One-time backfill for the 2025 season.
 *
 * ESPN exposes current values but no historical series, so a completed season
 * has to be reconstructed. Two very different techniques are used, and the
 * distinction matters:
 *
 *   Stat leaders  REAL. Each athlete's actual per-game log is summed to produce
 *                 true cumulative week-by-week totals.
 *
 *   Projections   MOCKED. There is no archive of weekly FPI playoff odds, so a
 *                 Monte Carlo re-simulates the season at each weekly checkpoint
 *                 using the real schedule, the real results to date and real
 *                 FPI team ratings. The curves are plausible and converge on
 *                 what actually happened, but they are not ESPN's published
 *                 historical numbers. The UI labels the season accordingly.
 *
 *   node scripts/backfill-2025.mjs [--season 2025] [--sims 4000]
 */

import { fetchTeams, fetchProjections, fetchLeaders, fetchAthletes, fetchGameLog, getJson, mapPool } from './lib/espn.mjs';
import path from 'node:path';
import { simulateSeason, shrinkRatings, recordThrough, mulberry32 } from './lib/simulate.mjs';
import { cumulativeByWeek, LEADER_RESOLVERS } from './lib/leaders.mjs';
import { REGULAR_WEEKS, PLAYOFF_LABELS, weekLabel, monthlyOrder, weeklyOrder } from './lib/season.mjs';
import { readSeason, writeSeason, emptySeason, rebuildIndex, writeJson, DATA_DIR } from './lib/store.mjs';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const YEAR = Number(argValue('season', 2025));
const SIMS = Number(argValue('sims', 4000));
const TOP_N = 10;
const CANDIDATE_POOL = 25; // consider more than we display so mid-season leaders are captured

const log = (...m) => console.log('[backfill]', ...m);

/* -------------------------------------------------------------------------- */
/* Schedule + results                                                         */
/* -------------------------------------------------------------------------- */

const scoreboard = (year, seasonType, week) =>
  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${year}&seasontype=${seasonType}&week=${week}`;

async function fetchSchedule(year) {
  const weeks = Array.from({ length: REGULAR_WEEKS }, (_, i) => i + 1);
  const pages = await mapPool(weeks, 6, (w) => getJson(scoreboard(year, 2, w), { allow404: true }));
  const games = [];
  pages.forEach((page, i) => {
    for (const ev of page?.events ?? []) {
      const comp = ev.competitions?.[0];
      if (!comp?.status?.type?.completed) continue;
      const home = comp.competitors.find((c) => c.homeAway === 'home');
      const away = comp.competitors.find((c) => c.homeAway === 'away');
      if (!home || !away) continue;
      games.push({
        week: i + 1,
        date: ev.date,
        home: home.team.abbreviation,
        away: away.team.abbreviation,
        homeScore: Number(home.score),
        awayScore: Number(away.score),
      });
    }
  });
  return games;
}

/** Playoff rounds in order, skipping the Pro Bowl week. */
async function fetchPostseason(year) {
  const rounds = [];
  for (const week of [1, 2, 3, 5]) {
    const page = await getJson(scoreboard(year, 3, week), { allow404: true });
    const games = [];
    for (const ev of page?.events ?? []) {
      const comp = ev.competitions?.[0];
      if (!comp?.status?.type?.completed) continue;
      const home = comp.competitors.find((c) => c.homeAway === 'home');
      const away = comp.competitors.find((c) => c.homeAway === 'away');
      if (!home || !away) continue;
      const winner = Number(home.score) > Number(away.score) ? home.team.abbreviation : away.team.abbreviation;
      const loser = winner === home.team.abbreviation ? away.team.abbreviation : home.team.abbreviation;
      games.push({ home: home.team.abbreviation, away: away.team.abbreviation, winner, loser });
    }
    if (games.length) rounds.push(games);
  }
  return rounds;
}

/* -------------------------------------------------------------------------- */
/* Playoff bracket simulation from a known field                              */
/* -------------------------------------------------------------------------- */

function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
const gameProb = (rHigh, rLow, neutral) =>
  Math.min(0.985, Math.max(0.015, normalCdf((rHigh - rLow + (neutral ? 0 : 1.7)) / 13.2)));

/**
 * Simulate the remainder of a bracket given the teams still alive in each
 * conference (ordered best seed first). Re-seeds every round.
 */
function simulateBracket(alive, ratings, sims, seed) {
  const rand = mulberry32(seed);
  const confChamp = {};
  const madeSB = {};
  const wonSB = {};
  const all = [...alive.AFC, ...alive.NFC];
  for (const t of all) { confChamp[t] = 0; madeSB[t] = 0; wonSB[t] = 0; }

  for (let s = 0; s < sims; s++) {
    const winners = {};
    for (const conf of ['AFC', 'NFC']) {
      let field = [...alive[conf]];
      // A field already down to two teams has, by definition, reached the
      // conference championship game.
      if (field.length <= 2) for (const t of field) confChamp[t] += 1;
      while (field.length > 1) {
        const next = [];
        // When the field is not a power of two the top seeds receive byes.
        const pairs = Math.floor(field.length / 2);
        const byes = field.length - pairs * 2;
        for (let i = 0; i < byes; i++) next.push(field[i]);
        const rest = field.slice(byes);
        for (let i = 0; i < rest.length / 2; i++) {
          const high = rest[i];
          const low = rest[rest.length - 1 - i];
          next.push(rand() < gameProb(ratings[high] ?? 0, ratings[low] ?? 0) ? high : low);
        }
        next.sort((a, b) => alive[conf].indexOf(a) - alive[conf].indexOf(b));
        if (next.length === 2) for (const t of next) confChamp[t] += 1;
        field = next;
      }
      winners[conf] = field[0];
      madeSB[field[0]] += 1;
    }
    const a = winners.AFC;
    const n = winners.NFC;
    wonSB[rand() < gameProb(ratings[a] ?? 0, ratings[n] ?? 0, true) ? a : n] += 1;
  }

  const pct = (x) => Math.round((x / sims) * 1000) / 10;
  const out = {};
  for (const t of all) out[t] = { makeConfChamp: pct(confChamp[t]), makeSB: pct(madeSB[t]), winSB: pct(wonSB[t]) };
  return out;
}

/**
 * Reconstruct the real playoff field and seeding from the actual bracket.
 * Seeds are pinned by structure rather than guessed from records: the team on
 * bye is the 1 seed, wild-card hosts are seeds 2-4 and visitors are seeds 5-7.
 */
function derivePlayoffField(rounds, teamMeta, records) {
  const wildCard = rounds[0] ?? [];
  const divisional = rounds[1] ?? [];
  const inWildCard = new Set(wildCard.flatMap((g) => [g.home, g.away]));
  const inDivisional = new Set(divisional.flatMap((g) => [g.home, g.away]));
  const byes = new Set([...inDivisional].filter((t) => !inWildCard.has(t)));

  const pct = (t) => {
    const r = records[t] ?? { w: 0, l: 0, t: 0 };
    const g = r.w + r.l + r.t;
    return g ? (r.w + 0.5 * r.t) / g : 0;
  };
  const byRecord = (a, b) => pct(b) - pct(a);

  const byConf = { AFC: [], NFC: [] };
  for (const conf of ['AFC', 'NFC']) {
    const confOf = (t) => teamMeta[t]?.conf === conf;
    const bye = [...byes].filter(confOf).sort(byRecord);
    const hosts = wildCard.filter((g) => confOf(g.home)).map((g) => g.home).sort(byRecord);
    const visitors = wildCard.filter((g) => confOf(g.away)).map((g) => g.away).sort(byRecord);
    byConf[conf] = [...bye, ...hosts, ...visitors];
  }
  return byConf;
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  log(`rebuilding season ${YEAR} (${SIMS} sims per checkpoint)`);
  const teams = await fetchTeams();
  await writeJson(path.join(DATA_DIR, 'teams.json'), { updatedAt: new Date().toISOString(), teams });
  const teamByAbbr = new Map(teams.map((t) => [t.abbr, t]));
  const teamById = new Map(teams.map((t) => [t.id, t.abbr]));

  const projections = await fetchProjections(YEAR);
  const teamMeta = {};
  const ratings = {};
  for (const [abbr, t] of Object.entries(projections.teams)) {
    if (!teamByAbbr.has(abbr)) continue;
    teamMeta[abbr] = { conf: t.conf, div: t.div, id: t.id };
    ratings[abbr] = t.fpi ?? 0;
  }
  log(`team metadata + FPI ratings for ${Object.keys(teamMeta).length} teams`);

  const games = await fetchSchedule(YEAR);
  log(`regular-season games with final scores: ${games.length}`);
  if (games.length < 200) throw new Error(`schedule looks incomplete (${games.length} games)`);

  const postseason = await fetchPostseason(YEAR);
  log(`playoff rounds: ${postseason.map((r) => r.length).join(', ')}`);

  const season = { ...emptySeason(YEAR), ...(await readSeason(YEAR)) };
  season.label = `${YEAR}`;
  season.mocked = true;
  season.mockedScope = 'projections';
  season.notes =
    'Weekly projections are reconstructed by simulation (ESPN publishes no historical odds) — plausible, not ESPN\u2019s actual weekly numbers. Stat leaders are real, rebuilt from per-game logs.';
  season.seasonStart = games[0]?.date ?? null;
  season.phase = 'complete';
  season.started = true;
  season.completedWeek = REGULAR_WEEKS + PLAYOFF_LABELS.length;
  season.teamMeta = teamMeta;
  season.updatedAt = new Date().toISOString();

  /* ---------------------------- Projections ------------------------------ */

  const snapshots = [];
  const dateForWeek = (w) => {
    const first = new Date(games[0].date);
    // Snapshots land on the Wednesday after the week's games conclude.
    return new Date(first.getTime() + (w * 7 - 2) * 24 * 3600 * 1000).toISOString();
  };

  // Offseason / preseason monthly checkpoints before week 1.
  const preseasonMonths = [
    { month: 6, label: `Jul '${String(YEAR).slice(2)}`, damp: 0.55 },
    { month: 7, label: `Aug '${String(YEAR).slice(2)}`, damp: 0.75 },
  ];
  for (const [i, m] of preseasonMonths.entries()) {
    const result = simulateSeason({
      teams: teamMeta,
      games,
      ratings: shrinkRatings(ratings, 0, m.damp),
      completedWeek: 0,
      sims: SIMS,
      seed: 1000 + i,
    });
    snapshots.push(buildProjSnapshot({
      id: `${YEAR}-m${YEAR}${String(m.month + 1).padStart(2, '0')}`,
      date: new Date(Date.UTC(YEAR, m.month, 15)).toISOString(),
      label: m.label,
      cadence: 'monthly',
      phase: i === 0 ? 'offseason' : 'preseason',
      completedWeek: 0,
      order: monthlyOrder(new Date(Date.UTC(YEAR, m.month, 15))),
      result,
      records: recordThrough(teamMeta, games, 0),
    }));
  }

  // Weekly checkpoints through the regular season.
  for (let w = 1; w <= REGULAR_WEEKS; w++) {
    const result = simulateSeason({
      teams: teamMeta,
      games,
      ratings: shrinkRatings(ratings, w),
      completedWeek: w,
      sims: SIMS,
      seed: 2000 + w,
    });
    snapshots.push(buildProjSnapshot({
      id: `${YEAR}-w${String(w).padStart(2, '0')}`,
      date: dateForWeek(w),
      label: weekLabel(w),
      cadence: 'weekly',
      phase: 'regular',
      completedWeek: w,
      order: weeklyOrder(w),
      result,
      records: recordThrough(teamMeta, games, w),
    }));
    process.stdout.write(`  wk${w}`);
  }
  process.stdout.write('\n');

  // Playoff checkpoints: the field is settled, so only the bracket is simulated.
  const finalRecords = recordThrough(teamMeta, games, REGULAR_WEEKS);
  const field = derivePlayoffField(postseason, teamMeta, finalRecords);
  const divisionWinners = new Set();
  for (const conf of ['AFC', 'NFC']) field[conf].slice(0, 4).forEach((t) => divisionWinners.add(t));
  const playoffTeams = new Set([...field.AFC, ...field.NFC]);
  log(`playoff field: AFC ${field.AFC.join(',')} | NFC ${field.NFC.join(',')}`);

  // Walk the real bracket forward, recording who is still alive after each round.
  const aliveByRound = [{ AFC: [...field.AFC], NFC: [...field.NFC] }];
  for (const played of postseason) {
    const participants = new Set(played.flatMap((g) => [g.home, g.away]));
    const winners = new Set(played.map((g) => g.winner));
    // A team advances by winning, or by not playing at all (first-round bye).
    const survives = (t) => winners.has(t) || !participants.has(t);
    const prev = aliveByRound[aliveByRound.length - 1];
    aliveByRound.push({ AFC: prev.AFC.filter(survives), NFC: prev.NFC.filter(survives) });
  }

  // Milestones that become facts rather than probabilities once reached.
  const CC_ROUND = 2; // conference championship participants are known after the divisional round
  const SB_ROUND = 3; // Super Bowl participants are known after the conference championships
  const FINAL_ROUND = 4;
  const setAt = (r) => new Set([...(aliveByRound[r]?.AFC ?? []), ...(aliveByRound[r]?.NFC ?? [])]);
  const reachedConfChamp = setAt(CC_ROUND);
  const reachedSB = setAt(SB_ROUND);
  const champion = [...setAt(FINAL_ROUND)][0] ?? null;
  log(`Super Bowl: ${[...reachedSB].join(' vs ')} \u2014 champion ${champion}`);

  for (let round = 0; round < aliveByRound.length; round++) {
    const alive = aliveByRound[round];
    const aliveSet = new Set([...alive.AFC, ...alive.NFC]);
    const completedWeek = REGULAR_WEEKS + round;
    // Once one conference is empty the bracket is over; nothing left to simulate.
    const bracket =
      alive.AFC.length && alive.NFC.length ? simulateBracket(alive, ratings, SIMS, 3000 + round) : {};

    const teamsOut = {};
    for (const abbr of Object.keys(teamMeta)) {
      const rec = finalRecords[abbr];
      const b = bracket[abbr];
      const live = aliveSet.has(abbr);
      teamsOut[abbr] = {
        winSB: round >= FINAL_ROUND ? (abbr === champion ? 100 : 0) : live ? b?.winSB ?? 0 : 0,
        makeSB: round >= SB_ROUND && reachedSB.has(abbr) ? 100 : live ? b?.makeSB ?? 0 : 0,
        makeConfChamp:
          round >= CC_ROUND && reachedConfChamp.has(abbr) ? 100 : live ? b?.makeConfChamp ?? 0 : 0,
        winDiv: divisionWinners.has(abbr) ? 100 : 0,
        makePlayoffs: playoffTeams.has(abbr) ? 100 : 0,
        projWins: rec.w + 0.5 * rec.t,
        w: rec.w, l: rec.l, t: rec.t,
      };
    }

    // Round 0 is the post-week-18 checkpoint; later rounds follow each playoff week.
    snapshots.push({
      id: `${YEAR}-w${String(completedWeek).padStart(2, '0')}`,
      date: dateForWeek(REGULAR_WEEKS + round + 1),
      label: round === 0 ? weekLabel(REGULAR_WEEKS) : PLAYOFF_LABELS[round - 1],
      cadence: 'weekly',
      phase: round === 0 ? 'regular' : 'postseason',
      completedWeek,
      order: weeklyOrder(completedWeek),
      source: 'reconstructed-monte-carlo',
      teams: teamsOut,
    });
  }

  // The post-week-18 checkpoint duplicates week 18's id; keep the bracket version.
  const deduped = new Map();
  for (const s of snapshots) deduped.set(s.id, s);
  season.projections.snapshots = [...deduped.values()].sort((a, b) => a.order - b.order);
  log(`projection snapshots: ${season.projections.snapshots.length}`);

  /* ------------------------------ Leaders -------------------------------- */

  const leaders = await fetchLeaders(YEAR, { topN: CANDIDATE_POOL });
  if (!leaders) throw new Error(`no leaders available for ${YEAR}`);

  const athleteIds = leaders.athleteIds;
  log(`resolving ${athleteIds.length} athlete game logs...`);
  const logs = new Map();
  let done = 0;
  await mapPool(athleteIds, 10, async (id) => {
    const gl = await fetchGameLog(id, YEAR);
    if (gl?.games?.length) logs.set(id, gl);
    if (++done % 50 === 0) process.stdout.write(`  ${done}/${athleteIds.length}`);
  });
  process.stdout.write('\n');
  log(`game logs retrieved for ${logs.size}/${athleteIds.length} athletes`);

  season.leaders.athletes = await fetchAthletes(YEAR, athleteIds, season.leaders.athletes ?? {});

  const teamOfAthlete = new Map();
  for (const rows of Object.values(leaders.byCategory)) {
    for (const r of rows) if (r.teamId) teamOfAthlete.set(r.id, teamById.get(r.teamId) ?? null);
  }

  // Only keep categories whose weekly history can actually be rebuilt.
  const usableCategories = leaders.categories.filter((cat) => {
    if (LEADER_RESOLVERS[cat.key]) return true;
    for (const id of leaders.byCategory[cat.key].map((r) => r.id)) {
      const gl = logs.get(id);
      if (gl?.names?.includes(cat.key)) return true;
    }
    return false;
  });
  const skipped = leaders.categories.filter((c) => !usableCategories.includes(c)).map((c) => c.key);
  if (skipped.length) log(`categories without per-game data (omitted for ${YEAR}): ${skipped.join(', ')}`);
  season.leaders.categories = usableCategories;

  const leaderSnapshots = [];
  const seriesByCategory = new Map();
  for (const cat of usableCategories) {
    const perAthlete = new Map();
    for (const row of leaders.byCategory[cat.key]) {
      const gl = logs.get(row.id);
      const series = cumulativeByWeek(cat.key, gl, REGULAR_WEEKS);
      if (series.size) {
        perAthlete.set(row.id, series);
      } else {
        // No game log: ramp linearly to the real season total so the athlete
        // still appears, rather than dropping a genuine leader from the chart.
        const ramp = new Map();
        for (let w = 1; w <= REGULAR_WEEKS; w++) ramp.set(w, Math.round((row.v * (w / REGULAR_WEEKS)) * 100) / 100);
        perAthlete.set(row.id, ramp);
      }
    }
    seriesByCategory.set(cat.key, perAthlete);
  }

  for (let w = 1; w <= REGULAR_WEEKS; w++) {
    const byCategory = {};
    for (const cat of usableCategories) {
      const rows = [];
      for (const [id, series] of seriesByCategory.get(cat.key)) {
        const v = series.get(w);
        if (v === undefined || v === 0) continue;
        rows.push({ id, team: teamOfAthlete.get(id) ?? null, v });
      }
      rows.sort((a, b) => b.v - a.v);
      byCategory[cat.key] = rows.slice(0, TOP_N);
    }
    leaderSnapshots.push({
      id: `${YEAR}-w${String(w).padStart(2, '0')}`,
      date: dateForWeek(w),
      label: weekLabel(w),
      cadence: 'weekly',
      phase: 'regular',
      completedWeek: w,
      order: weeklyOrder(w),
      source: 'espn-gamelogs',
      byCategory,
    });
  }
  season.leaders.snapshots = leaderSnapshots;
  log(`leader snapshots: ${leaderSnapshots.length} across ${usableCategories.length} categories`);

  // Trim athlete bios to those actually referenced.
  const referenced = new Set();
  for (const snap of leaderSnapshots) for (const rows of Object.values(snap.byCategory)) for (const r of rows) referenced.add(r.id);
  season.leaders.athletes = Object.fromEntries(
    Object.entries(season.leaders.athletes).filter(([id]) => referenced.has(id))
  );
  for (const id of referenced) {
    if (season.leaders.athletes[id] && !season.leaders.athletes[id].team) {
      season.leaders.athletes[id].team = teamOfAthlete.get(id) ?? null;
    }
  }

  await writeSeason(YEAR, season);
  const index = await rebuildIndex();
  log(`done — seasons on disk: ${index.seasons.map((s) => s.year).join(', ')}`);
}

function buildProjSnapshot({ id, date, label, cadence, phase, completedWeek, order, result, records }) {
  const teams = {};
  for (const [abbr, r] of Object.entries(result)) {
    const rec = records[abbr] ?? { w: 0, l: 0, t: 0 };
    teams[abbr] = { ...r, w: rec.w, l: rec.l, t: rec.t };
  }
  return { id, date, label, cadence, phase, completedWeek, order, source: 'reconstructed-monte-carlo', teams };
}

main().catch((err) => {
  console.error('[backfill] FAILED:', err);
  process.exit(1);
});
