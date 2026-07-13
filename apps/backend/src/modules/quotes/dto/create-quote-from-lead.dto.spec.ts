import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateQuoteFromLeadDto } from './create-quote-from-lead.dto';

async function validatePayload(payload: Record<string, unknown>) {
  const instance = plainToInstance(CreateQuoteFromLeadDto, payload);
  return validate(instance, { whitelist: true, forbidNonWhitelisted: true });
}

describe('CreateQuoteFromLeadDto', () => {
  it('accepts an empty payload (all fields optional)', async () => {
    const errors = await validatePayload({});
    expect(errors).toHaveLength(0);
  });

  it('accepts a full valid payload', async () => {
    const errors = await validatePayload({
      title: 'Cotización sala Primavera',
      notes: 'Entrega en 30 días',
      validUntil: '2026-08-01',
      discount: 50000,
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects a negative discount', async () => {
    const errors = await validatePayload({ discount: -1 });
    expect(errors.some((e) => e.property === 'discount')).toBe(true);
  });

  it('rejects an invalid validUntil date', async () => {
    const errors = await validatePayload({ validUntil: 'not-a-date' });
    expect(errors.some((e) => e.property === 'validUntil')).toBe(true);
  });

  it('rejects a createdById field (server-derived from the authenticated user, not client input)', async () => {
    const errors = await validatePayload({ createdById: 'user-x' });
    expect(errors.some((e) => e.property === 'createdById')).toBe(true);
  });

  it('rejects a subtotal field (backend-calculated from the lead products)', async () => {
    const errors = await validatePayload({ subtotal: 1000 });
    expect(errors.some((e) => e.property === 'subtotal')).toBe(true);
  });

  it('rejects a total field (backend-calculated from the lead products)', async () => {
    const errors = await validatePayload({ total: 1000 });
    expect(errors.some((e) => e.property === 'total')).toBe(true);
  });
});
