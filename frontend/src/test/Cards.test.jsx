import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { SharedCard, PersonCard } from '../components/OwnerTotals';

describe('SharedCard', () => {
    const defaultProps = {
        billsPotTotal: 500,
        sharedIncome: 100,
        sharedExpenses: 2000,
        totalContributions: 1800,
    };

    it('renders all line items', () => {
        render(<SharedCard {...defaultProps} />);
        expect(screen.getByText('Shared')).toBeInTheDocument();
        expect(screen.getByText('Income')).toBeInTheDocument();
        expect(screen.getByText('Contributions')).toBeInTheDocument();
        expect(screen.getByText('Expenses')).toBeInTheDocument();
        expect(screen.getByText('Bills Pot')).toBeInTheDocument();
        expect(screen.getByText('Remaining')).toBeInTheDocument();
    });

    it('displays formatted values', () => {
        render(<SharedCard {...defaultProps} />);
        expect(screen.getByText('+ £100.00')).toBeInTheDocument();
        expect(screen.getByText('+ £1800.00')).toBeInTheDocument();
        expect(screen.getByText('- £2000.00')).toBeInTheDocument();
        expect(screen.getByText('£500.00')).toBeInTheDocument();
    });

    it('calculates remaining as income + contributions - expenses', () => {
        render(<SharedCard {...defaultProps} />);
        // 100 + 1800 - 2000 = -100
        expect(screen.getByText('£-100.00')).toBeInTheDocument();
    });

    it('shows green remaining when positive', () => {
        render(<SharedCard {...defaultProps} totalContributions={2500} />);
        // 100 + 2500 - 2000 = 600
        const remaining = screen.getByText('£600.00');
        expect(remaining).toHaveClass('text-purple-700');
    });

    it('shows red remaining when negative', () => {
        render(<SharedCard {...defaultProps} totalContributions={100} />);
        // 100 + 100 - 2000 = -1800
        const remaining = screen.getByText('£-1800.00');
        expect(remaining).toHaveClass('text-red-600');
    });
});

describe('PersonCard', () => {
    const defaultProps = {
        name: 'Keith',
        color: 'blue',
        income: 3000,
        directExpenses: 500,
        share: 750,
        sharedTotal: 1500,
        proportion: 0.5,
        remaining: 1750,
    };

    it('renders the person name', () => {
        render(<PersonCard {...defaultProps} />);
        expect(screen.getByText('Keith')).toBeInTheDocument();
    });

    it('displays all breakdown lines', () => {
        render(<PersonCard {...defaultProps} />);
        expect(screen.getByText('Income')).toBeInTheDocument();
        expect(screen.getByText('Personal Expenses')).toBeInTheDocument();
        expect(screen.getByText('Shared Expenses')).toBeInTheDocument();
        expect(screen.getByText('Remaining')).toBeInTheDocument();
    });

    it('displays formatted monetary values', () => {
        render(<PersonCard {...defaultProps} />);
        expect(screen.getByText('+ £3000.00')).toBeInTheDocument();
        expect(screen.getByText('- £500.00')).toBeInTheDocument();
        expect(screen.getByText('- £750.00')).toBeInTheDocument();
        expect(screen.getByText('£1750.00')).toBeInTheDocument();
    });

    it('shows proportion info', () => {
        render(<PersonCard {...defaultProps} />);
        expect(screen.getByText('50.0% of £1500')).toBeInTheDocument();
    });

    it('applies blue styling for Keith', () => {
        render(<PersonCard {...defaultProps} />);
        expect(screen.getByText('Keith')).toHaveClass('text-blue-800');
    });

    it('applies pink styling for Tild', () => {
        render(<PersonCard {...defaultProps} name="Tild" color="pink" />);
        expect(screen.getByText('Tild')).toHaveClass('text-pink-800');
    });

    it('shows red remaining when negative', () => {
        render(<PersonCard {...defaultProps} remaining={-200} />);
        const remaining = screen.getByText('£-200.00');
        expect(remaining).toHaveClass('text-red-600');
    });
});
