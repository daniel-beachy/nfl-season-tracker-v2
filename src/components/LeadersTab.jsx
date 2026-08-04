import { useEffect, useMemo, useState } from 'react';
import ChartCard from './ChartCard.jsx';
import TrendView from './TrendView.jsx';
import { buildLeaderSeries, currentLeaders } from '../lib/data.js';
import { resolveTeamColor, readableTextOn } from '../lib/colors.js';

const formatValue = (value, categoryKey) => {
  if (value === null || value === undefined) return '\u2014';
  const isRate = categoryKey === 'quarterbackRating' || categoryKey === 'sacks';
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: isRate && !Number.isInteger(value) ? 1 : 0,
    maximumFractionDigits: isRate ? 1 : 0,
  });
};

function LeaderCard({ row, categoryKey, teams, theme }) {
  const team = teams[row.team ?? row.athlete?.team];
  const color = resolveTeamColor(team, theme);
  const athlete = row.athlete ?? {};
  return (
    <article
      className={`leader-card${row.rank === 1 ? ' leader-card--top' : ''}`}
      style={{ '--team-color': color, '--team-text': readableTextOn(color) }}
    >
      <span className="leader-card__rank">{row.rank}</span>
      {athlete.headshot ? (
        <img
          className="leader-card__avatar"
          src={athlete.headshot}
          alt=""
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.visibility = 'hidden';
          }}
        />
      ) : (
        <span className="leader-card__avatar" />
      )}
      <div className="leader-card__body">
        <div className="leader-card__name" title={athlete.name}>
          {athlete.name ?? row.id}
        </div>
        <div className="leader-card__meta">
          {team && <span className="team-tag">{team.abbr}</span>}
          <span>{athlete.pos ?? ''}</span>
        </div>
      </div>
      <div className="leader-card__value">
        <div className="leader-card__num">{formatValue(row.v, categoryKey)}</div>
        {row.delta !== null && row.delta > 0 && (
          <div className="leader-card__delta leader-card__delta--up">+{formatValue(row.delta, categoryKey)}</div>
        )}
      </div>
    </article>
  );
}

export default function LeadersTab({ seasonData, teams, theme }) {
  const categories = seasonData?.leaders?.categories ?? [];
  const snapshots = seasonData?.leaders?.snapshots ?? [];
  const [active, setActive] = useState(categories[0]?.key ?? null);

  // Season changes swap the whole category list; keep the selection valid.
  useEffect(() => {
    if (!categories.length) {
      setActive(null);
    } else if (!categories.some((c) => c.key === active)) {
      setActive(categories[0].key);
    }
  }, [categories, active]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const cat of categories) {
      if (!map.has(cat.group)) map.set(cat.group, []);
      map.get(cat.group).push(cat);
    }
    return [...map.entries()];
  }, [categories]);

  const category = categories.find((c) => c.key === active) ?? null;
  const chart = useMemo(
    () => (active ? buildLeaderSeries(seasonData, active) : { labels: [], series: [] }),
    [seasonData, active]
  );
  const board = useMemo(() => (active ? currentLeaders(seasonData, active) : []), [seasonData, active]);

  const athleteLabel = useMemo(() => (s) => s.label, []);
  const chartSeries = useMemo(() => chart.series.slice(0, 10), [chart.series]);

  if (!categories.length || !snapshots.length) {
    return (
      <div className="empty">
        <div className="empty__title">No stat leaders yet</div>
        <p className="empty__desc">
          Player statistics become available once the season kicks off. Leaders are captured every week and stored
          alongside the projections.
        </p>
      </div>
    );
  }

  const latest = snapshots[snapshots.length - 1];
  const isCumulative = category?.cumulative !== false;
  const single = snapshots.length === 1;

  return (
    <>
      <div className="catbar">
        {grouped.map(([group, cats]) => (
          <div className="catgroup" key={group}>
            <span className="catgroup__label">{group}</span>
            <div className="catgroup__items">
              {cats.map((cat) => (
                <button
                  key={cat.key}
                  type="button"
                  className="pill"
                  aria-pressed={cat.key === active}
                  onClick={() => setActive(cat.key)}
                >
                  {cat.name.replace(/^(Passing|Rushing|Receiving|Total) /, '')}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="section" style={{ marginTop: 0 }}>
        <div className="section__head">
          <h2 className="section__title">{category?.name}</h2>
          <span className="section__desc">
            {single
              ? 'Season to date'
              : isCumulative
                ? 'Cumulative season total, week over week'
                : 'Season-to-date rate, week over week'}
            {' \u00b7 '}
            top 10 through {latest.label}
          </span>
        </div>

        <ChartCard
          title={single ? `${category?.name} \u2014 top 10` : `${category?.name} \u2014 race over time`}
          subtitle={
            single
              ? 'Colored by team. A trend line appears once a second week is captured.'
              : 'Colored by team. Hover a line or legend chip to isolate it.'
          }
          meta={`${snapshots.length} snapshot${single ? '' : 's'}`}
          height={360}
        >
          <TrendView
            labels={chart.labels}
            series={chartSeries}
            teams={teams}
            theme={theme}
            height={360}
            format="raw"
            yMin={isCumulative ? 0 : undefined}
            labelFor={athleteLabel}
            tooltipMode="nearest"
          />
        </ChartCard>
      </div>

      <div className="section">
        <div className="section__head">
          <h2 className="section__title">Current leaderboard</h2>
          <span className="section__desc">
            Totals through {latest.label}
            {board.some((r) => r.delta) ? ' \u00b7 change shown vs previous snapshot' : ''}
          </span>
        </div>
        <div className="leader-grid">
          {board.map((row) => (
            <LeaderCard key={row.id} row={row} categoryKey={active} teams={teams} theme={theme} />
          ))}
        </div>
      </div>
    </>
  );
}
