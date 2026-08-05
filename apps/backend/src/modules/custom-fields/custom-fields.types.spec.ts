import { CustomFieldType } from '@prisma/client';
import {
  claveDesdeEtiqueta,
  comoCadena,
  DefinicionParaValidar,
  leerOpciones,
  MAX_TEXTO,
  normalizar,
} from './custom-fields.types';

/**
 * La validación es lo único que separa un campo personalizado de un cajón
 * donde cabe cualquier cosa. Estas pruebas fijan los casos donde ser
 * permisivo cuesta caro: fechas ambiguas, moneda en coma flotante, URLs que
 * se abren desde el panel del asesor, y objetos convertidos a texto.
 */
const def = (
  type: CustomFieldType,
  extra: Partial<DefinicionParaValidar> = {},
): DefinicionParaValidar => ({
  key: 'campo',
  label: 'Campo',
  type,
  isRequired: false,
  options: null,
  validation: null,
  ...extra,
});

describe('normalización de campos personalizados', () => {
  describe('vacío y obligatoriedad', () => {
    it.each([null, undefined, '', '   ', []])(
      'trata %p como borrar el valor',
      (v) => {
        const r = normalizar(def('TEXT'), v);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.valor.valueText).toBeNull();
      },
    );

    it('un campo obligatorio rechaza el borrado', () => {
      // Si no, marcar algo como requerido no significaría nada.
      const r = normalizar(def('TEXT', { isRequired: true }), '');
      expect(r.ok).toBe(false);
    });
  });

  describe('texto', () => {
    it('recorta espacios', () => {
      const r = normalizar(def('TEXT'), '  Ana  ');
      expect(r.ok && r.valor.valueText).toBe('Ana');
    });

    it('rechaza un objeto en vez de escribir [object Object]', () => {
      // `String({})` guardaría basura creyendo que guarda un dato. Es la clase
      // de error que este repositorio ya ha pagado cuatro veces.
      const r = normalizar(def('TEXT'), { a: 1 });
      expect(r.ok).toBe(false);
    });

    it('aplica el tope de longitud del tipo corto', () => {
      const r = normalizar(def('TEXT'), 'x'.repeat(MAX_TEXTO + 1));
      expect(r.ok).toBe(false);
    });

    it('LONG_TEXT admite mucho más', () => {
      const r = normalizar(def('LONG_TEXT'), 'x'.repeat(MAX_TEXTO + 1));
      expect(r.ok).toBe(true);
    });

    it('respeta un patrón declarado por la empresa', () => {
      const d = def('TEXT', { validation: { pattern: '^[A-Z]{3}$' } });
      expect(normalizar(d, 'ABC').ok).toBe(true);
      expect(normalizar(d, 'abcd').ok).toBe(false);
    });

    it('un patrón que no compila se ignora en vez de bloquear el dato', () => {
      // Lo escribe un administrador: una errata suya no puede impedir que se
      // capture el dato de un cliente.
      const d = def('TEXT', { validation: { pattern: '[' } });
      expect(normalizar(d, 'lo que sea').ok).toBe(true);
    });
  });

  describe('número y moneda', () => {
    it('acepta el formato colombiano', () => {
      // Rechazarlo obligaría al cliente a escribir como el servidor.
      const r = normalizar(def('CURRENCY'), '1.234.567,89');
      expect(r.ok && r.valor.valueNumber?.toNumber()).toBe(1234567.89);
    });

    it('acepta el formato con punto decimal', () => {
      const r = normalizar(def('NUMBER'), '1234.5');
      expect(r.ok && r.valor.valueNumber?.toNumber()).toBe(1234.5);
    });

    it('usa Decimal y no Float', () => {
      // La moneda en coma flotante es como se acaba con centavos que no
      // cuadran: 0.1 + 0.2 no es 0.3.
      // Sumar centavos con Decimal da el resultado exacto; con Float, 0.1 + 0.2
      // da 0.30000000000000004 y las facturas dejan de cuadrar.
      const a = normalizar(def('CURRENCY'), 0.1);
      const b = normalizar(def('CURRENCY'), 0.2);
      expect(a.ok && b.ok).toBe(true);
      if (!a.ok || !b.ok) return;
      expect(a.valor.valueNumber!.plus(b.valor.valueNumber!).toNumber()).toBe(
        0.3,
      );
    });

    it('respeta min y max', () => {
      const d = def('NUMBER', { validation: { min: 10, max: 20 } });
      expect(normalizar(d, 15).ok).toBe(true);
      expect(normalizar(d, 5).ok).toBe(false);
      expect(normalizar(d, 25).ok).toBe(false);
    });

    it('rechaza lo que no cabe en la columna en vez de dejar que reviente', () => {
      expect(normalizar(def('NUMBER'), 1e15).ok).toBe(false);
    });

    it('rechaza texto que no es número', () => {
      expect(normalizar(def('NUMBER'), 'mucho').ok).toBe(false);
    });
  });

  describe('fecha', () => {
    it('interpreta dd/mm/aaaa como Colombia, no como Estados Unidos', () => {
      // Leer "03/08/2026" como 8 de marzo porque el servidor habla inglés es
      // el error de fechas más caro y más silencioso que existe.
      const r = normalizar(def('DATE'), '03/08/2026');
      expect(r.ok && r.valor.valueDate?.toISOString().slice(0, 10)).toBe(
        '2026-08-03',
      );
    });

    it('rechaza una fecha que no existe', () => {
      // "31/02/2026" produciría un 3 de marzo sin avisar.
      expect(normalizar(def('DATE'), '31/02/2026').ok).toBe(false);
    });

    it('acepta ISO', () => {
      const r = normalizar(def('DATETIME'), '2026-08-03T15:30:00.000Z');
      expect(r.ok).toBe(true);
    });

    it('rechaza texto que no es fecha', () => {
      expect(normalizar(def('DATE'), 'mañana').ok).toBe(false);
    });
  });

  describe('booleano', () => {
    it.each(['sí', 'si', 'true', '1', 'y'])('acepta %s como verdadero', (v) => {
      const r = normalizar(def('BOOLEAN'), v);
      expect(r.ok && r.valor.valueBool).toBe(true);
    });

    it.each(['no', 'false', '0'])('acepta %s como falso', (v) => {
      const r = normalizar(def('BOOLEAN'), v);
      expect(r.ok && r.valor.valueBool).toBe(false);
    });

    it('rechaza lo ambiguo', () => {
      expect(normalizar(def('BOOLEAN'), 'quizá').ok).toBe(false);
    });
  });

  describe('correo, teléfono y URL', () => {
    it('guarda el correo en minúsculas', () => {
      // Buscar por correo debe encontrar lo mismo sin importar cómo lo
      // escribió quien lo capturó.
      const r = normalizar(def('EMAIL'), 'Ana@Ejemplo.COM');
      expect(r.ok && r.valor.valueText).toBe('ana@ejemplo.com');
    });

    it('rechaza un correo inválido', () => {
      expect(normalizar(def('EMAIL'), 'ana@').ok).toBe(false);
    });

    it('acepta un teléfono en E.164', () => {
      expect(normalizar(def('PHONE'), '+573001112233').ok).toBe(true);
    });

    it('rechaza un teléfono que es texto', () => {
      expect(normalizar(def('PHONE'), 'llámame').ok).toBe(false);
    });

    it('solo admite https en las URL', () => {
      // El valor se acaba abriendo desde el panel del asesor.
      expect(normalizar(def('URL'), 'https://ejemplo.com/x').ok).toBe(true);
      expect(normalizar(def('URL'), 'http://ejemplo.com').ok).toBe(false);
    });

    it('rechaza javascript: en una URL', () => {
      // Guardarla sería un ataque contra el navegador del asesor.
      expect(normalizar(def('URL'), 'javascript:alert(1)').ok).toBe(false);
    });

    it('rechaza credenciales en la URL', () => {
      expect(normalizar(def('URL'), 'https://u:p@ejemplo.com').ok).toBe(false);
    });
  });

  describe('selección', () => {
    const opciones = [
      { value: 'alto', label: 'Alto' },
      { value: 'bajo', label: 'Bajo' },
    ];

    it('acepta el valor', () => {
      const r = normalizar(def('SELECT', { options: opciones }), 'alto');
      expect(r.ok && r.valor.valueText).toBe('alto');
    });

    it('acepta también la etiqueta visible', () => {
      // Quien configura un bot escribe lo que ve en la pantalla, no el
      // identificador interno.
      const r = normalizar(def('SELECT', { options: opciones }), 'Bajo');
      expect(r.ok && r.valor.valueText).toBe('bajo');
    });

    it('rechaza una opción que no existe', () => {
      const r = normalizar(def('SELECT', { options: opciones }), 'medio');
      expect(r.ok).toBe(false);
    });

    it('la selección múltiple no duplica', () => {
      // Marcar dos veces la misma casilla no es dos valores.
      const r = normalizar(def('MULTI_SELECT', { options: opciones }), [
        'alto',
        'alto',
        'bajo',
      ]);
      expect(r.ok && r.valor.valueList).toEqual(['alto', 'bajo']);
    });

    it('la selección múltiple acepta una cadena separada por comas', () => {
      const r = normalizar(
        def('MULTI_SELECT', { options: opciones }),
        'alto, bajo',
      );
      expect(r.ok && r.valor.valueList).toEqual(['alto', 'bajo']);
    });
  });

  describe('opciones mal formadas', () => {
    it('descarta las que no tienen valor', () => {
      expect(leerOpciones([{ label: 'sin valor' }, { value: 'ok' }])).toEqual([
        { value: 'ok', label: 'ok' },
      ]);
    });

    it('una lista que no es lista devuelve vacío', () => {
      expect(leerOpciones('alto,bajo')).toEqual([]);
    });
  });

  describe('representación legible', () => {
    it('nunca produce [object Object]', () => {
      const tipos: CustomFieldType[] = [
        'TEXT',
        'NUMBER',
        'CURRENCY',
        'BOOLEAN',
        'DATE',
        'DATETIME',
        'MULTI_SELECT',
      ];
      for (const t of tipos) {
        expect(comoCadena(t, null)).toBeNull();
      }
    });

    it('el booleano se lee como sí/no, no como true/false', () => {
      expect(comoCadena('BOOLEAN', { valueBool: true })).toBe('sí');
      expect(comoCadena('BOOLEAN', { valueBool: false })).toBe('no');
    });
  });

  describe('claves derivadas de la etiqueta', () => {
    it('quita acentos y espacios', () => {
      expect(claveDesdeEtiqueta('Estado de crédito')).toBe('estado_de_credito');
    });

    it('una clave que empezaría por número se prefija', () => {
      // El CHECK de la base exige que empiece por letra.
      expect(claveDesdeEtiqueta('2do teléfono')).toMatch(/^[a-z]/);
    });

    it('es estable: la misma etiqueta da la misma clave', () => {
      expect(claveDesdeEtiqueta('Cédula')).toBe(claveDesdeEtiqueta('Cédula'));
    });
  });
});
