'use client';

import { DOCUMENT_TERMS_AND_CONDITIONS } from '@/lib/document-templates';

// Copied verbatim from the reference Excel (see lib/document-templates.ts).
// Only rendered by templates whose source sheet actually has this block —
// "Reparacion" has none in the Excel, so RepairTemplate never renders this.
export function DocumentTermsAndConditions() {
  return (
    <p className="mb-3 whitespace-pre-line border border-stone-400 p-1.5 text-[7px] leading-tight text-stone-700">
      {DOCUMENT_TERMS_AND_CONDITIONS}
    </p>
  );
}
