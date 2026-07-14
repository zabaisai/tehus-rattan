import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContactsService } from './contacts/contacts.service';
import { ConversationsService } from './conversations/conversations.service';
import { LeadsService } from './leads/leads.service';
import { LeadProductsService } from './leads/lead-products.service';
import { QuotesService } from './quotes/quotes.service';
import { MessagesService } from './messages/messages.service';
import { NotesService } from './notes/notes.service';
import { TasksService } from './tasks/tasks.service';

describe('multi-tenant ownership validations', () => {
  const companyId = 'company-a';

  describe('NotesService', () => {
    let prisma: any;
    let service: NotesService;

    beforeEach(() => {
      prisma = {
        lead: { findFirst: jest.fn() },
        conversation: { findFirst: jest.fn() },
        note: { create: jest.fn(), findMany: jest.fn() },
      };
      service = new NotesService(prisma);
    });

    it('rejects notes for leads outside the authenticated company', async () => {
      prisma.lead.findFirst.mockResolvedValue(null);

      await expect(
        service.create(companyId, 'user-a', {
          content: 'Follow up',
          leadId: 'lead-b',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.lead.findFirst).toHaveBeenCalledWith({
        where: { id: 'lead-b', companyId },
        select: { id: true },
      });
      expect(prisma.note.create).not.toHaveBeenCalled();
    });

    it('rejects blank leadId before creating a note', async () => {
      await expect(
        service.create(companyId, 'user-a', {
          content: 'Follow up',
          leadId: '   ',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.lead.findFirst).not.toHaveBeenCalled();
      expect(prisma.note.create).not.toHaveBeenCalled();
    });

    it('rejects blank conversationId before creating a note', async () => {
      await expect(
        service.create(companyId, 'user-a', {
          content: 'Follow up',
          conversationId: '   ',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.note.create).not.toHaveBeenCalled();
    });

    it('scopes findByLead to the authenticated company', async () => {
      prisma.note.findMany.mockResolvedValue([]);

      const result = await service.findByLead('lead-b', companyId);

      expect(prisma.note.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { leadId: 'lead-b', companyId },
        }),
      );
      expect(result).toEqual([]);
    });

    it('scopes findByConversation to the authenticated company', async () => {
      prisma.note.findMany.mockResolvedValue([]);

      const result = await service.findByConversation(
        'conversation-b',
        companyId,
      );

      expect(prisma.note.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { conversationId: 'conversation-b', companyId },
        }),
      );
      expect(result).toEqual([]);
    });
  });

  describe('MessagesService', () => {
    it('rejects message creation for conversations outside the authenticated company', async () => {
      const tx = {
        conversation: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
        message: { create: jest.fn() },
      };
      const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
      const service = new MessagesService(prisma as any);

      await expect(
        service.create({
          companyId,
          conversationId: 'conversation-b',
          body: 'Hello',
          direction: 'OUTBOUND',
          type: 'TEXT',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(tx.conversation.findFirst).toHaveBeenCalledWith({
        where: { id: 'conversation-b', companyId },
        select: { id: true },
      });
      expect(tx.message.create).not.toHaveBeenCalled();
    });

    it('scopes findByConversation to the authenticated company', async () => {
      const prisma = { message: { findMany: jest.fn().mockResolvedValue([]) } };
      const service = new MessagesService(prisma as any);

      const result = await service.findByConversation(
        'conversation-b',
        companyId,
      );

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { conversationId: 'conversation-b', conversation: { companyId } },
        }),
      );
      expect(result).toEqual([]);
    });
  });

  describe('ConversationsService', () => {
    it('rejects assigning a conversation to a user outside the authenticated company', async () => {
      const prisma = {
        conversation: {
          findFirst: jest.fn().mockResolvedValue({ id: 'conversation-a' }),
          update: jest.fn(),
        },
        user: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const service = new ConversationsService(prisma as any);

      await expect(
        service.update('conversation-a', companyId, {
          assignedTo: 'user-b',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-b', companyId, isActive: true },
        select: { id: true },
      });
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });

    it('rejects assigning a conversation to an inactive user in the same company', async () => {
      const prisma = {
        conversation: {
          findFirst: jest.fn().mockResolvedValue({ id: 'conversation-a' }),
          update: jest.fn(),
        },
        user: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const service = new ConversationsService(prisma as any);

      await expect(
        service.update('conversation-a', companyId, {
          assignedTo: 'user-inactive',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-inactive', companyId, isActive: true },
        select: { id: true },
      });
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });

    it('rejects blank assignedTo before updating a conversation', async () => {
      const prisma = {
        conversation: {
          findFirst: jest.fn().mockResolvedValue({ id: 'conversation-a' }),
          update: jest.fn(),
        },
        user: { findFirst: jest.fn() },
      };
      const service = new ConversationsService(prisma as any);

      await expect(
        service.update('conversation-a', companyId, {
          assignedTo: '   ',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });

    it('rejects reading a conversation belonging to another company', async () => {
      const prisma = {
        conversation: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const service = new ConversationsService(prisma as any);

      await expect(
        service.findById('conversation-b', companyId),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conversation-b', companyId },
        }),
      );
    });
  });

  describe('LeadsService', () => {
    const buildPrisma = (assignedUser: any = null) => {
      const prisma: any = {
        contact: { findFirst: jest.fn().mockResolvedValue({ id: 'contact-a' }) },
        pipelineStage: {
          findFirst: jest.fn().mockResolvedValue({ id: 'stage-a' }),
        },
        pipeline: {
          findFirst: jest.fn().mockResolvedValue({ id: 'pipeline-a' }),
        },
        user: { findFirst: jest.fn().mockResolvedValue(assignedUser) },
        lead: { create: jest.fn(), findFirst: jest.fn(), findUniqueOrThrow: jest.fn() },
        leadStageHistory: { create: jest.fn() },
      };
      prisma.$transaction = jest.fn((arg: any) =>
        Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
      );
      return prisma;
    };

    it('rejects assigning a lead to a user outside the authenticated company', async () => {
      const prisma = buildPrisma(null);
      const service = new LeadsService(prisma as any);

      await expect(
        service.create(companyId, 'user-creator', {
          title: 'New lead',
          contactId: 'contact-a',
          pipelineId: 'pipeline-a',
          stageId: 'stage-a',
          assignedTo: 'user-b',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-b', companyId, isActive: true },
        select: { id: true },
      });
      expect(prisma.lead.create).not.toHaveBeenCalled();
      expect(prisma.leadStageHistory.create).not.toHaveBeenCalled();
    });

    it('rejects assigning a lead to an inactive user in the same company', async () => {
      const prisma = buildPrisma(null);
      const service = new LeadsService(prisma as any);

      await expect(
        service.create(companyId, 'user-creator', {
          title: 'New lead',
          contactId: 'contact-a',
          pipelineId: 'pipeline-a',
          stageId: 'stage-a',
          assignedTo: 'user-inactive',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-inactive', companyId, isActive: true },
        select: { id: true },
      });
      expect(prisma.lead.create).not.toHaveBeenCalled();
      expect(prisma.leadStageHistory.create).not.toHaveBeenCalled();
    });

    it('rejects blank assignedTo before creating a lead', async () => {
      const prisma = buildPrisma(null);
      const service = new LeadsService(prisma as any);

      await expect(
        service.create(companyId, 'user-creator', {
          title: 'New lead',
          contactId: 'contact-a',
          pipelineId: 'pipeline-a',
          stageId: 'stage-a',
          assignedTo: '   ',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.lead.create).not.toHaveBeenCalled();
    });

    it('rejects reading a lead belonging to another company', async () => {
      const prisma = buildPrisma(null);
      prisma.lead.findFirst.mockResolvedValue(null);
      const service = new LeadsService(prisma as any);

      await expect(
        service.findById('lead-b', companyId),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lead-b', companyId },
        }),
      );
    });
  });

  describe('LeadProductsService', () => {
    let prisma: any;
    let service: LeadProductsService;

    beforeEach(() => {
      prisma = {
        lead: { findFirst: jest.fn().mockResolvedValue(null) },
        product: { findFirst: jest.fn() },
        leadProduct: {
          findMany: jest.fn(),
          findUnique: jest.fn(),
          findFirst: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
        },
      };
      service = new LeadProductsService(prisma);
    });

    it('rejects listing lead products for a lead outside the authenticated company', async () => {
      await expect(service.findAllForLead('lead-b', companyId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.leadProduct.findMany).not.toHaveBeenCalled();
    });

    it('rejects attaching a product outside the authenticated company to an owned lead', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-a' });
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.addProduct('lead-a', companyId, { productId: 'product-b' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: { id: 'product-b', companyId },
      });
      expect(prisma.leadProduct.create).not.toHaveBeenCalled();
    });

    it('rejects attaching a product to a lead outside the authenticated company', async () => {
      await expect(
        service.addProduct('lead-b', companyId, { productId: 'product-a' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.product.findFirst).not.toHaveBeenCalled();
    });

    it('rejects updating a lead product for a lead outside the authenticated company', async () => {
      await expect(
        service.update('lead-b', 'lp-1', companyId, { quantity: 2 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.leadProduct.update).not.toHaveBeenCalled();
    });

    it('rejects deleting a lead product for a lead outside the authenticated company', async () => {
      await expect(
        service.remove('lead-b', 'lp-1', companyId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.leadProduct.delete).not.toHaveBeenCalled();
    });
  });

  describe('QuotesService', () => {
    let prisma: any;
    let service: QuotesService;

    beforeEach(() => {
      prisma = {
        lead: { findFirst: jest.fn().mockResolvedValue(null) },
        leadProduct: { findMany: jest.fn() },
        quote: {
          findMany: jest.fn(),
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
        },
      };
      service = new QuotesService(prisma);
    });

    it('rejects creating a quote for a lead outside the authenticated company', async () => {
      await expect(
        service.createFromLead('lead-b', companyId, 'user-a', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.leadProduct.findMany).not.toHaveBeenCalled();
      expect(prisma.quote.create).not.toHaveBeenCalled();
    });

    it('rejects reading a quote belonging to another company', async () => {
      await expect(service.findById('quote-b', companyId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects updating a quote belonging to another company', async () => {
      await expect(
        service.update('quote-b', companyId, { discount: 10 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.quote.update).not.toHaveBeenCalled();
    });

    it('rejects deleting a quote belonging to another company', async () => {
      await expect(service.remove('quote-b', companyId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.quote.delete).not.toHaveBeenCalled();
    });
  });

  describe('TasksService', () => {
    let prisma: any;
    let service: TasksService;

    beforeEach(() => {
      prisma = {
        user: { findFirst: jest.fn().mockResolvedValue({ id: 'user-a' }) },
        lead: { findFirst: jest.fn().mockResolvedValue({ id: 'lead-a' }) },
        contact: {
          findFirst: jest.fn().mockResolvedValue({ id: 'contact-a' }),
        },
        task: { create: jest.fn(), findFirst: jest.fn() },
      };
      service = new TasksService(prisma);
    });

    it('rejects tasks linked to leads outside the authenticated company', async () => {
      prisma.lead.findFirst.mockResolvedValue(null);

      await expect(
        service.create(companyId, {
          title: 'Call customer',
          leadId: 'lead-b',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.lead.findFirst).toHaveBeenCalledWith({
        where: { id: 'lead-b', companyId },
        select: { id: true },
      });
      expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it('rejects tasks linked to contacts outside the authenticated company', async () => {
      prisma.contact.findFirst.mockResolvedValue(null);

      await expect(
        service.create(companyId, {
          title: 'Call customer',
          contactId: 'contact-b',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: { id: 'contact-b', companyId },
        select: { id: true },
      });
      expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it('rejects assigning a task to an inactive user in the same company', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.create(companyId, {
          title: 'Call customer',
          assignedTo: 'user-inactive',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-inactive', companyId, isActive: true },
        select: { id: true },
      });
      expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it('rejects blank assignedTo before creating a task', async () => {
      await expect(
        service.create(companyId, {
          title: 'Call customer',
          assignedTo: '   ',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it('rejects blank leadId before creating a task', async () => {
      await expect(
        service.create(companyId, {
          title: 'Call customer',
          leadId: '   ',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.lead.findFirst).not.toHaveBeenCalled();
      expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it('rejects blank contactId before creating a task', async () => {
      await expect(
        service.create(companyId, {
          title: 'Call customer',
          contactId: '   ',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.contact.findFirst).not.toHaveBeenCalled();
      expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it('rejects reading a task belonging to another company', async () => {
      prisma.task.findFirst.mockResolvedValue(null);

      await expect(
        service.findById('task-b', companyId),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-b', companyId },
        }),
      );
    });
  });

  describe('ContactsService', () => {
    it('rejects reading a contact belonging to another company', async () => {
      const prisma = {
        contact: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const service = new ContactsService(prisma as any);

      await expect(
        service.findById('contact-b', companyId),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: { id: 'contact-b', companyId },
      });
    });
  });
});
