'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Copy, FilePlus2, LayoutTemplate } from 'lucide-react';
import { flowbots, type PlantillaResumen } from '@/lib/flowbots';
import { permisosDe } from '@/lib/flowbot-permisos';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/Button';
import { mensajeDeError } from '@/components/ui/ListState';
import { GaleriaPlantillas } from '@/components/flowbots/GaleriaPlantillas';
import { SinPermiso } from '@/components/flowbots/SinPermiso';

type Camino = 'plantilla' | 'vacio' | 'duplicar';

const CAMINOS: Array<{
  id: Camino;
  titulo: string;
  ayuda: string;
  icono: typeof FilePlus2;
}> = [
  {
    id: 'plantilla',
    titulo: 'Desde una plantilla',
    ayuda: 'Un flujo ya armado que puedes cambiar entero. Lo más rápido.',
    icono: LayoutTemplate,
  },
  {
    id: 'vacio',
    titulo: 'Desde cero',
    ayuda: 'Un lienzo con el disparador y el final, y nada más.',
    icono: FilePlus2,
  },
  {
    id: 'duplicar',
    titulo: 'Copiando uno que ya tienes',
    ayuda: 'Se copia el borrador. No se copian los disparadores ni el historial.',
    icono: Copy,
  },
];

export default function NuevoBotPage() {
  const router = useRouter();
  const rol = useAuthStore((s) => s.user?.role);
  const permisos = permisosDe(rol);

  // Se abre en plantillas a propósito: empezar de cero es lo que menos
  // funciona y lo que más gente abandona a mitad.
  const [camino, setCamino] = useState<Camino>('plantilla');
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [creando, setCreando] = useState(false);
  const [usando, setUsando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: existentes } = useQuery({
    queryKey: ['flowbots', 'todos'],
    queryFn: () => flowbots.listar({}),
    enabled: camino === 'duplicar',
  });

  if (!permisos.puedeCrear) return <SinPermiso />;

  async function crearVacio() {
    if (!nombre.trim()) {
      setError('Ponle un nombre para poder encontrarlo después.');
      return;
    }
    setError(null);
    setCreando(true);
    try {
      const bot = await flowbots.crear({
        nombre: nombre.trim(),
        descripcion: descripcion.trim() || undefined,
      });
      router.push(`/dashboard/flowbots/${bot.id}/edit`);
    } catch (e) {
      setError(mensajeDeError(e) || 'No se pudo crear el bot.');
      setCreando(false);
    }
  }

  async function usarPlantilla(p: PlantillaResumen) {
    setError(null);
    setUsando(p.clave);
    try {
      const bot = await flowbots.usarPlantilla(p.clave);
      router.push(`/dashboard/flowbots/${bot.id}/edit`);
    } catch (e) {
      setError(mensajeDeError(e) || 'No se pudo crear el bot desde la plantilla.');
      setUsando(null);
    }
  }

  async function duplicar(id: string) {
    setError(null);
    setCreando(true);
    try {
      const bot = await flowbots.duplicar(id);
      router.push(`/dashboard/flowbots/${bot.id}/edit`);
    } catch (e) {
      setError(mensajeDeError(e) || 'No se pudo duplicar el bot.');
      setCreando(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/dashboard/flowbots"
          className="inline-flex items-center gap-1 text-xs text-neutral-500 outline-none hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-line-focus"
        >
          <ArrowLeft size={14} />
          Volver a los bots
        </Link>
        <h2 className="mt-1 text-xl font-semibold text-neutral-900">
          Nuevo bot
        </h2>
        <p className="text-sm text-neutral-500">
          Elige por dónde empezar. Puedes cambiarlo todo después.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-status-error/20 bg-status-error-surface px-3 py-2 text-sm text-status-error"
        >
          {error}
        </p>
      )}

      <div
        role="radiogroup"
        aria-label="Cómo empezar"
        className="grid gap-3 md:grid-cols-3"
      >
        {CAMINOS.map(({ id, titulo, ayuda, icono: Icono }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={camino === id}
            onClick={() => setCamino(id)}
            className={`flex flex-col items-start gap-1.5 rounded-lg border p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-line-focus ${
              camino === id
                ? 'border-brand-primary bg-primary-50'
                : 'border-neutral-200 bg-white hover:border-neutral-300'
            }`}
          >
            <Icono
              size={18}
              className={
                camino === id ? 'text-brand-primary' : 'text-neutral-400'
              }
            />
            <span className="text-sm font-semibold text-neutral-900">
              {titulo}
            </span>
            <span className="text-xs text-neutral-500">{ayuda}</span>
          </button>
        ))}
      </div>

      {camino === 'plantilla' && (
        <GaleriaPlantillas onUsar={(p) => void usarPlantilla(p)} usando={usando} />
      )}

      {camino === 'vacio' && (
        <div className="max-w-lg space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
          <label className="block">
            <span className="text-xs font-medium text-neutral-700">
              Nombre
            </span>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={120}
              placeholder="Atención de primer contacto"
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-700">
              Descripción <span className="text-neutral-400">(opcional)</span>
            </span>
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Para qué sirve y cuándo debería contestar."
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
            />
          </label>
          <Button variant="accent" onClick={() => void crearVacio()} disabled={creando}>
            {creando ? 'Creando…' : 'Crear y abrir el editor'}
          </Button>
        </div>
      )}

      {camino === 'duplicar' && (
        <ul className="grid gap-2 md:grid-cols-2">
          {(existentes ?? []).length === 0 && (
            <p className="text-sm text-neutral-500">
              Todavía no tienes ningún bot que copiar.
            </p>
          )}
          {(existentes ?? []).map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900">
                  {b.nombre}
                </p>
                <p className="text-xs text-neutral-500">
                  {b.versionPublicada
                    ? `Versión ${b.versionPublicada} publicada`
                    : 'Sin publicar'}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void duplicar(b.id)}
                disabled={creando}
              >
                Copiar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
