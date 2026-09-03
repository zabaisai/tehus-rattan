import { Card } from "@/components/ui/Card";
import { displayColor, PLATFORM_BRAND } from "@/lib/brand";
import {
  BUSINESS_MODEL_LABELS,
  CORE_MODULE_LABELS,
  OPTIONAL_MODULE_LABELS,
  STAGE_TYPE_LABELS,
  type ModulesTemplate,
} from "@/lib/onboarding-templates";
import type { PipelineState } from "./PipelineStep";
import type { IndustrySelection } from "./IndustryStep";

interface ConfirmationStepProps {
  companyName: string;
  businessTypeLabel: string;
  city: string;
  country: string;
  industryName: string;
  businessTypeName: string;
  selection: IndustrySelection;
  coreModules: string[];
  modules: ModulesTemplate;
  categories: string[];
  pipeline: PipelineState;
  hasLogo: boolean;
  hasSecondaryLogo: boolean;
  primaryColor: string;
  accentColor: string;
  adminName: string;
  adminEmail: string;
  agentsCount: number;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-content-secondary">{label}</span>
      <span className="min-w-0 break-words text-right font-medium text-content-primary">
        {value}
      </span>
    </div>
  );
}

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card padding="sm" flat>
      {/* Navy y no naranja: es texto fino sobre fondo claro, justo el uso que
          el manual prohíbe para #FF6A00 por contraste. */}
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-primary">
        {title}
      </p>
      {children}
    </Card>
  );
}

export function ConfirmationStep({
  companyName,
  businessTypeLabel,
  city,
  country,
  industryName,
  businessTypeName,
  selection,
  coreModules,
  modules,
  categories,
  pipeline,
  hasLogo,
  hasSecondaryLogo,
  primaryColor,
  accentColor,
  adminName,
  adminEmail,
  agentsCount,
}: ConfirmationStepProps) {
  const optionalOn = (Object.keys(OPTIONAL_MODULE_LABELS) as (keyof ModulesTemplate)[])
    .filter((k) => modules[k])
    .map((k) => OPTIONAL_MODULE_LABELS[k]);
  const stagesText = pipeline.stages
    .map((s) =>
      s.type === "OPEN" ? s.name : `${s.name} (${STAGE_TYPE_LABELS[s.type].toLowerCase()})`,
    )
    .join(" → ");
  const brandingDefined = Boolean(primaryColor || accentColor);

  return (
    <div>
      <h3 className="text-lg font-semibold text-content-primary">Confirmación</h3>
      <p className="mt-1.5 text-sm text-content-secondary">
        Revisa la información antes de crear tu empresa.
      </p>

      <div className="mt-6 space-y-3">
        <SummaryCard title="Empresa">
          <SummaryRow label="Nombre" value={companyName || "—"} />
          <SummaryRow label="Tipo de negocio" value={businessTypeLabel || businessTypeName || "—"} />
          <SummaryRow label="Ubicación" value={[city, country].filter(Boolean).join(", ") || "—"} />
        </SummaryCard>

        <SummaryCard title="Actividad">
          <SummaryRow label="Industria" value={industryName || "—"} />
          <SummaryRow label="Plantilla" value={businessTypeName || "—"} />
          <SummaryRow label="Modelo comercial" value={BUSINESS_MODEL_LABELS[selection.businessModel]} />
        </SummaryCard>

        <SummaryCard title="Módulos">
          <SummaryRow
            label="Incluidos"
            value={coreModules.map((k) => CORE_MODULE_LABELS[k] ?? k).join(", ")}
          />
          <SummaryRow
            label="Opcionales"
            value={optionalOn.length > 0 ? optionalOn.join(", ") : "Ninguno"}
          />
          {modules.catalog && (
            <SummaryRow
              label="Categorías"
              value={categories.length > 0 ? categories.join(", ") : "Sin categorías (podrás crearlas después)"}
            />
          )}
        </SummaryCard>

        <SummaryCard title="Pipeline">
          <SummaryRow label="Nombre" value={pipeline.name || "—"} />
          <SummaryRow label="Etapas" value={stagesText || "—"} />
        </SummaryCard>

        <SummaryCard title="Branding">
          <SummaryRow label="Logo principal" value={hasLogo ? "Incluido" : "No incluido"} />
          <SummaryRow label="Logo secundario" value={hasSecondaryLogo ? "Incluido" : "No incluido"} />
          <SummaryRow
            label="Colores"
            value={brandingDefined ? "Personalizados" : "Apariencia neutral TAKTO (se puede cambiar después)"}
          />
          {brandingDefined && (
            <div className="mt-2 flex items-center gap-4">
              <span className="flex items-center gap-2 text-xs text-content-secondary">
                <span
                  aria-hidden="true"
                  className="h-5 w-5 rounded-full border border-line-default"
                  style={{ backgroundColor: displayColor(primaryColor, PLATFORM_BRAND.primaryColor) }}
                />
                Principal
              </span>
              <span className="flex items-center gap-2 text-xs text-content-secondary">
                <span
                  aria-hidden="true"
                  className="h-5 w-5 rounded-full border border-line-default"
                  style={{ backgroundColor: displayColor(accentColor, PLATFORM_BRAND.accentColor) }}
                />
                Acento
              </span>
            </div>
          )}
        </SummaryCard>

        <SummaryCard title="Administrador">
          <SummaryRow label="Nombre" value={adminName || "—"} />
          <SummaryRow label="Email" value={adminEmail || "—"} />
        </SummaryCard>

        <SummaryCard title="Asesores">
          <SummaryRow label="Cantidad" value={String(agentsCount)} />
        </SummaryCard>
      </div>
    </div>
  );
}
