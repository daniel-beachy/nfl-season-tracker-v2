#!/usr/bin/env node
/**
 * Periodic capture entry point.
 *
 * Appends one snapshot of projections + stat leaders for the active season.
 * Cadence is decided from the calendar: weekly during the regular season and
 * playoffs, monthly otherwise. Re-running inside the same period replaces that
 * period's snapshot rather than appending a duplicate, so the workflow is safe
 * to retry or trigger manually.
 *
 *   node scripts/capture.mjs                 capture the active season
 *   node scripts/capture.mjs --season 2026   capture a specific season
 *   node scripts/capture.mjs --teams-only    refresh team metadata only
 */

import path from 'node:path';
import { fetchTeams, fetchProjections, fetchLeaders, fetchAthletes } from './lib/espn.mjs';
import { activeSeasonYear, describeSeason, periodKey, periodLabel, sortOrder, PHASES } from './lib/season.mjs';
import { DATA_DIR, readJson, writeJson, readSeason, writeSeason, upsertSnapshot, rebuildIndex } from './lib/store.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const log = (...m) => console.log('[capture]', ...m);

async function captureTeams() {
  const teams = await fetchTeams();
  if (teams.length < 32) throw new Error(`expected 32 teams, received ${teams.length}`);
  await writeJson(path.join(DATA_DIR, 'teams.json'), { updatedAt: new Date().toISOString(), teams });
  log(`teams.json updated (${teams.length} teams)`);
  return teams;
}

async function main() {
  const now = new Date();
  const teams = await captureTeams();
  if (flag('teams-only')) {
    await rebuildIndex();
    return;
  }

  const year = Number(value('season', activeSeasonYear(now)));
  log(`capturing season ${year} at ${now.toISOString()}`);

  const projections = await fetchProjections(year);
  const info = describeSeason(year, now, projections.season);
  const id = periodKey(year, info, now);
  const label = periodLabel(info, now);
  log(`phase=${info.phase} cadence=${info.cadence} week=${info.week ?? '-'} id=${id}`);

  const season = await readSeason(year);
  season.label = String(year);
  season.seasonStart = info.start;
  season.phase = info.phase;
  season.started = info.started;
  season.currentWeek = info.week;
  season.completedWeek = info.completedWeek;
  season.updatedAt = now.toISOString();
  season.sourceUpdatedAt = projections.lastUpdated ?? null;

  const order = sortOrder(info, now);

  const projTeams = {};
  for (const [abbr, t] of Object.entries(projections.teams)) {
    projTeams[abbr] = {
      winSB: t.winSB, makeSB: t.makeSB, winDiv: t.winDiv, makePlayoffs: t.makePlayoffs,
      projWins: t.projWins, makeConfChamp: t.makeConfChamp, fpi: t.fpi,
      w: t.w, l: t.l, t: t.t,
    };
  }
  const teamMeta = {};
  for (const [abbr, t] of Object.entries(projections.teams)) {
    teamMeta[abbr] = { conf: t.conf, div: t.div, id: t.id };
  }
  season.teamMeta = { ...(season.teamMeta ?? {}), ...teamMeta };

  season.projections.snapshots = upsertSnapshot(season.projections.snapshots, {
    id, date: now.toISOString(), label, cadence: info.cadence, phase: info.phase,
    week: info.week ?? null, completedWeek: info.completedWeek, order, source: 'espn-fpi', teams: projTeams,
  });
  log(`projections snapshot stored (${Object.keys(projTeams).length} teams)`);

  // Leaders only exist once a season has produced games.
  const leaders = info.completedWeek <= 0
    ? null
    : await fetchLeaders(year, { topN: 10 });

  if (leaders) {
    season.leaders.categories = leaders.categories;
    season.leaders.athletes = await fetchAthletes(year, leaders.athleteIds, season.leaders.athletes ?? {});
    const teamById = new Map(teams.map((t) => [t.id, t.abbr]));
    const byCategory = {};
    for (const [key, rows] of Object.entries(leaders.byCategory)) {
      byCategory[key] = rows.map((r) => ({ id: r.id, team: teamById.get(r.teamId) ?? null, v: r.v }));
    }
    season.leaders.snapshots = upsertSnapshot(season.leaders.snapshots, {
      id, date: now.toISOString(), label, cadence: info.cadence, phase: info.phase,
      week: info.week ?? null, completedWeek: info.completedWeek, order, source: 'espn-leaders', byCategory,
    });
    log(`leaders snapshot stored (${leaders.categories.length} categories)`);
  } else {
    log('leaders unavailable for this season/phase — skipping');
  }

  await writeSeason(year, season);
  const index = await rebuildIndex();
  log(`index rebuilt: ${index.seasons.map((s) => s.year).join(', ')} (current ${index.currentSeason})`);
}

main().catch((err) => {
  console.error('[capture] FAILED:', err);
  process.exit(1);
});
