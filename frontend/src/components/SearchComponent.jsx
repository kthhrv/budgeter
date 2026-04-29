import React from 'react';
import { Search, X } from 'lucide-react';

const SearchComponent = ({ searchTerm, onSearchChange, onClearSearch }) => {
    return (
        <div className="relative flex items-center bg-white rounded-xl shadow-md border border-gray-100 p-2">
            <Search className="h-5 w-5 text-gray-400 ml-2" />
            <input
                type="text"
                placeholder="Search items by name, description, or owner..."
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
                className="flex-1 px-3 py-2 text-gray-700 bg-transparent border-none outline-none placeholder-gray-400"
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
