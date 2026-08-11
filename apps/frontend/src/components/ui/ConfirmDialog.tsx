'use client';

import { useState } from 'react';
import { Modal } from './Modal';
import { Button, VarianteBoton } from './Button';

interface ConfirmDialogProps {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  /**
   * Tono del botón de confirmar. Es una VARIANTE y no una cadena de clases: si
   * la pantalla pasara `bg-…` suelto, competiría con el `bg-…` de la variante
   * y ganaría el que quedara más abajo en el CSS compilado, no el que se
   * escribió después.
   */
  confirmVariant?: VarianteBoton;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/** Confirmation gate for destructive platform actions (session/device revocation, etc). */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  confirmVariant = 'danger',
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
      <div className="text-sm text-content-secondary">{message}</div>

      {/* `role="alert"`: el fallo aparece después de pulsar confirmar, y sin
          esto un lector de pantalla no lo menciona nunca. */}
      {error && (
        <p role="alert" className="mt-3 text-xs font-medium text-status-error">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="quiet" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        {/* Destructivo por defecto: este diálogo solo aparece delante de
            acciones que no se pueden deshacer. */}
        <Button
          variant={confirmVariant}
          onClick={handleConfirm}
          disabled={saving}
        >
          {saving ? 'Procesando...' : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
