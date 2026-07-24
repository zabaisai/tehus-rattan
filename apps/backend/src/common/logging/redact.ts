// Centralized redaction for anything that might be logged. Header/field names
// are matched case-insensitively; values are replaced with a fixed marker so a
// secret's length is not even leaked.
const REDACTED = '[REDACTED]';

// Sensitive by NAME (headers or object keys). Never log these values:
// Authorization/cookies, the auth JWT, refresh/device tokens, DB URL, the
// WhatsApp app secret and token-encryption key, and any generic secret/password.
const SENSITIVE_KEY = /^(authorization|cookie|set-cookie|x-hub-signature(-256)?|token|access[_-]?token|refresh[_-]?token|jwt|device[_-]?id|password|secret|database_url|whatsapp_app_secret|whatsapp_token_encryption_key|jwt_secret)$/i;

export function redactKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

// Mask a phone number (PII) for logs, keeping only the last 4 digits so a line
// is still correlatable without exposing the full number.
export function maskPhone(value: string | null | undefined): string {
  if (!value) return '(none)';
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `****${digits.slice(-4)}`;
}

// Shallow-redact a headers/params-like record for safe logging.
export function redactObject(
  input: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!input) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = redactKey(key) ? REDACTED : value;
  }
  return out;
}
