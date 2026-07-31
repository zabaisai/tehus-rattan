import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HistoryImport } from './HistoryImport';

const previewHistory = vi.fn();
const importHistory = vi.fn();

vi.mock('@/lib/whatsapp-history', async () => {
  const real = await vi.importActual<typeof import('@/lib/whatsapp-history')>(
    '@/lib/whatsapp-history',
  );
  return {
    ...real,
    previewHistory: (csv: string) => previewHistory(csv),
    importHistory: (csv: string) => importHistory(csv),
  };
});

const CSV =
  'telefono,fecha,direccion,texto,referencia\n' +
  '+573001112233,2024-05-01T10:00:00Z,INBOUND,Hola,ref-1\n';

async function subirCsv(user: ReturnType<typeof userEvent.setup>, texto = CSV) {
  const fichero = new File([texto], 'historial.csv', { type: 'text/csv' });
  await user.upload(screen.getByLabelText('Fichero CSV de historial'), fichero);
  // FileReader es asíncrono: el botón sigue deshabilitado hasta que hay texto.
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: /Analizar sin importar/i }),
    ).toBeEnabled(),
  );
}

describe('HistoryImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dice el límite real de Meta en vez de prometer una sincronización que no existe', () => {
    render(<HistoryImport />);
    expect(
      screen.getByText(/la Cloud API no tiene ninguna vía para pedirlas/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/una única vez/i)).toBeInTheDocument();
  });

  it('avisa de que lo importado no dispara automatizaciones ni chatbot', () => {
    render(<HistoryImport />);
    expect(
      screen.getByText(/ni automatizaciones, ni chatbot, ni\s+oportunidades nuevas/i),
    ).toBeInTheDocument();
  });

  it('sin fichero no deja analizar', () => {
    render(<HistoryImport />);
    expect(
      screen.getByRole('button', { name: /Analizar sin importar/i }),
    ).toBeDisabled();
  });

  it('no ofrece importar hasta haber analizado', async () => {
    const user = userEvent.setup();
    render(<HistoryImport />);
    await subirCsv(user);

    // `^` a propósito: "Analizar sin importar" contiene la palabra y sin
    // anclar la prueba pasaría sola.
    expect(
      screen.queryByRole('button', { name: /^Importar/i }),
    ).not.toBeInTheDocument();
    expect(importHistory).not.toHaveBeenCalled();
  });

  it('analiza sin importar y enseña la muestra para poder comprobar las fechas', async () => {
    previewHistory.mockResolvedValue({
      filasValidas: 2,
      rechazados: [],
      muestra: [
        {
          telefono: '+573001112233',
          fecha: '2024-05-01T10:00:00.000Z',
          direccion: 'INBOUND',
          texto: 'Hola',
          referencia: 'ref-1',
        },
      ],
    });
    const user = userEvent.setup();
    render(<HistoryImport />);
    await subirCsv(user);
    await user.click(
      screen.getByRole('button', { name: /Analizar sin importar/i }),
    );

    expect(await screen.findByText('+573001112233')).toBeInTheDocument();
    expect(screen.getByText('Recibido')).toBeInTheDocument();
    expect(screen.getByText(/Comprueba las fechas antes de importar/i)).toBeInTheDocument();
    expect(importHistory).not.toHaveBeenCalled();
  });

  it('muestra las filas rechazadas con su motivo, sin volcar miles', async () => {
    previewHistory.mockResolvedValue({
      filasValidas: 1,
      rechazados: Array.from({ length: 8 }, (_, i) => ({
        fila: i + 2,
        motivo: 'fecha ilegible',
      })),
      muestra: [],
    });
    const user = userEvent.setup();
    render(<HistoryImport />);
    await subirCsv(user);
    await user.click(
      screen.getByRole('button', { name: /Analizar sin importar/i }),
    );

    expect(await screen.findByText(/8 rechazadas/)).toBeInTheDocument();
    expect(screen.getByText('Fila 2: fecha ilegible')).toBeInTheDocument();
    expect(screen.getByText(/y 3 más/)).toBeInTheDocument();
    expect(screen.queryByText('Fila 9: fecha ilegible')).not.toBeInTheDocument();
  });

  it('un CSV sin ninguna fila válida no ofrece importar', async () => {
    previewHistory.mockResolvedValue({
      filasValidas: 0,
      rechazados: [{ fila: 2, motivo: 'faltan columnas' }],
      muestra: [],
    });
    const user = userEvent.setup();
    render(<HistoryImport />);
    await subirCsv(user);
    await user.click(
      screen.getByRole('button', { name: /Analizar sin importar/i }),
    );

    await screen.findByText(/1 rechazadas/);
    expect(
      screen.queryByRole('button', { name: /^Importar/i }),
    ).not.toBeInTheDocument();
  });

  it('importa y cuenta duplicados, que es lo que confirma que reimportar es seguro', async () => {
    previewHistory.mockResolvedValue({
      filasValidas: 2,
      rechazados: [],
      muestra: [],
    });
    importHistory.mockResolvedValue({
      filasLeidas: 2,
      importados: 1,
      duplicados: 1,
      rechazados: [],
    });
    const user = userEvent.setup();
    render(<HistoryImport />);
    await subirCsv(user);
    await user.click(
      screen.getByRole('button', { name: /Analizar sin importar/i }),
    );
    await user.click(await screen.findByRole('button', { name: /Importar 2 mensajes/i }));

    await waitFor(() => expect(importHistory).toHaveBeenCalledWith(CSV));
    expect(await screen.findByText(/Importados 1 mensajes/)).toBeInTheDocument();
    expect(screen.getByText(/1 ya estaban/)).toBeInTheDocument();
  });

  it('muestra el motivo del servidor cuando el fichero es rechazado entero', async () => {
    previewHistory.mockRejectedValue({
      response: { data: { message: 'Faltan columnas obligatorias: referencia' } },
    });
    const user = userEvent.setup();
    render(<HistoryImport />);
    await subirCsv(user);
    await user.click(
      screen.getByRole('button', { name: /Analizar sin importar/i }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Faltan columnas obligatorias/i,
    );
  });
});
