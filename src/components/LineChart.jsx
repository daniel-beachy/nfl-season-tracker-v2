import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
} from 'chart.js';
import { buildTeamStyles, withAlpha } from '../lib/colors.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip);

Chart.defaults.font.family =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * Multi-line time-series chart with one line per team (or per athlete).
 *
 * Lines use each team's own colour, resolved for the active theme. Hovering a
 * line or a legend chip dims the others, which is what keeps a 32-line chart
 * readable; clicking a chip hides a line and alt-clicking isolates it.
 *
 * Hover and visibility changes mutate the existing chart in place rather than
 * rebuilding it, so interaction stays smooth with many datasets on screen.
 */
export default function LineChart({
  labels,
  series,
  teams,
  theme,
  height = 260,
  format = 'percent',
  yMax,
  yMin = 0,
  legend = true,
  legendScroll = false,
  labelFor,
  tooltipMode,
}) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [hidden, setHidden] = useState(() => new Set());
  const [focus, setFocus] = useState(null);

  // A leader series is identified by athlete but coloured by team, so the two
  // are tracked separately — two players from one team must stay distinct rows.
  const entries = useMemo(
    () => series.map((s) => ({ key: s.id ?? s.abbr, colorKey: s.abbr ?? s.id })),
    [series]
  );
  const keys = useMemo(() => entries.map((e) => e.key), [entries]);
  const seriesKey = keys.join('|');

  const styles = useMemo(() => buildTeamStyles(entries, teams, theme), [entries, teams, theme]);

  const labelOf = useCallback((s) => (labelFor ? labelFor(s) : s.abbr ?? s.id), [labelFor]);

  const suffix = format === 'percent' ? '%' : '';
  const decimals = format === 'percent' || format === 'wins' ? 1 : 0;
  const fmt = useCallback(
    (v) =>
      v === null || v === undefined
        ? '\u2014'
        : `${Number(v).toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          })}${suffix}`,
    [decimals, suffix]
  );

  // A new set of teams/players resets the per-chart visibility state.
  useEffect(() => {
    setHidden(new Set());
    setFocus(null);
  }, [seriesKey]);

  /* ------------------------------ create ---------------------------------- */
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return undefined;

    const textMuted = cssVar('--text-muted') || '#7a8699';
    const textColor = cssVar('--text') || '#e9edf3';
    const gridColor = cssVar('--grid') || 'rgba(255,255,255,0.07)';
    const tooltipBg = cssVar('--tooltip-bg') || 'rgba(18,21,28,0.97)';
    const borderStrong = cssVar('--border-strong') || 'rgba(255,255,255,0.16)';
    const surface = cssVar('--bg-elevated') || '#12151c';

    const datasets = series.map((s) => {
      const key = s.id ?? s.abbr;
      const style = styles.get(key) ?? { color: '#888', dash: [] };
      return {
        label: labelOf(s),
        teamKey: key,
        data: s.values,
        borderColor: style.color,
        backgroundColor: style.color,
        borderWidth: 1.75,
        borderDash: style.dash,
        // With only a snapshot or two there is no line to see, so draw the dots.
        pointRadius: labels.length <= 2 ? 3.5 : 0,
        pointHoverRadius: 4,
        pointHoverBorderWidth: 2,
        pointHoverBackgroundColor: style.color,
        pointHoverBorderColor: surface,
        tension: 0.28,
        spanGaps: true,
      };
    });

    const chart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 200 },
        normalized: true,
        interaction: {
          mode: tooltipMode ?? (series.length <= 6 ? 'index' : 'nearest'),
          intersect: false,
          axis: 'x',
        },
        layout: { padding: { top: 4, right: 8, bottom: 0, left: 0 } },
        onHover: (_event, elements, c) => {
          const next = elements.length ? c.data.datasets[elements[0].datasetIndex]?.teamKey ?? null : null;
          setFocus((current) => (current === next ? current : next));
        },
        scales: {
          x: {
            grid: { display: false },
            border: { color: gridColor },
            ticks: {
              color: textMuted,
              font: { size: 10.5, weight: '500' },
              maxRotation: 0,
              autoSkipPadding: 12,
            },
          },
          y: {
            min: yMin,
            max: yMax,
            grid: { color: gridColor, drawTicks: false },
            border: { display: false },
            ticks: {
              color: textMuted,
              font: { size: 10.5 },
              padding: 8,
              maxTicksLimit: 6,
              callback: (v) => `${v}${suffix}`,
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: tooltipBg,
            titleColor: textColor,
            bodyColor: textColor,
            borderColor: borderStrong,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 9,
            boxPadding: 4,
            usePointStyle: true,
            titleFont: { size: 11.5, weight: '650' },
            bodyFont: { size: 12 },
            itemSort: (a, b) => (b.parsed.y ?? -Infinity) - (a.parsed.y ?? -Infinity),
            callbacks: { label: (item) => ` ${item.dataset.label}  ${fmt(item.parsed.y)}` },
          },
        },
      },
    });

    chartRef.current = chart;
    return () => {
      chart.destroy();
      chartRef.current = null;
    };
  }, [seriesKey, labels, series, styles, theme, yMax, yMin, suffix, tooltipMode, labelOf, fmt]);

  /* ------------------- in-place focus / visibility update ------------------ */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    let changed = false;
    chart.data.datasets.forEach((ds, i) => {
      const style = styles.get(ds.teamKey);
      if (!style) return;
      const dimmed = focus !== null && focus !== ds.teamKey;
      const nextColor = dimmed ? withAlpha(style.color, 0.14) : style.color;
      const nextWidth = focus === ds.teamKey ? 2.9 : 1.75;
      if (ds.borderColor !== nextColor || ds.borderWidth !== nextWidth) {
        ds.borderColor = nextColor;
        ds.borderWidth = nextWidth;
        changed = true;
      }
      const shouldHide = hidden.has(ds.teamKey);
      if (chart.getDatasetMeta(i).hidden !== shouldHide) {
        chart.setDatasetVisibility(i, !shouldHide);
        changed = true;
      }
    });
    if (changed) chart.update('none');
  }, [focus, hidden, styles]);

  const toggle = (key, isolate) => {
    setHidden((prev) => {
      if (isolate) {
        const others = keys.filter((k) => k !== key);
        const alreadyIsolated = !prev.has(key) && others.every((k) => prev.has(k));
        return alreadyIsolated ? new Set() : new Set(others);
      }
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="chart">
      <div className="chart__canvas" style={{ height }}>
        <canvas ref={canvasRef} role="img" aria-label="Time series chart" />
      </div>
      {legend && (
        <div className={`legend${legendScroll ? ' legend__scroll' : ''}`}>
          {series.map((s) => {
            const key = s.id ?? s.abbr;
            const style = styles.get(key);
            const label = labelOf(s);
            return (
              <button
                key={key}
                type="button"
                className="chip"
                data-off={hidden.has(key)}
                title={`${s.fullName ?? label} \u2014 click to toggle, alt-click to isolate`}
                onMouseEnter={() => setFocus(key)}
                onMouseLeave={() => setFocus(null)}
                onFocus={() => setFocus(key)}
                onBlur={() => setFocus(null)}
                onClick={(e) => toggle(key, e.altKey || e.metaKey)}
              >
                <span
                  className="chip__dot"
                  style={{
                    background: style?.color,
                    backgroundImage: style?.dash?.length
                      ? `repeating-linear-gradient(90deg, ${style.color} 0 3px, transparent 3px 5px)`
                      : undefined,
                  }}
                />
                {label}
              </button>
            );
          })}
          {series.length > 8 && (
            <span className="legend__tools">
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setHidden(new Set())}>
                All
              </button>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setHidden(new Set(keys))}>
                None
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
