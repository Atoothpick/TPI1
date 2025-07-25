import React, { useState } from 'react';
import { runTransaction, collection, doc } from 'firebase/firestore';
import { db, appId } from '../../firebase/config';
import { BaseModal } from './BaseModal';
import { useOrderForm } from '../../hooks/useOrderForm';
import { MATERIAL_TYPES, STANDARD_LENGTHS } from '../../constants/materials';
import { FormInput } from '../common/FormInput';
import { Button } from '../common/Button';
import { ErrorMessage } from '../common/ErrorMessage';
import { X } from 'lucide-react';

export const UseStockModal = ({ onClose, inventory }) => {
    const { jobs, setJobField, setItemField, addJob, removeJob, addMaterial, removeMaterial } = useOrderForm();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (jobs.some(j => !j.customer.trim())) {
            setError('A Customer name is required for all jobs.');
            return;
        }
        setIsSubmitting(true);
        setError('');

        try {
            await runTransaction(db, async (transaction) => {
                const usageLogCollectionRef = collection(db, `artifacts/${appId}/public/data/usage_logs`);

                for (const job of jobs) {
                    const usedItemsForLog = [];
                    for (const item of job.items) {
                        for (const len of STANDARD_LENGTHS) {
                            const qty = parseInt(item[`qty${len}`] || 0);
                            if (qty <= 0) continue;

                            const matchingSheets = inventory
                                .filter(i => i.materialType === item.materialType && i.length === len && i.status !== 'Ordered')
                                .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

                            if (matchingSheets.length < qty) {
                                throw new Error(`Not enough stock for ${qty}x ${item.materialType} @ ${len}". Only ${matchingSheets.length} available.`);
                            }

                            const sheetsToUse = matchingSheets.slice(0, qty);
                            sheetsToUse.forEach(sheet => {
                                const stockDocRef = doc(db, `artifacts/${appId}/public/data/inventory`, sheet.id);
                                transaction.delete(stockDocRef);
                                const { id, ...rest } = sheet;
                                usedItemsForLog.push({ ...rest, qty: 1 });
                            });
                        }
                    }

                    if (usedItemsForLog.length > 0) {
                        const logDocRef = doc(usageLogCollectionRef);
                        const logEntry = {
                            job: job.jobName || '',
                            customer: job.customer,
                            usedAt: new Date().toISOString(),
                            createdAt: new Date().toISOString(),
                            details: usedItemsForLog,
                            qty: -usedItemsForLog.length
                        };
                        transaction.set(logDocRef, logEntry);
                    }
                }
            });
            onClose();
        } catch (err) {
            console.error("Transaction failed:", err);
            setError(err.message || "Failed to update stock.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <BaseModal onClose={onClose} title="Use Stock for Jobs">
            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2 border-t border-b border-slate-700 py-4">
                    {jobs.map((job, jobIndex) => (
                        <div key={jobIndex} className="p-4 border border-slate-700 rounded-lg bg-slate-900/50 relative">
                            {jobs.length > 1 && (
                                <button type="button" onClick={() => removeJob(jobIndex)} className="absolute top-2 right-2 text-red-400 hover:text-red-300"><X size={18} /></button>
                            )}
                            <FormInput label="Customer" name="customer" value={job.customer} onChange={(e) => setJobField(jobIndex, 'customer', e.target.value)} required />
                            <div className='mt-4'>
                                <FormInput label={`Job #${jobIndex + 1} Name / Project`} name="jobName" value={job.jobName} onChange={(e) => setJobField(jobIndex, 'jobName', e.target.value)} />
                            </div>
                            <div className="mt-4 space-y-2">
                                {job.items.map((item, itemIndex) => (
                                    <div key={itemIndex} className="border border-slate-700 p-4 rounded-lg bg-slate-800 relative">
                                        {job.items.length > 1 && (
                                            <button type="button" onClick={() => removeMaterial(jobIndex, itemIndex)} className="absolute top-2 right-2 text-red-400 hover:text-red-300"><X size={18} /></button>
                                        )}
                                        <FormInput label={`Material Type #${itemIndex + 1}`} name="materialType" value={item.materialType} onChange={(e) => setItemField(jobIndex, itemIndex, 'materialType', e.target.value)} as="select">{MATERIAL_TYPES.map(type => <option key={type}>{type}</option>)}</FormInput>
                                        <p className="text-sm font-medium text-slate-300 mt-2">Quantities to Use:</p>
                                        <div className="grid grid-cols-3 gap-2">
                                            <FormInput label='96"x48"' name="qty96" type="number" placeholder="0" value={item.qty96} onChange={(e) => setItemField(jobIndex, itemIndex, 'qty96', e.target.value)} />
                                            <FormInput label='120"x48"' name="qty120" type="number" placeholder="0" value={item.qty120} onChange={(e) => setItemField(jobIndex, itemIndex, 'qty120', e.target.value)} />
                                            <FormInput label='144"x48"' name="qty144" type="number" placeholder="0" value={item.qty144} onChange={(e) => setItemField(jobIndex, itemIndex, 'qty144', e.target.value)} />
                                        </div>
                                    </div>
                                ))}
                                <Button variant="ghost" className="w-full mt-2 !border-dashed !border-slate-600 hover:!border-blue-500" onClick={() => addMaterial(jobIndex)}>+ Add Material to this Job</Button>
                            </div>
                        </div>
                    ))}
                </div>
                <Button variant="ghost" className="w-full !border-2 !border-dashed !border-slate-600 hover:!border-blue-500" onClick={addJob}>+ Add Another Job</Button>
                {error && <ErrorMessage message={error} />}
                <div className="flex justify-end pt-4">
                    <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Processing...' : 'Confirm Usage'}</Button>
                </div>
            </form>
        </BaseModal>
    );
};
