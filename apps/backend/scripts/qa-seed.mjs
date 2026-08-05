/**
 * Datos de QA visual para FlowBot: empresa, admin, asesor, embudo y número.
 *
 * Se crea con Prisma directamente y con un prefijo propio para poder borrarlo
 * entero al final sin tocar nada más de la base local.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const PREFIJO = 'QA-FLOWBOT';
const CLAVE = 'QaFlowbot123!';

async function limpiar() {
  const empresas = await prisma.company.findMany({
    where: { name: { startsWith: PREFIJO } },
    select: { id: true },
  });
  const ids = empresas.map((e) => e.id);
  if (ids.length === 0) return;

  await prisma.auditLog.deleteMany({ where: { affectedCompanyId: { in: ids } } });
  await prisma.conversationHandoff.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.flowBotWait.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.flowBotExecutionStep.deleteMany({
    where: { execution: { companyId: { in: ids } } },
  });
  await prisma.flowBotExecution.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.flowBotTrigger.deleteMany({
    where: { flowBot: { companyId: { in: ids } } },
  });
  await prisma.flowBot.updateMany({
    where: { companyId: { in: ids } },
    data: { publishedVersionId: null },
  });
  await prisma.flowBotVersion.deleteMany({
    where: { flowBot: { companyId: { in: ids } } },
  });
  await prisma.flowBot.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.outboxEvent.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.message.deleteMany({
    where: { conversation: { companyId: { in: ids } } },
  });
  await prisma.task.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.leadStageHistory.deleteMany({
    where: { lead: { companyId: { in: ids } } },
  });
  await prisma.lead.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.customFieldValue.deleteMany({
    where: { definition: { companyId: { in: ids } } },
  });
  await prisma.customFieldDefinition.deleteMany({
    where: { companyId: { in: ids } },
  });
  await prisma.contact.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.pipelineStage.deleteMany({
    where: { pipeline: { companyId: { in: ids } } },
  });
  await prisma.pipeline.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.whatsAppIntegration.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.userSession.deleteMany({
    where: { user: { companyId: { in: ids } } },
  });
  await prisma.user.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.company.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  if (process.argv[2] === 'limpiar') {
    await limpiar();
    console.log('QA: datos borrados');
    return;
  }

  await limpiar();

  const empresa = await prisma.company.create({
    data: { name: `${PREFIJO} Muebles del Norte`, status: 'ACTIVE' },
  });

  const hash = await bcrypt.hash(CLAVE, 10);
  const admin = await prisma.user.create({
    data: {
      companyId: empresa.id,
      email: 'qa-flowbot-admin@ejemplo.test',
      password: hash,
      name: 'Camila Ruiz',
      role: 'ADMIN',
    },
  });
  await prisma.user.create({
    data: {
      companyId: empresa.id,
      email: 'qa-flowbot-agente@ejemplo.test',
      password: hash,
      name: 'Diego Torres',
      role: 'AGENT',
    },
  });

  const pipeline = await prisma.pipeline.create({
    data: { companyId: empresa.id, name: 'Ventas', order: 0, isDefault: true },
  });
  const etapas = ['Primer contacto', 'Cotizado', 'Negociación', 'Ganado'];
  const creadas = [];
  for (const [i, nombre] of etapas.entries()) {
    creadas.push(
      await prisma.pipelineStage.create({
        data: {
          pipelineId: pipeline.id,
          name: nombre,
          order: i,
          isInitial: i === 0,
          color: ['#131C4A', '#FF6A00', '#7C3AED', '#0F766E'][i],
          probability: [10, 40, 70, 100][i],
          type: i === 3 ? 'WON' : 'OPEN',
        },
      }),
    );
  }

  const numero = await prisma.whatsAppIntegration.create({
    data: {
      companyId: empresa.id,
      phoneNumberId: `${PREFIJO}-phone-1`,
      displayPhoneNumber: '+57 300 555 0101',
      label: 'Ventas',
      status: 'CONNECTED',
      accessTokenEncrypted: 'cifrado-falso-de-qa',
      isPrimary: true,
      order: 0,
    },
  });

  await prisma.customFieldDefinition.create({
    data: {
      companyId: empresa.id,
      key: 'ciudad',
      label: 'Ciudad',
      type: 'TEXT',
      entity: 'CONTACT',
      order: 0,
    },
  });

  console.log(
    JSON.stringify(
      {
        companyId: empresa.id,
        adminId: admin.id,
        email: 'qa-flowbot-admin@ejemplo.test',
        clave: CLAVE,
        pipelineId: pipeline.id,
        etapaInicial: creadas[0].id,
        etapaCotizado: creadas[1].id,
        whatsappIntegrationId: numero.id,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
