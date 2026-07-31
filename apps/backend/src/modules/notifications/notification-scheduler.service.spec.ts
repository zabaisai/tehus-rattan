import { NotificationSchedulerService } from './notification-scheduler.service';

// Los trabajos programados corren en UN SOLO proceso (ver
// common/scheduling/scheduling.role.ts). Se declara el entorno aqui en vez de
// depender de como se invoque la suite: una prueba que pasa o falla segun el
// entorno de quien la lanza no prueba nada.
const colaOriginal = process.env.QUEUE_ENABLED;
beforeAll(() => {
  process.env.QUEUE_ENABLED = 'false';
});
afterAll(() => {
  if (colaOriginal === undefined) delete process.env.QUEUE_ENABLED;
  else process.env.QUEUE_ENABLED = colaOriginal;
});

function build() {
  const prisma = {
    task: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  } as any;
  const notifications = {
    create: jest.fn().mockResolvedValue({ id: 'n1' }),
  } as any;
  const service = new NotificationSchedulerService(prisma, notifications);
  return { service, prisma, notifications };
}

const task = {
  id: 'task-1',
  title: 'Llamar al cliente',
  companyId: 'company-a',
  assignedTo: 'agent-1',
  dueDate: new Date(),
};

describe('NotificationSchedulerService', () => {
  it('emits one TASK_DUE_SOON per due-soon task with a stable single-shot dedupeKey', async () => {
    const { service, prisma, notifications } = build();
    prisma.task.findMany.mockResolvedValueOnce([task]);
    const sent = await service.notifyDueSoonTasks();
    expect(sent).toBe(1);
    const input = notifications.create.mock.calls[0][0];
    expect(input.type).toBe('TASK_DUE_SOON');
    expect(input.recipientUserId).toBe('agent-1');
    expect(input.dedupeKey).toBe('TASK_DUE_SOON:task-1');
    // Only active statuses + assigned + within the window are queried.
    const where = prisma.task.findMany.mock.calls[0][0].where;
    expect(where.assignedTo).toEqual({ not: null });
    expect(where.dueDate.gte).toBeInstanceOf(Date);
  });

  it('emits one TASK_OVERDUE per overdue task (single-shot dedupeKey)', async () => {
    const { service, prisma, notifications } = build();
    prisma.task.findMany.mockResolvedValueOnce([task]);
    await service.notifyOverdueTasks();
    expect(notifications.create.mock.calls[0][0].dedupeKey).toBe(
      'TASK_OVERDUE:task-1',
    );
  });

  it('is idempotent: create returning null (deduped) counts as not-sent', async () => {
    const { service, prisma, notifications } = build();
    prisma.task.findMany.mockResolvedValueOnce([task]);
    notifications.create.mockResolvedValueOnce(null); // already sent earlier
    const sent = await service.notifyDueSoonTasks();
    expect(sent).toBe(0);
  });

  it('skips tasks with no assignee', async () => {
    const { service, prisma, notifications } = build();
    prisma.task.findMany.mockResolvedValueOnce([{ ...task, assignedTo: null }]);
    const sent = await service.notifyDueSoonTasks();
    expect(sent).toBe(0);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('retention cleanup deletes read/expired notifications only (never audit logs)', async () => {
    const { service, prisma } = build();
    prisma.notification.deleteMany.mockResolvedValue({ count: 3 });
    const n = await service.handleRetentionCleanup();
    expect(n).toBe(3);
    const where = prisma.notification.deleteMany.mock.calls[0][0].where;
    expect(where.OR[0].readAt).toMatchObject({ not: null });
    expect(where.OR[1].expiresAt).toHaveProperty('lt');
  });
});
