/** E2E: verified landing publication and asset delivery through the real UI. */
import path from 'node:path';
import { test, expect } from '@playwright/test';

const WEB = process.env.E2E_REMOTE_BASE_URL ?? 'http://localhost:4173';
const API = process.env.E2E_API_URL ?? 'http://localhost:3014';
const ASSET_PNG = path.join(__dirname, 'fixtures', 'avatar.png');

test.beforeEach(async ({ page, request }) => {
  const response = await request.post(`${API}/api/v1/auth/demo`);
  expect(response.ok()).toBeTruthy();
  const token = /bf_session=([^;]+)/.exec(response.headers()['set-cookie'] ?? '')?.[1];
  expect(token).toBeTruthy();
  const apiUrl = new URL(API);
  await page.context().addCookies([{
    name: 'bf_session',
    value: token!,
    domain: apiUrl.hostname,
    path: '/',
    secure: apiUrl.protocol === 'https:',
    httpOnly: true,
    sameSite: apiUrl.protocol === 'https:' ? 'None' : 'Lax',
  }]);
});

test('landing is publishable and revocable; assets are visible and downloadable', async ({ page, context }) => {
  await page.goto('/app');
  await page.locator('a[href^="/app/campaigns/"]').first().click();

  await page.getByRole('tab', { name: 'Landing' }).click();
  await expect(page.getByText('Content verified and ready to publish')).toBeVisible();
  await expect(page.frameLocator('iframe:visible').first().getByRole('heading', { level: 1 })).toBeVisible();

  const publishResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/v1/landing-pages/')
      && response.url().endsWith('/publish')
      && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Publish link' }).click();
  const publishResponse = await publishResponsePromise;
  expect(publishResponse.ok()).toBeTruthy();
  const published = await publishResponse.json() as { landingPage: { publicUrl: string } };
  const publicId = published.landingPage.publicUrl.split('/').at(-1);
  expect(publicId).toBeTruthy();
  await expect(page.getByRole('button', { name: 'Open public page' })).toBeVisible();

  const publicPage = await context.newPage();
  await publicPage.goto(`${WEB}/showcase/landing/${publicId}`);
  await expect(publicPage.frameLocator('iframe[title="Landing page"]').getByRole('heading', { level: 1 })).toBeVisible();

  const unpublishResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/v1/landing-pages/')
      && response.url().endsWith('/publish')
      && response.request().method() === 'DELETE',
  );
  await page.getByRole('button', { name: 'Unpublish' }).click();
  expect((await unpublishResponsePromise).ok()).toBeTruthy();
  await publicPage.reload();
  await expect(publicPage.getByText('Esta vista previa no está disponible')).toBeVisible();
  await publicPage.close();

  await page.getByRole('tab', { name: 'Assets' }).click();
  const uploadResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/v1/assets')
      && response.request().method() === 'POST',
  );
  await page.locator('input[type="file"]').setInputFiles(ASSET_PNG);
  expect((await uploadResponsePromise).ok()).toBeTruthy();
  await expect(page.getByText(/\d+ of \d+ files verified/).first()).toBeVisible();
  await expect(page.getByText('Available').first()).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download' }).first().click();
  const download = await downloadPromise;
  expect(await download.path()).toBeTruthy();
});
