export interface CompanyInfoState {
  name: string;
  businessType: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  description: string;
}

interface CompanyInfoStepProps {
  value: CompanyInfoState;
  onChange: (patch: Partial<CompanyInfoState>) => void;
}

const inputClass =
  "w-full rounded-md border border-[#0B0F10]/15 px-3 py-2.5 text-sm outline-none focus:border-[#A57014] focus:ring-1 focus:ring-[#A57014]";
const labelClass = "mb-1.5 block text-xs font-medium text-[#0B0F10]/70";

export function CompanyInfoStep({ value, onChange }: CompanyInfoStepProps) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-[#0B0F10]">Datos de tu empresa</h3>
      <p className="mt-1.5 text-sm text-[#0B0F10]/70">
        Estos datos son informativos. No son datos legales, fiscales ni de
        facturación.
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <label className={labelClass}>Nombre comercial *</label>
          <input
            type="text"
            required
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Tehus Rattan"
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Tipo de negocio</label>
            <input
              type="text"
              value={value.businessType}
              onChange={(e) => onChange({ businessType: e.target.value })}
              placeholder="Muebles y decoración"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Teléfono comercial</label>
            <input
              type="text"
              value={value.phone}
              onChange={(e) => onChange({ phone: e.target.value })}
              placeholder="+57 300 000 0000"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Ciudad</label>
            <input
              type="text"
              value={value.city}
              onChange={(e) => onChange({ city: e.target.value })}
              placeholder="Medellín"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>País</label>
            <input
              type="text"
              value={value.country}
              onChange={(e) => onChange({ country: e.target.value })}
              placeholder="Colombia"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Email comercial</label>
            <input
              type="email"
              value={value.email}
              onChange={(e) => onChange({ email: e.target.value })}
              placeholder="contacto@empresa.com"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Sitio web o Instagram</label>
            <input
              type="text"
              value={value.website}
              onChange={(e) => onChange({ website: e.target.value })}
              placeholder="instagram.com/tuempresa"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Descripción corta</label>
          <textarea
            value={value.description}
            onChange={(e) => onChange({ description: e.target.value })}
            rows={3}
            placeholder="Una breve descripción de tu empresa"
            className={inputClass}
          />
        </div>
      </div>
    </div>
  );
}
