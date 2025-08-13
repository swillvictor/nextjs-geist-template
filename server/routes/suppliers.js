const express = require('express');
const router = express.Router();
const suppliersController = require('../controllers/suppliersController');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// All supplier routes require authentication
router.use(authenticateToken);

// Get all suppliers (all roles can view)
router.get('/', suppliersController.getAllSuppliers);

// Get supplier by ID (all roles can view)
router.get('/:id', suppliersController.getSupplierById);

// Create supplier (admin, manager, inventory_clerk)
router.post('/', 
  authorizeRoles('admin', 'manager', 'inventory_clerk'), 
  suppliersController.createSupplier
);

// Update supplier (admin, manager, inventory_clerk)
router.put('/:id', 
  authorizeRoles('admin', 'manager', 'inventory_clerk'), 
  suppliersController.updateSupplier
);

// Delete supplier (admin, manager only)
router.delete('/:id', 
  authorizeRoles('admin', 'manager'), 
  suppliersController.deleteSupplier
);

// Get supplier purchases (all roles can view)
router.get('/:id/purchases', suppliersController.getSupplierPurchases);

module.exports = router;
