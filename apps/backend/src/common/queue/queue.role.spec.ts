import { isQueueWorker, shouldConsumeQueue, shouldEnqueue } from './queue.role';

describe('rol del proceso en la cola', () => {
  describe('isQueueWorker', () => {
    it('reconoce al worker por WORKER_ROLE=queue', () => {
      expect(isQueueWorker({ WORKER_ROLE: 'queue' })).toBe(true);
    });

    it('el backend NO es worker', () => {
      expect(isQueueWorker({})).toBe(false);
    });

    it('cualquier otro valor no lo convierte en worker', () => {
      expect(isQueueWorker({ WORKER_ROLE: 'api' })).toBe(false);
      expect(isQueueWorker({ WORKER_ROLE: '' })).toBe(false);
    });

    it('tolera espacios alrededor del valor', () => {
      expect(isQueueWorker({ WORKER_ROLE: '  queue  ' })).toBe(true);
    });
  });

  describe('shouldConsumeQueue — quién registra procesadores', () => {
    it('SOLO el worker consume', () => {
      // Es el invariante que evita la duplicación de efectos: si el backend
      // también procesara, cada job correría dos veces (dos automatizaciones,
      // dos notificaciones, dos mensajes al cliente).
      expect(shouldConsumeQueue({ WORKER_ROLE: 'queue' })).toBe(true);
      expect(shouldConsumeQueue({})).toBe(false);
    });

    it('el worker NO consume si la cola está deshabilitada', () => {
      expect(
        shouldConsumeQueue({ WORKER_ROLE: 'queue', QUEUE_ENABLED: 'false' }),
      ).toBe(false);
    });

    it('nadie consume con la cola deshabilitada', () => {
      expect(shouldConsumeQueue({ QUEUE_ENABLED: 'false' })).toBe(false);
    });
  });

  describe('shouldEnqueue — marcha atrás automática sin Redis', () => {
    it('encola por defecto', () => {
      expect(shouldEnqueue({})).toBe(true);
    });

    it('con QUEUE_ENABLED=false NO encola: se ejecuta en línea', () => {
      // El CRM sigue funcionando entero sin Redis, degradado en latencia pero
      // nunca en funcionalidad. Es lo que impide que la cola sea un punto
      // único de fallo desde el primer día.
      expect(shouldEnqueue({ QUEUE_ENABLED: 'false' })).toBe(false);
    });

    it('el worker también encolaría si produjera trabajo', () => {
      expect(shouldEnqueue({ WORKER_ROLE: 'queue' })).toBe(true);
    });
  });

  describe('combinaciones reales de despliegue', () => {
    it('backend en staging: produce, no consume', () => {
      const env = {}; // sin WORKER_ROLE, cola habilitada

      expect(shouldEnqueue(env)).toBe(true);
      expect(shouldConsumeQueue(env)).toBe(false);
    });

    it('worker en staging: consume', () => {
      const env = { WORKER_ROLE: 'queue' };

      expect(shouldConsumeQueue(env)).toBe(true);
    });

    it('tests y desarrollo sin Docker: ni encola ni consume', () => {
      const env = { QUEUE_ENABLED: 'false' };

      expect(shouldEnqueue(env)).toBe(false);
      expect(shouldConsumeQueue(env)).toBe(false);
    });

    it('NUNCA hay dos consumidores a la vez en un despliegue normal', () => {
      const backend = {};
      const worker = { WORKER_ROLE: 'queue' };

      const consumidores = [backend, worker].filter(shouldConsumeQueue);
      expect(consumidores).toHaveLength(1);
    });
  });
});
