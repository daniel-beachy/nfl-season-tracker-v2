import { useInView } from '../hooks/useInView.js';

/**
 * Card wrapper that defers rendering its chart until scrolled near the
 * viewport, keeping the first paint fast on the projections tab.
 */
export default function ChartCard({ title, subtitle, meta, height = 260, children }) {
  const [ref, inView] = useInView();
  return (
    <section className="card" ref={ref}>
      <header className="card__head">
        <div>
          <h3 className="card__title">{title}</h3>
          {subtitle && <p className="card__sub">{subtitle}</p>}
        </div>
        {meta && <span className="card__meta">{meta}</span>}
      </header>
      {inView ? (
        children
      ) : (
        <div className="chart">
          <div className="skeleton" style={{ height, margin: '4px 2px' }} />
        </div>
      )}
    </section>
  );
}
