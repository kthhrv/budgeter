import React, { useRef, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDate } from '../utils/helpers';

const MonthSelector = ({ currentDate, isLoading }) => {
    const touchStartX = useRef(null);
    const containerRef = useRef(null);

    const changeMonth = useCallback((offset) => {
        const newDate = new Date(currentDate);
        newDate.setMonth(currentDate.getMonth() + offset);
        window.location.hash = formatDate(newDate, 'YYYY-MM');
    }, [currentDate]);

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
    }, [changeMonth]);

    return (
        <div ref={containerRef} className="flex items-center gap-2 select-none">
            <button onClick={() => changeMonth(-1)} className="p-1.5 rounded-full hover:bg-gray-200 disabled:opacity-50 transition-colors" disabled={isLoading}>
                <ChevronLeft className="h-5 w-5 text-gray-600" />
            </button>
            <h2 className="text-lg font-bold text-gray-800 min-w-[140px] text-center">{formatDate(currentDate, 'MonthYYYY')}</h2>
            <button onClick={() => changeMonth(1)} className="p-1.5 rounded-full hover:bg-gray-200 disabled:opacity-50 transition-colors" disabled={isLoading}>
                <ChevronRight className="h-5 w-5 text-gray-600" />
            </button>
        </div>
    );
};

export default MonthSelector;
