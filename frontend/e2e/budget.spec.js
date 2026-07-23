import { test, expect } from '@playwright/test';

// These run on both the "web" (desktop) and "mobile" (Pixel 5) projects.

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the authenticated dashboard to render (auth/me + month data loaded).
    await expect(page.getByText('Money in')).toBeVisible();
});

test('renders the household summary headline', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Budget/ }).first()).toBeVisible();
    for (const label of ['Money in', 'Money out', 'Saved']) {
        await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    // "Left over" appears in both the stat and the legend.
    await expect(page.getByText('Left over').first()).toBeVisible();
});

test('shows the three owner cards', async ({ page }) => {
    for (const name of ['Joint', 'Keith', 'Tild']) {
        await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    }
});

test('shows sections with inline subtotals', async ({ page }) => {
    await expect(page.getByText('Income', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Expenses', { exact: true }).first()).toBeVisible();
    // Amounts use the tabular figures class and start with £.
    await expect(page.locator('.num', { hasText: '£' }).first()).toBeVisible();
});

test('opens the edit modal from a row and cancels without saving', async ({ page }) => {
    const row = page.getByTestId('budget-row').first();
    await expect(row).toBeVisible();
    await row.click();

    // The edit modal opens with a Save action for an existing item.
    const save = page.getByRole('button', { name: 'Save' });
    await expect(save).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(save).toBeHidden();
});

test('month selector navigates between months', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'July 2026' })).toBeVisible();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page.getByRole('heading', { name: 'June 2026' })).toBeVisible();
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(page.getByRole('heading', { name: 'July 2026' })).toBeVisible();
});

test('search with no matches shows the empty hint', async ({ page }) => {
    await page.getByPlaceholder('Search items...').fill('zzzzznope');
    await expect(page.getByText('No matching items').first()).toBeVisible();
    await page.getByPlaceholder('Search items...').fill('');
    await expect(page.getByText('No matching items')).toHaveCount(0);
});
