export interface User {
  id: string;
  name: string;
  email: string;
  status: string;
  language: string;
  theme: string;
  isAdmin: boolean;
  isDemo: boolean;
  avatarUrl?: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  isDemo: boolean;
  role: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  isFavorite: boolean;
  updatedAt: string;
  campaignCount: number;
}

export interface Campaign {
  id: string;
  name: string;
  objective?: string | null;
  status: string;
  updatedAt: string;
}

export interface BrandKit {
  id?: string;
  brandName?: string;
  tagline?: string;
  description?: string;
  colors?: string[];
  fonts?: string[];
  tone?: string;
  audience?: string;
}

export interface Asset {
  id: string;
  originalName: string;
  mime: string;
  sizeBytes: number;
  url: string;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
}

export interface ChatReply {
  content: string;
  notice?: string;
}

export interface Session {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip?: string;
  userAgent?: string;
  current: boolean;
}

export interface AdminOverview {
  usersTotal: number;
  usersActive: number;
  usersBlocked: number;
  demoActive: number;
  projectsTotal: number;
  campaignsTotal: number;
  agentRunsTotal: number;
  errorsLast24h: number;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  status: string;
  isAdmin: boolean;
  isDemo: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  action: string;
  createdAt: string;
  meta?: Record<string, unknown> | null;
}
