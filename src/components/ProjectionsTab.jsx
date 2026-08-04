import { useMemo } from 'react';
import ChartCard from './ChartCard.jsx';
import TrendView from './TrendView.jsx';
import Banner from './Banner.jsx';
import {
  CONFERENCES,
  DIVISIONS,
  buildSeries,
  buildNormalizedDivisionSeries,
  teamsInConference,
  teamsInDivision,
} from '../lib/data.js';

/** Headline numbers from the most recent snapshot. */
function SummaryStrip({ snapshot, teams, teamMeta, theme, complete }) {
  const top = useMemo(() => {
    const rows = Object.entries(snapshot.teams ?? {}).map(([abbr, t]) => ({ abbr, ...t }));
    const best = (field) => [...rows].sort((a, b) => (b[field] ?? 0) - (a[field] ?? 0))[0];
    return {
      title: best('winSB'),
      wins: best('projWins'),
      afc: [...rows].filter((r) => teamMeta[r.abbr]?.conf === 'AFC').sort((a, b) => (b.makeSB ?? 0) - (a.makeSB ?? 0))[0],
      nfc: [...rows].filter((r) => teamMeta[r.abbr]?.conf === 'NFC').sort((a, b) => (b.makeSB ?? 0) - (a.makeSB ?? 0))[0],
    };
  }, [snapshot, teamMeta]);

  const Item = ({ label, row, value, sub }) => {
    const team = teams[row?.abbr];
    if (!team) return null;
    return (
      <div className="stat">
        <div className="stat__label">{label}</div>
        <div className="stat__value">
          <img src={theme === 'dark' ? team.logoDark ?? team.logo : team.logo} alt="" loading="lazy" />
          <span>{team.shortName}</span>
        </div>
        <div className="stat__sub">
          <span className="num">{value}</span> {sub}
        </div>
      </div>
    );
  };

  return (
    <div className="statstrip">
      <Item
        label={complete ? 'Super Bowl champion' : 'Super Bowl favorite'}
        row={top.title}
        value={`${top.title?.winSB ?? 0}%`}
        sub={complete ? 'final title odds' : 'to win it all'}
      />
      <Item
        label={complete ? 'AFC champion' : 'AFC favorite'}
        row={top.afc}
        value={`${top.afc?.makeSB ?? 0}%`}
        sub="to reach the SB"
      />
      <Item
        label={complete ? 'NFC champion' : 'NFC favorite'}
        row={top.nfc}
        value={`${top.nfc?.makeSB ?? 0}%`}
        sub="to reach the SB"
      />
      <Item label="Most projected wins" row={top.wins} value={top.wins?.projWins ?? 0} sub="wins" />
    </div>
  );
}

export default function ProjectionsTab({ seasonData, teams, theme, showSparseNotice = true }) {
  const snapshots = seasonData?.projections?.snapshots ?? [];
  const teamMeta = seasonData?.teamMeta ?? {};

  const conferenceTeams = useMemo(
    () => Object.fromEntries(CONFERENCES.map((c) => [c, teamsInConference(teamMeta, c)])),
    [teamMeta]
  );
  const allTeams = useMemo(() => Object.keys(teamMeta).sort(), [teamMeta]);

  const winSB = useMemo(() => buildSeries(snapshots, allTeams, 'winSB'), [snapshots, allTeams]);
  const projWins = useMemo(() => buildSeries(snapshots, allTeams, 'projWins'), [snapshots, allTeams]);
  const makeSB = useMemo(
    () => Object.fromEntries(CONFERENCES.map((c) => [c, buildSeries(snapshots, conferenceTeams[c], 'makeSB')])),
    [snapshots, conferenceTeams]
  );
  const playoffs = useMemo(
    () => Object.fromEntries(CONFERENCES.map((c) => [c, buildSeries(snapshots, conferenceTeams[c], 'makePlayoffs')])),
    [snapshots, conferenceTeams]
  );
  const divisions = useMemo(
    () =>
      DIVISIONS.map((div) => ({
        div,
        abbrs: teamsInDivision(teamMeta, div),
        ...buildNormalizedDivisionSeries(snapshots, teamsInDivision(teamMeta, div)),
      })).filter((d) => d.abbrs.length > 0),
    [snapshots, teamMeta]
  );

  const teamLabel = useMemo(() => (s) => s.abbr, []);

  if (!snapshots.length) {
    return (
      <div className="empty">
        <div className="empty__title">No projection snapshots yet</div>
        <p className="empty__desc">
          Snapshots are captured automatically each week during the season and monthly in the offseason.
        </p>
      </div>
    );
  }

  const latest = snapshots[snapshots.length - 1];
  const single = snapshots.length === 1;
  const meta = `${snapshots.length} snapshot${snapshots.length === 1 ? '' : 's'} \u00b7 latest ${latest.label}`;

  return (
    <>
      {single && showSparseNotice && (
        <Banner>
          Only one snapshot exists for this season so far, so the charts show current standings rather than trends.
          Lines appear once a second snapshot is captured.
        </Banner>
      )}

      <SummaryStrip
        snapshot={latest}
        teams={teams}
        teamMeta={teamMeta}
        theme={theme}
        complete={seasonData.phase === 'complete'}
      />

      <div className="section">
        <div className="section__head">
          <h2 className="section__title">Win the Super Bowl</h2>
          <span className="section__desc">All 32 teams &middot; probabilities sum to 100%</span>
        </div>
        <ChartCard title={single ? 'Championship odds' : 'Championship odds over time'} meta={meta} height={340}>
          <TrendView
            labels={winSB.labels}
            series={winSB.series}
            teams={teams}
            theme={theme}
            height={340}
            format="percent"
            labelFor={teamLabel}
            legendScroll
          />
        </ChartCard>
      </div>

      <div className="section">
        <div className="section__head">
          <h2 className="section__title">Reach the Super Bowl</h2>
          <span className="section__desc">By conference &middot; 16 teams each</span>
        </div>
        <div className="grid grid--2">
          {CONFERENCES.map((conf) => (
            <ChartCard key={conf} title={`${conf} \u2014 make the Super Bowl`} meta={`${conferenceTeams[conf].length} teams`}>
              <TrendView
                labels={makeSB[conf].labels}
                series={makeSB[conf].series}
                teams={teams}
                theme={theme}
                format="percent"
                labelFor={teamLabel}
                legendScroll
              />
            </ChartCard>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section__head">
          <h2 className="section__title">Make the playoffs</h2>
          <span className="section__desc">Seven berths per conference</span>
        </div>
        <div className="grid grid--2">
          {CONFERENCES.map((conf) => (
            <ChartCard key={conf} title={`${conf} \u2014 playoff odds`} meta={`${conferenceTeams[conf].length} teams`}>
              <TrendView
                labels={playoffs[conf].labels}
                series={playoffs[conf].series}
                teams={teams}
                theme={theme}
                format="percent"
                yMax={100}
                labelFor={teamLabel}
                legendScroll
              />
            </ChartCard>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section__head">
          <h2 className="section__title">Win the division</h2>
          <span className="section__desc">Each division normalized to 100%</span>
        </div>
        <div className="grid grid--4">
          {divisions.map(({ div, labels, series }) => (
            <ChartCard key={div} title={div} height={200}>
              <TrendView
                labels={labels}
                series={series}
                teams={teams}
                theme={theme}
                height={200}
                format="percent"
                yMax={100}
                labelFor={teamLabel}
                tooltipMode="index"
              />
            </ChartCard>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section__head">
          <h2 className="section__title">Projected win total</h2>
          <span className="section__desc">
            {single ? 'Expected regular-season wins' : 'Expected regular-season wins, week over week'}
          </span>
        </div>
        <ChartCard title="Projected wins" meta={meta} height={340}>
          <TrendView
            labels={projWins.labels}
            series={projWins.series}
            teams={teams}
            theme={theme}
            height={340}
            format="wins"
            yMin={0}
            yMax={18}
            labelFor={teamLabel}
            legendScroll
          />
        </ChartCard>
      </div>
    </>
  );
}
