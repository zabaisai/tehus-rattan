import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';

const realtimeStub = () =>
  ({
    messageCreated: jest.fn(),
    messageStatusChanged: jest.fn(),
    leadUpdated: jest.fn(),
    taskUpdated: jest.fn(),
    notificationCreated: jest.fn(),
  }) as never;

/**
 * CARACTERIZACIÓN — puerta de `Task.conversationId`.
 *
 * Fija lo que el módulo hace HOY, antes de relacionar tareas con
 * conversaciones y antes de la asignación automática. Los hechos que
 * condicionan esas migraciones quedan como pruebas explícitas:
 *
 *  1. Una tarea puede vincularse a lead, contacto y responsable, y cada
 *     vínculo se valida CONTRA LA MISMA EMPRESA antes de escribir. Ese patrón
 *     de validación es el que `conversationId` deberá replicar.
 *  2. Hoy NO existe ninguna noción de conversación en el módulo: ni en
 *     filtros, ni en el contrato de creación. Se fija para que añadirlo sea
 *     visible en el diff.
 *  3. El responsable debe ser un usuario ACTIVO de la empresa — invariante
 *     que la asignación round-robin tendrá que respetar.
 *
 * Ids ficticios; ningún dato real.
 */
const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';
const TASK_A = 'task-a';

describe('TasksService (vínculos y aislamiento)', () => {
  let prisma: any;
  let service: TasksService;

  const taskRow = { id: TASK_A, companyId: COMPANY_A, title: 'Seguimiento' };

  beforeEach(() => {
    prisma = {
      task: {
        findMany: jest.fn().mockResolvedValue([taskRow]),
        findFirst: jest.fn().mockResolvedValue(taskRow),
        create: jest.fn((args: any) =>
          Promise.resolve({ id: 'new', ...args.data }),
        ),
        update: jest.fn((args: any) =>
          Promise.resolve({ id: args.where.id, ...args.data }),
        ),
        delete: jest.fn().mockResolvedValue(taskRow),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      lead: { findFirst: jest.fn().mockResolvedValue({ id: 'lead-1' }) },
      contact: { findFirst: jest.fn().mockResolvedValue({ id: 'contact-1' }) },
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'conv-1' }),
      },
    };
    service = new TasksService(prisma, realtimeStub());
  });

  describe('aislamiento multiempresa', () => {
    it('findAll filtra siempre por companyId', async () => {
      await service.findAll(COMPANY_A, {});

      expect(prisma.task.findMany.mock.calls[0][0].where.companyId).toBe(
        COMPANY_A,
      );
    });

    it.each([
      ['findById', () => service.findById(TASK_A, COMPANY_B)],
      ['update', () => service.update(TASK_A, COMPANY_B, { title: 'X' })],
      ['complete', () => service.complete(TASK_A, COMPANY_B)],
      ['remove', () => service.remove(TASK_A, COMPANY_B)],
    ])(
      '%s falla con 404 y no escribe nada si la tarea es de otra empresa',
      async (_name, call) => {
        prisma.task.findFirst.mockResolvedValue(null);

        await expect(call()).rejects.toBeInstanceOf(NotFoundException);

        expect(prisma.task.update).not.toHaveBeenCalled();
        expect(prisma.task.delete).not.toHaveBeenCalled();
      },
    );
  });

  describe('creación y validación de vínculos', () => {
    it('fuerza el companyId del contexto', async () => {
      await service.create(COMPANY_A, { title: 'T' });

      expect(prisma.task.create.mock.calls[0][0].data.companyId).toBe(
        COMPANY_A,
      );
    });

    it('valida lead, contacto y responsable contra la MISMA empresa', async () => {
      await service.create(COMPANY_A, {
        title: 'T',
        leadId: 'lead-1',
        contactId: 'contact-1',
        assignedTo: 'user-1',
      });

      expect(prisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lead-1', companyId: COMPANY_A },
        }),
      );
      expect(prisma.contact.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'contact-1', companyId: COMPANY_A },
        }),
      );
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1', companyId: COMPANY_A, isActive: true },
        }),
      );
    });

    it('rechaza un lead de otra empresa sin crear la tarea', async () => {
      prisma.lead.findFirst.mockResolvedValue(null);

      await expect(
        service.create(COMPANY_A, { title: 'T', leadId: 'ajeno' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it('rechaza un contacto de otra empresa sin crear la tarea', async () => {
      prisma.contact.findFirst.mockResolvedValue(null);

      await expect(
        service.create(COMPANY_A, { title: 'T', contactId: 'ajeno' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it('rechaza un responsable INACTIVO o de otra empresa', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.create(COMPANY_A, { title: 'T', assignedTo: 'inactivo' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it.each([
      ['assignedTo', { title: 'T', assignedTo: '   ' }],
      ['leadId', { title: 'T', leadId: '   ' }],
      ['contactId', { title: 'T', contactId: '   ' }],
    ])('rechaza %s en blanco', async (_campo, data) => {
      await expect(
        service.create(COMPANY_A, data as never),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it('permite crear una tarea sin ningún vínculo (queda huérfana)', async () => {
      await service.create(COMPANY_A, { title: 'Suelta' });

      expect(prisma.task.create).toHaveBeenCalledTimes(1);
      expect(prisma.lead.findFirst).not.toHaveBeenCalled();
      expect(prisma.contact.findFirst).not.toHaveBeenCalled();
    });

    it('convierte dueDate de texto a Date', async () => {
      await service.create(COMPANY_A, {
        title: 'T',
        dueDate: '2026-08-15T10:00:00.000Z',
      });

      expect(prisma.task.create.mock.calls[0][0].data.dueDate).toBeInstanceOf(
        Date,
      );
    });

    it('sin dueDate no envía el campo', async () => {
      await service.create(COMPANY_A, { title: 'T' });

      expect(prisma.task.create.mock.calls[0][0].data.dueDate).toBeUndefined();
    });
  });

  // HUECO CERRADO (migración link_conversation_lead_and_task_conversation):
  // la tarea ya conoce su conversación de origen, con la misma validación de
  // pertenencia que lead y contacto.
  describe('vínculo con la conversación', () => {
    it('valida que la conversación sea de la MISMA empresa antes de crear', async () => {
      await service.create(COMPANY_A, {
        title: 'Llamar tras el chat',
        conversationId: 'conv-1',
      });

      expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conv-1', companyId: COMPANY_A },
        }),
      );
      expect(prisma.task.create.mock.calls[0][0].data.conversationId).toBe(
        'conv-1',
      );
    });

    it('rechaza una conversación de otra empresa sin crear la tarea', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);

      await expect(
        service.create(COMPANY_A, { title: 'T', conversationId: 'ajena' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it('rechaza conversationId en blanco', async () => {
      await expect(
        service.create(COMPANY_A, { title: 'T', conversationId: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it('permite filtrar tareas por conversación', async () => {
      await service.findAll(COMPANY_A, { conversationId: 'conv-1' });

      expect(prisma.task.findMany.mock.calls[0][0].where.conversationId).toBe(
        'conv-1',
      );
    });

    it('incluye la conversación en las lecturas, sin exponer sus mensajes', async () => {
      await service.findAll(COMPANY_A, {});

      const include = prisma.task.findMany.mock.calls[0][0].include;
      expect(include.conversation.select).toEqual({
        id: true,
        status: true,
        channel: true,
      });
      expect(include.conversation.include).toBeUndefined();
    });
  });

  describe('filtros', () => {
    it('aplica leadId, contactId, status y assignedTo', async () => {
      await service.findAll(COMPANY_A, {
        leadId: 'l',
        contactId: 'c',
        status: 'PENDING',
        assignedTo: 'u',
      });

      expect(prisma.task.findMany.mock.calls[0][0].where).toMatchObject({
        companyId: COMPANY_A,
        leadId: 'l',
        contactId: 'c',
        status: 'PENDING',
        assignedTo: 'u',
      });
    });

    it('overdue exige vencidas y excluye COMPLETED/CANCELLED', async () => {
      await service.findAll(COMPANY_A, { overdue: true });

      const where = prisma.task.findMany.mock.calls[0][0].where;
      expect(where.dueDate.lt).toBeInstanceOf(Date);
      expect(where.status).toEqual({ notIn: ['COMPLETED', 'CANCELLED'] });
    });

    it('overdue tiene prioridad sobre un status explícito', async () => {
      await service.findAll(COMPANY_A, { overdue: true, status: 'PENDING' });

      expect(prisma.task.findMany.mock.calls[0][0].where.status).toEqual({
        notIn: ['COMPLETED', 'CANCELLED'],
      });
    });

    it('busca en título y descripción sin distinguir mayúsculas', async () => {
      await service.findAll(COMPANY_A, { search: 'llamar' });

      expect(prisma.task.findMany.mock.calls[0][0].where.OR).toEqual([
        { title: { contains: 'llamar', mode: 'insensitive' } },
        { description: { contains: 'llamar', mode: 'insensitive' } },
      ]);
    });

    it('ordena por fecha de vencimiento ascendente', async () => {
      await service.findAll(COMPANY_A, {});

      expect(prisma.task.findMany.mock.calls[0][0].orderBy).toEqual({
        dueDate: 'asc',
      });
    });

    it.each([['0'], ['101'], ['abc']])(
      'rechaza limit inválido (%s) sin consultar la base',
      async (limit) => {
        await expect(
          service.findAll(COMPANY_A, { limit }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.task.findMany).not.toHaveBeenCalled();
      },
    );
  });

  describe('actualización', () => {
    it('revalida el responsable al reasignar', async () => {
      await service.update(TASK_A, COMPANY_A, { assignedTo: 'user-2' });

      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-2', companyId: COMPANY_A, isActive: true },
        }),
      );
    });

    it('complete marca COMPLETED sin borrar', async () => {
      await service.complete(TASK_A, COMPANY_A);

      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: TASK_A },
        data: { status: 'COMPLETED' },
      });
      expect(prisma.task.delete).not.toHaveBeenCalled();
    });

    it('HOY remove borra en duro (relevante para retención)', async () => {
      await service.remove(TASK_A, COMPANY_A);

      expect(prisma.task.delete).toHaveBeenCalledWith({
        where: { id: TASK_A },
      });
    });
  });
});
