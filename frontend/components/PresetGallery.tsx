"use client";

import type { CustomLut, Preset } from "@/lib/types";

export type LutChoice =
  | { kind: "preset"; preset: Preset }
  | { kind: "custom"; lut: CustomLut }
  | { kind: "none" };

type Props = {
  presets: Preset[];
  customLuts: CustomLut[];
  selected: LutChoice;
  onSelect: (choice: LutChoice) => void;
};

export function PresetGallery({ presets, customLuts, selected, onSelect }: Props) {
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-xs uppercase tracking-wider text-zinc-400">
          Looks
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <PillNone
            active={selected.kind === "none"}
            onClick={() => onSelect({ kind: "none" })}
          />
          {presets.map((p) => (
            <PresetTile
              key={p.id}
              preset={p}
              active={selected.kind === "preset" && selected.preset.id === p.id}
              onClick={() => onSelect({ kind: "preset", preset: p })}
            />
          ))}
        </div>
      </div>

      {customLuts.length > 0 && (
        <div>
          <div className="mb-2 text-xs uppercase tracking-wider text-zinc-400">
            Your custom looks
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {customLuts.map((c) => (
              <CustomTile
                key={c.id}
                lut={c}
                active={selected.kind === "custom" && selected.lut.id === c.id}
                onClick={() => onSelect({ kind: "custom", lut: c })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PillNone({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex h-20 flex-col items-center justify-center rounded-lg border text-sm transition-colors",
        active
          ? "border-violet-400 bg-violet-500/10 text-violet-100"
          : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:bg-zinc-800",
      ].join(" ")}
    >
      <div className="font-medium">Original</div>
      <div className="mt-1 text-[10px] text-zinc-500">no grading</div>
    </button>
  );
}

function PresetTile({
  preset,
  active,
  onClick,
}: {
  preset: Preset;
  active: boolean;
  onClick: () => void;
}) {
  const grad = `linear-gradient(135deg, ${preset.swatch.join(", ")})`;
  return (
    <button
      onClick={onClick}
      title={preset.description}
      className={[
        "group flex h-20 flex-col items-stretch overflow-hidden rounded-lg border text-left transition-colors",
        active
          ? "border-violet-400 ring-2 ring-violet-400/40"
          : "border-zinc-800 hover:border-zinc-600",
      ].join(" ")}
    >
      <div className="h-10 w-full" style={{ background: grad }} />
      <div className="flex flex-1 items-center px-2 text-xs">
        <span className="line-clamp-1 font-medium text-zinc-200">
          {preset.name}
        </span>
      </div>
    </button>
  );
}

function CustomTile({
  lut,
  active,
  onClick,
}: {
  lut: CustomLut;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "group flex h-20 flex-col items-stretch overflow-hidden rounded-lg border text-left transition-colors",
        active
          ? "border-emerald-400 ring-2 ring-emerald-400/40"
          : "border-zinc-800 hover:border-zinc-600",
      ].join(" ")}
    >
      <div className="h-10 w-full bg-gradient-to-br from-emerald-500/50 via-cyan-500/50 to-violet-500/50" />
      <div className="flex flex-1 items-center px-2 text-xs">
        <span className="line-clamp-1 font-medium text-zinc-200">{lut.name}</span>
      </div>
    </button>
  );
}
