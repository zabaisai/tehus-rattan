'use client';

import { DOCUMENT_FOOTER_TEXT } from '@/lib/document-templates';

// See DOCUMENT_FOOTER_TEXT in lib/document-templates.ts — this is a mock
// default lifted from the reference Excel, not yet wired to the company's
// real contact info.
export function DocumentFooter() {
  return (
    <p className="border-t border-stone-800 pt-1.5 text-center text-[9px] text-stone-600">
      {DOCUMENT_FOOTER_TEXT}
    </p>
  );
}
