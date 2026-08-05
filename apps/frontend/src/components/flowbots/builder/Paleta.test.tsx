import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CatalogoDto, NodoCatalogoDto } from '@/lib/flowbots';
import { Paleta } from './Paleta';

function nodo(parcial: Partial<NodoCatalogoDto>): NodoCatalogoDto {
  return {
    tipo: 'send.text',
    categoria: 'conversation',
    etiqueta: 'Mensaje de texto',
    ayuda: 'Manda un mensaje',
    aceptaEntrada: true,
    puertos: [{ id: 'next', etiqueta: 'Continuar' }],
    config: [],
    esperaExterna: false,
    efectoExterno: false,
    requiereIA: false,
    rolMinimo: null,
    disponible: true,
    ...parcial,
  };
}

function catalogo(nodos: NodoCatalogoDto[]): CatalogoDto {
  return {
    nodos,
    categorias: [{ id: 'conversation', etiqueta: 'Conversación' }],
    limites: {},
    puertos: {},
    variables: [],
  };
}

describe('Paleta', () => {
  it('dibuja lo que manda el servidor, sin lista propia', () => {
    // Si la paleta tuviera su propia lista, un paso nuevo del backend no
    // aparecería hasta que alguien se acordara de añadirlo aquí.
    render(
      <Paleta
        catalogo={catalogo([
          nodo({ tipo: 'crm.lead_create', etiqueta: 'Crear oportunidad' }),
        ])}
        onAgregar={vi.fn()}
      />,
    );

    expect(screen.getByText('Crear oportunidad')).toBeInTheDocument();
  });

  it('un paso sin ejecutor se enseña apagado, no se esconde', () => {
    render(
      <Paleta
        catalogo={catalogo([
          nodo({
            tipo: 'ai.summarize',
            etiqueta: 'Resumir',
            disponible: false,
            motivoNoDisponible: 'Sin implementación',
          }),
        ])}
        onAgregar={vi.fn()}
      />,
    );

    // Que exista y todavía no funcione es información útil; que desaparezca
    // solo genera la duda de si se fue para siempre.
    const boton = screen.getByRole('button', { name: /Resumir/ });
    expect(boton).toBeDisabled();
    expect(screen.getByText('Todavía no se puede ejecutar')).toBeInTheDocument();
  });

  it('no deja añadir un paso que no se puede ejecutar', async () => {
    const onAgregar = vi.fn();
    render(
      <Paleta
        catalogo={catalogo([nodo({ etiqueta: 'Roto', disponible: false })])}
        onAgregar={onAgregar}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Roto/ }));
    expect(onAgregar).not.toHaveBeenCalled();
  });

  it('se puede añadir con un clic, no solo arrastrando', async () => {
    // Arrastrar es imposible con teclado; sin este camino la paleta entera
    // queda fuera del alcance de quien no usa ratón.
    const onAgregar = vi.fn();
    render(
      <Paleta catalogo={catalogo([nodo({})])} onAgregar={onAgregar} />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Mensaje de texto/ }));

    expect(onAgregar).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'send.text' }),
    );
  });

  it('avisa de los pasos que hay que configurar antes de usarlos', () => {
    render(
      <Paleta
        catalogo={catalogo([
          nodo({
            config: [{ nombre: 'text', tipo: 'texto', obligatorio: true }],
          }),
        ])}
        onAgregar={vi.fn()}
      />,
    );

    expect(screen.getByText('Requiere configuración')).toBeInTheDocument();
  });

  it('buscar filtra por nombre y por ayuda', async () => {
    render(
      <Paleta
        catalogo={catalogo([
          nodo({ tipo: 'send.text', etiqueta: 'Mensaje de texto' }),
          nodo({
            tipo: 'crm.handoff',
            etiqueta: 'Entregar a un asesor',
            ayuda: 'Deja de contestar el bot',
          }),
        ])}
        onAgregar={vi.fn()}
      />,
    );

    await userEvent.type(screen.getByLabelText('Buscar un paso'), 'asesor');

    expect(screen.getByText('Entregar a un asesor')).toBeInTheDocument();
    expect(screen.queryByText('Mensaje de texto')).not.toBeInTheDocument();
  });

  it('un tipo que no encaja en ningún grupo aparece igualmente', () => {
    // La regla que importa: agrupar nunca puede FILTRAR. Un paso de una
    // categoría futura tiene que verse aunque nadie haya escrito su cajón.
    render(
      <Paleta
        catalogo={catalogo([
          nodo({
            tipo: 'futuro.desconocido',
            categoria: 'desconocida' as never,
            etiqueta: 'Algo nuevo',
          }),
        ])}
        onAgregar={vi.fn()}
      />,
    );

    expect(screen.getByText('Algo nuevo')).toBeInTheDocument();
  });
});
