"use client";

import { useId, useState } from "react";

import type { VideoInfo } from "@/lib/types";

type Props = {
  onUploaded: (video: VideoInfo) => void;
};

export function Uploader({ onUploaded }: Props) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);

  async function handleFile(file: File) {
    setPickedName(file.name);
    if (!file.type.startsWith("video/") && !/\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name)) {
      setError(`not a video file: ${file.type || file.name || "unknown"}`);
      return;
    }
    setError(null);
    setUploading(true);
    setProgress(0);
    try {
      const video = await uploadWithProgress(file, setProgress);
      onUploaded(video);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        className={[
          "flex h-72 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition-colors",
          dragging
            ? "border-violet-400 bg-violet-500/10"
            : "border-zinc-700 bg-zinc-900/40 hover:bg-zinc-900/70",
        ].join(" ")}
      >
        {uploading ? (
          <div className="flex w-2/3 flex-col items-center gap-3">
            <div className="text-sm text-zinc-300">
              Uploading {pickedName ? `“${pickedName}”` : "…"}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full bg-violet-500 transition-[width]"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <div className="font-mono text-xs text-zinc-500">
              {Math.round(progress * 100)}%
            </div>
          </div>
        ) : (
          <>
            <div className="text-lg font-medium">
              Drop a video here, or click to browse
            </div>
            <div className="mt-2 text-sm text-zinc-400">
              MP4 · MOV · WebM · MKV up to 500 MB
            </div>
            {pickedName && !error && (
              <div className="mt-3 text-xs text-zinc-500">
                last picked: {pickedName}
              </div>
            )}
          </>
        )}
      </label>

      <input
        id={inputId}
        type="file"
        accept="video/*,.mkv,.m4v"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          // reset so picking the same file twice still fires onChange
          e.target.value = "";
        }}
      />

      {error && (
        <div className="rounded-md border border-rose-700 bg-rose-900/20 p-2 text-sm text-rose-200">
          {error}
        </div>
      )}
    </div>
  );
}

function uploadWithProgress(
  file: File,
  onProgress: (p: number) => void,
): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads/video");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error("network error reaching /api/uploads/video"));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      } else {
        let msg = `${xhr.status} ${xhr.statusText}`;
        try {
          const d = JSON.parse(xhr.responseText);
          if (d && d.detail) msg += ` — ${d.detail}`;
        } catch {
          if (xhr.responseText) msg += ` — ${xhr.responseText.slice(0, 200)}`;
        }
        reject(new Error(msg));
      }
    };
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}
