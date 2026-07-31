# Rotación de `WHATSAPP_TOKEN_ENCRYPTION_KEY`

Procedimiento para cambiar la clave con la que se cifran los tokens de
WhatsApp **sin interrumpir el servicio y sin dejar ningún token ilegible**.

## Lo que está en juego

El token de WhatsApp es lo único que permite **enviar** mensajes. Si una
rotación mal hecha lo deja ilegible, el CRM sigue funcionando en todo lo demás
—se reciben mensajes, se ven conversaciones, el tablero va— y solo falla el
envío. El síntoma que llega es «los mensajes no salen», que no apunta a la
clave por ningún lado.

Por eso el procedimiento tiene una comprobación entre cada paso.

## Cómo funciona la transición

- **Cifrar** usa siempre `WHATSAPP_TOKEN_ENCRYPTION_KEY`.
- **Descifrar** prueba primero esa, y si falla, `WHATSAPP_TOKEN_ENCRYPTION_KEY_PREVIOUS`.

Esa asimetría es lo que permite rotar en caliente: se pone la clave nueva como
actual y la vieja como anterior; todo lo ya cifrado se sigue leyendo, y lo
nuevo nace con la clave nueva. AES-GCM autentica, así que probar la segunda
clave no es adivinar: o descifra correctamente, o no descifra.

## Procedimiento

Cada orden se ejecuta dentro del contenedor del backend. **Ninguna imprime el
token ni la clave.**

### 0. Antes de empezar

```bash
docker compose exec backend node dist/src/scripts/rotar-clave-whatsapp estado
```

Anota `total` y `conClaveActual`. Si `ilegibles > 0`, **para aquí**: hay
integraciones que ya no se pueden descifrar y hay que reconectarlas antes de
rotar nada.

Haz backup de la base. No porque la rotación borre —no borra— sino porque es
el momento barato de tenerlo.

### 1. Generar la clave nueva

Genérala donde guardes los secretos, no en la terminal del servidor: el
historial de shell es el sitio donde acaban filtrándose.

Debe ser larga y aleatoria. La clave se pasa por SHA-256 para derivar los 32
bytes de AES, así que la longitud no está limitada por el algoritmo.

### 2. Configurar las dos claves

En `.env.staging` (o el gestor de secretos):

```
WHATSAPP_TOKEN_ENCRYPTION_KEY=<la nueva>
WHATSAPP_TOKEN_ENCRYPTION_KEY_PREVIOUS=<la que había>
```

**El orden importa.** La nueva pasa a ser la actual; la vieja queda como
anterior. Si se invierten, el sistema seguirá cifrando con la vieja y la
rotación no avanzará nunca.

### 3. Reiniciar backend y worker

```bash
docker compose up -d --no-deps backend worker
```

Ambos: los dos descifran tokens. Con solo uno reiniciado, el otro sigue con la
configuración anterior.

Comprueba que todo se lee todavía:

```bash
docker compose exec backend node dist/src/scripts/rotar-clave-whatsapp estado
```

Ahora `conClaveAnterior` debe ser igual al total anterior, e `ilegibles` cero.
**Si aparece algún ilegible, vuelve al paso de rollback.**

### 4. Recifrar

```bash
docker compose exec backend node dist/src/scripts/rotar-clave-whatsapp recifrar
```

Cada token se descifra, se vuelve a cifrar con la clave nueva, y **se verifica
descifrándolo otra vez antes de guardarlo**. Solo si el resultado coincide con
el original se escribe la fila. Una integración que falle no detiene a las
demás: se cuenta, se registra su identificador y se sigue.

Es idempotente: se puede repetir sin efectos.

### 5. Comprobar antes de retirar la clave vieja

```bash
docker compose exec backend node dist/src/scripts/rotar-clave-whatsapp comprobar
```

Solo dice «seguro» cuando **no queda ninguna** integración con la clave
anterior **y ninguna ilegible**. La segunda condición importa: mientras la
clave vieja siga configurada, una integración ilegible todavía podría
recuperarse; en cuanto se retire, es definitiva.

### 6. Retirar la clave anterior

Quita `WHATSAPP_TOKEN_ENCRYPTION_KEY_PREVIOUS` y reinicia backend y worker.
Vuelve a ejecutar `estado`: `rotacionEnCurso` debe ser `false` e `ilegibles`
cero.

## Rollback

**Antes del paso 4** (nada recifrado todavía): devuelve
`WHATSAPP_TOKEN_ENCRYPTION_KEY` a su valor original, quita la variable
`_PREVIOUS` y reinicia. No hay nada que deshacer.

**Después del paso 4, con el recifrado a medias**: el rollback seguro es
**mantener las dos claves configuradas**, invirtiéndolas:

```
WHATSAPP_TOKEN_ENCRYPTION_KEY=<la vieja>
WHATSAPP_TOKEN_ENCRYPTION_KEY_PREVIOUS=<la nueva>
```

Así se leen las dos poblaciones. **Volver solo a la clave vieja dejaría
ilegible todo lo ya recifrado** — es el límite real del rollback y está
comprobado en `test/token-rotation.e2e-spec.ts`.

**Después del paso 6**: ya no hay rollback por configuración. Para volver
atrás habría que restaurar el backup del paso 0 o reconectar los números.

## Qué hacer con una integración ilegible

Significa que su token no se puede descifrar con ninguna de las dos claves —
normalmente porque se rotó antes sin la clave anterior configurada. No es
recuperable desde el CRM: hay que **volver a conectar el número** desde
Ajustes → WhatsApp, que genera un token nuevo.

El script identifica cuáles son por su id de integración y empresa; nunca
imprime el contenido.
