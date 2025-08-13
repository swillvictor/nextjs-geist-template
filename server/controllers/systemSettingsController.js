const Joi = require('joi');
const db = require('../config/database');

// Validation schemas
const settingSchema = Joi.object({
  setting_key: Joi.string().required(),
  setting_value: Joi.string().required(),
  setting_type: Joi.string().valid('string', 'number', 'boolean', 'json').default('string'),
  description: Joi.string().optional(),
  is_editable: Joi.boolean().default(true)
});

const updateSettingSchema = Joi.object({
  setting_value: Joi.string().required()
});

const bulkUpdateSchema = Joi.object({
  settings: Joi.array().items(Joi.object({
    setting_key: Joi.string().required(),
    setting_value: Joi.string().required()
  })).min(1).required()
});

const getAllSettings = async (req, res) => {
  try {
    const { category = '', editable_only = false } = req.query;

    let whereConditions = [];
    let queryParams = [];

    if (category) {
      whereConditions.push('setting_key LIKE ?');
      queryParams.push(`${category}%`);
    }

    if (editable_only === 'true') {
      whereConditions.push('is_editable = TRUE');
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const settings = await db.executeQuery(`
      SELECT * FROM system_settings 
      ${whereClause}
      ORDER BY setting_key ASC
    `, queryParams);

    // Group settings by category (prefix before first underscore)
    const groupedSettings = {};
    settings.forEach(setting => {
      const category = setting.setting_key.split('_')[0];
      if (!groupedSettings[category]) {
        groupedSettings[category] = [];
      }
      groupedSettings[category].push(setting);
    });

    res.json({
      settings,
      grouped_settings: groupedSettings
    });

  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getSettingByKey = async (req, res) => {
  try {
    const { key } = req.params;

    const settings = await db.executeQuery(
      'SELECT * FROM system_settings WHERE setting_key = ?',
      [key]
    );

    if (!settings.length) {
      return res.status(404).json({ error: 'Setting not found' });
    }

    const setting = settings[0];

    // Parse value based on type
    let parsedValue = setting.setting_value;
    switch (setting.setting_type) {
      case 'number':
        parsedValue = parseFloat(setting.setting_value);
        break;
      case 'boolean':
        parsedValue = setting.setting_value.toLowerCase() === 'true';
        break;
      case 'json':
        try {
          parsedValue = JSON.parse(setting.setting_value);
        } catch (e) {
          parsedValue = setting.setting_value;
        }
        break;
    }

    res.json({
      ...setting,
      parsed_value: parsedValue
    });

  } catch (error) {
    console.error('Get setting error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const createSetting = async (req, res) => {
  try {
    const { error } = settingSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const settingData = req.body;

    // Check if setting key already exists
    const existingSetting = await db.executeQuery(
      'SELECT id FROM system_settings WHERE setting_key = ?',
      [settingData.setting_key]
    );

    if (existingSetting.length > 0) {
      return res.status(409).json({ error: 'Setting key already exists' });
    }

    // Insert setting
    const fields = Object.keys(settingData);
    const placeholders = fields.map(() => '?').join(', ');
    const values = Object.values(settingData);

    const result = await db.executeQuery(
      `INSERT INTO system_settings (${fields.join(', ')}) VALUES (${placeholders})`,
      values
    );

    // Get created setting
    const newSetting = await db.executeQuery(
      'SELECT * FROM system_settings WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({
      message: 'Setting created successfully',
      setting: newSetting[0]
    });

  } catch (error) {
    console.error('Create setting error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateSetting = async (req, res) => {
  try {
    const { key } = req.params;
    const { error } = updateSettingSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { setting_value } = req.body;

    // Check if setting exists and is editable
    const existingSetting = await db.executeQuery(
      'SELECT id, setting_type, is_editable FROM system_settings WHERE setting_key = ?',
      [key]
    );

    if (!existingSetting.length) {
      return res.status(404).json({ error: 'Setting not found' });
    }

    if (!existingSetting[0].is_editable) {
      return res.status(403).json({ error: 'Setting is not editable' });
    }

    // Validate value based on type
    const settingType = existingSetting[0].setting_type;
    let validatedValue = setting_value;

    switch (settingType) {
      case 'number':
        if (isNaN(parseFloat(setting_value))) {
          return res.status(400).json({ error: 'Setting value must be a number' });
        }
        validatedValue = parseFloat(setting_value).toString();
        break;
      case 'boolean':
        if (!['true', 'false'].includes(setting_value.toLowerCase())) {
          return res.status(400).json({ error: 'Setting value must be true or false' });
        }
        validatedValue = setting_value.toLowerCase();
        break;
      case 'json':
        try {
          JSON.parse(setting_value);
        } catch (e) {
          return res.status(400).json({ error: 'Setting value must be valid JSON' });
        }
        break;
    }

    // Update setting
    await db.executeQuery(
      'UPDATE system_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?',
      [validatedValue, key]
    );

    // Get updated setting
    const updatedSetting = await db.executeQuery(
      'SELECT * FROM system_settings WHERE setting_key = ?',
      [key]
    );

    res.json({
      message: 'Setting updated successfully',
      setting: updatedSetting[0]
    });

  } catch (error) {
    console.error('Update setting error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const bulkUpdateSettings = async (req, res) => {
  let connection;
  
  try {
    const { error } = bulkUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { settings } = req.body;

    // Start transaction
    connection = await db.beginTransaction();

    const updatedSettings = [];

    for (const setting of settings) {
      // Check if setting exists and is editable
      const existingSetting = await connection.execute(
        'SELECT id, setting_type, is_editable FROM system_settings WHERE setting_key = ?',
        [setting.setting_key]
      );

      if (!existingSetting[0].length) {
        await db.rollbackTransaction(connection);
        return res.status(404).json({ error: `Setting '${setting.setting_key}' not found` });
      }

      if (!existingSetting[0][0].is_editable) {
        await db.rollbackTransaction(connection);
        return res.status(403).json({ error: `Setting '${setting.setting_key}' is not editable` });
      }

      // Validate value based on type
      const settingType = existingSetting[0][0].setting_type;
      let validatedValue = setting.setting_value;

      switch (settingType) {
        case 'number':
          if (isNaN(parseFloat(setting.setting_value))) {
            await db.rollbackTransaction(connection);
            return res.status(400).json({ error: `Setting '${setting.setting_key}' value must be a number` });
          }
          validatedValue = parseFloat(setting.setting_value).toString();
          break;
        case 'boolean':
          if (!['true', 'false'].includes(setting.setting_value.toLowerCase())) {
            await db.rollbackTransaction(connection);
            return res.status(400).json({ error: `Setting '${setting.setting_key}' value must be true or false` });
          }
          validatedValue = setting.setting_value.toLowerCase();
          break;
        case 'json':
          try {
            JSON.parse(setting.setting_value);
          } catch (e) {
            await db.rollbackTransaction(connection);
            return res.status(400).json({ error: `Setting '${setting.setting_key}' value must be valid JSON` });
          }
          break;
      }

      // Update setting
      await connection.execute(
        'UPDATE system_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?',
        [validatedValue, setting.setting_key]
      );

      updatedSettings.push(setting.setting_key);
    }

    // Commit transaction
    await db.commitTransaction(connection);

    res.json({
      message: 'Settings updated successfully',
      updated_settings: updatedSettings
    });

  } catch (error) {
    if (connection) {
      await db.rollbackTransaction(connection);
    }
    console.error('Bulk update settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteSetting = async (req, res) => {
  try {
    const { key } = req.params;

    // Check if setting exists and is editable
    const existingSetting = await db.executeQuery(
      'SELECT id, is_editable FROM system_settings WHERE setting_key = ?',
      [key]
    );

    if (!existingSetting.length) {
      return res.status(404).json({ error: 'Setting not found' });
    }

    if (!existingSetting[0].is_editable) {
      return res.status(403).json({ error: 'Setting cannot be deleted' });
    }

    // Delete setting
    await db.executeQuery('DELETE FROM system_settings WHERE setting_key = ?', [key]);

    res.json({ message: 'Setting deleted successfully' });

  } catch (error) {
    console.error('Delete setting error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const resetToDefaults = async (req, res) => {
  try {
    // This would reset all settings to their default values
    // For now, we'll just return a message indicating this feature needs implementation
    res.json({ 
      message: 'Reset to defaults feature needs to be implemented with default values configuration' 
    });

  } catch (error) {
    console.error('Reset settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getCompanyInfo = async (req, res) => {
  try {
    const companySettings = await db.executeQuery(`
      SELECT setting_key, setting_value 
      FROM system_settings 
      WHERE setting_key IN ('company_name', 'company_address', 'company_phone', 'company_email', 'kra_pin')
    `);

    const companyInfo = {};
    companySettings.forEach(setting => {
      companyInfo[setting.setting_key] = setting.setting_value;
    });

    res.json({ company_info: companyInfo });

  } catch (error) {
    console.error('Get company info error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getAllSettings,
  getSettingByKey,
  createSetting,
  updateSetting,
  bulkUpdateSettings,
  deleteSetting,
  resetToDefaults,
  getCompanyInfo
};
