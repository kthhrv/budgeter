import React from 'react';

const LoadingSkeleton = () => (
    <div className="animate-pulse space-y-6">
        {/* Dashboard skeleton */}
        <div className="p-6 bg-card rounded-xl border border-line">
            <div className="h-5 w-56 bg-line rounded mx-auto mb-5" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {[0, 1, 2].map(i => (
                    <div key={i} className="p-5 bg-line/70 rounded-xl space-y-3">
                        <div className="h-4 w-28 bg-line rounded mx-auto" />
                        <div className="h-8 w-20 bg-line rounded mx-auto" />
                        <div className="h-3 w-32 bg-line rounded mx-auto" />
                    </div>
                ))}
            </div>
        </div>

        {/* Balance cards skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {[0, 1].map(i => (
                <div key={i} className="p-5 bg-card rounded-xl border border-line space-y-4">
                    <div className="flex items-center justify-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-line" />
                        <div className="h-5 w-16 bg-line rounded" />
                    </div>
                    <div className="space-y-3">
                        {[0, 1, 2].map(j => (
                            <div key={j} className="flex justify-between">
                                <div className="h-4 w-28 bg-line rounded" />
                                <div className="h-4 w-20 bg-line rounded" />
                            </div>
                        ))}
                    </div>
                    <div className="h-12 bg-line/70 rounded-lg" />
                </div>
            ))}
        </div>

        {/* Tables skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[0, 1].map(i => (
                <div key={i} className="bg-card p-5 rounded-xl border border-line">
                    <div className="h-6 w-24 bg-line rounded mb-4" />
                    <div className="space-y-3">
                        {[0, 1, 2].map(j => (
                            <div key={j} className="p-4 bg-paper rounded-xl flex items-center justify-between">
                                <div className="space-y-2">
                                    <div className="h-4 w-32 bg-line rounded" />
                                    <div className="flex gap-2">
                                        <div className="h-5 w-14 bg-line rounded-full" />
                                    </div>
                                </div>
                                <div className="h-8 w-20 bg-line rounded-lg" />
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    </div>
);

export default LoadingSkeleton;
