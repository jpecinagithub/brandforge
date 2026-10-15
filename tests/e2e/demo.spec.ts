/**
 * E2E: demo entry — "Try Demo — No registration required" → /app with the
 * demo banner, the seeded Café Aroma project, and the safe agent fallback.
 */
import { test, expect } from '@playwright/test';

test('demo entry lands on /app with banner, Café Aroma project and agent status', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Try Demo — no registration/ }).first().click();

  await expect(page).toHaveURL(/\/app$/);

  // demo banner
  await expect(page.getByText('Demo account — this is a test space')).toBeVisible();

  // dashboard shows the seeded demo project
  await expect(page.getByText('Café Aroma — Christmas Campaign')).toBeVisible();

  // open the workspace → chat panel reports the unavailable test agent calmly
  await page.locator('a[href^="/app/projects/"]').first().click();
  await expect(page).toHaveURL(/\/app\/projects\/.+/);
  await expect(page.getByText('The agent is temporarily unavailable.').first()).toBeVisible();

  // The unavailable-provider fallback preserves the brief and persists a safe reply.
  await page.getByLabel('Agent chat').fill('Design a launch campaign for our oat-milk latte');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('I saved your message, but the agent is temporarily unavailable.')).toBeVisible();
  await expect(page.getByText('Fallback response — check the agent configuration to resume AI generation.').first()).toBeVisible();
});
