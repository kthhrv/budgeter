import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// We test the inlined Ad-hoc form inside ChildCard. Since ChildCard isn't a
// named export, we render NurseryPage and use the page's ChildCard for Ellis.
// To keep this fast and avoid touching the real API, we mock apiService and
// preload localStorage with a minimal blob (NurseryPage falls back to it when
// the server returns nothing).

vi.mock('../services/api', () => ({
    default: {
        getNurserySettings: vi.fn().mockResolvedValue({}),
        updateNurserySettings: vi.fn().mockResolvedValue({}),
    },
}));

import NurseryPage from '../components/NurseryPage';

describe('Inlined ad-hoc form in ChildCard', () => {
    it('renders an "Ad-hoc days in {month}" section inside each child card', async () => {
        render(<NurseryPage />);
        // Both Ellis and Gaspard cards should have the ad-hoc heading.
        const headings = await screen.findAllByText(/Ad-hoc days in /);
        expect(headings.length).toBe(2);
    });

    it('hides any explicit Child / Age selectors on the form (those are implicit)', async () => {
        render(<NurseryPage />);
        // Wait until the page renders by checking for child names
        await screen.findAllByText('Ellis');
        // The old standalone AdHocPanel had explicit Child + Age selectors.
        // The inlined form should have neither.
        expect(screen.queryByRole('option', { name: 'Ellis' })).toBeNull();
        // Date and Session inputs DO exist (one per card).
        const dateInputs = document.querySelectorAll('input[type="date"]');
        expect(dateInputs.length).toBe(2);
    });

    it('exposes a "+ Add" button per child card', async () => {
        render(<NurseryPage />);
        await screen.findAllByText('Ellis');
        const addButtons = await screen.findAllByRole('button', { name: /\+ Add/ });
        // Two child cards = two add buttons.
        expect(addButtons.length).toBe(2);
    });

    it('clicking + Add inserts an ad-hoc that appears in the same card', async () => {
        render(<NurseryPage />);
        await screen.findAllByText('Ellis');
        const user = userEvent.setup();

        // Click the first add button (Ellis's card).
        const addButtons = await screen.findAllByRole('button', { name: /\+ Add/ });
        await user.click(addButtons[0]);

        // After clicking, an ad-hoc row appears under Ellis's card, dated within
        // the current month, with a remove (×) control. We assert the count of
        // remove buttons (no other × in the ad-hoc area).
        const removeButtons = document.querySelectorAll('button.text-rose-500');
        expect(removeButtons.length).toBeGreaterThanOrEqual(1);
    });
});
