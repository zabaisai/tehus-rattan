import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

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

export function AdminStep({ value, onChange }: AdminStepProps) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-content-primary">
        Administrador
      </h3>
      <p className="mt-1.5 text-sm text-content-secondary">
        Será el usuario principal para gestionar tu empresa en el CRM.
      </p>

      <div className="mt-6 space-y-4">
        <Field label="Nombre" required>
          <Input
            type="text"
            required
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </Field>

        <Field label="Email" required>
          <Input
            type="email"
            required
            value={value.email}
            onChange={(e) => onChange({ email: e.target.value })}
            placeholder="admin@empresa.com"
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* La regla de longitud va como ayuda DEL campo y no como una nota
              suelta al final: así el lector de pantalla la anuncia al entrar
              en la contraseña, que es cuando sirve de algo. */}
          <Field label="Contraseña" required hint="Mínimo 8 caracteres.">
            <Input
              type="password"
              required
              minLength={8}
              value={value.password}
              onChange={(e) => onChange({ password: e.target.value })}
              placeholder="••••••••"
            />
          </Field>

          <Field label="Confirmar contraseña" required>
            <Input
              type="password"
              required
              minLength={8}
              value={value.confirmPassword}
              onChange={(e) => onChange({ confirmPassword: e.target.value })}
              placeholder="••••••••"
            />
          </Field>
        </div>
      </div>
    </div>
  );
}
