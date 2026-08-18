import { WhatsappService } from '../../modules/whatsapp/whatsapp.service';
import { FlowBotIntakeService } from '../../modules/flowbot/engine/flowbot.intake';
import { ModoDemoError } from './modo-demo.service';
import { dobleModoDemo } from './modo-demo.doble';
import axios from 'axios';

jest.mock('axios');
const axiosMock = axios as jest.Mocked<typeof axios>;

/**
 * EL BLOQUEO NO SE PUEDE ABRIR DESDE EL ENTORNO.
 *
 * Es la garantia que pide el incremento y la que de verdad importa: aunque
 * alguien ponga `FLOWBOT_REAL_WHATSAPP_ENABLED=true`, apague el dry-run y
 * llene las allowlists —por prisa, por copiar un `.env` de otro sitio, por
 * probar un envio real con una empresa de verdad—, la empresa demo sigue sin
 * poder mandar nada. El guardarrail pregunta por la EMPRESA, no por el
 * proceso.
 *
 * Y se corta ANTES de la red: lo que se comprueba no es que Meta devuelva un
 * error, sino que no se llega a llamar a Meta.
 */
describe('modo demo con las banderas globales abiertas de par en par', () => {
  const anterior = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    // Todo abierto, a proposito.
    process.env.FLOWBOT_REAL_WHATSAPP_ENABLED = 'true';
    process.env.FLOWBOT_WHATSAPP_DRY_RUN = 'false';
    process.env.FLOWBOT_WHATSAPP_COMPANY_ALLOWLIST = 'demo-1';
    process.env.FLOWBOT_WHATSAPP_PHONE_ALLOWLIST = '1234567890';
    process.env.FLOWBOT_WHATSAPP_RECIPIENT_ALLOWLIST = '573001110000';
    process.env.WHATSAPP_EMBEDDED_SIGNUP_ENABLED = 'true';
    process.env.PASSWORD_RESET_ENABLED = 'true';
  });

  afterAll(() => {
    process.env = anterior;
  });

  function whatsapp(esDemo: boolean) {
    const integracion = {
      findConnectedByCompanyId: jest.fn().mockResolvedValue({
        phoneNumberId: '1234567890',
        accessTokenEncrypted: 'cifrado',
      }),
      findConnectedByCompanyAndPhoneNumberId: jest.fn(),
      findPhoneNumberIdForConversation: jest.fn(),
    };
    const crypto = { decrypt: jest.fn().mockReturnValue('token-en-claro') };
    const config = {
      get: (k: string) =>
        k === 'WHATSAPP_GRAPH_API_VERSION' ? 'v20.0' : undefined,
    };
    return new WhatsappService(
      integracion as never,
      crypto as never,
      config as never,
      dobleModoDemo(esDemo),
    );
  }

  it('una empresa DEMO no envia, y no se llama a Meta', async () => {
    const svc = whatsapp(true);

    await expect(
      svc.sendMessage('demo-1', '573001110000', 'hola'),
    ).rejects.toThrow(ModoDemoError);

    // Lo que de verdad se comprueba: no hubo peticion de red.
    expect(axiosMock.post).not.toHaveBeenCalled();
  });

  it('el token de la empresa demo ni siquiera se descifra', async () => {
    // Cortar despues de descifrar dejaria el token en memoria sin necesidad.
    const integracion = {
      findConnectedByCompanyId: jest.fn(),
      findConnectedByCompanyAndPhoneNumberId: jest.fn(),
    };
    const crypto = { decrypt: jest.fn() };
    const svc = new WhatsappService(
      integracion as never,
      crypto as never,
      { get: () => 'v20.0' } as never,
      dobleModoDemo(true),
    );

    await expect(
      svc.sendMessage('demo-1', '573001110000', 'hola'),
    ).rejects.toThrow(ModoDemoError);

    expect(crypto.decrypt).not.toHaveBeenCalled();
    expect(integracion.findConnectedByCompanyId).not.toHaveBeenCalled();
  });

  it('una empresa NORMAL sigue enviando igual: el guardarrail no la afecta', async () => {
    axiosMock.post.mockResolvedValue({
      data: { messages: [{ id: 'wamid.1' }] },
    });
    const svc = whatsapp(false);

    const wamid = await svc.sendMessage('real-1', '573001110000', 'hola');

    expect(wamid).toBe('wamid.1');
    expect(axiosMock.post).toHaveBeenCalledTimes(1);
  });

  it('los bots NO se ejecutan en una empresa demo, y no se rompe el mensaje entrante', async () => {
    const prisma = { conversation: { findFirst: jest.fn() } };
    const intake = new FlowBotIntakeService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      dobleModoDemo(true),
    );

    const r = await intake.atenderMensaje({
      companyId: 'demo-1',
      conversationId: 'conv-1',
      contactId: 'c-1',
      texto: 'hola',
    } as never);

    expect(r.atendido).toBe(false);
    expect(r.motivo).toBe('modo-demo');
    // No llego a mirar la conversacion siquiera: se corto antes.
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
  });
});
