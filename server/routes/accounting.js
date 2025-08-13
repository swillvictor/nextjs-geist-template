const express = require('express');
const router = express.Router();
const accountingController = require('../controllers/accountingController');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// All accounting routes require authentication
router.use(authenticateToken);

// Dashboard statistics (admin, manager, accountant)
router.get('/dashboard', 
  authorizeRoles('admin', 'manager', 'accountant'), 
  accountingController.getDashboardStats
);

// Profit & Loss report (admin, manager, accountant)
router.get('/profit-loss', 
  authorizeRoles('admin', 'manager', 'accountant'), 
  accountingController.getProfitLossReport
);

// Inventory report (admin, manager, accountant, inventory_clerk)
router.get('/inventory', 
  authorizeRoles('admin', 'manager', 'accountant', 'inventory_clerk'), 
  accountingController.getInventoryReport
);

// VAT report (admin, manager, accountant)
router.get('/vat', 
  authorizeRoles('admin', 'manager', 'accountant'), 
  accountingController.getVATReport
);

// Cash flow report (admin, manager, accountant)
router.get('/cash-flow', 
  authorizeRoles('admin', 'manager', 'accountant'), 
  accountingController.getCashFlowReport
);

module.exports = router;
