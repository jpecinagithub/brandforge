/**
 * @brandforge/shared — Zod schemas + TypeScript types shared by web and api.
 * Contracts are defined here so both sides validate the same shapes.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// API error envelope
// ---------------------------------------------------------------------------
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const PasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(200, 'Password is too long')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one digit');

export const EmailSchema = z
  .string()
  .trim()
  .email('Invalid email address')
  .max(320);

export const NameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(200);

export const RegisterInputSchema = z.object({
  name: NameSchema,
  email: EmailSchema,
  password: PasswordSchema,
});
export type RegisterInput = z.infer<typeof RegisterInputSchema>;

export const LoginInputSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Password is required').max(500),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const VerifyEmailInputSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});
export type VerifyEmailInput = z.infer<typeof VerifyEmailInputSchema>;

export const ResendVerificationInputSchema = z.object({
  email: EmailSchema,
});
export type ResendVerificationInput = z.infer<typeof ResendVerificationInputSchema>;

export const ForgotPasswordInputSchema = z.object({
  email: EmailSchema,
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInputSchema>;

export const ResetPasswordInputSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: PasswordSchema,
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordInputSchema>;

export const ChangePasswordInputSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  password: PasswordSchema,
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordInputSchema>;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const UserStatusSchema = z.enum(['pending', 'active', 'blocked']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const LanguageSchema = z.enum(['en', 'es']);
export type Language = z.infer<typeof LanguageSchema>;

export const ThemeSchema = z.enum(['light', 'dark', 'system']);
export type Theme = z.infer<typeof ThemeSchema>;

export const UserPublicSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  status: UserStatusSchema,
  isAdmin: z.boolean(),
  isDemo: z.boolean(),
  language: LanguageSchema,
  theme: ThemeSchema,
  avatarPath: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  emailVerifiedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type UserPublic = z.infer<typeof UserPublicSchema>;

export const UpdateMeInputSchema = z.object({
  name: NameSchema.optional(),
  language: LanguageSchema.optional(),
  theme: ThemeSchema.optional(),
});
export type UpdateMeInput = z.infer<typeof UpdateMeInputSchema>;

export const DeleteAccountInputSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});
export type DeleteAccountInput = z.infer<typeof DeleteAccountInputSchema>;

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------
export const WorkspaceRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isDemo: z.boolean(),
  role: WorkspaceRoleSchema,
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const CreateWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceInputSchema>;

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
export const ProjectSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  isFavorite: z.boolean(),
  updatedAt: z.string(),
  campaignCount: z.number().int().nonnegative().optional(),
  assetCount: z.number().int().nonnegative().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectInputSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: z.string().max(2000).default(''),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const UpdateProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  isFavorite: z.boolean().optional(),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;

export const FavoriteProjectInputSchema = z.object({
  favorite: z.boolean(),
});
export type FavoriteProjectInput = z.infer<typeof FavoriteProjectInputSchema>;

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------
export const CampaignSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  objective: z.string(),
  status: z.string(),
  updatedAt: z.string(),
});
export type Campaign = z.infer<typeof CampaignSchema>;

export const CreateCampaignInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  objective: z.string().max(2000).default(''),
});
export type CreateCampaignInput = z.infer<typeof CreateCampaignInputSchema>;

export const UpdateCampaignInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  objective: z.string().max(2000).optional(),
  status: z.string().max(50).optional(),
});
export type UpdateCampaignInput = z.infer<typeof UpdateCampaignInputSchema>;

// ---------------------------------------------------------------------------
// Brand kits
// ---------------------------------------------------------------------------
export const BrandKitSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  brandName: z.string(),
  tagline: z.string(),
  description: z.string(),
  colors: z.array(z.string()).default([]),
  fonts: z.array(z.string()).default([]),
  tone: z.string(),
  audience: z.string(),
  updatedAt: z.string(),
});
export type BrandKit = z.infer<typeof BrandKitSchema>;

export const UpsertBrandKitInputSchema = z.object({
  brandName: z.string().trim().min(1, 'Brand name is required').max(200),
  tagline: z.string().max(500).default(''),
  description: z.string().max(5000).default(''),
  colors: z.array(z.string().max(40)).max(20).default([]),
  fonts: z.array(z.string().max(100)).max(20).default([]),
  tone: z.string().max(2000).default(''),
  audience: z.string().max(2000).default(''),
});
export type UpsertBrandKitInput = z.infer<typeof UpsertBrandKitInputSchema>;

// ---------------------------------------------------------------------------
// Conversations / messages (Phase 2: honest chat stub)
// ---------------------------------------------------------------------------
export const MessageRoleSchema = z.enum(['user', 'assistant', 'system']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const ChatMessageSchema = z.object({
  id: z.string().uuid(),
  role: MessageRoleSchema,
  content: z.string(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const SendMessageInputSchema = z.object({
  content: z.string().trim().min(1, 'Message content is required').max(10000),
  language: LanguageSchema.optional(),
});
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
export const AssetSchema = z.object({
  id: z.string().uuid(),
  originalName: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int(),
  url: z.string(),
  kind: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type Asset = z.infer<typeof AssetSchema>;

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
export const AdminOverviewSchema = z.object({
  usersTotal: z.number().int(),
  usersActive: z.number().int(),
  usersBlocked: z.number().int(),
  demoActive: z.number().int(),
  projectsTotal: z.number().int(),
  campaignsTotal: z.number().int(),
  agentRunsTotal: z.number().int(),
  errorsLast24h: z.number().int(),
});
export type AdminOverview = z.infer<typeof AdminOverviewSchema>;

export const AdminUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  status: UserStatusSchema,
  isAdmin: z.boolean(),
  isDemo: z.boolean(),
  createdAt: z.string(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const SetAdminInputSchema = z.object({
  isAdmin: z.boolean(),
});
export type SetAdminInput = z.infer<typeof SetAdminInputSchema>;

// ---------------------------------------------------------------------------
// Success envelopes (flat, per API contract)
// ---------------------------------------------------------------------------
export type Envelope<T extends object> = T;

// ---------------------------------------------------------------------------
// Phase 3 agent contracts (run states, tools, plans, events, DTOs)
// ---------------------------------------------------------------------------
export * from "./agent.js";
