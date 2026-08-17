import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from './Tooltip';

/**
 * UN ICONO SIN TEXTO TIENE QUE PODER EXPLICARSE.
 *
 * El atributo `title` del navegador no sirve para esto y la revisión humana lo
 * demostró: tarda alrededor de un segundo, no aparece NUNCA al llegar por
 * teclado, y su aspecto no es el del producto. Quien pasó el cursor por el
 * icono de la papelera no vio nada y no supo qué hacía.
 *
 * Esta primitiva es la mínima que cubre las dos vías —ratón y foco— y describe
 * el control sin robarle su nombre accesible: el nombre lo da `aria-label` del
 * botón, y el tooltip va como DESCRIPCIÓN (`aria-describedby`). Si fuera el
 * nombre, un lector de pantalla leería la misma frase dos veces.
 */
describe('Tooltip', () => {
  const conBoton = () =>
    render(
      <Tooltip texto="Archivar contacto">
        <button type="button" aria-label="Archivar a Ana Restrepo">
          <span aria-hidden="true">□</span>
        </button>
      </Tooltip>,
    );

  it('no se ve hasta que hace falta', () => {
    conBoton();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('aparece al pasar el ratón', async () => {
    const usuario = userEvent.setup();
    conBoton();

    await usuario.hover(screen.getByRole('button'));

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Archivar contacto',
    );
  });

  it('aparece también al llegar por TECLADO, que es lo que `title` nunca hace', async () => {
    const usuario = userEvent.setup();
    conBoton();

    await usuario.tab();

    expect(screen.getByRole('button')).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Archivar contacto',
    );
  });

  it('se va al salir el ratón y al perder el foco', async () => {
    const usuario = userEvent.setup();
    conBoton();

    await usuario.hover(screen.getByRole('button'));
    await screen.findByRole('tooltip');
    await usuario.unhover(screen.getByRole('button'));
    expect(screen.queryByRole('tooltip')).toBeNull();

    await usuario.tab();
    await screen.findByRole('tooltip');
    await usuario.tab();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('Escape lo cierra sin mover el foco', async () => {
    // Un tooltip pegado al control puede tapar lo que hay debajo. Escape es la
    // salida que espera cualquiera, y no debe sacar el foco del botón.
    const usuario = userEvent.setup();
    conBoton();

    await usuario.tab();
    await screen.findByRole('tooltip');

    await usuario.keyboard('{Escape}');

    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByRole('button')).toHaveFocus();
  });

  it('DESCRIBE el control, no lo renombra', async () => {
    const usuario = userEvent.setup();
    conBoton();

    await usuario.hover(screen.getByRole('button'));
    const tooltip = await screen.findByRole('tooltip');
    const boton = screen.getByRole('button');

    // El nombre sigue saliendo de `aria-label`.
    expect(boton).toHaveAccessibleName('Archivar a Ana Restrepo');
    // Y la explicación va aparte, enlazada por id.
    expect(boton.getAttribute('aria-describedby')).toBe(tooltip.id);
  });

  it('sin texto no estorba: no envuelve nada ni describe nada', async () => {
    const usuario = userEvent.setup();
    render(
      <Tooltip texto="">
        <button type="button" aria-label="Sin explicación" />
      </Tooltip>,
    );

    await usuario.hover(screen.getByRole('button'));

    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-describedby');
  });

  it('un control DESHABILITADO también puede explicarse', async () => {
    // Los eventos se escuchan en el ENVOLTORIO, no en el hijo: un control
    // inerte puede no emitirlos, y entonces el caso en el que más falta hace
    // la explicación sería justo el que no la da.
    const usuario = userEvent.setup();
    render(
      <Tooltip texto="Un contacto anonimizado ya no conserva datos de contacto.">
        <button
          type="button"
          aria-disabled="true"
          aria-label="Restaurar a Contacto anonimizado"
        >
          <span aria-hidden="true">□</span>
        </button>
      </Tooltip>,
    );

    await usuario.hover(screen.getByRole('button'));

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      /anonimizado/i,
    );
  });
});
