# Platform Admin (SUPER_ADMIN global)

## Qué es SUPER_ADMIN

`SUPER_ADMIN` es un rol de plataforma, distinto de un `ADMIN` de empresa. Un
`SUPER_ADMIN` **global** administra Tehus Rattan como producto (crear
empresas, listarlas, suspenderlas, marcarlas como eliminadas), no pertenece
a ninguna empresa cliente y nunca queda sujeto al filtrado por
`companyId` que aplica al resto del sistema.

- `role === 'SUPER_ADMIN' && companyId === null` es lo que exige
  `PlatformGuard` para dejar pasar una request a `/api/platform/*`.
- Un usuario con `role: 'SUPER_ADMIN'` pero `companyId` de una empresa real
  **no** cuenta como SUPER_ADMIN de plataforma — `PlatformGuard` lo
  rechaza igual que a un `ADMIN` normal.
- `ADMIN` y `AGENT` siempre pertenecen a una empresa (`companyId`
  obligatorio en la práctica, aunque el campo sea nullable a nivel de
  schema).

No se maneja aquí ningún concepto de planes, precios, límites, billing ni
suscripciones — `Company.status` (`ACTIVE` / `SUSPENDED` / `DELETED`) es un
control operativo, no comercial.

## companyId debe ser null

Es la condición que distingue a un SUPER_ADMIN de plataforma de cualquier
otro usuario. El script de este documento la garantiza siempre, tanto al
crear como al actualizar.

## No usar `register` para crear un SUPER_ADMIN

`POST /api/auth/register` es un endpoint público que solo crea `Company` +
`ADMIN` — nunca crea ni puede crear un `SUPER_ADMIN`, y así debe seguir. La
única forma soportada de crear o actualizar un SUPER_ADMIN global es el
script de este documento, ejecutado desde terminal con acceso directo a la
base de datos. No existe (ni debe existir) un endpoint HTTP para esto.

## Cómo crear/actualizar el SUPER_ADMIN por terminal

El script lee tres variables de entorno y no acepta argumentos ni prompts
interactivos:

- `SUPER_ADMIN_EMAIL`
- `SUPER_ADMIN_NAME`
- `SUPER_ADMIN_PASSWORD` (mínimo 8 caracteres)

**PowerShell:**

```powershell
$env:SUPER_ADMIN_EMAIL="admin.platform@tehus.test"
$env:SUPER_ADMIN_NAME="Admin Plataforma"
$env:SUPER_ADMIN_PASSWORD="CambiarEstaClave123!"
npm run platform:create-super-admin
```

**bash:**

```bash
SUPER_ADMIN_EMAIL="admin.platform@tehus.test" \
SUPER_ADMIN_NAME="Admin Plataforma" \
SUPER_ADMIN_PASSWORD="CambiarEstaClave123!" \
npm run platform:create-super-admin
```

Comportamiento:

- Si falta alguna variable, o el email/password no son válidos, el script
  falla con un mensaje claro y código de salida distinto de cero, sin
  tocar la base de datos.
- Si el email no existe todavía, crea el usuario.
- Si el email ya existe, actualiza `name`, `password`, y fuerza
  `role: 'SUPER_ADMIN'`, `companyId: null`, `isActive: true` — es
  idempotente, se puede volver a ejecutar para rotar la contraseña o
  recuperar el rol si se hubiera alterado.
- Nunca crea ni toca ninguna `Company`.
- Nunca imprime la contraseña, el hash, ni ningún JWT.
- Se conecta a la base de datos vía Prisma (la misma `DATABASE_URL` que
  usa el backend) y se desconecta siempre al terminar, incluso si falla.

## La contraseña no debe commitearse

Las variables de entorno se pasan en la misma línea de comando o sesión de
shell, nunca deben guardarse en un archivo versionado (`.env` no debe
contener `SUPER_ADMIN_PASSWORD`). Bórralas del historial de tu shell si tu
terminal las persiste.

## En producción

Usa una contraseña temporal fuerte y única generada para esa ejecución,
compártela por un canal seguro fuera de git/chat público, y cámbiala desde
una sesión autenticada tan pronto como el SUPER_ADMIN inicie sesión por
primera vez. Vuelve a ejecutar el script con una contraseña nueva en
cualquier momento para rotarla — es seguro y no afecta empresas ni datos
de clientes.
