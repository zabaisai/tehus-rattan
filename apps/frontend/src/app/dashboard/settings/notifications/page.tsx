'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CATEGORY_LABELS,
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationCategory,
} from '@/lib/notifications';

// Categories that can also send email (mirrors the backend EMAIL_ELIGIBLE set);
// the email toggle is only shown for these.
const EMAIL_ELIGIBLE = new Set(['SECURITY', 'WHATSAPP', 'TASK']);

export default function NotificationPreferencesPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: getNotificationPreferences,
  });

  // Only the user's pending edits are kept in local state; the displayed value
  // is the server value overlaid with any edit. This avoids syncing query data
  // into state inside an effect (which triggers cascading renders).
  type Edit = { inAppEnabled?: boolean; emailEnabled?: boolean };
  const [edits, setEdits] = useState<Partial<Record<NotificationCategory, Edit>>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const valueOf = (
    category: NotificationCategory,
    field: 'inAppEnabled' | 'emailEnabled',
  ): boolean => {
    const edited = edits[category]?.[field];
    if (edited !== undefined) return edited;
    return data?.find((p) => p.category === category)?.[field] ?? false;
  };

  const toggle = (
    category: NotificationCategory,
    field: 'inAppEnabled' | 'emailEnabled',
    value: boolean,
  ) => {
    setEdits((prev) => ({
      ...prev,
      [category]: { ...prev[category], [field]: value },
    }));
  };

  const save = async () => {
    if (!data) return;
    setSaving(true);
    setMessage(null);
    try {
      await updateNotificationPreferences(
        data.map((p) => ({
          category: p.category,
          inAppEnabled: valueOf(p.category, 'inAppEnabled'),
          emailEnabled: valueOf(p.category, 'emailEnabled'),
        })),
      );
      setEdits({});
      setMessage({ ok: true, text: 'Preferencias guardadas.' });
    } catch {
      setMessage({ ok: false, text: 'No se pudieron guardar las preferencias.' });
    } finally {
      setSaving(false);
    }
  };

  const prefs = data ?? [];

  return (
    <div>
      <h2 className="text-xl font-semibold text-stone-900">Notificaciones</h2>
      <p className="mt-1 text-sm text-stone-500">
        Elige cómo quieres recibir cada tipo de alerta. El correo solo está
        disponible para categorías importantes.
      </p>

      <div className="mt-6 overflow-hidden rounded-lg border border-stone-200 bg-white">
        {isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-stone-400">Cargando…</p>
        ) : isError ? (
          <p className="px-4 py-10 text-center text-sm text-red-600">
            No se pudieron cargar las preferencias.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 text-left text-xs text-stone-500">
                <th className="px-4 py-2 font-medium">Categoría</th>
                <th className="px-4 py-2 text-center font-medium">En la app</th>
                <th className="px-4 py-2 text-center font-medium">Correo</th>
              </tr>
            </thead>
            <tbody>
              {prefs.map((p) => (
                <tr key={p.category} className="border-b border-stone-50">
                  <td className="px-4 py-2.5 text-stone-800">
                    {CATEGORY_LABELS[p.category]}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <input
                      type="checkbox"
                      aria-label={`En la app: ${CATEGORY_LABELS[p.category]}`}
                      checked={valueOf(p.category, 'inAppEnabled')}
                      onChange={(e) => toggle(p.category, 'inAppEnabled', e.target.checked)}
                      className="h-4 w-4 accent-stone-900"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {EMAIL_ELIGIBLE.has(p.category) ? (
                      <input
                        type="checkbox"
                        aria-label={`Correo: ${CATEGORY_LABELS[p.category]}`}
                        checked={valueOf(p.category, 'emailEnabled')}
                        onChange={(e) => toggle(p.category, 'emailEnabled', e.target.checked)}
                        className="h-4 w-4 accent-stone-900"
                      />
                    ) : (
                      <span className="text-xs text-stone-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || isLoading || isError}
          className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar preferencias'}
        </button>
        {message && (
          <span className={`text-sm ${message.ok ? 'text-emerald-600' : 'text-red-600'}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
