"use client";

import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  CircleCheck,
  Merge,
  MessageCircle,
  Pencil,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ContactoDeListado } from "@/lib/contacts";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button, clasesDeBoton } from "@/components/ui/Button";
import { TextoLargo } from "@/components/ui/TextoLargo";
import { Tooltip } from "@/components/ui/Tooltip";
import { antiguedadEnPalabras, timeAgo } from "@/lib/tiempo";

/**
 * LA TABLA DE CONTACTOS (mockup 02).
 *
 * Está fuera de la pantalla para poder probar la fila —qué enseña, a dónde
 * lleva, qué acciones ofrece a cada rol— sin montar la página entera con su
 * `useSearchParams`, sus consultas y sus diálogos.
 *
 * TODAS las columnas salen del contrato. El mockup dibuja además fotografías
 * de las personas: aquí van iniciales, porque el §3.1 del plan maestro
 * prohíbe fotos de perfil y rostros.
 */

/** «Contacto desde mar 2024», como en el mockup pero sin prometer «Cliente». */
export function desdeCuando(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "";
  return fecha.toLocaleDateString("es-CO", {
    month: "short",
    year: "numeric",
  });
}

function EstadoDelContacto({ archivado }: { archivado: boolean }) {
  // Texto E ICONO, nunca solo color: quien no distingue verde de gris tiene
  // que poder leer en qué estado está la ficha.
  return archivado ? (
    <Badge tone="neutral">
      <Archive size={11} aria-hidden="true" />
      Archivada
    </Badge>
  ) : (
    <Badge tone="success">
      <CircleCheck size={11} aria-hidden="true" />
      Activa
    </Badge>
  );
}

export interface AccionesDeFila {
  onArchivar: (c: ContactoDeListado) => void;
  onRestaurar: (c: ContactoDeListado) => void;
  onEditar: (c: ContactoDeListado) => void;
  onFusionar: (c: ContactoDeListado) => void;
}

/**
 * Un control de solo icono, explicado.
 *
 * Mismo tamaño que antes —el mockup 02 pone iconos discretos al final de la
 * fila, no botones con texto— pero ahora con nombre accesible, explicación al
 * ratón Y al foco de teclado, y anillo de foco visible.
 *
 * Sin `title`: era exactamente el defecto. Tarda un segundo, nunca aparece al
 * tabular y lo pinta el sistema operativo.
 */
function BotonDeIcono({
  icono: Icono,
  nombre,
  explicacion,
  onClick,
}: {
  icono: LucideIcon;
  /** El nombre accesible, con el contacto dentro: nunca «Editar» a secas. */
  nombre: string;
  explicacion: string;
  onClick: () => void;
}) {
  return (
    <Tooltip texto={explicacion}>
      <button
        type="button"
        onClick={onClick}
        aria-label={nombre}
        className="rounded p-1.5 text-content-disabled outline-none hover:bg-surface-subtle hover:text-content-primary focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1"
      >
        <Icono size={15} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

export function ContactosTabla({
  contactos,
  enPapelera,
  puedeFusionar,
  rutaDeRegreso,
  acciones,
}: {
  contactos: ContactoDeListado[];
  enPapelera: boolean;
  puedeFusionar: boolean;
  /** Dónde vuelve el perfil 360. Es la lista tal y como se está viendo. */
  rutaDeRegreso: string;
  acciones: AccionesDeFila;
}) {
  const nombreDe = (c: ContactoDeListado) => c.nombre || c.telefono;

  return (
    // `overflow-x-auto` en el contenedor de la tabla y no en la página: si una
    // columna no cupiera, se desplaza la tabla dentro de su caja y el
    // documento sigue sin tener barra horizontal.
    <div className="overflow-x-auto rounded-lg border border-line-default bg-surface-default">
      <table className="w-full min-w-[56rem] text-sm">
        <caption className="sr-only">
          {enPapelera
            ? "Contactos archivados, con el motivo y la fecha de archivo"
            : "Contactos activos, con su asesor, etapa y última interacción"}
        </caption>
        <thead>
          <tr className="border-b border-line-default bg-surface-subtle text-left text-xs text-content-secondary">
            <th scope="col" className="px-4 py-2.5 font-medium">
              Contacto
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Teléfono
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Etiquetas
            </th>
            {enPapelera ? (
              <>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Motivo
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Archivado
                </th>
              </>
            ) : (
              <>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Asesor
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Etapa actual
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Última interacción
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Tareas
                </th>
              </>
            )}
            <th scope="col" className="px-4 py-2.5 font-medium">
              Estado
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Acciones
            </th>
          </tr>
        </thead>
        <tbody>
          {contactos.map((c) => (
            <tr
              key={c.id}
              className="border-b border-line-default/60 last:border-0 hover:bg-surface-subtle"
            >
              <th scope="row" className="max-w-[16rem] px-4 py-2.5 font-normal">
                <div className="flex items-center gap-2.5">
                  <Avatar nombre={c.nombre} size="sm" />
                  <span className="min-w-0">
                    {/* La fila entera no es un enlace: dentro hay botones, y
                        anidar controles dentro de un enlace deja al teclado
                        sin forma de elegir cuál activa. El nombre SÍ lo es. */}
                    <Link
                      href={`/dashboard/contacts/${c.id}?volverA=${encodeURIComponent(rutaDeRegreso)}`}
                      className="block font-medium text-content-primary hover:text-brand-primary hover:underline"
                    >
                      <TextoLargo valor={nombreDe(c)} />
                    </Link>
                    <span className="block text-xs text-content-secondary">
                      Contacto desde {desdeCuando(c.creadoEn)}
                    </span>
                    {c.anonimizado && (
                      <span className="block text-xs text-content-secondary">
                        Datos personales eliminados
                      </span>
                    )}
                  </span>
                </div>
              </th>

              <td className="px-4 py-2.5 text-content-secondary">
                <TextoLargo valor={c.telefono} mono />
              </td>

              <td className="max-w-[12rem] px-4 py-2.5">
                {c.etiquetas.length === 0 ? (
                  <span className="text-content-disabled">—</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {c.etiquetas.map((e) => (
                      <Badge key={e} tone="info">
                        <TextoLargo valor={e} />
                      </Badge>
                    ))}
                  </span>
                )}
              </td>

              {enPapelera ? (
                <>
                  <td className="max-w-[14rem] px-4 py-2.5 text-content-secondary">
                    {c.motivoDeArchivo ? (
                      <TextoLargo valor={c.motivoDeArchivo} />
                    ) : (
                      <span className="text-content-disabled">
                        Sin motivo anotado
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-content-secondary">
                    {c.archivadoEn ? (
                      <time
                        dateTime={c.archivadoEn}
                        title={new Date(c.archivadoEn).toLocaleString("es-CO")}
                      >
                        {timeAgo(c.archivadoEn)}
                      </time>
                    ) : (
                      "—"
                    )}
                  </td>
                </>
              ) : (
                <>
                  <td className="max-w-[12rem] px-4 py-2.5">
                    {c.asesor ? (
                      <span className="flex items-center gap-2">
                        <Avatar nombre={c.asesor.nombre} size="sm" />
                        <span className="min-w-0 text-content-secondary">
                          <TextoLargo valor={c.asesor.nombre} />
                        </span>
                      </span>
                    ) : (
                      // Naranja de acento, como en el sistema: es la señal de
                      // «esto necesita que alguien lo tome».
                      <Badge tone="accent">Sin asignar</Badge>
                    )}
                  </td>

                  <td className="px-4 py-2.5">
                    {c.etapa ? (
                      <Badge tone="neutral">
                        <TextoLargo valor={c.etapa.nombre} />
                      </Badge>
                    ) : (
                      <span className="text-content-disabled">
                        Sin oportunidad abierta
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-2.5 text-content-secondary">
                    {c.ultimaInteraccionEn ? (
                      <time
                        dateTime={c.ultimaInteraccionEn}
                        title={new Date(c.ultimaInteraccionEn).toLocaleString(
                          "es-CO",
                        )}
                      >
                        <span aria-hidden="true">
                          {timeAgo(c.ultimaInteraccionEn)}
                        </span>
                        <span className="sr-only">
                          {antiguedadEnPalabras(c.ultimaInteraccionEn)}
                        </span>
                      </time>
                    ) : (
                      <span className="text-content-disabled">
                        Sin mensajes
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-2.5 text-right font-mono text-content-secondary">
                    {c.tareasPendientes}
                  </td>
                </>
              )}

              <td className="px-4 py-2.5">
                <EstadoDelContacto archivado={c.archivadoEn !== null} />
              </td>

              <td className="px-4 py-2.5">
                <div className="flex items-center justify-end gap-1">
                  {enPapelera ? (
                    // En la papelera solo se RESTAURA. La eliminación
                    // definitiva existe en el backend pero no se ofrece aquí:
                    // el alcance aprobado de este incremento es archivar y
                    // restaurar, y un borrado irreversible detrás de un icono
                    // de 15 px no es algo que se descubra por accidente.
                    <Tooltip
                      texto={
                        c.anonimizado
                          ? "Un contacto anonimizado ya no conserva datos personales, así que no se puede devolver a la lista de activos."
                          : `Devuelve a ${nombreDe(c)} a la lista de contactos activos.`
                      }
                    >
                      <Button
                        size="sm"
                        variant="secondary"
                        // `aria-disabled` y no `disabled`: un botón
                        // deshabilitado de verdad sale del orden de
                        // tabulación, y entonces quien navega con teclado no
                        // llega nunca al motivo. Ocultarlo era peor todavía:
                        // una fila sin ningún control no dice si falta un
                        // permiso, si está rota o si es que no se puede.
                        aria-disabled={c.anonimizado || undefined}
                        aria-label={`Restaurar a ${nombreDe(c)}`}
                        onClick={() => {
                          if (c.anonimizado) return;
                          acciones.onRestaurar(c);
                        }}
                        className={
                          c.anonimizado
                            ? "cursor-not-allowed opacity-50"
                            : undefined
                        }
                      >
                        <ArchiveRestore size={14} aria-hidden="true" />
                        Restaurar
                      </Button>
                    </Tooltip>
                  ) : (
                    <>
                      {c.conversacionId ? (
                        // Enlace de verdad y no un botón que navega: así
                        // funcionan «abrir en pestaña nueva», el clic central
                        // y el menú contextual del navegador.
                        <Link
                          href={`/dashboard/conversations?c=${c.conversacionId}&volverA=${encodeURIComponent(rutaDeRegreso)}`}
                          className={clasesDeBoton("secondary", "sm")}
                        >
                          <MessageCircle size={14} aria-hidden="true" />
                          Abrir chat
                        </Link>
                      ) : (
                        // No se dibuja un botón que no lleva a ningún sitio:
                        // se dice por qué no está.
                        <span className="text-xs text-content-disabled">
                          Sin conversación
                        </span>
                      )}
                      <BotonDeIcono
                        icono={Pencil}
                        nombre={`Editar a ${nombreDe(c)}`}
                        explicacion="Editar nombre y correo del contacto."
                        onClick={() => acciones.onEditar(c)}
                      />
                      {puedeFusionar && (
                        <BotonDeIcono
                          icono={Merge}
                          nombre={`Fusionar duplicado de ${nombreDe(c)}`}
                          explicacion="Unir este contacto con otro duplicado, decidiendo campo por campo."
                          onClick={() => acciones.onFusionar(c)}
                        />
                      )}
                      <BotonDeIcono
                        icono={Archive}
                        nombre={`Archivar a ${nombreDe(c)}`}
                        explicacion="Archivar: sale de la lista de activos y pasa a la papelera. Su historial se conserva."
                        onClick={() => acciones.onArchivar(c)}
                      />
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
