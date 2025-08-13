const express = require('express');
const router = express.Router();
const salesController = require('../controllers/salesController');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// All sales routes require authentication
router.use(authenticateToken);

// Create sale (all roles can create sales)
router.post('/', salesController.createSale);

// Get all sales (all roles can view)
router.get('/', salesController.getAllSales);

// Get sale by ID (all roles can view)
router.get('/:id', salesController.getSaleById);

// Update sale status (admin, manager, cashier)
router.patch('/:id/status', 
  authorizeRoles('admin', 'manager', 'cashier'), 
  salesController.updateSaleStatus
);

// Get sales report (admin, manager, accountant)
router.get('/reports/summary', 
  authorizeRoles('admin', 'manager', 'accountant'), 
  salesController.getSalesReport
);

module.exports = router;
