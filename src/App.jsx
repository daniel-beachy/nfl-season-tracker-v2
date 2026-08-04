import { useCallback, useEffect, useMemo, useState } from 'react';
import Header from './components/Header.jsx';
import Banner from './components/Banner.jsx';
import ProjectionsTab from './components/ProjectionsTab.jsx';
import LeadersTab from './components/LeadersTab.jsx';
import { useTheme } from './hooks/useTheme.js';
import { loadIndex, loadSeason, loadTeams } from './lib/data.js';

const PHASE_LABEL = {
  preseason: 'Preseason',
  regular: 'Regular season',
  postseason: 'Postseason',
  complete: 'Final',
  offseason: 'Offseason',
};

const formatDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [index, setIndex] = useState(null);
  const [teams, setTeams] = useState(null);
  const [seasonYear, setSeasonYear] = useState(null);
  const [seasonData, setSeasonData] = useState(null);
  const [tab, setTab] = useState('projections');
  const [error, setError] = useState(null);
  const [loadingSeason, setLoadingSeason] = useState(true);

  // Bootstrap: index + team metadata, then default to the current season.
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadIndex(), loadTeams()])
      .then(([idx, teamFile]) => {
        if (cancelled) return;
        setIndex(idx);
        setTeams(Object.fromEntries((teamFile.teams ?? []).map((t) => [t.abbr, t])));
        const fromUrl = Number(new URLSearchParams(window.location.search).get('season'));
        const known = new Set((idx.seasons ?? []).map((s) => s.year));
        setSeasonYear(known.has(fromUrl) ? fromUrl : idx.currentSeason ?? idx.seasons?.[0]?.year ?? null);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!seasonYear) return undefined;
    let cancelled = false;
    setLoadingSeason(true);
    loadSeason(seasonYear)
      .then((data) => {
        if (cancelled) return;
        setSeasonData(data);
        setLoadingSeason(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message);
        setLoadingSeason(false);
      });
    return () => {
      cancelled = true;
    };
  }, [seasonYear]);

  const changeSeason = useCallback((year) => {
    setSeasonYear(year);
    const url = new URL(window.location.href);
    url.searchParams.set('season', String(year));
    window.history.replaceState({}, '', url);
  }, []);

  const subtitle = useMemo(() => {
    if (!seasonData) return 'Playoff odds & statistical leaders';
    const phase = PHASE_LABEL[seasonData.phase] ?? seasonData.phase;
    const week =
      seasonData.phase === 'regular' && seasonData.completedWeek > 0 ? ` \u00b7 through week ${seasonData.completedWeek}` : '';
    return `${seasonData.label} \u00b7 ${phase}${week}`;
  }, [seasonData]);

  if (error) {
    return (
      <div className="center-state">
        <div>
          <div className="empty__title">Could not load the dashboard data</div>
          <p className="empty__desc">{error}</p>
        </div>
      </div>
    );
  }

  if (!index || !teams || !seasonData) {
    return (
      <div className="center-state">
        <span className="spinner" aria-hidden="true" />
        <span className="empty__desc">Loading season data…</span>
      </div>
    );
  }

  const seasonMeta = index.seasons?.find((s) => s.year === seasonYear) ?? {};
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  // The projections are the only mocked part of a reconstructed season, so the
  // stat-leaders tab gets a different, accurate headline.
  const mockedProjectionsOnly = seasonData.mockedScope === 'projections';

  return (
    <div className="app">
      <Header
        seasons={index.seasons ?? []}
        season={seasonYear}
        onSeasonChange={changeSeason}
        tab={tab}
        onTabChange={setTab}
        theme={theme}
        onToggleTheme={toggleTheme}
        subtitle={subtitle}
      />

      <main className="container" style={{ flex: 1, paddingBottom: 40, opacity: loadingSeason ? 0.55 : 1 }}>
        {!seasonData.started && (
          <Banner>
            <strong>Preseason — the {seasonData.label} season has not started.</strong> Kickoff is{' '}
            {formatDate(seasonData.seasonStart)}. Until then only monthly snapshots of ESPN&apos;s preseason
            projections exist, and player statistics are unavailable.
          </Banner>
        )}

        {seasonData.mocked && (
          <Banner tone={tab === 'leaders' && mockedProjectionsOnly ? 'info' : 'warn'}>
            {tab === 'leaders' && mockedProjectionsOnly ? (
              <>
                <strong>These stat leaders are real.</strong> They were rebuilt from ESPN&apos;s per-game logs for
                every {seasonData.label} leader. Only the Projections tab is mocked for this season.
              </>
            ) : (
              <>
                <strong>Mocked — not fully accurate.</strong> {seasonData.notes}
              </>
            )}
          </Banner>
        )}

        <div role="tabpanel">
          {tab === 'projections' ? (
            <ProjectionsTab
              seasonData={seasonData}
              teams={teams}
              theme={theme}
              showSparseNotice={seasonData.started}
            />
          ) : (
            <LeadersTab seasonData={seasonData} teams={teams} theme={theme} />
          )}
        </div>
      </main>

      <footer className="footer">
        <div className="container">
          <span>
            Data from ESPN&apos;s public endpoints, captured as static snapshots
            {seasonMeta.updatedAt ? ` \u00b7 last updated ${formatDate(seasonMeta.updatedAt)}` : ''}
            {seasonMeta.projectionSnapshots ? ` \u00b7 ${plural(seasonMeta.projectionSnapshots, 'projection snapshot')}` : ''}
            {seasonMeta.leaderSnapshots ? ` \u00b7 ${plural(seasonMeta.leaderSnapshots, 'leader snapshot')}` : ''}
          </span>
          <span>
            {'Not affiliated with the NFL or ESPN \u00b7 '}
            <a href="https://github.com/daniel-beachy/nfl-season-tracker-2026" target="_blank" rel="noreferrer">
              Source
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
