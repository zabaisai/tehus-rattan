'use client';

import { useState } from 'react';
import { FileUp, Upload } from 'lucide-react';
import {
  CABECERAS_CSV,
  MAXIMO_FILAS,
  importHistory,
  previewHistory,
  type AnalisisHistorial,
  type ResultadoImportacion,
} from '@/lib/whatsapp-history';
import { Button } from '@/components/ui/Button';

/**
 * Importación de historial desde CSV.
 *
 * El análisis es un paso separado y obligatorio en la práctica: importar sin
 * ver antes qué se leyó deja el hilo de clientes reales con fechas mal
 * interpretadas y no hay botón para deshacerlo. Por eso el botón de importar
 * no aparece hasta que hay un análisis con filas válidas.
 */
export function HistoryImport() {
  const [csv, setCsv] = useState('');
  const [nombreFichero, setNombreFichero] = useState<string | null>(null);
  const [analisis, setAnalisis] = useState<AnalisisHistorial | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  function cargarFichero(fichero: File) {
    setError(null);
    setAnalisis(null);
    setResultado(null);
    const lector = new FileReader();
    lector.onload = () => {
      setCsv(String(lector.result ?? ''));
      setNombreFichero(fichero.name);
    };
    lector.onerror = () => setError('No se pudo leer el fichero.');
    lector.readAsText(fichero);
  }

  async function analizar() {
    setError(null);
    setResultado(null);
    setOcupado(true);
    try {
      setAnalisis(await previewHistory(csv));
    } catch (e) {
      setAnalisis(null);
      setError(mensajeDeError(e, 'No se pudo analizar el fichero.'));
    } finally {
      setOcupado(false);
    }
  }

  async function importar() {
    setError(null);
    setOcupado(true);
    try {
      const r = await importHistory(csv);
      setResultado(r);
      setAnalisis(null);
      setCsv('');
      setNombreFichero(null);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo importar el historial.'));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
        <FileUp size={15} />
        Importar historial
      </h3>
      <p className="mt-1 text-xs text-neutral-500">
        WhatsApp no permite descargar conversaciones pasadas: la Cloud API no
        tiene ninguna vía para pedirlas. Lo único que llega solo es el historial
        de coexistencia, al conectar un número que venía de la app de WhatsApp
        Business, y ocurre una única vez. Para todo lo demás —una migración
        desde otro CRM, un export manual— este CSV es el camino.
      </p>
      <p className="mt-2 text-xs text-neutral-500">
        Columnas: <code className="text-neutral-700">{CABECERAS_CSV}</code>.
        Máximo {MAXIMO_FILAS.toLocaleString('es-CO')} filas por fichero. La
        <code className="mx-1 text-neutral-700">referencia</code> es lo que evita
        duplicados si vuelves a importar el mismo fichero.
      </p>
      <p className="mt-2 rounded-md bg-neutral-50 p-2 text-xs text-neutral-600">
        Lo importado no dispara nada: ni automatizaciones, ni chatbot, ni
        oportunidades nuevas. Es historial, no conversación en curso.
      </p>

      <div className="mt-3 space-y-2">
        <label className="block text-xs text-neutral-600">
          Fichero CSV
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="Fichero CSV de historial"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) cargarFichero(f);
            }}
            className="mt-1 block w-full text-xs file:mr-2 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-2 file:py-1 file:text-xs file:text-neutral-700"
          />
        </label>
        {nombreFichero && (
          <p className="text-xs text-neutral-500">{nombreFichero}</p>
        )}

        <Button
          size="sm"
          variant="secondary"
          disabled={ocupado || !csv.trim()}
          onClick={() => void analizar()}
        >
          {ocupado ? 'Analizando…' : 'Analizar sin importar'}
        </Button>
      </div>

      {analisis && (
        <div className="mt-3 rounded-md border border-neutral-200 p-2.5">
          <p className="text-xs text-neutral-700">
            <strong className="text-neutral-900">
              {analisis.filasValidas.toLocaleString('es-CO')}
            </strong>{' '}
            filas válidas
            {analisis.rechazados.length > 0 && (
              <>
                {' · '}
                <span className="text-red-700">
                  {analisis.rechazados.length.toLocaleString('es-CO')}{' '}
                  rechazadas
                </span>
              </>
            )}
          </p>

          {analisis.rechazados.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[11px] text-red-700">
              {/* Solo las primeras: una lista de miles de errores no se lee y
                  el patrón se ve en las primeras. */}
              {analisis.rechazados.slice(0, 5).map((r) => (
                <li key={r.fila}>
                  Fila {r.fila}: {r.motivo}
                </li>
              ))}
              {analisis.rechazados.length > 5 && (
                <li className="text-neutral-500">
                  y {analisis.rechazados.length - 5} más…
                </li>
              )}
            </ul>
          )}

          {analisis.muestra.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-neutral-500">
                    <th className="pr-2 font-medium">Teléfono</th>
                    <th className="pr-2 font-medium">Fecha</th>
                    <th className="pr-2 font-medium">Dirección</th>
                    <th className="font-medium">Texto</th>
                  </tr>
                </thead>
                <tbody>
                  {analisis.muestra.map((f) => (
                    <tr key={f.referencia} className="text-neutral-700">
                      <td className="pr-2">{f.telefono}</td>
                      <td className="pr-2">
                        {new Date(f.fecha).toLocaleString('es-CO')}
                      </td>
                      <td className="pr-2">
                        {f.direccion === 'INBOUND' ? 'Recibido' : 'Enviado'}
                      </td>
                      <td className="max-w-xs truncate">{f.texto}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-neutral-500">
                Comprueba las fechas antes de importar: si el día y el mes
                salen cambiados, el formato del fichero no es el que se está
                leyendo.
              </p>
            </div>
          )}

          {analisis.filasValidas > 0 && (
            <Button
              size="sm"
              className="mt-2"
              disabled={ocupado}
              onClick={() => void importar()}
            >
              <Upload size={14} />
              {ocupado
                ? 'Importando…'
                : `Importar ${analisis.filasValidas.toLocaleString('es-CO')} mensajes`}
            </Button>
          )}
        </div>
      )}

      {resultado && (
        <div className="mt-3 rounded-md bg-emerald-50 p-2.5 text-xs text-emerald-800">
          Importados {resultado.importados.toLocaleString('es-CO')} mensajes.
          {resultado.duplicados > 0 && (
            <> {resultado.duplicados.toLocaleString('es-CO')} ya estaban.</>
          )}
          {resultado.rechazados.length > 0 && (
            <>
              {' '}
              {resultado.rechazados.length.toLocaleString('es-CO')} filas
              rechazadas.
            </>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}

function mensajeDeError(e: unknown, respaldo: string) {
  const detalle = (e as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  if (typeof detalle === 'string') return detalle;
  if (Array.isArray(detalle) && typeof detalle[0] === 'string') return detalle[0];
  return respaldo;
}
