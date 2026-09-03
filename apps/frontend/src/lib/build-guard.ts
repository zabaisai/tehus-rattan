/**
 * Comprobación de la URL de la API en tiempo de CONSTRUCCIÓN.
 *
 * EXISTE POR UN FALLO QUE LLEGÓ A STAGING Y ROMPIÓ LA APLICACIÓN ENTERA.
 * `NEXT_PUBLIC_API_URL` se incrusta en el bundle al construir. Si está vacía,
 * `axios` se queda sin `baseURL` y TODAS las llamadas —empezando por
 * `POST /auth/refresh`— salen contra el propio origen del frontend:
 *
 *     https://crm-staging.takto.online/auth/refresh  ->  404
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
