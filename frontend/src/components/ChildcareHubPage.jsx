import React, { useState } from 'react';
import NurseryPage from './NurseryPage';
import ChildcarePage from './ChildcarePage';

// One Childcare tab for both children: Ellis's nursery invoice model and
// Gaspard's school clubs, toggled at the top. Both sections edit the same
// settings blob (each preserves the other's keys on save).
const ChildcareHubPage = ({ onSettingsChange }) => {
    const [section, setSection] = useState('nursery');
    return (
        <div className="space-y-4">
            <div className="flex justify-center">
                <div className="inline-flex rounded-lg border border-line bg-card p-1 shadow-sm">
                    {[['nursery', 'Nursery · Ellis'], ['school', 'School clubs · Gaspard']].map(([key, label]) => (
                        <button key={key} onClick={() => setSection(key)}
                            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-all ${section === key ? 'bg-accent text-paper' : 'text-ink-soft hover:bg-paper'}`}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>
            {section === 'nursery'
                ? <NurseryPage onSettingsChange={onSettingsChange} />
                : <ChildcarePage onSettingsChange={onSettingsChange} />}
        </div>
    );
};

export default ChildcareHubPage;
