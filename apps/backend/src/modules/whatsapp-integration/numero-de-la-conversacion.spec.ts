import 'reflect-metadata';
import { WhatsAppIntegrationService } from './whatsapp-integration.service';

/**
 * Responder POR DONDE ENTRO.
 *
 * Una empresa con dos números —Ventas y Soporte— recibía por los dos y
 * respondía siempre desde el principal. Quien escribía a Soporte veía llegar
 * la respuesta desde Ventas: un número que no reconoce, al que no escribió, y
 * que en WhatsApp aparece como una conversación distinta.
 */
describe('el numero de una conversacion', () => {
  let prisma: any;
  let service: WhatsAppIntegrationService;

  beforeEach(() => {
    prisma = { conversation: { findFirst: jest.fn() } };
    service = new WhatsAppIntegrationService(prisma);
  });

  it('devuelve el numero por el que entro', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      whatsappIntegration: {
        phoneNumberId: 'phone-soporte',
        status: 'CONNECTED',
      },
    });

    await expect(
      service.findPhoneNumberIdForConversation('company-a', 'conv-1'),
    ).resolves.toBe('phone-soporte');
  });

  it('acota SIEMPRE por empresa: un conversationId ajeno no elige su numero', async () => {
    prisma.conversation.findFirst.mockResolvedValue(null);

    await service.findPhoneNumberIdForConversation('company-a', 'conv-de-b');

    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv-de-b', companyId: 'company-a' },
      }),
    );
  });

  it('sin numero asociado cae al principal, que es el comportamiento de siempre', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      whatsappIntegration: null,
    });

    await expect(
      service.findPhoneNumberIdForConversation('company-a', 'conv-vieja'),
    ).resolves.toBeUndefined();
  });

  it('un numero desconectado cae al principal en vez de fallar el envio', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      whatsappIntegration: {
        phoneNumberId: 'phone-viejo',
        status: 'DISCONNECTED',
      },
    });

    // El cliente recibe la respuesta, aunque sea desde otro numero. Mejor eso
    // que no recibirla.
    await expect(
      service.findPhoneNumberIdForConversation('company-a', 'conv-1'),
    ).resolves.toBeUndefined();
  });

  it('no consulta con datos vacios', async () => {
    await expect(
      service.findPhoneNumberIdForConversation('', 'conv-1'),
    ).resolves.toBeUndefined();
    await expect(
      service.findPhoneNumberIdForConversation('company-a', '  '),
    ).resolves.toBeUndefined();

    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
  });

  it('nunca pide el token al resolver el numero', async () => {
    prisma.conversation.findFirst.mockResolvedValue(null);

    await service.findPhoneNumberIdForConversation('company-a', 'conv-1');

    const select = prisma.conversation.findFirst.mock.calls[0][0].select;
    expect(JSON.stringify(select)).not.toContain('accessToken');
  });
});
