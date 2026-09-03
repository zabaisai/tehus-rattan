# Fase 1 — Contrato de identidad

## Plataforma

```text
Nombre: TAKTO
Dominio raíz: takto.online
Propietario del CRM: TAKTO
```

TAKTO es el producto y el fallback de toda identidad visible: títulos,
metadatos, manifest/PWA, Open Graph, login, recuperación de contraseña,
onboarding, panel de Super Admin, remitente general de correo, textos del
sistema y mensajes de error. Ninguna empresa cliente —Tehus incluida— aparece
nunca como dueño, marca predeterminada o remitente general.

## Marca predeterminada

Fuente única: los activos y tokens ya existentes en el repositorio. No se
crea ni modifica ningún logotipo.

| Elemento | Fuente oficial | Valor |
|---|---|---|
| Logotipo (isotipo + wordmark, TAK navy / TO naranja) | `apps/frontend/src/components/ui/TaktoLogo.tsx` | SVG inline, Archivo ExtraBold |
| Navy de marca | `apps/frontend/src/app/globals.css` `--color-brand-primary` | `#131C4A` |
| Naranja de marca | `globals.css` `--color-brand-secondary` | `#FF6A00` |
| Superficie inversa | `globals.css` `--color-surface-inverse` | `#131C4A` |
| Color de tema (barra del navegador, PWA) | `layout.tsx` `viewport.themeColor`, `public/site.webmanifest` | `#131C4A` |
| Tipografías | `layout.tsx` (Archivo, IBM Plex Sans, IBM Plex Mono autoalojadas) | — |
| Iconos, favicon, OG | `apps/frontend/public/` | — |
| Nombre de aplicación | `layout.tsx` `metadata.applicationName`, `site.webmanifest` | `TAKTO` |
| Remitente de correo por defecto | `MailService` (`SMTP_FROM_NAME` vacío → `TAKTO`) | `TAKTO` |

Reglas que fija este contrato:

1. **Apariencia inicial de una empresa nueva = neutral TAKTO.** El onboarding
   no pre-rellena colores de empresa; `primaryColor/accentColor/backgroundColor`
   quedan en `null` hasta que la empresa los elija en *Configuración → Empresa*.
   Los valores anteriores (`#A57014`, `#FDDC7F`, `#FAF8F3`) eran los colores
   de un tenant existente y desaparecen como valor por defecto.
2. **El branding de la empresa manda dentro de su sesión** (bloque de empresa
   en la barra lateral, documentos y cotizaciones). Si la empresa no tiene
   logotipo, se muestra su inicial sobre la franja neutra; el logotipo de
   TAKTO sigue siendo el del producto (franja superior, login).
3. **Nunca Tehus como fallback.** Ni en placeholders, ni en valores por
   defecto, ni en remitentes, ni en documentación operativa vigente.
4. Las dos marcas no se mezclan: TAKTO no viste a la empresa y la empresa no
   tiñe la navegación del producto (regla ya codificada en `Sidebar.tsx`).

## Tenant Tehus

Tehus Rattan es una empresa cliente más. Conserva íntegramente sus datos:
nombre, slug, logotipos, colores, categorías guardadas, productos, pipeline
y etapas, usuarios, contactos, leads, conversaciones y configuración. La
Fase 1 no ejecuta ningún script ni migración sobre esos datos; los
`Company.settings` v1 existentes se interpretan en lectura y no se
reescriben (ver `ONBOARDING-CONTRACT.md` § Settings). Su vertical natural es
`furniture_decor`, pero **no se le asigna** en esta fase: la asignación de
vertical a empresas existentes es una decisión posterior del propietario.

## Dominios

| Entorno | Frontend | API | Estado |
|---|---|---|---|
| Producción | `crm.takto.online` | `api.crm.takto.online` | Documentado y con ejemplos; sin DNS, sin certificados, sin despliegue |
| Staging (nuevo, canónico) | `crm-staging.takto.online` | `api.crm-staging.takto.online` | Configurado en código; DNS pendiente |
| Staging (antiguo, compatibilidad temporal) | `crm-staging.tehusrattan.com` | `api.crm-staging.tehusrattan.com` | Frontend: redirección al nuevo tras verificar login; API: alias compatible |

Estrategia de convivencia: la API antigua se mantiene como alias del mismo
backend (mismos certificados, sin redirecciones que rompan preflight,
callbacks ni clientes antiguos). El frontend antiguo redirige al nuevo. Las
cookies de sesión son host-only en el host de la API: un usuario que venga
del frontend antiguo inicia sesión una vez en el nuevo. Los dominios antiguos
no se eliminan en esta fase. Detalle en `DOMAIN-MIGRATION.md`.

## Namespace técnico de autenticación

| Elemento | Canónico | Legacy aceptado | Retiro |
|---|---|---|---|
| Cookie de refresco (httpOnly, Secure en producción, SameSite=Lax, path `/api/auth`, host-only) | `takto_refresh_token` | `tehus_refresh_token` (solo lectura; se borra al rotar) | Ver criterio |
| Cookie de dispositivo (httpOnly, path `/`) | `takto_device_id` | `tehus_device_id` (se adopta y se borra) | Ver criterio |
| Cubo de rate limiting de `/auth/refresh` | por `takto_device_id` | cae a `tehus_device_id` | Con las cookies |
| Canal entre pestañas | `BroadcastChannel('takto-auth')` | escucha también `tehus-auth` | Con el frontend |
| Web Lock de refresco | `takto-auth-refresh` | — (el backend serializa por compare-and-swap) | — |
| Códigos de invitación nuevos | prefijo `TAKTO` | códigos `TEHUS` existentes válidos por hash/estado/vencimiento | Nunca se invalidan por prefijo |

Ningún atributo de seguridad se reduce: `HttpOnly`, `Secure` (con
`NODE_ENV=production`), `SameSite=Lax`, host-only y `path` se conservan.

**Retiro del fallback.** El fallback de cookies puede retirarse cuando se
cumplan las dos condiciones: (a) han pasado más de 90 días (inactividad
máxima de sesión, `SESSION_INACTIVITY_EXPIRY_DAYS`) desde el despliegue de
esta fase en el entorno, y (b) el dominio antiguo del frontend ya no sirve el
bundle antiguo. La cookie de dispositivo legacy caduca sola a los 2 años; su
lectura puede retirarse junto con la de refresco porque su única función es
la continuidad del cubo de rate limiting. El canal `tehus-auth` puede
retirarse en el despliegue siguiente al de esta fase.

## Infraestructura congelada

Los nombres siguientes **no representan la marca pública** y no se renombran
en esta fase porque están ligados a infraestructura y respaldos verificados
en la Fase 0. Se tratarán en una fase de infraestructura futura, con su propio
plan de migración y rollback:

- ruta `/opt/tehus-crm` y clave `tehus_vps_ed25519`;
- base `tehus_crm_staging` y patrón `tehus_restore_drill*`;
- unidades `tehus-backup.service/timer`, `tehus-backup-drill.*`,
  `tehus-backup-init.service`;
- proyecto Compose `tehus-crm-staging`, sus contenedores, redes y volúmenes;
- `RESTIC_HOST=tehus-crm-staging`, artefactos `tehus-crm-staging-*`, locks
  `.tehus-offsite-backup.lock` / `.tehus-restore-drill.lock`, repositorios
  Restic v2 e histórico;
- imágenes y worktrees `tehus-rollback-*` del script de rollback;
- entorno local de desarrollo (`tehus_postgres`, `tehus_rattan`, `tehus_user`);
- repositorio GitHub `zabaisai/tehus-rattan` y carpeta local `Tehus_Rattan`.
