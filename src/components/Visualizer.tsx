"use client";
/**
 * Dual audio visualiser (seller + Priya). Levels are polled from the voice
 * session every animation frame and drawn on a canvas, with no React re-renders.
 */
import { useEffect, useRef } from "react";
import type { AudioLevels } from "@/lib/voice/types";
import type { CallStatus } from "@/lib/voice/types";
import { cx } from "./ui";

const BARS = 28;

export function Visualizer({ getLevels, status }: { getLevels: () => AudioLevels; status: CallStatus }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const avatarRef = useRef<HTMLDivElement>(null);
  const live = status !== "idle" && status !== "ended";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const user = new Array(BARS).fill(0);
    const bot = new Array(BARS).fill(0);

    const draw = (t: number) => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const levels = live ? getLevels() : { user: 0, bot: 0 };
      // Each bar follows the level with its own wobble so it looks organic.
      for (let i = 0; i < BARS; i++) {
        const shape = 0.55 + 0.45 * Math.sin((i / BARS) * Math.PI);
        const wobbleU = 0.6 + 0.4 * Math.sin(t / 120 + i * 1.7);
        const wobbleB = 0.6 + 0.4 * Math.sin(t / 105 + i * 2.3);
        user[i] += (levels.user * shape * wobbleU - user[i]) * 0.35;
        bot[i] += (levels.bot * shape * wobbleB - bot[i]) * 0.35;
      }

      const half = w / 2;
      const gap = 3;
      const barW = Math.max(2, (half - 24) / BARS - gap);
      const mid = h / 2;
      const drawRow = (vals: number[], x0: number, dir: 1 | -1, color: string) => {
        ctx.fillStyle = color;
        vals.forEach((v, i) => {
          const bh = Math.max(3, v * (h - 8));
          const x = x0 + dir * i * (barW + gap) - (dir === -1 ? barW : 0);
          const r = Math.min(barW / 2, 3);
          ctx.beginPath();
          ctx.roundRect(x, mid - bh / 2, barW, bh, r);
          ctx.fill();
        });
      };
      // Seller on the left (grows leftwards from centre), Priya on the right.
      drawRow(user, half - 14, -1, "#0ea5e9");
      drawRow(bot, half + 14, 1, "#e40046");

      if (avatarRef.current) {
        const s = 1 + Math.min(0.18, levels.bot * 0.3);
        avatarRef.current.style.transform = `scale(${s.toFixed(3)})`;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [getLevels, live]);

  return (
    <div className="relative">
      <canvas ref={canvasRef} className="h-20 w-full" aria-hidden />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="relative">
          {status === "speaking" && <span className="absolute inset-0 rounded-full bg-accent/30 animate-ring" />}
          <div
            ref={avatarRef}
            className={cx(
              "relative grid h-12 w-12 place-items-center rounded-full text-sm font-semibold text-white shadow-lg transition-colors",
              live ? "bg-accent shadow-accent/30" : "bg-slate-300",
            )}
          >
            P
          </div>
        </div>
      </div>
      <div className="mt-1 flex justify-between px-1 text-[10px] font-medium tracking-wide text-slate-400 uppercase">
        <span className="text-sky-600/80">Seller</span>
        <span className="text-accent/80">Priya</span>
      </div>
    </div>
  );
}
