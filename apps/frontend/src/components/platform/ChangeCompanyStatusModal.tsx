'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { CompanyStatus } from '@/types';

type ApiError = {
  response?: {
    status?: number;
    data?: {
      message?: string | string[];
    };
  };
};

function extractErrorMessage(err: unknown, fallback: string): string {
  const response = (err as ApiError).response;
  if (response?.status === 403) return 'No tienes permiso para esta acción.';
  const message = response?.data?.message;
  return (Array.isArray(message) ? message[0] : message) || fallback;
}

const actionCopy: Record<
  CompanyStatus,
  {
    title: string;
    message: (name: string) => string;
    confirmLabel: string;
    confirmClass: string;
  }
> = {
  SUSPENDED: {
    title: 'Suspender empresa',
    message: (name) =>
      `¿Suspender "${name}"? Sus usuarios no podrán iniciar sesión mientras esté suspendida.`,
    confirmLabel: 'Suspender',
    confirmClass: 'bg-amber-600 hover:bg-amber-700',
  },
  ACTIVE: {
    title: 'Reactivar empresa',
    message: (name) => `¿Reactivar "${name}"?`,
    confirmLabel: 'Reactivar',
    confirmClass: 'bg-emerald-600 hover:bg-emerald-700',
  },
  DELETED: {
    title: 'Marcar empresa como eliminada',
    message: (name) =>
      `¿Marcar "${name}" como eliminada? No podrá reactivarse después.`,
    confirmLabel: 'Marcar eliminada',
    confirmClass: 'bg-red-600 hover:bg-red-700',
  },
};

interface ChangeCompanyStatusModalProps {
  companyName: string;
  targetStatus: CompanyStatus;
  onClose: () => void;
  onConfirm: (reason?: string) => Promise<void>;
}

export function ChangeCompanyStatusModal({
  companyName,
  targetStatus,
  onClose,
  onConfirm,
}: ChangeCompanyStatusModalProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const copy = actionCopy[targetStatus];

  async function handleConfirm() {
    setError('');
    setSaving(true);
    try {
      await onConfirm(reason.trim() || undefined);
    } catch (err) {
      setError(extractErrorMessage(err, 'Ocurrió un error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-900">
            {copy.title}
          </h3>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mb-4 text-sm text-stone-600">
          {copy.message(companyName)}
        </p>

        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-stone-600">
            Motivo (opcional)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Ej: falta de pago reportada"
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
          />
          <p className="mt-1 text-xs text-stone-400">
            Queda registrado en la auditoría de la plataforma. Máximo 500
            caracteres.
          </p>
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
            type="button"
            disabled={saving}
            onClick={handleConfirm}
            className={`rounded-md px-3 py-1.5 text-sm text-white disabled:opacity-50 ${copy.confirmClass}`}
          >
            {saving ? 'Guardando...' : copy.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
