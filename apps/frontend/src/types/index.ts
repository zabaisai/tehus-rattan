export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'AGENT';

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