"use client";

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";

import type { VideoInfo } from "@/lib/types";

type Props = {
  video: VideoInfo;
  /** URL of the rendered (graded) MP4 — relative `/media/...` path is fine. */
  outputUrl: string;
  /** Label shown beneath the right-side video. */
  outputLabel?: string;
  onClose?: () => void;
};

type Mode = "side-by-side" | "split-slider";

/**
 * Synchronized comparison of the original upload vs the rendered output.
 *
 * Two modes:
 * - "side-by-side"   — both videos rendered next to each other.
 * - "split-slider"   — the graded video is overlaid on the original with
 *                      a draggable vertical wipe.
 */
export function CompareView({ video, outputUrl, outputLabel = "Graded", onClose }: Props) {
  const leftRef = useRef<HTMLVideoElement>(null);
  const rightRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("split-slider");
  const [splitPos, setSplitPos] = useState(0.5);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);

  // Re-sync the right video to match the left whenever the left seeks or pauses.
  useEffect(() => {
    const a = leftRef.current;
    const b = rightRef.current;
    if (!a || !b) return;
    const sync = () => {
      if (Math.abs(b.currentTime - a.currentTime) > 0.05) {
        b.currentTime = a.currentTime;
      }
    };
    const onPlay = () => {
      setPlaying(true);
      void b.play().catch(() => {});
    };
    const onPause = () => {
      setPlaying(false);
      b.pause();
    };
    a.addEventListener("seeked", sync);
    a.addEventListener("timeupdate", sync);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    return () => {
      a.removeEventListener("seeked", sync);
      a.removeEventListener("timeupdate", sync);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const a = leftRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }, []);

  // Drag the split slider when in split mode.
  useEffect(() => {
    if (mode !== "split-slider") return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    let dragging = false;
    const setFromX = (x: number) => {
      const r = wrap.getBoundingClientRect();
      const ratio = (x - r.left) / r.width;
      setSplitPos(Math.max(0, Math.min(1, ratio)));
    };
    const onDown = (e: MouseEvent | TouchEvent) => {
      dragging = true;
      const x = "touches" in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
      setFromX(x);
    };
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging) return;
      const x = "touches" in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
      setFromX(x);
    };
    const onUp = () => {
      dragging = false;
    };
    wrap.addEventListener("mousedown", onDown);
    wrap.addEventListener("touchstart", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    return () => {
      wrap.removeEventListener("mousedown", onDown);
      wrap.removeEventListener("touchstart", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
    };
  }, [mode]);

  const aspectRatio =
    video.width && video.height ? `${video.width}/${video.height}` : "16/9";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium">Compare</div>
        <div className="flex items-center gap-2 text-xs">
          <ModeButton active={mode === "split-slider"} onClick={() => setMode("split-slider")}>
            Split slider
          </ModeButton>
          <ModeButton active={mode === "side-by-side"} onClick={() => setMode("side-by-side")}>
            Side by side
          </ModeButton>
          {onClose && (
            <button
              onClick={onClose}
              className="ml-1 rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {mode === "split-slider" ? (
        <div
          ref={wrapRef}
          className="relative w-full overflow-hidden rounded-lg border border-zinc-800 bg-black select-none cursor-ew-resize"
          style={{ aspectRatio }}
        >
          <video
            ref={leftRef}
            src={video.stream_url}
            className="absolute inset-0 h-full w-full object-contain"
            playsInline
            loop
            autoPlay
            muted={muted}
            preload="auto"
          />
          <video
            ref={rightRef}
            src={outputUrl}
            className="absolute inset-0 h-full w-full object-contain"
            playsInline
            loop
            muted
            preload="auto"
            style={{ clipPath: `inset(0 0 0 ${splitPos * 100}%)` }}
          />
          {/* labels */}
          <div className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[11px] uppercase tracking-wider text-zinc-200">
            Original
          </div>
          <div className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[11px] uppercase tracking-wider text-violet-200">
            {outputLabel}
          </div>
          {/* split divider */}
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-white/80 mix-blend-difference"
            style={{ left: `${splitPos * 100}%` }}
          />
          <div
            className="pointer-events-none absolute top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/80 bg-black/40 text-[10px] text-white shadow"
            style={{ left: `${splitPos * 100}%` }}
          >
            ↔
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <CompareSide
            ref={leftRef}
            label="Original"
            src={video.stream_url}
            aspectRatio={aspectRatio}
            muted={muted}
          />
          <CompareSide
            ref={rightRef}
            label={outputLabel}
            src={outputUrl}
            aspectRatio={aspectRatio}
            muted={true}
            accent
          />
        </div>
      )}

      {/* shared playback controls */}
      <div className="mt-3 flex items-center gap-3 text-xs">
        <button
          onClick={togglePlay}
          className="rounded-full bg-white/15 px-3 py-1 font-medium hover:bg-white/25"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          onClick={() => {
            setMuted((m) => !m);
            const a = leftRef.current;
            if (a) a.muted = !a.muted;
          }}
          className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800"
        >
          {muted ? "Unmute" : "Mute"}
        </button>
        <a
          href={outputUrl}
          download
          className="ml-auto rounded border border-emerald-700 bg-emerald-900/20 px-2 py-0.5 text-emerald-300 hover:bg-emerald-900/40"
        >
          ↓ Download graded
        </a>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded border px-2 py-0.5",
        active
          ? "border-violet-400 bg-violet-500/15 text-violet-100"
          : "border-zinc-700 text-zinc-300 hover:bg-zinc-800",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

type CompareSideProps = {
  label: string;
  src: string;
  aspectRatio: string;
  muted: boolean;
  accent?: boolean;
};

const CompareSide = forwardRef<HTMLVideoElement, CompareSideProps>(
  function CompareSide({ label, src, aspectRatio, muted, accent }, ref) {
    return (
      <div className="space-y-1">
        <div
          className={[
            "relative overflow-hidden rounded-lg border bg-black",
            accent ? "border-violet-700" : "border-zinc-800",
          ].join(" ")}
          style={{ aspectRatio }}
        >
          <video
            ref={ref}
            src={src}
            className="absolute inset-0 h-full w-full object-contain"
            playsInline
            loop
            autoPlay
            muted={muted}
            preload="auto"
          />
        </div>
        <div
          className={[
            "text-center text-[11px] uppercase tracking-wider",
            accent ? "text-violet-300" : "text-zinc-400",
          ].join(" ")}
        >
          {label}
        </div>
      </div>
    );
  },
);
