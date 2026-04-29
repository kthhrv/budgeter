import React from 'react';
import { Search, X } from 'lucide-react';

const SearchComponent = ({ searchTerm, onSearchChange, onClearSearch }) => {
    return (
        <div className="relative flex items-center bg-white rounded-xl shadow-sm border border-gray-100 px-2 py-1">
            <Search className="h-4 w-4 text-gray-400 ml-1" />
            <input
                type="text"
                placeholder="Search items..."
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
                className="flex-1 px-2 py-1 text-sm text-gray-700 bg-transparent border-none outline-none placeholder-gray-400"
            />
            {searchTerm && (
                <button
                    onClick={onClearSearch}
                    className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                    title="Clear search"
                >
                    <X className="h-4 w-4" />
                </button>
            )}
        </div>
    );
};

export default SearchComponent;
