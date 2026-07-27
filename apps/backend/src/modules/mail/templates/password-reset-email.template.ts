export interface PasswordResetEmailData {
  name: string | null;
  resetUrl: string;
  ttlMinutes: number;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// A simple, professional Spanish password-reset email. Contains only: the
// (optional) user name, the reset button/link, the TTL, the single-use notice,
// and the ignore-if-not-requested notice. Never the password, never any other
// company's data.
export function renderPasswordResetEmail(
  data: PasswordResetEmailData,
): RenderedEmail {
  const subject = 'Restablece tu contraseña de Tehus Rattan CRM';
  const greeting = data.name ? `Hola ${escapeHtml(data.name)},` : 'Hola,';
  const greetingText = data.name ? `Hola ${data.name},` : 'Hola,';

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917;">
    <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border:1px solid #e7e5e4;border-radius:10px;padding:28px;">
        <h1 style="margin:0 0 4px;font-size:18px;color:#1c1917;">Tehus Rattan CRM</h1>
        <p style="margin:0 0 20px;font-size:13px;color:#78716c;">Recuperación de contraseña</p>
        <p style="font-size:14px;line-height:1.6;">${greeting}</p>
        <p style="font-size:14px;line-height:1.6;">
          Recibimos una solicitud para restablecer la contraseña de tu cuenta.
          Haz clic en el botón para elegir una nueva contraseña.
        </p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${escapeAttr(data.resetUrl)}"
             style="display:inline-block;background:#1c1917;color:#ffffff;text-decoration:none;
                    padding:12px 22px;border-radius:8px;font-size:14px;font-weight:600;">
            Restablecer contraseña
          </a>
        </p>
        <p style="font-size:13px;line-height:1.6;color:#57534e;">
          Este enlace vence en <strong>${data.ttlMinutes} minutos</strong> y solo puede usarse una vez.
        </p>
        <p style="font-size:13px;line-height:1.6;color:#57534e;">
          Si no solicitaste este cambio, puedes ignorar este correo; tu contraseña no se modificará.
        </p>
      </div>
      <p style="text-align:center;font-size:11px;color:#a8a29e;margin-top:16px;">
        Este es un mensaje automático de Tehus Rattan CRM. No respondas a este correo.
      </p>
    </div>
  </body>
</html>`;

  const text = `${greetingText}

Recibimos una solicitud para restablecer la contraseña de tu cuenta de Tehus Rattan CRM.

Abre este enlace para elegir una nueva contraseña:
${data.resetUrl}

El enlace vence en ${data.ttlMinutes} minutos y solo puede usarse una vez.

Si no solicitaste este cambio, ignora este correo; tu contraseña no se modificará.`;

  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;');
}
