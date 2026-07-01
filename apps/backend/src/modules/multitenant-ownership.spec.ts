import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConversationsService } from './conversations/conversations.service';
import { LeadsService } from './leads/leads.service';
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
        note: { create: jest.fn() },
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

    it('rejects blank conversationId before creating a note', async () => {
      await expect(
        service.create(companyId, 'user-a', {
          content: 'Follow up',
          conversationId: '   ',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.note.create).not.toHaveBeenCalled();
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
  });

  describe('LeadsService', () => {
    it('rejects assigning a lead to a user outside the authenticated company', async () => {
      const prisma = {
        contact: { findFirst: jest.fn().mockResolvedValue({ id: 'contact-a' }) },
        pipelineStage: {
          findFirst: jest.fn().mockResolvedValue({ id: 'stage-a' }),
        },
        pipeline: {
          findFirst: jest.fn().mockResolvedValue({ id: 'pipeline-a' }),
        },
        user: { findFirst: jest.fn().mockResolvedValue(null) },
        lead: { create: jest.fn() },
      };
      const service = new LeadsService(prisma as any);

      await expect(
        service.create(companyId, {
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
        task: { create: jest.fn() },
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
  });
});
