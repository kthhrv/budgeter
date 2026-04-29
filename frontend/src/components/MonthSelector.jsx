import React, { useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDate } from '../utils/helpers';

const MonthSelector = ({ currentDate, isLoading }) => {
    const touchStartX = useRef(null);
    const containerRef = useRef(null);

    const changeMonth = (offset) => {
        const newDate = new Date(currentDate);
        newDate.setMonth(currentDate.getMonth() + offset);
        window.location.hash = formatDate(newDate, 'YYYY-MM');
    };

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const handleTouchStart = (e) => {
            touchStartX.current = e.touches[0].clientX;
        };

        const handleTouchEnd = (e) => {
            if (touchStartX.current === null) return;
            const diff = touchStartX.current - e.changedTouches[0].clientX;
            const threshold = 50;
            if (Math.abs(diff) > threshold) {
                changeMonth(diff > 0 ? 1 : -1);
            }
            touchStartX.current = null;
        };

        el.addEventListener('touchstart', handleTouchStart, { passive: true });
        el.addEventListener('touchend', handleTouchEnd, { passive: true });
        return () => {
            el.removeEventListener('touchstart', handleTouchStart);
            el.removeEventListener('touchend', handleTouchEnd);
        };
    }, [currentDate]);

    return (
        <div ref={containerRef} className="flex items-center justify-between p-4 bg-white shadow-md rounded-xl border border-gray-100 h-full select-none">
            <button onClick={() => changeMonth(-1)} className="p-2 rounded-full hover:bg-gray-200 disabled:opacity-50 transition-colors" disabled={isLoading}>
                <ChevronLeft className="h-6 w-6" />
            </button>
            <h2 className="text-xl md:text-2xl font-bold text-gray-800">{formatDate(currentDate, 'MonthYYYY')}</h2>
            <button onClick={() => changeMonth(1)} className="p-2 rounded-full hover:bg-gray-200 disabled:opacity-50 transition-colors" disabled={isLoading}>
                <ChevronRight className="h-6 w-6" />
            </button>
        </div>
    );
};

export default MonthSelector;
