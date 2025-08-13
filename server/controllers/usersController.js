const bcrypt = require('bcryptjs');
const Joi = require('joi');
const db = require('../config/database');

// Validation schemas
const createUserSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  first_name: Joi.string().min(2).max(50).required(),
  last_name: Joi.string().min(2).max(50).required(),
  phone: Joi.string().pattern(/^(\+254|0)[17]\d{8}$/).optional(),
  role: Joi.string().valid('admin', 'manager', 'cashier', 'inventory_clerk', 'accountant').required()
});

const updateUserSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).optional(),
  email: Joi.string().email().optional(),
  first_name: Joi.string().min(2).max(50).optional(),
  last_name: Joi.string().min(2).max(50).optional(),
  phone: Joi.string().pattern(/^(\+254|0)[17]\d{8}$/).optional(),
  role: Joi.string().valid('admin', 'manager', 'cashier', 'inventory_clerk', 'accountant').optional(),
  is_active: Joi.boolean().optional()
});

const resetPasswordSchema = Joi.object({
  new_password: Joi.string().min(6).required(),
  confirm_password: Joi.string().valid(Joi.ref('new_password')).required()
});

const getAllUsers = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      search = '', 
      role = '',
      is_active = '' 
    } = req.query;

    const offset = (page - 1) * limit;
    let whereConditions = [];
    let queryParams = [];

    // Build WHERE conditions
    if (search) {
      whereConditions.push('(username LIKE ? OR email LIKE ? OR first_name LIKE ? OR last_name LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (role) {
      whereConditions.push('role = ?');
      queryParams.push(role);
    }

    if (is_active !== '') {
      whereConditions.push('is_active = ?');
      queryParams.push(is_active === 'true');
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    // Get users (exclude password)
    const query = `
      SELECT 
        id, username, email, first_name, last_name, phone, role, 
        is_active, last_login, created_at, updated_at
      FROM users
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    const users = await db.executeQuery(query, [...queryParams, parseInt(limit), offset]);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM users
      ${whereClause}
    `;
    const countResult = await db.executeQuery(countQuery, queryParams);
    const total = countResult[0].total;

    res.json({
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const users = await db.executeQuery(`
      SELECT 
        id, username, email, first_name, last_name, phone, role, 
        is_active, last_login, created_at, updated_at
      FROM users 
      WHERE id = ?
    `, [id]);

    if (!users.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: users[0] });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const createUser = async (req, res) => {
  try {
    const { error } = createUserSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { username, email, password, first_name, last_name, phone, role } = req.body;

    // Check if user already exists
    const existingUsers = await db.executeQuery(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({ error: 'Username or email already exists' });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert new user
    const result = await db.executeQuery(
      'INSERT INTO users (username, email, password, first_name, last_name, phone, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [username, email, hashedPassword, first_name, last_name, phone, role]
    );

    // Get created user (without password)
    const newUser = await db.executeQuery(
      'SELECT id, username, email, first_name, last_name, phone, role, is_active, created_at FROM users WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({
      message: 'User created successfully',
      user: newUser[0]
    });

  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = updateUserSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const updates = req.body;
    const updateFields = Object.keys(updates);
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Check if user exists
    const existingUser = await db.executeQuery(
      'SELECT id FROM users WHERE id = ?',
      [id]
    );

    if (!existingUser.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check username uniqueness if being updated
    if (updates.username) {
      const duplicateUsername = await db.executeQuery(
        'SELECT id FROM users WHERE username = ? AND id != ?',
        [updates.username, id]
      );

      if (duplicateUsername.length > 0) {
        return res.status(409).json({ error: 'Username already exists' });
      }
    }

    // Check email uniqueness if being updated
    if (updates.email) {
      const duplicateEmail = await db.executeQuery(
        'SELECT id FROM users WHERE email = ? AND id != ?',
        [updates.email, id]
      );

      if (duplicateEmail.length > 0) {
        return res.status(409).json({ error: 'Email already exists' });
      }
    }

    // Build dynamic update query
    const setClause = updateFields.map(field => `${field} = ?`).join(', ');
    const values = [...Object.values(updates), id];

    await db.executeQuery(
      `UPDATE users SET ${setClause} WHERE id = ?`,
      values
    );

    // Get updated user (without password)
    const updatedUser = await db.executeQuery(
      'SELECT id, username, email, first_name, last_name, phone, role, is_active, last_login, created_at, updated_at FROM users WHERE id = ?',
      [id]
    );

    res.json({
      message: 'User updated successfully',
      user: updatedUser[0]
    });

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const existingUser = await db.executeQuery(
      'SELECT id, username FROM users WHERE id = ?',
      [id]
    );

    if (!existingUser.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent deletion of admin user if it's the only admin
    const user = existingUser[0];
    if (user.username === 'admin') {
      const adminCount = await db.executeQuery(
        'SELECT COUNT(*) as count FROM users WHERE role = ? AND is_active = TRUE',
        ['admin']
      );

      if (adminCount[0].count <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last active admin user' });
      }
    }

    // Check if user has associated records
    const associatedRecords = await db.executeQuery(`
      SELECT 
        (SELECT COUNT(*) FROM sales WHERE cashier_id = ?) as sales_count,
        (SELECT COUNT(*) FROM purchases WHERE user_id = ?) as purchases_count,
        (SELECT COUNT(*) FROM products WHERE created_by = ?) as products_count
    `, [id, id, id]);

    const { sales_count, purchases_count, products_count } = associatedRecords[0];

    if (sales_count > 0 || purchases_count > 0 || products_count > 0) {
      // Soft delete - deactivate instead of deleting
      await db.executeQuery(
        'UPDATE users SET is_active = FALSE WHERE id = ?',
        [id]
      );

      return res.json({
        message: 'User deactivated successfully (has associated records)'
      });
    }

    // Hard delete if no associated records
    await db.executeQuery('DELETE FROM users WHERE id = ?', [id]);

    res.json({ message: 'User deleted successfully' });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const resetUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = resetPasswordSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { new_password } = req.body;

    // Check if user exists
    const existingUser = await db.executeQuery(
      'SELECT id FROM users WHERE id = ?',
      [id]
    );

    if (!existingUser.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Hash new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(new_password, saltRounds);

    // Update password
    await db.executeQuery(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, id]
    );

    res.json({ message: 'Password reset successfully' });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const existingUser = await db.executeQuery(
      'SELECT id, username, role, is_active FROM users WHERE id = ?',
      [id]
    );

    if (!existingUser.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = existingUser[0];

    // Prevent deactivating the last admin
    if (user.role === 'admin' && user.is_active) {
      const activeAdminCount = await db.executeQuery(
        'SELECT COUNT(*) as count FROM users WHERE role = ? AND is_active = TRUE',
        ['admin']
      );

      if (activeAdminCount[0].count <= 1) {
        return res.status(400).json({ error: 'Cannot deactivate the last active admin user' });
      }
    }

    // Toggle status
    const newStatus = !user.is_active;
    await db.executeQuery(
      'UPDATE users SET is_active = ? WHERE id = ?',
      [newStatus, id]
    );

    res.json({ 
      message: `User ${newStatus ? 'activated' : 'deactivated'} successfully`,
      is_active: newStatus
    });

  } catch (error) {
    console.error('Toggle user status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getUserStats = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const user = await db.executeQuery(
      'SELECT id, username, role FROM users WHERE id = ?',
      [id]
    );

    if (!user.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get user statistics based on role
    let stats = {};

    if (['admin', 'manager', 'cashier'].includes(user[0].role)) {
      // Sales statistics
      const salesStats = await db.executeQuery(`
        SELECT 
          COUNT(*) as total_sales,
          COALESCE(SUM(total_amount), 0) as total_sales_amount,
          COALESCE(AVG(total_amount), 0) as average_sale_amount
        FROM sales 
        WHERE cashier_id = ? AND status = 'completed'
      `, [id]);

      stats.sales = salesStats[0];
    }

    if (['admin', 'manager', 'inventory_clerk'].includes(user[0].role)) {
      // Purchase statistics
      const purchaseStats = await db.executeQuery(`
        SELECT 
          COUNT(*) as total_purchases,
          COALESCE(SUM(total_amount), 0) as total_purchase_amount
        FROM purchases 
        WHERE user_id = ?
      `, [id]);

      // Product creation statistics
      const productStats = await db.executeQuery(`
        SELECT COUNT(*) as products_created
        FROM products 
        WHERE created_by = ?
      `, [id]);

      stats.purchases = purchaseStats[0];
      stats.products = productStats[0];
    }

    res.json({
      user: user[0],
      stats
    });

  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  resetUserPassword,
  toggleUserStatus,
  getUserStats
};
