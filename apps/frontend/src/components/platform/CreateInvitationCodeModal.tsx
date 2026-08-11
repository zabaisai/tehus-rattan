'use client';

import { useState } from 'react';
import { Copy, Check, AlertTriangle } from 'lucide-react';
import { createInvitationCode } from '@/lib/invitation-codes';
import { CreateInvitationCodeResult } from '@/types';
import { Modal } from '@/components/ui/Modal';

type ApiError = {
  response?: {
    status?: number;
    data?: { message?: string | string[] };
  };
};

function extractErrorMessage(err: unknown, fallback: string): string {
  const response = (err as ApiError).response;
  if (response?.status === 403) return 'No tienes permiso para esta acción.';
  const message = response?.data?.message;
  return (Array.isArray(message) ? message[0] : message) || fallback;
}

interface CreateInvitationCodeModalProps {
  onClose: () => void;
  onCreated: () => void;
}

export function CreateInvitationCodeModal({
  onClose,
  onCreated,
}: CreateInvitationCodeModalProps) {
  const [companyName, setCompanyName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<CreateInvitationCodeResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [confirmedCopy, setConfirmedCopy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const result = await createInvitationCode({
        intendedCompanyName: companyName.trim(),
        intendedContactEmail: contactEmail.trim() || undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      setCreated(result);
      onCreated();
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo generar el código'));
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.code);
      setCopied(true);
      setCopyError('');
    } catch {
      // The clipboard API can be denied by browser permission policy — the
      // admin is still holding a one-time secret, so they must be told to
      // select and copy it manually instead of getting silence.
      setCopyError('No se pudo copiar automáticamente. Selecciona y copia el código manualmente.');
    }
  }

  function handleClose() {
    // Once a code has been generated, force an explicit "ya lo copié"
    // confirmation before letting the modal close — the plaintext is never
    // shown again after this.
    if (created && !confirmedCopy) return;
    onClose();
  }

  return (
    <Modal
      title={created ? 'Código generado' : 'Generar código de invitación'}
      onClose={handleClose}
      maxWidth="sm"
      hideCloseButton={!!created && !confirmedCopy}
    >
        {!created && (
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-neutral-600">
                Nombre de la empresa invitada
              </label>
              <input
                type="text"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Nombre de la empresa"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
              />
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-neutral-600">
                Correo de contacto (opcional)
              </label>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="contacto@empresa.com"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
              />
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-neutral-600">
                Fecha de vencimiento (opcional)
              </label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
              />
              <p className="mt-1 text-xs text-neutral-400">
                Déjalo vacío para que el código no venza.
              </p>
            </div>

            {error && <p className="mb-3 text-xs text-status-error">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-brand-primary px-3 py-1.5 text-sm text-white hover:bg-primary-900 disabled:opacity-50"
              >
                {saving ? 'Generando...' : 'Generar código'}
              </button>
            </div>
          </form>
        )}

        {created && (
          <div>
            <div className="mb-3 flex items-start gap-2 rounded-md border border-status-warning/20 bg-status-warning-surface p-2.5">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-status-warning-strong" />
              <p className="text-xs text-status-warning-strong">
                Este código completo no podrá consultarse nuevamente. Cópialo y
                entrégalo ahora a{' '}
                <span className="font-medium">{created.intendedCompanyName}</span>{' '}
                por un canal seguro.
              </p>
            </div>

            <div className="mb-4 flex items-center gap-2 rounded-md border border-neutral-300 bg-neutral-50 p-3">
              <code className="flex-1 break-all text-sm font-semibold text-neutral-900">
                {created.code}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                className="flex shrink-0 items-center gap-1 rounded-md bg-brand-primary px-2.5 py-1.5 text-xs text-white hover:bg-primary-900"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>

            {copyError && <p className="mb-3 text-xs text-status-error">{copyError}</p>}

            <label className="mb-4 flex items-start gap-2 text-xs text-neutral-600">
              <input
                type="checkbox"
                checked={confirmedCopy}
                onChange={(e) => setConfirmedCopy(e.target.checked)}
                className="mt-0.5"
              />
              Ya copié el código y confirmo que no podré verlo de nuevo.
            </label>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleClose}
                disabled={!confirmedCopy}
                className="rounded-md bg-brand-primary px-3 py-1.5 text-sm text-white hover:bg-primary-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
    </Modal>
  );
}
