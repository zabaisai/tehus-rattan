import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { ArchivarContactoDto } from './contacts/dto/archivar-contacto.dto';
import { ResolverHandoffDto } from './conversations/dto/resolver-handoff.dto';
import {
  CambiarEstadoDto,
  KillSwitchDto,
  ReiniciarBreakerDto,
  UsarPlantillaDto,
  ValidarGrafoDto,
} from './flowbot/api/dto/flowbot.dto';

// Mismo pipe global que src/main.ts. Estos DTOs sustituyen a objetos inline que
// el pipe NO validaba (metatype Object). Ahora rechazan campos desconocidos,
// tipos incorrectos y longitudes excesivas.
const buildPipe = () =>
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });

const meta = (metatype: any): ArgumentMetadata => ({
  type: 'body',
  metatype,
  data: undefined,
});

async function rejects(metatype: any, body: object, pattern?: RegExp) {
  const pipe = buildPipe();
  let caught: BadRequestException | undefined;
  try {
    await pipe.transform(body, meta(metatype));
  } catch (e) {
    caught = e as BadRequestException;
  }
  expect(caught).toBeInstanceOf(BadRequestException);
  if (pattern) {
    const msgs = (caught!.getResponse() as { message: string[] }).message;
    expect(msgs.some((m) => pattern.test(m))).toBe(true);
  }
}

async function accepts(metatype: any, body: object) {
  const pipe = buildPipe();
  await expect(pipe.transform(body, meta(metatype))).resolves.toBeDefined();
}

describe('DTOs convertidos desde @Body() inline — validación', () => {
  it('rechaza un campo desconocido (whitelist)', async () => {
    await rejects(
      ArchivarContactoDto,
      { motivo: 'ok', companyId: 'x' },
      /companyId should not exist/,
    );
    await rejects(
      KillSwitchDto,
      { activo: true, extra: 1 },
      /should not exist/,
    );
  });

  it('rechaza tipos incorrectos', async () => {
    await rejects(ResolverHandoffDto, { resumeBot: 'sí' });
    await rejects(KillSwitchDto, { activo: 'true' });
    await rejects(CambiarEstadoDto, { estado: 123 });
    await rejects(ValidarGrafoDto, { graph: 'no-es-objeto' });
  });

  it('rechaza longitudes excesivas', async () => {
    await rejects(ArchivarContactoDto, { motivo: 'x'.repeat(501) });
    await rejects(ReiniciarBreakerDto, { motivo: 'x'.repeat(301) });
    await rejects(UsarPlantillaDto, { nombre: 'x'.repeat(121) });
    await rejects(CambiarEstadoDto, { estado: 'x'.repeat(41) });
  });

  it('acepta cuerpos válidos', async () => {
    await accepts(ArchivarContactoDto, { motivo: 'duplicado' });
    await accepts(ArchivarContactoDto, {}); // motivo opcional
    await accepts(ResolverHandoffDto, { resumeBot: true });
    await accepts(KillSwitchDto, { activo: false });
    await accepts(UsarPlantillaDto, { nombre: 'Mi bot' });
    await accepts(CambiarEstadoDto, { estado: 'ACTIVE' });
    await accepts(ValidarGrafoDto, { graph: { nodes: [] } });
  });
});
