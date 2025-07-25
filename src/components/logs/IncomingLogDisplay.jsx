import React, { useMemo } from 'react';
import { Edit, Trash2 } from 'lucide-react';

export const IncomingLogDisplay = ({ inventory, onRowClick, onDelete, onEdit, ordersToShow }) => {
    const incomingItems = useMemo(() => {
        const groupedByOrder = {};
        inventory.filter(item => item.supplier !== 'MODIFICATION').forEach(item => {
            const key = `${item.createdAt}-${item.job || 'stock'}-${item.supplier}`;
            if (!groupedByOrder[key]) {
                groupedByOrder[key] = {
                    id: key, isDeletable: true, isAddition: true, dateOrdered: item.createdAt, customer: item.supplier,
                    job: item.job || 'Stock', qty: 0, details: [], isFuture: item.status === 'Ordered',
                    dateIncoming: item.status === 'On Hand' ? item.dateReceived : item.arrivalDate,
                    materialTypesSummary: new Set(),
                };
            }
            groupedByOrder[key].qty += 1;
            groupedByOrder[key].details.push(item);
            groupedByOrder[key].materialTypesSummary.add(item.materialType);
            if (item.status === 'Ordered' && item.arrivalDate && (!groupedByOrder[key].dateIncoming || new Date(item.arrivalDate) > new Date(groupedByOrder[key].dateIncoming))) {
                groupedByOrder[key].dateIncoming = item.arrivalDate;
            }
        });
        return Object.values(groupedByOrder)
            .map(item => ({ ...item, materialTypesDisplay: Array.from(item.materialTypesSummary).join(', ') }))
            .sort((a, b) => new Date(b.dateOrdered) - new Date(a.dateOrdered));
    }, [inventory]);

    const visibleItems = incomingItems.slice(0, ordersToShow);

    if (visibleItems.length === 0) {
        return <p className="text-center text-slate-400 py-8">No incoming stock logged.</p>;
    }

    return (
        <div className="overflow-x-auto mt-6 bg-slate-800 rounded-xl shadow-sm border border-slate-700">
            <table className="w-full text-left table-auto">
                <thead>
                    <tr className="bg-slate-900/60 border-b border-slate-700">
                        <th className="p-4 font-semibold text-slate-400">ORDER</th>
                        <th className="p-4 font-semibold text-slate-400">SUPPLIER</th>
                        <th className="p-4 font-semibold text-slate-400">MATERIAL(S)</th>
                        <th className="p-4 font-semibold text-slate-400">DATE ORDERED</th>
                        <th className="p-4 font-semibold text-slate-400">DATE INCOMING</th>
                        <th className="p-4 font-semibold text-slate-400 text-right">QTY</th>
                        <th className="p-4 font-semibold text-slate-400 text-center">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {visibleItems.map(item => (
                        <tr key={item.id} onClick={() => onRowClick(item)} className={`border-b border-slate-700 hover:bg-slate-700/50 cursor-pointer ${item.isFuture ? 'bg-yellow-900/20' : ''}`}>
                            <td className="p-4 truncate text-slate-300">{item.job}</td>
                            <td className="p-4 truncate text-slate-300">{item.customer}</td>
                            <td className="p-4 truncate text-slate-300">{item.materialTypesDisplay}</td>
                            <td className="p-4 truncate text-slate-300">{new Date(item.dateOrdered).toLocaleDateString()}</td>
                            <td className="p-4 truncate text-slate-300">
                                {item.dateIncoming ? new Date(item.dateIncoming).toLocaleDateString() : 'N/A'}
                            </td>
                            <td className="p-4 text-green-400 font-mono text-right">+{item.qty}</td>
                            <td className="p-4 text-center">
                                {item.isDeletable && (
                                    <>
                                        <button onClick={(e) => { e.stopPropagation(); onEdit(item); }} className="text-blue-500 hover:text-blue-400 mr-2"><Edit size={16} /></button>
                                        <button onClick={(e) => { e.stopPropagation(); onDelete(item); }} className="text-red-500 hover:text-red-400"><Trash2 size={16} /></button>
                                    </>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};