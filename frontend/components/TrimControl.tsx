"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { VideoInfo } from "@/lib/types";

type Props = {
  video: VideoInfo;
  /** Current playhead position, in seconds (full-video coordinate). */
  currentTime: number;
  /** Called when the user finishes dragging — debounced PATCH lives here. */
  onChange: (video: VideoInfo) => void;
  /** Optional click on the timeline to seek the playhead. */
  onSeek?: (t: number) => void;
};

type Handle = "start" | "end" | "playhead" | null;

export function TrimControl({ video, currentTime, onChange, onSeek }: Props) {
  const duration = video.duration_seconds ?? 0;
  const trackRef = useRef<HTMLDivElement>(null);

  // Local UI state mirrors the server but updates instantly while dragging.
  const [start, setStart] = useState<number>(video.trim_start ?? 0);
  const [end, setEnd] = useState<number>(video.trim_end ?? duration);
  const [drag, setDrag] = useState<Handle>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync from server on any change (e.g. after PATCH or new video).
  useEffect(() => {
    setStart(video.trim_start ?? 0);
    setEnd(video.trim_end ?? duration);
  }, [video.id, video.trim_start, video.trim_end, duration]);

  const positionAt = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(duration, ratio * duration));
    },
    [duration],
  );

  // Mouse drag handlers (work for both thumbs and the playhead).
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      const x = "touches" in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
      const t = positionAt(x);
      if (drag === "start") {
        const next = Math.min(t, end - 0.05);
        setStart(Math.max(0, next));
      } else if (drag === "end") {
        const next = Math.max(t, start + 0.05);
        setEnd(Math.min(duration, next));
      } else if (drag === "playhead") {
        const clamped = Math.max(start, Math.min(end, t));
        onSeek?.(clamped);
      }
    };
    const onUp = async () => {
      const wasHandle = drag === "start" || drag === "end";
      setDrag(null);
      if (!wasHandle) return;
      // Persist trim to server.
      const newStart = start <= 0.001 ? null : start;
      const newEnd = end >= duration - 0.001 ? null : end;
      // If both are "no-op", clear trim.
      const clearAll = newStart === null && newEnd === null;
      try {
        setSaving(true);
        setError(null);
        const updated = await api.setTrim(
          video.id,
          clearAll ? null : start,
          clearAll ? null : end,
        );
        onChange(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [drag, start, end, duration, positionAt, video.id, onChange, onSeek]);

  const reset = useCallback(async () => {
    try {
      setSaving(true);
      setError(null);
      const updated = await api.setTrim(video.id, null, null);
      onChange(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [video.id, onChange]);

  if (duration <= 0) return null;

  const startPct = (start / duration) * 100;
  const endPct = (end / duration) * 100;
  const headPct = Math.max(0, Math.min(100, (currentTime / duration) * 100));
  const isTrimmed = start > 0.001 || end < duration - 0.001;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <div className="text-zinc-300">
          <span className="font-medium">Trim</span>
          <span className="ml-2 font-mono text-zinc-500">
            {fmt(start)} – {fmt(end)} ({fmt(end - start)} of {fmt(duration)})
          </span>
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-zinc-500">saving…</span>}
          {isTrimmed && (
            <button
              onClick={reset}
              className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800"
            >
              Use full clip
            </button>
          )}
        </div>
      </div>

      <div
        ref={trackRef}
        className="relative h-9 cursor-pointer select-none rounded-md bg-zinc-800/70"
        onMouseDown={(e) => {
          // click on the empty track moves the playhead, not a handle
          e.preventDefault();
          const t = positionAt(e.clientX);
          if (t < start || t > end) return;
          onSeek?.(t);
          setDrag("playhead");
        }}
      >
        {/* outside trim range: faded */}
        <div
          className="absolute inset-y-0 left-0 rounded-l-md bg-zinc-950/60"
          style={{ width: `${startPct}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 rounded-r-md bg-zinc-950/60"
          style={{ width: `${100 - endPct}%` }}
        />

        {/* active range tint */}
        <div
          className="absolute inset-y-0 bg-violet-500/15 ring-1 ring-violet-500/40"
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
        />

        {/* playhead */}
        <div
          className="absolute top-0 bottom-0 w-px bg-zinc-100"
          style={{ left: `${headPct}%` }}
        />
        <div
          className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-100 shadow"
          style={{ left: `${headPct}%` }}
        />

        {/* start handle */}
        <Handle
          x={startPct}
          color="bg-violet-400"
          onDown={(e) => {
            e.stopPropagation();
            setDrag("start");
          }}
          label="in"
        />
        {/* end handle */}
        <Handle
          x={endPct}
          color="bg-violet-400"
          onDown={(e) => {
            e.stopPropagation();
            setDrag("end");
          }}
          label="out"
        />
      </div>

      {error && <div className="mt-2 text-xs text-rose-400">{error}</div>}
    </div>
  );
}

function Handle({
  x,
  color,
  onDown,
  label,
}: {
  x: number;
  color: string;
  onDown: (e: React.MouseEvent | React.TouchEvent) => void;
  label: string;
}) {
  return (
    <div
      onMouseDown={onDown}
      onTouchStart={onDown}
      className="absolute top-0 bottom-0 z-10 flex w-2 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded-sm"
      style={{ left: `${x}%` }}
      aria-label={`Drag to set ${label}`}
    >
      <div className={`h-full w-1.5 rounded-sm ${color}`} />
    </div>
  );
}

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00.00";
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(2).padStart(5, "0")}`;
}
