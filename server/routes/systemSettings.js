const express = require('express');
const router = express.Router();
const systemSettingsController = require('../controllers/systemSettingsController');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// All system settings routes require authentication
router.use(authenticateToken);

// Get all settings (admin, manager can view all; others can view basic company info)
router.get('/', systemSettingsController.getAllSettings);

// Get company info (all roles can view)
router.get('/company', systemSettingsController.getCompanyInfo);

// Get setting by key (admin, manager can view all; others limited)
router.get('/:key', systemSettingsController.getSettingByKey);

// Create setting (admin only)
router.post('/', 
  authorizeRoles('admin'), 
  systemSettingsController.createSetting
);

// Update setting (admin, manager)
router.put('/:key', 
  authorizeRoles('admin', 'manager'), 
  systemSettingsController.updateSetting
);

// Bulk update settings (admin, manager)
router.patch('/bulk-update', 
  authorizeRoles('admin', 'manager'), 
  systemSettingsController.bulkUpdateSettings
);

// Delete setting (admin only)
router.delete('/:key', 
  authorizeRoles('admin'), 
  systemSettingsController.deleteSetting
);

// Reset to defaults (admin only)
router.post('/reset-defaults', 
  authorizeRoles('admin'), 
  systemSettingsController.resetToDefaults
);

module.exports = router;
