import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PasswordRequirements } from "@/components/auth/PasswordRequirements";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

import type { AdminState } from "@/lib/onboarding-wizard";

export type { AdminState };

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
          {/* La política es la MISMA que aplica el backend (`IsStrongPassword`):
              la lista viva de requisitos sale de `PASSWORD_RULES`, así que no
              puede divergir de lo que el servidor exige. */}
          <div>
            <Field label="Contraseña" required>
              <Input
                type="password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                autoComplete="new-password"
                value={value.password}
                onChange={(e) => onChange({ password: e.target.value })}
                placeholder="••••••••••"
              />
            </Field>
            <PasswordRequirements password={value.password} />
          </div>

          <Field label="Confirmar contraseña" required>
            <Input
              type="password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              autoComplete="new-password"
              value={value.confirmPassword}
              onChange={(e) => onChange({ confirmPassword: e.target.value })}
              placeholder="••••••••••"
            />
          </Field>
        </div>
      </div>
    </div>
  );
}
