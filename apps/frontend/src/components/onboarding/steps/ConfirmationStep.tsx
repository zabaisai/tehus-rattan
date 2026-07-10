import { CommercialState } from "./CommercialStep";
import { PipelineState } from "./PipelineStep";

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
      <span className="text-[#0B0F10]/50">{label}</span>
      <span className="text-right font-medium text-[#0B0F10]">{value}</span>
    </div>
  );
}

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#0B0F10]/10 bg-white p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#A57014]">
        {title}
      </p>
      {children}
    </div>
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
      <h3 className="text-lg font-semibold text-[#0B0F10]">Confirmación</h3>
      <p className="mt-1.5 text-sm text-[#0B0F10]/70">
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
          <div className="mt-2 flex items-center gap-2">
            <span
              className="h-5 w-5 rounded-full border border-[#0B0F10]/10"
              style={{ backgroundColor: primaryColor || "#A57014" }}
            />
            <span
              className="h-5 w-5 rounded-full border border-[#0B0F10]/10"
              style={{ backgroundColor: accentColor || "#FDDC7F" }}
            />
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
