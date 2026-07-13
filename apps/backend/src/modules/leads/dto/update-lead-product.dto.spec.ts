import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateLeadProductDto } from './update-lead-product.dto';

async function validatePayload(payload: Record<string, unknown>) {
  const instance = plainToInstance(UpdateLeadProductDto, payload);
  return validate(instance, { whitelist: true, forbidNonWhitelisted: true });
}

describe('UpdateLeadProductDto', () => {
  it('accepts an empty payload (all fields optional)', async () => {
    const errors = await validatePayload({});
    expect(errors).toHaveLength(0);
  });

  it('accepts a partial payload', async () => {
    const errors = await validatePayload({ quantity: 2 });
    expect(errors).toHaveLength(0);
  });

  it('rejects a quantity below 1', async () => {
    const errors = await validatePayload({ quantity: 0 });
    expect(errors.some((e) => e.property === 'quantity')).toBe(true);
  });

  it('rejects a negative unitPrice', async () => {
    const errors = await validatePayload({ unitPrice: -50 });
    expect(errors.some((e) => e.property === 'unitPrice')).toBe(true);
  });

  it('rejects a productId field (not editable via update)', async () => {
    const errors = await validatePayload({ productId: 'product-b' });
    expect(errors.some((e) => e.property === 'productId')).toBe(true);
  });
});
