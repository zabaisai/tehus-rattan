import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaktoLogo } from './TaktoLogo';

const NAVY = '#131C4A';
const NARANJA = '#FF6A00';

describe('TaktoLogo', () => {
  it('parte el wordmark en TAK navy y TO naranja', () => {
    // La división cromática no es decorativa: es la marca. Si alguien la
    // unifica "por limpieza", deja de ser el logotipo de TAKTO.
    render(<TaktoLogo />);

    const tak = screen.getByText('TAK');
    const to = screen.getByText('TO');
    expect(tak).toHaveAttribute('fill', NAVY);
    expect(to).toHaveAttribute('fill', NARANJA);
  });

  it('sobre fondo oscuro TAK pasa a blanco y TO conserva el naranja', () => {
    // Es lo que mantiene reconocible la marca sobre cualquier fondo.
    render(<TaktoLogo tone="negative" />);

    expect(screen.getByText('TAK')).toHaveAttribute('fill', '#FFFFFF');
    expect(screen.getByText('TO')).toHaveAttribute('fill', NARANJA);
  });

  it('es accesible como imagen con nombre', () => {
    render(<TaktoLogo />);

    expect(screen.getByRole('img', { name: 'TAKTO' })).toBeInTheDocument();
  });

  it('la variante wordmark no dibuja el isotipo', () => {
    const { container } = render(<TaktoLogo variant="wordmark" />);

    expect(container.querySelectorAll('path')).toHaveLength(0);
    expect(screen.getByText('TAK')).toBeInTheDocument();
  });

  it('la variante isotype no dibuja texto', () => {
    render(<TaktoLogo variant="isotype" />);

    expect(screen.queryByText('TAK')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'TAKTO' })).toBeInTheDocument();
  });

  it('el isotipo conserva su geometría exacta: no se recompone en cada uso', () => {
    // Es un par rotacional a 180 grados con un canal central que no debe
    // abrirse; por eso los trazados viven en un solo sitio.
    const { container } = render(<TaktoLogo variant="isotype" />);
    const trazados = Array.from(container.querySelectorAll('path')).map((p) =>
      p.getAttribute('d'),
    );

    expect(trazados).toEqual(['M0 0H13V9H8V24H0Z', 'M24 24H11V15H16V0H24Z']);
  });

  it('mantiene la proporción del lockup al cambiar de alto', () => {
    const { container } = render(<TaktoLogo height={60} />);
    const svg = container.querySelector('svg')!;

    expect(svg.getAttribute('height')).toBe('60');
    expect(svg.getAttribute('width')).toBe(String((60 * 132) / 30));
  });

  it('usa la fuente de marca autoalojada, no una genérica', () => {
    render(<TaktoLogo />);

    const texto = screen.getByText('TAK').parentElement!;
    expect(texto.getAttribute('font-family')).toContain('--font-archivo');
    expect(texto.getAttribute('font-weight')).toBe('800');
  });
});
