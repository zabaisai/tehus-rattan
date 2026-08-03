import {
  escaparParaInterfaz,
  evaluarCondicion,
  interpolar,
  interpolarConfig,
  variablesDe,
} from './flowbot.variables';

describe('variables de FlowBot', () => {
  describe('interpolar', () => {
    it('sustituye rutas con punto', () => {
      expect(
        interpolar('Hola {{contact.name}}', { contact: { name: 'Ana' } }),
      ).toBe('Hola Ana');
    });

    it('admite espacios dentro de las llaves', () => {
      expect(
        interpolar('{{ contact.name }}', { contact: { name: 'Ana' } }),
      ).toBe('Ana');
    });

    it('deja el hueco cuando no hay valor, en vez de escribir "undefined"', () => {
      // Mandarle «undefined» a un cliente por WhatsApp es peor que no
      // sustituir: al menos el hueco se ve y alguien lo corrige.
      expect(interpolar('Hola {{contact.name}}', {})).toBe(
        'Hola {{contact.name}}',
      );
    });

    it('usa el valor por defecto cuando se indica', () => {
      expect(interpolar('Hola {{contact.name|cliente}}', {})).toBe(
        'Hola cliente',
      );
    });

    it('el valor por defecto también cubre la cadena vacía', () => {
      expect(
        interpolar('Hola {{contact.name|cliente}}', { contact: { name: '' } }),
      ).toBe('Hola cliente');
    });

    it('NO pinta objetos como [object Object]', () => {
      // Mismo criterio que en el chatbot v1 y en la importacion de productos.
      expect(interpolar('{{x}}', { x: { a: 1 } })).toBe('{{x}}');
    });

    it('convierte números y booleanos', () => {
      expect(interpolar('{{a}} {{b}}', { a: 42, b: true })).toBe('42 true');
    });

    describe('seguridad', () => {
      it('NO permite llegar al prototipo', () => {
        // Sin el filtro de propiedades propias, esto daria acceso a la cadena
        // de prototipos desde una plantilla que edita el cliente.
        expect(interpolar('{{constructor.name}}', {})).toBe(
          '{{constructor.name}}',
        );
        expect(interpolar('{{__proto__.x}}', {})).toBe('{{__proto__.x}}');
        expect(interpolar('{{toString}}', {})).toBe('{{toString}}');
      });

      it('NO evalúa expresiones: solo sustituye rutas', () => {
        // No hay interprete. `1+1` no es una ruta valida y se queda tal cual.
        expect(interpolar('{{1+1}}', {})).toBe('{{1+1}}');
        expect(interpolar('{{a.b()}}', { a: { b: 1 } })).toBe('{{a.b()}}');
      });

      it('no baja por valores que no son objetos', () => {
        expect(interpolar('{{a.b.c}}', { a: 'texto' })).toBe('{{a.b.c}}');
      });
    });
  });

  describe('variablesDe', () => {
    it('encuentra las variables de un texto', () => {
      expect([...variablesDe('{{a.b}} y {{c}}')]).toEqual(['a.b', 'c']);
    });

    it('recorre listas y objetos anidados', () => {
      const config = { text: '{{a}}', options: [{ label: '{{b}}' }] };
      expect([...variablesDe(config)].sort()).toEqual(['a', 'b']);
    });

    it('ignora lo que no es una variable', () => {
      expect([...variablesDe('{ a } {{ }} {{1}}')]).toEqual([]);
    });
  });

  describe('interpolarConfig', () => {
    it('respeta la forma: los números siguen siendo números', () => {
      const salida = interpolarConfig(
        { text: 'Hola {{n}}', seconds: 30, options: ['{{n}}'] },
        { n: 'Ana' },
      );
      expect(salida).toEqual({
        text: 'Hola Ana',
        seconds: 30,
        options: ['Ana'],
      });
    });
  });

  describe('evaluarCondicion', () => {
    it('compara texto sin distinguir mayúsculas ni acentos', () => {
      // En un chat, «Bogotá» y «bogota» quieren decir lo mismo; que cambien de
      // rama por un acento seria un fallo del producto, no del cliente.
      expect(evaluarCondicion('Bogotá', 'igual', 'bogota')).toBe(true);
      expect(evaluarCondicion('  SÍ  ', 'igual', 'si')).toBe(true);
    });

    it('contiene / empieza / termina', () => {
      expect(evaluarCondicion('quiero cotizar', 'contiene', 'cotiz')).toBe(
        true,
      );
      expect(evaluarCondicion('quiero cotizar', 'no_contiene', 'factura')).toBe(
        true,
      );
      expect(evaluarCondicion('quiero', 'empieza', 'qui')).toBe(true);
      expect(evaluarCondicion('quiero', 'termina', 'ero')).toBe(true);
    });

    it('existencia y vacío', () => {
      expect(evaluarCondicion(undefined, 'no_existe')).toBe(true);
      expect(evaluarCondicion(null, 'no_existe')).toBe(true);
      expect(evaluarCondicion('x', 'existe')).toBe(true);
      expect(evaluarCondicion('   ', 'vacio')).toBe(true);
      expect(evaluarCondicion('x', 'no_vacio')).toBe(true);
    });

    it('compara números', () => {
      expect(evaluarCondicion(10, 'mayor', 5)).toBe(true);
      expect(evaluarCondicion('10', 'mayor_igual', 10)).toBe(true);
      expect(evaluarCondicion(3, 'menor', 5)).toBe(true);
    });

    it('entiende el formato de miles colombiano', () => {
      expect(evaluarCondicion('1.500.000', 'mayor', 1000000)).toBe(true);
      expect(evaluarCondicion('1.234,56', 'mayor', 1234)).toBe(true);
    });

    it('comparar texto con número devuelve false, no una excepción', () => {
      // Es una condicion mal configurada. Reventar a mitad de una
      // conversacion seria peor que no cumplirse.
      expect(evaluarCondicion('abc', 'mayor', 5)).toBe(false);
      expect(evaluarCondicion('abc', 'menor', 5)).toBe(false);
    });
  });

  describe('escaparParaInterfaz', () => {
    it('neutraliza el HTML que llegue del cliente', () => {
      // Lo que escribe un cliente por WhatsApp acaba pintado en el panel del
      // asesor: sin escapar, un mensaje ataca a quien lo lee.
      expect(escaparParaInterfaz('<img src=x onerror=alert(1)>')).toBe(
        '&lt;img src=x onerror=alert(1)&gt;',
      );
      expect(escaparParaInterfaz(`"&'`)).toBe('&quot;&amp;&#39;');
    });
  });
});
