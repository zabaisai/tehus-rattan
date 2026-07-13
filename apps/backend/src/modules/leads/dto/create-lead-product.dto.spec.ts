import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateLeadProductDto } from './create-lead-product.dto';

// Mirrors the exact ValidationPipe options configured globally in main.ts,
// so this proves what actually happens on the wire, not just the DTO shape.
async function validatePayload(payload: Record<string, unknown>) {
  const instance = plainToInstance(CreateLeadProductDto, payload);
  return validate(instance, { whitelist: true, forbidNonWhitelisted: true });
}

describe('CreateLeadProductDto', () => {
  it('accepts a minimal valid payload (productId only)', async () => {
    const errors = await validatePayload({ productId: 'product-a' });
    expect(errors).toHaveLength(0);
  });

  it('accepts a full valid payload', async () => {
    const errors = await validatePayload({
      productId: 'product-a',
      quantity: 3,
      unitPrice: 100,
      notes: 'Color natural',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects a missing productId', async () => {
    const errors = await validatePayload({});
    expect(errors.some((e) => e.property === 'productId')).toBe(true);
  });

  it('rejects a quantity below 1', async () => {
    const errors = await validatePayload({ productId: 'product-a', quantity: 0 });
    expect(errors.some((e) => e.property === 'quantity')).toBe(true);
  });

  it('rejects a non-integer quantity', async () => {
    const errors = await validatePayload({ productId: 'product-a', quantity: 1.5 });
    expect(errors.some((e) => e.property === 'quantity')).toBe(true);
  });

  it('rejects a negative unitPrice', async () => {
    const errors = await validatePayload({ productId: 'product-a', unitPrice: -1 });
    expect(errors.some((e) => e.property === 'unitPrice')).toBe(true);
  });
});
