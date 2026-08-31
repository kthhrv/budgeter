import React from 'react';
import { Search, X } from 'lucide-react';

const SearchComponent = ({ searchTerm, onSearchChange, onClearSearch }) => {
    return (
        <div className="relative flex items-center bg-card rounded-xl shadow-sm border border-line px-2 py-1">
            <Search className="h-4 w-4 text-ink-faint ml-1" />
            <input
                type="text"
                placeholder="Search items..."
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
                className="flex-1 px-2 py-1 text-sm text-ink bg-transparent border-none outline-none placeholder-ink-faint"
            />
            {searchTerm && (
                <button
                    onClick={onClearSearch}
                    className="p-1 text-ink-faint hover:text-ink transition-colors"
                    title="Clear search"
                >
                    <X className="h-4 w-4" />
                </button>
            )}
        </div>
    );
};

export default SearchComponent;
