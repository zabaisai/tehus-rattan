import { describe, it, expect } from 'vitest';
import {
  estadoDeIntegracion,
  estadoDeSalud,
  vistaOperativa,
} from './flowbot-estado-operativo';
import type { EstadoOperativo } from './flowbots';

/**
 * LA PANTALLA DECIA DOS COSAS A LA VEZ.
 *
 * En staging convivian una alerta roja «Envios parados» y, justo debajo, una
 * etiqueta verde «Enviando» sobre el numero. Ninguna mentia por separado:
 *
 *   - «Envios parados» venia del KILL SWITCH.
 *   - «Enviando» venia del CIRCUIT BREAKER en `CLOSED`, que significa «sin
 *     fallos acumulados», NO «esta enviando».
 *
 * Con el interruptor activo y el transporte en falso, un numero sano tiene el
 * breaker cerrado. De ahi la contradiccion.
 */
const base: EstadoOperativo = {
  modo: 'falso',
  etiqueta: '',
  enviaDeVerdad: false,
  killSwitch: {
    activo: true,
    motivo:
      'Activado en el despliegue a staging de 347b957: FlowBot no envia nada hasta una autorizacion separada.',
    activadoEn: '2026-08-05T19:38:05.199Z',
    activadoPor: null,
  },
  numeros: [
    {
      integrationId: 'int-1',
      etiqueta: 'Número principal',
      estadoIntegracion: 'CONNECTED',
      breaker: {
        estado: 'CLOSED',
        fallosConsecutivos: 0,
        abiertoEn: null,
        proximoIntento: null,
        ultimaCausa: null,
        ultimoExito: null,
        aperturas: 0,
      },
    },
  ],
} as EstadoOperativo;

const texto = (e: EstadoOperativo) => {
  const v = vistaOperativa(e);
  return `${v.titulo} ${v.detalle} ${v.etiquetaSalida}`;
};

describe('Estado operativo de TAKTO Pulso', () => {
  describe('1. número conectado + transporte falso (el caso de staging)', () => {
    it('muestra «Modo seguro de pruebas», no una alarma', () => {
      const v = vistaOperativa(base);
      expect(v.titulo).toBe('Modo seguro de pruebas');
      expect(v.tono).toBe('informativo');
      expect(v.tono).not.toBe('error');
    });

    it('el texto es exactamente el acordado', () => {
      expect(vistaOperativa(base).detalle).toBe(
        'Los envíos reales de WhatsApp están desactivados en staging. Puedes diseñar y simular bots sin enviar mensajes reales.',
      );
    });

    it('dice «Número conectado» y «Envíos reales bloqueados»', () => {
      expect(estadoDeIntegracion('CONNECTED').etiqueta).toBe(
        'Número conectado',
      );
      expect(vistaOperativa(base).etiquetaSalida).toBe(
        'Envíos reales bloqueados',
      );
    });

    it('NUNCA dice «Enviando»', () => {
      expect(texto(base)).not.toContain('Enviando');
      expect(vistaOperativa(base).puedeSalirUnMensaje).toBe(false);
    });
  });

  describe('2. número conectado + dry-run', () => {
    const dry = { ...base, modo: 'dry-run' } as EstadoOperativo;

    it('muestra «Modo de simulación»', () => {
      expect(vistaOperativa(dry).titulo).toBe('Modo de simulación');
    });

    it('no afirma que envíe de verdad', () => {
      expect(texto(dry)).not.toContain('Enviando');
      expect(vistaOperativa(dry).detalle).toMatch(/no sale nada/i);
      expect(vistaOperativa(dry).puedeSalirUnMensaje).toBe(false);
    });
  });

  describe('3. real + kill switch activo', () => {
    const real = { ...base, modo: 'real' } as EstadoOperativo;

    it('AHORA SÍ es una alerta roja', () => {
      const v = vistaOperativa(real);
      expect(v.titulo).toBe('Envíos detenidos por seguridad');
      expect(v.tono).toBe('error');
    });

    it('dice cuándo se activó, sin volcar el motivo técnico crudo', () => {
      const v = vistaOperativa(real);
      expect(v.detalle).toMatch(/interruptor de emergencia/i);
      // El SHA histórico no va en el mensaje principal.
      expect(v.detalle).not.toContain('347b957');
    });
  });

  describe('4. real + kill switch inactivo', () => {
    const real = {
      ...base,
      modo: 'real',
      killSwitch: { ...base.killSwitch, activo: false },
    } as EstadoOperativo;

    it('muestra «Envíos habilitados», no «Enviando»', () => {
      const v = vistaOperativa(real);
      expect(v.titulo).toBe('Envíos habilitados');
      expect(v.etiquetaSalida).toBe('Envíos habilitados');
      // «Enviando» describiria algo ocurriendo AHORA; esto es un permiso.
      expect(texto(real)).not.toContain('Enviando');
      expect(v.puedeSalirUnMensaje).toBe(true);
    });
  });

  describe('5. número desconectado', () => {
    const sinNumero = {
      ...base,
      numeros: [
        { ...base.numeros![0], estadoIntegracion: 'DISCONNECTED' },
      ],
    } as EstadoOperativo;

    it('dice «Número desconectado» y nunca «Enviando»', () => {
      expect(estadoDeIntegracion('DISCONNECTED').etiqueta).toBe(
        'Número desconectado',
      );
      expect(vistaOperativa(sinNumero).titulo).toBe('Número desconectado');
      expect(texto(sinNumero)).not.toContain('Enviando');
    });

    it('tampoco envía aunque el modo fuera real', () => {
      const v = vistaOperativa({
        ...sinNumero,
        modo: 'real',
        killSwitch: { ...base.killSwitch, activo: false },
      } as EstadoOperativo);
      expect(v.puedeSalirUnMensaje).toBe(false);
    });
  });

  describe('6. el motivo técnico con el SHA antiguo', () => {
    it('NO aparece en el mensaje principal', () => {
      const v = vistaOperativa(base);
      expect(v.titulo).not.toContain('347b957');
      expect(v.detalle).not.toContain('347b957');
    });

    it('sí está disponible en el detalle técnico, íntegro', () => {
      const v = vistaOperativa(base);
      expect(v.detalleTecnico).toContain('347b957');
      expect(v.detalleTecnico).toContain('Motivo registrado');
    });

    it('sin interruptor activo no hay detalle técnico que enseñar', () => {
      const v = vistaOperativa({
        ...base,
        killSwitch: { ...base.killSwitch, activo: false },
      } as EstadoOperativo);
      expect(v.detalleTecnico).toBeNull();
    });
  });

  describe('salud del número, que es otra pregunta', () => {
    it('«CLOSED» significa sin fallos, NO enviando', () => {
      const s = estadoDeSalud('CLOSED');
      expect(s.etiqueta).toBe('Sin fallos');
      expect(s.etiqueta).not.toContain('Enviando');
    });

    it('los otros estados se nombran por lo que son', () => {
      expect(estadoDeSalud('HALF_OPEN').etiqueta).toBe('Probando tras fallos');
      expect(estadoDeSalud('OPEN').etiqueta).toBe('En pausa por fallos');
    });
  });

  describe('prioridad entre estados', () => {
    it('el interruptor NO pinta en rojo cuando el transporte es falso', () => {
      // Un cinturon sobre unos tirantes no es un incidente. Anunciarlo en rojo
      // entrena a la gente a ignorar las alertas rojas de verdad.
      expect(vistaOperativa(base).tono).toBe('informativo');
    });

    it('la conclusión es una sola para todas las superficies', () => {
      // La etiqueta de salida que ve el numero es la MISMA que decide el aviso.
      const v = vistaOperativa(base);
      expect(v.etiquetaSalida).toBe('Envíos reales bloqueados');
      expect(v.puedeSalirUnMensaje).toBe(false);
    });
  });
});
