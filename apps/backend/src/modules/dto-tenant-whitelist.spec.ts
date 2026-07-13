import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateContactDto } from './contacts/dto/create-contact.dto';
import { CreateLeadDto } from './leads/dto/create-lead.dto';
import { UpdateLeadDto } from './leads/dto/update-lead.dto';
import { CreateLeadProductDto } from './leads/dto/create-lead-product.dto';
import { UpdateLeadProductDto } from './leads/dto/update-lead-product.dto';
import { CreateQuoteFromLeadDto } from './quotes/dto/create-quote-from-lead.dto';
import { UpdateQuoteDto } from './quotes/dto/update-quote.dto';
import { CreateTaskDto } from './tasks/dto/create-task.dto';
import { UpdateTaskDto } from './tasks/dto/update-task.dto';
import { CreateNoteDto } from './notes/dto/create-note.dto';
import { UpdateConversationDto } from './conversations/dto/update-conversation.dto';
import { ConnectWhatsAppIntegrationDto } from './whatsapp-integration/dto/connect-whatsapp-integration.dto';

// Same configuration as the global ValidationPipe registered in src/main.ts
const buildPipe = () =>
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });

const bodyMetadata = (metatype: any): ArgumentMetadata => ({
  type: 'body',
  metatype,
  data: undefined,
});

async function expectCompanyIdRejected(metatype: any, validBody: object) {
  const pipe = buildPipe();
  const value = { ...validBody, companyId: 'company-x' };

  let caught: BadRequestException | undefined;
  try {
    await pipe.transform(value, bodyMetadata(metatype));
  } catch (error) {
    caught = error as BadRequestException;
  }

  expect(caught).toBeInstanceOf(BadRequestException);
  const response = caught!.getResponse() as { message: string[] };
  expect(
    response.message.some((m) => /companyId should not exist/.test(m)),
  ).toBe(true);
}

describe('DTO tenant field whitelist (real ValidationPipe)', () => {
  it('rejects companyId in CreateContactDto', async () => {
    await expectCompanyIdRejected(CreateContactDto, {
      phone: '+50255550000',
    });
  });

  it('rejects companyId in CreateLeadDto', async () => {
    await expectCompanyIdRejected(CreateLeadDto, {
      title: 'New lead',
      contactId: 'contact-a',
      pipelineId: 'pipeline-a',
      stageId: 'stage-a',
    });
  });

  it('rejects companyId in UpdateLeadDto', async () => {
    await expectCompanyIdRejected(UpdateLeadDto, {
      title: 'Updated lead',
    });
  });

  it('rejects companyId in CreateLeadProductDto', async () => {
    await expectCompanyIdRejected(CreateLeadProductDto, {
      productId: 'product-a',
    });
  });

  it('rejects companyId in UpdateLeadProductDto', async () => {
    await expectCompanyIdRejected(UpdateLeadProductDto, {
      quantity: 2,
    });
  });

  it('rejects companyId in CreateQuoteFromLeadDto', async () => {
    await expectCompanyIdRejected(CreateQuoteFromLeadDto, {
      title: 'Cotización inicial',
    });
  });

  it('rejects companyId in UpdateQuoteDto', async () => {
    await expectCompanyIdRejected(UpdateQuoteDto, {
      status: 'SENT',
    });
  });

  it('rejects companyId in CreateTaskDto', async () => {
    await expectCompanyIdRejected(CreateTaskDto, {
      title: 'Call customer',
    });
  });

  it('rejects companyId in UpdateTaskDto', async () => {
    await expectCompanyIdRejected(UpdateTaskDto, {
      status: 'COMPLETED',
    });
  });

  it('rejects companyId in CreateNoteDto', async () => {
    await expectCompanyIdRejected(CreateNoteDto, {
      content: 'Follow up with customer',
    });
  });

  it('rejects companyId in UpdateConversationDto', async () => {
    await expectCompanyIdRejected(UpdateConversationDto, {
      status: 'OPEN',
    });
  });

  it('rejects companyId in ConnectWhatsAppIntegrationDto', async () => {
    await expectCompanyIdRejected(ConnectWhatsAppIntegrationDto, {
      phoneNumberId: 'phone-a',
      accessToken: 'fake-meta-token',
    });
  });

  it('rejects status in ConnectWhatsAppIntegrationDto', async () => {
    const pipe = buildPipe();
    const value = {
      phoneNumberId: 'phone-a',
      accessToken: 'fake-meta-token',
      status: 'CONNECTED',
    };

    let caught: BadRequestException | undefined;
    try {
      await pipe.transform(value, bodyMetadata(ConnectWhatsAppIntegrationDto));
    } catch (error) {
      caught = error as BadRequestException;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    const response = caught!.getResponse() as { message: string[] };
    expect(
      response.message.some((m) => /status should not exist/.test(m)),
    ).toBe(true);
  });

  it('rejects accessTokenEncrypted in ConnectWhatsAppIntegrationDto', async () => {
    const pipe = buildPipe();
    const value = {
      phoneNumberId: 'phone-a',
      accessToken: 'fake-meta-token',
      accessTokenEncrypted: 'already-encrypted-value',
    };

    let caught: BadRequestException | undefined;
    try {
      await pipe.transform(value, bodyMetadata(ConnectWhatsAppIntegrationDto));
    } catch (error) {
      caught = error as BadRequestException;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    const response = caught!.getResponse() as { message: string[] };
    expect(
      response.message.some((m) =>
        /accessTokenEncrypted should not exist/.test(m),
      ),
    ).toBe(true);
  });

  it('accepts a valid body without companyId (control case)', async () => {
    const pipe = buildPipe();
    const validBody = { phone: '+50255550000', name: 'Jane Doe' };

    const result = await pipe.transform(
      validBody,
      bodyMetadata(CreateContactDto),
    );

    expect(result).toBeInstanceOf(CreateContactDto);
    expect(result.phone).toBe('+50255550000');
    expect(result.name).toBe('Jane Doe');
    expect((result as any).companyId).toBeUndefined();
  });
});
