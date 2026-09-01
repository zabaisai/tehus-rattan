/**
 * Comprobación de la URL de la API en tiempo de CONSTRUCCIÓN.
 *
 * EXISTE POR UN FALLO QUE LLEGÓ A STAGING Y ROMPIÓ LA APLICACIÓN ENTERA.
 * `NEXT_PUBLIC_API_URL` se incrusta en el bundle al construir. Si está vacía,
 * `axios` se queda sin `baseURL` y TODAS las llamadas —empezando por
 * `POST /auth/refresh`— salen contra el propio origen del frontend:
 *
 *     https://crm-staging.tehusrattan.com/auth/refresh  ->  404
 *
 * Ese 404 se clasifica como fallo transitorio y la aplicación muestra «No
 * pudimos conectar con el servidor» en cada pantalla. No hay forma de usar el
 * CRM, y sin embargo:
 *
 *   - la imagen se construye sin error,
 *   - el contenedor arranca y queda `healthy`,
 *   - `/api/health/status` responde `ok`,
 *   - y el smoke test pasa entero.
 *
 * El único aviso era una línea de `docker compose` —«variable is not set»—
 * fácil de perder entre el ruido de un build. Un fallo así no puede depender
 * de que alguien lea un warning: la construcción tiene que negarse.
 *
 * Solo aplica a producción. En desarrollo se permite vacía porque el proxy
 * local resuelve las rutas relativas.
 */
export function verificarUrlDeApi(
  valor: string | undefined,
  esProduccion: boolean,
): void {
  if (!esProduccion) return;

  if (!valor || !valor.trim()) {
    throw new Error(
      'NEXT_PUBLIC_API_URL está vacía en una construcción de producción.\n' +
        'El bundle quedaría sin URL de API y todas las llamadas irían contra el\n' +
        'propio frontend, con un 404 en cada pantalla.\n' +
        'Construye con `docker compose --env-file .env.staging build`, que es lo\n' +
        'que hace deploy/scripts/deploy.sh.',
    );
  }

  // Una ruta relativa tampoco sirve: el frontend y la API viven en hosts
  // distintos, así que sin origen absoluto las llamadas vuelven al frontend.
  let url: URL;
  try {
    url = new URL(valor.trim());
  } catch {
    throw new Error(
      `NEXT_PUBLIC_API_URL no es una URL absoluta (recibido: "${valor.trim()}").\n` +
        'Debe incluir el esquema y el host, por ejemplo\n' +
        'https://api.ejemplo.com/api',
    );
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(
      `NEXT_PUBLIC_API_URL usa un esquema no soportado: ${url.protocol}`,
    );
  }
}

/**
 * Coherencia del antibot en la CONSTRUCCIÓN del frontend.
 *
 * Riesgo: si el backend tiene `CAPTCHA_ENABLED=true` (fail-closed: exige un token
 * verificado) pero el frontend se construye SIN `NEXT_PUBLIC_TURNSTILE_SITE_KEY`,
 * el login no muestra el widget, no manda token y el backend rechaza TODOS los
 * inicios de sesión.
 *
 * Como son dos builds separados, el frontend no puede leer la variable del
 * backend, pero SÍ puede exigir coherencia: si el despliegue declara que el
 * captcha es obligatorio (`NEXT_PUBLIC_TURNSTILE_REQUIRED=true`, el espejo de
 * `CAPTCHA_ENABLED`), la construcción de producción se niega si falta la site
 * key. Así una configuración incoherente falla al construir, no en el login.
 */
export function verificarCaptcha(
  siteKey: string | undefined,
  required: boolean,
  esProduccion: boolean,
): void {
  if (!esProduccion) return;
  if (required && !siteKey?.trim()) {
    throw new Error(
      'NEXT_PUBLIC_TURNSTILE_REQUIRED=true pero falta NEXT_PUBLIC_TURNSTILE_SITE_KEY.\n' +
        'Con el antibot obligatorio en el backend (CAPTCHA_ENABLED=true) y sin la\n' +
        'site key en el frontend, el login no podría generar token y TODOS los\n' +
        'inicios de sesión serían rechazados. Construye con la site key pública, o\n' +
        'no marques el captcha como obligatorio.',
    );
  }
}
