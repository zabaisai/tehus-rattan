import 'reflect-metadata';
import { LeadSettingsService, POR_DEFECTO } from './lead-settings.service';

/**
 * Resolución de la configuración de entrada.
 *
 * Lo que se prueba aquí no es «lee una fila»: es que una configuración
 * caduca, incompleta o manipulada NO acabe metiendo la oportunidad de una
 * empresa en el tablero de otra, y que el mensaje del cliente nunca se pierda
 * por un ajuste mal puesto.
 */
describe('LeadSettingsService', () => {
  let prisma: any;
  let servicio: LeadSettingsService;

  const pipelineActivo = { id: 'pipe-1' };
  const etapaInicial = { id: 'etapa-inicial' };

  beforeEach(() => {
    prisma = {
      companyLeadSettings: { findUnique: jest.fn().mockResolvedValue(null) },
      pipeline: { findFirst: jest.fn() },
      pipelineStage: { findFirst: jest.fn() },
      user: { findFirst: jest.fn() },
    };
    servicio = new LeadSettingsService(prisma);
  });

  describe('empresa sin configurar', () => {
    it('aplica los valores por defecto y NO obliga a configurar nada', async () => {
      prisma.pipeline.findFirst.mockResolvedValue(pipelineActivo);
      prisma.pipelineStage.findFirst.mockResolvedValue(etapaInicial);

      const r = await servicio.resolver('empresa-a');

      expect(r.autoCreateLead).toBe(POR_DEFECTO.autoCreateLead);
      expect(r.reuseOpenLead).toBe(true);
      expect(r.assignmentStrategy).toBe('ROUND_ROBIN');
      expect(r.pipelineId).toBe('pipe-1');
      expect(r.stageId).toBe('etapa-inicial');
    });
  });

  describe('desactivar la creación automática', () => {
    it('no busca pipeline si autoCreateLead es false', async () => {
      prisma.companyLeadSettings.findUnique.mockResolvedValue({
        autoCreateLead: false,
      });

      const r = await servicio.resolver('empresa-a');

      expect(r.autoCreateLead).toBe(false);
      expect(r.pipelineId).toBeNull();
      // No tiene sentido resolver un destino que no se va a usar.
      expect(prisma.pipeline.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('aislamiento multiempresa', () => {
    it('el pipeline configurado se comprueba SIEMPRE contra la empresa', async () => {
      prisma.companyLeadSettings.findUnique.mockResolvedValue({
        autoCreateLead: true,
        defaultPipelineId: 'pipe-de-otra-empresa',
      });
      prisma.pipeline.findFirst.mockResolvedValue(null);
      prisma.pipelineStage.findFirst.mockResolvedValue(null);

      await servicio.resolver('empresa-a');

      // La primera consulta lleva el companyId: sin él, una configuración
      // manipulada metería oportunidades en el tablero de otra empresa.
      expect(prisma.pipeline.findFirst.mock.calls[0][0].where).toMatchObject({
        id: 'pipe-de-otra-empresa',
        companyId: 'empresa-a',
      });
    });

    it('un pipeline ajeno se descarta y se cae al predeterminado', async () => {
      prisma.companyLeadSettings.findUnique.mockResolvedValue({
        autoCreateLead: true,
        defaultPipelineId: 'ajeno',
      });
      prisma.pipeline.findFirst
        .mockResolvedValueOnce(null) // el configurado no vale
        .mockResolvedValueOnce(pipelineActivo); // el predeterminado sí
      prisma.pipelineStage.findFirst.mockResolvedValue(etapaInicial);

      const r = await servicio.resolver('empresa-a');

      expect(r.pipelineId).toBe('pipe-1');
    });

    it('la etapa configurada debe ser DEL PIPELINE elegido, no solo de la empresa', async () => {
      // Una etapa de otro pipeline dejaria la oportunidad en un tablero y la
      // etapa en otro.
      prisma.companyLeadSettings.findUnique.mockResolvedValue({
        autoCreateLead: true,
        initialStageId: 'etapa-de-otro-pipeline',
      });
      prisma.pipeline.findFirst.mockResolvedValue(pipelineActivo);
      prisma.pipelineStage.findFirst.mockResolvedValue(null);

      await servicio.resolver('empresa-a');

      expect(
        prisma.pipelineStage.findFirst.mock.calls[0][0].where,
      ).toMatchObject({
        id: 'etapa-de-otro-pipeline',
        pipelineId: 'pipe-1',
      });
    });

    it('el responsable fijo debe ser de la empresa y estar activo', async () => {
      prisma.companyLeadSettings.findUnique.mockResolvedValue({
        autoCreateLead: true,
        assignmentStrategy: 'FIJA',
        assignedUserId: 'usuario-ajeno',
      });
      prisma.pipeline.findFirst.mockResolvedValue(pipelineActivo);
      prisma.pipelineStage.findFirst.mockResolvedValue(etapaInicial);
      prisma.user.findFirst.mockResolvedValue(null);

      const r = await servicio.resolver('empresa-a');

      expect(prisma.user.findFirst.mock.calls[0][0].where).toMatchObject({
        id: 'usuario-ajeno',
        companyId: 'empresa-a',
        isActive: true,
      });
      // Sin usuario válido queda sin asignar, no se inventa otro.
      expect(r.assignedUserId).toBeNull();
    });
  });

  describe('elección de etapa', () => {
    it('prefiere la marcada como inicial, no la primera por orden', async () => {
      // Antes se usaba "la primera por orden", que cambia sola en cuanto
      // alguien reordena el tablero.
      prisma.pipeline.findFirst.mockResolvedValue(pipelineActivo);
      prisma.pipelineStage.findFirst.mockResolvedValue(etapaInicial);

      await servicio.resolver('empresa-a');

      expect(
        prisma.pipelineStage.findFirst.mock.calls[0][0].where,
      ).toMatchObject({
        pipelineId: 'pipe-1',
        isInitial: true,
      });
    });

    it('si ninguna está marcada, cae a la primera por orden', async () => {
      // Cubre un pipeline creado antes del backfill.
      prisma.pipeline.findFirst.mockResolvedValue(pipelineActivo);
      prisma.pipelineStage.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'primera-por-orden' });

      const r = await servicio.resolver('empresa-a');

      expect(r.stageId).toBe('primera-por-orden');
      expect(prisma.pipelineStage.findFirst.mock.calls[1][0].orderBy).toEqual({
        order: 'asc',
      });
    });

    it('el nombre de la etapa NO decide nada', async () => {
      // Atar el comportamiento al texto "Nuevo lead" lo rompe en cuanto
      // alguien la renombra o trabaja en otro idioma.
      prisma.pipeline.findFirst.mockResolvedValue(pipelineActivo);
      prisma.pipelineStage.findFirst.mockResolvedValue(etapaInicial);

      await servicio.resolver('empresa-a');

      const consultas = JSON.stringify(
        prisma.pipelineStage.findFirst.mock.calls,
      );
      expect(consultas.toLowerCase()).not.toContain('nuevo lead');
      expect(consultas).not.toContain('"name"');
    });
  });

  describe('configuración incompleta: el mensaje NO se pierde', () => {
    it('sin ningún pipeline informa el motivo en vez de fallar', async () => {
      prisma.pipeline.findFirst.mockResolvedValue(null);

      const r = await servicio.resolver('empresa-a');

      expect(r.motivo).toBe('sin-pipeline');
      expect(r.pipelineId).toBeNull();
    });

    it('con pipeline pero sin etapas informa el motivo', async () => {
      prisma.pipeline.findFirst.mockResolvedValue(pipelineActivo);
      prisma.pipelineStage.findFirst.mockResolvedValue(null);

      const r = await servicio.resolver('empresa-a');

      expect(r.motivo).toBe('sin-etapa-inicial');
      expect(r.pipelineId).toBe('pipe-1');
    });

    it('sin predeterminado usa cualquier pipeline activo', async () => {
      // Una empresa con un solo pipeline sin marcar no debe quedarse sin
      // entrada de oportunidades por ese detalle.
      prisma.companyLeadSettings.findUnique.mockResolvedValue(null);
      prisma.pipeline.findFirst
        .mockResolvedValueOnce(null) // no hay predeterminado
        .mockResolvedValueOnce({ id: 'el-unico' });
      prisma.pipelineStage.findFirst.mockResolvedValue(etapaInicial);

      const r = await servicio.resolver('empresa-a');

      expect(r.pipelineId).toBe('el-unico');
    });
  });

  describe('obtener', () => {
    it('devuelve los valores por defecto si nunca se guardó nada', async () => {
      // La pantalla de ajustes debe mostrar lo que SE ESTA APLICANDO, no un
      // formulario vacio que sugiera que no hay comportamiento.
      const r = await servicio.obtener('empresa-a');

      expect(r).toMatchObject({
        companyId: 'empresa-a',
        autoCreateLead: true,
        assignmentStrategy: 'ROUND_ROBIN',
      });
    });
  });
});
