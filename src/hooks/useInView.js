import { useEffect, useRef, useState } from 'react';

/**
 * Defers work until an element is scrolled near the viewport.
 * The projections tab mounts fourteen charts; rendering them all up front makes
 * the first paint sluggish, so each chart waits until it is actually needed.
 */
export function useInView({ rootMargin = '300px', once = true } = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) observer.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { rootMargin }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin, once]);

  return [ref, inView];
}
