'use client';

interface DocumentTermsAndConditionsProps {
  // Per-company terms/footer text. Rendered only when non-empty — there is no
  // hardcoded/global legal text, so a company without terms shows none.
  terms?: string | null;
}

export function DocumentTermsAndConditions({ terms }: DocumentTermsAndConditionsProps) {
  const text = terms?.trim();
  if (!text) return null;

  return (
    <p className="mb-3 whitespace-pre-line border border-stone-400 p-1.5 text-[7px] leading-tight text-stone-700">
      {text}
    </p>
  );
}
