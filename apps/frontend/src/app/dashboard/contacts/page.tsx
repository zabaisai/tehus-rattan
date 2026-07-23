"use client";

import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Trash2, Pencil, Users } from "lucide-react";
import {
  getContacts,
  createContact,
  updateContact,
  deleteContact,
} from "@/lib/contacts";
import { Contact } from "@/types";
import { ContactModal } from "@/components/contacts/ContactModal";
import { EmptyState } from "@/components/ui/EmptyState";

export default function ContactsPage() {
  const queryClient = useQueryClient();
  const { data: contacts, isLoading } = useQuery({
    queryKey: ["contacts"],
    queryFn: getContacts,
  });

  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  const filtered = useMemo(() => {
    if (!contacts) return [];
    const term = search.toLowerCase();
    return contacts.filter(
      (c) =>
        (c.name?.toLowerCase().includes(term) ?? false) ||
        c.phone.includes(term) ||
        (c.email?.toLowerCase().includes(term) ?? false),
    );
  }, [contacts, search]);

  function openCreateModal() {
    setEditingContact(null);
    setModalOpen(true);
  }

  function openEditModal(contact: Contact) {
    setEditingContact(contact);
    setModalOpen(true);
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
    await queryClient.invalidateQueries({ queryKey: ["contacts"] });
    setModalOpen(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar este contacto?")) return;
    await deleteContact(id);
    await queryClient.invalidateQueries({ queryKey: ["contacts"] });
  }

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold text-stone-900">Contactos</h2>
        <button
          onClick={openCreateModal}
          className="flex items-center justify-center gap-1.5 rounded-md bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-800"
        >
          <Plus size={16} />
          Nuevo contacto
        </button>
      </div>

      <div className="mb-4 relative sm:max-w-xs">
        <Search
          size={15}
          className="absolute left-2.5 top-2.5 text-stone-400"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, teléfono o correo"
          className="w-full rounded-md border border-stone-300 py-2 pl-8 pr-3 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
        />
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-stone-400">Cargando...</p>}

      {!isLoading && filtered.length === 0 && (
        <EmptyState icon={Users} message="No hay contactos." />
      )}

      {!isLoading && filtered.length > 0 && (
        <>
          {/* Móvil: tarjetas apiladas en vez de tabla */}
          <div className="flex flex-col gap-2 sm:hidden">
            {filtered.map((contact) => (
              <div
                key={contact.id}
                className="rounded-lg border border-stone-200 bg-white p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-stone-900">
                      {contact.name || "—"}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-600">{contact.phone}</p>
                    {contact.email && (
                      <p className="truncate text-xs text-stone-500">{contact.email}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => openEditModal(contact)}
                      aria-label="Editar contacto"
                      className="rounded p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => handleDelete(contact.id)}
                      aria-label="Eliminar contacto"
                      className="rounded p-2 text-stone-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Escritorio/tablet: tabla tradicional */}
          <div className="hidden overflow-x-auto rounded-lg border border-stone-200 bg-white sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left text-xs text-stone-500">
                  <th className="px-4 py-2.5 font-medium">Nombre</th>
                  <th className="px-4 py-2.5 font-medium">Teléfono</th>
                  <th className="px-4 py-2.5 font-medium">Correo</th>
                  <th className="px-4 py-2.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((contact) => (
                  <tr
                    key={contact.id}
                    className="border-b border-stone-100 last:border-0"
                  >
                    <td className="px-4 py-2.5 text-stone-800">
                      {contact.name || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-stone-600">{contact.phone}</td>
                    <td className="px-4 py-2.5 text-stone-600">
                      {contact.email || "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openEditModal(contact)}
                          aria-label="Editar contacto"
                          className="rounded p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(contact.id)}
                          aria-label="Eliminar contacto"
                          className="rounded p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
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
    </div>
  );
}
