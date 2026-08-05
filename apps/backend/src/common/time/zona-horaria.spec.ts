import {
  ZONA_POR_DEFECTO,
  dentroDeHorario,
  desfaseMs,
  formatearLocal,
  instanteLocal,
  partesEnZona,
  proximaApertura,
  zonaSegura,
  zonaValida,
} from './zona-horaria';

/**
 * Estas pruebas fijan instantes UTC concretos y comprueban qué hora local
 * producen. Es la única forma de que digan algo: si usaran la hora actual
 * pasarían en Bogotá y fallarían en el contenedor, que es exactamente el fallo
 * que este módulo existe para evitar.
 */
describe('zona horaria de la empresa', () => {
  const BOGOTA = 'America/Bogota'; // UTC-5 todo el año, sin horario de verano
  const MADRID = 'Europe/Madrid'; // UTC+1 / UTC+2 según la época

  describe('validación de zonas', () => {
    it('acepta una zona real', () => {
      expect(zonaValida(BOGOTA)).toBe(true);
    });

    it.each([null, undefined, '', '   ', 'Marte/Olympus'])(
      'rechaza %p',
      (z) => {
        expect(zonaValida(z)).toBe(false);
      },
    );

    it('una zona inválida cae a la del producto, nunca a la del servidor', () => {
      // Un bot no puede dejar de responder porque alguien escribió mal su
      // ciudad, y `Intl` LANZA con una zona inventada.
      expect(zonaSegura('Marte/Olympus')).toBe(ZONA_POR_DEFECTO);
      expect(zonaSegura(BOGOTA)).toBe(BOGOTA);
    });
  });

  describe('partes locales', () => {
    it('medianoche UTC son las 19:00 del día anterior en Bogotá', () => {
      // Es el caso que rompe el horario comercial: con la hora del servidor,
      // el bot creería que son las 00:00 y estaría fuera de todo horario.
      const p = partesEnZona(new Date('2026-08-04T00:00:00.000Z'), BOGOTA);
      expect(p).toMatchObject({
        anio: 2026,
        mes: 8,
        dia: 3,
        hora: 19,
        minuto: 0,
      });
    });

    it('la medianoche local se lee como hora 0, no como 24', () => {
      const p = partesEnZona(new Date('2026-08-04T05:00:00.000Z'), BOGOTA);
      expect(p.hora).toBe(0);
      expect(p.dia).toBe(4);
    });

    it('respeta el horario de verano', () => {
      // Madrid: UTC+2 en agosto, UTC+1 en enero.
      const verano = partesEnZona(new Date('2026-08-04T10:00:00.000Z'), MADRID);
      const invierno = partesEnZona(
        new Date('2026-01-04T10:00:00.000Z'),
        MADRID,
      );
      expect(verano.hora).toBe(12);
      expect(invierno.hora).toBe(11);
    });

    it('el día de la semana también sale de la zona', () => {
      // Domingo 23:00 en Bogotá es lunes 04:00 en UTC.
      const p = partesEnZona(new Date('2026-08-03T04:00:00.000Z'), BOGOTA);
      expect(p.diaSemana).toBe(0);
    });
  });

  describe('horario comercial', () => {
    const laboral = { fromHour: 8, toHour: 18, days: [1, 2, 3, 4, 5] };

    it('las 14:00 de Bogotá están dentro', () => {
      // 19:00 UTC = 14:00 Bogotá, martes.
      expect(
        dentroDeHorario(new Date('2026-08-04T19:00:00.000Z'), BOGOTA, laboral),
      ).toBe(true);
    });

    it('las 19:00 de Bogotá están fuera aunque en UTC sea otro día', () => {
      // 00:00 UTC del miércoles = 19:00 del martes en Bogotá.
      expect(
        dentroDeHorario(new Date('2026-08-05T00:00:00.000Z'), BOGOTA, laboral),
      ).toBe(false);
    });

    it('el sábado está fuera', () => {
      expect(
        dentroDeHorario(new Date('2026-08-08T16:00:00.000Z'), BOGOTA, laboral),
      ).toBe(false);
    });

    it('un rango que cruza la medianoche no es un error de datos', () => {
      // Guardia nocturna de 22 a 6. Hay negocios así.
      const nocturno = { fromHour: 22, toHour: 6 };
      // 04:00 UTC = 23:00 Bogotá.
      expect(
        dentroDeHorario(new Date('2026-08-04T04:00:00.000Z'), BOGOTA, nocturno),
      ).toBe(true);
      // 18:00 UTC = 13:00 Bogotá.
      expect(
        dentroDeHorario(new Date('2026-08-04T18:00:00.000Z'), BOGOTA, nocturno),
      ).toBe(false);
    });

    it('sin días declarados aplica todos', () => {
      const siempre = { fromHour: 8, toHour: 18 };
      expect(
        dentroDeHorario(new Date('2026-08-08T16:00:00.000Z'), BOGOTA, siempre),
      ).toBe(true);
    });

    it.each([
      { fromHour: 'ocho', toHour: 18 },
      { fromHour: 8 },
      { fromHour: -1, toHour: 18 },
      { fromHour: 8, toHour: 99 },
    ])('devuelve null con la configuración %p', (spec) => {
      // `null` y no `false`: un horario mal escrito no puede silenciar un bot
      // sin que nadie se entere.
      expect(dentroDeHorario(new Date(), BOGOTA, spec)).toBeNull();
    });
  });

  describe('próxima apertura', () => {
    const laboral = { fromHour: 8, toHour: 18, days: [1, 2, 3, 4, 5] };

    it('desde el viernes por la noche abre el lunes', () => {
      // Viernes 7 de agosto de 2026, 23:00 Bogotá = sábado 04:00 UTC.
      const abre = proximaApertura(
        new Date('2026-08-08T04:00:00.000Z'),
        BOGOTA,
        laboral,
      );
      expect(abre).not.toBeNull();
      const p = partesEnZona(abre!, BOGOTA);
      expect(p.diaSemana).toBe(1);
      expect(p.hora).toBe(8);
    });

    it('estando dentro devuelve la hora siguiente, que sigue dentro', () => {
      const abre = proximaApertura(
        new Date('2026-08-04T19:00:00.000Z'),
        BOGOTA,
        laboral,
      );
      expect(dentroDeHorario(abre!, BOGOTA, laboral)).toBe(true);
    });

    it('con la configuración rota devuelve null en vez de esperar para siempre', () => {
      expect(proximaApertura(new Date(), BOGOTA, { fromHour: 'x' })).toBeNull();
    });

    it('si nunca abre devuelve null en vez de girar', () => {
      // Días imposibles: no hay día 9 de la semana.
      expect(
        proximaApertura(new Date(), BOGOTA, {
          fromHour: 8,
          toHour: 18,
          days: [9],
        }),
      ).toBeNull();
    });
  });

  describe('fechas escritas sin zona', () => {
    it('las 14:00 escritas por la empresa son las 14:00 DONDE ESTÁ', () => {
      // Sin esto, un recordatorio para las 9 llegaría a las 4 de la madrugada.
      const t = instanteLocal('2026-08-10 14:00', BOGOTA);
      expect(t?.toISOString()).toBe('2026-08-10T19:00:00.000Z');
    });

    it('acepta el separador T', () => {
      const t = instanteLocal('2026-08-10T14:00', BOGOTA);
      expect(t?.toISOString()).toBe('2026-08-10T19:00:00.000Z');
    });

    it('una fecha sin hora es medianoche local', () => {
      const t = instanteLocal('2026-08-10', BOGOTA);
      expect(t?.toISOString()).toBe('2026-08-10T05:00:00.000Z');
    });

    it('si el texto SÍ trae zona se respeta tal cual', () => {
      // Quien la escribió estaba siendo explícito.
      const t = instanteLocal('2026-08-10T14:00:00Z', BOGOTA);
      expect(t?.toISOString()).toBe('2026-08-10T14:00:00.000Z');
    });

    it('respeta el horario de verano de la zona en ESA fecha', () => {
      const verano = instanteLocal('2026-08-10 12:00', MADRID);
      const invierno = instanteLocal('2026-01-10 12:00', MADRID);
      expect(verano?.toISOString()).toBe('2026-08-10T10:00:00.000Z');
      expect(invierno?.toISOString()).toBe('2026-01-10T11:00:00.000Z');
    });

    it('un texto vacío o basura no revienta', () => {
      expect(instanteLocal('', BOGOTA)).toBeNull();
      expect(instanteLocal('mañana', BOGOTA)).toBeNull();
    });
  });

  describe('utilidades', () => {
    it('el desfase de Bogotá son cinco horas negativas', () => {
      expect(desfaseMs(new Date('2026-08-04T12:00:00.000Z'), BOGOTA)).toBe(
        -5 * 3_600_000,
      );
    });

    it('formatea en la zona de la empresa', () => {
      expect(formatearLocal(new Date('2026-08-04T00:00:00.000Z'), BOGOTA)).toBe(
        '03/08/2026 19:00',
      );
    });
  });
});
