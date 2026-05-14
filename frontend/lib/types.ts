export type Preset = {
  id: string;
  name: string;
  description: string;
  cube_url: string;
  swatch: string[];
};

export type VideoInfo = {
  id: string;
  filename: string;
  size_bytes: number;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  trim_start: number | null;
  trim_end: number | null;
  stream_url: string;
  created_at: string;
};

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type Job = {
  id: string;
  kind: string;
  status: JobStatus;
  progress: number;
  error: string | null;
  video_id: string | null;
  preset_id: string | null;
  custom_lut_id: string | null;
  output_url: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type CustomLut = {
  id: string;
  name: string;
  cube_url: string;
  created_at: string;
};
