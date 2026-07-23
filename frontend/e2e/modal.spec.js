import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Money in')).toBeVisible();
});

test('edit modal shows the Apply-to control', async ({ page }) => {
    await page.getByTestId('budget-row').first().click();
    await expect(page.getByRole('heading', { name: 'Edit item' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'From this month on' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Just this month' })).toBeVisible();
    // No changes → the X closes without a prompt.
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('heading', { name: 'Edit item' })).toBeHidden();
});

test('new item: Advanced options, weekly monthly estimate, and confirmed discard', async ({ page }) => {
    await page.getByRole('button', { name: 'Add New Item' }).click();
    await expect(page.getByRole('heading', { name: 'New item' })).toBeVisible();
    // A fresh expense exposes the Advanced section.
    await expect(page.getByRole('button', { name: /Advanced options/ })).toBeVisible();

    await page.getByRole('button', { name: 'Weekly' }).click();
    await page.locator('select[name="weekly_payment_day"]').selectOption('1'); // Monday
    await page.locator('input[name="value"]').fill('10');
    await expect(page.getByText(/≈/)).toBeVisible();

    // Unsaved changes → Cancel prompts to discard.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('heading', { name: 'New item' })).toBeHidden();
});
