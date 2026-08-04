import LineChart from './LineChart.jsx';
import RankedBars from './RankedBars.jsx';

/**
 * Picks the right visualisation for the data on hand: a trend line once there
 * are at least two snapshots, and a ranked bar list before that.
 */
export default function TrendView({ labels, series, ...rest }) {
  if (labels.length > 1) return <LineChart labels={labels} series={series} {...rest} />;

  const { teams, theme, format, labelFor, columns } = rest;
  return (
    <RankedBars series={series} teams={teams} theme={theme} format={format} labelFor={labelFor} columns={columns} />
  );
}
