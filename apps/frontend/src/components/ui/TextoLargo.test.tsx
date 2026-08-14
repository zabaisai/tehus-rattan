import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { TextoLargo, puntosDeCorte } from './TextoLargo';

/**
 * VALORES LARGOS SIN CORTES ABSURDOS.
 *
 * `break-words` parte donde le toque: «PREVIEW_BRANDING_Mueb / les del Valle»,
 * «PREVIEW_BRANDING_A / dministrador», un correo que deja una «d» sola en la
 * línea siguiente. Evitar el desbordamiento no justifica destrozar la lectura.
 *
 * La solución no es prohibir el salto —entonces el texto se sale— sino decir
 * DÓNDE puede saltar: después de los separadores que ya existen en el propio
 * dato (`_`, `.`, `@`, `-`, `/`). Ahí el corte se lee como una pausa natural.
 */

describe('puntosDeCorte', () => {
  it('parte un identificador de empresa por sus guiones bajos', () => {
    expect(puntosDeCorte('PREVIEW_BRANDING_Muebles del Valle')).toEqual([
      'PREVIEW_',
      'BRANDING_',
      'Muebles del Valle',
    ]);
  });

  it('parte un correo por el punto y la arroba', () => {
    expect(puntosDeCorte('marcela.tobon@example.invalid')).toEqual([
      'marcela.',
      'tobon@',
      'example.',
      'invalid',
    ]);
  });

  it('un texto normal no se trocea', () => {
    expect(puntosDeCorte('Comedor para terraza')).toEqual([
      'Comedor para terraza',
    ]);
  });

  it('no deja trozos de una sola letra colgando', () => {
    // «A_B_C» partido daría «A_», «B_», «C»: el último es una letra suelta,
    // justo lo que se quiere evitar. Se pega al anterior.
    const trozos = puntosDeCorte('QA_INBOX_ Comedor');
    expect(trozos.every((t) => t.trim().length > 1)).toBe(true);
  });

  it('un valor vacío no rompe', () => {
    expect(puntosDeCorte('')).toEqual([]);
    expect(puntosDeCorte(null)).toEqual([]);
  });
});

describe('TextoLargo', () => {
  it('enseña el valor completo', () => {
    const { container } = render(
      <TextoLargo valor="PREVIEW_BRANDING_Muebles del Valle" />,
    );
    // El texto viaja troceado en el marcado, pero lo que se lee es el valor
    // entero: los `wbr` no aportan caracteres.
    expect(container.textContent).toBe('PREVIEW_BRANDING_Muebles del Valle');
  });

  it('lleva el valor completo en `title`, por si acaso se recorta', () => {
    const { container } = render(
      <TextoLargo valor="marcela.tobon@example.invalid" />,
    );
    expect(container.firstChild).toHaveAttribute(
      'title',
      'marcela.tobon@example.invalid',
    );
  });

  it('NO usa el partido indiscriminado de palabras', () => {
    const { container } = render(<TextoLargo valor="PREVIEW_BRANDING_Administrador" />);
    const clases = (container.firstChild as HTMLElement).className;
    expect(clases).not.toContain('break-words');
    expect(clases).not.toContain('break-all');
  });

  it('inserta las oportunidades de corte en el marcado', () => {
    const { container } = render(
      <TextoLargo valor="PREVIEW_BRANDING_Administrador" />,
    );
    expect(container.querySelectorAll('wbr').length).toBeGreaterThan(0);
  });

  it('un valor corto no lleva ningún corte', () => {
    const { container } = render(<TextoLargo valor="Negociación" />);
    expect(container.querySelectorAll('wbr')).toHaveLength(0);
  });

  it('un guion telefónico no se convierte en punto de corte raro', () => {
    // Los teléfonos van en una sola pieza: partir un número por la mitad
    // hace que se lea mal y se copie peor.
    const { container } = render(
      <TextoLargo valor="+573001110301" mono />,
    );
    expect(container.querySelectorAll('wbr')).toHaveLength(0);
  });
});
