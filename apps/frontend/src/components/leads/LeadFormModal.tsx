'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { getContacts } from '@/lib/contacts';
import { getCompanyUsers } from '@/lib/users';
import { createLead } from '@/lib/leads';
import { PipelineStage } from '@/types';

type ApiError = {
  response?: {
    data?: {
      message?: string | string[];
    };
  };
};

interface LeadFormModalProps {
  pipelineId: string;
  stages: PipelineStage[];
  onClose: () => void;
  onCreated: () => void;
}

export function LeadFormModal({ pipelineId, stages, onClose, onCreated }: LeadFormModalProps) {
  const sortedStages = [...stages].sort((a, b) => a.order - b.order);

  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState('');
  const [stageId, setStageId] = useState(sortedStages[0]?.id ?? '');
  const [value, setValue] = useState('');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: contacts, isLoading: loadingContacts } = useQuery({
    queryKey: ['contacts'],
    queryFn: getContacts,
  });

  const { data: users } = useQuery({
    queryKey: ['company-users'],
    queryFn: getCompanyUsers,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!contactId) {
      setError('Selecciona un contacto');
      return;
    }
    if (!stageId) {
      setError('Selecciona una etapa');
      return;
    }

    setSaving(true);
    try {
      await createLead({
        title,
        contactId,
        pipelineId,
        stageId,
        value: value ? Number(value) : undefined,
        expectedCloseDate: expectedCloseDate
          ? new Date(expectedCloseDate).toISOString()
          : undefined,
        assignedTo: assignedTo || undefined,
      });
      onCreated();
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
          <h3 className="text-sm font-semibold text-stone-900">Nuevo lead</h3>
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
              placeholder="Venta de muebles de rattan"
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
            />
          </div>

          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-stone-600">Contacto</label>
            <select
              required
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              disabled={loadingContacts}
              className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 disabled:bg-stone-100"
            >
              <option value="">
                {loadingContacts ? 'Cargando contactos...' : 'Selecciona un contacto'}
              </option>
              {contacts?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.phone}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-stone-600">Etapa</label>
            <select
              required
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
              className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
            >
              {sortedStages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-600">Valor</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0"
                className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-600">Cierre esperado</label>
              <input
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
                className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-stone-600">Responsable</label>
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
