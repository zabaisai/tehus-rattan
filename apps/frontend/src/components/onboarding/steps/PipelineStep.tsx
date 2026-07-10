"use client";

import { Plus, Trash2 } from "lucide-react";

export interface PipelineState {
  name: string;
  stages: string[];
}

interface PipelineStepProps {
  value: PipelineState;
  onChange: (patch: Partial<PipelineState>) => void;
}

export function PipelineStep({ value, onChange }: PipelineStepProps) {
  function updateStage(index: number, name: string) {
    const stages = [...value.stages];
    stages[index] = name;
    onChange({ stages });
  }

  function addStage() {
    onChange({ stages: [...value.stages, ""] });
  }

  function removeStage(index: number) {
    if (value.stages.length <= 1) return;
    onChange({ stages: value.stages.filter((_, i) => i !== index) });
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-[#0B0F10]">Pipeline inicial</h3>
      <p className="mt-1.5 text-sm text-[#0B0F10]/70">
        Define las etapas por las que pasa un lead en tu proceso de venta.
        Puedes ajustarlas después dentro del CRM.
      </p>

      <div className="mt-6">
        <label className="mb-1.5 block text-xs font-medium text-[#0B0F10]/70">
          Nombre del pipeline *
        </label>
        <input
          type="text"
          required
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="w-full rounded-md border border-[#0B0F10]/15 px-3 py-2.5 text-sm outline-none focus:border-[#A57014] focus:ring-1 focus:ring-[#A57014]"
        />
      </div>

      <div className="mt-5">
        <label className="mb-2 block text-xs font-medium text-[#0B0F10]/70">
          Etapas *
        </label>
        <div className="space-y-2">
          {value.stages.map((stage, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F4EFE6] text-xs font-medium text-[#0B0F10]/60">
                {index + 1}
              </span>
              <input
                type="text"
                required
                value={stage}
                onChange={(e) => updateStage(index, e.target.value)}
                placeholder="Nombre de la etapa"
                className="w-full rounded-md border border-[#0B0F10]/15 px-3 py-2 text-sm outline-none focus:border-[#A57014] focus:ring-1 focus:ring-[#A57014]"
              />
              <button
                type="button"
                onClick={() => removeStage(index)}
                disabled={value.stages.length <= 1}
                className="shrink-0 rounded-md p-2 text-[#0B0F10]/40 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#0B0F10]/40"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addStage}
          className="mt-3 flex items-center gap-1.5 rounded-md border border-dashed border-[#0B0F10]/20 px-3 py-2 text-xs font-medium text-[#0B0F10]/70 hover:bg-[#F4EFE6]"
        >
          <Plus size={14} /> Agregar etapa
        </button>
      </div>
    </div>
  );
}
