/**
 * JSON snapshot store.
 *
 * Data lives as plain JSON under public/data so the built site is fully static:
 *   public/data/index.json            catalogue of seasons
 *   public/data/teams.json            team metadata + colors
 *   public/data/seasons/<year>.json   per-season snapshot series
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeSeasonYear } from './season.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const DATA_DIR = path.join(ROOT, 'public', 'data');
export const SEASONS_DIR = path.join(DATA_DIR, 'seasons');

async function ensureDirs() {
  await mkdir(SEASONS_DIR, { recursive: true });
}

export async function readJson(file, fallback = null) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeJson(file, value) {
  await ensureDirs();
  await writeFile(file, `${JSON.stringify(value)}\n`, 'utf8');
}

export const seasonFile = (year) => path.join(SEASONS_DIR, `${year}.json`);

export function emptySeason(year) {
  return {
    season: year,
    label: String(year),
    mocked: false,
    notes: null,
    updatedAt: null,
    seasonStart: null,
    phase: 'offseason',
    started: false,
    currentWeek: null,
    projections: { snapshots: [] },
    leaders: { categories: [], athletes: {}, snapshots: [] },
  };
}

export async function readSeason(year) {
  return (await readJson(seasonFile(year))) ?? emptySeason(year);
}

export async function writeSeason(year, data) {
  await writeJson(seasonFile(year), data);
}

/** Insert or replace a snapshot by id, keeping the series ordered by date. */
export function upsertSnapshot(snapshots, snapshot) {
  const next = snapshots.filter((s) => s.id !== snapshot.id);
  next.push(snapshot);
  next.sort((a, b) => {
    const byOrder = (a.order ?? 0) - (b.order ?? 0);
    if (byOrder !== 0) return byOrder;
    return new Date(a.date) - new Date(b.date);
  });
  return next;
}

/** Rebuild index.json from whatever season files exist on disk. */
export async function rebuildIndex() {
  await ensureDirs();
  const files = (await readdir(SEASONS_DIR)).filter((f) => /^\d{4}\.json$/.test(f));
  const seasons = [];
  for (const file of files) {
    const s = await readJson(path.join(SEASONS_DIR, file));
    if (!s) continue;
    seasons.push({
      year: s.season,
      label: s.label ?? String(s.season),
      mocked: Boolean(s.mocked),
      notes: s.notes ?? null,
      phase: s.phase,
      started: Boolean(s.started),
      currentWeek: s.currentWeek ?? null,
      updatedAt: s.updatedAt ?? null,
      projectionSnapshots: s.projections?.snapshots?.length ?? 0,
      leaderSnapshots: s.leaders?.snapshots?.length ?? 0,
    });
  }
  seasons.sort((a, b) => b.year - a.year);
  // The current season is whichever league year the calendar is in, falling
  // back to the newest season we have data for.
  const activeYear = activeSeasonYear();
  const current = seasons.find((s) => s.year === activeYear) ?? seasons[0] ?? null;
  const index = {
    generatedAt: new Date().toISOString(),
    currentSeason: current?.year ?? null,
    seasons,
  };
  await writeJson(path.join(DATA_DIR, 'index.json'), index);
  return index;
}
