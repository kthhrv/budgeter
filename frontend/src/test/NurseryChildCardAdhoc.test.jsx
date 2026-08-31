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

    it('shows the summary cards with a TFC row per child', async () => {
        render(<ChildcarePage />);
        expect(await screen.findByText('Transfer to TFC')).toBeInTheDocument();
        expect(await screen.findByText('Ellis')).toBeInTheDocument();
        expect(await screen.findByText('Gaspard')).toBeInTheDocument();
        expect(await screen.findByText('Total nursery bill')).toBeInTheDocument();
    });
});
