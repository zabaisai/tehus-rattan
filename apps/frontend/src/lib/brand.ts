/**
 * Marca por defecto de la PLATAFORMA (TAKTO), tomada de los tokens oficiales
 * de `globals.css` (`--color-brand-primary`, `--color-brand-secondary`) y de
 * `TaktoLogo.tsx`. No se inventa ningún valor.
 *
 * Uso: fallback de PRESENTACIÓN cuando una empresa todavía no ha elegido sus
 * colores. Nunca se persiste como color de la empresa: la apariencia inicial
 * de una empresa nueva es neutral TAKTO y sus colores quedan en `null` hasta
 * que ella los defina. Los valores anteriores (`#A57014`, `#FDDC7F`,
 * `#FAF8F3`) pertenecían a un tenant concreto y no son un fallback válido.
 */
export const PLATFORM_NAME = 'TAKTO';

export const PLATFORM_BRAND = {
  primaryColor: '#131C4A',
  accentColor: '#FF6A00',
  backgroundColor: '#FFFFFF',
} as const;

/** Color a MOSTRAR para un valor de empresa que puede estar vacío. */
export function displayColor(
  value: string | null | undefined,
  fallback: string,
): string {
  const v = value?.trim();
  return v ? v : fallback;
}
