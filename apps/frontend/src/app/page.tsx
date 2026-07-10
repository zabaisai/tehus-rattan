import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-1 flex-col items-center justify-center bg-[#FAF8F3] px-6 py-16">
      <div className="w-full max-w-2xl text-center">
        <div className="mx-auto mb-8 flex h-14 w-14 items-center justify-center rounded-full bg-[#0B0F10]">
          <span className="text-sm font-semibold tracking-[0.2em] text-[#FDDC7F]">CRM</span>
        </div>

        <h1 className="text-3xl font-semibold tracking-tight text-[#0B0F10] sm:text-4xl">
          CRM personalizado para empresas
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-[#0B0F10]/70">
          Organiza tus clientes, asesores, productos, seguimientos y ventas en
          un solo lugar.
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/onboarding"
            className="w-full rounded-md bg-[#A57014] px-6 py-3 text-sm font-medium text-[#FAF8F3] shadow-sm transition-colors hover:bg-[#8c5f10] sm:w-auto"
          >
            Crear cuenta de empresa
          </Link>
          <Link
            href="/login"
            className="w-full rounded-md border border-[#0B0F10]/15 px-6 py-3 text-sm font-medium text-[#0B0F10] transition-colors hover:bg-[#F4EFE6] sm:w-auto"
          >
            Iniciar sesión
          </Link>
        </div>
      </div>
    </div>
  );
}
