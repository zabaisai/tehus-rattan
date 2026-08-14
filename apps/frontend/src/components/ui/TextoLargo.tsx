/**
 * Un valor largo que puede saltar de línea SIN partirse a mitad de palabra.
 *
 * EXISTE PORQUE `break-words` corta donde le toca. En una columna de 190 px,
 * «PREVIEW_BRANDING_Muebles del Valle» quedaba como «…Mueb / les del Valle»,
 * «PREVIEW_BRANDING_Administrador» como «…A / dministrador» y un correo dejaba
 * una «d» sola en la línea siguiente. Que no haya desbordamiento horizontal no
 * justifica destrozar la lectura.
 *
 * La solución no es prohibir el salto —entonces el texto se sale de la caja—
 * sino decir DÓNDE puede saltar: justo después de los separadores que el propio
 * dato ya trae (`_`, `.`, `@`, `-`, `/`). Ahí el corte se lee como una pausa
 * natural, porque es donde una persona también lo leería partido.
 *
 * El valor íntegro va además en `title`: si en algún ancho acabara recortado,
 * sigue estando disponible sin tener que copiarlo a mano.
 */

/** Después de cuáles se puede saltar. El guion medio va aparte: ver abajo. */
const SEPARADORES = /([_@./])/;

/**
 * Trocea el valor en puntos de corte legibles.
 *
 * Un trozo de una sola letra sería exactamente el defecto que se quiere
 * evitar, así que se pega al anterior. Y un valor sin separadores —un nombre
 * normal, un teléfono— vuelve entero: no hay nada que partir.
 */
export function puntosDeCorte(valor: string | null | undefined): string[] {
  const texto = valor ?? '';
  if (!texto) return [];

  const crudos = texto.split(SEPARADORES);
  const trozos: string[] = [];

  for (const parte of crudos) {
    if (!parte) continue;
    // El separador se queda PEGADO al trozo anterior: «PREVIEW_» y no
    // «PREVIEW» + «_», que al saltar dejaría el guion bajo huérfano arriba.
    if (SEPARADORES.test(parte) && parte.length === 1 && trozos.length) {
      trozos[trozos.length - 1] += parte;
    } else {
      trozos.push(parte);
    }
  }

  // Nada de fragmentos de una letra: se funden con el trozo de al lado.
  const unidos: string[] = [];
  for (const t of trozos) {
    if (unidos.length && t.trim().length <= 1) unidos[unidos.length - 1] += t;
    else unidos.push(t);
  }

  return unidos;
}

export function TextoLargo({
  valor,
  mono = false,
  className = '',
}: {
  valor: string | null | undefined;
  /** Para teléfonos e importes: además evita cualquier corte. */
  mono?: boolean;
  className?: string;
}) {
  const texto = valor ?? '';
  // Los teléfonos y los importes van en una sola pieza: partir un número por
  // la mitad se lee mal y se copia peor.
  const trozos = mono ? [texto] : puntosDeCorte(texto);

  return (
    <span
      title={texto || undefined}
      // `break-normal`: solo se salta donde este componente lo permite.
      className={`min-w-0 break-normal ${mono ? 'font-mono' : ''} ${className}`}
    >
      {trozos.map((t, i) => (
        <span key={`${t}-${i}`}>
          {t}
          {i < trozos.length - 1 && <wbr />}
        </span>
      ))}
    </span>
  );
}
