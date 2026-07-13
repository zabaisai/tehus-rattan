import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateQuoteDto } from './update-quote.dto';

async function validatePayload(payload: Record<string, unknown>) {
  const instance = plainToInstance(UpdateQuoteDto, payload);
  return validate(instance, { whitelist: true, forbidNonWhitelisted: true });
}

describe('UpdateQuoteDto', () => {
  it('accepts an empty payload (all fields optional)', async () => {
    const errors = await validatePayload({});
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid status', async () => {
    const errors = await validatePayload({ status: 'SENT' });
    expect(errors).toHaveLength(0);
  });

  it('rejects an invalid status', async () => {
    const errors = await validatePayload({ status: 'MAYBE' });
    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });

  it('rejects a negative discount', async () => {
    const errors = await validatePayload({ discount: -100 });
    expect(errors.some((e) => e.property === 'discount')).toBe(true);
  });

  it('rejects a subtotal field (backend-calculated, not client-editable)', async () => {
    const errors = await validatePayload({ subtotal: 1000 });
    expect(errors.some((e) => e.property === 'subtotal')).toBe(true);
  });

  it('rejects a total field (backend-calculated, not client-editable)', async () => {
    const errors = await validatePayload({ total: 1000 });
    expect(errors.some((e) => e.property === 'total')).toBe(true);
  });
});
