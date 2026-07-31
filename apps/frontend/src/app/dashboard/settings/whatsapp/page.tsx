'use client';

import { useAuthStore } from '@/store/auth.store';
import { WhatsAppConnect } from '@/components/whatsapp/WhatsAppConnect';

export default function WhatsAppSettingsPage() {
  const user = useAuthStore((s) => s.user);
  const canManage = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  return (
    <div>
      <h2 className="text-xl font-semibold text-neutral-900">WhatsApp</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Conecta y administra WhatsApp Business para tu empresa.
      </p>

      {!canManage ? (
        <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
          <p className="text-sm text-neutral-600">
            No tienes permiso para administrar WhatsApp.
          </p>
        </div>
      ) : (
        <div className="mt-6">
          <WhatsAppConnect />
        </div>
      )}
    </div>
  );
}
