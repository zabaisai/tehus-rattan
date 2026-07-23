'use client';

import { useState } from 'react';
import { createSupportSession } from '@/lib/platform';
import { PlatformSupportSession } from '@/types';
import { Modal } from '@/components/ui/Modal';

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
  if (response?.status === 409)
    return 'Ya existe una sesión de soporte activa para esta empresa.';
  const message = response?.data?.message;
  return (Array.isArray(message) ? message[0] : message) || fallback;
}

const REASON_MAX_LENGTH = 500;

interface StartSupportSessionModalProps {
  companyId: string;
  companyName: string;
  onClose: () => void;
  onCreated: (session: PlatformSupportSession) => void;
}

export function StartSupportSessionModal({
  companyId,
  companyName,
  onClose,
  onCreated,
}: StartSupportSessionModalProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const trimmedReason = reason.trim();
  const isValid = trimmedReason.length > 0 && trimmedReason.length <= REASON_MAX_LENGTH;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) {
      setError('El motivo de soporte es obligatorio.');
      return;
    }

    setError('');
    setSaving(true);
    try {
      const session = await createSupportSession({
        companyId,
        reason: trimmedReason,
      });
      onCreated(session);
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo iniciar la sesión de soporte'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Iniciar soporte para "${companyName}"`}
      onClose={onClose}
      maxWidth="sm"
      stackedZIndex
    >
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-stone-600">
              Motivo de soporte
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={REASON_MAX_LENGTH}
              rows={4}
              required
              placeholder="Ej: cliente pidió soporte para revisar un caso puntual"
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
            />
            <p className="mt-1 text-xs text-stone-400">
              Obligatorio. Queda registrado en la auditoría de la plataforma.
              Máximo {REASON_MAX_LENGTH} caracteres ({trimmedReason.length}/
              {REASON_MAX_LENGTH}).
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
              type="submit"
              disabled={saving || !isValid}
              className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-800 disabled:opacity-50"
            >
              {saving ? 'Iniciando...' : 'Iniciar soporte'}
            </button>
          </div>
        </form>
    </Modal>
  );
}
