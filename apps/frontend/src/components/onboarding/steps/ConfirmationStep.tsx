import { Card } from "@/components/ui/Card";
import { CommercialState } from "./CommercialStep";
import { PipelineState } from "./PipelineStep";

/** Colores por defecto de la EMPRESA, no de TAKTO. Ver `BrandingStep`. */
const COLOR_EMPRESA_POR_DEFECTO = "#A57014";
const ACENTO_EMPRESA_POR_DEFECTO = "#FDDC7F";

interface ConfirmationStepProps {
  companyName: string;
  businessType: string;
  city: string;
  country: string;
  hasLogo: boolean;
  hasSecondaryLogo: boolean;
  primaryColor: string;
  accentColor: string;
  commercial: CommercialState;
  pipeline: PipelineState;
  adminName: string;
  adminEmail: string;
  agentsCount: number;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-content-secondary">{label}</span>
      <span className="text-right font-medium text-content-primary">{value}</span>
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
  businessType,
  city,
  country,
  hasLogo,
  hasSecondaryLogo,
  primaryColor,
  accentColor,
  commercial,
  pipeline,
  adminName,
  adminEmail,
  agentsCount,
}: ConfirmationStepProps) {
  const activeModules = [
    commercial.sellsProducts && "Venta de productos",
    commercial.sellsServices && "Venta de servicios",
    commercial.usesCatalog && "Catálogo",
    commercial.usesQuotes && "Cotizaciones",
    commercial.usesTasks && "Tareas/seguimientos",
  ].filter(Boolean) as string[];

  return (
    <div>
      <h3 className="text-lg font-semibold text-content-primary">Confirmación</h3>
      <p className="mt-1.5 text-sm text-content-secondary">
        Revisa la información antes de crear tu empresa.
      </p>

      <div className="mt-6 space-y-3">
        <SummaryCard title="Empresa">
          <SummaryRow label="Nombre" value={companyName || "—"} />
          <SummaryRow label="Tipo de negocio" value={businessType || "—"} />
          <SummaryRow label="Ubicación" value={[city, country].filter(Boolean).join(", ") || "—"} />
        </SummaryCard>

        <SummaryCard title="Branding">
          <SummaryRow label="Logo principal" value={hasLogo ? "Incluido" : "No incluido"} />
          <SummaryRow label="Logo secundario" value={hasSecondaryLogo ? "Incluido" : "No incluido"} />
          {/* Muestras de los colores DE LA EMPRESA. El nombre va en texto y no
              solo en el color: dos discos sin etiqueta no dicen nada a quien
              usa lector de pantalla ni a quien no distingue esos dos tonos. */}
          <div className="mt-2 flex items-center gap-4">
            <span className="flex items-center gap-2 text-xs text-content-secondary">
              <span
                aria-hidden="true"
                className="h-5 w-5 rounded-full border border-line-default"
                style={{ backgroundColor: primaryColor || COLOR_EMPRESA_POR_DEFECTO }}
              />
              Principal
            </span>
            <span className="flex items-center gap-2 text-xs text-content-secondary">
              <span
                aria-hidden="true"
                className="h-5 w-5 rounded-full border border-line-default"
                style={{ backgroundColor: accentColor || ACENTO_EMPRESA_POR_DEFECTO }}
              />
              Acento
            </span>
          </div>
        </SummaryCard>

        <SummaryCard title="Configuración comercial">
          <SummaryRow
            label="Módulos activos"
            value={activeModules.length > 0 ? activeModules.join(", ") : "Ninguno"}
          />
          <SummaryRow
            label="Categorías"
            value={commercial.categories.length > 0 ? commercial.categories.join(", ") : "—"}
          />
        </SummaryCard>

        <SummaryCard title="Pipeline">
          <SummaryRow label="Nombre" value={pipeline.name || "—"} />
          <SummaryRow label="Etapas" value={pipeline.stages.filter(Boolean).join(" → ") || "—"} />
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
