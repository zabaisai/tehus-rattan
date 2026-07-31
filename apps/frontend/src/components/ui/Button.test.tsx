import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';
import { Badge, tonoDeEstadoConversacion, tonoDeEstadoLead } from './Badge';

describe('Button', () => {
  describe('reglas de marca que no se pueden incumplir', () => {
    it('el botón naranja lleva texto NAVY, nunca blanco', () => {
      // Blanco sobre #FF6A00 no alcanza el contraste mínimo. Escrita a mano
      // en cada pantalla, esta regla se rompe la primera vez que alguien
      // copia y pega un botón.
      render(<Button variant="accent">Acento</Button>);

      const boton = screen.getByRole('button');
      expect(boton.className).toContain('text-brand-primary');
      expect(boton.className).not.toContain('text-white');
    });

    it('el botón principal es el navy de marca', () => {
      render(<Button variant="primary">Guardar</Button>);

      expect(screen.getByRole('button').className).toContain(
        'bg-brand-primary',
      );
    });

    it('el destructivo usa el rojo de ESTADO, no un rojo cualquiera', () => {
      render(<Button variant="danger">Eliminar</Button>);

      expect(screen.getByRole('button').className).toContain('bg-status-error');
    });
  });

  describe('accesibilidad', () => {
    it('todas las variantes traen anillo de foco visible', () => {
      // Es lo primero que desaparece cuando cada botón trae sus clases, y
      // quien navega con teclado se queda sin saber dónde está.
      for (const variant of [
        'primary',
        'accent',
        'secondary',
        'quiet',
        'danger',
      ] as const) {
        const { unmount } = render(<Button variant={variant}>X</Button>);
        expect(screen.getByRole('button').className).toContain(
          'focus-visible:ring-2',
        );
        unmount();
      }
    });

    it('usa focus-visible y no focus, para no marcarlo con el ratón', () => {
      render(<Button>X</Button>);

      const clases = screen.getByRole('button').className;
      expect(clases).toContain('focus-visible:ring');
      expect(clases).not.toMatch(/(^|\s)focus:ring/);
    });
  });

  describe('comportamiento', () => {
    it('por defecto es type="button", NO submit', async () => {
      // Dentro de un formulario, un botón sin tipo lo envía. Es el origen de
      // "se guardó solo al pulsar cancelar", y basta con olvidarlo una vez.
      const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
      const user = userEvent.setup();
      render(
        <form onSubmit={onSubmit}>
          <Button>Cancelar</Button>
        </form>,
      );

      await user.click(screen.getByRole('button'));

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('se puede pedir submit explícitamente', async () => {
      const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
      const user = userEvent.setup();
      render(
        <form onSubmit={onSubmit}>
          <Button type="submit">Guardar</Button>
        </form>,
      );

      await user.click(screen.getByRole('button'));

      expect(onSubmit).toHaveBeenCalled();
    });

    it('deshabilitado no dispara el clic', async () => {
      const onClick = vi.fn();
      const user = userEvent.setup();
      render(
        <Button disabled onClick={onClick}>
          X
        </Button>,
      );

      await user.click(screen.getByRole('button'));

      expect(onClick).not.toHaveBeenCalled();
    });

    it('admite clases adicionales sin perder las suyas', () => {
      render(<Button className="w-full">X</Button>);

      const clases = screen.getByRole('button').className;
      expect(clases).toContain('w-full');
      expect(clases).toContain('bg-brand-primary');
    });
  });
});

describe('Badge', () => {
  it('el tono acento es naranja de FONDO con texto navy', () => {
    // Nunca naranja como texto fino sobre claro: es lo que prohíbe el manual
    // por contraste.
    render(<Badge tone="accent">3</Badge>);

    const clases = screen.getByText('3').className;
    expect(clases).toContain('bg-brand-secondary');
    expect(clases).toContain('text-brand-primary');
  });

  it('usa los colores semánticos, no una paleta suelta', () => {
    // Cuando cada pantalla elige su verde, "resuelto" acaba teniendo tres
    // verdes distintos y el usuario deja de leerlos como una señal.
    render(<Badge tone="success">Resuelta</Badge>);

    expect(screen.getByText('Resuelta').className).toContain('status-success');
  });

  describe('traducción de estado a color', () => {
    it('cada estado de conversación tiene un tono estable', () => {
      expect(tonoDeEstadoConversacion('RESOLVED')).toBe('success');
      expect(tonoDeEstadoConversacion('PENDING')).toBe('warning');
      expect(tonoDeEstadoConversacion('OPEN')).toBe('info');
      expect(tonoDeEstadoConversacion('ARCHIVED')).toBe('neutral');
    });

    it('un estado desconocido no rompe: cae en neutral', () => {
      expect(tonoDeEstadoConversacion('INVENTADO')).toBe('neutral');
    });

    it('ganada es verde y perdida es roja', () => {
      expect(tonoDeEstadoLead('WON')).toBe('success');
      expect(tonoDeEstadoLead('LOST')).toBe('error');
      expect(tonoDeEstadoLead('OPEN')).toBe('info');
    });
  });
});
