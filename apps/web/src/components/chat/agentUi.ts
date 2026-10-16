/**
 * Shared presentation bits for Phase-3 agent runs (badge tones + i18n keys).
 * Type-only dependency on @brandforge/shared — no zod in the web bundle.
 */
import type { BadgeTone } from '@brandforge/ui';
import type { RunState } from '@brandforge/shared';

/** The 7 run states of the agent state machine (packages/shared/src/agent.ts). */
export const RUN_STATES: readonly RunState[] = [
  'pending',
  'planning',
  'running',
  'waiting_approval',
  'completed',
  'failed',
  'cancelled',
];

export const runStateTone: Record<RunState, BadgeTone> = {
  pending: 'slate',
  planning: 'sky',
  running: 'violet',
  waiting_approval: 'amber',
  completed: 'emerald',
  failed: 'amber',
  cancelled: 'slate',
};

export const runStateLabelKey: Record<RunState, string> = {
  pending: 'agent.pending',
  planning: 'agent.planning',
  running: 'agent.running',
  waiting_approval: 'agent.waitingApproval',
  completed: 'agent.completed',
  failed: 'agent.failed',
  cancelled: 'agent.cancelled',
};

/** States where the run is still alive on the server (cancel button shown). */
export function isRunActive(state: RunState): boolean {
  return state === 'pending' || state === 'planning' || state === 'running' || state === 'waiting_approval';
}

export function isKnownRunState(state: string): state is RunState {
  return (RUN_STATES as readonly string[]).includes(state);
}

const toolLabelKeys: Record<string, string> = {
  create_campaign: 'agent.toolCreateCampaign',
  update_campaign: 'agent.toolUpdateCampaign',
  create_brand_kit: 'agent.toolBrandKit',
  generate_marketing_copy: 'agent.toolMarketingCopy',
  generate_image: 'agent.toolImage',
  generate_social_post: 'agent.toolSocialPost',
  create_poster: 'agent.toolPoster',
  create_landing_page: 'agent.toolLanding',
  edit_design: 'agent.toolEditDesign',
  save_asset: 'agent.toolSaveAsset',
  list_project_assets: 'agent.toolReviewAssets',
  export_campaign: 'agent.toolExportCampaign',
  review_campaign: 'agent.toolReviewCampaign',
};

export function toolLabelKey(tool?: string): string | null {
  return tool ? toolLabelKeys[tool] ?? null : null;
}
