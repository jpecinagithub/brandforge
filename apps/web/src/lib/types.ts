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

export interface Campaign {
  id: string;
  workspaceId: string;
  name: string;
  objective?: string | null;
  brief: string;
  audience: string;
  deliverables: CampaignDeliverable[];
  status: string;
  isFavorite: boolean;
  assetCount: number;
  updatedAt: string;
}

export type CampaignDeliverable = 'logo' | 'brand_kit' | 'print_assets' | 'landing_page';

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
  downloadUrl: string;
  available: boolean;
  kind?: string;
  width?: number | null;
  height?: number | null;
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

export interface AgentAvailability {
  available: boolean;
  reason?: 'not_configured' | 'quota_exhausted';
}

export interface LandingPage {
  id: string;
  campaignId: string;
  name: string;
  schema: unknown;
  previewUrl: string;
  publicUrl: string | null;
  publishedAt: string | null;
  verification: {
    status: 'ready' | 'needs_attention';
    checks: {
      headline: boolean;
      subheadline: boolean;
      callToAction: boolean;
      sections: boolean;
    };
  };
  createdAt: string;
  updatedAt?: string | null;
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
