'use client';

import { useQuery } from '@tanstack/react-query';
import { FlaskConical, OctagonX, Send, ShieldCheck, Unplug } from 'lucide-react';
import { flowbots } from '@/lib/flowbots';
import { permisosDe } from '@/lib/flowbot-permisos';
import { useAuthStore } from '@/store/auth.store';
import {
  vistaOperativa,
  type TonoOperativo,
} from '@/lib/flowbot-estado-operativo';

/**
 * Si FlowBot está mandando mensajes de verdad, dicho sin rodeos.
 *
 * ES LA INFORMACIÓN QUE MÁS CARO SALE NO TENER. Alguien prueba un bot, ve
 * «enviado» en la pantalla y cree que su cliente ya recibió la respuesta;
 * cuando el cliente llama preguntando por qué nadie le contestó, han pasado
 * dos días. Al revés es igual de malo: creer que se está en pruebas y estar
 * escribiéndole a clientes reales.
 *
 * QUÉ decir lo decide `flowbot-estado-operativo.ts`, no este componente. Antes
 * cada superficie interpretaba los datos a su manera y la pantalla acababa
 * diciendo «Envíos parados» y «Enviando» a la vez.
 *
 * NO SE LE ENSEÑA A UN AGENT. No porque sea secreto, sino porque no es una
 * decisión suya y en su pantalla solo sería ruido.
 */
export function EstadoTransporte({ compacto = false }: { compacto?: boolean }) {
  const rol = useAuthStore((s) => s.user?.role);
  const permisos = permisosDe(rol);

  const { data } = useQuery({
    queryKey: ['flowbots', 'estado-operativo'],
    queryFn: flowbots.estadoOperativo,
    // Se refresca solo: el interruptor de emergencia se activa desde otro
    // sitio y quien tenga la pantalla abierta tiene que enterarse.
    refetchInterval: 60_000,
    // Un fallo aquí no puede tumbar la pantalla del editor.
    retry: false,
  });

  if (!permisos.puedeEditar || !data) return null;

  const vista = vistaOperativa(data);

  return (
    <div className="space-y-1">
      <p
        // `status` y no `alert` salvo cuando de verdad es una alarma: un
        // `alert` en cada carga sería insufrible y enseña a ignorarlos.
        role={vista.tono === 'error' ? 'alert' : 'status'}
        className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-[11px] ${TONOS[vista.tono]}`}
      >
        <Icono tono={vista.tono} />
        <span>
          <span className="font-medium">{vista.titulo}</span>
          {!compacto && <span className="block opacity-90">{vista.detalle}</span>}
        </span>
      </p>

      {/*
        EL MOTIVO TÉCNICO VA APARTE Y PLEGADO.
        Suele traer el SHA del despliegue en que se activó el interruptor, y
        enseñarlo como mensaje principal hace creer que esa es la versión en
        marcha. Se conserva íntegro; solo cambia dónde se lee.
      */}
      {!compacto && vista.detalleTecnico && (
        <details className="text-[10px] text-neutral-500">
          <summary className="cursor-pointer focus-visible:ring-2 focus-visible:ring-line-focus">
            Detalle técnico del interruptor
          </summary>
          <p className="mt-1 rounded-md bg-neutral-50 px-2 py-1 text-neutral-600">
            {vista.detalleTecnico}
            <span className="mt-1 block text-neutral-400">
              Histórico del momento en que se activó. No indica la versión
              desplegada ahora.
            </span>
          </p>
        </details>
      )}
    </div>
  );
}

const TONOS: Record<TonoOperativo, string> = {
  // El informativo es el estado normal de un entorno protegido: no compite con
  // una alarma de verdad.
  informativo: 'border-neutral-200 bg-neutral-50 text-neutral-600',
  aviso: 'border-status-warning bg-status-warning-surface text-status-warning',
  // Naranja de marca para el estado que exige atención: se está enviando.
  real: 'border-brand-secondary bg-brand-secondary/10 text-brand-primary',
  error: 'border-status-error bg-status-error-surface text-status-error',
};

/** Cada tono lleva su icono: el estado no puede depender solo del color. */
function Icono({ tono }: { tono: TonoOperativo }) {
  const props = { size: 13, className: 'mt-px shrink-0', 'aria-hidden': true };
  if (tono === 'error') return <OctagonX {...props} />;
  if (tono === 'real') return <Send {...props} />;
  if (tono === 'aviso') return <FlaskConical {...props} />;
  return <ShieldCheck {...props} />;
}

/** Se conserva para el caso sin número; lo usa la vista desconectada. */
export const IconoDesconectado = Unplug;
