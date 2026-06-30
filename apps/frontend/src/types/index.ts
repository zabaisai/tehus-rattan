export type Role = "SUPER_ADMIN" | "ADMIN" | "AGENT";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  companyId?: string;
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
  status: 'OPEN' | 'WON' | 'LOST';
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