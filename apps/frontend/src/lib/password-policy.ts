// UI mirror of the backend password policy (apps/backend/src/common/password/
// password-policy.ts). The backend is the enforcing authority; this only drives
// the on-screen requirements checklist and a pre-submit guard so the user gets
// immediate feedback. Keep the rules in sync with the backend.
export const PASSWORD_MIN_LENGTH = 10;

export interface PasswordRule {
  id: string;
  label: string;
  test: (pw: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: "length",
    label: `Al menos ${PASSWORD_MIN_LENGTH} caracteres`,
    test: (pw) => pw.length >= PASSWORD_MIN_LENGTH,
  },
  { id: "lower", label: "Una letra minúscula", test: (pw) => /[a-z]/.test(pw) },
  { id: "upper", label: "Una letra mayúscula", test: (pw) => /[A-Z]/.test(pw) },
  { id: "digit", label: "Un número", test: (pw) => /[0-9]/.test(pw) },
  {
    id: "special",
    label: "Un carácter especial",
    test: (pw) => /[^A-Za-z0-9]/.test(pw),
  },
];

export function isStrongPassword(password: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(password));
}
