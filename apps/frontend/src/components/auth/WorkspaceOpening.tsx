'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe } from '@/lib/auth';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/Button';
import { TaktoLogo } from '@/components/ui/TaktoLogo';
import type { User } from '@/types';

/**
 * Lo que se ve entre «credenciales aceptadas» y el tablero.
 *
 * CADA PASO CORRESPONDE A UNA OPERACIÓN REAL. No hay porcentajes inventados ni
 * esperas artificiales: si `/auth/me` responde en 80 ms, se navega en 80 ms y
 * esta pantalla apenas parpadea. Una barra que tarda siempre lo mismo es una
 * mentira pequeña que además hace el producto más lento a propósito.
 *
 * Tampoco se pinta el nombre de la empresa: el usuario real trae `company`
 * solo con `isDemo`, sin nombre, así que inventarlo sería exactamente lo que
 * esta pantalla evita.
 */

type EstadoPaso = 'hecho' | 'activo' | 'pendiente';

function Paso({ estado, texto }: { estado: EstadoPaso; texto: string }) {
  return (
    <li className="flex items-center gap-3 text-sm">
      <span
        aria-hidden="true"
        className={
          estado === 'hecho'
            ? 'h-2 w-2 shrink-0 rounded-full bg-status-success'
            : estado === 'activo'
              ? 'h-2 w-2 shrink-0 rounded-full bg-brand-secondary'
              : 'h-2 w-2 shrink-0 rounded-full bg-neutral-300'
        }
      />
      <span
        className={
          estado === 'pendiente' ? 'text-content-disabled' : 'text-content-primary'
        }
      >
        {texto}
      </span>
    </li>
  );
}

export interface PropsApertura {
  /** El usuario escueto que devolvió el login (id, correo, nombre). */
  user: Pick<User, 'name'> & Partial<User>;
  /** Se llama justo antes de navegar, para que la máquina pase a `opening`. */
  onOpening: () => void;
  /** Cancelar: la sesión ya se limpió; la página vuelve al formulario. */
  onCancel: () => void;
}

export function WorkspaceOpening({ user, onOpening, onCancel }: PropsApertura) {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const [fase, setFase] = useState<'cargando' | 'abriendo'>('cargando');
  const [fallo, setFallo] = useState('');
  const [intento, setIntento] = useState(0);
  // React monta dos veces en StrictMode; sin esto, `/auth/me` sale dos veces.
  const enCurso = useRef(false);

  useEffect(() => {
    let cancelado = false;
    if (enCurso.current) return;
    enCurso.current = true;

    (async () => {
      try {
        const completo = await getMe();
        if (cancelado) return;
        setUser(completo);
        setFase('abriendo');
        onOpening();

        // Un SUPER_ADMIN global (companyId null) no tiene empresa a la que
        // acotar el tablero de CRM: cada consulta de negocio espera un
        // companyId real y revienta. Va directo al área de plataforma.
        const esPlataforma =
          completo.role === 'SUPER_ADMIN' && completo.companyId === null;
        router.replace(
          esPlataforma ? '/dashboard/platform/companies' : '/dashboard',
        );
      } catch {
        if (cancelado) return;
        enCurso.current = false;
        setFallo(
          'No pudimos cargar tu configuración. Tu sesión sigue abierta: vuelve a intentarlo.',
        );
      }
    })();

    return () => {
      cancelado = true;
    };
    // `intento` vuelve a lanzar la carga desde «Reintentar».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intento]);

  const reintentar = useCallback(() => {
    setFallo('');
    setFase('cargando');
    setIntento((n) => n + 1);
  }, []);

  const cancelar = useCallback(() => {
    useAuthStore.getState().clearSession();
    onCancel();
  }, [onCancel]);

  return (
    <div className="w-full" role="status" aria-live="polite">
      <TaktoLogo height={26} />
      <h1 className="mt-6 font-brand text-2xl font-extrabold text-content-primary">
        Bienvenido, {user.name}
      </h1>

      <ul className="mt-6 space-y-3">
        <Paso estado="hecho" texto="Sesión verificada" />
        <Paso
          estado={fase === 'cargando' ? 'activo' : 'hecho'}
          texto="Cargando configuración"
        />
        <Paso
          estado={fase === 'abriendo' ? 'activo' : 'pendiente'}
          texto="Abriendo tu tablero"
        />
      </ul>

      {fallo && (
        <>
          <p role="alert" className="mt-5 text-sm text-status-error">
            {fallo}
          </p>
          <Button onClick={reintentar} className="mt-4 w-full py-3">
            Reintentar
          </Button>
        </>
      )}

      <Button variant="quiet" size="sm" onClick={cancelar} className="mt-4">
        Cancelar
      </Button>
    </div>
  );
}
