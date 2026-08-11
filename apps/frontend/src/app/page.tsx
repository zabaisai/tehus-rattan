import Link from "next/link";
import { TaktoLogo } from "@/components/ui/TaktoLogo";

export default function HomePage() {
  return (
    // Puerta del producto: aquí manda TAKTO. La identidad de cada empresa
    // cliente aparece después, dentro de su propio espacio, y las dos nunca se
    // mezclan. Antes esta pantalla mostraba un disco oscuro con la palabra
    // "CRM" en la paleta beige/oro anterior: ni era la marca ni decía cuál.
    <div className="flex min-h-screen flex-1 flex-col items-center justify-center bg-neutral-50 px-6 py-16">
      <div className="w-full max-w-2xl text-center">
        {/* El logotipo ya se anuncia como "TAKTO" (role=img), así que el h1
            visible sería una segunda lectura del mismo nombre. */}
        <h1 className="sr-only">TAKTO</h1>
        <div className="mb-8 flex justify-center">
          <TaktoLogo height={40} />
        </div>

        <p className="mx-auto text-3xl font-semibold tracking-tight text-content-primary sm:text-4xl">
          CRM conversacional para vender por WhatsApp
        </p>
        <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-content-secondary">
          Organiza tus clientes, asesores, productos, seguimientos y ventas en
          un solo lugar.
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/onboarding"
            className="w-full rounded-md bg-brand-primary px-6 py-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1 sm:w-auto"
          >
            Crear cuenta de empresa
          </Link>
          <Link
            href="/login"
            className="w-full rounded-md border border-neutral-300 bg-white px-6 py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1 sm:w-auto"
          >
            Iniciar sesión
          </Link>
        </div>
      </div>
    </div>
  );
}
