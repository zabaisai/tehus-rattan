import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListState, mensajeDeError } from './ListState';

describe('ListState', () => {
  it('un error NO se dibuja como estado vacío', () => {
    render(
      <ListState
        isLoading={false}
        isError
        isEmpty
        emptyMessage="No hay tareas."
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No hay tareas.')).not.toBeInTheDocument();
  });

  it('el vacío se dibuja solo cuando la carga fue bien', () => {
    render(
      <ListState
        isLoading={false}
        isError={false}
        isEmpty
        emptyMessage="No hay tareas."
      />,
    );

    expect(screen.getByText('No hay tareas.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('cargando no enseña ni vacío ni error', () => {
    render(
      <ListState
        isLoading
        isError
        isEmpty
        emptyMessage="No hay tareas."
      />,
    );

    expect(screen.getByText('Cargando…')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('con datos no dibuja nada: la lista es de la pantalla', () => {
    const { container } = render(
      <ListState
        isLoading={false}
        isError={false}
        isEmpty={false}
        emptyMessage="No hay tareas."
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('reintenta cuando se pulsa', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(
      <ListState
        isLoading={false}
        isError
        isEmpty={false}
        onRetry={onRetry}
        emptyMessage=""
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('mensajeDeError', () => {
  it('un 403 dice que falta permiso, no que se cayó algo', () => {
    expect(mensajeDeError({ response: { status: 403 } })).toMatch(
      /No tienes permiso/i,
    );
  });

  it('un 401 manda a volver a entrar', () => {
    expect(mensajeDeError({ response: { status: 401 } })).toMatch(/caducó/i);
  });

  it('usa el motivo del servidor cuando lo hay', () => {
    expect(
      mensajeDeError({
        response: { status: 400, data: { message: 'Plazo demasiado corto' } },
      }),
    ).toBe('Plazo demasiado corto');
  });

  it('acepta la lista de errores de validación de Nest', () => {
    expect(
      mensajeDeError({
        response: { status: 400, data: { message: ['csv no puede estar vacío'] } },
      }),
    ).toBe('csv no puede estar vacío');
  });

  it('un fallo de red cae en el genérico, que menciona la conexión', () => {
    expect(mensajeDeError(new Error('Network Error'))).toMatch(/conexión/i);
  });
});
