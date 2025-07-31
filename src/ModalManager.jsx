import React from 'react';
import { AddOrderModal } from './components/modals/AddOrderModal';
import { UseStockModal } from './components/modals/UseStockModal';
import { EditOutgoingLogModal } from './components/modals/EditOutgoingLogModal';
import { AddCategoryModal } from './components/modals/AddCategoryModal';
import { ManageSuppliersModal } from './components/modals/ManageSuppliersModal';
import { ConfirmationModal } from './components/modals/ConfirmationModal';

export const ModalManager = ({
    modal,
    closeModal,
    handleAddOrEditOrder,
    materialTypes,
    suppliers,
    inventory,
    inventorySummary,
    incomingSummary,
    handleUseStock,
    handleEditOutgoingLog,
    handleAddCategory,
    handleAddSupplier,
    handleDeleteSupplier,
    handleConfirmDeleteCategories
}) => {
    return (
        <>
            {modal.type === 'add' && (
                <AddOrderModal
                    onClose={closeModal}
                    onSave={handleAddOrEditOrder}
                    materialTypes={materialTypes}
                    suppliers={suppliers}
                    preselectedMaterial={modal.data?.preselectedMaterial}
                />
            )}
            {modal.type === 'edit-order' && (
                <AddOrderModal
                    onClose={closeModal}
                    onSave={(jobs) => handleAddOrEditOrder(jobs, modal.data)}
                    initialData={modal.data}
                    title="Edit Stock Order"
                    materialTypes={materialTypes}
                    suppliers={suppliers}
                />
            )}
            {modal.type === 'use' && (
                <UseStockModal
                    onClose={closeModal}
                    onSave={handleUseStock}
                    inventory={inventory}
                    materialTypes={materialTypes}
                    inventorySummary={inventorySummary}
                    incomingSummary={incomingSummary}
                    suppliers={suppliers}
                />
            )}
            {modal.type === 'edit-log' && (
                <EditOutgoingLogModal
                    isOpen={true}
                    onClose={closeModal}
                    logEntry={modal.data}
                    onSave={handleEditOutgoingLog}
                    inventory={inventory}
                    materialTypes={materialTypes}
                />
            )}
            {modal.type === 'add-category' && (
                <AddCategoryModal onClose={closeModal} onSave={handleAddCategory} />
            )}
            {modal.type === 'manage-suppliers' && (
                <ManageSuppliersModal
                    onClose={closeModal}
                    suppliers={suppliers}
                    onAddSupplier={handleAddSupplier}
                    onDeleteSupplier={handleDeleteSupplier}
                />
            )}
            {modal.type === 'confirm-delete-categories' && (
                <ConfirmationModal
                    isOpen={true}
                    onClose={closeModal}
                    onConfirm={handleConfirmDeleteCategories}
                    title="Confirm Deletion"
                    message={`Are you sure you want to delete ${modal.data.length} categor${modal.data.length > 1 ? 'ies' : 'y'} and all associated materials/inventory? This action cannot be undone.`}
                />
            )}
        </>
    );
};
