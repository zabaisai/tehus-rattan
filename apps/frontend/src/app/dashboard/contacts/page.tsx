"use client";

import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Search,
  Archive,
  ArchiveRestore,
  Trash2,
  Pencil,
  Users,
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
import { EmptyState } from "@/components/ui/EmptyState";
import { useAuthStore } from "@/store/auth.store";

type Vista = "activos" | "papelera";

export default function ContactsPage() {
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
