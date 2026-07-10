export interface AdminState {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

interface AdminStepProps {
  value: AdminState;
  onChange: (patch: Partial<AdminState>) => void;
}

const inputClass =
  "w-full rounded-md border border-[#0B0F10]/15 px-3 py-2.5 text-sm outline-none focus:border-[#A57014] focus:ring-1 focus:ring-[#A57014]";
const labelClass = "mb-1.5 block text-xs font-medium text-[#0B0F10]/70";

export function AdminStep({ value, onChange }: AdminStepProps) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-[#0B0F10]">Administrador</h3>
      <p className="mt-1.5 text-sm text-[#0B0F10]/70">
        Será el usuario principal para gestionar tu empresa en el CRM.
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <label className={labelClass}>Nombre *</label>
          <input
            type="text"
            required
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Email *</label>
          <input
            type="email"
            required
            value={value.email}
            onChange={(e) => onChange({ email: e.target.value })}
            placeholder="admin@empresa.com"
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Contraseña *</label>
            <input
              type="password"
              required
              value={value.password}
              onChange={(e) => onChange({ password: e.target.value })}
              placeholder="••••••••"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Confirmar contraseña *</label>
            <input
              type="password"
              required
              value={value.confirmPassword}
              onChange={(e) => onChange({ confirmPassword: e.target.value })}
              placeholder="••••••••"
              className={inputClass}
            />
          </div>
        </div>
        <p className="text-xs text-[#0B0F10]/40">Mínimo 8 caracteres.</p>
      </div>
    </div>
  );
}
