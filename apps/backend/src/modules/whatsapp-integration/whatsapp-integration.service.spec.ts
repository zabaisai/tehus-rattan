import { NotFoundException } from '@nestjs/common';
import { WhatsAppIntegrationService } from './whatsapp-integration.service';

describe('WhatsAppIntegrationService', () => {
  let prisma: any;
  let service: WhatsAppIntegrationService;

  const connectedIntegration = {
    id: 'integration-a',
    companyId: 'company-a',
    phoneNumberId: '1234567890',
    displayPhoneNumber: '+50255550000',
    wabaId: 'waba-a',
    status: 'CONNECTED',
  };

  beforeEach(() => {
    prisma = {
      whatsAppIntegration: { findFirst: jest.fn() },
    };
    service = new WhatsAppIntegrationService(prisma);
  });

  describe('findConnectedByPhoneNumberId', () => {
    it('returns the connected integration for that phoneNumberId', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(
        connectedIntegration,
      );

      const result = await service.findConnectedByPhoneNumberId('1234567890');

      expect(prisma.whatsAppIntegration.findFirst).toHaveBeenCalledWith({
        where: { phoneNumberId: '1234567890', status: 'CONNECTED' },
        select: {
          id: true,
          companyId: true,
          phoneNumberId: true,
          displayPhoneNumber: true,
          wabaId: true,
          status: true,
        },
      });
      expect(result).toEqual(connectedIntegration);
    });

    it('trims the phoneNumberId before querying', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(
        connectedIntegration,
      );

      await service.findConnectedByPhoneNumberId('  1234567890  ');

      expect(prisma.whatsAppIntegration.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { phoneNumberId: '1234567890', status: 'CONNECTED' },
        }),
      );
    });

    it('returns null when no integration matches that phoneNumberId', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(null);

      const result = await service.findConnectedByPhoneNumberId('unknown-id');

      expect(result).toBeNull();
    });

    it.each(['DISCONNECTED', 'PENDING', 'REVOKED'])(
      'returns null when the only matching integration is %s',
      async () => {
        // The real query filters status: CONNECTED at the DB level, so a
        // non-connected integration never matches and Prisma returns null.
        prisma.whatsAppIntegration.findFirst.mockResolvedValue(null);

        const result =
          await service.findConnectedByPhoneNumberId('1234567890');

        expect(prisma.whatsAppIntegration.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { phoneNumberId: '1234567890', status: 'CONNECTED' },
          }),
        );
        expect(result).toBeNull();
      },
    );

    it('returns null and does not query when phoneNumberId is empty', async () => {
      const result = await service.findConnectedByPhoneNumberId('');

      expect(result).toBeNull();
      expect(prisma.whatsAppIntegration.findFirst).not.toHaveBeenCalled();
    });

    it('returns null and does not query when phoneNumberId is only whitespace', async () => {
      const result = await service.findConnectedByPhoneNumberId('   ');

      expect(result).toBeNull();
      expect(prisma.whatsAppIntegration.findFirst).not.toHaveBeenCalled();
    });

    it('never selects accessTokenEncrypted for the inbound lookup', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(
        connectedIntegration,
      );

      await service.findConnectedByPhoneNumberId('1234567890');

      const call = prisma.whatsAppIntegration.findFirst.mock.calls[0][0];
      expect(call.select).toBeDefined();
      expect(call.select.accessTokenEncrypted).toBeUndefined();
      expect(Object.keys(call.select)).not.toContain('accessTokenEncrypted');
    });
  });

  describe('findConnectedByCompanyId', () => {
    const connectedIntegrationWithToken = {
      ...connectedIntegration,
      accessTokenEncrypted: 'encrypted-token-value',
    };

    it('returns the connected integration for that company, including accessTokenEncrypted', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(
        connectedIntegrationWithToken,
      );

      const result = await service.findConnectedByCompanyId('company-a');

      expect(prisma.whatsAppIntegration.findFirst).toHaveBeenCalledWith({
        where: { companyId: 'company-a', status: 'CONNECTED' },
      });
      expect(result).toEqual(connectedIntegrationWithToken);
      expect(result?.accessTokenEncrypted).toBe('encrypted-token-value');
    });

    it('trims the companyId before querying', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(
        connectedIntegrationWithToken,
      );

      await service.findConnectedByCompanyId('  company-a  ');

      expect(prisma.whatsAppIntegration.findFirst).toHaveBeenCalledWith({
        where: { companyId: 'company-a', status: 'CONNECTED' },
      });
    });

    it('returns null when no integration matches that company', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(null);

      const result = await service.findConnectedByCompanyId('company-b');

      expect(result).toBeNull();
    });

    it('returns null when the company integration is not CONNECTED', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(null);

      const result = await service.findConnectedByCompanyId('company-a');

      expect(prisma.whatsAppIntegration.findFirst).toHaveBeenCalledWith({
        where: { companyId: 'company-a', status: 'CONNECTED' },
      });
      expect(result).toBeNull();
    });

    it('returns null and does not query when companyId is empty or whitespace', async () => {
      const emptyResult = await service.findConnectedByCompanyId('');
      const blankResult = await service.findConnectedByCompanyId('   ');

      expect(emptyResult).toBeNull();
      expect(blankResult).toBeNull();
      expect(prisma.whatsAppIntegration.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('assertConnectedByCompanyId', () => {
    it('returns the integration when it exists and is connected', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(
        connectedIntegration,
      );

      const result = await service.assertConnectedByCompanyId('company-a');

      expect(result).toEqual(connectedIntegration);
    });

    it('throws NotFoundException when there is no connected integration', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(null);

      await expect(
        service.assertConnectedByCompanyId('company-b'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
