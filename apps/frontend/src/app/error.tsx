"use client";

// Route-level error boundary. Shows a neutral message and a retry — never the
// raw error text/stack to the user.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 text-center">
      <h1 className="text-lg font-semibold text-neutral-900">
        Algo salió mal
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        Ocurrió un error inesperado. Intenta de nuevo.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-900"
      >
        Reintentar
      </button>
    </div>
  );
}
