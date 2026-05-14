"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { fetchCube } from "@/lib/cube";
import type { VideoInfo } from "@/lib/types";
import { createLutPipeline, type LutPipeline } from "@/lib/webgpu/lut-pipeline";

export type PreviewHandle = {
  seekTo: (t: number) => void;
  play: () => void;
  pause: () => void;
};

type Props = {
  video: VideoInfo;
  cubeUrl: string | null;
  intensity: number;
  splitEnabled: boolean;
  splitPos: number;
  /** Trim window — playback loops within [trimStart, trimEnd]. */
  trimStart: number;
  trimEnd: number;
  /** Notified on every video timeupdate so siblings (TrimControl) can react. */
  onTimeUpdate?: (t: number) => void;
};

export const Preview = forwardRef<PreviewHandle, Props>(function Preview(
  {
    video,
    cubeUrl,
    intensity,
    splitEnabled,
    splitPos,
    trimStart,
    trimEnd,
    onTimeUpdate,
  },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pipelineRef = useRef<LutPipeline | null>(null);
  const rafRef = useRef<number>(0);

  const trimStartRef = useRef(trimStart);
  const trimEndRef = useRef(trimEnd);
  trimStartRef.current = trimStart;
  trimEndRef.current = trimEnd;

  const [webgpuError, setWebgpuError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [bootStatus, setBootStatus] = useState<string>("Loading video…");

  useImperativeHandle(
    ref,
    () => ({
      seekTo(t: number) {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = Math.max(trimStartRef.current, Math.min(trimEndRef.current, t));
      },
      play() {
        void videoRef.current?.play();
      },
      pause() {
        videoRef.current?.pause();
      },
    }),
    [],
  );

  // Boot the WebGPU pipeline once the video has a decoded first frame.
  useEffect(() => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;

    let cancelled = false;
    let pipeline: LutPipeline | null = null;

    setReady(false);
    setBootStatus("Loading video…");

    // Helper: wait for HAVE_CURRENT_DATA so importExternalTexture has frames.
    const waitForFrame = () =>
      new Promise<void>((resolve) => {
        if (v.readyState >= 2) {
          resolve();
          return;
        }
        const onLoaded = () => {
          v.removeEventListener("loadeddata", onLoaded);
          v.removeEventListener("canplay", onLoaded);
          resolve();
        };
        v.addEventListener("loadeddata", onLoaded);
        v.addEventListener("canplay", onLoaded);
      });

    const boot = async () => {
      // Force the browser to kick off loading even with a paused, hidden element.
      v.load();
      await waitForFrame();
      if (cancelled) return;

      // Some browsers don't decode the very first frame until you seek into the
      // video. A tiny seek forces decode without visibly moving the playhead.
      if (v.currentTime === 0 && Number.isFinite(v.duration)) {
        v.currentTime = 0.001;
        await new Promise<void>((res) => {
          const onSeeked = () => {
            v.removeEventListener("seeked", onSeeked);
            res();
          };
          v.addEventListener("seeked", onSeeked);
          // Belt-and-braces timeout in case the seeked event never fires.
          setTimeout(() => res(), 400);
        });
      }
      if (cancelled) return;

      setBootStatus("Initialising WebGPU…");
      c.width = v.videoWidth || 1920;
      c.height = v.videoHeight || 1080;

      try {
        pipeline = await createLutPipeline({ canvas: c, video: v });
      } catch (e) {
        if (!cancelled) {
          setWebgpuError(e instanceof Error ? e.message : String(e));
        }
        return;
      }
      if (cancelled) {
        pipeline?.destroy();
        return;
      }
      pipelineRef.current = pipeline;
      setReady(true);
      schedule();
    };

    function schedule() {
      // Always redraw on rAF — keeps the canvas live whether or not the
      // video is currently presenting new frames.
      const drawOnce = () => {
        if (cancelled) return;
        pipeline?.draw();
        rafRef.current = requestAnimationFrame(drawOnce);
      };
      drawOnce();
    }

    void boot();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      pipeline?.destroy();
      pipelineRef.current = null;
    };
  }, [video.id]);

  // Load the LUT into the pipeline whenever cubeUrl changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = pipelineRef.current;
      if (!p || !cubeUrl) return;
      try {
        const cube = await fetchCube(cubeUrl);
        if (cancelled) return;
        p.setLut(cube);
      } catch (e) {
        console.error("failed to load cube", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cubeUrl, ready]);

  useEffect(() => {
    pipelineRef.current?.setIntensity(intensity);
  }, [intensity]);

  useEffect(() => {
    pipelineRef.current?.setSplit(splitEnabled, splitPos);
  }, [splitEnabled, splitPos]);

  // Snap playback into the trim window when trim changes (only for valid windows).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!Number.isFinite(trimEnd) || trimEnd <= trimStart + 0.05) return;
    if (v.currentTime < trimStart || v.currentTime > trimEnd) {
      v.currentTime = trimStart;
    }
  }, [trimStart, trimEnd]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      const ts0 = trimStartRef.current;
      const ts1 = trimEndRef.current;
      if (Number.isFinite(ts1) && ts1 > ts0 + 0.05) {
        if (v.currentTime >= ts1 - 0.02) {
          v.currentTime = ts0;
        } else if (v.currentTime < ts0 - 0.02) {
          v.currentTime = ts0;
        }
      }
      onTimeUpdate?.(v.currentTime);
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [onTimeUpdate]);

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl border border-zinc-800 bg-black"
      style={{
        aspectRatio:
          video.width && video.height ? `${video.width}/${video.height}` : "16/9",
      }}
    >
      {/*
        Source video sits BEHIND the canvas so the browser keeps the element
        in layout (and therefore decodes frames). Once WebGPU starts drawing,
        the canvas covers it. We don't use display:none / visually-hidden
        because some browsers stop decoding for invisible <video> elements,
        which leaves importExternalTexture with no frame to import.
      */}
      <video
        ref={videoRef}
        src={video.stream_url}
        loop
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 h-full w-full object-contain"
        aria-hidden
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full"
      />

      {!ready && !webgpuError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-zinc-300">
          {bootStatus}
        </div>
      )}
      {webgpuError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/85 p-4 text-center text-sm text-rose-200">
          <div>
            <div className="font-medium">WebGPU not available</div>
            <div className="mt-1 text-xs text-zinc-400">{webgpuError}</div>
            <div className="mt-3 text-xs text-zinc-400">
              You can still render server-side &mdash; the live preview just won&rsquo;t work.
            </div>
          </div>
        </div>
      )}

      <PlayBar videoRef={videoRef} trimStart={trimStart} trimEnd={trimEnd} />
    </div>
  );
});

function PlayBar({
  videoRef,
  trimStart,
  trimEnd,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  trimStart: number;
  trimEnd: number;
}) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(trimStart);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setTime(v.currentTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
    };
  }, [videoRef]);

  const span = Math.max(0.001, trimEnd - trimStart);
  const local = Math.max(0, Math.min(span, time - trimStart));

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-3 bg-gradient-to-t from-black/80 to-transparent px-4 py-3">
      <button
        onClick={() => {
          const v = videoRef.current;
          if (!v) return;
          if (v.paused) {
            if (v.currentTime < trimStart || v.currentTime >= trimEnd) {
              v.currentTime = trimStart;
            }
            void v.play();
          } else v.pause();
        }}
        className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium hover:bg-white/25"
      >
        {playing ? "Pause" : "Play"}
      </button>
      <input
        type="range"
        min={0}
        max={span}
        step={0.01}
        value={local}
        onChange={(e) => {
          const v = videoRef.current;
          if (v) v.currentTime = trimStart + Number(e.target.value);
        }}
        className="flex-1 accent-violet-500"
      />
      <div className="font-mono text-xs text-zinc-300">
        {fmt(local)} / {fmt(span)}
      </div>
    </div>
  );
}

function fmt(s: number): string {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
