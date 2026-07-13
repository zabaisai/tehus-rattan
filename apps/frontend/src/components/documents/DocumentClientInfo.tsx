'use client';

export interface DocumentInfoField {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'date';
}

interface DocumentClientInfoProps {
  title: string;
  // A plain field renders on its own full-width row; an array of fields
  // renders them side by side on one row (matches the Remision sheet's
  // "NOMBRE CLIENTE" + "TELEFONO" pair under "QUIEN RECIBE").
  fields: Array<DocumentInfoField | DocumentInfoField[]>;
  // Used by QuotePrintableDocument: real quote/lead data is display-only
  // here, never edited from the print view.
  readOnly?: boolean;
}

function InfoInput({ field, readOnly }: { field: DocumentInfoField; readOnly?: boolean }) {
  return (
    <div className="flex flex-1 items-center border border-t-0 border-stone-800">
      <span className="w-28 shrink-0 border-r border-stone-800 bg-white px-2 py-1 text-xs font-medium">
        {field.label}
      </span>
      {readOnly ? (
        <span className="w-full flex-1 bg-[#E7D7C9] px-2 py-1 text-xs">{field.value}</span>
      ) : (
        <input
          type={field.type ?? 'text'}
          value={field.value}
          onChange={(e) => field.onChange(e.target.value)}
          className="w-full flex-1 bg-[#E7D7C9] px-2 py-1 text-xs outline-none"
        />
      )}
    </div>
  );
}

export function DocumentClientInfo({ title, fields, readOnly }: DocumentClientInfoProps) {
  return (
    <div className="mb-3">
      <div className="border border-stone-800 bg-white px-2 py-1 text-xs font-bold uppercase tracking-wide">
        {title}
      </div>
      {fields.map((entry, i) =>
        Array.isArray(entry) ? (
          <div key={i} className="flex">
            {entry.map((field) => (
              <InfoInput key={field.label} field={field} readOnly={readOnly} />
            ))}
          </div>
        ) : (
          <InfoInput key={entry.label} field={entry} readOnly={readOnly} />
        ),
      )}
    </div>
  );
}
