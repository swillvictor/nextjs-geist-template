const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// All inventory routes require authentication
router.use(authenticateToken);

// Get all products (all roles can view)
router.get('/products', inventoryController.getAllProducts);

// Get product by ID (all roles can view)
router.get('/products/:id', inventoryController.getProductById);

// Create product (admin, manager, inventory_clerk)
router.post('/products', 
  authorizeRoles('admin', 'manager', 'inventory_clerk'), 
  inventoryController.createProduct
);

// Update product (admin, manager, inventory_clerk)
router.put('/products/:id', 
  authorizeRoles('admin', 'manager', 'inventory_clerk'), 
  inventoryController.updateProduct
);

// Delete product (admin, manager only)
router.delete('/products/:id', 
  authorizeRoles('admin', 'manager'), 
  inventoryController.deleteProduct
);

// Stock adjustment (admin, manager, inventory_clerk)
router.post('/stock-adjustment', 
  authorizeRoles('admin', 'manager', 'inventory_clerk'), 
  inventoryController.adjustStock
);

// Get low stock products (all roles can view)
router.get('/low-stock', inventoryController.getLowStockProducts);

// Get categories (all roles can view)
router.get('/categories', inventoryController.getCategories);

module.exports = router;
