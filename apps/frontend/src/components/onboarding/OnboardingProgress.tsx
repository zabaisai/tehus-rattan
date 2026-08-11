import { TaktoLogo } from "@/components/ui/TaktoLogo";

interface OnboardingProgressProps {
  current: number;
  labels: string[];
}

export function OnboardingProgress({ current, labels }: OnboardingProgressProps) {
  return (
    // Navy de marca sobre el panel: es la superficie inversa del sistema
    // (`surface-inverse`), no un negro cualquiera. Sobre él, el logotipo va en
    // negativo —TAK blanco, TO naranja—, que es la regla del manual.
    <div className="shrink-0 bg-surface-inverse p-6 text-content-inverse lg:w-72 lg:p-8">
      <TaktoLogo tone="negative" height={26} />

      <p className="mt-6 text-xs font-medium uppercase tracking-[0.2em] text-brand-secondary">
        Nueva empresa
      </p>
      <h2 className="mt-1 text-lg font-semibold">Crear cuenta</h2>

      {/* Los pasos ya completados y el actual se distinguen por forma —relleno
          frente a contorno— y no solo por color, para que sigan siendo
          legibles sin percepción de color. */}
      <ol className="mt-6 hidden space-y-3 lg:block">
        {labels.map((label, i) => (
          <li key={label} className="flex items-center gap-2.5 text-sm">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                i < current
                  ? // Naranja de fondo con texto navy: nunca al revés.
                    "bg-brand-secondary text-brand-primary"
                  : i === current
                    ? "border border-brand-secondary text-brand-secondary"
                    : "border border-white/20 text-white/40"
              }`}
            >
              {i + 1}
            </span>
            <span className={i === current ? "text-white" : "text-white/50"}>
              {label}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-4 lg:hidden">
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={labels.length}
          aria-valuenow={current + 1}
          aria-label={`Paso ${current + 1} de ${labels.length}: ${labels[current]}`}
          className="h-1.5 w-full overflow-hidden rounded-full bg-white/15"
        >
          <div
            className="h-1.5 rounded-full bg-brand-secondary transition-all"
            style={{ width: `${((current + 1) / labels.length) * 100}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-white/70">
          {labels[current]} · Paso {current + 1} de {labels.length}
        </p>
      </div>
    </div>
  );
}
