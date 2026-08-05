'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/axios';
import { getPipelines } from '@/lib/pipeline';
import { getCompanyUsers } from '@/lib/users';
import { getWhatsAppNumbers } from '@/lib/whatsapp';

export interface DefinicionCampo {
  id: string;
  key: string;
  label: string;
  type: string;
  entity: string;
  isActive: boolean;
}

export interface OpcionRecurso {
  valor: string;
  etiqueta: string;
  ayuda?: string;
}

/**
 * Los recursos de LA EMPRESA que un paso puede referenciar.
 *
 * SE ELIGEN DE UNA LISTA, NUNCA SE PEGA UN ID. Un identificador pegado desde
 * otra pestaña puede ser de otra empresa: el servidor lo rechazaría al
 * validar, pero para entonces ya se perdió el rato configurando, y si algún
 * día una comprobación se quedara corta, el flujo movería la oportunidad de un
 * cliente al embudo de otro. La lista sale de las mismas APIs que usa el resto
 * del CRM, así que solo puede contener lo propio.
 */
export function useRecursos(activo: boolean) {
  const pipelines = useQuery({
    queryKey: ['pipelines'],
    queryFn: getPipelines,
    enabled: activo,
    staleTime: 5 * 60_000,
  });

  const usuarios = useQuery({
    queryKey: ['users'],
    queryFn: getCompanyUsers,
    enabled: activo,
    staleTime: 5 * 60_000,
  });

  const numeros = useQuery({
    queryKey: ['whatsapp', 'numbers'],
    queryFn: getWhatsAppNumbers,
    enabled: activo,
    staleTime: 5 * 60_000,
  });

  const campos = useQuery({
    queryKey: ['custom-fields', 'definitions'],
    queryFn: async () => {
      const { data } = await api.get<DefinicionCampo[]>(
        '/custom-fields/definitions',
      );
      return data;
    },
    enabled: activo,
    staleTime: 5 * 60_000,
  });

  function opciones(referencia: string | undefined): OpcionRecurso[] | null {
    switch (referencia) {
      case 'pipeline':
        return (pipelines.data ?? []).map((p) => ({
          valor: p.id,
          etiqueta: p.name,
          ayuda: p.isDefault ? 'Por defecto' : undefined,
        }));

      case 'stage':
        // Las etapas se listan con su embudo delante: dos embudos pueden
        // tener una etapa llamada «Contactado» y sin el prefijo no hay forma
        // de saber cuál se está eligiendo.
        return (pipelines.data ?? []).flatMap((p) =>
          p.stages.map((e) => ({
            valor: e.id,
            etiqueta: `${p.name} · ${e.name}`,
          })),
        );

      case 'user':
        return (usuarios.data ?? [])
          .filter((u) => u.isActive)
          .map((u) => ({ valor: u.id, etiqueta: u.name, ayuda: u.email }));

      case 'whatsappIntegration':
        return (numeros.data ?? []).map((n) => ({
          valor: n.id,
          etiqueta: n.label || n.displayPhoneNumber || n.phoneNumberId,
          ayuda: n.status === 'CONNECTED' ? undefined : 'Sin conectar',
        }));

      case 'customField':
        return (campos.data ?? [])
          .filter((c) => c.isActive)
          .map((c) => ({
            valor: c.key,
            etiqueta: c.label,
            ayuda: `${c.entity} · ${c.type}`,
          }));

      default:
        // `template`, `tag` y `credential` no tienen aún una lista que pedir.
        // Devolver `null` es distinto de devolver `[]`: uno significa «esto se
        // escribe a mano» y el otro «no tienes ninguno todavía», y el panel
        // dibuja cosas distintas para cada caso.
        return null;
    }
  }

  return {
    opciones,
    cargando:
      pipelines.isLoading ||
      usuarios.isLoading ||
      numeros.isLoading ||
      campos.isLoading,
    pipelines: pipelines.data ?? [],
  };
}
