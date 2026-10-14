/**
 * E2E: demo entry — "Try Demo — No registration required" → /app with the
 * demo banner, the seeded Café Aroma project, and the honest AI chat notice.
 */
import { test, expect } from '@playwright/test';

test('demo entry lands on /app with banner, Café Aroma project and AI notice', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Try Demo — no registration/ }).first().click();

  await expect(page).toHaveURL(/\/app$/);

  // demo banner
  await expect(page.getByText('Demo account — this is a test space')).toBeVisible();

  // dashboard shows the seeded demo project
  await expect(page.getByText('Café Aroma — Christmas Campaign')).toBeVisible();

  // open the workspace → chat panel shows the honest Phase-3 notice
  await page.getByRole('link', { name: /Open demo project/ }).click();
  await expect(page).toHaveURL(/\/app\/projects\/.+/);
  await expect(page.getByText('AI generation is not configured yet (Phase 3)').first()).toBeVisible();

  // sending a message exercises the stub end-to-end: the "AI" reply is the
  // honest notice, persisted as an assistant message
  await page.getByLabel('Agent chat').fill('Design a launch campaign for our oat-milk latte');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('AI generation is not configured yet in this build (Phase 3)')).toBeVisible();
  await expect(page.getByText('Automated reply — AI generation arrives in Phase 3.').first()).toBeVisible();
});
