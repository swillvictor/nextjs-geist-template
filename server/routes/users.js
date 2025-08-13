const express = require('express');
const router = express.Router();
const usersController = require('../controllers/usersController');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// All user management routes require authentication
router.use(authenticateToken);

// Get all users (admin, manager can view all)
router.get('/', 
  authorizeRoles('admin', 'manager'), 
  usersController.getAllUsers
);

// Get user by ID (admin, manager can view all; users can view their own)
router.get('/:id', 
  authorizeRoles('admin', 'manager'), 
  usersController.getUserById
);

// Create user (admin only)
router.post('/', 
  authorizeRoles('admin'), 
  usersController.createUser
);

// Update user (admin can update all; manager can update non-admin users)
router.put('/:id', 
  authorizeRoles('admin', 'manager'), 
  usersController.updateUser
);

// Delete user (admin only)
router.delete('/:id', 
  authorizeRoles('admin'), 
  usersController.deleteUser
);

// Reset user password (admin, manager)
router.post('/:id/reset-password', 
  authorizeRoles('admin', 'manager'), 
  usersController.resetUserPassword
);

// Toggle user status (admin only)
router.patch('/:id/toggle-status', 
  authorizeRoles('admin'), 
  usersController.toggleUserStatus
);

// Get user statistics (admin, manager can view all; users can view their own)
router.get('/:id/stats', 
  authorizeRoles('admin', 'manager'), 
  usersController.getUserStats
);

module.exports = router;
