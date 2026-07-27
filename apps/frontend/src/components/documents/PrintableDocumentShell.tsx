'use client';

interface PrintableDocumentShellProps {
  children: React.ReactNode;
}

// The "sheet of paper" look on screen, plus the print rules that make
// window.print() output only the document itself — no sidebar, no header,
// no editor buttons — regardless of what else is on the dashboard page.
export function PrintableDocumentShell({ children }: PrintableDocumentShellProps) {
  return (
    <>
      <style>{`
        @media print {
          @page {
            size: letter;
            margin: 10mm;
          }
          body * {
            visibility: hidden;
          }
          #printable-document,
          #printable-document * {
            visibility: visible;
          }
          #printable-document {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            box-shadow: none !important;
            border: none !important;
          }
          .print-hidden {
            display: none !important;
          }
          table {
            page-break-inside: auto;
          }
          tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }
        }
      `}</style>
      {/* On phones/tablets the document keeps its real (Excel-derived) column
          widths instead of squeezing them — it scrolls horizontally inside
          this box rather than deforming, and print output is unaffected. */}
      <div className="overflow-x-auto print:overflow-visible">
        <div
          id="printable-document"
          className="mx-auto w-full min-w-[640px] max-w-[850px] border border-stone-300 bg-white p-3 text-[13px] text-stone-900 shadow-sm sm:p-6 print:min-w-0 print:max-w-none print:border-0 print:p-0 print:shadow-none"
        >
          {children}
        </div>
      </div>
    </>
  );
}
