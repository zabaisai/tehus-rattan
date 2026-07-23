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

export interface CompanyUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
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

export interface LeadContactRef {
  id: string;
  name: string | null;
  phone: string;
}

export interface LeadStageRef {
  id: string;
  name: string;
  color: string | null;
}

export interface Lead {
  id: string;
  title: string;
  value: number | null;
  status: "OPEN" | "WON" | "LOST";
  lostReason: string | null;
  expectedCloseDate: string | null;
  createdAt: string;
  updatedAt: string;
  contactId: string;
  contact: LeadContactRef;
  pipelineId: string;
  stageId: string;
  stage?: LeadStageRef;
  assignedTo: string | null;
  agent: { id: string; name: string } | null;
}

export interface LeadDetail extends Omit<Lead, "contact" | "stage"> {
  contact: Contact;
  stage: LeadStageRef;
  pipeline: { id: string; name: string; isDefault: boolean };
}

export interface LeadStageHistoryEntry {
  id: string;
  fromStageId: string | null;
  toStageId: string;
  changedAt: string;
  user: { id: string; name: string } | null;
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
  leadId: string | null;
  contactId: string | null;
  assignedTo: string | null;
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

export interface Product {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  category: string | null;
  sku: string | null;
  stock: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductPayload {
  name: string;
  description?: string;
  price: number;
  category?: string;
  imageUrl?: string;
}

export interface ProductImportIssue {
  rowNumber: number;
  reason: string;
  rawName?: string;
}

export interface ProductImportSummary {
  totalRows: number;
  created: number;
  skipped: number;
  warnings: ProductImportIssue[];
  errors: ProductImportIssue[];
  products: Array<{
    id: string;
    name: string;
    category: string | null;
    price: number;
  }>;
}

export interface UpdateProductPayload {
  name?: string;
  description?: string;
  price?: number;
  category?: string;
  imageUrl?: string;
  isActive?: boolean;
}

export interface LeadProductRef {
  id: string;
  name: string;
  category: string | null;
  imageUrl: string | null;
  price: number;
  sku: string | null;
  code: string | null;
}

export interface LeadProductItem {
  id: string;
  leadId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  product: LeadProductRef;
}

export interface AddLeadProductPayload {
  productId: string;
  quantity?: number;
  unitPrice?: number;
  notes?: string;
}

export interface UpdateLeadProductPayload {
  quantity?: number;
  unitPrice?: number;
  notes?: string;
}

export type QuoteStatus = "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED";

export interface QuoteLeadRef {
  id: string;
  title: string;
  status: string;
}

// The fiscal identity of the company that OWNS the quote, resolved server-side
// and returned by GET /quotes/:id. This is the authoritative source for the
// printable document — never the viewer's own company or a hardcoded footer.
export interface QuoteCompanyIdentity {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  logoUrl: string | null;
  quoteFooter: string | null;
}

export interface QuoteItem {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  quoteId: string;
  productId: string | null;
}

export interface Quote {
  id: string;
  number: string;
  title: string | null;
  status: QuoteStatus;
  subtotal: number;
  discount: number;
  total: number;
  notes: string | null;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
  leadId: string;
  companyId: string;
  createdById: string | null;
  lead: QuoteLeadRef;
  // Only present on GET /quotes/:id — the list endpoint doesn't include items.
  items?: QuoteItem[];
  // Only present on GET /quotes/:id — the owning company's fiscal identity,
  // used to render the printable document.
  company?: QuoteCompanyIdentity;
}

export interface CreateQuoteFromLeadPayload {
  title?: string;
  notes?: string;
  validUntil?: string;
  discount?: number;
}

export interface UpdateQuotePayload {
  title?: string;
  status?: QuoteStatus;
  notes?: string;
  validUntil?: string;
  discount?: number;
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

export interface Company {
  id: string;
  name: string;
  phone: string | null;
  status: CompanyStatus;
  slug: string | null;
  logoUrl: string | null;
  secondaryLogoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  backgroundColor: string | null;
  businessType: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  website: string | null;
  description: string | null;
  settings: Record<string, unknown> | null;
  // Per-company fiscal identity (used to render quotes). All optional.
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  quoteFooter: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateCompanyPayload {
  name?: string;
  phone?: string;
  businessType?: string;
  city?: string;
  country?: string;
  email?: string;
  website?: string;
  description?: string;
  primaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  legalName?: string;
  taxId?: string;
  address?: string;
  quoteFooter?: string;
}

export interface CompanyLogoUploadResult {
  companyId: string;
  logoUrl: string | null;
  secondaryLogoUrl: string | null;
  message: string;
}

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

export type InvitationCodeStatus = "ACTIVE" | "USED" | "REVOKED" | "EXPIRED";

export interface InvitationCodeUserRef {
  id: string;
  name: string;
  email: string;
}

export interface InvitationCode {
  id: string;
  codePreview: string;
  intendedCompanyName: string;
  intendedContactEmail: string | null;
  status: InvitationCodeStatus;
  expiresAt: string | null;
  createdAt: string;
  createdByUserId: string;
  createdBy: InvitationCodeUserRef;
  usedAt: string | null;
  usedByUserId: string | null;
  usedBy: InvitationCodeUserRef | null;
  companyId: string | null;
  company: { id: string; name: string } | null;
  revokedAt: string | null;
  revokedByUserId: string | null;
  revokedBy: InvitationCodeUserRef | null;
}

export interface CreateInvitationCodePayload {
  intendedCompanyName: string;
  intendedContactEmail?: string;
  expiresAt?: string;
}

// The only response that ever carries the plaintext code — never persisted,
// never returned again by any other endpoint.
export interface CreateInvitationCodeResult extends InvitationCode {
  code: string;
}

// ─────────────────────────────────────────────
// ACTIVITY, SESSIONS & DEVICES (platform monitoring)
// ─────────────────────────────────────────────
export type UserSessionStatus = "ACTIVE" | "LOGGED_OUT" | "REVOKED" | "EXPIRED";
export type DeviceType = "DESKTOP" | "MOBILE" | "TABLET" | "UNKNOWN";
export type CompanyActivityStatus =
  | "ACTIVE_TODAY"
  | "ACTIVE_WEEK"
  | "ACTIVE_MONTH"
  | "INACTIVE";

export interface PlatformActivitySummary {
  companiesActiveToday: number;
  companiesActive7d: number;
  companiesActive30d: number;
  companiesInactive30d: number;
  totalCompanies: number;
  activeSessions: number;
  recognizedDevices: number;
  recentFailedLogins: number;
}

export interface PlatformSessionUserRef {
  id: string;
  name: string;
  email: string;
}

// The full IP, any raw user agent, and any token/hash/deviceId are never
// part of this type — the API never returns them, only the
// already-truncated ipPreview (e.g. "181.60.12.0") and the browser/OS/
// deviceType already parsed out of the user agent server-side.
export interface PlatformUserSession {
  id: string;
  userId: string;
  status: UserSessionStatus;
  ipPreview: string | null;
  browser: string | null;
  operatingSystem: string | null;
  deviceType: DeviceType;
  firstSeenAt: string;
  lastSeenAt: string;
  lastLoginAt: string;
  lastActivityAt: string;
  loggedOutAt: string | null;
  revokedAt: string | null;
  revokedByUserId: string | null;
  user: PlatformSessionUserRef;
}

export interface PlatformSessionsPage {
  items: PlatformUserSession[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PlatformRecentLogin {
  id: string;
  createdAt: string;
  ipPreview: string | null;
  browser: string | null;
  operatingSystem: string | null;
  deviceType: DeviceType;
  user: PlatformSessionUserRef;
}

export interface PlatformCompanyActivityNoHistory {
  company: { id: string; name: string };
  hasHistoricalData: false;
  message: string;
}

export interface PlatformCompanyActivityWithHistory {
  company: { id: string; name: string };
  hasHistoricalData: true;
  lastActivityAt: string | null;
  activityStatus: CompanyActivityStatus;
  totalUsers: number;
  usersActive7d: number;
  usersActive30d: number;
  usersActive90d: number;
  usersNeverLoggedIn: { id: string; name: string; email: string; role: Role }[];
  totalSessions: number;
  activeSessions: number;
  recognizedDevices: number;
  recentLogins: PlatformRecentLogin[];
  dailyHistory: { date: string; count: number }[];
}

export type PlatformCompanyActivity =
  | PlatformCompanyActivityNoHistory
  | PlatformCompanyActivityWithHistory;
