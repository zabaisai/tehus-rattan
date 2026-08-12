import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Target } from 'lucide-react';
import { MetricCard } from './MetricCard';
import { Avatar, iniciales } from './Avatar';
import { ForbiddenState } from './ForbiddenState';
import { Panel, esSinPermiso } from './Panel';

describe('MetricCard', () => {
  it('SIEMPRE es un enlace: una métrica que no lleva a ningún sitio solo informa', () => {
    render(
      <MetricCard
        etiqueta="Tareas vencidas"
        valor={5}
        icono={Target}
        href="/dashboard/tasks"
        hrefLabel="Abrir tareas"
      />,
    );

    expect(screen.getByRole('link')).toHaveAttribute('href', '/dashboard/tasks');
  });

  it('el nombre accesible incluye etiqueta, valor y destino', () => {
    render(
      <MetricCard
        etiqueta="Conversión"
        valor="18,4 %"
        icono={Target}
        href="/dashboard/pipeline"
        hrefLabel="Abrir el embudo"
      />,
    );

    expect(
      screen.getByRole('link', { name: 'Conversión: 18,4 %. Abrir el embudo' }),
    ).toBeInTheDocument();
  });

  it('cargando no muestra un valor falso ni un cero', () => {
    render(
      <MetricCard
        etiqueta="Conversión"
        valor=""
        cargando
        icono={Target}
        href="/x"
        hrefLabel="Abrir"
      />,
    );

    expect(screen.getByRole('link', { name: /cargando/ })).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('las cifras van en tabular para que la fila no baile al actualizarse', () => {
    render(
      <MetricCard etiqueta="X" valor={1234} icono={Target} href="/x" hrefLabel="Abrir" />,
    );

    expect(screen.getByText('1234').className).toContain('tabular-nums');
  });

  it('el tono de atención usa el token de aviso, no un color suelto', () => {
    const { container } = render(
      <MetricCard
        etiqueta="Tareas vencidas"
        valor={5}
        icono={Target}
        href="/x"
        hrefLabel="Abrir"
        tono="atencion"
      />,
    );

    expect(container.innerHTML).toContain('status-warning-surface');
  });
});

describe('Avatar', () => {
  it('usa iniciales, nunca una fotografía', () => {
    const { container } = render(<Avatar nombre="Ana Restrepo" />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('AR');
  });

  it('un nombre de una sola palabra da dos letras', () => {
    expect(iniciales('Laura')).toBe('LA');
  });

  it('sin nombre no revienta', () => {
    expect(iniciales(null)).toBe('?');
    expect(iniciales('   ')).toBe('?');
  });

  it('el mismo nombre da siempre el mismo tono', () => {
    const a = render(<Avatar nombre="Ana Restrepo" />).container.firstElementChild?.className;
    const b = render(<Avatar nombre="Ana Restrepo" />).container.firstElementChild?.className;
    expect(a).toBe(b);
  });

  it('es decorativo: el nombre ya está escrito al lado', () => {
    const { container } = render(<Avatar nombre="Ana" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('ForbiddenState', () => {
  it('no invita a reintentar: un 403 no se arregla reintentando', () => {
    render(<ForbiddenState detalle="Solo un administrador lo ve." />);

    expect(screen.getByText(/No tienes permiso/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Panel', () => {
  it('sin permiso gana al error: un 403 no es una avería', () => {
    render(
      <Panel titulo="Embudo" sinPermiso error={{ response: { status: 403 } }}>
        <p>datos</p>
      </Panel>,
    );

    expect(screen.getByText(/No tienes permiso/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('datos')).not.toBeInTheDocument();
  });

  it('cargando marca la región como ocupada', () => {
    render(<Panel titulo="Agenda de hoy" cargando />);

    expect(screen.getByRole('region', { name: 'Agenda de hoy' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('el error se anuncia como alerta', () => {
    render(<Panel titulo="X" error={{ response: { status: 500 } }} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('vacío orienta en vez de dejar el bloque en blanco', () => {
    render(<Panel titulo="X" vacio mensajeVacio="No hay nada." />);

    expect(screen.getByText('No hay nada.')).toBeInTheDocument();
  });

  it('la acción se oculta cuando no hay permiso: no lleva a un muro', () => {
    render(<Panel titulo="X" sinPermiso accion={{ href: '/x', etiqueta: 'Ver todo' }} />);

    expect(screen.queryByRole('link', { name: 'Ver todo' })).not.toBeInTheDocument();
  });

  it('esSinPermiso distingue el 403 de cualquier otro fallo', () => {
    expect(esSinPermiso({ response: { status: 403 } })).toBe(true);
    expect(esSinPermiso({ response: { status: 500 } })).toBe(false);
    expect(esSinPermiso(undefined)).toBe(false);
  });
});
