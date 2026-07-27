'use client';

import { useState } from 'react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  confirmClassName?: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

const DEFAULT_CONFIRM_CLASS = 'bg-red-600 hover:bg-red-700';

/** Confirmation gate for destructive platform actions (session/device revocation, etc). */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  confirmClassName = DEFAULT_CONFIRM_CLASS,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm() {
    setError('');
    setSaving(true);
    try {
      await onConfirm();
    } catch {
      setError('No se pudo completar la acción. Intenta de nuevo.');
      setSaving(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} maxWidth="sm" stackedZIndex>
      <div className="text-sm text-stone-600">{message}</div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded-md px-3 py-2 text-sm text-stone-600 hover:bg-stone-100 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={saving}
          className={`rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50 ${confirmClassName}`}
        >
          {saving ? 'Procesando...' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
