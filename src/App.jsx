// src/App.jsx

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { writeBatch, runTransaction, doc, collection, deleteDoc, updateDoc } from 'firebase/firestore';
import Fuse from 'fuse.js';
import { db, appId } from './firebase/config';
import { useFirestoreData } from './hooks/useFirestoreData';
import { usePersistentState } from './hooks/usePersistentState';
import {
    calculateInventorySummary,
    calculateIncomingSummary,
    getGaugeFromMaterial,
    calculateCostBySupplier,
    calculateAnalyticsByCategory,
    groupLogsByJob
} from './utils/dataProcessing';
import { INITIAL_SUPPLIERS, STANDARD_LENGTHS } from './constants/materials';

// Layout & Common Components
import { Header } from './components/layout/Header';
import { ViewTabs } from './components/layout/ViewTabs';
import { LoadingSpinner } from './components/common/LoadingSpinner';
import { ErrorMessage } from './components/common/ErrorMessage';
import { SearchResultsDropdown } from './components/common/SearchResultsDropdown';

// Views
import { AuthView } from './views/AuthView';
import { RenderActiveView } from "./RenderActiveView";
import { ModalManager } from "./ModalManager";




export default function App() {
    const [isLoggedIn, setIsLoggedIn] = useState(localStorage.getItem('isLoggedIn') === 'true');
    const { inventory, usageLog, materials, loading, error, userId } = useFirestoreData();

    const [activeView, setActiveView] = useState('dashboard');
    const [modal, setModal] = useState({ type: null, data: null, error: null });
    const [isEditMode, setIsEditMode] = useState(false);
    const [scrollToMaterial, setScrollToMaterial] = useState(null);
    const [activeCategory, setActiveCategory] = useState(null);
    const [suppliers, setSuppliers] = usePersistentState('suppliers', INITIAL_SUPPLIERS);
    const [categoriesToDelete, setCategoriesToDelete] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedJobFromSearch, setSelectedJobFromSearch] = useState(null);
    const searchInputRef = useRef(null);
    const [searchResults, setSearchResults] = useState([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const [fuse, setFuse] = useState(null);
    const searchTimeoutRef = useRef(null);

    const closeModal = useCallback(() => setModal({ type: null, data: null, error: null }), []);

    const clearSearch = useCallback(() => {
        setSearchQuery('');
        setSearchResults([]);
        setActiveIndex(0);
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }
    }, []);

    // Effect to handle Escape key for closing modals and search
    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                if (modal.type) {
                    closeModal();
                } else if (searchQuery) {
                    clearSearch();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [closeModal, clearSearch, modal.type, searchQuery]);

    // Effect to handle global keypress to focus search
    useEffect(() => {
        const handleGlobalKeyPress = (event) => {
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
            if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
                searchInputRef.current?.focus();
            }
        };
        window.addEventListener('keydown', handleGlobalKeyPress);
        return () => window.removeEventListener('keydown', handleGlobalKeyPress);
    }, []);

    const initialCategories = useMemo(() => [...new Set(Object.values(materials).map(m => m.category))], [materials]);
    const [categories, setCategories] = usePersistentState('dashboard-category-order', initialCategories);

    useEffect(() => {
        if (!loading) {
            setCategories(prevOrder => {
                const liveCategories = new Set(initialCategories);
                const validOrdered = prevOrder.filter(cat => liveCategories.has(cat));
                const newCategories = initialCategories.filter(cat => !prevOrder.includes(cat));
                return [...validOrdered, ...newCategories];
            });
        }
    }, [initialCategories, setCategories, loading]);

    const materialTypes = useMemo(() => Object.keys(materials), [materials]);
    const allJobs = useMemo(() => groupLogsByJob(inventory, usageLog), [inventory, usageLog]);
    const inventorySummary = useMemo(() => calculateInventorySummary(inventory, materialTypes), [inventory, materialTypes]);
    const incomingSummary = useMemo(() => calculateIncomingSummary(inventory, materialTypes), [inventory, materialTypes]);
    const costBySupplier = useMemo(() => calculateCostBySupplier(inventory, materials), [inventory, materials]);
    const analyticsByCategory = useMemo(() => calculateAnalyticsByCategory(inventory, materials), [inventory, materials]);

    const handleSignOut = useCallback(() => {
        localStorage.removeItem('isLoggedIn');
        setIsLoggedIn(false);
    }, []);

    const handleFinishEditing = useCallback(() => {
        if (categoriesToDelete.length > 0) {
            setModal({ type: 'confirm-delete-categories', data: categoriesToDelete });
        } else {
            setIsEditMode(false);
        }
    }, [categoriesToDelete]);

    // Fuse.js search index setup
    useEffect(() => {
        if (loading) return;

        const commands = [
            { type: 'command', name: 'Add Stock', aliases: ['add', 'new', 'order'], action: () => setModal({ type: 'add' }) },
            { type: 'command', name: 'Use Stock', aliases: ['use'], action: () => setModal({ type: 'use' }) },
            { type: 'command', name: 'Add Category', aliases: ['ac', 'add cat'], action: () => setModal({ type: 'add-category' }) },
            { type: 'command', name: 'Manage Suppliers', aliases: ['ms', 'manage sup'], action: () => setModal({ type: 'manage-suppliers' }) },
            { type: 'command', name: 'Edit/Finish', aliases: ['edit', 'finish'], action: () => isEditMode ? handleFinishEditing() : setIsEditMode(true), view: 'dashboard' },
            { type: 'command', name: 'Sign Out', aliases: ['sign out', 'logout', 'log off'], action: () => handleSignOut() },
        ];

        const views = [
            { type: 'view', name: 'Dashboard', id: 'dashboard' },
            { type: 'view', name: 'Jobs', id: 'jobs' },
            { type: 'view', name: 'Logs', id: 'logs' },
            { type: 'view', name: 'Price History', id: 'price-history' },
            { type: 'view', name: 'Analytics', id: 'analytics' },
            { type: 'view', name: 'Reorder', id: 'reorder' },
        ];

        const searchDocs = [
            ...commands.flatMap(c => [{ type: c.type, name: c.name, action: c.action, view: c.view }, ...c.aliases.map(a => ({ type: c.type, name: `${c.name} (alias: ${a})`, alias: a, action: c.action, view: c.view }))]),
            ...views.map(v => ({ type: 'view', name: v.name, id: v.id })),
            ...initialCategories.map(c => ({ type: 'category', name: c })),
            ...materialTypes.map(m => ({ type: 'material', name: m, category: materials[m]?.category })),
            ...allJobs.map(j => ({ type: 'job', name: j.job, customer: j.customer, data: j })),
        ];

        const fuseOptions = {
            includeScore: true,
            keys: ['name', 'alias', 'customer'],
            threshold: 0.4,
        };

        setFuse(new Fuse(searchDocs, fuseOptions));

    }, [loading, materials, inventory, usageLog, initialCategories, isEditMode, allJobs, materialTypes, handleFinishEditing, handleSignOut]);


    const handleSearchChange = (e) => {
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        const query = e.target.value;
        setSearchQuery(query);
        setActiveIndex(0);

        if (query.trim() === '') {
            setSearchResults([]);
            return;
        }

        if (fuse) {
            const results = fuse.search(query).slice(0, 10);
            setSearchResults(results);
        }

        searchTimeoutRef.current = setTimeout(() => {
            setSearchResults([]);
        }, 2000); // Disappear after 2 seconds
    };

    const handleResultSelect = (result) => {
        const item = result.item;
        switch (item.type) {
            case 'command':
                if (item.view && activeView !== item.view) break;
                item.action();
                break;
            case 'view':
                setActiveView(item.id);
                break;
            case 'category':
                setActiveView(item.name);
                break;
            case 'material':
                setActiveView(item.category);
                setScrollToMaterial(item.name);
                break;
            case 'job':
                setActiveView('jobs');
                setSelectedJobFromSearch(item.data);
                break;
            default:
                break;
        }
        clearSearch();
        searchInputRef.current?.blur();
    };

    const handleSearchKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (searchResults[activeIndex]) {
                handleResultSelect(searchResults[activeIndex]);
            }
            return;
        }

        if (searchResults.length === 0) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setActiveIndex(prev => (prev + 1) % searchResults.length);
                break;
            case 'ArrowUp':
                e.preventDefault();
                setActiveIndex(prev => (prev - 1 + searchResults.length) % searchResults.length);
                break;
            default:
                break;
        }
    };


    const onScrollToComplete = useCallback(() => setScrollToMaterial(null), []);

    const handleRestock = (materialType) => {
        setModal({ type: 'add', data: { preselectedMaterial: materialType } });
    };

    const handleDragStart = (event) => setActiveCategory(event.active.id);
    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setCategories((items) => arrayMove(items, items.indexOf(active.id), items.indexOf(over.id)));
        }
        setActiveCategory(null);
    };
    const handleDragCancel = () => setActiveCategory(null);

    const handleToggleCategoryForDeletion = (categoryName) => {
        setCategoriesToDelete(prev =>
            prev.includes(categoryName)
                ? prev.filter(c => c !== categoryName)
                : [...prev, categoryName]
        );
    };

    // ... (All other handle functions: handleConfirmDeleteCategories, handleUseStock, etc. remain unchanged)


    const handleConfirmDeleteCategories = async () => {
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
            setModal(prev => ({ ...prev, error: "Failed to delete categories. Please try again." }));
        }
    };

    const handleUseStock = async (jobs, options) => {
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
                            usedAt: new Date(scheduledDate + 'T00:00:00').toISOString(),
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
                                throw new Error(`Not enough stock for ${qty}x ${item.materialType} @ ${len}". Only ${matchingSheets.length} available.`);
                            }

                            const sheetsToUse = matchingSheets.slice(0, qty);
                            sheetsToUse.forEach(sheet => {
                                const stockDocRef = doc(inventoryCollectionRef, sheet.id);
                                transaction.update(stockDocRef, {
                                    status: 'Used',
                                    usageLogId: logDocRef.id,
                                    jobNameUsed: job.jobName.trim() || 'N/A',
                                    customerUsed: job.customer,
                                    usedAt: new Date().toISOString()
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
    };

    const handleFulfillScheduledLog = async (logToFulfill) => {
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
                        throw new Error(`Cannot fulfill: Not enough stock for ${qty}x ${materialType} @ ${length}". Only ${availableSheets.length} available.`);
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
                        usedAt: new Date().toISOString()
                    });
                });

                const logDocRef = doc(db, `artifacts/${appId}/public/data/usage_logs`, logToFulfill.id);
                transaction.update(logDocRef, {
                    status: 'Completed',
                    details: inventoryToUpdate,
                    fulfilledAt: new Date().toISOString()
                });
            });
        } catch (error) {
            console.error("Fulfillment Error:", error);
            alert(`Failed to fulfill order: ${error.message}`);
        }
    };

    const handleAddCategory = async (categoryName, materialsToAdd) => {
        const batch = writeBatch(db);

        materialsToAdd.forEach(material => {
            const materialId = material.name.replace(/\//g, '-');
            const newMaterialRef = doc(db, `artifacts/${appId}/public/data/materials`, materialId);

            batch.set(newMaterialRef, {
                category: categoryName,
                thickness: parseFloat(material.thickness),
                density: parseFloat(material.density)
            });
        });

        await batch.commit();
    };

    const handleAddSupplier = (supplier) => {
        setSuppliers(prev => [...prev, supplier]);
    };

    const handleDeleteSupplier = (supplier) => {
        setSuppliers(prev => prev.filter(s => s !== supplier));
    };

    const handleAddOrEditOrder = async (jobs, originalOrderGroup = null) => {
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
    };

    const handleDeleteInventoryGroup = async (group) => {
        if (!group?.details?.length) return;
        const batch = writeBatch(db);
        group.details.forEach(item => {
            const docRef = doc(db, `artifacts/${appId}/public/data/inventory`, item.id);
            batch.delete(docRef);
        });
        await batch.commit();
    };

    const handleDeleteLog = async (logId) => {
        const logDocRef = doc(db, `artifacts/${appId}/public/data/usage_logs`, logId);
        await deleteDoc(logDocRef);
    };

    const handleReceiveOrder = async (orderGroup) => {
        const batch = writeBatch(db);
        orderGroup.details.forEach(item => {
            if (item.id) {
                const docRef = doc(db, `artifacts/${appId}/public/data/inventory`, item.id);
                batch.update(docRef, { status: 'On Hand', dateReceived: new Date().toISOString().split('T')[0] });
            }
        });
        await batch.commit();
    };

    const handleStockEdit = async (materialType, length, newQuantity) => {
        const currentQuantity = inventorySummary[materialType]?.[length] || 0;
        const diff = newQuantity - currentQuantity;

        if (diff === 0) return;

        await runTransaction(db, async (transaction) => {
            const inventoryCollectionRef = collection(db, `artifacts/${appId}/public/data/inventory`);

            if (diff > 0) {
                const materialInfo = materials[materialType];
                const stockData = {
                    materialType: materialType,
                    gauge: getGaugeFromMaterial(materialType),
                    supplier: 'Manual Edit',
                    costPerPound: 0,
                    createdAt: new Date().toISOString(),
                    job: `MODIFICATION: ADD`,
                    status: 'On Hand',
                    dateReceived: new Date().toISOString().split('T')[0],
                    width: 48,
                    length: length,
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
                    item => item.materialType === materialType &&
                        item.length === length &&
                        item.status === 'On Hand'
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
    };

    const handleEditOutgoingLog = async (originalLog, newLogData) => {
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
                                materialType: item.materialType, length: len, width: 48,
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
                usedAt: new Date(newLogData.date + 'T00:00:00').toISOString(),
                details: newDetails,
                qty: -totalItems
            });
        } else {
            // Logic for editing a COMPLETED log
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
                            i.materialType === materialType &&
                            i.length === length &&
                            i.status === 'On Hand'
                        ).length;

                        if (currentStock < needed) {
                            throw new Error(`Not enough stock for ${materialType} @ ${length}". Needed: ${needed}, Available: ${currentStock}.`);
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
                        usedAt: null
                    });
                });

                const updatedUsedItemsForLog = [];
                for (const item of newLogData.items) {
                    for (const len of STANDARD_LENGTHS) {
                        const qty = parseInt(item[`qty${len}`] || 0);
                        if (qty <= 0) continue;

                        const matchingSheets = inventory.filter(
                            (i) => i.materialType === item.materialType && i.length === len && i.status === 'On Hand' && !originalItemIds.includes(i.id)
                        ).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

                        const sheetsToUse = matchingSheets.slice(0, qty);

                        if (sheetsToUse.length < qty) {
                            throw new Error(`Concurrency Error: Not enough stock for ${item.materialType} @ ${len}" during edit.`);
                        }

                        sheetsToUse.forEach((sheet) => {
                            const stockDocRef = doc(inventoryCollectionRef, sheet.id);
                            transaction.update(stockDocRef, {
                                status: 'Used',
                                usageLogId: originalLog.id,
                                jobNameUsed: newLogData.jobName,
                                customerUsed: newLogData.customer,
                                usedAt: new Date().toISOString()
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
    };

    const openModalForEdit = (transaction) => {
        const modalType = transaction.isAddition ? 'edit-order' : 'edit-log';
        setModal({ type: modalType, data: transaction });
    };




    if (!isLoggedIn) {
        return <AuthView onLoginSuccess={() => setIsLoggedIn(true)} />;
    }

    return (
        <div className="bg-zinc-900 min-h-screen font-sans text-zinc-200">
            <div className="container mx-auto p-4 md:p-8">
                <Header
                    ref={searchInputRef}
                    onAdd={() => setModal({ type: 'add' })}
                    onUse={() => setModal({ type: 'use' })}
                    onEdit={() => isEditMode ? handleFinishEditing() : setIsEditMode(true)}
                    onSignOut={handleSignOut}
                    isEditMode={isEditMode}
                    onAddCategory={() => setModal({ type: 'add-category' })}
                    onManageSuppliers={() => setModal({ type: 'manage-suppliers' })}
                    activeView={activeView}
                    searchQuery={searchQuery}
                    onSearchChange={handleSearchChange}
                    onKeyDown={handleSearchKeyDown}
                />

                <div className="relative">
                    {searchResults.length > 0 && (
                        <SearchResultsDropdown
                            results={searchResults}
                            onSelect={handleResultSelect}
                            activeIndex={activeIndex}
                            setActiveIndex={setActiveIndex}
                        />
                    )}
                </div>


                <ViewTabs activeView={activeView} setActiveView={setActiveView} categories={categories} />
                {error && <ErrorMessage message={error} />}

                {loading ? (
                    <LoadingSpinner />
                ) : (
                    <RenderActiveView
                        activeView={activeView}
                        initialCategories={initialCategories}
                        inventorySummary={inventorySummary}
                        incomingSummary={incomingSummary}
                        isEditMode={isEditMode}
                        materials={materials}
                        categories={categories}
                        handleStockEdit={handleStockEdit}
                        handleDragStart={handleDragStart}
                        handleDragEnd={handleDragEnd}
                        handleDragCancel={handleDragCancel}
                        activeCategory={activeCategory}
                        handleToggleCategoryForDeletion={handleToggleCategoryForDeletion}
                        categoriesToDelete={categoriesToDelete}
                        allJobs={allJobs}
                        inventory={inventory}
                        usageLog={usageLog}
                        suppliers={suppliers}
                        handleAddOrEditOrder={handleAddOrEditOrder}
                        handleUseStock={handleUseStock}
                        selectedJobFromSearch={selectedJobFromSearch}
                        setSelectedJobFromSearch={setSelectedJobFromSearch}
                        openModalForEdit={openModalForEdit}
                        handleDeleteInventoryGroup={handleDeleteInventoryGroup}
                        handleDeleteLog={handleDeleteLog}
                        handleFulfillScheduledLog={handleFulfillScheduledLog}
                        handleReceiveOrder={handleReceiveOrder}
                        costBySupplier={costBySupplier}
                        analyticsByCategory={analyticsByCategory}
                        handleRestock={handleRestock}
                        materialTypes={materialTypes}
                        scrollToMaterial={scrollToMaterial}
                        onScrollToComplete={onScrollToComplete}
                        setActiveView={setActiveView}
                    />
                )}

                <footer className="text-center text-zinc-500 mt-8 text-sm">
                    <p>TecnoPan Inventory System</p>
                    <p>User: <span className="font-mono bg-zinc-800 px-2 py-1 rounded">{userId}</span></p>
                </footer>
            </div>

            <ModalManager
                modal={modal}
                closeModal={closeModal}
                handleAddOrEditOrder={handleAddOrEditOrder}
                materialTypes={materialTypes}
                suppliers={suppliers}
                inventory={inventory}
                inventorySummary={inventorySummary}
                incomingSummary={incomingSummary}
                handleUseStock={handleUseStock}
                handleEditOutgoingLog={handleEditOutgoingLog}
                handleAddCategory={handleAddCategory}
                handleAddSupplier={handleAddSupplier}
                handleDeleteSupplier={handleDeleteSupplier}
                handleConfirmDeleteCategories={handleConfirmDeleteCategories}
            />
        </div>
    );
}
