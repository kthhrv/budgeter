import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

// The nursery ad-hoc form was removed (ad-hoc now lives in Gaspard's school-
// childcare panel, which only shows from his care start month). These tests
// guard that removal at the default (pre-September) month, where both children
// still render as nursery cards. We mock apiService so no real API is hit.

vi.mock('../services/api', () => ({
    default: {
        getNurserySettings: vi.fn().mockResolvedValue({}),
        updateNurserySettings: vi.fn().mockResolvedValue({}),
    },
}));

import ChildcarePage from '../components/ChildcarePage';

describe('Nursery cards (ad-hoc removed)', () => {
    // Pin to a pre-September month so Gaspard is still in nursery regardless of
    // the real system clock.
    beforeEach(() => { window.location.hash = '#2026-06'; });

    it('no longer renders an "Ad-hoc days in {month}" section on nursery cards', async () => {
        render(<ChildcarePage />);
        await screen.findAllByText('Ellis');
        expect(screen.queryByText(/Ad-hoc days in /)).toBeNull();
    });

    it('renders Ellis and Gaspard nursery cards before the care start month', async () => {
        render(<ChildcarePage />);
        // Card titles are <h2> headings (the summary cards use plain divs), so a
        // Gaspard nursery card present means he hasn't switched to school care.
        expect(await screen.findByRole('heading', { name: 'Ellis' })).toBeInTheDocument();
        expect(await screen.findByRole('heading', { name: 'Gaspard' })).toBeInTheDocument();
        // Both cards show the nursery provider label.
        const providerLabels = await screen.findAllByText('Busy Bees Tunbridge Wells');
        expect(providerLabels.length).toBe(2);
    });
});
