/**
 * The 13 agent tools, registered in one place.
 */
import type { AgentTool } from '../types.js';
import { createToolRegistry, ToolNotFoundError } from './registry.js';
import type { ToolRegistry } from './registry.js';
import { createCampaignTool } from './create-campaign.js';
import { updateCampaignTool } from './update-campaign.js';
import { createBrandKitTool } from './create-brand-kit.js';
import { generateMarketingCopyTool } from './generate-marketing-copy.js';
import { generateImageTool } from './generate-image.js';
import { generateSocialPostTool } from './generate-social-post.js';
import { createPosterTool } from './create-poster.js';
import { createLandingPageTool } from './create-landing-page.js';
import { editDesignTool } from './edit-design.js';
import { saveAssetTool } from './save-asset.js';
import { listProjectAssetsTool } from './list-project-assets.js';
import { exportCampaignTool } from './export-campaign.js';
import { reviewCampaignTool } from './review-campaign.js';

export { createToolRegistry, ToolNotFoundError };
export type { ToolRegistry };
export {
  ToolError,
  ToolAuthError,
  BUDGET_NOT_AFFORDABLE,
  stableHash,
} from './helpers.js';
export { createCampaignTool } from './create-campaign.js';
export { updateCampaignTool } from './update-campaign.js';
export { createBrandKitTool } from './create-brand-kit.js';
export { generateMarketingCopyTool } from './generate-marketing-copy.js';
export { generateImageTool } from './generate-image.js';
export { generateSocialPostTool } from './generate-social-post.js';
export { createPosterTool } from './create-poster.js';
export { createLandingPageTool } from './create-landing-page.js';
export { editDesignTool } from './edit-design.js';
export { saveAssetTool } from './save-asset.js';
export { listProjectAssetsTool } from './list-project-assets.js';
export { exportCampaignTool } from './export-campaign.js';
export { reviewCampaignTool } from './review-campaign.js';

export const allTools: AgentTool[] = [
  createCampaignTool,
  updateCampaignTool,
  createBrandKitTool,
  generateMarketingCopyTool,
  generateImageTool,
  generateSocialPostTool,
  createPosterTool,
  createLandingPageTool,
  editDesignTool,
  saveAssetTool,
  listProjectAssetsTool,
  exportCampaignTool,
  reviewCampaignTool,
];

/** Builds the default registry with the 13 agent tools. */
export function createDefaultRegistry(): ToolRegistry {
  return createToolRegistry(allTools);
}
