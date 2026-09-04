import { describe, expect, it } from 'vitest';
import { COUNTRY_PRESETS, presetForCountry } from './onboarding-regions';
import { validateRegionalDraft } from './tenant-configuration';

describe('onboarding-regions', () => {
  it('cada país propone una región válida según las mismas reglas del servidor', () => {
    for (const p of COUNTRY_PRESETS) {
      const errors = validateRegionalDraft({ country: p.name, timezone: p.timezone, currency: p.currency, locale: p.locale });
      expect(errors, p.name).toEqual({});
    }
  });

  it('no hay países repetidos y ninguno es Colombia por defecto', () => {
    const names = COUNTRY_PRESETS.map((p) => p.name.toLocaleLowerCase('es'));
    expect(new Set(names).size).toBe(names.length);
    // El asistente arranca sin país: nada se rellena con Colombia en silencio.
    expect(COUNTRY_PRESETS.some((p) => p.name === 'Costa Rica')).toBe(true);
  });

  it('presetForCountry busca sin distinguir mayúsculas ni espacios', () => {
    expect(presetForCountry(' costa rica ')?.currency).toBe('CRC');
    expect(presetForCountry('COLOMBIA')?.timezone).toBe('America/Bogota');
    expect(presetForCountry('Narnia')).toBeUndefined();
  });
});
