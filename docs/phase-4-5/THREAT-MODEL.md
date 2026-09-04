# Fase 4.5 — Modelo de amenazas

Qué ataca esta fase, qué la ataca a ella y qué queda fuera.

## Qué mitiga

**Contraseña robada o reutilizada.** Es el motivo de la fase. Con una
contraseña filtrada, un atacante llega hasta el paso 2 y se topa con un código
que solo existe en el buzón de la persona. Sin ese código no hay sesión.

**Credential stuffing.** Probar miles de contraseñas ya costaba caro (límite de
peticiones por IP). Ahora, además, acertar no basta.

**Sesión abierta antes de tiempo.** El invariante que sostiene todo: el reto no
autentica. La sesión, el access token y la cookie de refresh nacen únicamente
al consumir el código.

## Amenazas contra el propio mecanismo

| Amenaza | Defensa |
|---|---|
| Adivinar el código por fuerza bruta | 6 dígitos, 5 intentos por reto, 10 minutos de vida, límite de peticiones `auth` en los tres endpoints. Cinco intentos sobre un millón de combinaciones. |
| Leer la base y calcular códigos | Solo se guarda `HMAC-SHA256(challengeId:código)` con un secreto exclusivo. Un SHA-256 simple sería una tabla precalculable; el HMAC exige el secreto, que no está en la base. |
| Reutilizar un código (replay) | Consumo con escritura condicional sobre `consumedAt IS NULL`. El segundo intento no encuentra fila que actualizar. |
| Dos verificaciones simultáneas | El intento se descuenta con una escritura condicional antes de comparar y el consumo es otra: como mucho una gana. |
| Fabricar un reto sin contraseña | El reto solo se crea después de validar la contraseña. No hay endpoint que lo cree por sí solo. |
| Usar el reto de otra persona | El reto no acepta `userId` ni correo: la cuenta se deduce de la fila. Un identificador ajeno responde el mismo error genérico. |
| Descubrir si un correo existe | El login responde igual ante contraseña incorrecta y cuenta inexistente, y en ninguno de los dos casos crea reto. La respuesta con reto solo llega tras acertar la contraseña. |
| Deducir el estado por el mensaje | Un único texto para código incorrecto, vencido, ya usado o inexistente. |
| Deducir el estado por el tiempo | Comparación en tiempo constante. |
| Bombardear el buzón | Espera de 60 segundos entre reenvíos, y cada reenvío invalida el código anterior. |
| Robar el token del dispositivo desde JavaScript | Cookie `HttpOnly`: ningún script la lee. |
| Escribirla desde un subdominio vecino | Prefijo `__Host-` con HTTPS: el navegador exige `Secure`, `Path=/` y ausencia de `Domain`. |
| Mover la cookie a otra cuenta | La búsqueda exige el hash **y** el `userId`. El token de A no vale para B. |
| Robar la base y fabricar cookies | Solo se guarda el SHA-256 del token, que es de 256 bits aleatorios. |
| Mantener el acceso tras un robo de contraseña | Restablecer la contraseña revoca sesiones **y** dispositivos, en la misma transacción. |
| Un administrador expulsa a alguien y este vuelve sin código | La revocación masiva por usuario o por empresa también retira la confianza. |
| Una cuenta desactivada que se reactiva conserva el atajo | Desactivar revoca sesiones y dispositivos. |
| El correo se cae y deja a la persona en el limbo | Si el envío falla, el reto se revoca y se responde 503 con un texto claro. No queda un reto irresoluble. |
| Encender la función sin poder cumplirla | El arranque falla si no hay secreto o SMTP. Si el secreto desapareciera en caliente, la verificación queda inactiva (se registra el error) y el acceso sigue siendo el de siempre. |
| Saltarse la verificación desde el cliente | La decisión es del servidor. No hay cabecera, parámetro, código universal ni endpoint de prueba. |

## Lo que esta fase NO defiende

- **Phishing en tiempo real.** Quien engañe a alguien para que teclee su
  contraseña y el código en una página falsa entra. La defensa contra eso son
  las llaves de seguridad (WebAuthn), fuera de alcance aquí.
- **Correo comprometido.** Si el atacante ya lee el buzón, recibe el código.
  El segundo factor es «algo que recibes», no «algo que posees».
- **Dispositivo comprometido.** Con el equipo tomado, la cookie de confianza y
  la sesión están al alcance. Por eso la casilla está desmarcada por defecto y
  el texto advierte de no usarla en equipos compartidos.
- **SIM swapping**: no aplica, no se usa SMS.

## Datos y privacidad

El reto guarda lo mismo que una sesión: hash del identificador de dispositivo,
IP truncada, navegador y sistema ya interpretados. Nunca la cookie en claro, la
IP completa ni el agente de usuario crudo. El correo completo no viaja en las
respuestas del flujo: solo su forma enmascarada.

## Decisiones deliberadas

1. **Cerrar sesión no retira la confianza.** El segundo factor es del equipo.
   Para retirarla existe un endpoint explícito.
2. **El acceso con dispositivo confiable no alarga su vigencia.** Los 30 días
   cuentan desde que se concedió; renovarlos en cada uso convertiría un
   dispositivo activo en confiable para siempre.
3. **Sin cola de correo.** Se reutiliza el envío directo del producto. Un fallo
   se convierte en error visible y en reto revocado, no en un reintento
   silencioso que dejaría dos códigos vivos.
4. **La allowlist es de servidor.** Permite probar en staging con una cuenta
   controlada sin exponer correos en el repositorio ni aceptar nada del
   navegador.
