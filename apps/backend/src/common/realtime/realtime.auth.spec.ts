import { RealtimeAuthService } from './realtime.auth';

describe('RealtimeAuthService', () => {
  let jwt: { verify: jest.Mock };
  let prisma: { userSession: { findUnique: jest.Mock } };
  let service: RealtimeAuthService;

  const valido = {
    sub: 'user-1',
    companyId: 'company-a',
    role: 'AGENT',
    sid: 'session-1',
  };

  // Una sesión activa que casa con el token de `valido`.
  const sesionActiva = {
    userId: 'user-1',
    companyId: 'company-a',
    status: 'ACTIVE',
    revokedAt: null,
    loggedOutAt: null,
    lastSeenAt: new Date(),
  };

  beforeEach(() => {
    jwt = { verify: jest.fn().mockReturnValue(valido) };
    prisma = {
      userSession: { findUnique: jest.fn().mockResolvedValue(sesionActiva) },
    };
    service = new RealtimeAuthService(jwt as never, prisma as never);
  });

  describe('extracción del token', () => {
    it('lo toma de auth.token, que no viaja en la URL', async () => {
      const id = await service.authenticate({ auth: { token: 'tok' } });

      expect(jwt.verify).toHaveBeenCalledWith('tok', { algorithms: ['HS256'] });
      expect(id?.userId).toBe('user-1');
    });

    it('acepta la cabecera Authorization: Bearer', async () => {
      const id = await service.authenticate({
        headers: { authorization: 'Bearer tok' },
      });

      expect(jwt.verify).toHaveBeenCalledWith('tok', { algorithms: ['HS256'] });
      expect(id).not.toBeNull();
    });

    it('auth.token tiene prioridad sobre la cabecera', async () => {
      await service.authenticate({
        auth: { token: 'de-auth' },
        headers: { authorization: 'Bearer de-cabecera' },
      });

      expect(jwt.verify).toHaveBeenCalledWith('de-auth', {
        algorithms: ['HS256'],
      });
    });

    it.each([
      ['sin nada', {}],
      ['auth vacío', { auth: {} }],
      ['token en blanco', { auth: { token: '   ' } }],
      ['cabecera sin Bearer', { headers: { authorization: 'tok' } }],
      ['Bearer vacío', { headers: { authorization: 'Bearer ' } }],
      ['token no textual', { auth: { token: 12345 } }],
    ])('rechaza %s sin verificar nada', async (_caso, handshake) => {
      expect(await service.authenticate(handshake as never)).toBeNull();
      expect(jwt.verify).not.toHaveBeenCalled();
    });
  });

  describe('la empresa SIEMPRE sale del token', () => {
    it('devuelve el companyId del payload', async () => {
      const id = await service.authenticate({ auth: { token: 'tok' } });

      expect(id?.companyId).toBe('company-a');
    });

    it('IGNORA un companyId enviado por el cliente en el handshake', async () => {
      // Es el punto crítico de todo el gateway: si se aceptara, cualquiera
      // escucharía las conversaciones de otra empresa cambiando un valor en
      // el navegador.
      const id = await service.authenticate({
        auth: { token: 'tok', companyId: 'company-INTRUSA' },
      });

      expect(id?.companyId).toBe('company-a');
    });

    it('IGNORA un companyId enviado por cabecera', async () => {
      const id = await service.authenticate({
        auth: { token: 'tok' },
        headers: { 'x-company-id': 'company-INTRUSA' },
      });

      expect(id?.companyId).toBe('company-a');
    });
  });

  describe('la sesión se valida contra la base', () => {
    it('rechaza un token cuya sesión fue revocada', async () => {
      prisma.userSession.findUnique.mockResolvedValue({
        ...sesionActiva,
        revokedAt: new Date(),
      });

      expect(await service.authenticate({ auth: { token: 'tok' } })).toBeNull();
    });

    it('rechaza un token cuya sesión ya no existe', async () => {
      prisma.userSession.findUnique.mockResolvedValue(null);

      expect(await service.authenticate({ auth: { token: 'tok' } })).toBeNull();
    });

    it('rechaza una sesión cerrada (logout) o no ACTIVE', async () => {
      prisma.userSession.findUnique.mockResolvedValue({
        ...sesionActiva,
        loggedOutAt: new Date(),
      });
      expect(await service.authenticate({ auth: { token: 'tok' } })).toBeNull();

      prisma.userSession.findUnique.mockResolvedValue({
        ...sesionActiva,
        status: 'REVOKED',
      });
      expect(await service.authenticate({ auth: { token: 'tok' } })).toBeNull();
    });

    it('rechaza un token sin sid', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1', companyId: 'company-a' });

      expect(await service.authenticate({ auth: { token: 'tok' } })).toBeNull();
      expect(prisma.userSession.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('rechazos', () => {
    it('un token inválido devuelve null en vez de lanzar', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt malformed');
      });

      await expect(
        service.authenticate({ auth: { token: 'malo' } }),
      ).resolves.toBeNull();
    });

    it('un SUPER_ADMIN de plataforma (companyId null) NO recibe canal', async () => {
      // No pertenece a ninguna empresa. Ver sus conversaciones exige una
      // sesión de soporte activa y auditada, que es otro camino.
      jwt.verify.mockReturnValue({
        sub: 'plat-1',
        companyId: null,
        role: 'SUPER_ADMIN',
        sid: 'session-plat',
      });

      expect(await service.authenticate({ auth: { token: 'tok' } })).toBeNull();
    });

    it('un token sin sub se rechaza', async () => {
      jwt.verify.mockReturnValue({ companyId: 'company-a', sid: 'session-1' });

      expect(await service.authenticate({ auth: { token: 'tok' } })).toBeNull();
    });

    it('no registra el token ni el motivo del fallo', async () => {
      const debug = jest
        .spyOn(
          (service as unknown as { logger: { debug: (m: string) => void } })
            .logger,
          'debug',
        )
        .mockImplementation(() => undefined);
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt malformed: eyJhbGciOiJIUzI1NiJ9.secreto');
      });

      await service.authenticate({
        auth: { token: 'eyJhbGciOiJIUzI1NiJ9.secreto' },
      });

      const registrado = JSON.stringify(debug.mock.calls);
      expect(registrado).not.toContain('secreto');
      expect(registrado).not.toContain('eyJhbGci');
      debug.mockRestore();
    });
  });

  it('conserva el rol para autorizaciones posteriores', async () => {
    jwt.verify.mockReturnValue({ ...valido, role: 'ADMIN' });

    expect((await service.authenticate({ auth: { token: 'tok' } }))?.role).toBe(
      'ADMIN',
    );
  });
});
