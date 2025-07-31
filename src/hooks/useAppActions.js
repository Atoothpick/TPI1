// src/hooks/useAppActions.js
import { useCallback } from 'react';
import { writeBatch, runTransaction, doc, collection, deleteDoc, updateDoc } from 'firebase/firestore';
import { db, appId } from '../firebase/config';
import { getGaugeFromMaterial } from '../utils/dataProcessing';
import { STANDARD_LENGTHS } from '../constants/materials';

export function useAppActions(params) {
    const {
        materials,
        inventory,
        inventorySummary,
        categoriesToDelete,
        setCategoriesToDelete,
        setIsEditMode,
        closeModal,
        setActiveView,
        setSuppliers,
        setModal,
    } = params;

    const handleConfirmDeleteCategories = useCallback(async () => {
        try {
            const materialsToDelete = Object.values(materials).filter(m => categoriesToDelete.includes(m.category));
            const materialIdsToDelete = materialsToDelete.map(m => m.id);
            const inventoryToDelete = inventory.filter(item => materialIdsToDelete.includes(item.materialType));

            const allDocRefsToDelete = [
                ...materialIdsToDelete.map(id => doc(db, `artifacts/${appId}/public/data/materials`, id.replace(/\//g, '-'))),
                ...inventoryToDelete.map(item => doc(db, `artifacts/${appId}/public/data/inventory`, item.id))
            ];

            const MAX_BATCH_SIZE = 500;
            for (let i = 0; i < allDocRefsToDelete.length; i += MAX_BATCH_SIZE) {
                const chunk = allDocRefsToDelete.slice(i, i + MAX_BATCH_SIZE);
                const batch = writeBatch(db);
                chunk.forEach(docRef => batch.delete(docRef));
                await batch.commit();
            }

            setCategoriesToDelete([]);
            setIsEditMode(false);
            closeModal();
            setActiveView('dashboard');
        } catch (err) {
            console.error("Error deleting categories:", err);
            setModal(prev => ({ ...prev, error: 'Failed to delete categories. Please try again.' }));
        }
    }, [materials, categoriesToDelete, inventory, setCategoriesToDelete, setIsEditMode, closeModal, setActiveView, setModal]);

    const handleUseStock = useCallback(async (jobs, options) => {
        const { isScheduled, scheduledDate } = options;

        await runTransaction(db, async (transaction) => {
            const usageLogCollectionRef = collection(db, `artifacts/${appId}/public/data/usage_logs`);
            const inventoryCollectionRef = collection(db, `artifacts/${appId}/public/data/inventory`);

            for (const job of jobs) {
                if (isScheduled) {
                    const itemsForLog = [];
                    let totalItems = 0;

                    for (const item of job.items) {
                        for (const len of STANDARD_LENGTHS) {
                            const qty = parseInt(item[`qty${len}`] || 0);
                            if (qty > 0) {
                                totalItems += qty;
                                const materialInfo = materials[item.materialType];
                                for (let i = 0; i < qty; i++) {
                                    itemsForLog.push({
                                        materialType: item.materialType,
                                        length: len,
                                        width: 48,
                                        gauge: getGaugeFromMaterial(item.materialType),
                                        density: materialInfo?.density || 0,
                                        thickness: materialInfo?.thickness || 0,
                                    });
                                }
                            }
                        }
                    }

                    if (itemsForLog.length > 0) {
                        const logDocRef = doc(usageLogCollectionRef);
                        const logEntry = {
                            job: job.jobName.trim() || 'N/A',
                            customer: job.customer,
                            createdAt: new Date().toISOString(),
                            usedAt: new Date(`${scheduledDate}T00:00:00`).toISOString(),
                            status: 'Scheduled',
                            details: itemsForLog,
                            qty: -totalItems,
                        };
                        transaction.set(logDocRef, logEntry);
                    }
                } else {
                    const usedItemsForLog = [];
                    const logDocRef = doc(usageLogCollectionRef);

                    for (const item of job.items) {
                        for (const len of STANDARD_LENGTHS) {
                            const qty = parseInt(item[`qty${len}`] || 0);
                            if (qty <= 0) continue;

                            const matchingSheets = inventory.filter(i =>
                                i.materialType === item.materialType && i.length === len && i.status === 'On Hand'
                            ).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

                            if (matchingSheets.length < qty) {
                                throw new Error(`Not enough stock for ${qty}x ${item.materialType} @ ${len}\". Only ${matchingSheets.length} available.`);
                            }

                            const sheetsToUse = matchingSheets.slice(0, qty);
                            sheetsToUse.forEach(sheet => {
                                const stockDocRef = doc(inventoryCollectionRef, sheet.id);
                                transaction.update(stockDocRef, {
                                    status: 'Used',
                                    usageLogId: logDocRef.id,
                                    jobNameUsed: job.jobName.trim() || 'N/A',
                                    customerUsed: job.customer,
                                    usedAt: new Date().toISOString(),
                                });
                                usedItemsForLog.push(sheet);
                            });
                        }
                    }

                    if (usedItemsForLog.length > 0) {
                        const logEntry = {
                            job: job.jobName.trim() || 'N/A',
                            customer: job.customer,
                            usedAt: new Date().toISOString(),
                            createdAt: new Date().toISOString(),
                            status: 'Completed',
                            details: usedItemsForLog,
                            qty: -usedItemsForLog.length,
                        };
                        transaction.set(logDocRef, logEntry);
                    }
                }
            }
        });
    }, [materials, inventory]);

    const handleFulfillScheduledLog = useCallback(async (logToFulfill) => {
        try {
            await runTransaction(db, async (transaction) => {
                const itemsNeeded = logToFulfill.details.reduce((acc, item) => {
                    const key = `${item.materialType}|${item.length}`;
                    acc[key] = (acc[key] || 0) + 1;
                    return acc;
                }, {});

                const inventoryToUpdate = [];
                for (const [key, qty] of Object.entries(itemsNeeded)) {
                    const [materialType, lengthStr] = key.split('|');
                    const length = parseInt(lengthStr, 10);

                    const availableSheets = inventory.filter(i =>
                        i.materialType === materialType && i.length === length && i.status === 'On Hand'
                    ).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

                    if (availableSheets.length < qty) {
                        throw new Error(`Cannot fulfill: Not enough stock for ${qty}x ${materialType} @ ${length}\". Only ${availableSheets.length} available.`);
                    }
                    inventoryToUpdate.push(...availableSheets.slice(0, qty));
                }

                inventoryToUpdate.forEach(sheet => {
                    const docRef = doc(db, `artifacts/${appId}/public/data/inventory`, sheet.id);
                    transaction.update(docRef, {
                        status: 'Used',
                        usageLogId: logToFulfill.id,
                        jobNameUsed: logToFulfill.job,
                        customerUsed: logToFulfill.customer,
                        usedAt: new Date().toISOString(),
                    });
                });

                const logDocRef = doc(db, `artifacts/${appId}/public/data/usage_logs`, logToFulfill.id);
                transaction.update(logDocRef, {
                    status: 'Completed',
                    details: inventoryToUpdate,
                    fulfilledAt: new Date().toISOString(),
                });
            });
        } catch (error) {
            console.error('Fulfillment Error:', error);
            alert(`Failed to fulfill order: ${error.message}`);
        }
    }, [inventory]);

    const handleAddCategory = useCallback(async (categoryName, materialsToAdd) => {
        const batch = writeBatch(db);
        materialsToAdd.forEach(material => {
            const materialId = material.name.replace(/\//g, '-');
            const newMaterialRef = doc(db, `artifacts/${appId}/public/data/materials`, materialId);
            batch.set(newMaterialRef, {
                category: categoryName,
                thickness: parseFloat(material.thickness),
                density: parseFloat(material.density),
            });
        });
        await batch.commit();
    }, []);

    const handleAddSupplier = useCallback((supplier) => {
        setSuppliers(prev => [...prev, supplier]);
    }, [setSuppliers]);

    const handleDeleteSupplier = useCallback((supplier) => {
        setSuppliers(prev => prev.filter(s => s !== supplier));
    }, [setSuppliers]);

    const handleAddOrEditOrder = useCallback(async (jobs, originalOrderGroup = null) => {
        const isEditing = !!originalOrderGroup;
        await runTransaction(db, async (transaction) => {
            if (isEditing) {
                originalOrderGroup.details.forEach(item => {
                    const docRef = doc(db, `artifacts/${appId}/public/data/inventory`, item.id);
                    transaction.delete(docRef);
                });
            }

            const inventoryCollectionRef = collection(db, `artifacts/${appId}/public/data/inventory`);
            jobs.forEach(job => {
                const jobName = job.jobName.trim() || 'N/A';
                job.items.forEach(item => {
                    const arrivalDateString = job.arrivalDate;
                    const localDate = arrivalDateString ? new Date(`${arrivalDateString}T00:00:00`) : null;

                    const stockData = {
                        materialType: item.materialType,
                        gauge: getGaugeFromMaterial(item.materialType),
                        supplier: job.supplier,
                        costPerPound: parseFloat(item.costPerPound || 0),
                        createdAt: isEditing ? (originalOrderGroup.date || originalOrderGroup.dateOrdered) : new Date().toISOString(),
                        job: jobName,
                        status: job.status,
                        arrivalDate: job.status === 'Ordered' && localDate ? localDate.toISOString() : null,
                        dateReceived: null,
                    };

                    STANDARD_LENGTHS.forEach(len => {
                        const qty = parseInt(item[`qty${len}`] || 0);
                        for (let i = 0; i < qty; i++) {
                            const newDocRef = doc(inventoryCollectionRef);
                            transaction.set(newDocRef, { ...stockData, width: 48, length: len });
                        }
                    });
                });
            });
        });
    }, [materials]);

    const handleDeleteInventoryGroup = useCallback(async (group) => {
        if (!group?.details?.length) return;
        const batch = writeBatch(db);
        group.details.forEach(item => {
            const docRef = doc(db, `artifacts/${appId}/public/data/inventory`, item.id);
            batch.delete(docRef);
        });
        await batch.commit();
    }, []);

    const handleDeleteLog = useCallback(async (logId) => {
        const logDocRef = doc(db, `artifacts/${appId}/public/data/usage_logs`, logId);
        await deleteDoc(logDocRef);
    }, []);

    const handleReceiveOrder = useCallback(async (orderGroup) => {
        const batch = writeBatch(db);
        orderGroup.details.forEach(item => {
            if (item.id) {
                const docRef = doc(db, `artifacts/${appId}/public/data/inventory`, item.id);
                batch.update(docRef, { status: 'On Hand', dateReceived: new Date().toISOString().split('T')[0] });
            }
        });
        await batch.commit();
    }, []);

    const handleStockEdit = useCallback(async (materialType, length, newQuantity) => {
        const currentQuantity = inventorySummary[materialType]?.[length] || 0;
        const diff = newQuantity - currentQuantity;
        if (diff === 0) return;

        await runTransaction(db, async (transaction) => {
            const inventoryCollectionRef = collection(db, `artifacts/${appId}/public/data/inventory`);
            if (diff > 0) {
                const materialInfo = materials[materialType];
                const stockData = {
                    materialType,
                    gauge: getGaugeFromMaterial(materialType),
                    supplier: 'Manual Edit',
                    costPerPound: 0,
                    createdAt: new Date().toISOString(),
                    job: 'MODIFICATION: ADD',
                    status: 'On Hand',
                    dateReceived: new Date().toISOString().split('T')[0],
                    width: 48,
                    length,
                    density: materialInfo?.density || 0,
                    thickness: materialInfo?.thickness || 0,
                };
                for (let i = 0; i < diff; i++) {
                    const newDocRef = doc(inventoryCollectionRef);
                    transaction.set(newDocRef, stockData);
                }
            } else {
                const sheetsToRemove = Math.abs(diff);
                const availableSheets = inventory.filter(
                    item => item.materialType === materialType && item.length === length && item.status === 'On Hand'
                ).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

                if (availableSheets.length < sheetsToRemove) {
                    throw new Error(`Cannot remove ${sheetsToRemove} sheets. Only ${availableSheets.length} available.`);
                }

                const sheetsToDelete = availableSheets.slice(0, sheetsToRemove);
                sheetsToDelete.forEach(sheet => {
                    const docRef = doc(db, `artifacts/${appId}/public/data/inventory`, sheet.id);
                    transaction.delete(docRef);
                });
            }
        });
    }, [inventorySummary, materials, inventory]);

    const handleEditOutgoingLog = useCallback(async (originalLog, newLogData) => {
        const logDocRef = doc(db, `artifacts/${appId}/public/data/usage_logs`, originalLog.id);
        if (originalLog.status === 'Scheduled') {
            const newDetails = [];
            let totalItems = 0;
            for (const item of newLogData.items) {
                for (const len of STANDARD_LENGTHS) {
                    const qty = parseInt(item[`qty${len}`] || 0);
                    if (qty > 0) {
                        totalItems += qty;
                        const materialInfo = materials[item.materialType];
                        for (let i = 0; i < qty; i++) {
                            newDetails.push({
                                materialType: item.materialType,
                                length: len,
                                width: 48,
                                gauge: getGaugeFromMaterial(item.materialType),
                                density: materialInfo?.density || 0,
                                thickness: materialInfo?.thickness || 0,
                            });
                        }
                    }
                }
            }
            await updateDoc(logDocRef, {
                job: newLogData.jobName.trim() || 'N/A',
                customer: newLogData.customer,
                usedAt: new Date(`${newLogData.date}T00:00:00`).toISOString(),
                details: newDetails,
                qty: -totalItems,
            });
        } else {
            await runTransaction(db, async (transaction) => {
                const inventoryCollectionRef = collection(db, `artifacts/${appId}/public/data/inventory`);
                const netChange = {};
                (originalLog.details || []).forEach(item => {
                    const key = `${item.materialType}|${item.length}`;
                    netChange[key] = (netChange[key] || 0) + 1;
                });
                newLogData.items.forEach(item => {
                    STANDARD_LENGTHS.forEach(len => {
                        const qty = parseInt(item[`qty${len}`] || 0);
                        if (qty > 0) {
                            const key = `${item.materialType}|${len}`;
                            netChange[key] = (netChange[key] || 0) - qty;
                        }
                    });
                });

                for (const key in netChange) {
                    if (netChange[key] < 0) {
                        const [materialType, lengthStr] = key.split('|');
                        const length = parseInt(lengthStr, 10);
                        const needed = Math.abs(netChange[key]);

                        const currentStock = inventory.filter(i =>
                            i.materialType === materialType && i.length === length && i.status === 'On Hand'
                        ).length;

                        if (currentStock < needed) {
                            throw new Error(`Not enough stock for ${materialType} @ ${length}\". Needed: ${needed}, Available: ${currentStock}.`);
                        }
                    }
                }

                const originalItemIds = (originalLog.details || []).map(d => d.id);
                const itemsToReturn = inventory.filter(i => originalItemIds.includes(i.id));
                itemsToReturn.forEach(item => {
                    const docRef = doc(inventoryCollectionRef, item.id);
                    transaction.update(docRef, {
                        status: 'On Hand',
                        usageLogId: null,
                        jobNameUsed: null,
                        customerUsed: null,
                        usedAt: null,
                    });
                });

                const updatedUsedItemsForLog = [];
                for (const item of newLogData.items) {
                    for (const len of STANDARD_LENGTHS) {
                        const qty = parseInt(item[`qty${len}`] || 0);
                        if (qty <= 0) continue;

                        const matchingSheets = inventory.filter(
                            i => i.materialType === item.materialType && i.length === len && i.status === 'On Hand' && !originalItemIds.includes(i.id)
                        ).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

                        const sheetsToUse = matchingSheets.slice(0, qty);
                        if (sheetsToUse.length < qty) {
                            throw new Error(`Concurrency Error: Not enough stock for ${item.materialType} @ ${len}\" during edit.`);
                        }

                        sheetsToUse.forEach(sheet => {
                            const stockDocRef = doc(inventoryCollectionRef, sheet.id);
                            transaction.update(stockDocRef, {
                                status: 'Used',
                                usageLogId: originalLog.id,
                                jobNameUsed: newLogData.jobName,
                                customerUsed: newLogData.customer,
                                usedAt: new Date().toISOString(),
                            });
                            updatedUsedItemsForLog.push(sheet);
                        });
                    }
                }

                transaction.update(logDocRef, {
                    job: newLogData.jobName,
                    customer: newLogData.customer,
                    details: updatedUsedItemsForLog,
                    qty: -updatedUsedItemsForLog.length,
                });
            });
        }
    }, [inventory, materials]);

    return {
        handleConfirmDeleteCategories,
        handleUseStock,
        handleFulfillScheduledLog,
        handleAddCategory,
        handleAddSupplier,
        handleDeleteSupplier,
        handleAddOrEditOrder,
        handleDeleteInventoryGroup,
        handleDeleteLog,
        handleReceiveOrder,
        handleStockEdit,
        handleEditOutgoingLog,
    };
}
