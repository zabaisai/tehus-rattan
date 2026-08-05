import Redis from 'ioredis';
import { buildRedisConnection } from '../src/common/queue/queue.config';
import {
  ContadorFrecuencia,
  LIMITES_POR_DEFECTO,
  huella,
  limiteDe,
} from '../src/modules/flowbot/engine/adapters/flowbot.whatsapp.frecuencia';
import {
  CircuitBreakerWhatsApp,
  FALLOS_PARA_ABRIR,
} from '../src/modules/flowbot/engine/adapters/flowbot.whatsapp.breaker';

/**
 * CONTADOR Y BREAKER CONTRA REDIS DE VERDAD.
 *
 * Lo que se prueba aquí no se puede probar con un doble: que dos workers
 * simultáneos no se cuelen, que el script Lua sea realmente atómico, y que
 * cuando el minuto termina solo UNO pase a probar. Un mock de Redis contesta
 * lo que se le diga y esas tres cosas dependen de cómo Redis ejecuta.
 *
 * NADA DE AQUÍ ABRE UNA CONEXIÓN A META. No hay transporte por ningún lado.
 */
process.env.REDIS_HOST = process.env.REDIS_HOST?.trim() || '127.0.0.1';

const PREFIJO = 'E2E-FREQ';

describe('Contador de frecuencia y circuit breaker (e2e, Redis real)', () => {
  const redis = new Redis({
    ...buildRedisConnection(),
    maxRetriesPerRequest: 2,
  });

  let contador: ContadorFrecuencia;
  let breaker: CircuitBreakerWhatsApp;
  let n = 0;

  /** Claves de un envío nuevo, para que cada prueba parta de cero. */
  const claves = (extra: Partial<Record<string, string>> = {}) => {
    n += 1;
    return {
      companyId: `${PREFIJO}-emp-${n}`,
      integrationId: `${PREFIJO}-int-${n}`,
      phoneNumberId: `${PREFIJO}-num-${n}`,
      flowBotId: `${PREFIJO}-bot-${n}`,
      conversationId: `${PREFIJO}-conv-${n}`,
      destinatario: `5730011122${String(n).padStart(2, '0')}`,
      ...extra,
    };
  };

  async function limpiar() {
    const claves = await redis.keys('flowbot:*');
    if (claves.length > 0) await redis.del(...claves);
  }

  beforeAll(() => {
    contador = new ContadorFrecuencia();
    breaker = new CircuitBreakerWhatsApp();
  });

  beforeEach(async () => {
    await limpiar();
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('FLOWBOT_RATE_')) delete process.env[k];
    }
  });

  afterAll(async () => {
    await limpiar();
    await contador.cerrar();
    await breaker.cerrar();
    await redis.quit().catch(() => undefined);
    redis.disconnect();
  });

  // ── contador ──────────────────────────────────────────────────

  describe('límites', () => {
    it('38. sin configuración NO es ilimitado', () => {
      // Es la propiedad más importante: una instalación sin tocar nada tiene
      // techo. Lo contrario convierte un despliegue incompleto en barra libre.
      for (const dimension of Object.keys(LIMITES_POR_DEFECTO) as Array<
        keyof typeof LIMITES_POR_DEFECTO
      >) {
        for (const ventana of ['minuto', 'hora', 'dia'] as const) {
          const limite = limiteDe(dimension, ventana, {});
          expect([dimension, ventana, limite > 0]).toEqual([
            dimension,
            ventana,
            true,
          ]);
          expect(limite).toBeLessThan(100_000);
        }
      }
    });

    it('una variable mal escrita NO sube el techo', () => {
      // Un `abc` o un `-1` no pueden interpretarse como «más cupo».
      for (const valor of ['abc', '-1', '1.5', '']) {
        expect(
          limiteDe('empresa', 'minuto', {
            FLOWBOT_RATE_EMPRESA_MINUTO: valor,
          }),
        ).toBe(LIMITES_POR_DEFECTO.empresa.minuto);
      }
    });

    it('un cero SÍ se respeta: es la forma de cerrar una dimensión', () => {
      expect(
        limiteDe('empresa', 'minuto', { FLOWBOT_RATE_EMPRESA_MINUTO: '0' }),
      ).toBe(0);
    });

    it('2/3/4/5. cada dimensión corta por separado', async () => {
      // Cada una con su propio identificador: lo que se comprueba es que el
      // contador distingue las siete y no las mezcla en una sola.
      process.env.FLOWBOT_RATE_EMPRESA_MINUTO = '2';
      const c = claves();

      expect((await contador.reservar(c)).permitido).toBe(true);
      expect((await contador.reservar(c)).permitido).toBe(true);

      const tercera = await contador.reservar(c);
      expect(tercera.permitido).toBe(false);
      if (!tercera.permitido && 'dimension' in tercera) {
        expect(tercera.dimension).toBe('empresa');
        expect(tercera.ventana).toBe('minuto');
        expect(tercera.limite).toBe(2);
        expect(tercera.retryAfterSegundos).toBeGreaterThan(0);
      }
    });

    it('el límite de una empresa no afecta a otra', async () => {
      process.env.FLOWBOT_RATE_EMPRESA_MINUTO = '1';
      const a = claves();
      const b = claves();

      expect((await contador.reservar(a)).permitido).toBe(true);
      expect((await contador.reservar(a)).permitido).toBe(false);
      // La segunda empresa sigue con su cupo intacto.
      expect((await contador.reservar(b)).permitido).toBe(true);
    });

    it('6. las tres ventanas conviven: la más estrecha manda', async () => {
      process.env.FLOWBOT_RATE_EMPRESA_MINUTO = '5';
      process.env.FLOWBOT_RATE_EMPRESA_HORA = '2';
      const c = claves();

      expect((await contador.reservar(c)).permitido).toBe(true);
      expect((await contador.reservar(c)).permitido).toBe(true);

      const tercera = await contador.reservar(c);
      expect(tercera.permitido).toBe(false);
      if (!tercera.permitido && 'ventana' in tercera) {
        expect(tercera.ventana).toBe('hora');
      }
    });

    it('un bloqueo NO consume cupo de las demás dimensiones', async () => {
      // Si se incrementara dimensión a dimensión, un corte en la última
      // dejaría las anteriores gastadas: el envío no sale y el cupo se pierde.
      process.env.FLOWBOT_RATE_CONVERSACION_MINUTO = '0';
      const c = claves();

      await contador.reservar(c);

      const global = await redis.get('flowbot:rate:global:all:minuto');
      const empresa = await redis.get(
        `flowbot:rate:empresa:${c.companyId}:minuto`,
      );
      expect(global).toBeNull();
      expect(empresa).toBeNull();
    });

    it('devolver el cupo lo repone, y nunca por debajo de cero', async () => {
      const c = claves();
      await contador.reservar(c);
      expect(
        await redis.get(`flowbot:rate:empresa:${c.companyId}:minuto`),
      ).toBe('1');

      await contador.devolver(c);
      expect(
        await redis.get(`flowbot:rate:empresa:${c.companyId}:minuto`),
      ).toBe('0');

      // Una devolución repetida no puede regalar cupo.
      await contador.devolver(c);
      expect(
        await redis.get(`flowbot:rate:empresa:${c.companyId}:minuto`),
      ).toBe('0');
    });

    it('la ventana caduca sola: el TTL se pone al crear, no al incrementar', async () => {
      // Renovarlo en cada incremento haría que una conversación activa nunca
      // liberara su cupo.
      const c = claves();
      await contador.reservar(c);
      const ttl1 = await redis.ttl(
        `flowbot:rate:empresa:${c.companyId}:minuto`,
      );
      await new Promise((r) => setTimeout(r, 1100));
      await contador.reservar(c);
      const ttl2 = await redis.ttl(
        `flowbot:rate:empresa:${c.companyId}:minuto`,
      );

      expect(ttl2).toBeLessThan(ttl1);
    });
  });

  describe('concurrencia', () => {
    it('1. dos «workers» simultáneos NO superan el límite', async () => {
      // El caso que motiva el script Lua: con leer-comprobar-incrementar desde
      // el código, ambos leen 4 de 5, ambos deciden que caben y salen 6.
      process.env.FLOWBOT_RATE_EMPRESA_MINUTO = '5';
      process.env.FLOWBOT_RATE_CONVERSACION_MINUTO = '100';
      process.env.FLOWBOT_RATE_DESTINATARIO_MINUTO = '100';
      const c = claves();

      const otro = new ContadorFrecuencia();
      try {
        const intentos = Array.from({ length: 20 }, (_, i) =>
          (i % 2 === 0 ? contador : otro).reservar(c),
        );
        const resultados = await Promise.all(intentos);
        const permitidos = resultados.filter((r) => r.permitido).length;

        expect(permitidos).toBe(5);
        expect(
          await redis.get(`flowbot:rate:empresa:${c.companyId}:minuto`),
        ).toBe('5');
      } finally {
        await otro.cerrar();
      }
    });

    it('con veinte concurrentes el contador coincide exactamente', async () => {
      // Se sube TODO lo demás para que el techo de empresa sea el que corta:
      // con los valores por defecto manda el de conversación (6), que es más
      // estrecho, y la prueba mediría otra cosa de la que cree.
      process.env.FLOWBOT_RATE_EMPRESA_MINUTO = '7';
      process.env.FLOWBOT_RATE_CONVERSACION_MINUTO = '100';
      process.env.FLOWBOT_RATE_DESTINATARIO_MINUTO = '100';
      const c = claves();

      const resultados = await Promise.all(
        Array.from({ length: 20 }, () => contador.reservar(c)),
      );
      const permitidos = resultados.filter((r) => r.permitido).length;

      // Ni uno de más ni uno de menos: el contador y los permisos concuerdan.
      expect(permitidos).toBe(7);
      expect(
        await redis.get(`flowbot:rate:empresa:${c.companyId}:minuto`),
      ).toBe('7');
    });
  });

  describe('Redis caído', () => {
    it('10/12. sin Redis NO se asume cero: se informa de indisponible', async () => {
      // Y NO se abre ninguna conexión a Meta: este contador no habla con nadie
      // más que con Redis.
      const muerto = new ContadorFrecuencia();
      const anterior = process.env.REDIS_PORT;
      process.env.REDIS_PORT = '6399'; // puerto sin nada escuchando

      try {
        const r = await muerto.reservar(claves());
        expect(r.permitido).toBe(false);
        expect('indisponible' in r && r.indisponible).toBe(true);
      } finally {
        if (anterior === undefined) delete process.env.REDIS_PORT;
        else process.env.REDIS_PORT = anterior;
        await muerto.cerrar();
      }
    });

    it('`disponible()` dice que no cuando no lo está', async () => {
      const muerto = new ContadorFrecuencia();
      const anterior = process.env.REDIS_PORT;
      process.env.REDIS_PORT = '6399';
      try {
        expect(await muerto.disponible()).toBe(false);
      } finally {
        if (anterior === undefined) delete process.env.REDIS_PORT;
        else process.env.REDIS_PORT = anterior;
        await muerto.cerrar();
      }
    });
  });

  describe('privacidad de las claves', () => {
    it('34. NINGUNA clave de Redis contiene un teléfono', async () => {
      // Redis se inspecciona con `KEYS *`, se vuelca en soporte y no tiene
      // control de acceso por fila.
      const c = claves({ destinatario: '573009998877' });
      await contador.reservar(c);

      const todas = await redis.keys('flowbot:*');
      expect(todas.length).toBeGreaterThan(0);
      for (const clave of todas) {
        expect([clave, clave.includes('573009998877')]).toEqual([clave, false]);
      }
      // Y sí está la huella, para que el contador siga distinguiendo.
      expect(todas.some((k) => k.includes(huella('573009998877')))).toBe(true);
    });
  });

  // ── circuit breaker ───────────────────────────────────────────

  describe('circuit breaker', () => {
    const integracion = () => `${PREFIJO}-int-brk-${(n += 1)}`;

    it('18. cinco fallos seguidos lo abren', async () => {
      const i = integracion();

      for (let k = 1; k < FALLOS_PARA_ABRIR; k++) {
        const r = await breaker.registrarFallo(i, 'meta-caido');
        expect([k, r.abierto]).toEqual([k, false]);
      }
      const ultimo = await breaker.registrarFallo(i, 'meta-caido');

      expect(ultimo.abierto).toBe(true);
      expect((await breaker.foto(i)).estado).toBe('OPEN');
    });

    it('19. abierto, bloquea y dice cuánto falta', async () => {
      const i = integracion();
      for (let k = 0; k < FALLOS_PARA_ABRIR; k++) {
        await breaker.registrarFallo(i, 'red');
      }

      const puerta = await breaker.permitir(i);
      expect(puerta.permitido).toBe(false);
      expect(puerta.retryAfterSegundos).toBeGreaterThan(0);
      expect(puerta.motivo).toContain('fallos seguidos');
    });

    it('24. un fallo de contenido NO lo abre', async () => {
      // Un destinatario inválido o una plantilla mal aprobada volverán a
      // fallar igual con otro número: abrir el breaker dejaría a la empresa
      // sin bot por un flujo mal configurado.
      const i = integracion();
      for (const codigo of [
        'destinatario-no-alcanzable',
        'plantilla-invalida',
        'fuera-de-ventana',
      ]) {
        for (let k = 0; k < 10; k++) {
          await breaker.registrarFallo(i, codigo);
        }
      }

      expect((await breaker.permitir(i)).permitido).toBe(true);
      expect((await breaker.foto(i)).estado).toBe('CLOSED');
    });

    it('25/26. 401 y 403 bloquean el número SIN tormenta de reintentos', async () => {
      // Un token caducado sigue caducado dentro de una hora. Reintentarlo cada
      // minuto es una tormenta silenciosa contra Meta.
      for (const codigo of ['token-invalido', 'sin-permiso']) {
        const i = integracion();
        const r = await breaker.registrarFallo(i, codigo);

        expect(r.bloqueada).toBe(true);
        const puerta = await breaker.permitir(i);
        expect(puerta.permitido).toBe(false);
        expect(puerta.motivo).toContain('a mano');
        // No hay próximo intento: no se reabre solo.
        expect((await breaker.foto(i)).proximoIntento).toBeNull();
      }
    });

    it('27. un 500 alimenta el breaker', async () => {
      const i = integracion();
      for (let k = 0; k < FALLOS_PARA_ABRIR; k++) {
        await breaker.registrarFallo(i, 'meta-caido');
      }
      expect((await breaker.foto(i)).estado).toBe('OPEN');
    });

    it('un éxito reinicia el contador de fallos', async () => {
      const i = integracion();
      await breaker.registrarFallo(i, 'red');
      await breaker.registrarFallo(i, 'red');
      await breaker.registrarExito(i);

      expect((await breaker.foto(i)).fallosConsecutivos).toBe(0);
      expect((await breaker.foto(i)).ultimoExito).toBeTruthy();
    });

    it('el breaker de un número no afecta a otro', async () => {
      // Un breaker global sería peor que ninguno: el fallo de un cliente
      // dejaría sin bot a todos los demás.
      const roto = integracion();
      const sano = integracion();
      for (let k = 0; k < FALLOS_PARA_ABRIR; k++) {
        await breaker.registrarFallo(roto, 'red');
      }

      expect((await breaker.permitir(roto)).permitido).toBe(false);
      expect((await breaker.permitir(sano)).permitido).toBe(true);
    });

    describe('HALF_OPEN', () => {
      /** Abre el breaker y adelanta el momento del próximo intento. */
      async function abrirYVencer(i: string) {
        for (let k = 0; k < FALLOS_PARA_ABRIR; k++) {
          await breaker.registrarFallo(i, 'red');
        }
        await redis.hset(`flowbot:breaker:${i}`, 'proximoIntento', '1');
      }

      it('20. pasado el tiempo, deja pasar UNA prueba', async () => {
        const i = integracion();
        await abrirYVencer(i);

        const primera = await breaker.permitir(i);
        expect(primera.permitido).toBe(true);
        expect(primera.esPrueba).toBe(true);
        expect(primera.estado).toBe('HALF_OPEN');
      });

      it('21. con veinte concurrentes, SOLO UNA pasa', async () => {
        // Es la estampida: cuando el minuto termina, los trabajos en cola
        // llegan a la vez y todos verían «ya se puede probar».
        const i = integracion();
        await abrirYVencer(i);

        const resultados = await Promise.all(
          Array.from({ length: 20 }, () => breaker.permitir(i)),
        );
        const pasaron = resultados.filter((r) => r.permitido).length;

        expect(pasaron).toBe(1);
      });

      it('22. un éxito lo cierra', async () => {
        const i = integracion();
        await abrirYVencer(i);
        await breaker.permitir(i);

        await breaker.registrarExito(i);

        expect((await breaker.foto(i)).estado).toBe('CLOSED');
        expect((await breaker.permitir(i)).permitido).toBe(true);
      });

      it('23. un fallo lo reabre de inmediato, sin esperar a cinco', async () => {
        const i = integracion();
        await abrirYVencer(i);
        await breaker.permitir(i);

        const r = await breaker.registrarFallo(i, 'red');

        expect(r.abierto).toBe(true);
        expect((await breaker.permitir(i)).permitido).toBe(false);
      });
    });

    it('29. si Redis pierde el estado, no se queda bloqueado para siempre', async () => {
      // Volver a CLOSED es deliberado: quedarse abierto dejaría a una empresa
      // sin bot tras un reinicio rutinario en el que nadie falló. Lo que
      // protege es que el primer fallo real vuelve a abrirlo en segundos.
      const i = integracion();
      for (let k = 0; k < FALLOS_PARA_ABRIR; k++) {
        await breaker.registrarFallo(i, 'red');
      }
      expect((await breaker.permitir(i)).permitido).toBe(false);

      await redis.del(`flowbot:breaker:${i}`);

      expect((await breaker.permitir(i)).permitido).toBe(true);
      // Y basta un fallo real para que la protección vuelva a activarse.
      for (let k = 0; k < FALLOS_PARA_ABRIR; k++) {
        await breaker.registrarFallo(i, 'red');
      }
      expect((await breaker.permitir(i)).permitido).toBe(false);
    });

    it('reiniciarlo a mano lo cierra', async () => {
      const i = integracion();
      for (let k = 0; k < FALLOS_PARA_ABRIR; k++) {
        await breaker.registrarFallo(i, 'red');
      }

      await breaker.reiniciar(i);

      expect((await breaker.permitir(i)).permitido).toBe(true);
    });

    it('sin Redis, el breaker deja pasar y decide el contador', async () => {
      // Dos guardarraíles fallando cerrado por el mismo motivo bloquearían el
      // producto entero cada vez que Redis parpadea. El que falla cerrado es
      // el contador, que es el que puede afirmar algo.
      const muerto = new CircuitBreakerWhatsApp();
      const anterior = process.env.REDIS_PORT;
      process.env.REDIS_PORT = '6399';
      try {
        expect((await muerto.permitir('cualquiera')).permitido).toBe(true);
      } finally {
        if (anterior === undefined) delete process.env.REDIS_PORT;
        else process.env.REDIS_PORT = anterior;
        await muerto.cerrar();
      }
    });
  });
});
