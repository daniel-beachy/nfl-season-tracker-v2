import { useMediaQuery } from '../hooks/useMediaQuery.js';

const ChevronIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </svg>
);

const MoonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20.5 14.3A8.6 8.6 0 0 1 9.7 3.5a8.6 8.6 0 1 0 10.8 10.8Z" />
  </svg>
);

const seasonOptionLabel = (s, compact) => {
  if (!s.mocked) return s.label;
  return compact ? `${s.label} (mocked)` : `${s.label} — mocked, not fully accurate`;
};

export default function Header({ seasons, season, onSeasonChange, tab, onTabChange, theme, onToggleTheme, subtitle }) {
  const compact = useMediaQuery('(max-width: 640px)');
  return (
    <>
      <header className="header">
        <div className="container header__inner">
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">NFL</span>
            <div className="brand__text">
              <div className="brand__title">Season Tracker</div>
              <div className="brand__sub">{subtitle}</div>
            </div>
          </div>

          <div className="header__actions">
            <label className="sr-only" htmlFor="season-select">Season</label>
            <span className="select-wrap">
              <select
                id="season-select"
                className="select"
                value={season ?? ''}
                onChange={(e) => onSeasonChange(Number(e.target.value))}
              >
                {seasons.map((s) => (
                  <option key={s.year} value={s.year}>
                    {seasonOptionLabel(s, compact)}
                  </option>
                ))}
              </select>
              <ChevronIcon />
            </span>

            <button
              type="button"
              className="btn btn--icon"
              onClick={onToggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </div>
      </header>

      <div className="container">
        <div className="tabbar">
          <div className="tabs" role="tablist" aria-label="Dashboard sections">
            {[
              { id: 'projections', label: 'Projections' },
              { id: 'leaders', label: 'Stat Leaders' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                className="tab"
                aria-selected={tab === t.id}
                onClick={() => onTabChange(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
