import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";

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

export function CompanyInfoStep({ value, onChange }: CompanyInfoStepProps) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-content-primary">
        Datos de tu empresa
      </h3>
      <p className="mt-1.5 text-sm text-content-secondary">
        Estos datos son informativos. No son datos legales, fiscales ni de
        facturación.
      </p>

      <div className="mt-6 space-y-4">
        <Field label="Nombre comercial" required>
          <Input
            type="text"
            required
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Tehus Rattan"
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Tipo de negocio">
            <Input
              type="text"
              value={value.businessType}
              onChange={(e) => onChange({ businessType: e.target.value })}
              placeholder="Muebles y decoración"
            />
          </Field>

          <Field label="Teléfono comercial">
            <Input
              type="tel"
              value={value.phone}
              onChange={(e) => onChange({ phone: e.target.value })}
              placeholder="+57 300 000 0000"
            />
          </Field>

          <Field label="Ciudad">
            <Input
              type="text"
              value={value.city}
              onChange={(e) => onChange({ city: e.target.value })}
              placeholder="Medellín"
            />
          </Field>

          <Field label="País">
            <Input
              type="text"
              value={value.country}
              onChange={(e) => onChange({ country: e.target.value })}
              placeholder="Colombia"
            />
          </Field>

          <Field label="Email comercial">
            <Input
              type="email"
              value={value.email}
              onChange={(e) => onChange({ email: e.target.value })}
              placeholder="contacto@empresa.com"
            />
          </Field>

          <Field label="Sitio web o Instagram">
            <Input
              type="text"
              value={value.website}
              onChange={(e) => onChange({ website: e.target.value })}
              placeholder="instagram.com/tuempresa"
            />
          </Field>
        </div>

        <Field label="Descripción corta">
          <Textarea
            value={value.description}
            onChange={(e) => onChange({ description: e.target.value })}
            rows={3}
            placeholder="Una breve descripción de tu empresa"
          />
        </Field>
      </div>
    </div>
  );
}
