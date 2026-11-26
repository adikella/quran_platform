import { useEffect, useRef, useState, type RefObject } from "react";
import { useT } from "../hooks";

interface Place {
  side: "left" | "right";
  /** Доля высоты экрана, где центр кнопки. */
  y: number;
}

const KEY = "floatCounter";
const SIZE = 64;
const EDGE = 12;
/** Сколько снизу занято кнопкой «Сдать». */
const BOTTOM = 96;

function saved(): Place {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "") as Place;
    if ((p.side === "left" || p.side === "right") && p.y >= 0 && p.y <= 1) return p;
  } catch {
    /* нет сохранённого места */
  }
  return { side: "right", y: 0.62 };
}

function clampY(px: number) {
  const top = EDGE + SIZE / 2 + 48;
  const bottom = window.innerHeight - BOTTOM - SIZE / 2;
  return Math.min(bottom, Math.max(top, px));
}

/**
 * Круглая кнопка счёта, которая появляется, когда большой счётчик ушёл вверх за экран.
 * Нажатие: +1. Перетаскивание: кнопка уходит туда, где не мешает тексту, и прилипает к ближнему краю.
 */
export function FloatCounter({
  anchor,
  count,
  target,
  onInc,
}: {
  anchor: RefObject<HTMLElement | null>;
  count: number;
  target?: number;
  onInc: () => void;
}) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const [place, setPlace] = useState(saved);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = anchor.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setShown(!e.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [anchor]);

  if (!shown) return null;

  const pct = target ? Math.min(100, (count / target) * 100) : 0;
  const y = drag ? clampY(drag.y) : clampY(place.y * window.innerHeight);
  const style: React.CSSProperties = drag
    ? { left: Math.min(window.innerWidth - SIZE - EDGE, Math.max(EDGE, drag.x - SIZE / 2)), top: y - SIZE / 2 }
    : { [place.side]: EDGE, top: y - SIZE / 2 };

  return (
    <button
      type="button"
      className={`float-counter ${drag ? "dragging" : ""}`}
      style={{ ...style, "--pct": `${pct}%` } as React.CSSProperties}
      aria-label={`${t("plusOne")}, ${count}${target ? ` / ${target}` : ""}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY, moved: false };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        if (!s.moved && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 8) return;
        s.moved = true;
        setDrag({ x: e.clientX, y: e.clientY });
      }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        if (!s?.moved) {
          onInc();
          return;
        }
        const next: Place = {
          side: e.clientX < window.innerWidth / 2 ? "left" : "right",
          y: clampY(e.clientY) / window.innerHeight,
        };
        setDrag(null);
        setPlace(next);
        try {
          localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          /* место просто не запомнится */
        }
      }}
      onPointerCancel={() => {
        start.current = null;
        setDrag(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="float-count">{count}</span>
      {target ? <span className="float-target">/ {target}</span> : null}
    </button>
  );
}
