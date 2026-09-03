import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

interface SuggestionHeaderProps {
  title: string;
  description: string;
  /** El usuario ha cambiado algo respecto a la sugerencia de la plantilla. */
  edited: boolean;
  /** Hay una plantilla de la que restaurar (no en «Configurar manualmente»). */
  canRestore: boolean;
  onRestore: () => void;
}

/**
 * Cabecera común de los pasos con sugerencias. Deja claro de dónde sale lo
 * que se ve —«Sugerido» por la plantilla o «Editado» por la persona— y ofrece
 * volver a la sugerencia sin perder el resto del asistente.
 */
export function SuggestionHeader({
  title,
  description,
  edited,
  canRestore,
  onRestore,
}: SuggestionHeaderProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold text-content-primary">{title}</h3>
          {canRestore && (
            <Badge tone={edited ? "warning" : "info"}>
              {edited ? "Editado" : "Sugerido"}
            </Badge>
          )}
        </div>
        <p className="mt-1.5 text-sm text-content-secondary">{description}</p>
      </div>
      {canRestore && edited && (
        <Button
          variant="quiet"
          size="sm"
          onClick={onRestore}
          className="shrink-0 self-start"
        >
          <RotateCcw size={14} aria-hidden="true" /> Restaurar sugerencias
        </Button>
      )}
    </div>
  );
}
