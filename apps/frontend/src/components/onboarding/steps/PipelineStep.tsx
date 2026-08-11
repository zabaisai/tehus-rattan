"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

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
      <h3 className="text-lg font-semibold text-content-primary">
        Pipeline inicial
      </h3>
      <p className="mt-1.5 text-sm text-content-secondary">
        Define las etapas por las que pasa un lead en tu proceso de venta.
        Puedes ajustarlas después dentro del CRM.
      </p>

      <Field label="Nombre del pipeline" required className="mt-6">
        <Input
          type="text"
          required
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </Field>

      <div className="mt-5">
        <p className="mb-2 block text-sm font-medium text-neutral-700">
          Etapas
          <span aria-hidden="true" className="ml-0.5 text-status-error">
            *
          </span>
        </p>

        <div className="space-y-2">
          {value.stages.map((stage, index) => (
            <div key={index} className="flex items-center gap-2">
              {/* El número ya está en la etiqueta del campo; repetirlo en voz
                  alta solo alarga la lectura. */}
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-medium text-content-secondary"
              >
                {index + 1}
              </span>

              {/* Etiqueta oculta y no solo `placeholder`: el marcador de
                  posición desaparece al escribir y no es un nombre accesible,
                  así que sin esto el campo se anuncia como "cuadro de edición"
                  sin decir cuál de las etapas es. */}
              <Field
                label={`Etapa ${index + 1}`}
                labelOculta
                className="w-full"
              >
                <Input
                  type="text"
                  required
                  value={stage}
                  onChange={(e) => updateStage(index, e.target.value)}
                  placeholder="Nombre de la etapa"
                />
              </Field>

              <Button
                variant="quiet"
                onClick={() => removeStage(index)}
                disabled={value.stages.length <= 1}
                aria-label={`Quitar etapa ${index + 1}`}
                className="shrink-0 p-2 hover:bg-status-error-surface hover:text-status-error"
              >
                <Trash2 size={15} aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={addStage}
          className="mt-3 border-dashed"
        >
          <Plus size={14} aria-hidden="true" /> Agregar etapa
        </Button>
      </div>
    </div>
  );
}
