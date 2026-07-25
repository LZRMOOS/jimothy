import { useEffect, useLayoutEffect, useState, useCallback } from "react";
import { TOUR_STEPS } from "../utils/featureTour";

type Props = {
  // Called when the tour finishes (last step's "Done") — used to open the
  // sample note. Not called when the user skips/escapes.
  onComplete: () => void;
  // Called on skip, Esc, or after completion — always tears down the overlay.
  onClose: () => void;
};

type Rect = { top: number; left: number; width: number; height: number };

// Padding around the spotlighted element so the highlight doesn't crop it.
const PAD = 6;
// Gap between the spotlight and the tooltip.
const GAP = 14;
const TOOLTIP_W = 320;

function measure(target: string | null): Rect | null {
  if (!target) return null;
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function TourOverlay({ onComplete, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const current = TOUR_STEPS[step];
  const isFirst = step === 0;
  const isLast = step === TOUR_STEPS.length - 1;

  const remeasure = useCallback(() => {
    setRect(measure(current.target));
  }, [current.target]);

  // useLayoutEffect so the spotlight is positioned before paint (no flash at
  // the old location when advancing steps).
  useLayoutEffect(() => {
    remeasure();
  }, [remeasure]);

  useEffect(() => {
    window.addEventListener("resize", remeasure);
    // Capture-phase scroll so we catch scrolls inside any nested container.
    window.addEventListener("scroll", remeasure, true);
    return () => {
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", remeasure, true);
    };
  }, [remeasure]);

  const next = useCallback(() => {
    if (isLast) {
      onComplete();
      onClose();
    } else {
      setStep((s) => s + 1);
    }
  }, [isLast, onComplete, onClose]);

  const back = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [next, back, onClose]);

  // Spotlight box (padded target), or null for a centered step.
  const spot = rect
    ? {
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;

  // Tooltip placement: prefer below the target, flip above if it would run off
  // the bottom; horizontally clamp within the viewport. Centered when no target.
  let tipStyle: React.CSSProperties;
  let arrow: "up" | "down" | null = null;
  if (spot) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = spot.top + spot.height + GAP;
    const wantBelow = below + 160 < vh;
    const top = wantBelow ? below : Math.max(GAP, spot.top - GAP - 150);
    arrow = wantBelow ? "up" : "down";
    let left = spot.left + spot.width / 2 - TOOLTIP_W / 2;
    left = Math.max(GAP, Math.min(left, vw - TOOLTIP_W - GAP));
    tipStyle = { top, left, width: TOOLTIP_W };
  } else {
    tipStyle = {
      top: "50%",
      left: "50%",
      width: TOOLTIP_W,
      transform: "translate(-50%, -50%)",
    };
  }

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true">
      {/* Dimmer: a single element with a huge spread box-shadow cut to the
          spotlight rect punches a hole around the target. When no target, a
          plain full-screen scrim. */}
      {spot ? (
        <div
          className="tour-spotlight"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
          }}
        />
      ) : (
        <div className="tour-scrim" />
      )}

      <div className={`tour-tooltip${arrow ? ` arrow-${arrow}` : ""}`} style={tipStyle}>
        <div className="tour-tooltip-title">{current.title}</div>
        <div className="tour-tooltip-body">{current.body}</div>
        <div className="tour-tooltip-footer">
          <div className="tour-dots">
            {TOUR_STEPS.map((_, i) => (
              <span key={i} className={`tour-dot${i === step ? " active" : ""}`} />
            ))}
          </div>
          <div className="tour-actions">
            {!isLast && (
              <button className="tour-btn tour-btn-ghost" onClick={onClose}>
                Skip
              </button>
            )}
            {!isFirst && (
              <button className="tour-btn tour-btn-ghost" onClick={back}>
                Back
              </button>
            )}
            <button className="tour-btn tour-btn-primary" onClick={next}>
              {isLast ? "Open sample note" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
