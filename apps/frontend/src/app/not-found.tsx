import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 text-center">
      <p className="text-sm font-medium text-neutral-400">404</p>
      <h1 className="mt-2 text-lg font-semibold text-neutral-900">
        Página no encontrada
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        La página que buscas no existe o fue movida.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-900"
      >
        Volver al inicio
      </Link>
    </div>
  );
}
