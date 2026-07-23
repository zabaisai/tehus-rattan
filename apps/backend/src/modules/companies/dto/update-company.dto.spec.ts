import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCompanyDto } from './update-company.dto';

// Mirrors the exact ValidationPipe options configured globally in main.ts,
// so this test proves what actually happens on the wire, not just what the
// DTO class looks like in isolation.
async function validatePayload(payload: Record<string, unknown>) {
  const instance = plainToInstance(UpdateCompanyDto, payload);
  return validate(instance, { whitelist: true, forbidNonWhitelisted: true });
}

describe('UpdateCompanyDto', () => {
  it('accepts a full valid payload of editable fields', async () => {
    const errors = await validatePayload({
      name: 'Tehus Rattan',
      phone: '+573000000000',
      businessType: 'Muebles',
      city: 'Medellín',
      country: 'Colombia',
      email: 'contacto@tehus.test',
      website: 'https://tehus.test',
      description: 'Muebles de rattan',
      primaryColor: '#A57014',
      accentColor: '#FDD',
      backgroundColor: '#FAF8F3',
      settings: { sellsProducts: true },
    });

    expect(errors).toHaveLength(0);
  });

  it('accepts a partial payload', async () => {
    const errors = await validatePayload({ city: 'Bogotá' });
    expect(errors).toHaveLength(0);
  });

  it('rejects an invalid email', async () => {
    const errors = await validatePayload({ email: 'not-an-email' });
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejects a non-hex primaryColor', async () => {
    const errors = await validatePayload({ primaryColor: 'gold' });
    expect(errors.some((e) => e.property === 'primaryColor')).toBe(true);
  });

  it('rejects a malformed hex color missing the #', async () => {
    const errors = await validatePayload({ accentColor: 'FDDC7F' });
    expect(errors.some((e) => e.property === 'accentColor')).toBe(true);
  });

  it.each(['id', 'status', 'slug', 'companyId', 'createdAt', 'updatedAt', 'logoUrl', 'secondaryLogoUrl'])(
    'rejects the forbidden field "%s" instead of silently ignoring it',
    async (field) => {
      const errors = await validatePayload({ name: 'Tehus Rattan', [field]: 'anything' });
      expect(errors.length).toBeGreaterThan(0);
    },
  );

  describe('fiscal identity fields', () => {
    it('accepts the optional fiscal fields', async () => {
      const errors = await validatePayload({
        legalName: 'Empresa Ejemplo S.A.S',
        taxId: '900123456-7',
        address: 'Calle 10 #20-30',
        quoteFooter: 'Precios sujetos a cambio sin previo aviso.',
      });
      expect(errors).toHaveLength(0);
    });

    it('trims surrounding whitespace on fiscal fields', async () => {
      const instance = plainToInstance(UpdateCompanyDto, {
        legalName: '  Empresa Ejemplo  ',
        taxId: '  900123456-7  ',
      });
      expect(instance.legalName).toBe('Empresa Ejemplo');
      expect(instance.taxId).toBe('900123456-7');
    });

    it('rejects a taxId longer than the max length', async () => {
      const errors = await validatePayload({ taxId: 'X'.repeat(51) });
      expect(errors.some((e) => e.property === 'taxId')).toBe(true);
    });

    it('rejects a legalName longer than the max length', async () => {
      const errors = await validatePayload({ legalName: 'X'.repeat(151) });
      expect(errors.some((e) => e.property === 'legalName')).toBe(true);
    });

    it('rejects a non-string fiscal field', async () => {
      const errors = await validatePayload({ taxId: 12345 });
      expect(errors.some((e) => e.property === 'taxId')).toBe(true);
    });
  });

  describe('fiscal field security', () => {
    it('accepts Unicode (accents/emoji) within the length limit', async () => {
      const errors = await validatePayload({
        legalName: 'Muebles Ñandú S.A.S 🌿',
        address: 'Cra 7 #12-34, 3.º piso — Bogotá',
      });
      expect(errors).toHaveLength(0);
    });

    it('accepts and preserves internal newlines in quoteFooter (only ends are trimmed)', async () => {
      const body = '  Línea 1\nLínea 2\nLínea 3  ';
      const instance = plainToInstance(UpdateCompanyDto, { quoteFooter: body });
      // Internal newlines survive; only leading/trailing whitespace is stripped.
      expect(instance.quoteFooter).toBe('Línea 1\nLínea 2\nLínea 3');
      const errors = await validate(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors).toHaveLength(0);
    });

    it('stores HTML/script-like content verbatim as a string (escaped safely at render time, never executed)', async () => {
      // The DTO does not sanitize — it is stored as-is and React escapes it as
      // text when rendered (no dangerouslySetInnerHTML). This asserts it is
      // accepted as a plain string, not that it is stripped.
      const errors = await validatePayload({
        quoteFooter: '<script>alert(1)</script> & <b>x</b>',
        legalName: '<img src=x onerror=alert(1)>',
      });
      expect(errors).toHaveLength(0);
    });

    it('normalizes a whitespace-only value to an empty string', async () => {
      const instance = plainToInstance(UpdateCompanyDto, { taxId: '    ' });
      expect(instance.taxId).toBe('');
      const errors = await validate(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors).toHaveLength(0);
    });

    it('accepts values exactly at the max length but rejects one over', async () => {
      expect(await validatePayload({ address: 'x'.repeat(200) })).toHaveLength(0);
      const over = await validatePayload({ address: 'x'.repeat(201) });
      expect(over.some((e) => e.property === 'address')).toBe(true);
    });

    it('accepts a long multi-line quoteFooter up to 2000 chars', async () => {
      const errors = await validatePayload({ quoteFooter: 'l\n'.repeat(1000) });
      expect(errors).toHaveLength(0);
    });

    it('accepts null on a fiscal field (clearing it), passing validation', async () => {
      const errors = await validatePayload({
        legalName: null,
        taxId: null,
        address: null,
        quoteFooter: null,
      });
      expect(errors).toHaveLength(0);
    });
  });
});
