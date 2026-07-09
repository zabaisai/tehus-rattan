'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { getLeads } from '@/lib/leads';
import { getContacts } from '@/lib/contacts';
import { getCompanyUsers } from '@/lib/users';
import { Task } from '@/types';

type ApiError = {
  response?: {
    data?: {
      message?: string | string[];
    };
  };
};

export interface TaskFormData {
  title: string;
  description: string;
  dueDate: string;
  priority: string;
  type: string;
  status: string;
  leadId: string;
  contactId: string;
  assignedTo: string;
}

interface TaskModalProps {
  task?: Task | null;
  onClose: () => void;
  onSubmit: (data: TaskFormData) => Promise<void>;
}

const typeLabels: Record<string, string> = {
  TASK: 'Tarea',
  FOLLOW_UP: 'Seguimiento',
  CALL: 'Llamada',
  MEETING: 'Reunión',
};

export function TaskModal({ task, onClose, onSubmit }: TaskModalProps) {
  const isEditing = !!task;

  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [dueDate, setDueDate] = useState(
    task?.dueDate ? task.dueDate.slice(0, 16) : '',
  );
  const [priority, setPriority] = useState<string>(task?.priority ?? 'MEDIUM');
  const [type] = useState<string>(task?.type ?? 'TASK');
  const [status, setStatus] = useState<string>(task?.status ?? 'PENDING');
  const [leadId, setLeadId] = useState(task?.leadId ?? '');
  const [contactId, setContactId] = useState(task?.contactId ?? '');
  const [assignedTo, setAssignedTo] = useState(task?.assignedTo ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const {
    data: leads,
    isLoading: loadingLeads,
    isError: leadsError,
  } = useQuery({ queryKey: ['leads'], queryFn: () => getLeads(), enabled: !isEditing });

  const {
    data: contacts,
    isLoading: loadingContacts,
    isError: contactsError,
  } = useQuery({ queryKey: ['contacts'], queryFn: getContacts, enabled: !isEditing });

  const { data: users, isError: usersError } = useQuery({
    queryKey: ['company-users'],
    queryFn: getCompanyUsers,
  });

  function handleLeadChange(newLeadId: string) {
    setLeadId(newLeadId);
    const selectedLead = leads?.find((l) => l.id === newLeadId);
    if (selectedLead?.contactId) {
      setContactId(selectedLead.contactId);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSubmit({
        title,
        description,
        dueDate,
        priority,
        type,
        status,
        leadId,
        contactId,
        assignedTo,
      });
    } catch (err) {
      const message = (err as ApiError).response?.data?.message;
      const errorMessage = Array.isArray(message) ? message[0] : message;
      setError(errorMessage || 'Ocurrió un error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-900">
            {isEditing ? 'Editar tarea' : 'Nueva tarea'}
          </h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-stone-600">Título</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Llamar al cliente"
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
            />
          </div>

          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-stone-600">Descripción</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
            />
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-600">Fecha límite</label>
              <input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-600">Prioridad</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
              >
                <option value="LOW">Baja</option>
                <option value="MEDIUM">Media</option>
                <option value="HIGH">Alta</option>
                <option value="URGENT">Urgente</option>
              </select>
            </div>
          </div>

          {!isEditing && (
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-stone-600">Tipo</label>
              <select
                value={type}
                disabled
                className="w-full rounded-md border border-stone-300 bg-stone-100 px-2 py-2 text-sm text-stone-500 outline-none"
              >
                <option value="TASK">Tarea</option>
                <option value="FOLLOW_UP">Seguimiento</option>
                <option value="CALL">Llamada</option>
                <option value="MEETING">Reunión</option>
              </select>
            </div>
          )}

          {isEditing && (
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-stone-600">Estado</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
              >
                <option value="PENDING">Pendiente</option>
                <option value="IN_PROGRESS">En progreso</option>
                <option value="COMPLETED">Completada</option>
                <option value="CANCELLED">Cancelada</option>
              </select>
            </div>
          )}

          {isEditing ? (
            <div className="mb-3 rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-500">
              <p>
                Tipo: <span className="text-stone-700">{typeLabels[type] ?? type}</span>
              </p>
              <p className="mt-0.5">
                Lead: <span className="text-stone-700">{task?.lead?.title ?? 'Sin vincular'}</span>
              </p>
              <p className="mt-0.5">
                Contacto: <span className="text-stone-700">{task?.contact?.name ?? 'Sin vincular'}</span>
              </p>
              <p className="mt-1 text-[11px] text-stone-400">
                El lead y el contacto de una tarea no se pueden cambiar después de creada.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-stone-600">Lead relacionado</label>
                {leadsError ? (
                  <p className="text-xs text-red-600">No se pudieron cargar los leads.</p>
                ) : (
                  <select
                    value={leadId}
                    onChange={(e) => handleLeadChange(e.target.value)}
                    disabled={loadingLeads}
                    className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 disabled:bg-stone-100"
                  >
                    <option value="">
                      {loadingLeads ? 'Cargando leads...' : 'Sin lead (tarea general)'}
                    </option>
                    {leads?.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.title}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-stone-600">Contacto relacionado</label>
                {contactsError ? (
                  <p className="text-xs text-red-600">No se pudieron cargar los contactos.</p>
                ) : (
                  <select
                    value={contactId}
                    onChange={(e) => setContactId(e.target.value)}
                    disabled={loadingContacts}
                    className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 disabled:bg-stone-100"
                  >
                    <option value="">
                      {loadingContacts ? 'Cargando contactos...' : 'Sin contacto (tarea interna)'}
                    </option>
                    {contacts?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name || c.phone}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </>
          )}

          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-stone-600">Responsable</label>
            {usersError ? (
              <p className="text-xs text-red-600">No se pudieron cargar los usuarios.</p>
            ) : (
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
              >
                <option value="">Sin asignar</option>
                {users
                  ?.filter((u) => u.isActive)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            )}
            {isEditing && !assignedTo && task?.assignedTo && (
              <p className="mt-1 text-[11px] text-stone-400">
                Esta tarea ya tiene responsable asignado; el backend no permite quitarlo, solo reasignarlo.
              </p>
            )}
          </div>

          {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-800 disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
