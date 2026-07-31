import { QueueHealthService } from './queue.health';

describe('QueueHealthService', () => {
  let service: QueueHealthService;

  beforeEach(() => {
    service = new QueueHealthService();
  });

  describe('habilitación', () => {
    it('está habilitada por defecto', () => {
      expect(service.isEnabled({})).toBe(true);
    });

    it('QUEUE_ENABLED=false la deshabilita', () => {
      expect(service.isEnabled({ QUEUE_ENABLED: 'false' })).toBe(false);
    });

    it('cualquier otro valor la deja habilitada', () => {
      expect(service.isEnabled({ QUEUE_ENABLED: 'true' })).toBe(true);
      expect(service.isEnabled({ QUEUE_ENABLED: '' })).toBe(true);
    });
  });

  describe('check', () => {
    it('devuelve "disabled" sin llamar a Redis cuando está apagada', async () => {
      const ping = jest.fn();

      const salud = await service.check(ping, { QUEUE_ENABLED: 'false' });

      expect(salud.state).toBe('disabled');
      expect(ping).not.toHaveBeenCalled();
    });

    it('devuelve "up" con latencia cuando el ping responde', async () => {
      const salud = await service.check(async () => 'PONG', {});

      expect(salud.state).toBe('up');
      expect(typeof salud.latencyMs).toBe('number');
    });

    it('pasa la conexión construida al ping', async () => {
      const ping = jest.fn().mockResolvedValue('PONG');

      await service.check(ping, { REDIS_HOST: 'otro', REDIS_PORT: '6380' });

      expect(ping.mock.calls[0][0]).toMatchObject({
        host: 'otro',
        port: 6380,
      });
    });

    it('devuelve "down" en vez de LANZAR cuando Redis no responde', async () => {
      // Es el comportamiento clave: que Redis esté caído no puede tumbar la
      // API. El CRM debe seguir sirviendo aunque lo diferido esté degradado.
      const salud = await service.check(async () => {
        throw new Error('conexión rechazada');
      }, {});

      expect(salud.state).toBe('down');
      expect(salud.reason).toBe('Error');
    });

    it('nunca expone la cadena de conexión ni la contraseña en el resultado', async () => {
      const salud = await service.check(
        async () => {
          throw new Error(
            'AUTH failed for redis://user:supersecreto@host:6379',
          );
        },
        { REDIS_PASSWORD: 'supersecreto' },
      );

      const serializado = JSON.stringify(salud);
      expect(serializado).not.toContain('supersecreto');
      expect(serializado).not.toContain('redis://');
    });

    it('un fallo de configuración también se reporta como "down", no revienta', async () => {
      const salud = await service.check(async () => 'PONG', {
        REDIS_PORT: 'no-es-un-puerto',
      });

      expect(salud.state).toBe('down');
    });
  });
});
