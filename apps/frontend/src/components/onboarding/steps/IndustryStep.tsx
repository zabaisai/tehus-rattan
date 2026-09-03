"use client";

import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import {
  BUSINESS_MODEL_LABELS,
  findIndustry,
  type BusinessModel,
  type OnboardingTemplates,
} from "@/lib/onboarding-templates";

export interface IndustrySelection {
  industry: string;
  businessType: string;
  businessModel: BusinessModel;
}

interface IndustryStepProps {
  templates: OnboardingTemplates | null;
  loading: boolean;
  loadError: string;
  onRetry: () => void;
  value: IndustrySelection;
  onIndustryChange: (industry: string) => void;
  onBusinessTypeChange: (businessType: string) => void;
  onBusinessModelChange: (model: BusinessModel) => void;
}

const MODELS: BusinessModel[] = ["products", "services", "mixed"];

/**
 * Industria → tipo de negocio → modelo comercial. Cada elección estrecha la
 * siguiente; ninguna es definitiva: lo que se sugiere después (módulos,
 * categorías, pipeline) se puede editar y siempre existe «Otro / Configurar
 * manualmente».
 */
export function IndustryStep({
  templates,
  loading,
  loadError,
  onRetry,
  value,
  onIndustryChange,
  onBusinessTypeChange,
  onBusinessModelChange,
}: IndustryStepProps) {
  const industry = findIndustry(templates, value.industry);

  return (
    <div>
      <h3 className="text-lg font-semibold text-content-primary">
        ¿A qué se dedica tu empresa?
      </h3>
      <p className="mt-1.5 text-sm text-content-secondary">
        Con esto preparamos una configuración inicial. Podrás cambiar cualquier
        sugerencia en los pasos siguientes.
      </p>

      {loading && (
        <p role="status" className="mt-6 text-sm text-content-secondary">
          Cargando opciones…
        </p>
      )}

      {!loading && loadError && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-status-error/30 bg-status-error-surface px-3 py-2 text-sm text-status-error"
        >
          <p>{loadError}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded text-sm font-medium underline outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
          >
            Reintentar
          </button>
        </div>
      )}

      {!loading && templates && (
        <div className="mt-6 space-y-6">
          <Field label="Industria" required hint={industry?.description}>
            <Select
              required
              value={value.industry}
              onChange={(e) => onIndustryChange(e.target.value)}
            >
              {templates.industries.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>

          <fieldset>
            <legend className="mb-2 block text-sm font-medium text-neutral-700">
              Tipo de negocio
              <span aria-hidden="true" className="ml-0.5 text-status-error">
                *
              </span>
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(industry?.businessTypes ?? []).map((type) => {
                const selected = value.businessType === type.key;
                return (
                  <label
                    key={type.key}
                    className={`flex cursor-pointer items-start gap-3 rounded-md border px-3.5 py-3 transition-colors focus-within:ring-2 focus-within:ring-line-focus focus-within:ring-offset-1 ${
                      selected
                        ? "border-brand-primary bg-primary-50"
                        : "border-line-default bg-surface-default hover:bg-neutral-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="businessType"
                      value={type.key}
                      checked={selected}
                      onChange={() => onBusinessTypeChange(type.key)}
                      className="mt-1 h-4 w-4 shrink-0 accent-brand-primary"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-content-primary">
                        {type.name}
                      </span>
                      <span className="block text-xs text-content-secondary">
                        {type.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 block text-sm font-medium text-neutral-700">
              Modelo comercial
            </legend>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {MODELS.map((model) => (
                <label
                  key={model}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-line-default bg-surface-default px-3 py-2 text-sm text-content-primary focus-within:ring-2 focus-within:ring-line-focus focus-within:ring-offset-1"
                >
                  <input
                    type="radio"
                    name="businessModel"
                    value={model}
                    checked={value.businessModel === model}
                    onChange={() => onBusinessModelChange(model)}
                    className="h-4 w-4 accent-brand-primary"
                  />
                  {BUSINESS_MODEL_LABELS[model]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </div>
  );
}
