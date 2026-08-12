/**
 * Hueco de carga con la forma de lo que va a llegar.
 *
 * Existe para que una pantalla densa no aparezca de golpe: con seis bloques
 * que cargan a distinta velocidad, mostrar «Cargando…» en cada uno convierte el
 * inicio en una lista de avisos. Un esqueleto reserva el sitio y evita además
 * que el contenido salte cuando llegan los datos.
 *
 * `animate-pulse` de Tailwind es una animación CSS, así que la regla global de
 * `prefers-reduced-motion` en `globals.css` ya la detiene: quien pide menos
 * movimiento ve el hueco quieto, que sigue cumpliendo su función.
 */
export function Skeleton({
  className = '',
  ...resto
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      // `aria-hidden`: es andamiaje visual. Quien usa lector de pantalla ya
      // recibe el estado por el `aria-busy` de la región que lo contiene.
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-neutral-200 ${className}`}
      {...resto}
    />
  );
}

/** Varias líneas de texto, la última más corta, como un párrafo de verdad. */
export function SkeletonTexto({ lineas = 3 }: { lineas?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lineas }, (_, i) => (
        <Skeleton
          key={i}
          className={`h-3 ${i === lineas - 1 ? 'w-2/3' : 'w-full'}`}
        />
      ))}
    </div>
  );
}
