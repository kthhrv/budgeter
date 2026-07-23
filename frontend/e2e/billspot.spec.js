import { test, expect } from '@playwright/test';

// The bills-pot owner is inferred from the item's Owner, so every owner card
// shows its own "Transfer to Bills pot" total.

test('every owner card shows a Transfer to Bills pot line', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Money in')).toBeVisible();
    // One per owner card: Joint, Keith, Tild.
    await expect(page.getByText('Transfer to Bills pot')).toHaveCount(3);
});
