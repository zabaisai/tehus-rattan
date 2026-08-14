"use client";

import { Suspense, useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Search,
  Archive,
  ArchiveRestore,
  Trash2,
  Pencil,
  Users,
  Merge,
} from "lucide-react";
import {
  getContacts,
  getPapelera,
  createContact,
  updateContact,
  archiveContact,
  restoreContact,
} from "@/lib/contacts";
import { Contact } from "@/types";
import { ContactModal } from "@/components/contacts/ContactModal";
import { EliminarContactoDialog } from "@/components/contacts/EliminarContactoDialog";
import { FusionDeDuplicados } from "@/components/contacts/FusionDeDuplicados";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCanonico, puedeFusionar } from "@/lib/fusion";
import { useAuthStore } from "@/store/auth.store";

type Vista = "activos" | "papelera";

function ContactsPageContent() {
  const queryClient = useQueryClient();
  const rol = useAuthStore((s) => s.user?.role);
  const [vista, setVista] = useState<Vista>("activos");

  const activos = useQuery({
    queryKey: ["contacts"],
    queryFn: getContacts,
    enabled: vista === "activos",
  });
  const papelera = useQuery({
    queryKey: ["contacts", "papelera"],
    queryFn: getPapelera,
    enabled: vista === "papelera",
  });

  const enPapelera = vista === "papelera";
  const isLoading = enPapelera ? papelera.isLoading : activos.isLoading;

  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [aEliminar, setAEliminar] = useState<Contact | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // LA SELECCIÓN VIVE EN LA URL, no en el estado de React: `?fusionar=<id>` y
  // `?con=<id>`. Así una recarga a mitad de la comparación devuelve a la misma
  // pareja en vez de al listado, y el enlace se puede pegar en un mensaje.
  const router = useRouter();
  const parametros = useSearchParams();
  const puedeUnirDuplicados = puedeFusionar(rol);

  /**
   * LA SELECCION SE LEE DE LA RUTA Y SE ESCRIBE EN LA RUTA.
   *
   * Se guarda ademas en estado porque `router.replace` NO actualiza la barra
   * de direcciones en esta pantalla —medido en navegador: los manejadores de
   * React se ejecutan, el paso cambia, y `location.search` se queda igual—,
   * asi que confiar solo en el router dejaba la interfaz congelada. El estado
   * manda la pantalla al instante y `history.replaceState` deja la URL en su
   * sitio para que una recarga o un enlace pegado abran la misma pareja.
   *
   * `replaceState` y no `pushState`: cambiar de principal es corregir la
   * misma decision, no navegar a otro sitio, y llenar el historial obligaria
   * a pulsar «atras» una vez por cada rectificacion.
   */
  const [seleccion, setSeleccion] = useState<{
    principal: string | null;
    duplicado: string | null;
    paso: string | null;
  }>(() => ({
    principal: parametros.get("fusionar"),
    duplicado: parametros.get("con"),
    paso: parametros.get("paso"),
  }));

  // LA RUTA MANDA CUANDO CAMBIA POR FUERA: enlace pegado, atras o adelante.
  //
  // Se ajusta durante el RENDER y no en un efecto —mismo patron que Tareas—:
  // un efecto que llama a `setState` provoca un render en cascada y la pareja
  // aparecia un fotograma tarde. `claveAplicada` hace que ocurra una sola vez
  // por cambio de URL, de modo que un intercambio no se deshaga solo.
  const claveDeUrl = `${parametros.get("fusionar") ?? ""}|${parametros.get("con") ?? ""}|${parametros.get("paso") ?? ""}`;
  const [claveAplicada, setClaveAplicada] = useState(claveDeUrl);
  if (claveDeUrl !== claveAplicada) {
    setClaveAplicada(claveDeUrl);
    const [p, d, pa] = claveDeUrl.split("|");
    setSeleccion({
      principal: p || null,
      duplicado: d || null,
      paso: pa || null,
    });
  }

  const fusionarId = seleccion.principal;
  const duplicadoId = seleccion.duplicado;
  const pasoDeFusion = seleccion.paso;

  /**
   * Escribe la seleccion COMPLETA en la ruta: principal, duplicado y paso.
   *
   * Los tres van juntos a proposito. Cuando solo viajaba el duplicado, un
   * intercambio dejaba `fusionar` con el principal anterior y `con` con ese
   * mismo id, y la pantalla acababa comparando un contacto consigo mismo.
   */
  function escribirRuta(
    principal: string | null,
    duplicado: string | null,
    paso: string | null,
  ) {
    setSeleccion({ principal, duplicado, paso });
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (principal) q.set("fusionar", principal);
    else q.delete("fusionar");
    if (duplicado) q.set("con", duplicado);
    else q.delete("con");
    if (paso) q.set("paso", paso);
    else q.delete("paso");
    const cadena = q.toString();
    window.history.replaceState(
      null,
      "",
      `/dashboard/contacts${cadena ? `?${cadena}` : ""}`,
    );
  }

  function abrirFusion(
    principal: string,
    duplicado?: string | null,
    paso?: string | null,
  ) {
    escribirRuta(principal, duplicado ?? null, paso ?? null);
  }

  function cerrarFusion() {
    escribirRuta(null, null, null);
  }

  // UN ENLACE ANTIGUO A UN CONTACTO ABSORBIDO SE REESCRIBE POR EL CANÓNICO.
  //
  // Se resuelve contra el servidor, que es quien sabe si ese id sigue siendo
  // un contacto o ya es un alias, y se usa `replace` para no dejar la URL
  // muerta en el historial —volver atrás la reabriría—. La condición
  // `canonicoId !== fusionarId` evita el bucle: una vez reescrita, la
  // resolución siguiente devuelve el mismo id y no vuelve a navegar.
  useEffect(() => {
    if (!fusionarId) return;
    let vigente = true;
    getCanonico(fusionarId)
      .then((r) => {
        if (!vigente || !r.fueFusionado || r.canonicoId === fusionarId) return;
        escribirRuta(r.canonicoId, null, null);
        setAviso(
          "Ese contacto se había fusionado: te llevamos a la ficha que lo absorbió.",
        );
      })
      .catch(() => undefined);
    return () => {
      vigente = false;
    };
    // Solo depende del id: resolver el canonico otra vez porque cambio
    // cualquier otra cosa seria una llamada al servidor sin motivo.
  }, [fusionarId]);

  // La eliminación definitiva no es una limpieza de escritorio. El servidor
  // la restringe igualmente; esconder el botón solo evita ofrecer algo que
  // acabaría en un 403.
  const puedeEliminarDefinitivo = rol === "ADMIN" || rol === "SUPER_ADMIN";

  const filtered = useMemo(() => {
    // La lista se elige DENTRO del memo: fuera se recreaba en cada render y
    // arrastraba consigo el filtrado, que es lo que este memo evita.
    const lista: Contact[] = enPapelera
      ? (papelera.data?.items ?? [])
      : (activos.data ?? []);
    const term = search.toLowerCase();
    if (!term) return lista;
    return lista.filter(
      (c) =>
        (c.name?.toLowerCase().includes(term) ?? false) ||
        c.phone.includes(term) ||
        (c.email?.toLowerCase().includes(term) ?? false),
    );
  }, [enPapelera, papelera.data, activos.data, search]);

  function openCreateModal() {
    setEditingContact(null);
    setModalOpen(true);
  }

  function openEditModal(contact: Contact) {
    setEditingContact(contact);
    setModalOpen(true);
  }

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

  /**
   * ARCHIVA. El botón dice lo que hace: el contacto sale de las listas de
   * trabajo y su historial se queda donde está.
   */
  async function handleArchive(contact: Contact) {
    const nombre = contact.name || contact.phone;
    if (
      !confirm(
        `¿Archivar a ${nombre}?\n\n` +
          "Saldrá de la lista de contactos activos. Sus conversaciones, " +
          "mensajes y oportunidades se conservan, y puedes restaurarlo desde " +
          "la papelera cuando quieras.",
      )
    )
      return;
    await archiveContact(contact.id);
    await refrescar();
    setAviso(`${nombre} está archivado. Puedes restaurarlo desde la papelera.`);
  }

  async function handleRestore(contact: Contact) {
    await restoreContact(contact.id);
    await refrescar();
    setAviso(
      `${contact.name || contact.phone} volvió a los contactos activos.`,
    );
  }

  const acciones = (contact: Contact, tamaño: number) => (
    <div className="flex shrink-0 justify-end gap-1">
      {enPapelera ? (
        <>
          {!contact.anonymizedAt && (
            <button
              onClick={() => handleRestore(contact)}
              aria-label={`Restaurar a ${contact.name || contact.phone}`}
              title="Restaurar"
              className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            >
              <ArchiveRestore size={tamaño} />
            </button>
          )}
          {puedeEliminarDefinitivo && !contact.anonymizedAt && (
            <button
              onClick={() => setAEliminar(contact)}
              aria-label={`Eliminar definitivamente a ${contact.name || contact.phone}`}
              title="Eliminar definitivamente"
              className="rounded p-1.5 text-neutral-400 hover:bg-status-error-surface hover:text-status-error"
            >
              <Trash2 size={tamaño} />
            </button>
          )}
        </>
      ) : (
        <>
          <button
            onClick={() => openEditModal(contact)}
            aria-label={`Editar a ${contact.name || contact.phone}`}
            title="Editar"
            className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <Pencil size={tamaño} />
          </button>
          {puedeUnirDuplicados && (
            <button
              onClick={() => abrirFusion(contact.id)}
              aria-label={`Fusionar duplicado de ${contact.name || contact.phone}`}
              title="Fusionar duplicado"
              className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            >
              <Merge size={tamaño} />
            </button>
          )}
          <button
            onClick={() => handleArchive(contact)}
            aria-label={`Archivar a ${contact.name || contact.phone}`}
            title="Archivar"
            className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <Archive size={tamaño} />
          </button>
        </>
      )}
    </div>
  );

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold text-neutral-900">Contactos</h2>
        <button
          onClick={openCreateModal}
          className="flex items-center justify-center gap-1.5 rounded-md bg-brand-primary px-3 py-2 text-sm text-white hover:bg-primary-900"
        >
          <Plus size={16} />
          Nuevo contacto
        </button>
      </div>

      <div
        className="mb-4 flex gap-1 border-b border-neutral-200"
        role="tablist"
        aria-label="Contactos activos o archivados"
      >
        {(
          [
            ["activos", "Activos"],
            ["papelera", "Papelera"],
          ] as const
        ).map(([clave, etiqueta]) => (
          <button
            key={clave}
            role="tab"
            aria-selected={vista === clave}
            onClick={() => {
              setVista(clave);
              setAviso(null);
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              vista === clave
                ? "border-brand-primary font-medium text-brand-primary"
                : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {aviso && (
        <div
          role="status"
          className="mb-4 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700"
        >
          {aviso}
        </div>
      )}

      {enPapelera && (
        <p className="mb-4 text-sm text-neutral-600">
          Los contactos archivados no aparecen en las listas de trabajo y los
          bots no arrancan solos con ellos. Su historial sigue intacto.
        </p>
      )}

      <div className="relative mb-4 sm:max-w-xs">
        <Search
          size={15}
          className="absolute left-2.5 top-2.5 text-neutral-400"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, teléfono o correo"
          aria-label="Buscar contactos"
          className="w-full rounded-md border border-neutral-300 py-2 pl-8 pr-3 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
        />
      </div>

      {isLoading && (
        <p className="py-10 text-center text-sm text-neutral-400">
          Cargando...
        </p>
      )}

      {!isLoading && filtered.length === 0 && (
        <EmptyState
          icon={Users}
          message={
            enPapelera
              ? "No hay contactos archivados."
              : search
                ? "Ningún contacto coincide con la búsqueda."
                : "No hay contactos."
          }
        />
      )}

      {!isLoading && filtered.length > 0 && (
        <>
          {/* Móvil: tarjetas apiladas en vez de tabla */}
          <div className="flex flex-col gap-2 sm:hidden">
            {filtered.map((contact) => (
              <div
                key={contact.id}
                className="rounded-lg border border-neutral-200 bg-white p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-900">
                      {contact.name || "—"}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-600">
                      {contact.phone}
                    </p>
                    {contact.email && (
                      <p className="truncate text-xs text-neutral-500">
                        {contact.email}
                      </p>
                    )}
                    {contact.anonymizedAt && (
                      <p className="mt-1 text-xs text-neutral-500">
                        Datos personales eliminados
                      </p>
                    )}
                  </div>
                  {acciones(contact, 15)}
                </div>
              </div>
            ))}
          </div>

          {/* Escritorio/tablet: tabla tradicional */}
          <div className="hidden overflow-x-auto rounded-lg border border-neutral-200 bg-white sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
                  <th className="px-4 py-2.5 font-medium">Nombre</th>
                  <th className="px-4 py-2.5 font-medium">Teléfono</th>
                  <th className="px-4 py-2.5 font-medium">Correo</th>
                  {enPapelera && (
                    <th className="px-4 py-2.5 font-medium">Motivo</th>
                  )}
                  <th className="px-4 py-2.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((contact) => (
                  <tr
                    key={contact.id}
                    className="border-b border-neutral-100 last:border-0"
                  >
                    <td className="px-4 py-2.5 text-neutral-800">
                      {contact.name || "—"}
                      {contact.anonymizedAt && (
                        <span className="ml-2 text-xs text-neutral-500">
                          datos personales eliminados
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-neutral-600">
                      {contact.phone}
                    </td>
                    <td className="px-4 py-2.5 text-neutral-600">
                      {contact.email || "—"}
                    </td>
                    {enPapelera && (
                      <td className="px-4 py-2.5 text-neutral-500">
                        {contact.archivedReason || "—"}
                      </td>
                    )}
                    <td className="px-4 py-2.5">{acciones(contact, 14)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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
          onCerrar={cerrarFusion}
          onCambioDeSeleccion={(sel) =>
            abrirFusion(sel.principalId, sel.duplicadoId, sel.paso)
          }
          onFusionado={async (canonicoId) => {
            cerrarFusion();
            await refrescar();
            setAviso("Fusión completada. Este es el contacto principal.");
            router.push(`/dashboard/pipeline?perfil=${canonicoId}`);
          }}
        />
      )}

      {aEliminar && (
        <EliminarContactoDialog
          contact={aEliminar}
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
        <p className="py-10 text-center text-sm text-neutral-400">Cargando...</p>
      }
    >
      <ContactsPageContent />
    </Suspense>
  );
}
