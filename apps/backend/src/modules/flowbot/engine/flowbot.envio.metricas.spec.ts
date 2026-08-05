import { MetricasEnvio } from './flowbot.envio.metricas';
import { huella } from './adapters/flowbot.whatsapp.frecuencia';

/**
 * Las métricas se exportan, se pegan en un ticket y se miran en soporte. Lo
 * que se comprueba aquí es que por ahí no puede salir el teléfono de nadie —y
 * que no puede salir POR CONSTRUCCIÓN, no porque hoy nadie lo haya metido.
 */
describe('Métricas de envío', () => {
  let m: MetricasEnvio;

  beforeEach(() => {
    m = new MetricasEnvio();
  });

  it('33. ninguna métrica puede contener un teléfono', () => {
    // La clave es un tipo cerrado: no hay forma de escribir
    // `bloqueado:573001112233` aunque alguien quisiera «más detalle». Esta
    // prueba fija esa propiedad sobre la salida real.
    m.incrementar('permitidos', 3);
    m.incrementar('bloqueados.frecuencia');
    m.registrarBloqueo(['kill-switch-activo']);

    const serializado = JSON.stringify(m.foto());

    expect(serializado).not.toMatch(/\d{10,}/);
    expect(serializado).not.toContain('57300');
  });

  it('todos los contadores salen, aunque estén a cero', () => {
    // Un contador ausente se lee como «no se ha medido» y uno a cero como «no
    // ha pasado». No es lo mismo y quien mira una gráfica necesita saber cuál.
    const foto = m.foto();

    expect(foto.contadores['permitidos']).toBe(0);
    expect(foto.contadores['bloqueados.killSwitch']).toBe(0);
    expect(Object.keys(foto.contadores).length).toBeGreaterThan(15);
  });

  it('un envío bloqueado por cinco motivos cuenta UNA vez', () => {
    // Contar cada motivo inflaría los bloqueos hasta que el número deje de
    // significar «cuántos envíos no salieron».
    m.registrarBloqueo([
      'kill-switch-activo',
      'empresa-no-permitida',
      'handoff-humano-activo',
    ]);

    const c = m.foto().contadores;
    const total =
      c['bloqueados.killSwitch'] +
      c['bloqueados.allowlist'] +
      c['bloqueados.handoff'];
    expect(total).toBe(1);
  });

  it('un motivo desconocido no rompe ni inventa un contador', () => {
    m.registrarBloqueo(['algo-que-no-existe-todavia']);
    expect(m.foto().contadores['permitidos']).toBe(0);
  });

  describe('alertas', () => {
    const base = {
      breakersAbiertos: 0,
      contadorDisponible: true,
      killSwitchActivo: false,
      ejecucionesEnAtencion: 0,
      trabajosDiferidos: 0,
    };

    it('sin nada raro, no alerta', () => {
      expect(m.alertas(base)).toEqual([]);
    });

    it('Redis caído es GRAVE: los envíos reales están bloqueados', () => {
      const a = m.alertas({ ...base, contadorDisponible: false });
      expect(a[0].nivel).toBe('grave');
      expect(a[0].codigo).toBe('contador-no-disponible');
    });

    it('un número abierto avisa; varios son graves', () => {
      expect(m.alertas({ ...base, breakersAbiertos: 1 })[0].nivel).toBe(
        'aviso',
      );
      expect(m.alertas({ ...base, breakersAbiertos: 3 })[0].nivel).toBe(
        'grave',
      );
    });

    it('el interruptor activo se anuncia', () => {
      const a = m.alertas({ ...base, killSwitchActivo: true });
      expect(a.some((x) => x.codigo === 'kill-switch')).toBe(true);
    });

    it('la cola acumulada y las ejecuciones en atención avisan', () => {
      const a = m.alertas({
        ...base,
        ejecucionesEnAtencion: 12,
        trabajosDiferidos: 900,
      });
      expect(a.map((x) => x.codigo)).toEqual(
        expect.arrayContaining(['muchas-en-atencion', 'cola-acumulada']),
      );
    });

    it('muchos 429 y muchos timeouts ambiguos avisan', () => {
      for (let i = 0; i < 25; i++) m.incrementar('meta.429');
      for (let i = 0; i < 6; i++) m.incrementar('meta.timeoutAmbiguo');

      const codigos = m.alertas(base).map((x) => x.codigo);
      expect(codigos).toEqual(
        expect.arrayContaining(['muchos-429', 'timeouts-ambiguos']),
      );
    });

    it('ninguna alerta lleva datos de nadie', () => {
      const a = m.alertas({
        ...base,
        breakersAbiertos: 2,
        ejecucionesEnAtencion: 40,
      });
      const texto = JSON.stringify(a);

      expect(texto).not.toMatch(/57\d{9}/);
      expect(texto).not.toContain('token');
    });
  });
});

describe('Huella del destinatario', () => {
  it('34. la huella NO deja recuperar el teléfono', () => {
    const h = huella('573001112233');

    expect(h).not.toContain('573001112233');
    expect(h).toHaveLength(16);
  });

  it('es estable: el mismo número cuenta en el mismo contador', () => {
    expect(huella('573001112233')).toBe(huella('573001112233'));
  });

  it('números distintos no comparten contador', () => {
    expect(huella('573001112233')).not.toBe(huella('573001112234'));
  });
});
