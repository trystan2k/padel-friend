import { expect, test } from '@playwright/test';

test('local Supabase signup creates a note isolated from other users', async ({
  page,
  browser
}) => {
  test.skip(
    !process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    'Run with local Supabase URL and publishable key to exercise the full stack'
  );

  await page.goto('/login');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Email').fill(`starter-${Date.now()}@example.test`);
  await page.getByLabel('Password').fill('a-strong-example-password');
  await page.getByRole('button', { name: 'Create account' }).last().click();
  await expect(page.getByRole('heading', { name: 'My notes' })).toBeVisible();
  await page.getByLabel('New note').fill('My first private note');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('My first private note')).toBeVisible();

  const otherPage = await browser.newPage();
  await otherPage.goto('/login');
  await otherPage.getByRole('button', { name: 'Create account' }).click();
  await otherPage.getByLabel('Email').fill(`other-${Date.now()}@example.test`);
  await otherPage.getByLabel('Password').fill('a-strong-example-password');
  await otherPage.getByRole('button', { name: 'Create account' }).last().click();
  await expect(otherPage.getByRole('heading', { name: 'My notes' })).toBeVisible();
  await expect(otherPage.getByText('No notes yet.')).toBeVisible();
  await otherPage.close();
});
