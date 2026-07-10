interface OnboardingProgressProps {
  current: number;
  labels: string[];
}

export function OnboardingProgress({ current, labels }: OnboardingProgressProps) {
  return (
    <div className="shrink-0 bg-[#0B0F10] p-6 text-[#FAF8F3] lg:w-72 lg:p-8">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#FDDC7F]">
        Nueva empresa
      </p>
      <h2 className="mt-1 text-lg font-semibold">Crear cuenta</h2>

      <ol className="mt-6 hidden space-y-3 lg:block">
        {labels.map((label, i) => (
          <li key={label} className="flex items-center gap-2.5 text-sm">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                i < current
                  ? "bg-[#A57014] text-[#0B0F10]"
                  : i === current
                    ? "border border-[#FDDC7F] text-[#FDDC7F]"
                    : "border border-white/20 text-white/40"
              }`}
            >
              {i + 1}
            </span>
            <span className={i === current ? "text-[#FAF8F3]" : "text-white/50"}>
              {label}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-4 lg:hidden">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
          <div
            className="h-1.5 rounded-full bg-[#A57014] transition-all"
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
