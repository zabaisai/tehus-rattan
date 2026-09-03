"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { SuggestionHeader } from "@/components/onboarding/SuggestionHeader";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  STAGE_TYPE_LABELS,
  type StageTemplate,
  type StageType,
} from "@/lib/onboarding-templates";

export interface PipelineState {
  name: string;
  stages: StageTemplate[];
}

interface PipelineStepProps {
  value: PipelineState;
  onChange: (patch: Partial<PipelineState>) => void;
  limits: { maxNameLength: number; maxCount: number };
  edited: boolean;
  canRestore: boolean;
  onRestore: () => void;
}

const TYPES: StageType[] = ["OPEN", "WON", "LOST"];

/**
 * Invariantes que también exige el backend (`validateTypedStages`): al menos
 * una etapa abierta, exactamente una de cierre ganado y una de cierre
 * perdido, nombres únicos y no vacíos. Se comprueban aquí para avisar junto
 * al campo antes de enviar; el servidor vuelve a comprobarlas.
 */
export function validatePipeline(
  value: PipelineState,
  limits: { maxNameLength: number; maxCount: number },
): string | null {
  if (!value.name.trim()) return "El nombre del pipeline es requerido.";
  const stages = value.stages;
  if (stages.length === 0) return "El pipeline debe tener al menos una etapa.";
  if (stages.length > limits.maxCount) {
    return `El pipeline admite como máximo ${limits.maxCount} etapas.`;
  }
  const seen = new Set<string>();
  let open = 0;
  let won = 0;
  let lost = 0;
  for (const stage of stages) {
    const name = stage.name.replace(/\s+/g, " ").trim();
    if (!name) return "Cada etapa debe tener nombre.";
    if (name.length > limits.maxNameLength) {
      return `Cada etapa debe tener como máximo ${limits.maxNameLength} caracteres.`;
    }
    const key = name.toLocaleLowerCase("es");
    if (seen.has(key)) return `La etapa "${name}" está repetida.`;
    seen.add(key);
    if (stage.type === "WON") won++;
    else if (stage.type === "LOST") lost++;
    else open++;
  }
  if (open < 1) return "Debe haber al menos una etapa abierta.";
  if (won !== 1) return "Debe haber exactamente una etapa de cierre ganado.";
  if (lost !== 1) return "Debe haber exactamente una etapa de cierre perdido.";
  return null;
}

export function PipelineStep({
  value,
  onChange,
  limits,
  edited,
  canRestore,
  onRestore,
}: PipelineStepProps) {
  function updateStage(index: number, patch: Partial<StageTemplate>) {
    onChange({
      stages: value.stages.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    });
  }

  function addStage() {
    if (value.stages.length >= limits.maxCount) return;
    // La nueva etapa entra ANTES de los cierres, que van siempre al final.
    const firstClose = value.stages.findIndex((s) => s.type !== "OPEN");
    const at = firstClose === -1 ? value.stages.length : firstClose;
    const stages = [...value.stages];
    stages.splice(at, 0, { name: "", type: "OPEN" });
    onChange({ stages });
  }

  function removeStage(index: number) {
    if (value.stages.length <= 1) return;
    onChange({ stages: value.stages.filter((_, i) => i !== index) });
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= value.stages.length) return;
    const stages = [...value.stages];
    [stages[index], stages[target]] = [stages[target], stages[index]];
    onChange({ stages });
  }

  return (
    <div>
      <SuggestionHeader
        title="Pipeline inicial"
        description="Las etapas por las que pasa una oportunidad. Necesita al menos una abierta, una de cierre ganado y una de cierre perdido."
        edited={edited}
        canRestore={canRestore}
        onRestore={onRestore}
      />

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

        <ol className="space-y-2">
          {value.stages.map((stage, index) => (
            <li
              key={index}
              className="flex flex-col gap-2 rounded-md border border-line-default bg-surface-default p-2 sm:flex-row sm:items-center"
            >
              <span
                aria-hidden="true"
                className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-medium text-content-secondary sm:flex"
              >
                {index + 1}
              </span>

              <Field label={`Nombre de la etapa ${index + 1}`} labelOculta className="w-full">
                <Input
                  type="text"
                  required
                  maxLength={limits.maxNameLength}
                  value={stage.name}
                  onChange={(e) => updateStage(index, { name: e.target.value })}
                  placeholder={`Etapa ${index + 1}`}
                />
              </Field>

              <Field label={`Tipo de la etapa ${index + 1}`} labelOculta className="w-full sm:w-44">
                <Select
                  value={stage.type}
                  onChange={(e) => updateStage(index, { type: e.target.value as StageType })}
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {STAGE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Subir etapa ${index + 1}`}
                  className="p-2"
                >
                  <ArrowUp size={14} aria-hidden="true" />
                </Button>
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => move(index, 1)}
                  disabled={index === value.stages.length - 1}
                  aria-label={`Bajar etapa ${index + 1}`}
                  className="p-2"
                >
                  <ArrowDown size={14} aria-hidden="true" />
                </Button>
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => removeStage(index)}
                  disabled={value.stages.length <= 1}
                  aria-label={`Quitar etapa ${index + 1}`}
                  className="p-2 hover:bg-status-error-surface hover:text-status-error"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ol>

        <Button
          variant="secondary"
          size="sm"
          onClick={addStage}
          disabled={value.stages.length >= limits.maxCount}
          className="mt-3 border-dashed"
        >
          <Plus size={14} aria-hidden="true" /> Agregar etapa
        </Button>
        <p className="mt-2 text-xs text-content-secondary">
          {value.stages.length} de {limits.maxCount} etapas.
        </p>
      </div>
    </div>
  );
}
