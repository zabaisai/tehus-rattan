import { TaktoLogo } from "@/components/ui/TaktoLogo";

interface OnboardingProgressProps {
  current: number;
  labels: string[];
}

/**
 * Stepper del asistente. En escritorio, una lista con `aria-current="step"`
 * y el estado de cada paso también en texto (no solo en color o forma); en
 * móvil, una barra compacta que no roba pantalla al formulario. Sin
 * transición cuando la persona prefiere menos movimiento.
 */
export function OnboardingProgress({ current, labels }: OnboardingProgressProps) {
  return (
    // Navy de marca sobre el panel: es la superficie inversa del sistema
    // (`surface-inverse`), no un negro cualquiera. Sobre él, el logotipo va en
    // negativo —TAK blanco, TO naranja—, que es la regla del manual.
    <div className="shrink-0 bg-surface-inverse p-4 text-content-inverse sm:p-6 lg:w-72 lg:p-8">
      <TaktoLogo tone="negative" height={26} />

      <p className="mt-4 text-xs font-medium uppercase tracking-[0.2em] text-brand-secondary lg:mt-6">
        Nueva empresa
      </p>
      <h2 className="mt-1 text-lg font-semibold">Crear cuenta</h2>

      <nav aria-label="Pasos del registro" className="mt-6 hidden lg:block">
        <ol className="space-y-3">
          {labels.map((label, i) => {
            const state = i < current ? "completado" : i === current ? "actual" : "pendiente";
            return (
              <li
                key={label}
                aria-current={i === current ? "step" : undefined}
                className="flex items-center gap-2.5 text-sm"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                    state === "completado"
                      ? // Naranja de fondo con texto navy: nunca al revés.
                        "bg-brand-secondary text-brand-primary"
                      : state === "actual"
                        ? "border border-brand-secondary text-brand-secondary"
                        : "border border-white/20 text-white/40"
                  }`}
                >
                  {i + 1}
                </span>
                <span className={state === "actual" ? "text-white" : "text-white/50"}>
                  {label}
                  <span className="sr-only">{` (${state})`}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="mt-3 lg:hidden">
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={labels.length}
          aria-valuenow={current + 1}
          aria-label={`Paso ${current + 1} de ${labels.length}: ${labels[current]}`}
          className="h-1.5 w-full overflow-hidden rounded-full bg-white/15"
        >
          <div
            className="h-1.5 rounded-full bg-brand-secondary transition-[width] motion-reduce:transition-none"
            style={{ width: `${((current + 1) / labels.length) * 100}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-white/70" aria-live="polite">
          {labels[current]} · Paso {current + 1} de {labels.length}
        </p>
      </div>
    </div>
  );
}
