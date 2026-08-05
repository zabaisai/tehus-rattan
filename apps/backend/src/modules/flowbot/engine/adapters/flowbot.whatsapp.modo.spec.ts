import {
  ContextoEnvio,
  GUARDARRAILES,
  decidirModo,
  leerConfiguracion,
} from './flowbot.whatsapp.modo';

/**
 * LOS GUARDARRAÍLES DEL ENVÍO REAL.
 *
 * Cada una de estas pruebas responde a la pregunta «¿qué tendría que fallar
 * para que un bot le mande un WhatsApp a un cliente sin que nadie lo haya
 * decidido?». Son la parte del sistema donde un despiste no produce un error
 * visible sino un mensaje en el teléfono de otra persona, así que se prueban
 * una por una y también todas juntas.
 */

/** Un contexto en el que TODO está bien salvo lo que cada prueba estropee. */
function contextoPerfecto(cambios: Partial<ContextoEnvio> = {}): ContextoEnvio {
  return {
    companyId: 'empresa-piloto',
    phoneNumberId: 'numero-piloto',
    destinatario: '573001112233',
    integracionConectada: true,
    botPublicado: true,
    botActivo: true,
    versionValida: true,
    ejecucionViva: true,
    handoffHumano: false,
    idempotencyKey: 'ejec-1-nodo-3',
    ventanaOPlantilla: true,
    dentroDeLimite: true,
    circuitoSano: true,
    killSwitch: false,
    ...cambios,
  };
}

/** Configuración con TODO abierto: es la única forma de llegar a `real`. */
const TODO_ABIERTO = {
  realHabilitado: true,
  dryRun: false,
  empresas: ['empresa-piloto'],
  numeros: ['numero-piloto'],
  destinatarios: ['573001112233'],
};

describe('Modo de transporte de WhatsApp', () => {
  describe('valores por defecto', () => {
    it('1. SIN CONFIGURACIÓN NO SALE NADA', () => {
      // La prueba más importante del archivo. Un `.env` vacío, una variable mal
      // escrita o un despliegue a medias tienen que dar exactamente esto.
      const config = leerConfiguracion({});

      expect(config.realHabilitado).toBe(false);
      expect(config.dryRun).toBe(true);
      expect(config.empresas).toEqual([]);
      expect(config.numeros).toEqual([]);
      expect(config.destinatarios).toEqual([]);

      expect(decidirModo(contextoPerfecto(), config).modo).toBe('falso');
    });

    it('una variable mal escrita NO enciende nada', () => {
      // `1`, `yes`, `TRUE_` y demás son errores de dedo; ninguno puede
      // interpretarse como «sí, manda mensajes a clientes».
      for (const valor of ['1', 'yes', 'sí', 'TRUE_', ' ', 'verdadero']) {
        expect(
          leerConfiguracion({ FLOWBOT_REAL_WHATSAPP_ENABLED: valor })
            .realHabilitado,
        ).toBe(false);
      }
    });

    it('el modo de prueba solo se quita con `false` literal', () => {
      for (const valor of ['0', 'no', 'FALSE_', '', 'apagado']) {
        expect(
          leerConfiguracion({ FLOWBOT_WHATSAPP_DRY_RUN: valor }).dryRun,
        ).toBe(true);
      }
      expect(
        leerConfiguracion({ FLOWBOT_WHATSAPP_DRY_RUN: 'false' }).dryRun,
      ).toBe(false);
    });
  });

  describe('cada guardarraíl por separado', () => {
    it('2. la bandera global sola NO basta', () => {
      // Encenderla sin poblar las listas es el error más probable de todos:
      // «ya activé WhatsApp real» y las listas siguen vacías.
      const d = decidirModo(contextoPerfecto(), {
        ...TODO_ABIERTO,
        empresas: [],
        numeros: [],
        destinatarios: [],
      });

      expect(d.modo).not.toBe('real');
      expect(d.bloqueos).toEqual(
        expect.arrayContaining([
          GUARDARRAILES.EMPRESA_NO_PERMITIDA,
          GUARDARRAILES.NUMERO_NO_PERMITIDO,
          GUARDARRAILES.DESTINATARIO_NO_PERMITIDO,
        ]),
      );
    });

    it('3. una empresa que no está en la lista no envía', () => {
      const d = decidirModo(
        contextoPerfecto({ companyId: 'otra-empresa' }),
        TODO_ABIERTO,
      );
      expect(d.modo).not.toBe('real');
      expect(d.bloqueos).toContain(GUARDARRAILES.EMPRESA_NO_PERMITIDA);
    });

    it('4. un número remitente que no está en la lista no envía', () => {
      const d = decidirModo(
        contextoPerfecto({ phoneNumberId: 'otro-numero' }),
        TODO_ABIERTO,
      );
      expect(d.bloqueos).toContain(GUARDARRAILES.NUMERO_NO_PERMITIDO);
    });

    it('5. un destinatario que no está en la lista no recibe', () => {
      const d = decidirModo(
        contextoPerfecto({ destinatario: '573009998877' }),
        TODO_ABIERTO,
      );
      expect(d.bloqueos).toContain(GUARDARRAILES.DESTINATARIO_NO_PERMITIDO);
    });

    it('el destinatario se compara por dígitos, no por formato', () => {
      // La lista puede estar escrita con `+`, con espacios o sin nada. Un
      // formato distinto NO puede ser la razón por la que un envío de prueba
      // salga hacia alguien que no estaba en la lista, ni al revés.
      const d = decidirModo(
        contextoPerfecto({ destinatario: '573001112233' }),
        {
          ...TODO_ABIERTO,
          destinatarios: ['+57 300 111 2233'],
        },
      );
      expect(d.modo).toBe('real');
    });

    it('8. un handoff humano bloquea', () => {
      const d = decidirModo(
        contextoPerfecto({ handoffHumano: true }),
        TODO_ABIERTO,
      );
      expect(d.bloqueos).toContain(GUARDARRAILES.HANDOFF_HUMANO);
    });

    it('9. una ejecución que ya no está viva bloquea', () => {
      const d = decidirModo(
        contextoPerfecto({ ejecucionViva: false }),
        TODO_ABIERTO,
      );
      expect(d.bloqueos).toContain(GUARDARRAILES.EJECUCION_NO_VIVA);
    });

    it('10. un trabajo de una versión que ya no es la publicada bloquea', () => {
      // Es el caso del job antiguo que revive: la cola guardó el trabajo, se
      // publicó otra versión y el trabajo sigue ahí. No puede mandar mensajes
      // en nombre de un flujo que ya nadie usa.
      const d = decidirModo(
        contextoPerfecto({ versionValida: false }),
        TODO_ABIERTO,
      );
      expect(d.bloqueos).toContain(GUARDARRAILES.VERSION_INVALIDA);
    });

    it('un bot pausado o sin publicar bloquea', () => {
      expect(
        decidirModo(contextoPerfecto({ botActivo: false }), TODO_ABIERTO)
          .bloqueos,
      ).toContain(GUARDARRAILES.BOT_NO_ACTIVO);
      expect(
        decidirModo(contextoPerfecto({ botPublicado: false }), TODO_ABIERTO)
          .bloqueos,
      ).toContain(GUARDARRAILES.BOT_NO_PUBLICADO);
    });

    it('16. fuera de la ventana y sin plantilla válida, bloquea', () => {
      const d = decidirModo(
        contextoPerfecto({ ventanaOPlantilla: false }),
        TODO_ABIERTO,
      );
      expect(d.bloqueos).toContain(GUARDARRAILES.VENTANA_O_PLANTILLA);
    });

    it('sin clave de idempotencia, bloquea', () => {
      // Sin ella, un reintento no puede saber si el mensaje ya salió.
      const d = decidirModo(
        contextoPerfecto({ idempotencyKey: null }),
        TODO_ABIERTO,
      );
      expect(d.bloqueos).toContain(GUARDARRAILES.SIN_IDEMPOTENCIA);
    });

    it('la integración desconectada, el límite y el circuito bloquean', () => {
      expect(
        decidirModo(
          contextoPerfecto({ integracionConectada: false }),
          TODO_ABIERTO,
        ).bloqueos,
      ).toContain(GUARDARRAILES.INTEGRACION_NO_CONECTADA);
      expect(
        decidirModo(contextoPerfecto({ dentroDeLimite: false }), TODO_ABIERTO)
          .bloqueos,
      ).toContain(GUARDARRAILES.LIMITE_FRECUENCIA);
      expect(
        decidirModo(contextoPerfecto({ circuitoSano: false }), TODO_ABIERTO)
          .bloqueos,
      ).toContain(GUARDARRAILES.CIRCUITO_ABIERTO);
    });
  });

  describe('interruptor de emergencia', () => {
    it('manda sobre todo lo demás', () => {
      const d = decidirModo(
        contextoPerfecto({ killSwitch: true }),
        TODO_ABIERTO,
      );
      expect(d.modo).not.toBe('real');
      expect(d.bloqueos).toContain(GUARDARRAILES.KILL_SWITCH);
    });
  });

  describe('modo de prueba', () => {
    it('6. con todo permitido pero dry-run puesto, se prepara y no se manda', () => {
      const d = decidirModo(contextoPerfecto(), {
        ...TODO_ABIERTO,
        dryRun: true,
      });
      expect(d.modo).toBe('dry-run');
      expect(d.bloqueos).toEqual([]);
    });

    it('con guardarraíles pendientes NO se llega a dry-run si la global está apagada', () => {
      // Sin la bandera global no se ejecuta ni el camino de preparación: es el
      // estado por defecto y tiene que ser el más inerte de todos.
      const d = decidirModo(contextoPerfecto(), {
        ...TODO_ABIERTO,
        realHabilitado: false,
        dryRun: true,
      });
      expect(d.modo).toBe('falso');
    });
  });

  describe('el único camino a real', () => {
    it('exige TODOS los guardarraíles a la vez', () => {
      expect(decidirModo(contextoPerfecto(), TODO_ABIERTO).modo).toBe('real');

      // Y cualquiera que falle lo saca de ahí.
      const claves: Array<keyof ContextoEnvio> = [
        'integracionConectada',
        'botPublicado',
        'botActivo',
        'versionValida',
        'ejecucionViva',
        'ventanaOPlantilla',
        'dentroDeLimite',
        'circuitoSano',
      ];
      for (const clave of claves) {
        const d = decidirModo(
          contextoPerfecto({ [clave]: false }),
          TODO_ABIERTO,
        );
        expect([clave, d.modo]).not.toEqual([clave, 'real']);
      }
    });

    it('explica TODO lo que falta, no solo lo primero', () => {
      // Un informe que se para en el primer bloqueo obliga a descubrir los
      // problemas de uno en uno, encendiendo cosas por el camino.
      const d = decidirModo(
        contextoPerfecto({
          companyId: 'otra',
          handoffHumano: true,
          ejecucionViva: false,
        }),
        TODO_ABIERTO,
      );

      expect(d.bloqueos.length).toBeGreaterThanOrEqual(3);
      expect(d.explicacion).toContain('no está en la lista');
      expect(d.explicacion).toContain('una persona');
    });

    it('la explicación es legible, no una lista de códigos', () => {
      const d = decidirModo(
        contextoPerfecto({ killSwitch: true }),
        TODO_ABIERTO,
      );
      expect(d.explicacion).toContain('interruptor de emergencia');
      expect(d.explicacion).not.toContain('kill-switch-activo');
    });
  });
});
