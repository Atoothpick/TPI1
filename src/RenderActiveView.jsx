import React from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { DashboardView } from './views/DashboardView';
import { JobOverviewView } from './views/JobOverviewView';
import { LogsView } from './views/LogsView';
import { PriceHistoryView } from './views/PriceHistoryView';
import { CostAnalyticsView } from './views/CostAnalyticsView';
import { ReorderView } from './views/ReorderView';
import { MaterialDetailView } from './views/MaterialDetailView';

export const RenderActiveView = ({
    activeView,
    initialCategories,
    inventorySummary,
    incomingSummary,
    isEditMode,
    materials,
    categories,
    handleStockEdit,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    activeCategory,
    handleToggleCategoryForDeletion,
    categoriesToDelete,
    allJobs,
    inventory,
    usageLog,
    suppliers,
    handleAddOrEditOrder,
    handleUseStock,
    selectedJobFromSearch,
    setSelectedJobFromSearch,
    openModalForEdit,
    handleDeleteInventoryGroup,
    handleDeleteLog,
    handleFulfillScheduledLog,
    handleReceiveOrder,
    costBySupplier,
    analyticsByCategory,
    handleRestock,
    materialTypes,
    scrollToMaterial,
    onScrollToComplete,
    setActiveView
}) => {
    switch (activeView) {
        case 'dashboard':
            return (
                <DndContext
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDragCancel={handleDragCancel}
                >
                    <DashboardView
                        inventorySummary={inventorySummary}
                        incomingSummary={incomingSummary}
                        isEditMode={isEditMode}
                        materials={materials}
                        categories={categories}
                        onSave={handleStockEdit}
                        onMaterialClick={(materialType) => {
                            const category = materials[materialType]?.category;
                            if (category) {
                                setActiveView(category);
                                if (scrollToMaterial) {
                                    // handled externally
                                }
                            }
                        }}
                        activeCategory={activeCategory}
                        onDeleteCategory={handleToggleCategoryForDeletion}
                        categoriesToDelete={categoriesToDelete}
                    />
                </DndContext>
            );
        case 'jobs':
            return <JobOverviewView
                allJobs={allJobs}
                inventory={inventory}
                usageLog={usageLog}
                materials={materials}
                suppliers={suppliers}
                handleAddOrEditOrder={handleAddOrEditOrder}
                handleUseStock={handleUseStock}
                initialSelectedJob={selectedJobFromSearch}
                onClearSelectedJob={() => setSelectedJobFromSearch(null)}
            />;
        case 'logs':
            return <LogsView
                inventory={inventory} usageLog={usageLog} onEditOrder={openModalForEdit}
                onDeleteInventoryGroup={handleDeleteInventoryGroup} onDeleteLog={handleDeleteLog}
                materials={materials}
                onFulfillLog={handleFulfillScheduledLog}
                onReceiveOrder={handleReceiveOrder}
            />;
        case 'price-history':
            return <PriceHistoryView inventory={inventory} materials={materials} />;
        case 'analytics':
            return <CostAnalyticsView costBySupplier={costBySupplier} analyticsByCategory={analyticsByCategory} />;
        case 'reorder':
            return <ReorderView inventorySummary={inventorySummary} materials={materials} onRestock={handleRestock} />;
        default:
            if (initialCategories.includes(activeView)) {
                return <MaterialDetailView
                    category={activeView} inventory={inventory} usageLog={usageLog}
                    inventorySummary={inventorySummary} incomingSummary={incomingSummary}
                    materials={materials}
                    materialTypes={materialTypes}
                    onDeleteLog={handleDeleteLog} onDeleteInventoryGroup={handleDeleteInventoryGroup}
                    onEditOrder={openModalForEdit} onReceiveOrder={handleReceiveOrder}
                    onFulfillLog={handleFulfillScheduledLog}
                    scrollToMaterial={scrollToMaterial}
                    onScrollToComplete={onScrollToComplete}
                />;
            }
            return null;
    }
};
