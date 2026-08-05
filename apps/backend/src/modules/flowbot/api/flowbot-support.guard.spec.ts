import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { SupportSessionsService } from '../../platform/support-sessions.service';
import { CABECERA_SOPORTE, FlowBotSupportGuard } from './flowbot-support.guard';

/**
 * Un rol de plataforma da acceso a la PLATAFORMA, no a los datos de los
 * clientes. Estas pruebas fijan la única puerta por la que un SUPER_ADMIN
 * entra a los bots de una empresa, y que al entrar deja de ser transversal.
 */
describe('FlowBotSupportGuard', () => {
  let soporte: { validateActiveSupportSession: jest.Mock };
  let guarda: FlowBotSupportGuard;

  const contexto = (req: unknown) =>
    ({
      switchToHttp: () => ({ getRequest: () => req }),
    }) as never;

  /** El `user` se escribe: la guarda lo reemplaza y las pruebas lo leen. */
  const peticion = (
    user: Record<string, unknown> | null,
    cabeceras: Record<string, string> = {},
  ): {
    user: Record<string, unknown> | null;
    headers: Record<string, string>;
  } => ({
    user,
    headers: cabeceras,
  });

  beforeEach(() => {
    soporte = {
      validateActiveSupportSession: jest.fn().mockResolvedValue({
        id: 'sesion-1',
        companyId: 'empresa-soportada',
        reason: 'el cliente reporta que el bot no contesta',
      }),
    };
    guarda = new FlowBotSupportGuard(
      soporte as unknown as SupportSessionsService,
    );
  });

  describe('usuarios de empresa', () => {
    it.each(['ADMIN', 'MANAGER', 'AGENT'])(
      'un %s pasa de largo sin sesión de soporte',
      async (role) => {
        // Esta guarda solo mira a plataforma: exigirle una sesión de soporte a
        // quien ya pertenece a la empresa sería absurdo.
        const req = peticion({ sub: 'u1', role, companyId: 'empresa-1' });
        await expect(guarda.canActivate(contexto(req))).resolves.toBe(true);
        expect(soporte.validateActiveSupportSession).not.toHaveBeenCalled();
      },
    );

    it('no toca su companyId', async () => {
      const req = peticion({
        sub: 'u1',
        role: 'ADMIN',
        companyId: 'empresa-1',
      });
      await guarda.canActivate(contexto(req));
      expect(req.user?.companyId).toBe('empresa-1');
    });
  });

  describe('SUPER_ADMIN de plataforma', () => {
    const plataforma = { sub: 'super-1', role: 'SUPER_ADMIN', companyId: null };

    it('SIN sesión de soporte responde 403', async () => {
      // Sin esto, cualquiera con el rol leería y publicaría bots de cualquier
      // empresa sin dejar rastro de por qué.
      await expect(
        guarda.canActivate(contexto(peticion(plataforma))),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('con una cabecera vacía también', async () => {
      await expect(
        guarda.canActivate(
          contexto(peticion(plataforma, { [CABECERA_SOPORTE]: '   ' })),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('valida la sesión con el servicio EXISTENTE, no con reglas propias', async () => {
      await guarda.canActivate(
        contexto(peticion(plataforma, { [CABECERA_SOPORTE]: 'sesion-1' })),
      );

      // Dos comprobaciones distintas de lo mismo acaban divergiendo, y la que
      // se quede corta será la que use alguien.
      expect(soporte.validateActiveSupportSession).toHaveBeenCalledWith(
        'sesion-1',
        'super-1',
      );
    });

    it('una sesión caducada o cerrada propaga el rechazo del servicio', async () => {
      soporte.validateActiveSupportSession.mockRejectedValue(
        new ForbiddenException('La sesión de soporte expiró'),
      );

      await expect(
        guarda.canActivate(
          contexto(peticion(plataforma, { [CABECERA_SOPORTE]: 'sesion-1' })),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('FIJA la empresa de la sesión: se acabó el acceso transversal', async () => {
      const req = peticion(plataforma, { [CABECERA_SOPORTE]: 'sesion-1' });
      await guarda.canActivate(contexto(req));

      // A partir de aquí es, para todos los efectos, un usuario de esa
      // empresa: los servicios filtran por `companyId` sin saber quién es.
      expect(req.user?.companyId).toBe('empresa-soportada');
    });

    it('conserva quién es de VERDAD para la auditoría', async () => {
      const req = peticion(plataforma, { [CABECERA_SOPORTE]: 'sesion-1' });
      await guarda.canActivate(contexto(req));

      // Un registro que dijera solo «ADMIN de la empresa X publicó» escondería
      // que fue soporte, y esa es justo la pregunta que se hace después.
      expect(req.user?.sub).toBe('super-1');
      expect(req.user?.soporte).toEqual({
        sessionId: 'sesion-1',
        motivo: 'el cliente reporta que el bot no contesta',
        empresa: 'empresa-soportada',
      });
    });

    it('una sesión sin empresa se rechaza', async () => {
      soporte.validateActiveSupportSession.mockResolvedValue({
        id: 'sesion-1',
        companyId: null,
        reason: 'x',
      });

      await expect(
        guarda.canActivate(
          contexto(peticion(plataforma, { [CABECERA_SOPORTE]: 'sesion-1' })),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('la cabecera puede llegar como lista y se toma la primera', async () => {
      const req = {
        user: plataforma,
        headers: { [CABECERA_SOPORTE]: ['sesion-1', 'otra'] },
      };
      await expect(guarda.canActivate(contexto(req))).resolves.toBe(true);
    });
  });

  describe('sin usuario', () => {
    it('deja pasar: de rechazar ya se encarga la autenticación', async () => {
      // Devolver 403 aquí convertiría un 401 en un 403 y confundiría a quien
      // depure por qué su token no vale.
      await expect(guarda.canActivate(contexto(peticion(null)))).resolves.toBe(
        true,
      );
    });
  });
});
