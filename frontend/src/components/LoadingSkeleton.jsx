import React from 'react';

const LoadingSkeleton = () => (
    <div className="animate-pulse space-y-6">
        {/* Dashboard skeleton */}
        <div className="p-6 bg-white rounded-xl shadow-md border border-gray-100">
            <div className="h-5 w-56 bg-gray-200 rounded mx-auto mb-5" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {[0, 1, 2].map(i => (
                    <div key={i} className="p-5 bg-gray-100 rounded-xl space-y-3">
                        <div className="h-4 w-28 bg-gray-200 rounded mx-auto" />
                        <div className="h-8 w-20 bg-gray-200 rounded mx-auto" />
                        <div className="h-3 w-32 bg-gray-200 rounded mx-auto" />
                    </div>
                ))}
            </div>
        </div>

        {/* Balance cards skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {[0, 1].map(i => (
                <div key={i} className="p-5 bg-white rounded-xl shadow-md border border-gray-100 space-y-4">
                    <div className="flex items-center justify-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-gray-200" />
                        <div className="h-5 w-16 bg-gray-200 rounded" />
                    </div>
                    <div className="space-y-3">
                        {[0, 1, 2].map(j => (
                            <div key={j} className="flex justify-between">
                                <div className="h-4 w-28 bg-gray-200 rounded" />
                                <div className="h-4 w-20 bg-gray-200 rounded" />
                            </div>
                        ))}
                    </div>
                    <div className="h-12 bg-gray-100 rounded-lg" />
                </div>
            ))}
        </div>

        {/* Tables skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[0, 1].map(i => (
                <div key={i} className="bg-white p-5 rounded-xl shadow-md border border-gray-100">
                    <div className="h-6 w-24 bg-gray-200 rounded mb-4" />
                    <div className="space-y-3">
                        {[0, 1, 2].map(j => (
                            <div key={j} className="p-4 bg-gray-50 rounded-xl flex items-center justify-between">
                                <div className="space-y-2">
                                    <div className="h-4 w-32 bg-gray-200 rounded" />
                                    <div className="flex gap-2">
                                        <div className="h-5 w-14 bg-gray-200 rounded-full" />
                                    </div>
                                </div>
                                <div className="h-8 w-20 bg-gray-200 rounded-lg" />
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    </div>
);

export default LoadingSkeleton;
