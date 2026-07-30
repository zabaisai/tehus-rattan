import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PlatformWhatsAppIntegrationService } from './platform-whatsapp-integration.service';

// All fictitious — no real company, no real Meta credentials, no real token.
const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';
const ACTOR_ID = 'super-admin-1';

const dto = {
  supportSessionId: 'session-1',
  phoneNumberId: 'phone-a',
  accessToken: 'plain-meta-token',
  displayPhoneNumber: '+573001234567',
  wabaId: 'waba-a',
};

const actor = {
  userId: ACTOR_ID,
  role: 'SUPER_ADMIN' as any,
  ipPreview: '203.0.113.x',
  userAgent: 'jest',
};

function activeSessionFor(companyId: string) {
  return {
    id: 'session-1',
    actorUserId: ACTOR_ID,
    companyId,
    reason: 'Alta de WhatsApp solicitada por el cliente',
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    company: { id: companyId, name: 'Empresa QA' },
  };
}

describe('PlatformWhatsAppIntegrationService (support-gated manual connect)', () => {
  let supportSessions: any;
  let management: any;
  let service: PlatformWhatsAppIntegrationService;

  beforeEach(() => {
    supportSessions = {
      validateActiveSupportSession: jest
        .fn()
        .mockResolvedValue(activeSessionFor(COMPANY_A)),
    };
    // The hardened service is mocked here: this suite is about the support
    // gate. Meta is therefore never reached, in any case.
    management = {
      connectOrUpdateForCompany: jest.fn().mockResolvedValue({
        id: 'integration-a',
        companyId: COMPANY_A,
        phoneNumberId: 'phone-a',
        status: 'CONNECTED',
      }),
    };
    service = new PlatformWhatsAppIntegrationService(
      supportSessions,
      management,
    );
  });

  describe('rejects without a valid support session', () => {
    it('no support session at all -> propagates 404 and never writes', async () => {
      supportSessions.validateActiveSupportSession.mockRejectedValue(
        new NotFoundException('Sesión de soporte no encontrada'),
      );

      await expect(
        service.connectForCompany(COMPANY_A, dto, actor),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(management.connectOrUpdateForCompany).not.toHaveBeenCalled();
    });

    it('expired session -> propagates 403 and never writes', async () => {
      supportSessions.validateActiveSupportSession.mockRejectedValue(
        new ForbiddenException('La sesión de soporte expiró'),
      );

      await expect(
        service.connectForCompany(COMPANY_A, dto, actor),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(management.connectOrUpdateForCompany).not.toHaveBeenCalled();
    });

    it('session that is not ACTIVE -> propagates 403 and never writes', async () => {
      supportSessions.validateActiveSupportSession.mockRejectedValue(
        new ForbiddenException('La sesión de soporte no está activa'),
      );

      await expect(
        service.connectForCompany(COMPANY_A, dto, actor),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(management.connectOrUpdateForCompany).not.toHaveBeenCalled();
    });

    it('session belonging to a DIFFERENT company -> 403 and never writes', async () => {
      // Live, owned, unexpired session — but for company B, while the route
      // asks for company A.
      supportSessions.validateActiveSupportSession.mockResolvedValue(
        activeSessionFor(COMPANY_B),
      );

      await expect(
        service.connectForCompany(COMPANY_A, dto, actor),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(management.connectOrUpdateForCompany).not.toHaveBeenCalled();
    });

    it('validates the session against the CALLING actor, not a client-sent id', async () => {
      await service.connectForCompany(COMPANY_A, dto, actor);

      expect(supportSessions.validateActiveSupportSession).toHaveBeenCalledWith(
        'session-1',
        ACTOR_ID,
      );
    });
  });

  describe('succeeds with a valid, matching session', () => {
    it('delegates to the hardened service using the SESSION companyId', async () => {
      const result = await service.connectForCompany(COMPANY_A, dto, actor);

      expect(management.connectOrUpdateForCompany).toHaveBeenCalledTimes(1);
      const [companyId, input, forwardedActor] =
        management.connectOrUpdateForCompany.mock.calls[0];

      // The company written to comes from the server-validated session.
      expect(companyId).toBe(COMPANY_A);
      expect(input).toEqual({
        phoneNumberId: 'phone-a',
        accessToken: 'plain-meta-token',
        displayPhoneNumber: '+573001234567',
        wabaId: 'waba-a',
      });
      expect(forwardedActor.userId).toBe(ACTOR_ID);
      expect(result.status).toBe('CONNECTED');
    });

    it('never forwards a companyId taken from the body', async () => {
      const spoofed = { ...dto, companyId: COMPANY_B } as never;

      await service.connectForCompany(COMPANY_A, spoofed, actor);

      const [companyId, input] =
        management.connectOrUpdateForCompany.mock.calls[0];
      expect(companyId).toBe(COMPANY_A);
      expect(input).not.toHaveProperty('companyId');
    });
  });

  describe('audit', () => {
    it('stamps actor, affected company and the support reason', async () => {
      await service.connectForCompany(COMPANY_A, dto, actor);

      const [, , forwardedActor, audit] =
        management.connectOrUpdateForCompany.mock.calls[0];

      expect(audit.action).toBe('WHATSAPP_MANUAL_CONNECTED_VIA_SUPPORT');
      expect(forwardedActor.userId).toBe(ACTOR_ID);
      expect(forwardedActor.role).toBe('SUPER_ADMIN');
      expect(audit.metadata.supportSessionId).toBe('session-1');
      expect(audit.metadata.supportReason).toBe(
        'Alta de WhatsApp solicitada por el cliente',
      );
      expect(audit.metadata.companyName).toBe('Empresa QA');
    });

    it('never records the token, and masks the phone number', async () => {
      await service.connectForCompany(COMPANY_A, dto, actor);

      const [, , , audit] = management.connectOrUpdateForCompany.mock.calls[0];
      const serialized = JSON.stringify(audit);

      expect(serialized).not.toContain('plain-meta-token');
      expect(serialized).not.toContain('accessToken');
      // The full number never appears; only the last 4 digits do.
      expect(serialized).not.toContain('+573001234567');
      expect(audit.metadata.maskedPhoneNumber).toBe('****4567');
    });
  });

  it('rejects a blank companyId in the route before touching the session', async () => {
    await expect(
      service.connectForCompany('   ', dto, actor),
    ).rejects.toThrow();

    expect(supportSessions.validateActiveSupportSession).not.toHaveBeenCalled();
    expect(management.connectOrUpdateForCompany).not.toHaveBeenCalled();
  });
});
