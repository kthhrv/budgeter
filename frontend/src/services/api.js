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
    async getAllBudgetItemCategories() {
        const response = await fetch(`${API_BASE_URL}/budgetitems/`, { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch budget item categories');
        return await response.json();
    },
    async getAllMonths() {
        const response = await fetch(`${API_BASE_URL}/months/`, { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch months');
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
    }
};

export default apiService;
