'use client';

import { useState } from 'react';
import { CompanyStatus } from '@/types';
import { Modal } from '@/components/ui/Modal';
import { Button, VarianteBoton } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Textarea } from '@/components/ui/Textarea';

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

// El tono sale de la VARIANTE del botón, no de una cadena de clases suelta.
// Escrito como clases, `bg-…` de la variante y `bg-…` de la pantalla acaban
// compitiendo en el CSS compilado y gana el que esté más abajo en el archivo,
// no el que se escribió después.
const actionCopy: Record<
  CompanyStatus,
  {
    title: string;
    message: (name: string) => string;
    confirmLabel: string;
    confirmVariant: VarianteBoton;
  }
> = {
  SUSPENDED: {
    title: 'Suspender empresa',
    message: (name) =>
      `¿Suspender "${name}"? Sus usuarios no podrán iniciar sesión mientras esté suspendida.`,
    confirmLabel: 'Suspender',
    confirmVariant: 'warning',
  },
  ACTIVE: {
    title: 'Reactivar empresa',
    message: (name) => `¿Reactivar "${name}"?`,
    confirmLabel: 'Reactivar',
    confirmVariant: 'success',
  },
  DELETED: {
    title: 'Marcar empresa como eliminada',
    message: (name) =>
      `¿Marcar "${name}" como eliminada? No podrá reactivarse después.`,
    confirmLabel: 'Marcar eliminada',
    confirmVariant: 'danger',
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
    <Modal title={copy.title} onClose={onClose} maxWidth="sm">
        <p className="mb-4 text-sm text-neutral-600">
          {copy.message(companyName)}
        </p>

        <Field
          label="Motivo (opcional)"
          hint="Queda registrado en la auditoría de la plataforma. Máximo 500 caracteres."
          className="mb-4"
        >
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Ej: falta de pago reportada"
          />
        </Field>

        {error && (
          <p role="alert" className="mb-3 text-xs text-status-error">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose} className="px-3 py-1.5">
            Cancelar
          </Button>
          <Button
            variant={copy.confirmVariant}
            disabled={saving}
            onClick={handleConfirm}
            className="px-3 py-1.5"
          >
            {saving ? 'Guardando...' : copy.confirmLabel}
          </Button>
        </div>
    </Modal>
  );
}
