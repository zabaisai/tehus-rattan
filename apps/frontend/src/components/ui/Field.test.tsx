import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field } from './Field';
import { Input } from './Input';
import { Select } from './Select';
import { Textarea } from './Textarea';
import { Card } from './Card';

describe('Field', () => {
  describe('cableado accesible', () => {
    it('la etiqueta apunta al control aunque nadie escriba un id', () => {
      // Es lo que se omite al escribir el campo numero veinte. Sin esto,
      // pulsar la etiqueta no enfoca el campo y el lector de pantalla anuncia
      // "cuadro de edicion" sin decir de que.
      render(
        <Field label="Correo">
          <Input />
        </Field>,
      );

      expect(screen.getByLabelText('Correo')).toBe(
        screen.getByRole('textbox'),
      );
    });

    it('el error se anuncia: role alert y aria-invalid en el control', () => {
      // Un error solo pintado de rojo es visible para quien ve la pantalla e
      // invisible para quien la escucha.
      render(
        <Field label="Correo" error="Correo invalido">
          <Input />
        </Field>,
      );

      expect(screen.getByRole('alert')).toHaveTextContent('Correo invalido');
      expect(screen.getByRole('textbox')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
    });

    it('ayuda Y error se describen a la vez, no solo el ultimo', () => {
      render(
        <Field label="Clave" hint="Minimo 8 caracteres" error="Muy corta">
          <Input />
        </Field>,
      );

      const descrito =
        screen.getByRole('textbox').getAttribute('aria-describedby') ?? '';
      const ids = descrito.split(' ').filter(Boolean);

      expect(ids).toHaveLength(2);
      const textos = ids.map((id) => document.getElementById(id)?.textContent);
      expect(textos).toContain('Minimo 8 caracteres');
      expect(textos).toContain('Muy corta');
    });

    it('sin error no marca aria-invalid', () => {
      // `aria-invalid="false"` es ruido: el control no esta en estado de error.
      render(
        <Field label="Correo">
          <Input />
        </Field>,
      );

      expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-invalid');
    });

    it('dos campos en la misma pantalla no comparten id', () => {
      render(
        <>
          <Field label="Uno">
            <Input />
          </Field>
          <Field label="Dos">
            <Input />
          </Field>
        </>,
      );

      const [uno, dos] = screen.getAllByRole('textbox');
      expect(uno.id).not.toBe(dos.id);
    });

    it('el asterisco de obligatorio no se lee', () => {
      // Lo obligatorio se anuncia por el `required` del control; leer
      // "asterisco" en cada campo es ruido.
      render(
        <Field label="Correo" required>
          <Input required />
        </Field>,
      );

      expect(screen.getByLabelText(/Correo/)).toBeRequired();
      expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
    });

    it('la etiqueta oculta sigue nombrando al campo', () => {
      render(
        <Field label="Buscar" labelOculta>
          <Input />
        </Field>,
      );

      expect(screen.getByLabelText('Buscar')).toBeInTheDocument();
    });
  });

  describe('reglas de marca que no se pueden incumplir', () => {
    it('el foco mueve el borde al navy de marca, no a un gris cualquiera', () => {
      // Escrito a mano acabo siendo `neutral-500` en el login y `#A57014` en
      // el onboarding: tres focos distintos para la misma accion.
      render(
        <Field label="Correo">
          <Input />
        </Field>,
      );

      const clases = screen.getByRole('textbox').className;
      expect(clases).toContain('focus:border-line-focus');
      expect(clases).toContain('focus:ring-line-focus');
    });

    it('el borde de error usa el rojo de ESTADO, no un rojo suelto', () => {
      render(
        <Field label="Correo" error="Mal">
          <Input />
        </Field>,
      );

      expect(screen.getByRole('textbox').className).toContain(
        'border-status-error',
      );
    });

    it('los tres controles comparten exactamente el mismo foco', () => {
      // Si cada uno trae el suyo, un formulario mezcla dos focos distintos.
      render(
        <>
          <Field label="Texto">
            <Input />
          </Field>
          <Field label="Lista">
            <Select>
              <option>a</option>
            </Select>
          </Field>
          <Field label="Nota">
            <Textarea />
          </Field>
        </>,
      );

      for (const control of [
        screen.getByRole('textbox', { name: 'Texto' }),
        screen.getByRole('combobox', { name: 'Lista' }),
        screen.getByRole('textbox', { name: 'Nota' }),
      ]) {
        expect(control.className).toContain('focus:ring-line-focus');
      }
    });
  });

  describe('controles sueltos', () => {
    it('funcionan fuera de un Field sin romperse', () => {
      render(<Input aria-label="Suelto" />);

      expect(screen.getByLabelText('Suelto')).toBeInTheDocument();
    });

    it('un id propio gana al generado', () => {
      render(
        <Field label="Correo">
          <Input id="mio" />
        </Field>,
      );

      expect(screen.getByRole('textbox').id).toBe('mio');
    });

    it('admiten clases adicionales sin perder las suyas', () => {
      render(<Input className="w-32" aria-label="X" />);

      const clases = screen.getByRole('textbox').className;
      expect(clases).toContain('w-32');
      expect(clases).toContain('focus:ring-line-focus');
    });
  });
});

describe('Select', () => {
  it('la flecha propia no se lee ni intercepta el clic', () => {
    const { container } = render(
      <Select aria-label="Lista">
        <option>a</option>
      </Select>,
    );

    const flecha = container.querySelector('svg');
    expect(flecha).toHaveAttribute('aria-hidden', 'true');
    expect(flecha?.getAttribute('class')).toContain('pointer-events-none');
  });

  it('reserva sitio para la flecha, para que una opcion larga no pase por debajo', () => {
    render(
      <Select aria-label="Lista">
        <option>a</option>
      </Select>,
    );

    expect(screen.getByRole('combobox').className).toContain('pr-9');
  });
});

describe('Card', () => {
  it('usa el borde y la superficie de marca, no un gris suelto', () => {
    render(<Card>contenido</Card>);

    const clases = screen.getByText('contenido').className;
    expect(clases).toContain('border-line-default');
    expect(clases).toContain('bg-surface-default');
  });

  it('padding none no impone espaciado, para tablas a sangre', () => {
    render(<Card padding="none">tabla</Card>);

    expect(screen.getByText('tabla').className).not.toMatch(/(^|\s)p-\d/);
  });

  it('flat quita la sombra pero conserva el borde', () => {
    render(<Card flat>anidada</Card>);

    const clases = screen.getByText('anidada').className;
    expect(clases).not.toContain('shadow-sm');
    expect(clases).toContain('border-line-default');
  });
});
