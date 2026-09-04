import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import type { OnboardingTemplates } from "@/lib/onboarding-templates";
import type { CompanyInfoState } from "@/lib/onboarding-wizard";

export type { CompanyInfoState };

interface CompanyInfoStepProps {
  value: CompanyInfoState;
  onChange: (patch: Partial<CompanyInfoState>) => void;
  /** Industria: primera respuesta que orienta todas las recomendaciones. */
  templates: OnboardingTemplates | null;
  templatesLoading: boolean;
  templatesError: string;
  onRetryTemplates: () => void;
  industry: string;
  onIndustryChange: (industry: string) => void;
}

/**
 * Nombre, industria y datos informativos. El país, la zona horaria, la
 * moneda y el idioma van en el paso «Región»; el tipo de negocio se elige en
 * «Recomendación» (plantilla o descripción manual). Aquí no se guarda nada:
 * todo viaja junto al final.
 */
export function CompanyInfoStep({
  value,
  onChange,
  templates,
  templatesLoading,
  templatesError,
  onRetryTemplates,
  industry,
  onIndustryChange,
}: CompanyInfoStepProps) {
  const industryTemplate = templates?.industries.find((i) => i.key === industry);

  return (
    <div>
      <h3 className="text-lg font-semibold text-content-primary">Datos de tu empresa</h3>
      <p className="mt-1.5 text-sm text-content-secondary">
        Con el nombre y la industria preparamos una configuración inicial que podrás cambiar.
        Los demás datos son informativos: no son datos legales, fiscales ni de facturación.
      </p>

      <div className="mt-6 space-y-4">
        <Field label="Nombre comercial" required>
          <Input
            type="text"
            required
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Nombre de tu empresa"
          />
        </Field>

        {templatesLoading && (
          <p role="status" className="text-sm text-content-secondary">
            Cargando industrias…
          </p>
        )}
        {!templatesLoading && templatesError && (
          <div
            role="alert"
            className="rounded-md border border-status-error/30 bg-status-error-surface px-3 py-2 text-sm text-status-error"
          >
            <p>{templatesError}</p>
            <button
              type="button"
              onClick={onRetryTemplates}
              className="mt-2 rounded text-sm font-medium underline outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              Reintentar
            </button>
          </div>
        )}
        {!templatesLoading && templates && (
          <Field
            label="Industria"
            required
            hint={industryTemplate?.description ?? "Elige la que más se parezca a tu negocio."}
          >
            <Select required value={industry} onChange={(e) => onIndustryChange(e.target.value)}>
              {templates.industries.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Teléfono comercial">
            <Input
              type="tel"
              value={value.phone}
              onChange={(e) => onChange({ phone: e.target.value })}
              placeholder="+57 300 000 0000"
            />
          </Field>

          <Field label="Ciudad">
            <Input
              type="text"
              value={value.city}
              onChange={(e) => onChange({ city: e.target.value })}
              placeholder="Ciudad"
            />
          </Field>

          <Field label="Email comercial">
            <Input
              type="email"
              value={value.email}
              onChange={(e) => onChange({ email: e.target.value })}
              placeholder="contacto@empresa.com"
            />
          </Field>

          <Field label="Sitio web o Instagram">
            <Input
              type="text"
              value={value.website}
              onChange={(e) => onChange({ website: e.target.value })}
              placeholder="instagram.com/tuempresa"
            />
          </Field>
        </div>

        <Field label="Descripción corta">
          <Textarea
            value={value.description}
            onChange={(e) => onChange({ description: e.target.value })}
            rows={3}
            placeholder="Una breve descripción de tu empresa"
          />
        </Field>
      </div>
    </div>
  );
}
