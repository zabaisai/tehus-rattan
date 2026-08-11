import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

interface SuccessScreenProps {
  companyName: string;
  slug: string | null;
  logoUrl: string | null;
  onGoToLogin: () => void;
}

function resolveUploadUrl(path: string): string {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "";
  const origin = apiBase.replace(/\/api\/?$/, "");
  return `${origin}${path}`;
}

export function SuccessScreen({ companyName, slug, logoUrl, onGoToLogin }: SuccessScreenProps) {
  return (
    <div className="flex min-h-screen flex-1 flex-col items-center justify-center bg-neutral-50 px-6 py-16">
      <Card padding="lg" className="w-full max-w-md text-center">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={resolveUploadUrl(logoUrl)}
            alt={companyName}
            className="mx-auto mb-4 h-16 w-16 rounded-lg object-cover"
          />
        ) : (
          // Hueco del logotipo de LA EMPRESA, no de TAKTO: por eso es neutro y
          // no lleva navy ni naranja. Poner aquí los colores de la plataforma
          // sería vestir a la empresa con una marca que no es la suya.
          <div
            aria-hidden="true"
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-200"
          >
            <span className="text-sm font-semibold text-neutral-600">
              {companyName.slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}

        <h2 className="text-xl font-semibold text-content-primary">
          Empresa creada correctamente
        </h2>
        <p className="mt-2 text-sm text-content-secondary">{companyName}</p>
        {slug && <p className="mt-1 text-xs text-content-disabled">{slug}</p>}

        <Button onClick={onGoToLogin} className="mt-6 w-full px-6 py-3">
          Ir a iniciar sesión
        </Button>
      </Card>
    </div>
  );
}
