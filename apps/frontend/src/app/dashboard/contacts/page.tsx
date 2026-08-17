"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Users } from "lucide-react";
import {
  createContact,
  updateContact,
  archiveContact,
  restoreContact,
  getListadoDeContactos,
  type ContactoDeListado,
} from "@/lib/contacts";
import { Contact } from "@/types";
import { ContactModal } from "@/components/contacts/ContactModal";
import { EliminarContactoDialog } from "@/components/contacts/EliminarContactoDialog";
import { FusionDeDuplicados } from "@/components/contacts/FusionDeDuplicados";
import { ContactosTabla } from "@/components/contacts/ContactosTabla";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ListState } from "@/components/ui/ListState";
import { ForbiddenState } from "@/components/ui/ForbiddenState";
import { Skeleton } from "@/components/ui/Skeleton";
import { TextoLargo } from "@/components/ui/TextoLargo";
import { getCanonico, puedeFusionar } from "@/lib/fusion";
import { useAuthStore } from "@/store/auth.store";
import {
  PESTANAS,
  POR_PAGINA,
  aplicarEnQuery,
  leerEstadoDeContactos,
  offsetDe,
  rangoMostrado,
  rutaDeContactos,
  totalDePaginas,
  type CambiosDeContactos,
} from "@/lib/contactos-url";

const RETARDO_DE_BUSQUEDA = 300;

function ContactsPageContent() {
  const queryClient = useQueryClient();
  const rol = useAuthStore((s) => s.user?.role);
  const router = useRouter();
  const pathname = usePathname();
  const parametros = useSearchParams();

  const estado = leerEstadoDeContactos(
    new URLSearchParams(parametros.toString()),
  );
  const enPapelera = estado.vista === "papelera";
  const puedeUnirDuplicados = puedeFusionar(rol);
  // La eliminación definitiva no es una limpieza de escritorio. El servidor
  // la restringe igualmente; esconder el botón solo evita ofrecer algo que
  // acabaría en un 403.
  const puedeEliminarDefinitivo = rol === "ADMIN" || rol === "SUPER_ADMIN";

  /**
   * Navegación de SOLO query, con la History API del navegador.
   *
   * Misma lección que la bandeja (3.y): aquí la ruta no cambia, solo cambian
   * los parámetros, y `router.push`/`router.replace` no llegaban a aplicarse
   * en el build de producción —la barra de direcciones se quedaba igual—.
   * Next 15+ observa `history.pushState`/`replaceState`, y `useSearchParams`
   * se actualiza con ellos.
   *
   * `push` para pestaña y paginación, que son sitios distintos y deben
   * poder deshacerse con Atrás. `replace` para teclear en el buscador: una
   * entrada de historial por pulsación deja el botón Atrás inservible.
   */
  const navegar = useCallback(
    (cambios: CambiosDeContactos, modo: "push" | "replace" = "push") => {
      if (typeof window === "undefined") return;
      const q = aplicarEnQuery(
        new URLSearchParams(window.location.search),
        cambios,
      );
      const url = q ? `${pathname}?${q}` : pathname;
      if (modo === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [pathname],
  );

  const listado = useQuery({
    // La clave incluye TODO lo que cambia el resultado. Sin la búsqueda y la
    // página dentro, react-query serviría la lista anterior desde caché y la
    // pantalla enseñaría resultados de otra consulta.
    queryKey: [
      "contacts",
      "listado",
      estado.vista,
      estado.search,
      estado.pagina,
      estado.porPagina,
    ],
    queryFn: () =>
      getListadoDeContactos({
        vista: estado.vista,
        search: estado.search,
        limit: estado.porPagina,
        offset: offsetDe(estado),
      }),
    // Al cambiar de página o de pestaña se conserva lo anterior mientras llega
    // lo nuevo: sin esto la tabla desaparece y la página da un salto.
    placeholderData: (previo) => previo,
  });

  const estadoHttp = (listado.error as { response?: { status?: number } })
    ?.response?.status;
  const sinPermiso = estadoHttp === 403;

  const [modalOpen, setModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [aEliminar, setAEliminar] = useState<ContactoDeListado | null>(null);
  const [aArchivar, setAArchivar] = useState<ContactoDeListado | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  /**
   * El texto del buscador se teclea en local y viaja a la URL con retardo.
   *
   * Leerlo directamente de la URL con retardo haría que el campo pareciera
   * trabado. Cuando la URL cambia por fuera —Atrás, un enlace pegado— el
   * campo se resincroniza.
   */
  const [textoBusqueda, setTextoBusqueda] = useState(estado.search);
  const [busquedaAplicada, setBusquedaAplicada] = useState(estado.search);
  if (estado.search !== busquedaAplicada) {
    setBusquedaAplicada(estado.search);
    setTextoBusqueda(estado.search);
  }

  useEffect(() => {
    if (textoBusqueda.trim() === estado.search) return;
    const t = setTimeout(
      () => navegar({ search: textoBusqueda }, "replace"),
      RETARDO_DE_BUSQUEDA,
    );
    return () => clearTimeout(t);
  }, [textoBusqueda, estado.search, navegar]);

  // ── Fusión de duplicados (3.x). Se conserva tal cual: vive en la URL ──────
  const fusionarId = parametros.get("fusionar");
  const duplicadoId = parametros.get("con");
  const pasoDeFusion = parametros.get("paso");

  const escribirFusion = useCallback(
    (principal: string | null, duplicado: string | null, paso: string | null) => {
      if (typeof window === "undefined") return;
      const q = new URLSearchParams(window.location.search);
      if (principal) q.set("fusionar", principal);
      else q.delete("fusionar");
      if (duplicado) q.set("con", duplicado);
      else q.delete("con");
      if (paso) q.set("paso", paso);
      else q.delete("paso");
      const cadena = q.toString();
      // `replaceState` y no `pushState`: cambiar de principal es corregir la
      // misma decisión, no navegar a otro sitio.
      window.history.replaceState(
        null,
        "",
        cadena ? `${pathname}?${cadena}` : pathname,
      );
    },
    [pathname],
  );

  // UN ENLACE ANTIGUO A UN CONTACTO ABSORBIDO SE REESCRIBE POR EL CANÓNICO.
  useEffect(() => {
    if (!fusionarId) return;
    let vigente = true;
    getCanonico(fusionarId)
      .then((r) => {
        if (!vigente || !r.fueFusionado || r.canonicoId === fusionarId) return;
        escribirFusion(r.canonicoId, null, null);
        setAviso(
          "Ese contacto se había fusionado: te llevamos a la ficha que lo absorbió.",
        );
      })
      .catch(() => undefined);
    return () => {
      vigente = false;
    };
  }, [fusionarId, escribirFusion]);

  async function refrescar() {
    await queryClient.invalidateQueries({ queryKey: ["contacts"] });
  }

  async function handleSubmit(data: {
    phone: string;
    name: string;
    email: string;
  }) {
    if (editingContact) {
      await updateContact(editingContact.id, {
        name: data.name,
        email: data.email || undefined,
      });
    } else {
      await createContact({
        phone: data.phone,
        name: data.name || undefined,
        email: data.email || undefined,
      });
    }
    await refrescar();
    setModalOpen(false);
  }

  async function confirmarArchivado() {
    if (!aArchivar) return;
    const nombre = aArchivar.nombre || aArchivar.telefono;
    const r = await archiveContact(aArchivar.id);
    setAArchivar(null);
    await refrescar();
    setAviso(
      r.yaEstaba
        ? `${nombre} ya estaba archivado.`
        : `${nombre} está archivado. Puedes restaurarlo desde la papelera.`,
    );
  }

  async function handleRestore(c: ContactoDeListado) {
    const nombre = c.nombre || c.telefono;
    const r = await restoreContact(c.id);
    await refrescar();
    setAviso(
      r.yaEstaba
        ? `${nombre} ya estaba en los contactos activos.`
        : `${nombre} volvió a los contactos activos.`,
    );
  }

  const datos = listado.data;
  const contactos = datos?.items ?? [];
  const rango = rangoMostrado(estado, contactos.length, datos?.total ?? 0);
  const paginas = totalDePaginas(estado, datos?.total ?? 0);
  // Sale de `useSearchParams` y NO de `window.location`: leer `window` durante
  // el render da un valor en el servidor y otro al hidratar, y eso es un aviso
  // de hidratación en la consola además de un `volverA` equivocado en el
  // primer pintado.
  const rutaActual = rutaDeContactos(parametros.toString());

  const mensajeVacio = enPapelera
    ? estado.search
      ? "Ningún contacto archivado coincide con la búsqueda."
      : "No hay contactos archivados."
    : estado.search
      ? "Ningún contacto coincide con la búsqueda."
      : "No hay contactos todavía.";

  return (
    <div>
      {/* ── Cabecera ─────────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-content-primary">
            Contactos
          </h2>
          <p className="mt-0.5 text-sm text-content-secondary">
            Personas, conversaciones y oportunidades en un solo lugar
          </p>
        </div>

        <div className="flex items-center gap-3">
          <dl className="flex items-center gap-2">
            {PESTANAS.map((p) => (
              <div
                key={p.clave}
                className="rounded-lg border border-line-default bg-surface-default px-3 py-2 text-center"
              >
                <dd className="font-mono text-base font-semibold text-content-primary">
                  {datos ? (
                    datos.contadores[p.contador]
                  ) : (
                    <Skeleton className="mx-auto h-5 w-8" />
                  )}
                </dd>
                <dt className="text-xs text-content-secondary">
                  {p.clave === "activos" ? "activos" : "archivados"}
                </dt>
              </div>
            ))}
          </dl>

          <Button
            variant="accent"
            onClick={() => {
              setEditingContact(null);
              setModalOpen(true);
            }}
          >
            <Plus size={16} aria-hidden="true" />
            Nuevo contacto
          </Button>
        </div>
      </div>

      {/* ── Pestañas ─────────────────────────────────────────────────── */}
      <div
        className="mb-4 flex gap-1 border-b border-line-default"
        role="tablist"
        aria-label="Contactos activos o archivados"
      >
        {PESTANAS.map((p) => (
          <button
            key={p.clave}
            type="button"
            role="tab"
            aria-selected={estado.vista === p.clave}
            onClick={() => {
              setAviso(null);
              navegar({ vista: p.clave });
            }}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${
              estado.vista === p.clave
                ? "border-brand-primary font-medium text-brand-primary"
                : "border-transparent text-content-secondary hover:text-content-primary"
            }`}
          >
            {p.etiqueta}
            {datos && (
              <span className="font-mono text-xs text-content-secondary">
                {datos.contadores[p.contador]}
              </span>
            )}
          </button>
        ))}
      </div>

      {aviso && (
        <div
          role="status"
          className="mb-4 rounded-md border border-line-default bg-surface-subtle px-3 py-2 text-sm text-content-secondary"
        >
          {aviso}
        </div>
      )}

      {enPapelera && (
        <p className="mb-4 text-sm text-content-secondary">
          Los contactos archivados no aparecen en las listas de trabajo y los
          bots no arrancan solos con ellos. Su historial sigue intacto y puedes
          restaurarlos cuando quieras.
        </p>
      )}

      {/* ── Buscador ─────────────────────────────────────────────────── */}
      <div className="relative mb-4 sm:max-w-sm">
        <Search
          size={15}
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-2.5 text-content-disabled"
        />
        <input
          type="search"
          value={textoBusqueda}
          onChange={(e) => setTextoBusqueda(e.target.value)}
          placeholder="Buscar por nombre, teléfono o correo"
          aria-label="Buscar contactos"
          className="w-full rounded-md border border-line-default bg-surface-default py-2 pl-8 pr-3 text-sm text-content-primary outline-none focus:border-line-focus focus:ring-1 focus:ring-line-focus"
        />
      </div>

      {/* ── Contenido ────────────────────────────────────────────────── */}
      {sinPermiso ? (
        <ForbiddenState detalle="Pide acceso a un administrador de tu empresa." />
      ) : (
        <>
          <ListState
            isLoading={listado.isLoading}
            isError={listado.isError}
            isEmpty={contactos.length === 0}
            error={listado.error}
            onRetry={() => listado.refetch()}
            icon={Users}
            emptyMessage={mensajeVacio}
          />

          {!listado.isLoading && !listado.isError && contactos.length > 0 && (
            <>
              <ContactosTabla
                contactos={contactos}
                enPapelera={enPapelera}
                puedeFusionar={puedeUnirDuplicados}
                puedeEliminarDefinitivo={puedeEliminarDefinitivo}
                rutaDeRegreso={rutaActual}
                acciones={{
                  onArchivar: setAArchivar,
                  onRestaurar: handleRestore,
                  onEditar: (c) => {
                    // El modal de edición trabaja con la fila cruda; se le
                    // pasa lo que necesita sin inventar campos.
                    setEditingContact({
                      id: c.id,
                      name: c.nombre,
                      phone: c.telefono,
                      email: c.email,
                      tags: c.etiquetas,
                      isBlocked: c.bloqueado,
                      createdAt: c.creadoEn,
                      archivedAt: c.archivadoEn,
                      archivedReason: c.motivoDeArchivo,
                      anonymizedAt: c.anonimizado ? c.creadoEn : null,
                    });
                    setModalOpen(true);
                  },
                  onFusionar: (c) => escribirFusion(c.id, null, null),
                  onEliminarDefinitivo: setAEliminar,
                }}
              />

              {/* ── Paginación ───────────────────────────────────────── */}
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p
                  className="text-sm text-content-secondary"
                  aria-live="polite"
                >
                  Mostrando{" "}
                  <span className="font-mono">{rango.desde}</span> a{" "}
                  <span className="font-mono">{rango.hasta}</span> de{" "}
                  <span className="font-mono">{rango.total}</span>{" "}
                  {rango.total === 1 ? "contacto" : "contactos"}
                </p>

                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={estado.pagina <= 1}
                    onClick={() => navegar({ pagina: estado.pagina - 1 })}
                  >
                    Anterior
                  </Button>
                  <span className="text-sm text-content-secondary">
                    Página <span className="font-mono">{estado.pagina}</span> de{" "}
                    <span className="font-mono">{paginas}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={estado.pagina >= paginas}
                    onClick={() => navegar({ pagina: estado.pagina + 1 })}
                  >
                    Siguiente
                  </Button>

                  <label className="flex items-center gap-1.5 text-sm text-content-secondary">
                    <span className="sr-only sm:not-sr-only">Por página</span>
                    <select
                      value={estado.porPagina}
                      aria-label="Contactos por página"
                      onChange={(e) =>
                        navegar({ porPagina: Number(e.target.value) })
                      }
                      className="rounded-md border border-line-default bg-surface-default px-2 py-1 text-sm outline-none focus:border-line-focus focus:ring-1 focus:ring-line-focus"
                    >
                      {POR_PAGINA.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Diálogos ─────────────────────────────────────────────────── */}
      {aArchivar && (
        <ConfirmDialog
          title={`¿Archivar a ${aArchivar.nombre || aArchivar.telefono}?`}
          confirmLabel="Archivar"
          confirmVariant="primary"
          message={
            <>
              <p>
                <TextoLargo valor={aArchivar.nombre || aArchivar.telefono} />{" "}
                saldrá de la lista de contactos activos y pasará a la papelera.
              </p>
              {/* La promesa exacta del mockup, y la que cumple el backend. */}
              <p className="mt-2">
                <strong className="font-medium text-content-primary">
                  No se elimina su historial.
                </strong>{" "}
                Se conservan sus conversaciones, mensajes, oportunidades,
                tareas y cotizaciones, y puedes restaurarlo cuando quieras.
              </p>
            </>
          }
          onClose={() => setAArchivar(null)}
          onConfirm={confirmarArchivado}
        />
      )}

      {modalOpen && (
        <ContactModal
          key={editingContact?.id ?? "new"}
          contact={editingContact}
          onClose={() => setModalOpen(false)}
          onSubmit={handleSubmit}
        />
      )}

      {fusionarId && (
        <FusionDeDuplicados
          key={`${fusionarId}:${duplicadoId ?? ""}`}
          contactoId={fusionarId}
          duplicadoInicialId={duplicadoId}
          pasoInicial={pasoDeFusion as never}
          puedeEjecutar={puedeUnirDuplicados}
          onCerrar={() => escribirFusion(null, null, null)}
          onCambioDeSeleccion={(sel) =>
            escribirFusion(sel.principalId, sel.duplicadoId, sel.paso ?? null)
          }
          onFusionado={async (canonicoId) => {
            escribirFusion(null, null, null);
            await refrescar();
            setAviso("Fusión completada. Este es el contacto principal.");
            // Ahora existe `/dashboard/contacts/[id]` (3.y): el resultado de
            // una fusión abre el perfil del contacto, no el embudo, que era
            // el destino de cuando esa ruta no existía.
            router.push(`/dashboard/contacts/${canonicoId}`);
          }}
        />
      )}

      {aEliminar && (
        <EliminarContactoDialog
          contact={
            {
              id: aEliminar.id,
              name: aEliminar.nombre,
              phone: aEliminar.telefono,
              email: aEliminar.email,
              tags: aEliminar.etiquetas,
              isBlocked: aEliminar.bloqueado,
              createdAt: aEliminar.creadoEn,
              archivedAt: aEliminar.archivadoEn,
              archivedReason: aEliminar.motivoDeArchivo,
              anonymizedAt: null,
            } satisfies Contact
          }
          onClose={() => setAEliminar(null)}
          onDone={async (accion) => {
            setAEliminar(null);
            await refrescar();
            setAviso(
              accion === "borrado"
                ? "El contacto se eliminó por completo."
                : "Se eliminaron los datos personales. El registro comercial se conservó.",
            );
          }}
        />
      )}
    </div>
  );
}

/**
 * `useSearchParams` obliga a un límite de Suspense para que la página pueda
 * prerenderizarse. Mismo patrón que Tareas, Productos y cotizaciones.
 */
export default function ContactsPage() {
  return (
    <Suspense
      fallback={
        <p className="py-10 text-center text-sm text-content-disabled">
          Cargando…
        </p>
      }
    >
      <ContactsPageContent />
    </Suspense>
  );
}
