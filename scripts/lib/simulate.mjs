/**
 * Monte Carlo season simulator.
 *
 * Used only to reconstruct a *plausible* week-by-week projection history for a
 * season that has already been played — ESPN publishes current FPI projections
 * but no historical series. Real results drive the simulation: at each weekly
 * snapshot, games already played are treated as fact and only the remaining
 * schedule is simulated. The output therefore converges on what actually
 * happened while still producing realistic mid-season uncertainty.
 *
 * The reconstruction is explicitly labelled as mocked in the UI.
 */

/** Deterministic PRNG so a given backfill always produces the same series. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normal CDF via the Abramowitz-Stegun erf approximation. */
function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** NFL game margins are roughly normal with a 13.2-point standard deviation. */
const MARGIN_SD = 13.2;
const HOME_FIELD = 1.7;

function winProbability(ratingHome, ratingAway, neutral = false) {
  const margin = ratingHome - ratingAway + (neutral ? 0 : HOME_FIELD);
  return Math.min(0.985, Math.max(0.015, normalCdf(margin / MARGIN_SD)));
}

/**
 * Ratings are shrunk toward the league mean early in the season so that
 * preseason odds are appropriately uncertain and sharpen as games are played.
 */
export function shrinkRatings(ratings, completedWeek, override) {
  const weight = override ?? 0.42 + 0.58 * Math.min(1, completedWeek / 11);
  const out = {};
  for (const [abbr, r] of Object.entries(ratings)) out[abbr] = r * weight;
  return out;
}

const conferenceOf = (teams, abbr) => teams[abbr].conf;

/**
 * Approximate NFL tiebreakers: win percentage, then head-to-head, then
 * division record, then a stable per-simulation jitter. Full NFL tiebreaking
 * rules are far more involved, but the difference is immaterial at the
 * probability resolution this dashboard displays.
 */
function standingsSort(a, b) {
  if (b.pct !== a.pct) return b.pct - a.pct;
  if (b.divPct !== a.divPct) return b.divPct - a.divPct;
  if (b.confPct !== a.confPct) return b.confPct - a.confPct;
  return b.jitter - a.jitter;
}

/**
 * @param {object} opts
 * @param {Record<string,{conf:string,div:string}>} opts.teams
 * @param {Array<{week:number,home:string,away:string,homeScore:number,awayScore:number}>} opts.games
 * @param {Record<string,number>} opts.ratings  net-points strength per team
 * @param {number} opts.completedWeek           games in weeks <= this are treated as played
 * @param {number} opts.sims
 */
export function simulateSeason({ teams, games, ratings, completedWeek, sims = 4000, seed = 20250904 }) {
  const abbrs = Object.keys(teams);
  const index = new Map(abbrs.map((a, i) => [a, i]));
  const n = abbrs.length;
  const rating = abbrs.map((a) => ratings[a] ?? 0);

  const divisions = {};
  for (const a of abbrs) (divisions[teams[a].div] ??= []).push(a);
  const conferences = {};
  for (const a of abbrs) (conferences[teams[a].conf] ??= []).push(a);

  const played = games.filter((g) => g.week <= completedWeek);
  const remaining = games.filter((g) => g.week > completedWeek);

  // Fixed portion of the season: real results.
  const baseW = new Float64Array(n);
  const baseL = new Float64Array(n);
  const baseT = new Float64Array(n);
  const baseDivW = new Float64Array(n);
  const baseDivG = new Float64Array(n);
  const baseConfW = new Float64Array(n);
  const baseConfG = new Float64Array(n);

  const applyResult = (W, L, T, DW, DG, CW, CG, home, away, homeScore, awayScore) => {
    const h = index.get(home);
    const a = index.get(away);
    if (h === undefined || a === undefined) return;
    const sameDiv = teams[home].div === teams[away].div;
    const sameConf = teams[home].conf === teams[away].conf;
    if (sameDiv) { DG[h] += 1; DG[a] += 1; }
    if (sameConf) { CG[h] += 1; CG[a] += 1; }
    if (homeScore > awayScore) {
      W[h] += 1; L[a] += 1;
      if (sameDiv) DW[h] += 1;
      if (sameConf) CW[h] += 1;
    } else if (awayScore > homeScore) {
      W[a] += 1; L[h] += 1;
      if (sameDiv) DW[a] += 1;
      if (sameConf) CW[a] += 1;
    } else {
      T[h] += 1; T[a] += 1;
      if (sameDiv) { DW[h] += 0.5; DW[a] += 0.5; }
      if (sameConf) { CW[h] += 0.5; CW[a] += 0.5; }
    }
  };

  for (const g of played) {
    applyResult(baseW, baseL, baseT, baseDivW, baseDivG, baseConfW, baseConfG, g.home, g.away, g.homeScore, g.awayScore);
  }

  // Pre-compute win probabilities for the games still to be played.
  const remHome = remaining.map((g) => index.get(g.home));
  const remAway = remaining.map((g) => index.get(g.away));
  const remProb = remaining.map((g) => winProbability(rating[index.get(g.home)], rating[index.get(g.away)]));
  const remSameDiv = remaining.map((g) => teams[g.home].div === teams[g.away].div);
  const remSameConf = remaining.map((g) => teams[g.home].conf === teams[g.away].conf);

  const totWins = new Float64Array(n);
  const cntDiv = new Float64Array(n);
  const cntPlayoffs = new Float64Array(n);
  const cntConfChamp = new Float64Array(n);
  const cntSB = new Float64Array(n);
  const cntTitle = new Float64Array(n);

  const rand = mulberry32(seed);
  const W = new Float64Array(n);
  const L = new Float64Array(n);
  const T = new Float64Array(n);
  const DW = new Float64Array(n);
  const DG = new Float64Array(n);
  const CW = new Float64Array(n);
  const CG = new Float64Array(n);
  const jitter = new Float64Array(n);

  const divNames = Object.keys(divisions);
  const confNames = Object.keys(conferences);

  for (let s = 0; s < sims; s++) {
    W.set(baseW); L.set(baseL); T.set(baseT);
    DW.set(baseDivW); DG.set(baseDivG); CW.set(baseConfW); CG.set(baseConfG);
    for (let i = 0; i < n; i++) jitter[i] = rand();

    for (let i = 0; i < remaining.length; i++) {
      const h = remHome[i];
      const a = remAway[i];
      const homeWins = rand() < remProb[i];
      if (remSameDiv[i]) { DG[h] += 1; DG[a] += 1; }
      if (remSameConf[i]) { CG[h] += 1; CG[a] += 1; }
      if (homeWins) {
        W[h] += 1; L[a] += 1;
        if (remSameDiv[i]) DW[h] += 1;
        if (remSameConf[i]) CW[h] += 1;
      } else {
        W[a] += 1; L[h] += 1;
        if (remSameDiv[i]) DW[a] += 1;
        if (remSameConf[i]) CW[a] += 1;
      }
    }

    for (let i = 0; i < n; i++) totWins[i] += W[i] + 0.5 * T[i];

    const rowOf = (abbr) => {
      const i = index.get(abbr);
      const g = W[i] + L[i] + T[i];
      return {
        abbr, i,
        pct: g ? (W[i] + 0.5 * T[i]) / g : 0,
        divPct: DG[i] ? DW[i] / DG[i] : 0,
        confPct: CG[i] ? CW[i] / CG[i] : 0,
        jitter: jitter[i],
      };
    };

    // Seed each conference: 4 division winners, then 3 wild cards.
    const seedsByConf = {};
    for (const conf of confNames) {
      const winners = [];
      for (const div of divNames) {
        if (teams[divisions[div][0]].conf !== conf) continue;
        const sorted = divisions[div].map(rowOf).sort(standingsSort);
        winners.push(sorted[0]);
        cntDiv[sorted[0].i] += 1;
      }
      winners.sort(standingsSort);
      const winnerSet = new Set(winners.map((w) => w.abbr));
      const wildcards = conferences[conf]
        .filter((a) => !winnerSet.has(a))
        .map(rowOf)
        .sort(standingsSort)
        .slice(0, 3);
      const seeds = [...winners, ...wildcards];
      seedsByConf[conf] = seeds;
      for (const t of seeds) cntPlayoffs[t.i] += 1;
    }

    // Bracket: 1 seed byes; 2v7, 3v6, 4v5; reseed each round.
    const champions = {};
    for (const conf of confNames) {
      const seeds = seedsByConf[conf];
      const playGame = (higher, lower) => {
        const p = winProbability(rating[higher.i], rating[lower.i]);
        return rand() < p ? higher : lower;
      };
      let alive = [seeds[0]];
      const wcWinners = [
        playGame(seeds[1], seeds[6]),
        playGame(seeds[2], seeds[5]),
        playGame(seeds[3], seeds[4]),
      ];
      const seedNo = new Map(seeds.map((t, i) => [t.abbr, i + 1]));
      wcWinners.sort((a, b) => seedNo.get(a.abbr) - seedNo.get(b.abbr));
      alive = [seeds[0], ...wcWinners];
      const divWinners = [playGame(alive[0], alive[3]), playGame(alive[1], alive[2])];
      divWinners.sort((a, b) => seedNo.get(a.abbr) - seedNo.get(b.abbr));
      for (const t of divWinners) cntConfChamp[t.i] += 1;
      const champ = playGame(divWinners[0], divWinners[1]);
      champions[conf] = champ;
      cntSB[champ.i] += 1;
    }

    const [c1, c2] = confNames.map((c) => champions[c]);
    const sbWinner = rand() < winProbability(rating[c1.i], rating[c2.i], true) ? c1 : c2;
    cntTitle[sbWinner.i] += 1;
  }

  const pct = (x) => Math.round((x / sims) * 1000) / 10;
  const out = {};
  abbrs.forEach((abbr, i) => {
    out[abbr] = {
      projWins: Math.round((totWins[i] / sims) * 10) / 10,
      winDiv: pct(cntDiv[i]),
      makePlayoffs: pct(cntPlayoffs[i]),
      makeConfChamp: pct(cntConfChamp[i]),
      makeSB: pct(cntSB[i]),
      winSB: pct(cntTitle[i]),
    };
  });
  return out;
}

/** Actual win/loss record for each team through a given week. */
export function recordThrough(teams, games, week) {
  const rec = {};
  for (const abbr of Object.keys(teams)) rec[abbr] = { w: 0, l: 0, t: 0 };
  for (const g of games) {
    if (g.week > week) continue;
    if (!rec[g.home] || !rec[g.away]) continue;
    if (g.homeScore > g.awayScore) { rec[g.home].w++; rec[g.away].l++; }
    else if (g.awayScore > g.homeScore) { rec[g.away].w++; rec[g.home].l++; }
    else { rec[g.home].t++; rec[g.away].t++; }
  }
  return rec;
}
