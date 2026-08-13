'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Percent, Target, TrendingUp } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import {
  getOverview,
  getLeadsByStage,
  getAgentPerformance,
  getOverdueTasksCount,
  getRecentActivity,
  getSalesTrend,
} from '@/lib/analytics';
import { getMyCompany } from '@/lib/companies';
import { getInbox } from '@/lib/conversations';
import { getTasks } from '@/lib/tasks';
import { estaPendiente } from '@/lib/tareas';
import { ForbiddenState } from '@/components/ui/ForbiddenState';
import { ComparacionMetrica, MetricCard } from '@/components/ui/MetricCard';
import { Panel, esSinPermiso } from '@/components/ui/Panel';
import { HeroInicio } from '@/components/inicio/HeroInicio';
import { EmbudoComercial } from '@/components/inicio/EmbudoComercial';
import { ConversacionesPendientes } from '@/components/inicio/ConversacionesPendientes';
import { AgendaDeHoy, ordenarAgenda } from '@/components/inicio/AgendaDeHoy';
import { RendimientoPorAsesor } from '@/components/inicio/RendimientoPorAsesor';
import { ActividadReciente } from '@/components/inicio/ActividadReciente';
import { TendenciaDeVentas } from '@/components/inicio/TendenciaDeVentas';

const dinero = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

/** Cifras grandes en las tarjetas: «$ 48,2 M» se lee de un vistazo. */
function dineroCorto(v: number): string {
  if (Math.abs(v) >= 1_000_000) {
    return `$ ${(v / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
  }
  return dinero.format(v);
}

const DIAS_TENDENCIA = 30;

/**
 * Compara dos periodos del MISMO tamaño y lo dice en palabras.
 *
 * Devuelve `undefined` cuando el periodo previo está a cero: «+100 %» sobre
 * nada no informa de nada, y una flecha verde por haber pasado de 0 a 1 es
 * exactamente el tipo de adorno que hace desconfiar del resto de la pantalla.
 */
function compararCantidad(
  actual: number,
  previo: number,
  contra: string,
  subirEsBueno = true,
): ComparacionMetrica | undefined {
  if (previo === 0 && actual === 0) return undefined;
  const delta = actual - previo;
  return {
    texto: `${delta > 0 ? '+' : ''}${delta}`,
    contra,
    direccion: delta > 0 ? 'sube' : delta < 0 ? 'baja' : 'igual',
    subirEsBueno,
  };
}

function compararDinero(
  actual: number,
  previo: number,
  contra: string,
): ComparacionMetrica | undefined {
  if (previo === 0 && actual === 0) return undefined;
  const delta = actual - previo;
  return {
    texto: `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${dineroCorto(Math.abs(delta))}`,
    contra,
    direccion: delta > 0 ? 'sube' : delta < 0 ? 'baja' : 'igual',
    subirEsBueno: true,
  };
}

export default function DashboardHomePage() {
  const user = useAuthStore((s) => s.user);

  // El hero nombra a la empresa conectada, nunca un inquilino fijo. Un
  // SUPER_ADMIN de plataforma (sin empresa) se redirige antes de montar esto,
  // así que aquí no se consulta.
  const { data: company } = useQuery({
    queryKey: ['company-me'],
    queryFn: getMyCompany,
    enabled: !!user?.companyId,
  });

  // `analytics` es ADMIN/SUPER_ADMIN entero. Para los demás roles no se
  // consulta siquiera: pedirlo para recibir un 403 llena la consola de errores
  // y hace parpadear la pantalla antes de enseñar el estado correcto.
  const puedeVerMetricas =
    user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const overview = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: getOverview,
    enabled: puedeVerMetricas,
  });
  const porEtapa = useQuery({
    queryKey: ['analytics-stages'],
    queryFn: getLeadsByStage,
    enabled: puedeVerMetricas,
  });
  const asesores = useQuery({
    queryKey: ['analytics-agents'],
    queryFn: getAgentPerformance,
    enabled: puedeVerMetricas,
  });
  const vencidas = useQuery({
    queryKey: ['analytics-overdue'],
    queryFn: getOverdueTasksCount,
    enabled: puedeVerMetricas,
  });
  const tendencia = useQuery({
    queryKey: ['analytics-trend', DIAS_TENDENCIA],
    queryFn: () => getSalesTrend(DIAS_TENDENCIA),
    enabled: puedeVerMetricas,
  });
  const actividad = useQuery({
    queryKey: ['analytics-activity'],
    queryFn: () => getRecentActivity(8),
    enabled: puedeVerMetricas,
  });

  // Tareas y conversaciones las ve cualquier usuario de la empresa: son los
  // dos bloques que sostienen el Inicio de un asesor.
  const tareas = useQuery({ queryKey: ['tasks'], queryFn: getTasks });

  // «Requieren respuesta» = sin leer por QUIEN MIRA. Es la bandeja de siempre
  // con `unread`, no un contrato nuevo: el backend ya deriva los no leídos
  // comparando la marca de lectura de este usuario con los mensajes entrantes,
  // así que la lista dice lo mismo aquí que en Conversaciones.
  const pendientes = useQuery({
    queryKey: ['inbox', 'inicio-sin-responder'],
    queryFn: () => getInbox({ unread: true, limit: 5 }),
  });

  const abiertas = porEtapa.data?.reduce((s, e) => s + e.count, 0) ?? 0;

  const serieAbiertas = tendencia.data?.points.map((p) => p.openedCount) ?? [];
  const serieValor = tendencia.data?.points.map((p) => p.openedValue) ?? [];
  const CONTRA = `vs. ${DIAS_TENDENCIA} días previos`;

  const proximas = ordenarAgenda(
    (tareas.data ?? []).filter((t) => estaPendiente(t.status)),
  ).slice(0, 5);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      <HeroInicio nombreUsuario={user?.name} nombreEmpresa={company?.name} />

      {/* Métricas. Cada una enlaza a donde se actúa sobre ella. */}
      {puedeVerMetricas ? (
        // Cuatro en fila solo a partir de 1280: a 1024 la tarjeta se queda en
        // ~115 px de texto y «$ 27,6 M» sale cortado, que en una métrica es
        // peor que no enseñarla.
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            etiqueta="Oportunidades abiertas"
            valor={porEtapa.isLoading ? '' : abiertas}
            cargando={porEtapa.isLoading}
            icono={Target}
            href="/dashboard/pipeline"
            hrefLabel="Abrir el embudo"
            serie={serieAbiertas}
            comparacion={
              tendencia.data &&
              compararCantidad(
                tendencia.data.totals.openedCount,
                tendencia.data.previous.openedCount,
                CONTRA,
              )
            }
            nota={tendencia.data ? 'nuevas por día' : undefined}
          />
          <MetricCard
            etiqueta="Valor abierto"
            valor={overview.data ? dineroCorto(overview.data.openValue) : ''}
            cargando={overview.isLoading}
            icono={TrendingUp}
            href="/dashboard/pipeline"
            hrefLabel="Abrir el embudo"
            serie={serieValor}
            comparacion={
              tendencia.data &&
              compararDinero(
                tendencia.data.totals.openedValue,
                tendencia.data.previous.openedValue,
                CONTRA,
              )
            }
            nota={tendencia.data ? 'abierto por día' : undefined}
          />
          <MetricCard
            etiqueta="Conversión"
            valor={
              overview.data
                ? `${overview.data.conversionRate.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`
                : ''
            }
            cargando={overview.isLoading}
            icono={Percent}
            href="/dashboard/pipeline"
            hrefLabel="Abrir el embudo"
            // Sin curva: es un acumulado histórico, no una serie. Dibujar su
            // «evolución» exigiría recalcularla día a día sobre el estado
            // pasado de cada oportunidad, que no se guarda.
            nota="acumulado histórico"
          />
          <MetricCard
            etiqueta="Tareas vencidas"
            valor={vencidas.isLoading ? '' : (vencidas.data ?? 0)}
            cargando={vencidas.isLoading}
            icono={CalendarClock}
            href="/dashboard/tasks"
            hrefLabel="Abrir tareas"
            tono={(vencidas.data ?? 0) > 0 ? 'atencion' : 'neutral'}
            nota="ahora mismo"
          />
        </div>
      ) : (
        <ForbiddenState
          titulo="Las métricas de la empresa son para administradores"
          detalle="Tu agenda y tus conversaciones siguen abajo. Si necesitas el resumen comercial, pídeselo a un administrador."
        />
      )}

      {/* COLUMNAS QUE SE EMPAQUETAN SOLAS, NO FILAS QUE SE ESPERAN.
          En una retícula, la fila entera mide lo que el elemento más alto: el
          Embudo (422 px) obligaba a Conversaciones (165) y Agenda (246) a
          dejar 273 y 192 px de fondo vacío debajo antes de que empezara la
          segunda fila. `items-start` ya impedía que los paneles se estiraran,
          pero no que la fila siguiente esperara.

          La solución es agrupar cada pareja en su COLUMNA, para que Tendencia
          suba pegada al Embudo, Rendimiento a Conversaciones y Actividad a la
          Agenda, cada una a la altura que le toque. Eso pide dos disposiciones
          distintas —seis elementos sueltos por debajo de `xl`, tres columnas a
          partir de `xl`— y `display: contents` las da con UN SOLO DOM: por
          debajo de `xl` el envoltorio no genera caja y sus paneles participan
          en la retícula como si no existiera; a partir de `xl` se convierte en
          columna flexible. Ni componentes duplicados, ni dos dashboards, ni
          alturas fijas: el alto lo sigue poniendo el contenido real.

          No se usa `grid-template-rows: masonry` porque no está disponible de
          forma estable, ni columnas CSS (`columns-*`) porque reparten los
          paneles por equilibrado de altura y la pareja de cada columna dejaría
          de ser la del mockup.

          Las tres columnas pasan a medir lo mismo (`col-span-4`). Antes la
          segunda fila iba 5/4/3 contra el 4/4/4 de la primera, así que ningún
          panel de abajo quedaba alineado con el de arriba. */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        {/* Los cuatro paneles de administración NO se montan para el resto de
            roles. Antes salían como cuatro cajas de «sin permiso» seguidas, y
            el Inicio de un asesor era medio aviso legal: el mensaje de arriba
            ya dice una vez lo que falta y a quién pedírselo. `sinPermiso`
            sigue dentro por si el servidor y el rol de la sesión discrepan.

            La primera columna es entera de administración: si no se puede ver,
            no se monta el envoltorio tampoco, para no dejar un tercio de
            pantalla reservado a nada. */}
        {puedeVerMetricas && (
          <div className="contents xl:col-span-4 xl:flex xl:flex-col xl:gap-4">
            <Panel
              titulo="Embudo comercial"
              accion={{ href: '/dashboard/pipeline', etiqueta: 'Ver embudo' }}
              cargando={porEtapa.isLoading}
              sinPermiso={esSinPermiso(porEtapa.error)}
              detalleSinPermiso="Solo un administrador ve el resumen por etapa."
              error={esSinPermiso(porEtapa.error) ? undefined : porEtapa.error}
              vacio={(porEtapa.data?.length ?? 0) === 0}
              mensajeVacio="Todavía no hay etapas en el embudo."
              className="lg:col-span-6"
            >
              {porEtapa.data && (
                <EmbudoComercial etapas={porEtapa.data} formatoDinero={dineroCorto} />
              )}
            </Panel>

            <Panel
              titulo="Tendencia de ventas"
              cargando={tendencia.isLoading}
              sinPermiso={esSinPermiso(tendencia.error)}
              detalleSinPermiso="Solo un administrador ve la tendencia comercial."
              error={esSinPermiso(tendencia.error) ? undefined : tendencia.error}
              className="lg:col-span-6"
            >
              {tendencia.data && (
                <TendenciaDeVentas datos={tendencia.data} formatoDinero={dineroCorto} />
              )}
            </Panel>
          </div>
        )}

        <div className="contents xl:col-span-4 xl:flex xl:flex-col xl:gap-4">
          {/* Es lo único del Inicio que un asesor atiende AHORA, así que va por
              delante de la agenda. Cualquier rol lo ve: la bandeja es del
              equipo. */}
          <Panel
            titulo="Conversaciones que requieren respuesta"
            accion={{ href: '/dashboard/conversations', etiqueta: 'Ver todas' }}
            cargando={pendientes.isLoading}
            error={pendientes.error}
            vacio={(pendientes.data?.items.length ?? 0) === 0}
            mensajeVacio="Todo respondido. No hay mensajes sin leer."
            className="lg:col-span-6"
          >
            {pendientes.data && (
              <ConversacionesPendientes conversaciones={pendientes.data.items} />
            )}
          </Panel>

          {puedeVerMetricas && (
            <Panel
              titulo="Rendimiento por asesor"
              cargando={asesores.isLoading}
              sinPermiso={esSinPermiso(asesores.error)}
              detalleSinPermiso="Solo un administrador ve el rendimiento del equipo."
              error={esSinPermiso(asesores.error) ? undefined : asesores.error}
              vacio={(asesores.data?.length ?? 0) === 0}
              mensajeVacio="Todavía no hay personas activas en la empresa."
              className="lg:col-span-6"
            >
              {asesores.data && (
                <RendimientoPorAsesor asesores={asesores.data} formatoDinero={dineroCorto} />
              )}
            </Panel>
          )}
        </div>

        <div className="contents xl:col-span-4 xl:flex xl:flex-col xl:gap-4">
          <Panel
            titulo="Agenda de hoy"
            accion={{ href: '/dashboard/tasks', etiqueta: 'Ver todas' }}
            cargando={tareas.isLoading}
            error={tareas.error}
            vacio={proximas.length === 0}
            mensajeVacio="No tienes tareas pendientes."
            className="lg:col-span-6"
          >
            <AgendaDeHoy tareas={proximas} />
          </Panel>

          {puedeVerMetricas && (
            <Panel
              titulo="Actividad reciente"
              accion={{ href: '/dashboard/notifications', etiqueta: 'Ver avisos' }}
              cargando={actividad.isLoading}
              sinPermiso={esSinPermiso(actividad.error)}
              detalleSinPermiso="Solo un administrador ve la actividad de la empresa."
              error={esSinPermiso(actividad.error) ? undefined : actividad.error}
              vacio={(actividad.data?.length ?? 0) === 0}
              mensajeVacio="Sin actividad registrada todavía."
              className="lg:col-span-6"
            >
              {actividad.data && <ActividadReciente filas={actividad.data} />}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
