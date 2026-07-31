import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AutomationEditor } from './AutomationEditor';
import { validarAutomatizacion } from '@/lib/automations';

const asesores = [
  { id: 'u1', name: 'Ana' },
  { id: 'u2', name: 'Beto' },
];

const montar = (props: Partial<Parameters<typeof AutomationEditor>[0]> = {}) => {
  const onGuardar = vi.fn().mockResolvedValue(undefined);
  render(
    <AutomationEditor
      asesores={asesores}
      onGuardar={onGuardar}
      onCancelar={vi.fn()}
      {...props}
    />,
  );
  return { onGuardar };
};

describe('validarAutomatizacion', () => {
  // Se valida en el cliente ADEMAS de en el servidor porque el coste de
  // equivocarse no es un error de formulario: una automatizacion mal
  // configurada le manda mensajes de verdad a clientes de verdad.
  it('exige nombre', () => {
    const errores = validarAutomatizacion({
      name: '   ',
      trigger: 'first_message',
      actions: [{ type: 'send_message', message: 'hola' }],
    });

    expect(errores.some((e) => /nombre/i.test(e))).toBe(true);
  });

  it('exige al menos una acción: sin acciones no haría nada', () => {
    const errores = validarAutomatizacion({
      name: 'Saludo',
      trigger: 'first_message',
      actions: [],
    });

    expect(errores.some((e) => /acción/i.test(e))).toBe(true);
  });

  it('el disparador por palabra exige palabras', () => {
    const errores = validarAutomatizacion({
      name: 'Precio',
      trigger: 'keyword',
      conditions: { keywords: [] },
      actions: [{ type: 'send_message', message: 'hola' }],
    });

    expect(errores.some((e) => /palabra/i.test(e))).toBe(true);
  });

  it('detecta un mensaje vacío y dice QUÉ acción', () => {
    const errores = validarAutomatizacion({
      name: 'Saludo',
      trigger: 'first_message',
      actions: [
        { type: 'send_message', message: 'hola' },
        { type: 'send_message', message: '  ' },
      ],
    });

    expect(errores.some((e) => e.includes('2'))).toBe(true);
  });

  it('detecta una asignación sin asesor y una etapa sin nombre', () => {
    const errores = validarAutomatizacion({
      name: 'Reglas',
      trigger: 'first_message',
      actions: [{ type: 'assign_agent' }, { type: 'change_stage' }],
    });

    expect(errores).toHaveLength(2);
  });

  it('una automatización correcta no da errores', () => {
    const errores = validarAutomatizacion({
      name: 'Saludo',
      trigger: 'keyword',
      conditions: { keywords: ['precio'] },
      actions: [{ type: 'send_message', message: 'Con gusto' }],
    });

    expect(errores).toEqual([]);
  });
});

describe('AutomationEditor', () => {
  it('no guarda una automatización inválida y explica por qué', async () => {
    const user = userEvent.setup();
    const { onGuardar } = montar();

    await user.click(screen.getByRole('button', { name: /guardar/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onGuardar).not.toHaveBeenCalled();
  });

  it('los errores se limpian al corregir', async () => {
    // Dejarlos en pantalla mientras el usuario corrige hace que parezcan de
    // lo que acaba de escribir.
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole('button', { name: /guardar/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/nombre/i), 'Saludo');

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('guarda una automatización completa', async () => {
    const user = userEvent.setup();
    const { onGuardar } = montar();

    await user.type(screen.getByLabelText(/nombre/i), 'Saludo');
    await user.click(screen.getByRole('button', { name: /añadir acción/i }));
    await user.type(
      screen.getByLabelText(/mensaje de la acción 1/i),
      'Hola, ya te atendemos',
    );
    await user.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() =>
      expect(onGuardar).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Saludo',
          trigger: 'first_message',
          actions: [{ type: 'send_message', message: 'Hola, ya te atendemos' }],
        }),
      ),
    );
  });

  describe('acciones', () => {
    it('el orden se puede cambiar: se ejecutan de arriba abajo', async () => {
      const user = userEvent.setup();
      const { onGuardar } = montar();

      await user.type(screen.getByLabelText(/nombre/i), 'Dos pasos');
      await user.click(screen.getByRole('button', { name: /añadir acción/i }));
      await user.type(screen.getByLabelText(/mensaje de la acción 1/i), 'uno');
      await user.click(screen.getByRole('button', { name: /añadir acción/i }));
      await user.type(screen.getByLabelText(/mensaje de la acción 2/i), 'dos');

      await user.click(screen.getByRole('button', { name: /subir la acción 2/i }));
      await user.click(screen.getByRole('button', { name: /guardar/i }));

      await waitFor(() => expect(onGuardar).toHaveBeenCalled());
      expect(onGuardar.mock.calls[0][0].actions[0].message).toBe('dos');
    });

    it('la primera no se puede subir ni la última bajar', async () => {
      const user = userEvent.setup();
      montar();

      await user.click(screen.getByRole('button', { name: /añadir acción/i }));

      expect(screen.getByRole('button', { name: /subir la acción 1/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /bajar la acción 1/i })).toBeDisabled();
    });

    it('se puede quitar una acción', async () => {
      const user = userEvent.setup();
      montar();

      await user.click(screen.getByRole('button', { name: /añadir acción/i }));
      await user.click(screen.getByRole('button', { name: /quitar la acción 1/i }));

      expect(screen.queryByLabelText(/mensaje de la acción 1/i)).toBeNull();
    });

    it('cambiar el tipo descarta los campos del tipo anterior', async () => {
      // Un mensaje colgando de una acción que ya no lo usa se guardaría y no
      // se ejecutaría nunca.
      const user = userEvent.setup();
      const { onGuardar } = montar();

      await user.type(screen.getByLabelText(/nombre/i), 'Cambio');
      await user.click(screen.getByRole('button', { name: /añadir acción/i }));
      await user.type(screen.getByLabelText(/mensaje de la acción 1/i), 'hola');
      await user.selectOptions(
        screen.getByLabelText(/tipo de la acción 1/i),
        'close_conversation',
      );
      await user.click(screen.getByRole('button', { name: /guardar/i }));

      await waitFor(() => expect(onGuardar).toHaveBeenCalled());
      expect(onGuardar.mock.calls[0][0].actions[0].message).toBeUndefined();
    });
  });

  describe('disparador por palabra', () => {
    it('el campo de palabras solo aparece con ese disparador', async () => {
      const user = userEvent.setup();
      montar();
      expect(screen.queryByLabelText(/palabras que la disparan/i)).toBeNull();

      await user.selectOptions(
        screen.getByLabelText(/cuándo se ejecuta/i),
        'keyword',
      );

      expect(
        screen.getByLabelText(/palabras que la disparan/i),
      ).toBeInTheDocument();
    });

    it('separa las palabras por comas y descarta las vacías', async () => {
      const user = userEvent.setup();
      const { onGuardar } = montar();

      await user.type(screen.getByLabelText(/nombre/i), 'Precio');
      await user.selectOptions(
        screen.getByLabelText(/cuándo se ejecuta/i),
        'keyword',
      );
      await user.type(
        screen.getByLabelText(/palabras que la disparan/i),
        'precio, , cotización',
      );
      await user.click(screen.getByRole('button', { name: /añadir acción/i }));
      await user.type(screen.getByLabelText(/mensaje de la acción 1/i), 'ya voy');
      await user.click(screen.getByRole('button', { name: /guardar/i }));

      await waitFor(() => expect(onGuardar).toHaveBeenCalled());
      expect(onGuardar.mock.calls[0][0].conditions.keywords).toEqual([
        'precio',
        'cotización',
      ]);
    });

    it('cambiar de disparador limpia las condiciones del anterior', async () => {
      // Arrastrar palabras clave a un disparador que no las usa deja
      // configuración muerta que confunde a quien lo abra después.
      const user = userEvent.setup();
      const { onGuardar } = montar();

      await user.type(screen.getByLabelText(/nombre/i), 'Mixta');
      await user.selectOptions(
        screen.getByLabelText(/cuándo se ejecuta/i),
        'keyword',
      );
      await user.type(
        screen.getByLabelText(/palabras que la disparan/i),
        'precio',
      );
      await user.selectOptions(
        screen.getByLabelText(/cuándo se ejecuta/i),
        'first_message',
      );
      await user.click(screen.getByRole('button', { name: /añadir acción/i }));
      await user.type(screen.getByLabelText(/mensaje de la acción 1/i), 'hola');
      await user.click(screen.getByRole('button', { name: /guardar/i }));

      await waitFor(() => expect(onGuardar).toHaveBeenCalled());
      expect(onGuardar.mock.calls[0][0].conditions).toBeNull();
    });
  });

  it('al editar parte de lo que ya había', () => {
    montar({
      inicial: {
        id: 'a1',
        name: 'Existente',
        isActive: false,
        trigger: 'keyword',
        conditions: { keywords: ['precio'] },
        actions: [{ type: 'send_message', message: 'Con gusto' }],
        order: 0,
        version: 3,
        createdAt: '',
        updatedAt: '',
      },
    });

    expect(screen.getByLabelText(/nombre/i)).toHaveValue('Existente');
    expect(screen.getByLabelText(/palabras que la disparan/i)).toHaveValue(
      'precio',
    );
    expect(screen.getByLabelText(/mensaje de la acción 1/i)).toHaveValue(
      'Con gusto',
    );
  });
});
