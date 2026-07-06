'use client';

import { useState } from 'react';
import { connectOrUpdateWhatsAppIntegration } from '@/lib/whatsapp';
import { WhatsAppIntegration } from '@/types';

interface WhatsAppIntegrationFormProps {
  integration: WhatsAppIntegration | null;
  onSuccess: () => void;
}

export function WhatsAppIntegrationForm({
  integration,
  onSuccess,
}: WhatsAppIntegrationFormProps) {
  const [phoneNumberId, setPhoneNumberId] = useState(
    integration?.phoneNumberId ?? '',
  );
  const [accessToken, setAccessToken] = useState('');
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState(
    integration?.displayPhoneNumber ?? '',
  );
  const [wabaId, setWabaId] = useState(integration?.wabaId ?? '');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsSubmitting(true);
    try {
      await connectOrUpdateWhatsAppIntegration({
        phoneNumberId: phoneNumberId.trim(),
        accessToken: accessToken.trim(),
        displayPhoneNumber: displayPhoneNumber.trim() || undefined,
        wabaId: wabaId.trim() || undefined,
      });
      setAccessToken('');
      setSuccess(
        integration
          ? 'Integración actualizada correctamente.'
          : 'WhatsApp conectado correctamente.',
      );
      onSuccess();
    } catch (err) {
      const response = (
        err as {
          response?: {
            status?: number;
            data?: { message?: string | string[] };
          };
        }
      )?.response;

      if (response?.status === 403) {
        setError('No tienes permiso para esta acción.');
      } else {
        const message = response?.data?.message;
        setError(
          (Array.isArray(message) ? message[0] : message) ||
            'Ocurrió un error',
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-stone-600">
          Phone Number ID
        </label>
        <input
          type="text"
          required
          value={phoneNumberId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          placeholder="ID de Meta"
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-stone-600">
          Access Token
        </label>
        <input
          type="password"
          required
          autoComplete="off"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder="Token de acceso de Meta"
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
        />
        <p className="mt-1 text-xs text-stone-400">
          Por seguridad, el token nunca se muestra ni se guarda en el
          navegador. Para actualizar la integración debes pegarlo nuevamente.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-stone-600">
          Número visible
        </label>
        <input
          type="text"
          value={displayPhoneNumber}
          onChange={(e) => setDisplayPhoneNumber(e.target.value)}
          placeholder="+573001234567"
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-stone-600">
          WABA ID
        </label>
        <input
          type="text"
          value={wabaId}
          onChange={(e) => setWabaId(e.target.value)}
          placeholder="WhatsApp Business Account ID"
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {success && <p className="text-xs text-emerald-600">{success}</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-800 disabled:opacity-50"
        >
          {isSubmitting
            ? 'Guardando...'
            : integration
              ? 'Actualizar integración'
              : 'Conectar WhatsApp'}
        </button>
      </div>
    </form>
  );
}
