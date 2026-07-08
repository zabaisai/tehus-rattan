export type Role = "SUPER_ADMIN" | "ADMIN" | "AGENT";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  companyId: string | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}
export interface Contact {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  tags: string[];
  isBlocked: boolean;
  createdAt: string;
}

export interface PipelineStage {
  id: string;
  name: string;
  order: number;
  color: string | null;
}

export interface Pipeline {
  id: string;
  name: string;
  isDefault: boolean;
  stages: PipelineStage[];
}

export interface Lead {
  id: string;
  title: string;
  value: number | null;
  status: "OPEN" | "WON" | "LOST";
  contact: Contact;
  agent: { id: string; name: string } | null;
  updatedAt: string;
}

export interface KanbanStage {
  id: string;
  name: string;
  order: number;
  color: string | null;
  totalValue: number;
  leadCount: number;
  leads: Lead[];
}

export interface KanbanData {
  pipeline: { id: string; name: string };
  stages: KanbanStage[];
}
export type MessageDirection = "INBOUND" | "OUTBOUND";
export type MessageStatus =
  | "QUEUED"
  | "SENDING"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED"
  | "RECEIVED";
export type ConversationStatus =
  | "OPEN"
  | "PENDING"
  | "RESOLVED"
  | "CLOSED"
  | "ARCHIVED";

export interface Message {
  id: string;
  body: string | null;
  type: string;
  direction: MessageDirection;
  status: MessageStatus;
  createdAt: string;
}

export interface Conversation {
  id: string;
  status: ConversationStatus;
  stage: string | null;
  isPaused: boolean;
  channel: string;
  lastMessageAt: string | null;
  updatedAt: string;
  contact: Contact;
  agent: { id: string; name: string } | null;
  messages?: Message[];
}

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type TaskType = "TASK" | "FOLLOW_UP" | "CALL" | "MEETING";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: TaskPriority;
  type: TaskType;
  status: TaskStatus;
  lead: { id: string; title: string } | null;
  contact: { id: string; name: string | null } | null;
  agent: { id: string; name: string } | null;
}
export interface AnalyticsOverview {
  leadsThisMonth: number;
  openValue: number;
  wonValue: number;
  lostValue: number;
  wonCount: number;
  lostCount: number;
  conversionRate: number;
}

export interface LeadsByStage {
  stageId: string;
  stageName: string;
  count: number;
  totalValue: number;
}

export interface AgentPerformance {
  agentId: string;
  agentName: string;
  openLeads: number;
  wonCount: number;
  wonValue: number;
  lostCount: number;
}

export interface LostReason {
  reason: string;
  count: number;
}

export type WhatsAppIntegrationStatus =
  | "PENDING"
  | "CONNECTED"
  | "DISCONNECTED"
  | "REVOKED";

export interface WhatsAppIntegration {
  id: string;
  companyId: string;
  displayPhoneNumber: string | null;
  phoneNumberId: string;
  wabaId: string | null;
  status: WhatsAppIntegrationStatus;
  connectedAt: string | null;
  disconnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectWhatsAppIntegrationPayload {
  phoneNumberId: string;
  accessToken: string;
  displayPhoneNumber?: string;
  wabaId?: string;
}

export type CompanyStatus = "ACTIVE" | "SUSPENDED" | "DELETED";

export interface PlatformCompanyListItem {
  id: string;
  name: string;
  phone: string | null;
  status: CompanyStatus;
  createdAt: string;
  updatedAt: string;
  totalUsers: number;
  activeUsers: number;
  totalContacts: number;
  totalLeads: number;
  totalConversations: number;
  whatsappConnected: boolean;
}

export interface PlatformCompanyUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface PlatformCompanyDetail {
  id: string;
  name: string;
  phone: string | null;
  status: CompanyStatus;
  createdAt: string;
  updatedAt: string;
  users: {
    total: number;
    items: PlatformCompanyUser[];
  };
  counts: {
    contacts: number;
    leads: number;
    conversations: number;
    tasks: number;
    products: number;
  };
  whatsapp: {
    connected: boolean;
    status: string | null;
    phoneNumberId: string | null;
    displayPhoneNumber: string | null;
  };
}

export interface CreatePlatformCompanyPayload {
  companyName: string;
  companyPhone?: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

export interface PlatformCompanyCreated {
  id: string;
  name: string;
  phone: string | null;
  status: CompanyStatus;
  createdAt: string;
  updatedAt: string;
  admin: {
    id: string;
    name: string;
    email: string;
    role: Role;
    isActive: boolean;
    createdAt: string;
  };
}

export interface PlatformCompanySupportOverviewLead {
  id: string;
  title: string;
  status: string;
  stageName: string | null;
  assignedUser: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformCompanySupportOverviewConversation {
  id: string;
  status: string;
  channel: string;
  contact: { id: string; name: string | null } | null;
  assignedUser: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformCompanySupportOverviewTask {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  assignedUser: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformCompanySupportOverview {
  company: {
    id: string;
    name: string;
    phone: string | null;
    status: CompanyStatus;
    createdAt: string;
    updatedAt: string;
  };
  users: {
    total: number;
    active: number;
    items: PlatformCompanyUser[];
  };
  counts: {
    contacts: number;
    leads: number;
    conversations: number;
    tasks: number;
    products: number;
  };
  whatsapp: {
    connected: boolean;
    status: string | null;
    phoneNumberId: string | null;
    displayPhoneNumber: string | null;
  };
  recentLeads: PlatformCompanySupportOverviewLead[];
  recentConversations: PlatformCompanySupportOverviewConversation[];
  recentTasks: PlatformCompanySupportOverviewTask[];
  lastActivityAt: string | null;
}

export type SupportSessionStatus = "ACTIVE" | "ENDED" | "EXPIRED";

export interface PlatformSupportSession {
  id: string;
  actorUserId?: string;
  companyId: string;
  company: { id: string; name: string; status: CompanyStatus };
  reason: string;
  status: SupportSessionStatus;
  expiresAt: string;
  endedAt: string | null;
  createdAt: string;
}

export interface PlatformSupportConversation {
  id: string;
  status: string;
  channel: string;
  contact: { id: string; name: string | null } | null;
  assignedUser: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSupportSessionPayload {
  companyId: string;
  reason: string;
}

export interface PlatformSupportMessage {
  id: string;
  direction: string;
  type: string;
  status: string;
  body: string | null;
  createdAt: string;
}

export interface PlatformSupportConversationDetail {
  conversation: {
    id: string;
    status: string;
    channel: string;
    createdAt: string;
    updatedAt: string;
    contact: { id: string; name: string | null } | null;
    assignedUser: { id: string; name: string } | null;
  };
  messages: PlatformSupportMessage[];
  page: number;
  limit: number;
}

export interface PlatformAuditLog {
  id: string;
  actorUserId: string | null;
  actorRole: Role;
  actor: { id: string; name: string; email: string } | null;
  affectedCompanyId: string | null;
  affectedCompany: { id: string; name: string } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}
