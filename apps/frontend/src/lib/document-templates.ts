// Text copied as literally as possible from the reference Excel
// (scratchpad/templates/factura_recreada_c.xlsx, sheets "Factura venta" /
// "Reparacion" / "Remision") so the printable calculator carries the same
// legal fine print, not a paraphrase.
//
// The footer contact info (email/phone/WhatsApp/address) is a MOCK default
// pulled as-is from that Excel — it looks old/personal (a @gmail.com
// address) rather than a confirmed current company contact. Treat it as a
// placeholder to confirm with Tehus before relying on it for a real
// printed document; it is not wired to Company.email/phone yet.
export const DOCUMENT_FOOTER_TEXT =
  'NIT. 901459978-9 E-MAIL: rattandelpoblado@gmail.com -tel 322 49 77 -WhatsApp: +57 314 634 4257 -Direc: Cra48 #10-70';

// Present verbatim on "Factura venta" and "Remision" — absent on
// "Reparacion" in the source Excel (confirmed by direct inspection, not an
// oversight here). The two sheets differ by one digit in the CIIU code
// ("312" vs "1312"); this uses the "Factura venta" wording.
export const DOCUMENT_TERMS_AND_CONDITIONS = `Factura generada por computador. R.D 110000631887 de 2015/06/05 del 22950-50000.
ACEPTADA: DECLARAMOS RECIBIDAS, REAL Y MATERIALMENTE, TODAS LAS MERCANCÍAS CONTENIDAS EN LA PRESENTE FACTURA OBLIGÁNDONOS A SU PAGO EN LA FORMA AQUÍ PACTADA. ESTA FACTURA SE ASIMILA EN TODOS SUS EFECTOS LEGALES A UNA LETRA DE CAMBIO SEGÚN EL ART. 774 DEL CÓDIGO DE COMERCIO. ACTIVIDAD ECONÓMICA CIIU 312.
TAMBIÉN, AUTORIZO EXPRESAMENTE PARA QUE EN CASO DE INCUMPLIMIENTO DE LA (S) OBLIGACIÓN (ES) SEA REPORTADO A LAS BASES DE DATOS DE DATACRÉDITO. ESTA FACTURA DE VENTA ES UN TÍTULO VALOR (LEY 1231 DE JULIO DE 2009).`;

export const DOCUMENT_TEMPLATE_LABELS: Record<
  'SALE_INVOICE' | 'REPAIR' | 'REMISSION',
  string
> = {
  SALE_INVOICE: 'Cotización / Factura de venta',
  REPAIR: 'Reparación',
  REMISSION: 'Remisión',
};

// "Cuenta por cobrar" / "Vence" are the two options visible in the
// Remision sheet's FORMA DE PAGO column; kept as suggestions, not a closed
// enum, since the field is free text in the source.
export const REMISSION_PAYMENT_METHOD_SUGGESTIONS = ['Cuenta por cobrar', 'Vence'];
