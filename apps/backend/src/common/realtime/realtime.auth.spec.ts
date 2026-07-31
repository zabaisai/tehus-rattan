import { RealtimeAuthService } from './realtime.auth';

describe('RealtimeAuthService', () => {
  let jwt: { verify: jest.Mock };
  let service: RealtimeAuthService;

  const valido = {
    sub: 'user-1',
    companyId: 'company-a',
    role: 'AGENT',
  };

  beforeEach(() => {
    jwt = { verify: jest.fn().mockReturnValue(valido) };
    service = new RealtimeAuthService(jwt as never);
  });

  describe('extracción del token', () => {
    it('lo toma de auth.token, que no viaja en la URL', () => {
      const id = service.authenticate({ auth: { token: 'tok' } });

      expect(jwt.verify).toHaveBeenCalledWith('tok');
      expect(id?.userId).toBe('user-1');
    });

    it('acepta la cabecera Authorization: Bearer', () => {
      const id = service.authenticate({
        headers: { authorization: 'Bearer tok' },
      });

      expect(jwt.verify).toHaveBeenCalledWith('tok');
      expect(id).not.toBeNull();
    });

    it('auth.token tiene prioridad sobre la cabecera', () => {
      service.authenticate({
        auth: { token: 'de-auth' },
        headers: { authorization: 'Bearer de-cabecera' },
      });

      expect(jwt.verify).toHaveBeenCalledWith('de-auth');
    });

    it.each([
      ['sin nada', {}],
      ['auth vacío', { auth: {} }],
      ['token en blanco', { auth: { token: '   ' } }],
      ['cabecera sin Bearer', { headers: { authorization: 'tok' } }],
      ['Bearer vacío', { headers: { authorization: 'Bearer ' } }],
      ['token no textual', { auth: { token: 12345 } }],
    ])('rechaza %s sin verificar nada', (_caso, handshake) => {
      expect(service.authenticate(handshake as never)).toBeNull();
      expect(jwt.verify).not.toHaveBeenCalled();
    });
  });

  describe('la empresa SIEMPRE sale del token', () => {
    it('devuelve el companyId del payload', () => {
      const id = service.authenticate({ auth: { token: 'tok' } });

      expect(id?.companyId).toBe('company-a');
    });

    it('IGNORA un companyId enviado por el cliente en el handshake', () => {
      // Es el punto crítico de todo el gateway: si se aceptara, cualquiera
      // escucharía las conversaciones de otra empresa cambiando un valor en
      // el navegador.
      const id = service.authenticate({
        auth: { token: 'tok', companyId: 'company-INTRUSA' },
      });

      expect(id?.companyId).toBe('company-a');
    });

    it('IGNORA un companyId enviado por cabecera', () => {
      const id = service.authenticate({
        auth: { token: 'tok' },
        headers: { 'x-company-id': 'company-INTRUSA' },
      });

      expect(id?.companyId).toBe('company-a');
    });
  });

  describe('rechazos', () => {
    it('un token inválido devuelve null en vez de lanzar', () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt malformed');
      });

      expect(() =>
        service.authenticate({ auth: { token: 'malo' } }),
      ).not.toThrow();
      expect(service.authenticate({ auth: { token: 'malo' } })).toBeNull();
    });

    it('un SUPER_ADMIN de plataforma (companyId null) NO recibe canal', () => {
      // No pertenece a ninguna empresa. Ver sus conversaciones exige una
      // sesión de soporte activa y auditada, que es otro camino.
      jwt.verify.mockReturnValue({
        sub: 'plat-1',
        companyId: null,
        role: 'SUPER_ADMIN',
      });

      expect(service.authenticate({ auth: { token: 'tok' } })).toBeNull();
    });

    it('un token sin sub se rechaza', () => {
      jwt.verify.mockReturnValue({ companyId: 'company-a' });

      expect(service.authenticate({ auth: { token: 'tok' } })).toBeNull();
    });

    it('no registra el token ni el motivo del fallo', () => {
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

      service.authenticate({ auth: { token: 'eyJhbGciOiJIUzI1NiJ9.secreto' } });

      const registrado = JSON.stringify(debug.mock.calls);
      expect(registrado).not.toContain('secreto');
      expect(registrado).not.toContain('eyJhbGci');
      debug.mockRestore();
    });
  });

  it('conserva el rol para autorizaciones posteriores', () => {
    jwt.verify.mockReturnValue({ ...valido, role: 'ADMIN' });

    expect(service.authenticate({ auth: { token: 'tok' } })?.role).toBe(
      'ADMIN',
    );
  });
});
