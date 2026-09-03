"use client";

import { SuggestionHeader } from "@/components/onboarding/SuggestionHeader";
import {
  CORE_MODULE_LABELS,
  OPTIONAL_MODULE_LABELS,
  type ModulesTemplate,
} from "@/lib/onboarding-templates";

interface ModulesStepProps {
  value: ModulesTemplate;
  onChange: (patch: Partial<ModulesTemplate>) => void;
  coreModules: string[];
  edited: boolean;
  canRestore: boolean;
  onRestore: () => void;
}

const HINTS: Record<keyof ModulesTemplate, string> = {
  catalog:
    "Activa la lista de productos o servicios con precio. Sin catálogo no se piden categorías.",
  quotes: "Genera cotizaciones a partir de una oportunidad.",
  tasks: "Recordatorios y seguimientos comerciales por contacto.",
};

/**
 * Módulos que el producto ofrece HOY. Los centrales van siempre; los
 * opcionales se sugieren según el tipo de negocio y se pueden activar o
 * desactivar. No se inventa ninguna función que el sistema no tenga.
 */
export function ModulesStep({
  value,
  onChange,
  coreModules,
  edited,
  canRestore,
  onRestore,
}: ModulesStepProps) {
  const optional = Object.keys(OPTIONAL_MODULE_LABELS) as (keyof ModulesTemplate)[];

  return (
    <div>
      <SuggestionHeader
        title="Módulos"
        description="Elige lo que usará tu equipo. Puedes cambiarlo después dentro del CRM."
        edited={edited}
        canRestore={canRestore}
        onRestore={onRestore}
      />

      <div className="mt-6">
        <p className="mb-2 text-sm font-medium text-neutral-700">Incluidos siempre</p>
        <ul className="flex flex-wrap gap-2">
          {coreModules.map((key) => (
            <li
              key={key}
              className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-content-secondary"
            >
              {CORE_MODULE_LABELS[key] ?? key}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 space-y-2.5">
        <p className="text-sm font-medium text-neutral-700">Opcionales</p>
        {optional.map((key) => (
          <label
            key={key}
            className="flex cursor-pointer items-start justify-between gap-3 rounded-md border border-line-default bg-surface-default px-3.5 py-3 focus-within:ring-2 focus-within:ring-line-focus focus-within:ring-offset-1"
          >
            <span className="min-w-0">
              <span className="block text-sm text-content-primary">
                {OPTIONAL_MODULE_LABELS[key]}
              </span>
              <span className="block text-xs text-content-secondary">{HINTS[key]}</span>
            </span>
            <input
              type="checkbox"
              checked={value[key]}
              onChange={(e) => onChange({ [key]: e.target.checked })}
              className="mt-1 h-4 w-4 shrink-0 accent-brand-primary"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
