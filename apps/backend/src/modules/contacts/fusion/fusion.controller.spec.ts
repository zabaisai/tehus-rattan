import { BadRequestException } from '@nestjs/common';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { FusionContactosController } from './fusion.controller';

/**
 * Permisos y auditoría de la fusión.
 *
 * Dos cosas que no se ven mirando el resultado de la operación y que son las
 * que más caro salen si se rompen: quién puede ejecutarla, y qué queda escrito
 * en la auditoría. Lo segundo se comprueba sobre el objeto exacto que se manda
 * a registrar, no sobre lo que se cree que se mandó.
 */
describe('FusionContactosController — permisos y auditoría', () => {
  function montar() {
    const auditoria = { record: jest.fn().mockResolvedValue(undefined) };
    const fusion = {
      fusionar: jest.fn().mockResolvedValue({
        mergeId: 'm1',
        principalId: 'p1',
        duplicadoId: 'd1',
        trasladadas: { conversaciones: 2, mensajes: 9 },
        realizadaEn: '2026-08-13T00:00:00.000Z',
        deshacerHasta: '2026-08-13T00:10:00.000Z',
        segundosRestantes: 600,
        deshecha: false,
      }),
      descartar: jest.fn().mockResolvedValue({ descartado: true, nuevo: true }),
      deshacer: jest.fn().mockResolvedValue({
        mergeId: 'm1',
        principalId: 'p1',
        duplicadoId: 'd1',
      }),
    };
    const controller = new FusionContactosController(
      fusion as any,
      auditoria as any,
      {} as any,
    );
    return { controller, fusion, auditoria };
  }

  const req = {
    user: { sub: 'u1', role: 'ADMIN', companyId: 'e1' },
  };

  const cuerpo = {
    principalId: 'p1',
    duplicadoId: 'd1',
    versiones: { principal: 'v1', duplicado: 'v2' },
    confirmoMismaPersona: true,
    elecciones: {
      campos: { email: 'duplicado' as const },
      camposPersonalizados: { def1: 'duplicado' as const },
    },
  };

  describe('quién puede fusionar', () => {
    const rolesDe = (metodo: string) =>
      Reflect.getMetadata(
        ROLES_KEY,
        (FusionContactosController.prototype as any)[metodo],
      );

    it('ejecutar, descartar y deshacer exigen ADMIN o MANAGER; AGENT no está', () => {
      for (const metodo of ['ejecutar', 'descartar', 'deshacer']) {
        const roles = rolesDe(metodo);
        expect(roles).toContain('ADMIN');
        expect(roles).toContain('MANAGER');
        expect(roles).not.toContain('AGENT');
      }
    });

    it('comparar y ver duplicados NO restringen rol: proponer y mirar no cambia nada', () => {
      expect(rolesDe('comparar')).toBeUndefined();
      expect(rolesDe('duplicados')).toBeUndefined();
      expect(rolesDe('canonico')).toBeUndefined();
    });
  });

  describe('confirmación explícita', () => {
    it('sin confirmar que son la misma persona, el servidor no fusiona', async () => {
      const { controller, fusion } = montar();

      await expect(
        controller.ejecutar(req, { ...cuerpo, confirmoMismaPersona: false }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(fusion.fusionar).not.toHaveBeenCalled();
    });
  });

  describe('la auditoría no puede llevar datos personales', () => {
    it('registra ids, claves de campo y cantidades; nunca valores', async () => {
      const { controller, auditoria } = montar();

      await controller.ejecutar(req, cuerpo);

      const [, registro] = auditoria.record.mock.calls[0];
      expect(registro.action).toBe('contact.merge');
      expect(registro.affectedCompanyId).toBe('e1');
      expect(registro.actorUserId).toBe('u1');

      const texto = JSON.stringify(registro.metadata);
      // Lo que SÍ va: ids, el lado elegido por campo y los recuentos.
      expect(registro.metadata).toMatchObject({
        mergeId: 'm1',
        principalId: 'p1',
        duplicadoId: 'd1',
      });
      expect(texto).toContain('email');
      expect(texto).toContain('def1');
      // De los campos personalizados solo viajan las CLAVES, nunca el lado ni
      // el valor: basta con saber que se decidió ese campo.
      expect(registro.metadata).toMatchObject({
        camposElegidos: { camposPersonalizados: ['def1'] },
      });
      // Y lo que NO va: ningún valor de los que se compararon.
      expect(registro.metadata).not.toHaveProperty('valores');
      expect(texto).not.toMatch(/@/); // ningún correo
      expect(texto).not.toMatch(/\+\d{8,}/); // ningún teléfono
    });

    it('un fallo del registro no tumba una fusión ya hecha', async () => {
      const { controller, auditoria } = montar();
      auditoria.record.mockRejectedValueOnce(new Error('auditoría caída'));

      await expect(controller.ejecutar(req, cuerpo)).resolves.toMatchObject({
        mergeId: 'm1',
      });
    });
  });
});
