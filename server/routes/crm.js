const express = require('express');
const router = express.Router();
const crmController = require('../controllers/crmController');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// All CRM routes require authentication
router.use(authenticateToken);

// Get all customers (all roles can view)
router.get('/customers', crmController.getAllCustomers);

// Get customer by ID (all roles can view)
router.get('/customers/:id', crmController.getCustomerById);

// Create customer (all roles can create customers)
router.post('/customers', crmController.createCustomer);

// Update customer (admin, manager, cashier)
router.put('/customers/:id', 
  authorizeRoles('admin', 'manager', 'cashier'), 
  crmController.updateCustomer
);

// Delete customer (admin, manager only)
router.delete('/customers/:id', 
  authorizeRoles('admin', 'manager'), 
  crmController.deleteCustomer
);

// Get customer sales (all roles can view)
router.get('/customers/:id/sales', crmController.getCustomerSales);

// Update loyalty points (admin, manager, cashier)
router.patch('/customers/:id/loyalty-points', 
  authorizeRoles('admin', 'manager', 'cashier'), 
  crmController.updateLoyaltyPoints
);

// Get customer analytics (admin, manager, accountant)
router.get('/analytics', 
  authorizeRoles('admin', 'manager', 'accountant'), 
  crmController.getCustomerAnalytics
);

module.exports = router;
