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
      <div
        id="printable-document"
        className="mx-auto w-full max-w-[850px] border border-stone-300 bg-white p-6 text-[13px] text-stone-900 shadow-sm print:max-w-none print:border-0 print:p-0 print:shadow-none"
      >
        {children}
      </div>
    </>
  );
}
