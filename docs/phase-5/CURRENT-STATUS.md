# Fase 5 — Estado actual

Para retomar el trabajo sin releer todo.

## Dónde está el código

Rama `feat/phase-5-existing-tenant-migration`, partida de `origin/main`
`ef93a4d`. Worktree propio, separado del principal. El archivo ajeno del
worktree principal no se ha tocado en ningún momento.

## Qué está hecho

- Inventario de solo lectura de staging, dentro de una transacción de solo
  lectura, con huellas estables guardadas fuera del repositorio.
- Contrato de migración cerrado antes de escribir una línea de código.
- Herramienta de migración con cuatro modos: ensayo en seco (el de por defecto),
  aplicar, verificar y revertir desde el manifiesto.
- Moneda por empresa en toda la interfaz.
- Pruebas: unitarias de la decisión, de extremo a extremo contra base real, y de
  pantalla en tres monedas distintas.
- Lint y comprobación de tipos limpios en backend y frontend.

- Pull request, integración continua verde y fusión en la rama principal.
- Respaldo verificado, copia cifrada externa y despliegue en staging.
- Migración aplicada, verificada y repetida sin cambios.
- QA por navegador con administrador y asesor, y reversión probada de verdad.

## Estado

**FASE 5 CERRADA — PASS.** No queda trabajo pendiente de esta fase.

Producción sigue sin migrar, que es lo previsto: la herramienta está lista y
probada, pero migrar producción es una decisión aparte que necesita su propia
autorización, su respaldo y su ventana.

## Cómo se ejecuta la herramienta

Dentro del contenedor del backend, sobre el código ya compilado:

```
node dist/src/scripts/migrar-inquilinos ensayo --salida <ruta fuera del repo>
node dist/src/scripts/migrar-inquilinos aplicar --confirmar --salida <ruta>
node dist/src/scripts/migrar-inquilinos verificar
node dist/src/scripts/migrar-inquilinos revertir --manifiesto <ruta> --confirmar
```

Para escribir hace falta además la variable `MIGRACION_FASE5_OBJETIVO` con el
nombre exacto de la base de datos de destino. Si no coincide con la configurada,
la herramienta se niega y explica la diferencia.

Se puede acotar a empresas concretas repitiendo `--empresa <id>`, que sirve para
migrar de forma gradual empezando por una sola.

## Cómo quedó staging

Las cuatro empresas en la forma canónica y los tres elementos de catálogo con su
tipo escrito. La configuración efectiva de cada empresa es idéntica a la de
antes salvo las dos diferencias esperadas. Ningún dato comercial cambió.

La moneda por empresa se probó con una empresa sintética en pesos mexicanos,
porque las cuatro reales comparten región. Esa empresa se borró al terminar.

## Riesgos vivos

- El paso de comprobación de salud del despliegue falla de forma intermitente
  mientras el contenedor arranca. Es deuda anterior; se vuelve a ejecutar y pasa.
- La caché de capacidades vive cinco segundos por proceso y no se entera de una
  escritura hecha por SQL directo: conviene esperar ese margen antes de
  comprobar la configuración por la API.
- El script que restablece la empresa de demostración la devuelve a no tener
  configuración, deshaciendo su migración.
- Las empresas nuevas creadas desde plataforma siguen naciendo sin
  configuración, así que la forma antigua puede reaparecer.
