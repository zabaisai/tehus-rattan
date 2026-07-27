import { BadRequestException } from '@nestjs/common';
import { WhatsAppEmbeddedSignupStateService } from './whatsapp-embedded-signup-state.service';

function buildPrisma() {
  return {
    whatsAppEmbeddedSignupState: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    },
  } as any;
}

const config = { get: jest.fn().mockReturnValue(undefined) } as any;

describe('WhatsAppEmbeddedSignupStateService', () => {
  let prisma: any;
  let service: WhatsAppEmbeddedSignupStateService;

  beforeEach(() => {
    prisma = buildPrisma();
    service = new WhatsAppEmbeddedSignupStateService(prisma, config);
  });

  describe('issueForCompany', () => {
    it('invalidates prior unused states, stores only a hash, and returns the plaintext', async () => {
      const { state, expiresAt } = await service.issueForCompany(
        'company-a',
        'user-1',
        '203.0.113.0/24',
      );

      expect(
        prisma.whatsAppEmbeddedSignupState.deleteMany,
      ).toHaveBeenCalledWith({
        where: { companyId: 'company-a', usedAt: null },
      });
      // 32 bytes hex = 64 chars.
      expect(state).toMatch(/^[a-f0-9]{64}$/);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

      const created =
        prisma.whatsAppEmbeddedSignupState.create.mock.calls[0][0].data;
      // The plaintext is NEVER stored — only its SHA-256 hash.
      expect(created.stateHash).not.toBe(state);
      expect(created.stateHash).toMatch(/^[a-f0-9]{64}$/);
      expect(created.companyId).toBe('company-a');
      expect(JSON.stringify(created)).not.toContain(state);
    });

    it('honors WHATSAPP_EMBEDDED_SIGNUP_STATE_TTL_MINUTES when set to a positive integer', () => {
      config.get.mockReturnValueOnce('3');
      expect(service.ttlMinutes()).toBe(3);
      config.get.mockReturnValueOnce('bogus');
      expect(service.ttlMinutes()).toBe(10);
    });
  });

  describe('consumeForCompany (single-use CAS)', () => {
    it('succeeds exactly once when the CAS updates one row', async () => {
      prisma.whatsAppEmbeddedSignupState.updateMany.mockResolvedValue({
        count: 1,
      });
      await expect(
        service.consumeForCompany('company-a', 'a'.repeat(64)),
      ).resolves.toBeUndefined();

      const where =
        prisma.whatsAppEmbeddedSignupState.updateMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ companyId: 'company-a', usedAt: null });
      expect(where.expiresAt.gt).toBeInstanceOf(Date);
    });

    it('rejects (generic) when no row matches — expired, reused, missing, or wrong company', async () => {
      prisma.whatsAppEmbeddedSignupState.updateMany.mockResolvedValue({
        count: 0,
      });
      await expect(
        service.consumeForCompany('company-a', 'b'.repeat(64)),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('binds consumption to the company (a state from company-b cannot be consumed by company-a)', async () => {
      prisma.whatsAppEmbeddedSignupState.updateMany.mockResolvedValue({
        count: 0,
      });
      await expect(
        service.consumeForCompany('company-a', 'c'.repeat(64)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(
        prisma.whatsAppEmbeddedSignupState.updateMany.mock.calls[0][0].where
          .companyId,
      ).toBe('company-a');
    });
  });

  describe('hasActiveState', () => {
    it('is true only when an unused, unexpired state exists', async () => {
      prisma.whatsAppEmbeddedSignupState.findFirst.mockResolvedValueOnce({
        id: 'x',
      });
      expect(await service.hasActiveState('company-a')).toBe(true);
      prisma.whatsAppEmbeddedSignupState.findFirst.mockResolvedValueOnce(null);
      expect(await service.hasActiveState('company-a')).toBe(false);
    });
  });
});
