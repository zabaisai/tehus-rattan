"use client";

import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import {
  BUSINESS_MODEL_LABELS,
  OPTIONAL_MODULE_LABELS,
  STAGE_TYPE_LABELS,
  type BusinessModel,
  type BusinessTypeTemplate,
  type IndustryTemplate,
  type ModulesTemplate,
} from "@/lib/onboarding-templates";
import { recommendationReason } from "@/lib/onboarding-wizard";

interface RecommendationStepProps {
  industry: IndustryTemplate | undefined;
  /** Plantilla actualmente elegida (puede ser la recomendada o otra). */
  selected: BusinessTypeTemplate | undefined;
  recommended: BusinessTypeTemplate | undefined;
  model: BusinessModel;
  customBusinessType: string;
  businessTypeMaxLength: number;
  /** Alguna sección (modelo, módulos, categorías o etapas) ya fue editada. */
  anyEdited: boolean;
  onSelectType: (key: string) => void;
  onCustomBusinessTypeChange: (text: string) => void;
  onResetAll: () => void;
}

/**
 * La recomendación EXPLICADA: qué plantilla proponemos, por qué, y qué
 * módulos, categorías y etapas trae. Nada se selecciona en silencio: la
 * persona la usa, elige otra o configura a mano, y todo sigue siendo editable
 * en los pasos siguientes.
 */
export function RecommendationStep({
  industry,
  selected,
  recommended,
  model,
  customBusinessType,
  businessTypeMaxLength,
  anyEdited,
  onSelectType,
  onCustomBusinessTypeChange,
  onResetAll,
}: RecommendationStepProps) {
  const types = industry?.businessTypes ?? [];
  const current = selected ?? recommended;
  const optional = (Object.keys(OPTIONAL_MODULE_LABELS) as (keyof ModulesTemplate)[]).filter(
    (k) => current?.modules[k],
  );

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-content-primary">Nuestra recomendación</h3>
          <p className="mt-1.5 text-sm text-content-secondary">
            Es un punto de partida, no una imposición: cada bloque se puede cambiar en los pasos
            siguientes.
          </p>
        </div>
        {anyEdited && (
          <Button variant="quiet" size="sm" onClick={onResetAll} className="shrink-0 self-start">
            <RotateCcw size={14} aria-hidden="true" /> Restablecer recomendaciones
          </Button>
        )}
      </div>

      {current && (
        <section
          aria-labelledby="recomendacion-titulo"
          className="mt-5 rounded-lg border border-brand-primary/30 bg-primary-50 p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h4 id="recomendacion-titulo" className="text-base font-semibold text-content-primary">
              {current.name}
            </h4>
            {recommended && current.key === recommended.key ? (
              <Badge tone="info">Recomendada</Badge>
            ) : (
              <Badge tone="neutral">Elegida por ti</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-content-secondary">{current.description}</p>
          <p className="mt-2 text-sm text-content-primary">
            {recommendationReason(industry, current, model)}
          </p>

          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-content-secondary">
                Forma de vender
              </dt>
              <dd className="text-content-primary">{BUSINESS_MODEL_LABELS[model]}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-content-secondary">
                Módulos opcionales
              </dt>
              <dd className="text-content-primary">
                {optional.length > 0
                  ? optional.map((k) => OPTIONAL_MODULE_LABELS[k]).join(", ")
                  : "Ninguno (solo los centrales)"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-content-secondary">
                Categorías
              </dt>
              <dd className="text-content-primary">
                {current.categories.length > 0
                  ? current.categories.join(", ")
                  : current.modules.catalog
                    ? "Las defines tú"
                    : "Sin catálogo"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-content-secondary">
                Pipeline «{current.pipeline.name}»
              </dt>
              <dd className="text-content-primary">
                <ol className="list-inside list-decimal">
                  {current.pipeline.stages.map((s) => (
                    <li key={s.name}>
                      {s.name}
                      {s.type !== "OPEN" && (
                        <span className="text-content-secondary">
                          {" "}
                          ({STAGE_TYPE_LABELS[s.type].toLocaleLowerCase("es")})
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </dd>
            </div>
          </dl>
        </section>
      )}

      <fieldset className="mt-6">
        <legend className="mb-2 block text-sm font-medium text-neutral-700">
          Usar esta recomendación o elegir otra plantilla
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {types.map((type) => {
            const isSelected = current?.key === type.key;
            return (
              <label
                key={type.key}
                className={`flex cursor-pointer items-start gap-3 rounded-md border px-3.5 py-3 transition-colors motion-reduce:transition-none focus-within:ring-2 focus-within:ring-line-focus focus-within:ring-offset-1 ${
                  isSelected
                    ? "border-brand-primary bg-primary-50"
                    : "border-line-default bg-surface-default hover:bg-neutral-50"
                }`}
              >
                <input
                  type="radio"
                  name="businessType"
                  value={type.key}
                  checked={isSelected}
                  onChange={() => onSelectType(type.key)}
                  className="mt-1 h-4 w-4 shrink-0 accent-brand-primary"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-content-primary">
                    {type.manual ? "Configurar manualmente" : type.name}
                    {recommended?.key === type.key && <Badge tone="info">Recomendada</Badge>}
                  </span>
                  <span className="block text-xs text-content-secondary">{type.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {current?.manual && (
        <Field
          label="Describe tu tipo de negocio"
          required
          hint={`Es el tipo de negocio que verá tu equipo. Máximo ${businessTypeMaxLength} caracteres.`}
          className="mt-5"
        >
          <Input
            type="text"
            required
            maxLength={businessTypeMaxLength}
            value={customBusinessType}
            onChange={(e) => onCustomBusinessTypeChange(e.target.value)}
            placeholder="Ej.: distribuidora de insumos agrícolas"
          />
        </Field>
      )}
    </div>
  );
}
