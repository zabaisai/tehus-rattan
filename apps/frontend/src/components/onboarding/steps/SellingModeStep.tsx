"use client";

import { Badge } from "@/components/ui/Badge";
import type { BusinessModel } from "@/lib/onboarding-templates";

interface SellingModeStepProps {
  value: BusinessModel;
  /** Lo que la industria elegida suele hacer. */
  recommended: BusinessModel;
  onChange: (model: BusinessModel) => void;
}

const OPTIONS: Array<{ model: BusinessModel; title: string; description: string }> = [
  {
    model: "products",
    title: "Solo productos",
    description: "Artículos físicos o digitales con precio, como muebles, alimentos o repuestos.",
  },
  {
    model: "services",
    title: "Solo servicios",
    description: "Tiempo o trabajo que se cotiza y agenda: consultas, instalación, soporte, asesoría.",
  },
  {
    model: "mixed",
    title: "Productos y servicios",
    description: "Ambas cosas en el mismo catálogo, por ejemplo vender el mueble e instalarlo.",
  },
];

/**
 * «¿Qué vendes?» en palabras de negocio, sin términos técnicos. Alimenta las
 * banderas comerciales de la empresa (Fase 2) y afina la plantilla que se
 * recomienda en el paso siguiente.
 */
export function SellingModeStep({ value, recommended, onChange }: SellingModeStepProps) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-content-primary">¿Qué vendes?</h3>
      <p className="mt-1.5 text-sm text-content-secondary">
        Con esto decidimos si tu catálogo lleva productos, servicios o ambos. Lo puedes cambiar
        después en Configuración → Empresa.
      </p>

      <fieldset className="mt-6">
        <legend className="sr-only">Forma de vender</legend>
        <div className="grid grid-cols-1 gap-2">
          {OPTIONS.map((option) => {
            const selected = value === option.model;
            return (
              <label
                key={option.model}
                className={`flex cursor-pointer items-start gap-3 rounded-md border px-3.5 py-3 transition-colors motion-reduce:transition-none focus-within:ring-2 focus-within:ring-line-focus focus-within:ring-offset-1 ${
                  selected
                    ? "border-brand-primary bg-primary-50"
                    : "border-line-default bg-surface-default hover:bg-neutral-50"
                }`}
              >
                <input
                  type="radio"
                  name="sellingMode"
                  value={option.model}
                  checked={selected}
                  onChange={() => onChange(option.model)}
                  className="mt-1 h-4 w-4 shrink-0 accent-brand-primary"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-content-primary">
                    {option.title}
                    {option.model === recommended && <Badge tone="info">Recomendado</Badge>}
                  </span>
                  <span className="block text-xs text-content-secondary">{option.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
