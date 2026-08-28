'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MessageCircle,
  ShieldCheck,
  Check,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import {
  completeEmbeddedSignup,
  disconnectWhatsAppIntegration,
  getWhatsAppConnectionStatus,
  reconnectWhatsApp,
  startEmbeddedSignup,
  testWhatsAppConnection,
  type WhatsAppConnectionStatus,
} from '@/lib/whatsapp';
import {
  EmbeddedSignupError,
  launchEmbeddedSignup,
  loadFacebookSdk,
  type EmbeddedSignupMode,
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
  CONNECTED: 'bg-status-success-surface text-status-success-strong',
  CONNECTING: 'bg-status-warning-surface text-status-warning-strong',
  REAUTH_REQUIRED: 'bg-status-warning-surface text-status-warning-strong',
  DISCONNECTED: 'bg-neutral-100 text-neutral-600',
  REVOKED: 'bg-status-error-surface text-status-error',
  ERROR: 'bg-status-error-surface text-status-error',
  NOT_CONNECTED: 'bg-neutral-100 text-neutral-600',
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
      case 'TIMEOUT':
        return 'La conexión con Meta no terminó a tiempo. Cierra la ventana de Meta e inténtalo de nuevo.';
      case 'META_ERROR':
        return 'Meta informó un error durante la conexión. Verifica que el número sea elegible e inténtalo de nuevo.';
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

  const runFlow = async (
    start: typeof startEmbeddedSignup,
    mode: EmbeddedSignupMode,
  ) => {
    setFlowError(null);
    setBusy(true);
    setStep(0);
    try {
      const cfg = await start();
      const fb = await loadFacebookSdk(cfg.appId, cfg.graphVersion);
      setStep(1);
      const result = await launchEmbeddedSignup(fb, cfg.configId, mode);
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

  const handleTest = async (to: string): Promise<string> => {
    try {
      await testWhatsAppConnection(to);
      return 'Mensaje de prueba enviado. Revisa el teléfono de destino.';
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 400)
        return 'No se pudo enviar. El número debe tener formato E.164 y existir una conversación abierta (24 h) con Meta.';
      return mapError(err);
    }
  };

  if (isLoading) {
    return <p className="text-sm text-neutral-400">Cargando estado de WhatsApp…</p>;
  }
  if (isError || !status) {
    return (
      <p className="text-sm text-status-error">
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
          onReconnect={() =>
            runFlow(
              reconnectWhatsApp,
              status.coexistence ? 'COEXISTENCE' : 'STANDARD',
            )
          }
          onDisconnect={handleDisconnect}
          onTest={handleTest}
          busy={busy}
          disconnecting={disconnecting}
          actionMsg={actionMsg}
        />
      ) : (
        <DisconnectedView
          status={status}
          onConnectExisting={() => runFlow(startEmbeddedSignup, 'COEXISTENCE')}
          onConnectNew={() => runFlow(startEmbeddedSignup, 'STANDARD')}
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
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL[status] ?? 'bg-neutral-100 text-neutral-600'}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function DisconnectedView({
  status,
  onConnectExisting,
  onConnectNew,
  busy,
  inProgress,
  step,
  error,
}: {
  status: WhatsAppConnectionStatus;
  onConnectExisting: () => void;
  onConnectNew: () => void;
  busy: boolean;
  inProgress: boolean;
  step: number;
  error: string | null;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6">
      <div className="flex items-start gap-3">
        <span className="rounded-full bg-status-success-surface p-2 text-status-success-strong">
          <MessageCircle className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h3 className="text-base font-semibold text-neutral-900">
            Conecta tu WhatsApp Business
          </h3>
          <p className="mt-1 text-sm text-neutral-500">
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
                  <Check className="h-4 w-4 text-status-success-strong" aria-hidden />
                ) : active ? (
                  <Loader2 className="h-4 w-4 animate-spin text-neutral-500" aria-hidden />
                ) : (
                  <span className="h-4 w-4 rounded-full border border-neutral-300" aria-hidden />
                )}
                <span className={done ? 'text-neutral-500' : active ? 'text-neutral-800' : 'text-neutral-400'}>
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="mt-6">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onConnectExisting}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-900 disabled:opacity-50"
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              Conectar mi WhatsApp actual
            </button>
            <button
              type="button"
              onClick={onConnectNew}
              disabled={busy}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              Usar un número nuevo
            </button>
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-neutral-500">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              La autenticación se realiza de forma segura con Meta; no necesitas
              copiar tokens ni identificadores. Si Meta determina que tu número
              es elegible para coexistencia, seguirá funcionando en WhatsApp
              Business y también quedará conectado a TAKTO.
            </span>
          </p>
        </div>
      )}

      {error && (
        <p className="mt-4 text-sm text-status-error" role="alert">
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
  onTest,
  busy,
  disconnecting,
  actionMsg,
}: {
  status: WhatsAppConnectionStatus;
  onReconnect: () => void;
  onDisconnect: () => void;
  onTest: (to: string) => Promise<string>;
  busy: boolean;
  disconnecting: boolean;
  actionMsg: string | null;
}) {
  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleString('es-CO') : '—';
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const runTest = async () => {
    setTesting(true);
    setTestMsg(null);
    setTestMsg(await onTest(testTo.trim()));
    setTesting(false);
  };

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6">
      <div className="flex items-center gap-3">
        <h3 className="text-base font-semibold text-neutral-900">
          WhatsApp Business conectado
        </h3>
        <StatusPill status={status.status} />
      </div>

      {status.actionRequired && (
        <div className="mt-4 flex items-start gap-2 rounded-md bg-status-warning-surface px-3 py-2 text-xs text-status-warning-strong">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            La conexión necesita atención. Usa “Reconectar” para volver a
            autorizar con Meta.
          </span>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Número" value={status.maskedPhoneNumber ?? '—'} />
        <Field label="Nombre comercial" value={status.businessName ?? '—'} />
        <Field
          label="Método"
          value={
            status.coexistence
              ? 'Coexistencia (App + API)'
              : status.connectionMethod === 'EMBEDDED_SIGNUP'
                ? 'Meta Embedded Signup'
                : 'Manual'
          }
        />
        <Field
          label="Webhook"
          value={
            status.webhookStatus === 'SUBSCRIBED' ? 'Suscrito' : 'Desconocido'
          }
        />
        <Field label="Conectado desde" value={fmt(status.connectedAt)} />
        <Field label="Última comprobación" value={fmt(status.lastCheckedAt)} />
      </div>

      {/* Explicit connection test (only inside Meta's 24h conversation window). */}
      <div className="mt-6 border-t border-neutral-100 pt-4">
        <p className="mb-2 text-sm font-medium text-neutral-700">Probar conexión</p>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="wa-test-to" className="sr-only">
            Número de destino (E.164)
          </label>
          <input
            id="wa-test-to"
            type="tel"
            inputMode="tel"
            placeholder="+573001234567"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            className="w-56 rounded-md border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
          />
          <button
            type="button"
            onClick={runTest}
            disabled={testing || !testTo.trim()}
            className="rounded-md bg-brand-primary px-3 py-1.5 text-sm text-white hover:bg-primary-900 disabled:opacity-50"
          >
            {testing ? 'Enviando…' : 'Enviar prueba'}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-neutral-400">
          Envía un mensaje de texto de prueba. Solo funciona si hay una
          conversación abierta con ese número (ventana de 24 h de Meta).
        </p>
        {testMsg && <p className="mt-2 text-xs text-neutral-600">{testMsg}</p>}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onReconnect}
          disabled={busy}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          Reconectar
        </button>
        <button
          type="button"
          onClick={onDisconnect}
          disabled={disconnecting}
          className="rounded-md border border-status-error/20 px-3 py-1.5 text-sm text-status-error hover:bg-status-error-surface disabled:opacity-50"
        >
          {disconnecting ? 'Desconectando…' : 'Desconectar'}
        </button>
        <Link
          href="/dashboard/conversations"
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          Ir a conversaciones
        </Link>
      </div>

      <p className="mt-3 text-xs text-neutral-400">
        La desconexión solo cambia el estado local en el CRM; no revoca el acceso
        en Meta ni afecta WhatsApp Business App. Los tokens nunca se muestran en
        esta pantalla.
      </p>
      {actionMsg && <p className="mt-2 text-xs text-status-success-strong">{actionMsg}</p>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="text-sm text-neutral-800">{value}</p>
    </div>
  );
}
