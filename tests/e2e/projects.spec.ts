/**
 * E2E (logged in via a demo session cookie): create project → favorite →
 * create campaign → edit brand kit → upload avatar → delete project.
 */
import path from 'node:path';
import { test, expect } from '@playwright/test';

const API = 'http://localhost:3014';
const AVATAR_PNG = path.join(__dirname, 'fixtures', 'avatar.png');

test.beforeEach(async ({ page, request }) => {
  const res = await request.post(`${API}/api/v1/auth/demo`);
  expect(res.ok()).toBeTruthy();
  const setCookie = res.headers()['set-cookie'] ?? '';
  const token = /bf_session=([^;]+)/.exec(setCookie)?.[1];
  expect(token).toBeTruthy();
  await page.context().addCookies([{ name: 'bf_session', value: token!, domain: 'localhost', path: '/' }]);
});

test('project lifecycle: create, favorite, campaign, brand kit, avatar, delete', async ({ page }) => {
  const projectName = `E2E Lifecycle ${Date.now()}`;
  await page.goto('/app');

  // ---- create project via the New Campaign modal
  await page.getByRole('button', { name: 'New Campaign' }).first().click();
  await page.getByLabel('Project name').fill(projectName);
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page).toHaveURL(/\/app\/projects\/.+/);
  const projectUrl = page.url();
  await expect(page.getByText(projectName).first()).toBeVisible();

  // ---- favorite it
  await page.getByRole('button', { name: 'Favorite' }).click();
  await expect(page.locator('button[aria-label="Favorite"] svg.fill-amber-400').first()).toBeVisible();

  // ---- create a campaign (inline form on the Campaigns tab)
  await page.getByRole('tab', { name: 'Campaigns' }).click();
  const campaignName = `E2E Campaign ${Date.now()}`;
  await page.getByLabel('Name', { exact: true }).fill(campaignName);
  await page.getByRole('button', { name: 'New campaign' }).click();
  await expect(page.getByText(campaignName).first()).toBeVisible();

  // ---- edit the brand kit name
  await page.getByRole('tab', { name: 'Brand kit' }).click();
  await page.getByLabel('Brand name').fill('E2E Brand');
  await page.getByRole('button', { name: 'Save brand kit' }).click();
  await expect(page.getByText('Brand kit saved')).toBeVisible();

  // ---- upload an avatar on the profile page (seed PNG)
  // NOTE: the upload succeeds API-side (avatarPath persisted), but the web UI
  // never displays it — it reads `user.avatarUrl` while the API returns
  // `avatarPath`, and nothing maps one to the other. Product bug, reported
  // separately; the E2E asserts the honest API contract.
  await page.goto('/app/profile');
  const [uploadRes] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/v1/users/me/avatar') && r.request().method() === 'POST',
    ),
    page.locator('input[type="file"]').setInputFiles(AVATAR_PNG),
  ]);
  expect(uploadRes.ok()).toBeTruthy();
  const me = await page.evaluate(async () => {
    const r = await fetch('http://localhost:3014/api/v1/users/me', { credentials: 'include' });
    return (await r.json()) as { user: { avatarPath: string | null } };
  });
  expect(me.user.avatarPath).toBeTruthy();

  // ---- delete the project
  await page.goto(projectUrl);
  await page.getByRole('tab', { name: 'Overview' }).click();
  await page.getByRole('button', { name: 'Delete project' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText(projectName)).toHaveCount(0);
});
