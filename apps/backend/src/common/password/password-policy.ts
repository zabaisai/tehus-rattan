import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

// Single source of truth for the password policy — shared by user creation,
// password change, and password recovery so the rules can never drift apart.
// Recommended minimum: 10 chars with lower, upper, digit and a special char.
export const PASSWORD_MIN_LENGTH = 10;

// Each rule returns true when the password SATISFIES it. `label` is safe to show
// in the UI (a requirements checklist) — it never contains the password.
export const PASSWORD_RULES: ReadonlyArray<{
  id: string;
  label: string;
  test: (pw: string) => boolean;
}> = [
  {
    id: 'length',
    label: `Al menos ${PASSWORD_MIN_LENGTH} caracteres`,
    test: (pw) => pw.length >= PASSWORD_MIN_LENGTH,
  },
  { id: 'lower', label: 'Una letra minúscula', test: (pw) => /[a-z]/.test(pw) },
  { id: 'upper', label: 'Una letra mayúscula', test: (pw) => /[A-Z]/.test(pw) },
  { id: 'digit', label: 'Un número', test: (pw) => /[0-9]/.test(pw) },
  {
    id: 'special',
    label: 'Un carácter especial',
    test: (pw) => /[^A-Za-z0-9]/.test(pw),
  },
];

// The list of UNMET requirement labels ([] means the password is valid).
export function checkPasswordPolicy(password: unknown): string[] {
  if (typeof password !== 'string') return ['La contraseña es requerida'];
  return PASSWORD_RULES.filter((rule) => !rule.test(password)).map(
    (rule) => rule.label,
  );
}

export function isStrongPassword(password: unknown): boolean {
  return checkPasswordPolicy(password).length === 0;
}

// class-validator decorator built on the same rules, so DTOs and the reset flow
// enforce an identical policy.
export function IsStrongPassword(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          return isStrongPassword(value);
        },
        defaultMessage(args: ValidationArguments) {
          const unmet = checkPasswordPolicy(args.value);
          return `La contraseña no cumple la política de seguridad: ${unmet.join(', ')}.`;
        },
      },
    });
  };
}
