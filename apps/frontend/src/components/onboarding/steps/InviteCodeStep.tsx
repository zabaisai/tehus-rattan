interface InviteCodeStepProps {
  value: string;
  onChange: (value: string) => void;
}

export function InviteCodeStep({ value, onChange }: InviteCodeStepProps) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-[#0B0F10]">Código de invitación</h3>
      <p className="mt-1.5 text-sm text-[#0B0F10]/70">
        Este CRM se activa por invitación. Ingresa el código que recibiste
        para crear tu empresa.
      </p>

      <div className="mt-6">
        <label className="mb-1.5 block text-xs font-medium text-[#0B0F10]/70">
          Código de invitación
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ingresa tu código"
          autoFocus
          className="w-full rounded-md border border-[#0B0F10]/15 px-3 py-2.5 text-sm outline-none focus:border-[#A57014] focus:ring-1 focus:ring-[#A57014]"
        />
        <p className="mt-2 text-xs text-[#0B0F10]/40">
          Tu código no se guarda en este dispositivo — solo se usa para crear
          tu empresa.
        </p>
      </div>
    </div>
  );
}
