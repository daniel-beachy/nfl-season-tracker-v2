import { useMemo } from 'react';
import { buildTeamStyles } from '../lib/colors.js';

/**
 * Ranked horizontal bars.
 *
 * A season with a single snapshot has no trend to draw, so the same data is
 * shown as a sorted bar list instead of a line chart with one dot per series.
 */
export default function RankedBars({ series, teams, theme, format = 'percent', labelFor, columns = true }) {
  const entries = useMemo(
    () => series.map((s) => ({ key: s.id ?? s.abbr, colorKey: s.abbr ?? s.id })),
    [series]
  );
  const styles = useMemo(() => buildTeamStyles(entries, teams, theme), [entries, teams, theme]);

  const suffix = format === 'percent' ? '%' : '';
  const decimals = format === 'percent' || format === 'wins' ? 1 : 0;

  const rows = useMemo(() => {
    const list = series
      .map((s) => {
        const value = [...s.values].reverse().find((v) => v !== null && v !== undefined);
        return {
          key: s.id ?? s.abbr,
          label: labelFor ? labelFor(s) : s.abbr ?? s.id,
          title: s.fullName ?? s.label ?? s.abbr,
          value: value ?? null,
        };
      })
      .filter((r) => r.value !== null);
    list.sort((a, b) => b.value - a.value);
    return list;
  }, [series, labelFor]);

  const peak = Math.max(...rows.map((r) => r.value), 0.0001);
  const twoCols = columns && rows.length > 8;
  // Column-major so the ranking reads 1..n down the left column, then the right.
  const style = twoCols ? { gridTemplateRows: `repeat(${Math.ceil(rows.length / 2)}, auto)` } : undefined;

  return (
    <div className={`bars${twoCols ? ' bars--cols' : ''}`} style={style}>
      {rows.map((row, i) => (
        <div className="bars__row" key={row.key} title={row.title}>
          <span className="bars__rank">{i + 1}</span>
          <span className="bars__label">{row.label}</span>
          <span className="bars__track">
            <span
              className="bars__fill"
              style={{ width: `${Math.max(1.5, (row.value / peak) * 100)}%`, background: styles.get(row.key)?.color }}
            />
          </span>
          <span className="bars__value num">
            {row.value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
            {suffix}
          </span>
        </div>
      ))}
    </div>
  );
}
