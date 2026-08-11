'use client';

import { PASSWORD_RULES } from '@/lib/password-policy';

// Live checklist of the password requirements. Accessible: the met/pending state
// is conveyed with text (sr-only) as well as colour/icon, and the list updates
// as the user types.
export function PasswordRequirements({ password }: { password: string }) {
  return (
    <ul className="mt-2 space-y-1" aria-label="Requisitos de la contraseña">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <li
            key={rule.id}
            className={`flex items-center gap-1.5 text-xs ${
              met ? 'text-status-success-strong' : 'text-neutral-400'
            }`}
          >
            <span aria-hidden="true">{met ? '✓' : '○'}</span>
            <span>{rule.label}</span>
            <span className="sr-only">{met ? ' (cumplido)' : ' (pendiente)'}</span>
          </li>
        );
      })}
    </ul>
  );
}
