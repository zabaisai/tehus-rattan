'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { flowbots, type PlantillaResumen } from '@/lib/flowbots';
import { permisosDe } from '@/lib/flowbot-permisos';
import { useAuthStore } from '@/store/auth.store';
import { mensajeDeError } from '@/components/ui/ListState';
import { GaleriaPlantillas } from '@/components/flowbots/GaleriaPlantillas';
import { SinPermiso } from '@/components/flowbots/SinPermiso';

export default function PlantillasPage() {
  const router = useRouter();
  const rol = useAuthStore((s) => s.user?.role);
  const permisos = permisosDe(rol);
  const [usando, setUsando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!permisos.puedeCrear) return <SinPermiso />;

  async function usar(plantilla: PlantillaResumen) {
    setError(null);
    setUsando(plantilla.clave);
    try {
      const bot = await flowbots.usarPlantilla(plantilla.clave);
      // Se abre el editor, NO la ficha. Una plantilla recién creada casi
      // siempre necesita un ajuste, y mandarla a una pantalla de solo lectura
      // obliga a un clic extra a todo el mundo.
      router.push(`/dashboard/flowbots/${bot.id}/edit`);
    } catch (e) {
      setError(mensajeDeError(e) || 'No se pudo crear el bot desde la plantilla.');
      setUsando(null);
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
          Plantillas
        </h2>
        <p className="text-sm text-neutral-500">
          Flujos ya armados que puedes cambiar entero. Ninguno se publica solo.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      <GaleriaPlantillas onUsar={(p) => void usar(p)} usando={usando} />
    </div>
  );
}
