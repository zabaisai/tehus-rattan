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
});
