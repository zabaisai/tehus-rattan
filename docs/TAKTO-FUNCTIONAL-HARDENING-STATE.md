# Estabilización funcional del CRM TAKTO

Documento vivo. Se actualiza en cada bloque cerrado para que el trabajo pueda
reanudarse sin releer la conversación.

## Punto de partida

| Dato | Valor |
|---|---|
| SHA inicial | `347b95795ef9129436532f52f03779a386b16847` |
| Rama | `feature/takto-functional-hardening`, creada desde `origin/main` |
| `main` vs `origin/main` | Idénticos en `347b957` |
| Árbol | Limpio salvo `brand/` sin rastrear (no se toca) |
| `.git/index.lock` | No existe |

### Baseline de pruebas (antes de tocar nada)

| Suite | Resultado |
|---|---|
| Backend unitarias | 116 suites, 1928 pruebas, **verde** |
| Frontend unitarias | 55 archivos, 401 pruebas, **verde** |
| Backend E2E | Ver sección de pruebas |

### Estado de staging (solo lectura, no se modifica en este encargo)

Verificado al inicio: transporte real apagado, dry-run activo, kill switch
activo con motivo, allowlists vacías, siete contenedores sanos. PostgreSQL,
Caddy y takto-web intactos.

## Datos reales que NO se tocan

- Los bots creados por `admin.crm.staging@tehusrattan.com` (`Handoff a asesor`
  archivado, `Auto` y `Captura de datos` en borrador). No se eliminan, ni se
  archivan, ni se publican, ni se renombran, ni se usan como datos de prueba.
- La empresa residual `QA_E2E_TEMP_Co` de una sesión anterior: **se reporta,
  no se elimina** — queda fuera del alcance de este encargo.
- Todas las auditorías existentes.
- Los usuarios reales.

## Hallazgos de la auditoría

Severidad: **C** crítico, **A** alto, **M** medio, **B** bajo.

| # | Sev | Dominio | Defecto | Archivo |
|---|---|---|---|---|
| 1 | A | Productos | La importación acepta `.xlsm`, que es el formato **con macros**. El requisito es rechazarlo. | `products-import.service.ts` |
| 2 | A | Productos | El archivo entero se carga en memoria (`FileInterceptor` sin `storage`, `workbook.xlsx.load(buffer)`). Sin streaming no hay techo real de tamaño. | `products.controller.ts`, `products-import.service.ts` |
| 3 | A | Productos | No hay CSV, ni proceso asíncrono, ni progreso, ni cancelación, ni reanudación, ni reporte descargable. | `products-import.service.ts` |
| 4 | A | Cotizaciones | Todo el dinero es `Float`: `Quote.subtotal/discount/total`, `QuoteItem.unitPrice/subtotal`, `Product.price`, `Lead.value`. | `schema.prisma` |
| 5 | A | Cotizaciones | `generateNextNumber` carga **todas** las cotizaciones de la empresa en memoria para hallar el máximo. | `quotes.service.ts` |
| 6 | A | Cotizaciones | No hay impuestos, transporte, descuento por línea, ajustes, moneda ni redondeo por empresa. | `quotes.service.ts` |
| 7 | A | Pipelines | No existe traslado de oportunidades: un embudo con oportunidades no se puede retirar de forma segura. | `pipeline.service.ts` |
| 8 | M | Pipelines | Archivar un embudo con oportunidades abiertas no avisa ni las cuenta. | `pipeline.service.ts` |
| 9 | M | Contactos | El botón visible dice «Eliminar contacto» y lo que hace es archivar. La etiqueta miente. | `contacts/page.tsx` |
| 10 | M | Contactos | No hay papelera, ni eliminación definitiva segura, ni vista previa de impacto. | `contacts.service.ts` |
| 11 | M | Infra | `smoke-test.sh` consulta `localhost:3001/3000`; en staging los puertos no se publican y la única entrada es Caddy. Producía 15 fallos `000` engañosos. | `deploy/scripts/smoke-test.sh` |
| 12 | B | Contactos/Pipelines | `update`/`block`/`remove` validan con `findFirst` y después escriben con `where: { id }` sin `companyId`. Ventana TOCTOU estrecha pero evitable. | `contacts.service.ts`, `pipeline.service.ts` |
| 13 | M | Navegación | «FlowBot» y «Chatbot» conviven en el menú como dos productos distintos para la misma idea. | `Sidebar.tsx` |

## Decisiones

- **`Float` → `Decimal`**: se hace con `ALTER TABLE ... TYPE numeric(18,4) USING`,
  que conserva los valores. No es un `DROP`, no pierde filas y tiene rollback
  documentado (`USING columna::double precision`). Se prueba desde base limpia
  y sobre una copia con datos.
- **`.xlsm` se rechaza** aunque hoy se acepte: es un cambio de comportamiento
  deliberado y pedido explícitamente.
- **`QA_E2E_TEMP_Co` se reporta y no se toca**, por instrucción.

## Migraciones

_(se completa al aplicar cada una)_

## Commits

_(se completa)_

## Limitaciones conocidas

_(se completa)_

## Reanudación

Rama `feature/takto-functional-hardening`. Siguiente comando seguro:

```bash
git -C C:/Users/Usuario/Desktop/Tehus_Rattan status
```
