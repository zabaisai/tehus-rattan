import Link from 'next/link';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * Lo que ve quien no puede estar en esta pantalla.
 *
 * NO ES UN ERROR, y por eso no se pinta en rojo: que un asesor no pueda
 * publicar bots es el funcionamiento normal del producto, no una avería. Lo
 * que sí hace falta es decir a quién pedírselo, porque el callejón sin salida
 * acaba en un mensaje a soporte que no hacía falta.
 */
export function SinPermiso({
  mensaje = 'Esta parte la administra quien lleva la cuenta de la empresa.',
}: {
  mensaje?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-300 bg-white py-16 text-center">
      <Lock size={26} className="text-neutral-400" strokeWidth={1.5} />
      <p className="max-w-sm text-sm text-neutral-500">{mensaje}</p>
      <Link href="/dashboard/flowbots">
        <Button variant="secondary" size="sm">
          Volver a los bots
        </Button>
      </Link>
    </div>
  );
}
