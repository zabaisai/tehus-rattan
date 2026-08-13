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

describe('MetricCard — tendencia, que nunca se inventa', () => {
  it('NO dibuja curva con menos de dos puntos', () => {
    // Una recta sobre un solo día sugiere una estabilidad que nadie ha medido.
    const { container } = render(
      <MetricCard
        etiqueta="Abiertas"
        valor={3}
        icono={Target}
        href="/x"
        hrefLabel="Abrir"
        serie={[5]}
      />,
    );
    expect(container.querySelector('svg path')).toBeNull();
  });

  it('dibuja la curva cuando la serie existe de verdad', () => {
    const { container } = render(
      <MetricCard
        etiqueta="Abiertas"
        valor={3}
        icono={Target}
        href="/x"
        hrefLabel="Abrir"
        serie={[1, 4, 2, 7]}
      />,
    );
    expect(container.querySelectorAll('svg path').length).toBeGreaterThan(0);
  });

  it('una serie plana no rompe el dibujo (sin división por cero)', () => {
    const { container } = render(
      <MetricCard
        etiqueta="Abiertas"
        valor={0}
        icono={Target}
        href="/x"
        hrefLabel="Abrir"
        serie={[0, 0, 0]}
      />,
    );
    const d = container.querySelector('svg path')?.getAttribute('d') ?? '';
    expect(d).not.toContain('NaN');
  });

  it('la comparación entra en el nombre accesible, no solo en la flecha', () => {
    render(
      <MetricCard
        etiqueta="Abiertas"
        valor={7}
        icono={Target}
        href="/x"
        hrefLabel="Abrir el embudo"
        comparacion={{ texto: '+3', contra: 'vs. 30 días previos', direccion: 'sube' }}
      />,
    );
    expect(
      screen.getByRole('link', {
        name: 'Abiertas: 7. +3 vs. 30 días previos. Abrir el embudo',
      }),
    ).toBeInTheDocument();
  });

  it('subir no siempre es bueno: el color sale de la métrica, no del signo', () => {
    const { container } = render(
      <MetricCard
        etiqueta="Tareas vencidas"
        valor={9}
        icono={Target}
        href="/x"
        hrefLabel="Abrir"
        comparacion={{
          texto: '+4',
          contra: 'vs. ayer',
          direccion: 'sube',
          subirEsBueno: false,
        }}
      />,
    );
    expect(container.innerHTML).toContain('text-status-error');
    expect(container.innerHTML).not.toContain('text-status-success-strong');
  });

  it('sin cambio, el color se queda neutro', () => {
    const { container } = render(
      <MetricCard
        etiqueta="Abiertas"
        valor={7}
        icono={Target}
        href="/x"
        hrefLabel="Abrir"
        comparacion={{ texto: '0', contra: 'vs. ayer', direccion: 'igual' }}
      />,
    );
    expect(container.innerHTML).not.toContain('text-status-success-strong');
    expect(container.innerHTML).not.toContain('text-status-error');
  });

  it('la nota explica una métrica sin curva, en vez de dejar el hueco', () => {
    render(
      <MetricCard
        etiqueta="Conversión"
        valor="18,4 %"
        icono={Target}
        href="/x"
        hrefLabel="Abrir"
        nota="acumulado histórico"
      />,
    );
    expect(screen.getByText('acumulado histórico')).toBeInTheDocument();
  });

  it('mientras carga no enseña ni cifra ni curva', () => {
    const { container } = render(
      <MetricCard
        etiqueta="Abiertas"
        valor={7}
        icono={Target}
        href="/x"
        hrefLabel="Abrir"
        cargando
        serie={[1, 2, 3]}
      />,
    );
    expect(screen.queryByText('7')).not.toBeInTheDocument();
    expect(container.querySelector('svg path')).toBeNull();
  });
});
