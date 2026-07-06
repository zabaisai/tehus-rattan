'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

type ApiError = {
  response?: {
    data?: {
      message?: string | string[];
    };
  };
};

interface TaskModalProps {
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    description: string;
    dueDate: string;
    priority: string;
    type: string;
  }) => Promise<void>;
}

export function TaskModal({ onClose, onSubmit }: TaskModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [type, setType] = useState('TASK');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSubmit({ title, description, dueDate, priority, type });
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
          <h3 className="text-sm font-semibold text-stone-900">Nueva tarea</h3>
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

          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-stone-600">Tipo</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
            >
              <option value="TASK">Tarea</option>
              <option value="FOLLOW_UP">Seguimiento</option>
              <option value="CALL">Llamada</option>
              <option value="MEETING">Reunión</option>
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