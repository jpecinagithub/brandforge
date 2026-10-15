/** E2E: canonical campaign lifecycle, including favorite, brand kit and deletion. */
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

test('campaign lifecycle: create, favorite, brand kit, avatar, delete', async ({ page }) => {
  const campaignName = `E2E Lifecycle ${Date.now()}`;
  await page.goto('/app');

  // ---- create one canonical campaign
  await page.getByRole('button', { name: 'New Campaign' }).first().click();
  await page.getByLabel('Campaign name').fill(campaignName);
  await page.getByLabel('Main objective').fill('Generate launch demand');
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page).toHaveURL(/\/app\/campaigns\/.+/);
  const campaignUrl = page.url();
  await expect(page.getByText(campaignName).first()).toBeVisible();

  // ---- favorite it from the dashboard
  await page.goto('/app');
  await page.getByRole('button', { name: `Add ${campaignName} to favorites` }).click();
  await expect(page.getByRole('button', { name: `Remove ${campaignName} from favorites` }).first()).toBeVisible();
  await page.getByRole('link').filter({ hasText: campaignName }).first().click();

  // ---- edit the brand kit name
  await page.getByRole('tab', { name: 'Brand kit' }).click();
  await page.getByLabel('Brand name').fill('E2E Brand');
  await page.getByRole('button', { name: 'Save brand kit' }).click();
  await expect(page.getByText('Brand kit saved')).toBeVisible();

  // ---- upload an avatar on the profile page (seed PNG)
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

  // ---- delete the campaign
  await page.goto(campaignUrl);
  await page.getByRole('tab', { name: 'Briefing' }).click();
  await page.getByRole('button', { name: 'Delete campaign' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText(campaignName)).toHaveCount(0);
});
