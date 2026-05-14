"use client";

import { useRef, useState } from "react";

import { api, pollJob } from "@/lib/api";
import type { CustomLut, VideoInfo } from "@/lib/types";

type Props = {
  video: VideoInfo;
  onCreated: (lut: CustomLut) => void;
};

export function CustomLutPanel({ video, onCreated }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Reference must be an image (jpg/png).");
      return;
    }
    setError(null);
    setBusy(true);
    setStatus("uploading reference…");
    setPreviewUrl(URL.createObjectURL(file));
    try {
      const job = await api.generateCustomLut({
        reference: file,
        videoId: video.id,
        name: name.trim() || undefined,
      });
      setStatus("generating LUT…");
      const finished = await pollJob(job.id, (j) => {
        setStatus(`${j.status} (${Math.round((j.progress || 0) * 100)}%)`);
      });
      if (finished.status !== "succeeded" || !finished.custom_lut_id) {
        throw new Error(finished.error || "LUT generation failed");
      }
      const allCustom = await api.listCustomLuts();
      const created = allCustom.find((c) => c.id === finished.custom_lut_id);
      if (!created) throw new Error("LUT created but not found in list");
      setStatus("done.");
      onCreated(created);
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium">Match a reference image</div>
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
          AI custom look
        </div>
      </div>
      <p className="mb-3 text-xs text-zinc-400">
        Drop in a frame from a film or any photo with a color palette you like.
        We&rsquo;ll generate a custom <code>.cube</code> LUT that pushes your
        video&rsquo;s colors toward it.
      </p>

      <div className="flex items-center gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Optional name (e.g. Blade Runner)"
          disabled={busy}
          className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Working…" : "Pick image"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="visually-hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </div>

      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt="reference"
          className="mt-3 max-h-32 rounded-md border border-zinc-800 object-contain"
        />
      )}

      {status && <div className="mt-2 text-xs text-zinc-400">{status}</div>}
      {error && <div className="mt-2 text-xs text-rose-400">{error}</div>}
    </div>
  );
}
