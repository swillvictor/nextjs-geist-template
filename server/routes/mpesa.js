const express = require('express');
const router = express.Router();
const mpesaController = require('../controllers/mpesaController');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// STK Push initiation (requires authentication)
router.post('/stkpush', authenticateToken, mpesaController.initiateSTKPush);

// M-Pesa callback (public endpoint - no authentication required)
router.post('/callback', mpesaController.handleCallback);

// Query transaction status (requires authentication)
router.get('/query/:checkout_request_id', authenticateToken, mpesaController.queryTransactionStatus);

// Get all M-Pesa transactions (admin, manager, accountant)
router.get('/transactions', 
  authenticateToken,
  authorizeRoles('admin', 'manager', 'accountant'), 
  mpesaController.getAllTransactions
);

// Get M-Pesa transaction summary (admin, manager, accountant)
router.get('/summary', 
  authenticateToken,
  authorizeRoles('admin', 'manager', 'accountant'), 
  mpesaController.getTransactionSummary
);

module.exports = router;
