interface SuccessScreenProps {
  companyName: string;
  slug: string | null;
  logoUrl: string | null;
  onGoToLogin: () => void;
}

function resolveUploadUrl(path: string): string {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "";
  const origin = apiBase.replace(/\/api\/?$/, "");
  return `${origin}${path}`;
}

export function SuccessScreen({ companyName, slug, logoUrl, onGoToLogin }: SuccessScreenProps) {
  return (
    <div className="flex min-h-screen flex-1 flex-col items-center justify-center bg-[#FAF8F3] px-6 py-16">
      <div className="w-full max-w-md rounded-xl border border-[#0B0F10]/10 bg-white p-8 text-center shadow-sm">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={resolveUploadUrl(logoUrl)}
            alt={companyName}
            className="mx-auto mb-4 h-16 w-16 rounded-lg object-cover"
          />
        ) : (
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#0B0F10]">
            <span className="text-sm font-semibold text-[#FDDC7F]">
              {companyName.slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}

        <h2 className="text-xl font-semibold text-[#0B0F10]">
          Empresa creada correctamente
        </h2>
        <p className="mt-2 text-sm text-[#0B0F10]/70">{companyName}</p>
        {slug && <p className="mt-1 text-xs text-[#0B0F10]/40">{slug}</p>}

        <button
          onClick={onGoToLogin}
          className="mt-6 w-full rounded-md bg-[#A57014] px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-[#8c5f10]"
        >
          Ir a iniciar sesión
        </button>
      </div>
    </div>
  );
}
