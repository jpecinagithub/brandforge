/**
 * E2E: register → verify (token from the maildir) → login → create project
 * via the New Campaign modal → logout → login again.
 */
import { test, expect } from '@playwright/test';
import { E2E_PASSWORD, clearMaildir, latestEmailToken, uniqueEmail } from './helpers';

test('register → verify → login → new campaign → logout → login', async ({ page }) => {
  await clearMaildir();
  const email = uniqueEmail('auth');

  // ---- register
  await page.goto('/register');
  await page.getByLabel('Full name').fill('E2E Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel('Confirm password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();

  // ---- verify via the maildir token
  const token = await latestEmailToken();
  await page.goto(`/verify-email?token=${token}`);
  await expect(page.getByText('Email verified!')).toBeVisible();

  // ---- login
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText('E2E Tester').first()).toBeVisible();

  // ---- a fresh user has no workspace yet; the New Campaign modal needs one
  await page.evaluate(async () => {
    const res = await fetch('http://localhost:3014/api/v1/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name: 'E2E workspace' }),
    });
    if (!res.ok) throw new Error(`workspace create failed: ${res.status}`);
  });

  // ---- create project via the New Campaign modal
  const projectName = `E2E Project ${Date.now()}`;
  await page.getByRole('button', { name: 'New Campaign' }).first().click();
  await expect(page.getByRole('heading', { name: 'New campaign' })).toBeVisible();
  await page.getByLabel('Project name').fill(projectName);
  await page.getByLabel(/Campaign objective/).fill('Drive pre-orders');
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page).toHaveURL(/\/app\/projects\/.+/);
  await expect(page.getByText(projectName).first()).toBeVisible();

  // ---- logout → login again
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText(projectName).first()).toBeVisible();
});
