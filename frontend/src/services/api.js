import { API_BASE_URL, formatDate, getCookie } from '../utils/helpers';

const apiService = {
    async getCurrentUser() {
        const response = await fetch(`${API_BASE_URL}/auth/me`, { credentials: 'include' });
        if (!response.ok) return null;
        return await response.json();
    },
    async createOrGetMonth(date) {
        const monthId = formatDate(date, 'YYYY-MM');
        const payload = { month: monthId };
        const response = await fetch(`${API_BASE_URL}/months/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify(payload),
            credentials: 'include'
        });
        if (!response.ok) throw new Error('Failed to create or get month');
        return await response.json();
    },
    async getBudgetItemsForMonth(monthId) {
        const response = await fetch(`${API_BASE_URL}/months/${monthId}/items/`, { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch budget items');
        return await response.json();
    },
    async updateBudgetItemValue(monthId, budgetItemId, payload) {
        const response = await fetch(`${API_BASE_URL}/months/${monthId}/items/${budgetItemId}/value/`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify(payload),
            credentials: 'include'
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Failed to update item value');
        }
        return await response.json();
    },
    async createBudgetItemCategory(monthId, payload) {
        const response = await fetch(`${API_BASE_URL}/months/${monthId}/budgetitems/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify(payload),
            credentials: 'include'
        });
        if (!response.ok) throw new Error('Failed to create budget item');
        return await response.json();
    },
    async updateBudgetItemCategory(budgetItemId, payload) {
        const response = await fetch(`${API_BASE_URL}/budgetitems/${budgetItemId}/`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify(payload),
            credentials: 'include'
        });
        if (!response.ok) throw new Error('Failed to update budget item category');
        return await response.json();
    },
    async deleteBudgetItemForMonth(monthId, budgetItemId) {
        const response = await fetch(`${API_BASE_URL}/months/${monthId}/items/${budgetItemId}/`, {
            method: 'DELETE',
            headers: {
                'X-CSRFToken': getCookie('csrftoken')
            },
            credentials: 'include'
        });
        if (!response.ok) {
            throw new Error('Failed to delete budget item');
        }
        return response;
    },
    async getTabs() {
        const response = await fetch(`${API_BASE_URL}/tabs/`, { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch tabs');
        return await response.json();
    },
    async createTabItem(payload) {
        const response = await fetch(`${API_BASE_URL}/tabs/items/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
            body: JSON.stringify(payload),
            credentials: 'include'
        });
        if (!response.ok) throw new Error('Failed to create tab item');
        return await response.json();
    },
    async deleteTabItem(itemId) {
        const response = await fetch(`${API_BASE_URL}/tabs/items/${itemId}/`, {
            method: 'DELETE',
            headers: { 'X-CSRFToken': getCookie('csrftoken') },
            credentials: 'include'
        });
        if (!response.ok) throw new Error('Failed to delete tab item');
        return response;
    },
    async createTabRepayment(payload) {
        const response = await fetch(`${API_BASE_URL}/tabs/repayments/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
            body: JSON.stringify(payload),
            credentials: 'include'
        });
        if (!response.ok) throw new Error('Failed to create tab repayment');
        return await response.json();
    },
    async deleteTabRepayment(repaymentId) {
        const response = await fetch(`${API_BASE_URL}/tabs/repayments/${repaymentId}/`, {
            method: 'DELETE',
            headers: { 'X-CSRFToken': getCookie('csrftoken') },
            credentials: 'include'
        });
        if (!response.ok) throw new Error('Failed to delete tab repayment');
        return response;
    },
    async getNurserySettings() {
        const response = await fetch(`${API_BASE_URL}/nursery/settings/`, { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch nursery settings');
        const json = await response.json();
        return json.data || {};
    },
    async updateNurserySettings(data) {
        const response = await fetch(`${API_BASE_URL}/nursery/settings/`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
            body: JSON.stringify({ data }),
            credentials: 'include'
        });
        if (!response.ok) throw new Error('Failed to update nursery settings');
        const json = await response.json();
        return json.data || {};
    },
    async _fireGet(path, errorMessage) {
        const response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include' });
        if (!response.ok) throw new Error(errorMessage);
        return await response.json();
    },
    async _fireSend(method, path, payload, errorMessage) {
        const response = await fetch(`${API_BASE_URL}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
            body: payload !== undefined ? JSON.stringify(payload) : undefined,
            credentials: 'include'
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => null);
            throw new Error(errorData?.detail || errorMessage);
        }
        return response.status === 204 ? null : await response.json();
    },
    getFireAccounts() { return this._fireGet('/fire/accounts/', 'Failed to fetch FIRE accounts'); },
    createFireAccount(payload) { return this._fireSend('POST', '/fire/accounts/', payload, 'Failed to create account'); },
    updateFireAccount(id, payload) { return this._fireSend('PUT', `/fire/accounts/${id}/`, payload, 'Failed to update account'); },
    deleteFireAccount(id) { return this._fireSend('DELETE', `/fire/accounts/${id}/`, undefined, 'Failed to delete account'); },
    setFireAccountBalance(id, payload) { return this._fireSend('PUT', `/fire/accounts/${id}/balance/`, payload, 'Failed to record balance'); },
    deleteBalanceSnapshot(id) { return this._fireSend('DELETE', `/fire/snapshots/${id}/`, undefined, 'Failed to delete balance entry'); },
    getEarnings() { return this._fireGet('/fire/earnings/', 'Failed to fetch earnings'); },
    createEarnings(payload) { return this._fireSend('POST', '/fire/earnings/', payload, 'Failed to create earnings version'); },
    deleteEarnings(id) { return this._fireSend('DELETE', `/fire/earnings/${id}/`, undefined, 'Failed to delete earnings version'); },
    getMortgages() { return this._fireGet('/fire/mortgages/', 'Failed to fetch mortgages'); },
    createMortgage(payload) { return this._fireSend('POST', '/fire/mortgages/', payload, 'Failed to create mortgage'); },
    updateMortgage(id, payload) { return this._fireSend('PUT', `/fire/mortgages/${id}/`, payload, 'Failed to update mortgage'); },
    deleteMortgage(id) { return this._fireSend('DELETE', `/fire/mortgages/${id}/`, undefined, 'Failed to delete mortgage'); },
    getFireSettings() { return this._fireGet('/fire/settings/', 'Failed to fetch FIRE settings'); },
    updateFireSettings(owner, payload) { return this._fireSend('PUT', `/fire/settings/${owner}/`, payload, 'Failed to update FIRE settings'); },
    getFireMonthlyItems(count = 12) { return this._fireGet(`/fire/monthly-items/?count=${count}`, 'Failed to fetch budget history'); }
};

export default apiService;
