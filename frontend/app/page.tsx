"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CompareView } from "@/components/CompareView";
import { CustomLutPanel } from "@/components/CustomLutPanel";
import { ExportPanel } from "@/components/ExportPanel";
import { PresetGallery, type LutChoice } from "@/components/PresetGallery";
import { Preview, type PreviewHandle } from "@/components/Preview";
import { TrimControl } from "@/components/TrimControl";
import { Uploader } from "@/components/Uploader";
import { api } from "@/lib/api";
import type { CustomLut, Preset, VideoInfo } from "@/lib/types";

export default function Page() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [customLuts, setCustomLuts] = useState<CustomLut[]>([]);
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [choice, setChoice] = useState<LutChoice>({ kind: "none" });
  const [intensity, setIntensity] = useState(1);
  const [splitEnabled, setSplitEnabled] = useState(true);
  const [splitPos, setSplitPos] = useState(0.5);
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [comparison, setComparison] = useState<{ url: string; label: string } | null>(
    null,
  );

  const previewRef = useRef<PreviewHandle | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [ps, cs] = await Promise.all([
          api.listPresets(),
          api.listCustomLuts(),
        ]);
        setPresets(ps);
        setCustomLuts(cs);
      } catch (e) {
        setBootErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const cubeUrl = useMemo<string | null>(() => {
    if (choice.kind === "preset") return choice.preset.cube_url;
    if (choice.kind === "custom") return choice.lut.cube_url;
    return null;
  }, [choice]);

  const effectiveIntensity = choice.kind === "none" ? 0 : intensity;

  const duration = video?.duration_seconds ?? 0;
  const trimStart = video?.trim_start ?? 0;
  const trimEnd = video?.trim_end ?? duration;

  const handleSeek = useCallback((t: number) => {
    previewRef.current?.seekTo(t);
    setCurrentTime(t);
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          video_reimagine
        </h1>
        <div className="text-xs text-zinc-500">
          local · WebGPU preview · FFmpeg export
        </div>
      </header>

      {bootErr && (
        <div className="mb-4 rounded-md border border-rose-700 bg-rose-900/20 p-3 text-sm text-rose-200">
          Backend unreachable: {bootErr}
        </div>
      )}

      {!video ? (
        <div className="mx-auto max-w-2xl">
          <Uploader onUploaded={setVideo} />
          <p className="mt-4 text-center text-xs text-zinc-500">
            Files stay on this machine. Nothing is uploaded to any external service.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <Preview
              ref={previewRef}
              video={video}
              cubeUrl={choice.kind === "none" ? null : cubeUrl}
              intensity={effectiveIntensity}
              splitEnabled={splitEnabled && choice.kind !== "none"}
              splitPos={splitPos}
              trimStart={trimStart}
              trimEnd={trimEnd}
              onTimeUpdate={setCurrentTime}
            />

            <TrimControl
              video={video}
              currentTime={currentTime}
              onChange={setVideo}
              onSeek={handleSeek}
            />

            <div className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 sm:grid-cols-3">
              <ControlSlider
                label="Intensity"
                value={intensity}
                onChange={setIntensity}
                disabled={choice.kind === "none"}
              />
              <div className="flex flex-col gap-2 text-sm">
                <label className="flex items-center gap-2 text-zinc-300">
                  <input
                    type="checkbox"
                    checked={splitEnabled}
                    onChange={(e) => setSplitEnabled(e.target.checked)}
                    className="accent-violet-500"
                  />
                  Split before/after
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.001}
                  value={splitPos}
                  disabled={!splitEnabled || choice.kind === "none"}
                  onChange={(e) => setSplitPos(Number(e.target.value))}
                  className="accent-violet-500 disabled:opacity-40"
                />
              </div>
              <div className="flex items-end justify-end">
                <button
                  onClick={() => {
                    setVideo(null);
                    setChoice({ kind: "none" });
                    setCurrentTime(0);
                    setComparison(null);
                  }}
                  className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  Use a different video
                </button>
              </div>
            </div>

            {comparison && (
              <CompareView
                video={video}
                outputUrl={comparison.url}
                outputLabel={comparison.label}
                onClose={() => setComparison(null)}
              />
            )}

            <CustomLutPanel
              video={video}
              onCreated={(lut) => {
                setCustomLuts((prev) => [lut, ...prev]);
                setChoice({ kind: "custom", lut });
              }}
            />
          </div>

          <aside className="space-y-4">
            <PresetGallery
              presets={presets}
              customLuts={customLuts}
              selected={choice}
              onSelect={setChoice}
            />
            <ExportPanel
              video={video}
              choice={choice}
              onRenderComplete={(url, label) => setComparison({ url, label })}
            />
          </aside>
        </div>
      )}
    </div>
  );
}

function ControlSlider({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex justify-between text-zinc-400">
        <span>{label}</span>
        <span className="font-mono text-zinc-500">{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-violet-500 disabled:opacity-40"
      />
    </div>
  );
}
