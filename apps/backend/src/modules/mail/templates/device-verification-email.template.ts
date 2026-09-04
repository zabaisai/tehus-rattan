/**
 * Correo con el código de verificación de dispositivo.
 *
 * Solo lleva marca, código y vigencia. NO lleva contraseña, tokens internos,
 * enlaces con secretos, píxeles de seguimiento ni datos de la empresa: quien
 * intercepte el mensaje no obtiene nada más que un número que caduca.
 */
export interface DeviceVerificationEmailData {
  name: string;
  code: string;
  ttlMinutes: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderDeviceVerificationEmail(
  data: DeviceVerificationEmailData,
): { subject: string; html: string; text: string } {
  const nombre = escapeHtml(data.name?.trim() || 'Hola');
  // El código se genera en el servidor y son solo dígitos; se escapa igual por
  // disciplina, no porque pueda traer marcado.
  const codigo = escapeHtml(data.code);
  const minutos = data.ttlMinutes;

  const subject = `Tu código de acceso a TAKTO: ${data.code}`;

  const text = [
    `${nombre},`,
    '',
    `Tu código para verificar este dispositivo es: ${data.code}`,
    '',
    `El código vence en ${minutos} minutos y solo se puede usar una vez.`,
    '',
    'Si no intentaste iniciar sesión, ignora este mensaje: sin el código nadie',
    'entra a tu cuenta. Si te preocupa, cambia tu contraseña.',
    '',
    'TAKTO',
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f7f8fa;font-family:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;color:#171b24;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e5ec;border-radius:10px;">
      <tr>
        <td style="padding:24px 28px 8px 28px;">
          <span style="font-size:20px;font-weight:800;letter-spacing:-0.02em;color:#131c4a;">TAK</span><span style="font-size:20px;font-weight:800;letter-spacing:-0.02em;color:#ff6a00;">TO</span>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 28px 0 28px;">
          <h1 style="margin:0 0 8px 0;font-size:18px;line-height:1.3;color:#171b24;">Verifica este dispositivo</h1>
          <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#525a6b;">
            ${nombre}, usa este código para terminar de iniciar sesión.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px;">
          <div style="background:#eff1f5;border:1px solid #e2e5ec;border-radius:10px;padding:18px;text-align:center;">
            <span style="font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:30px;font-weight:600;letter-spacing:0.24em;color:#131c4a;">${codigo}</span>
          </div>
          <p style="margin:14px 0 0 0;font-size:13px;line-height:1.6;color:#525a6b;">
            Vence en ${minutos} minutos y solo sirve una vez.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 28px 26px 28px;">
          <p style="margin:0;font-size:13px;line-height:1.6;color:#6e7688;">
            Si no intentaste iniciar sesión, ignora este mensaje: sin el código nadie entra a tu cuenta. Si te preocupa, cambia tu contraseña.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
