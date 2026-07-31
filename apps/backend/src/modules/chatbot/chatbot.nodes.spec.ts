import {
  elegirOpcion,
  interpolar,
  validarFlujo,
  type FlujoChatbot,
} from './chatbot.nodes';

const flujoValido: FlujoChatbot = {
  start: 'hola',
  nodes: [
    {
      id: 'hola',
      type: 'menu',
      text: '¿Qué necesitas?',
      options: [
        { label: 'Precio', next: 'precio' },
        { label: 'Asesor', next: 'asesor' },
      ],
    },
    { id: 'precio', type: 'message', text: 'Cuesta 100', next: 'asesor' },
    { id: 'asesor', type: 'handoff', text: 'Te paso con alguien' },
  ],
};

describe('validarFlujo', () => {
  it('un flujo correcto no da problemas', () => {
    expect(validarFlujo(flujoValido)).toEqual([]);
  });

  it('un flujo vacío se rechaza', () => {
    expect(validarFlujo({ start: 'x', nodes: [] })).toHaveLength(1);
  });

  it('el nodo inicial debe existir', () => {
    const problemas = validarFlujo({ ...flujoValido, start: 'inventado' });

    expect(problemas.some((p) => /inicial/i.test(p.mensaje))).toBe(true);
  });

  it('detecta un enlace a un nodo inexistente', () => {
    const problemas = validarFlujo({
      start: 'a',
      nodes: [{ id: 'a', type: 'message', text: 'hola', next: 'fantasma' }],
    });

    expect(problemas.some((p) => /no existe/i.test(p.mensaje))).toBe(true);
  });

  it('un menú sin opciones se rechaza', () => {
    const problemas = validarFlujo({
      start: 'a',
      nodes: [{ id: 'a', type: 'menu', text: 'elige', options: [] }],
    });

    expect(problemas.some((p) => /sin opciones/i.test(p.mensaje))).toBe(true);
  });

  it('una opción que apunta a la nada se rechaza', () => {
    const problemas = validarFlujo({
      start: 'a',
      nodes: [
        {
          id: 'a',
          type: 'menu',
          text: 'elige',
          options: [{ label: 'X', next: 'fantasma' }],
        },
      ],
    });

    expect(problemas.some((p) => /"X"/.test(p.mensaje))).toBe(true);
  });

  it('un mensaje sin continuación deja al cliente esperando', () => {
    const problemas = validarFlujo({
      start: 'a',
      nodes: [{ id: 'a', type: 'message', text: 'hola' }],
    });

    expect(problemas.some((p) => /siguiente paso/i.test(p.mensaje))).toBe(true);
  });

  it('`end` no necesita texto ni continuación', () => {
    const problemas = validarFlujo({
      start: 'a',
      nodes: [{ id: 'a', type: 'end' }],
    });

    expect(problemas).toEqual([]);
  });

  it('avisa de los nodos inalcanzables', () => {
    // Casi siempre son un enlace que el autor creía haber hecho.
    const problemas = validarFlujo({
      start: 'a',
      nodes: [
        { id: 'a', type: 'end', text: 'fin' },
        { id: 'huerfano', type: 'end', text: 'nadie llega aquí' },
      ],
    });

    expect(problemas.some((p) => p.nodeId === 'huerfano')).toBe(true);
  });

  it('detecta identificadores duplicados', () => {
    const problemas = validarFlujo({
      start: 'a',
      nodes: [
        { id: 'a', type: 'end', text: 'uno' },
        { id: 'a', type: 'end', text: 'dos' },
      ],
    });

    expect(problemas.some((p) => /mismo identificador/i.test(p.mensaje))).toBe(
      true,
    );
  });

  it('un flujo con un ciclo es válido: el tope de pasos lo corta en ejecución', () => {
    // Prohibirlos impediría un menú que vuelve a sí mismo, que es legítimo.
    const problemas = validarFlujo({
      start: 'a',
      nodes: [
        { id: 'a', type: 'message', text: 'uno', next: 'b' },
        { id: 'b', type: 'message', text: 'dos', next: 'a' },
      ],
    });

    expect(problemas).toEqual([]);
  });
});

describe('elegirOpcion', () => {
  const menu = flujoValido.nodes[0];

  it('acepta el número de la opción', () => {
    expect(elegirOpcion(menu, '2')?.next).toBe('asesor');
  });

  it('acepta el texto de la opción, sin distinguir mayúsculas', () => {
    expect(elegirOpcion(menu, '  PRECIO ')?.next).toBe('precio');
  });

  it('acepta una frase que contiene la opción', () => {
    // La gente responde "quiero el precio", no "1". Rechazarlo convierte el
    // menú en un examen.
    expect(elegirOpcion(menu, 'quiero saber el precio')?.next).toBe('precio');
  });

  const ambiguo = {
    id: 'm',
    type: 'menu' as const,
    text: 'elige',
    options: [
      { label: 'precio', next: 'a' },
      { label: 'precio final', next: 'b' },
    ],
  };

  it('la coincidencia EXACTA gana aunque otra etiqueta este contenida', () => {
    // "precio final" contiene "precio", pero es literalmente una opcion: ahi
    // no hay ambiguedad ninguna y adivinar seria absurdo.
    expect(elegirOpcion(ambiguo, 'precio final')?.next).toBe('b');
  });

  it('con una frase ambigua NO adivina', () => {
    // "dame el precio final" contiene las dos etiquetas. Elegir una al azar
    // manda al cliente por un camino que no pidio; repreguntar es barato.
    expect(elegirOpcion(ambiguo, 'dame el precio final')).toBeNull();
  });

  it('un número fuera de rango no elige nada', () => {
    expect(elegirOpcion(menu, '9')).toBeNull();
    expect(elegirOpcion(menu, '0')).toBeNull();
  });

  it('una respuesta vacía no elige nada', () => {
    expect(elegirOpcion(menu, '   ')).toBeNull();
  });
});

describe('interpolar', () => {
  it('sustituye lo que el cliente respondió antes', () => {
    expect(interpolar('Hola {{nombre}}', { nombre: 'Ana' })).toBe('Hola Ana');
  });

  it('tolera espacios dentro de las llaves', () => {
    expect(interpolar('Hola {{ nombre }}', { nombre: 'Ana' })).toBe('Hola Ana');
  });

  it('sin valor deja el texto tal cual, NUNCA "undefined"', () => {
    // Un replace ingenuo le escribe "Hola undefined" al cliente.
    expect(interpolar('Hola {{nombre}}', {})).toBe('Hola {{nombre}}');
  });

  it('un texto sin variables no se toca', () => {
    expect(interpolar('Hola', { nombre: 'Ana' })).toBe('Hola');
  });
});
