'use client';

interface DocumentSignatureBlockProps {
  // "dual" = FIRMA TEHUS + FIRMA CLIENTE side by side, used by
  // SaleInvoiceTemplate and RepairTemplate.
  // "single" = FIRMA Y NOMBRE DE RECIBIDO, used by RemissionTemplate.
  variant: 'dual' | 'single';
  receiverName?: string;
  onReceiverNameChange?: (value: string) => void;
}

// The Excel's "FIRMA TEHUS" box has a real scanned signature + a personal
// ID number embedded as an image — deliberately NOT reproduced here (it's
// someone's actual handwritten signature and cédula, not something to bake
// into a shared/committed template). This renders a blank signature line
// instead, exactly like the "FIRMA CLIENTE" side already is in the source.
export function DocumentSignatureBlock({
  variant,
  receiverName,
  onReceiverNameChange,
}: DocumentSignatureBlockProps) {
  if (variant === 'single') {
    return (
      <div className="mb-3 border border-stone-800">
        <div className="border-b border-stone-800 bg-white px-2 py-1 text-xs font-bold uppercase tracking-wide">
          Firma y nombre de recibido
        </div>
        <div className="flex">
          <div className="flex flex-1 items-center border-r border-stone-800">
            <span className="w-16 shrink-0 border-r border-stone-800 px-2 py-1 text-xs font-medium">
              Nombre
            </span>
            <input
              value={receiverName ?? ''}
              onChange={(e) => onReceiverNameChange?.(e.target.value)}
              className="w-full flex-1 bg-[#E7D7C9] px-2 py-1 text-xs outline-none"
            />
          </div>
          <div className="flex flex-1 items-center">
            <span className="w-16 shrink-0 border-r border-stone-800 px-2 py-1 text-xs font-medium">
              Firma
            </span>
            <div className="h-8 flex-1" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3 flex gap-6">
      <div className="flex-1 text-center">
        <div className="h-10 border-b border-stone-800" />
        <p className="mt-1 text-xs font-bold uppercase tracking-wide">Firma Tehus</p>
      </div>
      <div className="flex-1 text-center">
        <div className="h-10 border-b border-stone-800" />
        <p className="mt-1 text-xs font-bold uppercase tracking-wide">Firma cliente</p>
      </div>
    </div>
  );
}
