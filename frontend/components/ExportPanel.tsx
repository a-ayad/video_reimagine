"use client";

import { useState } from "react";

import { api, pollJob } from "@/lib/api";
import type { Job, VideoInfo } from "@/lib/types";

import type { LutChoice } from "./PresetGallery";

type Props = {
  video: VideoInfo;
  choice: LutChoice;
  /** Notified when a render finishes with the output URL + a human label. */
  onRenderComplete?: (outputUrl: string, label: string) => void;
};

export function ExportPanel({ video, choice, onRenderComplete }: Props) {
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onExport() {
    if (choice.kind === "none") {
      setError("Pick a look first.");
      return;
    }
    setError(null);
    setBusy(true);
    setJob(null);
    try {
      const payload =
        choice.kind === "preset"
          ? { video_id: video.id, preset_id: choice.preset.id }
          : { video_id: video.id, custom_lut_id: choice.lut.id };
      const started = await api.createRenderJob(payload);
      setJob(started);
      const finished = await pollJob(started.id, setJob);
      setJob(finished);
      if (finished.status === "failed") {
        setError(finished.error || "render failed");
      } else if (finished.status === "succeeded" && finished.output_url) {
        const label =
          choice.kind === "preset"
            ? choice.preset.name
            : choice.kind === "custom"
              ? choice.lut.name
              : "Graded";
        onRenderComplete?.(finished.output_url, label);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const label =
    choice.kind === "preset"
      ? choice.preset.name
      : choice.kind === "custom"
        ? choice.lut.name
        : "—";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="mb-2 flex items-center justify-between text-sm">
        <div className="font-medium">Export</div>
        <div className="text-xs text-zinc-400">selected: {label}</div>
      </div>
      <button
        onClick={onExport}
        disabled={busy || choice.kind === "none"}
        className="w-full rounded-md bg-violet-600 px-3 py-2 text-sm font-medium hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Rendering…" : "Render with FFmpeg"}
      </button>

      {job && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs text-zinc-400">
            <span>{job.status}</span>
            <span>{Math.round((job.progress || 0) * 100)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className={
                "h-full transition-[width] " +
                (job.status === "failed"
                  ? "bg-rose-500"
                  : job.status === "succeeded"
                    ? "bg-emerald-500"
                    : "bg-violet-500")
              }
              style={{ width: `${Math.round((job.progress || 0) * 100)}%` }}
            />
          </div>

          {job.status === "succeeded" && job.output_url && (
            <a
              href={job.output_url}
              download
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-400 hover:text-emerald-300"
            >
              ↓ Download {video.filename.replace(/\.[^.]+$/, "")}_graded.mp4
            </a>
          )}
        </div>
      )}

      {error && <div className="mt-2 text-xs text-rose-400">{error}</div>}
    </div>
  );
}
