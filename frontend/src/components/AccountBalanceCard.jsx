import React, { useCallback, useEffect, useMemo, useState } from 'react';
import apiService from '../services/api';
import { money } from '../utils/helpers';
import { leftToPay } from '../utils/calendarGrid';
import BalanceSummary from './BalanceSummary';

const NAMES = { keith: 'Keith', tild: 'Tild' };

// One person's own Monzo current account against what's still to go out
// of it this month (their unticked items). Current month only.
const AccountBalanceCard = ({ owner, entries, unscheduled, showToast }) => {
    const [account, setAccount] = useState(undefined); // undefined = loading, null = not connected
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await apiService.getPersonalBalance(owner);
            setAccount(r.account);
            if (r.error) showToast(r.error, 'error');
        } catch (e) {
            showToast(e.message, 'error');
            setAccount(null);
        } finally {
            setLoading(false);
        }
    }, [owner, showToast]);

    useEffect(() => { setAccount(undefined); load(); }, [load]);

    const left = useMemo(() => leftToPay(entries, unscheduled), [entries, unscheduled]);

    if (account === undefined) return null;
    if (account === null) {
        return (
            <p className="mb-4 rounded-2xl border border-line bg-card px-4 py-3 text-sm text-ink-soft">
                {NAMES[owner]}’s left to pay this month: <span className="num text-ink">{money(left.total)}</span>. Their account balance shows here once {NAMES[owner]} connects Monzo on the FIRE tab.
            </p>
        );
    }
    return (
        <BalanceSummary title={`${NAMES[owner]}’s account`} balance={account.balance} left={left}
            loading={loading} onRefresh={load} testId="account-balance" />
    );
};

export default AccountBalanceCard;
