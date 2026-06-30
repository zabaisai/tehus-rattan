'use client';

import { useAuthStore } from '@/store/auth.store';

export default function DashboardHomePage() {
  const user = useAuthStore((s) => s.user);

  return (
    <div>
      <h2 className="text-xl font-semibold text-stone-900">
        Hola, {user?.name ?? ''}
      </h2>
      <p className="mt-1 text-sm text-stone-500">
        Bienvenido al CRM de Tehus Rattan.
      </p>
    </div>
  );
}