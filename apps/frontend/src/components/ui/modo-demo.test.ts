import { describe, expect, it } from 'vitest';
import { mensajeDeError } from './ListState';

/**
 * UN 403 DE MODO DEMO NO ES «NO TIENES PERMISO».
 *
 * Antes, cualquier 403 se traducia igual: «No tienes permiso para ver esto.»
 * Delante de alguien a quien le estas enseñando el producto, eso es lo peor
 * que puede decir la pantalla: parece que su cuenta esta mal configurada.
 *
 * El backend manda un `code` estable justo para esto. Se distingue por el
 * codigo y no por el texto, porque reescribir una frase no puede volver a
 * romper la explicacion.
 */
describe('mensajeDeError con modo demo', () => {
  const error403Demo = {
    response: {
      status: 403,
      data: {
        statusCode: 403,
        code: 'MODO_DEMO',
        accion: 'enviar un WhatsApp',
        message:
          'Modo demo: no se puede enviar un WhatsApp desde la empresa de demostración. Todo lo demás funciona igual que en una empresa real.',
      },
    },
  };

  it('explica QUE no se puede hacer, no que falte permiso', () => {
    const m = mensajeDeError(error403Demo);
    expect(m).toMatch(/Modo demo/i);
    expect(m).toMatch(/enviar un WhatsApp/);
    expect(m).not.toMatch(/No tienes permiso/i);
  });

  it('un 403 normal sigue diciendo que falta permiso', () => {
    expect(
      mensajeDeError({ response: { status: 403, data: { message: 'prohibido' } } }),
    ).toMatch(/No tienes permiso/i);
  });

  it('un 401 sigue siendo sesión caducada', () => {
    expect(mensajeDeError({ response: { status: 401 } })).toMatch(/sesión caducó/i);
  });
});
