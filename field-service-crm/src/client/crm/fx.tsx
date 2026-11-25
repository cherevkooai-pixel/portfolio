// Small, earned moments: live clock, count-up numbers, haptics, the leaf burst and the "Won" moment.
import { useEffect, useRef, useState } from "preact/hooks";
import { money } from "./lib";

export const calm = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const buzz = (ms: number | number[] = 12) => { try { if (!calm()) navigator.vibrate?.(ms); } catch { /* not supported */ } };

/** Where the last tap landed, so a burst can start from the button that earned it. */
export const lastTap = { x: 0, y: 0 };
if (typeof document !== "undefined") document.addEventListener("pointerdown", (e) => { lastTap.x = e.clientX; lastTap.y = e.clientY; }, { passive: true, capture: true });

/** Re-renders every `ms` so timers stay live. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/** Counts from the previous value to the new one (exponential ease-out, ~600 ms). */
export function useCountUp(value: number | null | undefined, ms = 650) {
  const [shown, setShown] = useState(value ?? 0);
  const from = useRef(0);
  useEffect(() => {
    if (value == null) return;
    if (calm()) { setShown(value); return; }
    const start = performance.now(), a = from.current, b = value;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms), e = 1 - Math.pow(2, -10 * k);
      setShown(Math.round(a + (b - a) * (k === 1 ? 1 : e)));
      if (k < 1) raf = requestAnimationFrame(step); else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return value == null ? null : shown;
}

const LEAF = "M12 2C6 6 4 12 6 20c8-1 13-7 12-17-2 0-4 0-6-1zM6 20c3-5 6-8 10-11";

/** A one-off burst of leaves from a point; removes itself. */
export function burst(x: number, y: number, n = 14) {
  if (calm()) return;
  const host = document.createElement("div");
  host.className = "fx-burst";
  host.style.left = `${x}px`;
  host.style.top = `${y}px`;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.5, d = 60 + Math.random() * 90;
    host.insertAdjacentHTML("beforeend", `<svg viewBox="0 0 24 24" style="--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 40}px;--r:${Math.random() * 540 - 270}deg;--s:${0.6 + Math.random() * 0.7};animation-delay:${Math.random() * 60}ms"><path d="${LEAF}"/></svg>`);
  }
  document.body.appendChild(host);
  setTimeout(() => host.remove(), 1300);
}

/** Fire the "Won" moment from anywhere. */
export const celebrateWin = (cents: number, name: string) => window.dispatchEvent(new CustomEvent("crm:won", { detail: { cents, name } }));

function WinNumber({ cents }: { cents: number }) {
  const v = useCountUp(cents, 900);
  return <b class="fx-win-n">{money(v ?? 0)}</b>;
}

/** Mounted once in the app shell. */
export function Celebrations() {
  const [win, setWin] = useState<{ cents: number; name: string } | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail;
      setWin(d);
      buzz([18, 60, 28]);
      requestAnimationFrame(() => burst(innerWidth / 2, innerHeight * 0.42, 22));
      setTimeout(() => setWin(null), 2400);
    };
    window.addEventListener("crm:won", on);
    return () => window.removeEventListener("crm:won", on);
  }, []);
  if (!win) return null;
  return (
    <div class="fx-win" role="status" aria-live="polite" onClick={() => setWin(null)}>
      <div class="fx-win-card">
        <span class="fx-win-l">Job won</span>
        {win.cents > 0 && <WinNumber cents={win.cents} />}
        <span class="fx-win-who">{win.name}</span>
      </div>
    </div>
  );
}

/** Hand-drawn sprout for empty / all-done states. */
export function Sprout({ size = 88 }: { size?: number }) {
  return (
    <svg class="fx-sprout" width={size} height={size} viewBox="0 0 88 88" aria-hidden="true">
      <path class="g" d="M8 76h72" />
      <path class="s" d="M44 76V44" />
      <path class="l1" d="M44 52c-14 0-22-8-24-20 13 0 22 6 24 20z" />
      <path class="l2" d="M44 46c2-15 11-23 26-24-1 15-10 23-26 24z" />
    </svg>
  );
}

/** The 9-touch follow-up as a chain of dots. */
export function Chain({ done, late, total = 9 }: { done: number; late: number; total?: number }) {
  return (
    <span class="fx-chain" aria-label={`Follow-up ${done} of ${total} done${late ? `, ${late} overdue` : ""}`}>
      {Array.from({ length: total }, (_, i) => <i class={i < done ? "d" : i < done + late ? "l" : ""} />)}
    </span>
  );
}
