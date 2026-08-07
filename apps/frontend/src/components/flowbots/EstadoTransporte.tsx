'use client';

import { useQuery } from '@tanstack/react-query';
import { FlaskConical, OctagonX, Send, Unplug } from 'lucide-react';
import { flowbots } from '@/lib/flowbots';
import { permisosDe } from '@/lib/flowbot-permisos';
import { useAuthStore } from '@/store/auth.store';
import { NOMBRE_PULSO } from '@/lib/producto';

/**
 * Si FlowBot está mandando mensajes de verdad, dicho sin rodeos.
 *
 * ES LA INFORMACIÓN QUE MÁS CARO SALE NO TENER. Alguien prueba un bot, ve
 * «enviado» en la pantalla y cree que su cliente ya recibió la respuesta;
 * cuando el cliente llama preguntando por qué nadie le contestó, han pasado
 * dos días. Al revés es igual de malo: creer que se está en pruebas y estar
 * escribiéndole a clientes reales.
 *
 * NO SE LE ENSEÑA A UN AGENT. No porque sea secreto, sino porque no es una
 * decisión suya y en su pantalla solo sería ruido: quien atiende necesita
 * saber si el bot está esperando en SU conversación —eso sí se enseña, en la
 * ficha del contacto—, no en qué modo está el despliegue.
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

  // El interruptor manda sobre el modo: da igual estar configurado en real si
  // los envíos están parados.
  if (data.killSwitch.activo) {
    return (
      <Aviso
        tono="error"
        icono={OctagonX}
        compacto={compacto}
        titulo="Envíos parados"
        detalle={
          data.killSwitch.motivo
            ? `${data.killSwitch.motivo}${
                data.killSwitch.activadoPor
                  ? ` · ${data.killSwitch.activadoPor}`
                  : ''
              }`
            : 'Alguien activó el interruptor de emergencia.'
        }
      />
    );
  }

  if (data.modo === 'real') {
    return (
      <Aviso
        tono="real"
        icono={Send}
        compacto={compacto}
        titulo={`${NOMBRE_PULSO} está enviando mensajes reales`}
        detalle="Lo que responda el bot le llega al cliente por WhatsApp."
      />
    );
  }

  if (data.modo === 'dry-run') {
    return (
      <Aviso
        tono="aviso"
        icono={FlaskConical}
        compacto={compacto}
        titulo={`Modo de prueba: ${NOMBRE_PULSO} no está enviando mensajes reales`}
        detalle="Se prepara todo el envío y no sale nada hacia WhatsApp."
      />
    );
  }

  return (
    <Aviso
      tono="neutral"
      icono={Unplug}
      compacto={compacto}
      titulo={`${NOMBRE_PULSO} no está conectado a WhatsApp`}
      detalle="Los bots funcionan y no sale ningún mensaje."
    />
  );
}

const TONOS = {
  // Naranja de marca para el estado que exige atención: es el acento, y aquí
  // sí es el sitio donde tiene que llamar la atención.
  real: 'border-brand-secondary bg-brand-secondary/10 text-brand-primary',
  aviso: 'border-status-warning bg-status-warning-surface text-status-warning',
  error: 'border-status-error bg-status-error-surface text-status-error',
  neutral: 'border-neutral-200 bg-neutral-50 text-neutral-600',
} as const;

function Aviso({
  tono,
  icono: Icono,
  titulo,
  detalle,
  compacto,
}: {
  tono: keyof typeof TONOS;
  icono: typeof Send;
  titulo: string;
  detalle: string;
  compacto: boolean;
}) {
  return (
    <p
      // `status` y no `alert`: se lee cuando toque, sin interrumpir lo que la
      // persona esté haciendo. Un `alert` en cada carga sería insufrible.
      role="status"
      className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-[11px] ${TONOS[tono]}`}
      title={detalle}
    >
      <Icono size={13} className="mt-px shrink-0" />
      <span>
        <span className="font-medium">{titulo}</span>
        {!compacto && <span className="block opacity-90">{detalle}</span>}
      </span>
    </p>
  );
}
