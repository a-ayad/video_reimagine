import type { CustomLut, Job, Preset, VideoInfo } from "./types";

async function jfetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).detail ?? "";
    } catch {
      detail = await res.text();
    }
    throw new Error(`${res.status} ${res.statusText} ${detail}`.trim());
  }
  return res.json() as Promise<T>;
}

export const api = {
  listPresets: () => jfetch<Preset[]>("/api/luts/presets"),
  listCustomLuts: () => jfetch<CustomLut[]>("/api/luts/custom"),

  uploadVideo: async (file: File): Promise<VideoInfo> => {
    const fd = new FormData();
    fd.append("file", file);
    return jfetch<VideoInfo>("/api/uploads/video", { method: "POST", body: fd });
  },

  getVideo: (id: string) => jfetch<VideoInfo>(`/api/videos/${id}`),

  setTrim: (id: string, trim_start: number | null, trim_end: number | null) =>
    jfetch<VideoInfo>(`/api/videos/${id}/trim`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trim_start, trim_end }),
    }),

  generateCustomLut: async (params: {
    reference: File;
    videoId?: string;
    name?: string;
  }): Promise<Job> => {
    const fd = new FormData();
    fd.append("reference", params.reference);
    if (params.videoId) fd.append("video_id", params.videoId);
    if (params.name) fd.append("name", params.name);
    return jfetch<Job>("/api/luts/generate", { method: "POST", body: fd });
  },

  createRenderJob: (payload: {
    video_id: string;
    preset_id?: string;
    custom_lut_id?: string;
  }) =>
    jfetch<Job>("/api/jobs/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),

  getJob: (jobId: string) => jfetch<Job>(`/api/jobs/${jobId}`),
};

export async function pollJob(
  jobId: string,
  onUpdate: (job: Job) => void,
  intervalMs = 800,
): Promise<Job> {
  while (true) {
    const job = await api.getJob(jobId);
    onUpdate(job);
    if (job.status === "succeeded" || job.status === "failed") return job;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
