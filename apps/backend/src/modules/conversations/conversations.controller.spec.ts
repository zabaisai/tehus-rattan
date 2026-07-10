import { ConversationsController } from './conversations.controller';

describe('ConversationsController', () => {
  let conversationsService: any;
  let messagesService: any;
  let whatsappService: any;
  let controller: ConversationsController;

  const conversation = {
    id: 'conv-1',
    companyId: 'company-a',
    contact: { id: 'contact-1', name: 'Cliente', phone: '50255551111' },
  };

  const buildRequest = () => ({
    user: { companyId: 'company-a' },
  });

  beforeEach(() => {
    conversationsService = {
      findById: jest.fn().mockResolvedValue(conversation),
    };
    messagesService = {
      create: jest.fn((data: any) => Promise.resolve({ id: 'msg-1', ...data })),
    };
    whatsappService = {
      sendMessage: jest.fn(),
    };

    controller = new ConversationsController(
      conversationsService,
      messagesService,
      whatsappService,
    );
  });

  describe('POST /:id/send', () => {
    it('creates an OUTBOUND SENT message with the wamid when WhatsApp accepts the message', async () => {
      whatsappService.sendMessage.mockResolvedValue('wamid.123');

      const result = await controller.sendWhatsApp(
        'conv-1',
        buildRequest(),
        { message: 'Hola, ya tenemos tu pedido listo' },
      );

      expect(whatsappService.sendMessage).toHaveBeenCalledWith(
        'company-a',
        '50255551111',
        'Hola, ya tenemos tu pedido listo',
      );
      expect(messagesService.create).toHaveBeenCalledWith({
        companyId: 'company-a',
        conversationId: 'conv-1',
        body: 'Hola, ya tenemos tu pedido listo',
        direction: 'OUTBOUND',
        type: 'TEXT',
        status: 'SENT',
        wamid: 'wamid.123',
      });
      expect(result.status).toBe('SENT');
    });

    it('creates an OUTBOUND FAILED message (never SENT) when WhatsApp fails, keeping the original body', async () => {
      whatsappService.sendMessage.mockRejectedValue(
        new Error('No se pudo enviar el mensaje de WhatsApp'),
      );

      const result = await controller.sendWhatsApp(
        'conv-1',
        buildRequest(),
        { message: 'Mensaje que el asesor intento enviar' },
      );

      expect(messagesService.create).toHaveBeenCalledWith({
        companyId: 'company-a',
        conversationId: 'conv-1',
        body: 'Mensaje que el asesor intento enviar',
        direction: 'OUTBOUND',
        type: 'TEXT',
        status: 'FAILED',
      });
      expect(result.status).toBe('FAILED');
      expect(result.body).toBe('Mensaje que el asesor intento enviar');
      expect(result.status).not.toBe('SENT');
    });

    it('does not create any message when the conversation does not belong to the company', async () => {
      conversationsService.findById.mockRejectedValue(
        new Error('Conversacion no encontrada'),
      );

      await expect(
        controller.sendWhatsApp('conv-1', buildRequest(), {
          message: 'Hola',
        }),
      ).rejects.toThrow('Conversacion no encontrada');

      expect(whatsappService.sendMessage).not.toHaveBeenCalled();
      expect(messagesService.create).not.toHaveBeenCalled();
    });
  });
});
