#!/usr/bin/env node
/**
 * Sanity-checks the committed JSON data.
 *
 * The projection probabilities have hard structural invariants — 32 teams'
 * Super Bowl odds must sum to 100, each division's win-division odds must sum
 * to 100, and so on. Verifying them catches both upstream API drift and bugs
 * in the reconstruction before anything is published.
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, SEASONS_DIR, readJson } from './lib/store.mjs';

let failures = 0;
let warnings = 0;
const fail = (m) => { console.error(`  FAIL  ${m}`); failures++; };
const warn = (m) => { console.warn(`  warn  ${m}`); warnings++; };
const ok = (m) => console.log(`  ok    ${m}`);

const sum = (xs) => xs.reduce((a, b) => a + (b ?? 0), 0);
const near = (value, target, tol) => Math.abs(value - target) <= tol;

async function main() {
  const index = await readJson(path.join(DATA_DIR, 'index.json'));
  const teamsDoc = await readJson(path.join(DATA_DIR, 'teams.json'));

  console.log('index.json');
  if (!index?.seasons?.length) fail('no seasons in index');
  else ok(`${index.seasons.length} season(s); current = ${index.currentSeason}`);

  console.log('teams.json');
  if (!teamsDoc?.teams?.length) fail('no teams');
  else {
    if (teamsDoc.teams.length !== 32) fail(`expected 32 teams, found ${teamsDoc.teams.length}`);
    const noColor = teamsDoc.teams.filter((t) => !t.color);
    if (noColor.length) fail(`teams missing colors: ${noColor.map((t) => t.abbr).join(',')}`);
    else ok('32 teams with colors');
  }

  const files = (await readdir(SEASONS_DIR)).filter((f) => /^\d{4}\.json$/.test(f));
  for (const file of files) {
    const s = await readJson(path.join(SEASONS_DIR, file));
    console.log(`seasons/${file}  (mocked=${s.mocked}, phase=${s.phase})`);

    const snaps = s.projections?.snapshots ?? [];
    if (!snaps.length) { warn('no projection snapshots'); continue; }
    ok(`${snaps.length} projection snapshots: ${snaps.map((x) => x.label).join(' \u2192 ')}`);

    const ids = new Set();
    for (const snap of snaps) {
      if (ids.has(snap.id)) fail(`duplicate snapshot id ${snap.id}`);
      ids.add(snap.id);
      const teams = Object.values(snap.teams ?? {});
      if (teams.length !== 32) { fail(`${snap.label}: ${teams.length} teams`); continue; }

      const winSB = sum(teams.map((t) => t.winSB));
      const makeSB = sum(teams.map((t) => t.makeSB));
      const playoffs = sum(teams.map((t) => t.makePlayoffs));
      if (!near(winSB, 100, 1.5)) fail(`${snap.label}: winSB sums to ${winSB.toFixed(1)} (expect 100)`);
      if (!near(makeSB, 200, 2.5)) fail(`${snap.label}: makeSB sums to ${makeSB.toFixed(1)} (expect 200)`);
      if (!near(playoffs, 1400, 12)) fail(`${snap.label}: makePlayoffs sums to ${playoffs.toFixed(1)} (expect 1400)`);

      const byDiv = {};
      for (const [abbr, t] of Object.entries(snap.teams)) {
        const div = s.teamMeta?.[abbr]?.div ?? 'unknown';
        (byDiv[div] ??= []).push(t.winDiv);
      }
      for (const [div, values] of Object.entries(byDiv)) {
        if (values.length !== 4) fail(`${snap.label}: division ${div} has ${values.length} teams`);
        if (!near(sum(values), 100, 2)) fail(`${snap.label}: ${div} winDiv sums to ${sum(values).toFixed(1)}`);
      }
      const wins = teams.map((t) => t.projWins).filter((v) => v != null);
      if (wins.some((v) => v < 0 || v > 21)) fail(`${snap.label}: implausible projected wins`);
    }
    if (!failures) ok('probability invariants hold for every snapshot');

    const leaders = s.leaders ?? {};
    const lsnaps = leaders.snapshots ?? [];
    if (!lsnaps.length) warn('no leader snapshots');
    else {
      ok(`${lsnaps.length} leader snapshots \u00d7 ${leaders.categories?.length ?? 0} categories`);
      const athletes = leaders.athletes ?? {};
      let missingBio = 0;
      let nonMonotonic = 0;
      const cumulative = new Map();
      for (const snap of lsnaps) {
        for (const cat of leaders.categories ?? []) {
          const rows = snap.byCategory?.[cat.key] ?? [];
          if (!rows.length) { warn(`${snap.label}/${cat.key}: no rows`); continue; }
          for (const r of rows) {
            if (!athletes[r.id]?.name) missingBio++;
            if (cat.cumulative !== false) {
              const key = `${cat.key}:${r.id}`;
              const prev = cumulative.get(key);
              if (prev !== undefined && r.v < prev - 0.01) nonMonotonic++;
              cumulative.set(key, r.v);
            }
          }
          const values = rows.map((r) => r.v);
          const sorted = [...values].sort((a, b) => b - a);
          if (values.join() !== sorted.join()) fail(`${snap.label}/${cat.key}: rows not sorted descending`);
        }
      }
      if (missingBio) fail(`${missingBio} leader rows without athlete bios`);
      else ok('every leader row resolves to an athlete bio');
      if (nonMonotonic) fail(`${nonMonotonic} cumulative values decreased week over week`);
      else ok('cumulative leader values are monotonic');
    }
  }

  console.log(`\n${failures ? `FAILED (${failures} error(s), ${warnings} warning(s))` : `PASSED (${warnings} warning(s))`}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
