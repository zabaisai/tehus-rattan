import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateContactDto } from './contacts/dto/create-contact.dto';
import { CreateLeadDto } from './leads/dto/create-lead.dto';
import { UpdateLeadDto } from './leads/dto/update-lead.dto';
import { CreateTaskDto } from './tasks/dto/create-task.dto';
import { UpdateTaskDto } from './tasks/dto/update-task.dto';
import { CreateNoteDto } from './notes/dto/create-note.dto';
import { UpdateConversationDto } from './conversations/dto/update-conversation.dto';

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
