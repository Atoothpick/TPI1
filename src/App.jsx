// src/App.jsx

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import Fuse from 'fuse.js';
import { useFirestoreData } from './hooks/useFirestoreData';
import { usePersistentState } from './hooks/usePersistentState';
import {
    calculateInventorySummary,
    calculateIncomingSummary,
    calculateCostBySupplier,
    calculateAnalyticsByCategory,
    groupLogsByJob
} from './utils/dataProcessing';
import { INITIAL_SUPPLIERS } from './constants/materials';

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
import { useAppActions } from './hooks/useAppActions';




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

    const {
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
    } = useAppActions({
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
    });

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
