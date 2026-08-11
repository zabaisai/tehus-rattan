import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

interface InviteCodeStepProps {
  value: string;
  onChange: (value: string) => void;
}

export function InviteCodeStep({ value, onChange }: InviteCodeStepProps) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-content-primary">
        Código de invitación
      </h3>
      <p className="mt-1.5 text-sm text-content-secondary">
        Este CRM se activa por invitación. Ingresa el código que recibiste
        para crear tu empresa.
      </p>

      <Field
        label="Código de invitación"
        hint="Tu código no se guarda en este dispositivo — solo se usa para crear tu empresa."
        className="mt-6"
      >
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ingresa tu código"
          autoFocus
        />
      </Field>
    </div>
  );
}
