const express = require('express');
const router = express.Router();
const purchasesController = require('../controllers/purchasesController');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// All purchase routes require authentication
router.use(authenticateToken);

// Create purchase (admin, manager, inventory_clerk)
router.post('/', 
  authorizeRoles('admin', 'manager', 'inventory_clerk'), 
  purchasesController.createPurchase
);

// Get all purchases (all roles can view)
router.get('/', purchasesController.getAllPurchases);

// Get purchase by ID (all roles can view)
router.get('/:id', purchasesController.getPurchaseById);

// Update purchase status (admin, manager, inventory_clerk)
router.patch('/:id/status', 
  authorizeRoles('admin', 'manager', 'inventory_clerk'), 
  purchasesController.updatePurchaseStatus
);

// Receive items (admin, manager, inventory_clerk)
router.post('/:id/receive', 
  authorizeRoles('admin', 'manager', 'inventory_clerk'), 
  purchasesController.receiveItems
);

// Get purchases report (admin, manager, accountant)
router.get('/reports/summary', 
  authorizeRoles('admin', 'manager', 'accountant'), 
  purchasesController.getPurchasesReport
);

module.exports = router;
