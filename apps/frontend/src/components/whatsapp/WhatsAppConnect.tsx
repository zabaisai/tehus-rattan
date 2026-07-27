'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, ShieldCheck, Check, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import {
  completeEmbeddedSignup,
  disconnectWhatsAppIntegration,
  getWhatsAppConnectionStatus,
  reconnectWhatsApp,
  startEmbeddedSignup,
  type WhatsAppConnectionStatus,
} from '@/lib/whatsapp';
import {
  EmbeddedSignupError,
  launchEmbeddedSignup,
  loadFacebookSdk,
} from '@/lib/meta-sdk';
import { ManualConnectionSection } from './ManualConnectionSection';

const STEPS = [
  'Abriendo Meta',
  'Verificando cuenta',
  'Asociando número',
  'Configurando webhook',
  'Conexión completada',
] as const;

const STATUS_LABEL: Record<string, string> = {
  CONNECTED: 'Conectado',
  CONNECTING: 'Conectando',
  REAUTH_REQUIRED: 'Requiere reconexión',
  DISCONNECTED: 'Desconectado',
  REVOKED: 'Revocado',
  ERROR: 'Error',
  NOT_CONNECTED: 'No conectado',
};

const STATUS_PILL: Record<string, string> = {
  CONNECTED: 'bg-emerald-50 text-emerald-700',
  CONNECTING: 'bg-amber-50 text-amber-700',
  REAUTH_REQUIRED: 'bg-amber-50 text-amber-700',
  DISCONNECTED: 'bg-stone-100 text-stone-600',
  REVOKED: 'bg-red-50 text-red-700',
  ERROR: 'bg-red-50 text-red-700',
  NOT_CONNECTED: 'bg-stone-100 text-stone-600',
};

function mapError(err: unknown): string {
  if (err instanceof EmbeddedSignupError) {
    switch (err.code) {
      case 'CANCELLED':
        return 'Cancelaste la conexión con Meta.';
      case 'SDK_LOAD_FAILED':
        return 'No se pudo abrir el conector de Meta. Revisa tu conexión o el bloqueador de ventanas emergentes e inténtalo de nuevo.';
      case 'NO_CODE':
        return 'No se recibió la autorización de Meta. Inténtalo de nuevo.';
      case 'INCOMPLETE_SESSION':
        return 'No se pudo leer el número desde Meta. Verifica que seleccionaste un número elegible e inténtalo de nuevo.';
    }
  }
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 409)
    return 'Este número de WhatsApp ya está conectado a otra empresa.';
  if (status === 403) return 'No tienes permiso para esta acción.';
  if (status === 503)
    return 'La conexión con Meta no está disponible en este momento.';
  return 'No se pudo completar la conexión. Inténtalo de nuevo.';
}

export function WhatsAppConnect() {
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const queryClient = useQueryClient();

  const { data: status, isLoading, isError } = useQuery({
    queryKey: ['whatsapp-connection-status'],
    queryFn: getWhatsAppConnectionStatus,
  });

  const [step, setStep] = useState<number>(-1); // -1 = idle
  const [flowError, setFlowError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runFlow = async (start: typeof startEmbeddedSignup) => {
    setFlowError(null);
    setBusy(true);
    setStep(0);
    try {
      const cfg = await start();
      const fb = await loadFacebookSdk(cfg.appId, cfg.graphVersion);
      setStep(1);
      const result = await launchEmbeddedSignup(fb, cfg.configId);
      setStep(2);
      await completeEmbeddedSignup({
        state: cfg.state,
        code: result.code,
        phoneNumberId: result.phoneNumberId,
        wabaId: result.wabaId,
        businessId: result.businessId,
      });
      setStep(STEPS.length); // all done
      await queryClient.invalidateQueries({ queryKey: ['whatsapp-connection-status'] });
      await queryClient.invalidateQueries({ queryKey: ['whatsapp-integration'] });
    } catch (err) {
      setFlowError(mapError(err));
      setStep(-1);
    } finally {
      setBusy(false);
    }
  };

  const [disconnecting, setDisconnecting] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const handleDisconnect = async () => {
    const ok = window.confirm(
      'Esto desconectará WhatsApp localmente en el CRM. No revoca el acceso en Meta. ¿Deseas continuar?',
    );
    if (!ok) return;
    setDisconnecting(true);
    setActionMsg(null);
    try {
      await disconnectWhatsAppIntegration();
      setActionMsg('WhatsApp desconectado en el CRM.');
      await queryClient.invalidateQueries({ queryKey: ['whatsapp-connection-status'] });
      await queryClient.invalidateQueries({ queryKey: ['whatsapp-integration'] });
    } catch (err) {
      setActionMsg(mapError(err));
    } finally {
      setDisconnecting(false);
    }
  };

  if (isLoading) {
    return <p className="text-sm text-stone-400">Cargando estado de WhatsApp…</p>;
  }
  if (isError || !status) {
    return (
      <p className="text-sm text-red-600">
        No se pudo cargar el estado de WhatsApp.
      </p>
    );
  }

  const connected = status.status === 'CONNECTED';
  const inProgress = step >= 0 && step < STEPS.length;

  return (
    <div className="space-y-6">
      {connected ? (
        <ConnectedView
          status={status}
          onReconnect={() => runFlow(reconnectWhatsApp)}
          onDisconnect={handleDisconnect}
          busy={busy}
          disconnecting={disconnecting}
          actionMsg={actionMsg}
        />
      ) : (
        <DisconnectedView
          status={status}
          onConnect={() => runFlow(startEmbeddedSignup)}
          busy={busy}
          inProgress={inProgress}
          step={step}
          error={flowError}
        />
      )}

      {isSuperAdmin && (
        <ManualConnectionSection
          onChanged={() => {
            queryClient.invalidateQueries({ queryKey: ['whatsapp-connection-status'] });
            queryClient.invalidateQueries({ queryKey: ['whatsapp-integration'] });
          }}
        />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL[status] ?? 'bg-stone-100 text-stone-600'}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function DisconnectedView({
  status,
  onConnect,
  busy,
  inProgress,
  step,
  error,
}: {
  status: WhatsAppConnectionStatus;
  onConnect: () => void;
  busy: boolean;
  inProgress: boolean;
  step: number;
  error: string | null;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-6">
      <div className="flex items-start gap-3">
        <span className="rounded-full bg-emerald-50 p-2 text-emerald-600">
          <MessageCircle className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h3 className="text-base font-semibold text-stone-900">
            Conecta tu WhatsApp Business
          </h3>
          <p className="mt-1 text-sm text-stone-500">
            Conserva tu número de WhatsApp Business y administra las
            conversaciones desde el CRM.
          </p>
        </div>
        <div className="ml-auto">
          <StatusPill status={status.status} />
        </div>
      </div>

      {inProgress ? (
        <ol className="mt-6 space-y-2" aria-label="Progreso de la conexión">
          {STEPS.map((label, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <li key={label} className="flex items-center gap-2 text-sm">
                {done ? (
                  <Check className="h-4 w-4 text-emerald-600" aria-hidden />
                ) : active ? (
                  <Loader2 className="h-4 w-4 animate-spin text-stone-500" aria-hidden />
                ) : (
                  <span className="h-4 w-4 rounded-full border border-stone-300" aria-hidden />
                )}
                <span className={done ? 'text-stone-500' : active ? 'text-stone-800' : 'text-stone-400'}>
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="mt-6">
          <button
            type="button"
            onClick={onConnect}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            Conectar con Meta
          </button>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-stone-400">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            La autenticación se realiza de forma segura con Meta. No necesitas
            copiar tokens ni identificadores.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ConnectedView({
  status,
  onReconnect,
  onDisconnect,
  busy,
  disconnecting,
  actionMsg,
}: {
  status: WhatsAppConnectionStatus;
  onReconnect: () => void;
  onDisconnect: () => void;
  busy: boolean;
  disconnecting: boolean;
  actionMsg: string | null;
}) {
  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleString('es-CO') : '—';
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-6">
      <div className="flex items-center gap-3">
        <h3 className="text-base font-semibold text-stone-900">
          WhatsApp Business conectado
        </h3>
        <StatusPill status={status.status} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Número" value={status.maskedPhoneNumber ?? '—'} />
        <Field label="Nombre comercial" value={status.businessName ?? '—'} />
        <Field
          label="Método"
          value={
            status.connectionMethod === 'COEXISTENCE'
              ? 'Coexistencia (App + API)'
              : status.connectionMethod === 'EMBEDDED_SIGNUP'
                ? 'Meta Embedded Signup'
                : 'Manual'
          }
        />
        <Field label="Conectado desde" value={fmt(status.connectedAt)} />
        <Field label="Última comprobación" value={fmt(status.lastCheckedAt)} />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onReconnect}
          disabled={busy}
          className="rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50"
        >
          Reconectar
        </button>
        <button
          type="button"
          onClick={onDisconnect}
          disabled={disconnecting}
          className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {disconnecting ? 'Desconectando…' : 'Desconectar'}
        </button>
      </div>

      <p className="mt-3 text-xs text-stone-400">
        La desconexión solo cambia el estado local en el CRM; no revoca el acceso
        en Meta. Los tokens nunca se muestran en esta pantalla.
      </p>
      {actionMsg && <p className="mt-2 text-xs text-emerald-600">{actionMsg}</p>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-stone-500">{label}</p>
      <p className="text-sm text-stone-800">{value}</p>
    </div>
  );
}
