import { test, expect } from '@playwright/test';

// Verifies the new "Bills pot for" control appears only when Bills Pot is chosen,
// and offers Shared/Keith/Tild. Read-only: opens the create modal and cancels.

test('every owner card shows a Transfer to Bills pot line', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Money in')).toBeVisible();
    // One per owner card: Joint, Keith, Tild.
    await expect(page.getByText('Transfer to Bills pot')).toHaveCount(3);
});

test('the "Bills pot for" selector appears when Bills Pot is chosen', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Money in')).toBeVisible();

    await page.getByRole('button', { name: 'Add New Item' }).click();

    // Not shown until a pot is selected.
    await expect(page.locator('#bills_pot_owner')).toBeHidden();

    await page.locator('#expense_pot').selectOption('bills');

    const potOwner = page.locator('#bills_pot_owner');
    await expect(potOwner).toBeVisible();
    await expect(potOwner.locator('option')).toHaveText(['Shared', 'Keith', 'Tild']);
    // Defaults to Shared.
    await expect(potOwner).toHaveValue('shared');

    // Switching back to Groceries hides it again.
    await page.locator('#expense_pot').selectOption('groceries');
    await expect(page.locator('#bills_pot_owner')).toBeHidden();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Create Item' })).toBeHidden();
});
