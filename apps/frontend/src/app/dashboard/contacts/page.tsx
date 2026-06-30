'use client';

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2, Pencil } from 'lucide-react';
import { getContacts, createContact, updateContact, deleteContact } from '@/lib/contacts';
import { Contact } from '@/types';
import { ContactModal } from '@/components/contacts/ContactModal';

export default function ContactsPage() {
  const queryClient = useQueryClient();
  const { data: contacts, isLoading } = useQuery({
    queryKey: ['contacts'],
    queryFn: getContacts,
  });

  const [search, setSearch] = useState('');
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

  async function handleSubmit(data: { phone: string; name: string; email: string }) {
    if (editingContact) {
      await updateContact(editingContact.id, { name: data.name, email: data.email || undefined });
    } else {
      await createContact({
        phone: data.phone,
        name: data.name || undefined,
        email: data.email || undefined,
      });
    }
    await queryClient.invalidateQueries({ queryKey: ['contacts'] });
    setModalOpen(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este contacto?')) return;
    await deleteContact(id);
    await queryClient.invalidateQueries({ queryKey: ['contacts'] });
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-stone-900">Contactos</h2>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-1.5 rounded-md bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-800"
        >
          <Plus size={16} />
          Nuevo contacto
        </button>
      </div>

      <div className="mb-4 relative max-w-xs">
        <Search size={15} className="absolute left-2.5 top-2.5 text-stone-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, teléfono o correo"
          className="w-full rounded-md border border-stone-300 py-2 pl-8 pr-3 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
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
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-stone-400">
                  Cargando...
                </td>
              </tr>
            )}

            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-stone-400">
                  No hay contactos.
                </td>
              </tr>
            )}

            {filtered.map((contact) => (
              <tr key={contact.id} className="border-b border-stone-100 last:border-0">
                <td className="px-4 py-2.5 text-stone-800">{contact.name || '—'}</td>
                <td className="px-4 py-2.5 text-stone-600">{contact.phone}</td>
                <td className="px-4 py-2.5 text-stone-600">{contact.email || '—'}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => openEditModal(contact)}
                      className="rounded p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(contact.id)}
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

      {modalOpen && (
        <ContactModal
          contact={editingContact}
          onClose={() => setModalOpen(false)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}