import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { displayColor, PLATFORM_BRAND } from "@/lib/brand";
import type { OnboardingCompanyPayload } from "@/lib/onboarding";
import {
  BUSINESS_MODEL_LABELS,
  CORE_MODULE_LABELS,
  findBusinessType,
  findIndustry,
  OPTIONAL_MODULE_LABELS,
  STAGE_TYPE_LABELS,
  type OnboardingTemplates,
} from "@/lib/onboarding-templates";

export type EditableSection =
  | "company"
  | "region"
  | "selling"
  | "recommendation"
  | "modules"
  | "categories"
  | "pipeline"
  | "branding"
  | "admin"
  | "agents";

interface ConfirmationStepProps {
  /** El MISMO objeto que se enviará: el resumen no puede divergir de él. */
  payload: OnboardingCompanyPayload;
  templates: OnboardingTemplates | null;
  coreModules: string[];
  hasLogo: boolean;
  hasSecondaryLogo: boolean;
  onEdit: (section: EditableSection) => void;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-content-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-content-primary">{value}</dd>
    </div>
  );
}

function SummaryCard({
  title,
  section,
  onEdit,
  children,
}: {
  title: string;
  section: EditableSection;
  onEdit: (section: EditableSection) => void;
  children: React.ReactNode;
}) {
  return (
    <Card padding="sm" flat>
      <div className="mb-2 flex items-center justify-between gap-2">
        {/* Navy y no naranja: es texto fino sobre fondo claro, justo el uso que
            el manual prohíbe para #FF6A00 por contraste. */}
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-primary">{title}</p>
        <Button
          variant="quiet"
          size="sm"
          onClick={() => onEdit(section)}
          aria-label={`Editar ${title.toLocaleLowerCase("es")}`}
        >
          Editar
        </Button>
      </div>
      <dl>{children}</dl>
    </Card>
  );
}

export function ConfirmationStep({
  payload,
  templates,
  coreModules,
  hasLogo,
  hasSecondaryLogo,
  onEdit,
}: ConfirmationStepProps) {
  const { company, commercial, pipeline, branding, admin, agents } = payload;
  const industry = findIndustry(templates, commercial.industry ?? "");
  const type = findBusinessType(templates, commercial.industry ?? "", commercial.businessType ?? "");
  const businessTypeLabel = type?.manual ? company.businessType ?? "" : type?.name ?? "";
  const optionalOn = [
    commercial.usesCatalog ? OPTIONAL_MODULE_LABELS.catalog : null,
    commercial.usesQuotes ? OPTIONAL_MODULE_LABELS.quotes : null,
    commercial.usesTasks ? OPTIONAL_MODULE_LABELS.tasks : null,
  ].filter((v): v is string => Boolean(v));
  const stages = (pipeline.typedStages ?? []).map((s) =>
    s.type === "OPEN" ? s.name : `${s.name} (${STAGE_TYPE_LABELS[s.type].toLocaleLowerCase("es")})`,
  );
  const brandingDefined = Boolean(branding?.primaryColor || branding?.accentColor);

  return (
    <div>
      <h3 className="text-lg font-semibold text-content-primary">Confirmación</h3>
      <p className="mt-1.5 text-sm text-content-secondary">
        Esto es exactamente lo que se creará. Cada bloque se puede volver a editar.
      </p>

      <div className="mt-6 space-y-3">
        <SummaryCard title="Empresa" section="company" onEdit={onEdit}>
          <SummaryRow label="Nombre" value={company.name || "—"} />
          <SummaryRow label="Industria" value={industry?.name ?? "—"} />
          <SummaryRow label="Tipo de negocio" value={businessTypeLabel || "—"} />
          <SummaryRow label="Ciudad" value={company.city || "—"} />
        </SummaryCard>

        <SummaryCard title="Región" section="region" onEdit={onEdit}>
          <SummaryRow label="País" value={company.country || "—"} />
          <SummaryRow label="Zona horaria" value={company.timezone || "—"} />
          <SummaryRow label="Moneda" value={company.currency || "—"} />
          <SummaryRow label="Idioma" value={company.locale || "—"} />
        </SummaryCard>

        <SummaryCard title="Forma de vender" section="selling" onEdit={onEdit}>
          <SummaryRow
            label="Vendes"
            value={commercial.businessModel ? BUSINESS_MODEL_LABELS[commercial.businessModel] : "—"}
          />
        </SummaryCard>

        <SummaryCard title="Plantilla" section="recommendation" onEdit={onEdit}>
          <SummaryRow label="Punto de partida" value={type?.name ?? "—"} />
        </SummaryCard>

        <SummaryCard title="Módulos" section="modules" onEdit={onEdit}>
          <SummaryRow
            label="Incluidos"
            value={coreModules.map((k) => CORE_MODULE_LABELS[k] ?? k).join(", ")}
          />
          <SummaryRow label="Opcionales" value={optionalOn.length > 0 ? optionalOn.join(", ") : "Ninguno"} />
        </SummaryCard>

        {commercial.usesCatalog && (
          <SummaryCard title="Categorías" section="categories" onEdit={onEdit}>
            <SummaryRow
              label="Catálogo"
              value={
                commercial.categories.length > 0
                  ? commercial.categories.join(", ")
                  : "Sin categorías (podrás crearlas después)"
              }
            />
          </SummaryCard>
        )}

        <SummaryCard title="Pipeline inicial" section="pipeline" onEdit={onEdit}>
          <SummaryRow label="Nombre" value={pipeline.name || "—"} />
          <div className="py-1.5 text-sm">
            <dt className="text-content-secondary">Etapas comerciales, en orden</dt>
            <dd>
              <ol className="mt-1 list-inside list-decimal font-medium text-content-primary">
                {stages.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </dd>
          </div>
        </SummaryCard>

        <SummaryCard title="Branding" section="branding" onEdit={onEdit}>
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
                  style={{ backgroundColor: displayColor(branding?.primaryColor ?? "", PLATFORM_BRAND.primaryColor) }}
                />
                Principal
              </span>
              <span className="flex items-center gap-2 text-xs text-content-secondary">
                <span
                  aria-hidden="true"
                  className="h-5 w-5 rounded-full border border-line-default"
                  style={{ backgroundColor: displayColor(branding?.accentColor ?? "", PLATFORM_BRAND.accentColor) }}
                />
                Acento
              </span>
            </div>
          )}
        </SummaryCard>

        <SummaryCard title="Administrador" section="admin" onEdit={onEdit}>
          <SummaryRow label="Nombre" value={admin.name || "—"} />
          <SummaryRow label="Email" value={admin.email || "—"} />
        </SummaryCard>

        <SummaryCard title="Asesores" section="agents" onEdit={onEdit}>
          <SummaryRow label="Cantidad" value={String(agents?.length ?? 0)} />
          {(agents ?? []).length > 0 && (
            <SummaryRow label="Correos" value={(agents ?? []).map((a) => a.email).join(", ")} />
          )}
        </SummaryCard>
      </div>
    </div>
  );
}
