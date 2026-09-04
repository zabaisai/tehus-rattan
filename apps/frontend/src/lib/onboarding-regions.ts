/**
 * Países sugeridos en el onboarding y los valores regionales que PROPONEN.
 *
 * Son sugerencias: al elegir un país se rellenan zona horaria, moneda e
 * idioma, pero la persona puede cambiarlos (y el servidor valida el resultado
 * con las mismas reglas de la Fase 2: IANA, ISO 4217, BCP 47). La lista no es
 * un catálogo cerrado: «Otro país» deja escribir cualquier país.
 */
export interface CountryPreset {
  /** Nombre visible y valor que se guarda en `Company.country`. */
  name: string;
  timezone: string;
  currency: string;
  locale: string;
}

export const COUNTRY_PRESETS: readonly CountryPreset[] = [
  { name: 'Colombia', timezone: 'America/Bogota', currency: 'COP', locale: 'es-CO' },
  { name: 'Costa Rica', timezone: 'America/Costa_Rica', currency: 'CRC', locale: 'es-CR' },
  { name: 'México', timezone: 'America/Mexico_City', currency: 'MXN', locale: 'es-MX' },
  { name: 'Argentina', timezone: 'America/Buenos_Aires', currency: 'ARS', locale: 'es-AR' },
  { name: 'Chile', timezone: 'America/Santiago', currency: 'CLP', locale: 'es-CL' },
  { name: 'Perú', timezone: 'America/Lima', currency: 'PEN', locale: 'es-PE' },
  { name: 'Ecuador', timezone: 'America/Guayaquil', currency: 'USD', locale: 'es-EC' },
  { name: 'Panamá', timezone: 'America/Panama', currency: 'USD', locale: 'es-PA' },
  { name: 'Guatemala', timezone: 'America/Guatemala', currency: 'GTQ', locale: 'es-GT' },
  { name: 'Honduras', timezone: 'America/Tegucigalpa', currency: 'HNL', locale: 'es-HN' },
  { name: 'El Salvador', timezone: 'America/El_Salvador', currency: 'USD', locale: 'es-SV' },
  { name: 'Nicaragua', timezone: 'America/Managua', currency: 'NIO', locale: 'es-NI' },
  { name: 'República Dominicana', timezone: 'America/Santo_Domingo', currency: 'DOP', locale: 'es-DO' },
  { name: 'Uruguay', timezone: 'America/Montevideo', currency: 'UYU', locale: 'es-UY' },
  { name: 'Paraguay', timezone: 'America/Asuncion', currency: 'PYG', locale: 'es-PY' },
  { name: 'Bolivia', timezone: 'America/La_Paz', currency: 'BOB', locale: 'es-BO' },
  { name: 'Venezuela', timezone: 'America/Caracas', currency: 'VES', locale: 'es-VE' },
  { name: 'España', timezone: 'Europe/Madrid', currency: 'EUR', locale: 'es-ES' },
  { name: 'Estados Unidos', timezone: 'America/New_York', currency: 'USD', locale: 'en-US' },
  { name: 'Brasil', timezone: 'America/Sao_Paulo', currency: 'BRL', locale: 'pt-BR' },
] as const;

/** Valor del selector para «otro país» (texto libre). */
export const OTHER_COUNTRY = '__other__';

export function presetForCountry(name: string): CountryPreset | undefined {
  const key = name.trim().toLocaleLowerCase('es');
  return COUNTRY_PRESETS.find((p) => p.name.toLocaleLowerCase('es') === key);
}

/** Región vacía: obliga a elegir país (o escribirlo) antes de continuar. */
export const EMPTY_REGION = { country: '', timezone: '', currency: '', locale: '' } as const;
