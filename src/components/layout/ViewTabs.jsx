import React from 'react';
import { CATEGORIES } from '../../constants/materials';

export const ViewTabs = ({ activeView, setActiveView }) => {
    // Add 'analytics' to the list of views
    const views = ['dashboard', 'logs', 'analytics', ...CATEGORIES];

    const handleViewChange = (view) => {
        setActiveView(view);
    };

    return (
        <div className="mb-8 border-b border-slate-700">
            <nav className="-mb-px flex space-x-8 overflow-x-auto">
                {views.map(view => {
                    // Define display names for the tabs
                    const viewName = {
                        dashboard: 'Dashboard',
                        logs: 'Logs',
                        analytics: 'Cost Analytics'
                    }[view] || view;

                    return (
                        <button
                            key={view}
                            onClick={() => handleViewChange(view)}
                            className={`shrink-0 py-4 px-1 border-b-2 font-medium text-sm capitalize ${activeView === view ? 'border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-white hover:border-slate-500'}`}
                        >
                            {viewName}
                        </button>
                    )
                })}
            </nav>
        </div>
    );
};
