import { test, expect } from '@playwright/test';

// Viewport-specific behaviour: hover affordances on desktop, the hamburger nav
// on mobile. Each test opts into the project it belongs to.

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Money in')).toBeVisible();
});

test('web: hovering a row reveals the edit action', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'web', 'hover only applies to the desktop project');

    const row = page.getByTestId('budget-row').first();
    await row.hover();
    await expect(row.getByRole('button', { name: 'Edit item' })).toBeVisible();
});

test('mobile: the navigation menu opens from the hamburger', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'nav toggle is the primary mobile navigation');

    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    for (const item of ['Budget', 'Tabs', 'Nursery', 'Childcare']) {
        await expect(page.getByRole('button', { name: item, exact: true })).toBeVisible();
    }
    // Navigating away and back works.
    await page.getByRole('button', { name: 'Nursery', exact: true }).click();
    await expect(page.getByText('Transfer to TFC').first()).toBeVisible();
});
