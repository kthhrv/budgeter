export const API_BASE_URL = `${window.location.origin}/api`;

export const DAY_CHOICES = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' };

export const formatDate = (date, format = 'YYYY-MM') => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    if (format === 'YYYY-MM') {
        return `${year}-${month}`;
    }
    if (format === 'MonthYYYY') {
        return date.toLocaleString('default', { month: 'long', year: 'numeric' });
    }
    return date.toISOString().split('T')[0];
};

export const getCookie = (name) => {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
};

export const isMonthInPast = (date) => {
    const currentDate = new Date();
    const currentMonthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const targetMonthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    return targetMonthStart < currentMonthStart;
};

export const getInitialDate = () => {
    const hash = window.location.hash;
    const match = hash.match(/^#(\d{4}-\d{2})$/);
    if (match && match[1]) {
        const [year, month] = match[1].split('-').map(Number);
        if (month >= 1 && month <= 12) return new Date(year, month - 1, 1);
    }
    return new Date();
};
