"use client";

import { Check } from "lucide-react";

/**
 * Elegir un color VIÉNDOLO, no escribiendo su código.
 *
 * EXISTE PORQUE EL EMBUDO PEDÍA UN HEXADECIMAL. La administración de etapas
 * ofrecía un desplegable cuyas opciones eran, literalmente, «#0F766E» y
 * «#B45309»: para poner en verde la etapa «Ganado» había que saber qué color
 * es #0F766E. El §3.1 del plan maestro lo dice sin rodeos —«los códigos
 * hexadecimales no son la interfaz principal: se muestran swatches, nombre del
 * color y selector visual»— y el mockup 04 dibuja exactamente eso en su
 * ventana «Editar etapa».
 *
 * LOS COLORES SON LOS DE LA MARCA, NO UNA PALETA SUELTA. Los siete que había
 * antes estaban escritos a mano y tres de ellos —#0F766E, #B45309, #7C3AED—
 * no pertenecen a ninguna escala de TAKTO. Los de aquí son los seis tonos de
 * etapa que el paquete de marca ya define en `globals.css`, así que la misma
 * etapa se ve igual en el tablero, en la ficha y en un documento.
 *
 * Son `<input type="radio">` de verdad y no `<div>` con `onClick`: así las
 * flechas del teclado recorren la paleta, el foco se ve y un lector de
 * pantalla anuncia «Ganado, verde, seleccionado» sin que haya que construir
 * nada de eso a mano.
 */

export interface ColorDeEtapa {
  /** Lo que se guarda. Hexadecimal en mayúsculas, como en la base. */
  valor: string;
  /** Lo que se lee. El color TIENE NOMBRE; el código es el detalle técnico. */
  nombre: string;
}

/** Los tonos de etapa del paquete de marca. Mismo orden que en `globals.css`. */
export const COLORES_DE_ETAPA: readonly ColorDeEtapa[] = [
  { valor: "#6E7688", nombre: "Gris" },
  { valor: "#2A5FD6", nombre: "Azul" },
  { valor: "#C24A00", nombre: "Ámbar" },
  { valor: "#3B477E", nombre: "Navy" },
  { valor: "#0E8A5F", nombre: "Verde" },
  { valor: "#C42B2B", nombre: "Rojo" },
] as const;

/** El nombre de un color guardado. El hexadecimal, si no es uno de la marca. */
export function nombreDeColor(valor: string | null | undefined): string {
  if (!valor) return "sin color";
  const oficial = COLORES_DE_ETAPA.find(
    (c) => c.valor.toUpperCase() === valor.toUpperCase(),
  );
  return oficial ? oficial.nombre : valor.toUpperCase();
}

export function SelectorDeColor({
  valor,
  onChange,
  /** Distingue los grupos de radios cuando hay varias etapas en la pantalla. */
  grupo,
  etiqueta,
  disabled = false,
}: {
  valor: string | null;
  onChange: (valor: string | null) => void;
  grupo: string;
  etiqueta: string;
  disabled?: boolean;
}) {
  const seleccionado = valor?.toUpperCase() ?? null;

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-1.5 text-xs font-medium text-content-secondary">
        {etiqueta}
      </legend>

      <div className="flex flex-wrap items-center gap-1.5">
        {COLORES_DE_ETAPA.map((color) => {
          const activo = seleccionado === color.valor;
          return (
            <label
              key={color.valor}
              // El nombre va en el `title` ADEMÁS de en el texto accesible:
              // seis cuadrados de colores no se distinguen de memoria, y quien
              // ve bien tampoco tiene por qué adivinar cuál es «Ámbar».
              title={color.nombre}
              className="relative inline-flex cursor-pointer items-center justify-center"
            >
              <input
                type="radio"
                name={grupo}
                value={color.valor}
                checked={activo}
                onChange={() => onChange(color.valor)}
                // `sr-only` y no `hidden`: escondido de verdad, un radio deja
                // de ser enfocable y la paleta se queda sin teclado.
                className="peer sr-only"
              />
              <span className="sr-only">{color.nombre}</span>
              <span
                aria-hidden="true"
                style={{ backgroundColor: color.valor }}
                className={`flex h-7 w-7 items-center justify-center rounded-full border transition-[box-shadow,transform] duration-rapida ease-standard peer-focus-visible:ring-2 peer-focus-visible:ring-line-focus peer-focus-visible:ring-offset-2 ${
                  activo
                    ? "border-content-primary shadow-sm"
                    : "border-black/10 hover:scale-105 motion-reduce:hover:scale-100"
                }`}
              >
                {/* La marca de verificación, y no solo el borde: el estado no
                    puede depender únicamente del color (§3.1). */}
                {activo && <Check size={14} className="text-white" />}
              </span>
            </label>
          );
        })}

        {/* «Sin color» es un valor legítimo: la etapa se dibuja con el gris
            neutro del sistema. Sin esta opción, poner color sería
            irreversible desde la interfaz. */}
        <label className="inline-flex cursor-pointer items-center">
          <input
            type="radio"
            name={grupo}
            value=""
            checked={seleccionado === null}
            onChange={() => onChange(null)}
            className="peer sr-only"
          />
          <span
            className={`rounded-md border px-2 py-1 text-xs transition-colors duration-rapida ease-standard peer-focus-visible:ring-2 peer-focus-visible:ring-line-focus peer-focus-visible:ring-offset-1 ${
              seleccionado === null
                ? "border-content-primary bg-surface-subtle text-content-primary"
                : "border-line-default text-content-secondary hover:bg-surface-subtle"
            }`}
          >
            Sin color
          </span>
        </label>
      </div>
    </fieldset>
  );
}
