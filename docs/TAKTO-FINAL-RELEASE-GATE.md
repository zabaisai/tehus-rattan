# Gate final independiente de release

Verificación de `feature/takto-functional-hardening` **desde el repositorio y
los resultados reales**, sin dar por buenas las conclusiones del informe
anterior. No se fusiona, no se despliega y no se toca staging.

## 1. Preflight

- [x] `HEAD == origin/feature/takto-functional-hardening`
- [x] `main == origin/main`, SHA real confirmado
- [x] Árbol limpio salvo `brand/` **sin rastrear**
- [x] Sin `.git/index.lock`
- [x] Leídos: SPEC, STATE y matriz de trazabilidad

## 2. CI remoto

- [ ] GitHub Actions consultado para el SHA exacto
- [ ] `frontend` en `success`
- [ ] `backend` en `success`
- No basta con las pruebas locales.

## 3. Auditoría del diff `origin/main...HEAD`

Se revisa: archivos modificados, secretos, credenciales, datos personales,
cambios ajenos, dependencias, migraciones, operaciones destructivas, aislamiento
por `companyId`, operaciones de eliminación, archivos temporales, conexiones a
Redis, workers, timers, errores silenciosos, logs con PII y rutas sin permisos.

Además, específicamente: **que ninguna migración ni backfill modifique los bots
reales existentes**.

## 4. Importación de 500 MB

El informe anterior solo demuestra hasta ~145,6 MB. Hay que cerrar **una** de
las dos, con honestidad:

**A.** Probar un archivo generado temporalmente cercano a 500 MB, sin subirlo a
Git, registrando tamaño exacto, formato, filas, tiempo, RSS
inicial/máximo/final, disco temporal, progreso, cancelación, limpieza,
resultados, reinicio del worker e idempotencia.

**B.** Si el equipo o el VPS no lo soportan de forma segura: determinar el
límite operativo con evidencia, mantener el límite de protocolo configurable,
**mostrar en la interfaz el límite operativo real**, no prometer 500 MB,
documentar por qué y **probar que los archivos superiores se rechazan antes de
ocupar recursos**.

No se declara soporte operativo para 500 MB solo porque una constante lo
permita.

## 5. QA real de navegador

Chrome **y Microsoft Edge**, a 1440 / 1280 / 1024 / 768 / 390 px.

Flujos mínimos: contactos activos, archivar, papelera, restaurar, eliminación
segura, pipelines, traslado de oportunidades, perfil lateral, pipeline →
conversación, conversación → pipeline, sugerencias de tareas, aprobar, rechazar,
importación de productos, progreso y cancelación, cotización y cálculos, PDF,
asociación al pipeline, TAKTO Pulso, importación/exportación y simulación
dry-run.

Se comprueba: contenido real de la aplicación —**no páginas de error**—, HTTP
correcto, cero errores de consola, cero excepciones, cero overflow, controles
con nombre accesible, teclado, apertura y cierre de paneles, recarga y deep
links.

## 6. Cotizaciones

Con evidencia **visual y E2E**, no solo servicios de backend: formulario,
líneas, cantidades, descuentos, ajustes negativos, transporte, impuestos, total,
Decimal en backend, PDF descargable, historial, envío en dry-run, asociación al
pipeline configurado y reintento sin duplicar.

## 7. Verificación completa

Backend unit, backend E2E, frontend, typecheck con specs, lint, build, Prisma
validate, migraciones desde cero, migraciones sobre esquema anterior, Docker
build de backend y de frontend, prueba de worker, prueba de Redis, cero claves
QA residuales, cero temporales, cero llamadas reales a Meta y kill switch
intacto.

## 8. Resultado

Si aparece un faltante: corregirlo, probarlo y añadir commits en la misma rama.
Actualizar `TAKTO-FUNCTIONAL-HARDENING-STATE.md`. Publicar únicamente
`feature/takto-functional-hardening`.

Decisión explícita: **APTO PARA FUSIÓN A MAIN** o **NO APTO**, con los
bloqueadores exactos. No se fusiona ni se despliega aunque todo quede verde.

---

# Resultados

## Bloqueador 1 — `brand/` versionado por error · CORREGIDO

El encargo original decía «no modifiques `brand/`» y que el árbol debía quedar
limpio **salvo `brand/` sin rastrear**. En `d3bc633` entró entero —208 archivos,
4,4 MB— por un `git add -A` sin revisar.

No se reescribió la historia: la rama está publicada y el force push está
prohibido. Se desrastreó en `7165d0e` y se añadió a `.gitignore`, de modo que el
árbol final de la rama vuelve a coincidir con el de `main` en ese punto.

Efecto en el diff neto: **de 329 archivos a 122**.

_(El resto de secciones se completa a medida que se verifican.)_
