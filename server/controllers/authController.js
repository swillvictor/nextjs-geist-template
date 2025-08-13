const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const db = require('../config/database');

// Validation schemas
const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required()
});

const registerSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  first_name: Joi.string().min(2).max(50).required(),
  last_name: Joi.string().min(2).max(50).required(),
  phone: Joi.string().pattern(/^(\+254|0)[17]\d{8}$/).optional(),
  role: Joi.string().valid('admin', 'manager', 'cashier', 'inventory_clerk', 'accountant').default('cashier')
});

const generateToken = (user) => {
  return jwt.sign(
    { 
      userId: user.id, 
      username: user.username, 
      role: user.role 
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
};

const login = async (req, res) => {
  try {
    const { error } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { username, password } = req.body;

    // Get user from database
    const users = await db.executeQuery(
      'SELECT id, username, email, password, first_name, last_name, role, is_active FROM users WHERE username = ? OR email = ?',
      [username, username]
    );

    if (!users.length) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];

    if (!user.is_active) {
      return res.status(401).json({ error: 'Account is deactivated' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await db.executeQuery(
      'UPDATE users SET last_login = NOW() WHERE id = ?',
      [user.id]
    );

    // Generate token
    const token = generateToken(user);

    // Remove password from response
    delete user.password;

    res.json({
      message: 'Login successful',
      token,
      user
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const register = async (req, res) => {
  try {
    const { error } = registerSchema.validate(req.body);
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

    const newUser = {
      id: result.insertId,
      username,
      email,
      first_name,
      last_name,
      phone,
      role
    };

    // Generate token
    const token = generateToken(newUser);

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: newUser
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getProfile = async (req, res) => {
  try {
    const user = await db.executeQuery(
      'SELECT id, username, email, first_name, last_name, phone, role, last_login, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    if (!user.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: user[0] });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateProfile = async (req, res) => {
  try {
    const updateSchema = Joi.object({
      first_name: Joi.string().min(2).max(50).optional(),
      last_name: Joi.string().min(2).max(50).optional(),
      phone: Joi.string().pattern(/^(\+254|0)[17]\d{8}$/).optional(),
      email: Joi.string().email().optional()
    });

    const { error } = updateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const updates = req.body;
    const updateFields = Object.keys(updates);
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Check if email is being updated and if it already exists
    if (updates.email) {
      const existingUser = await db.executeQuery(
        'SELECT id FROM users WHERE email = ? AND id != ?',
        [updates.email, req.user.id]
      );

      if (existingUser.length > 0) {
        return res.status(409).json({ error: 'Email already exists' });
      }
    }

    // Build dynamic update query
    const setClause = updateFields.map(field => `${field} = ?`).join(', ');
    const values = [...Object.values(updates), req.user.id];

    await db.executeQuery(
      `UPDATE users SET ${setClause} WHERE id = ?`,
      values
    );

    // Get updated user
    const updatedUser = await db.executeQuery(
      'SELECT id, username, email, first_name, last_name, phone, role FROM users WHERE id = ?',
      [req.user.id]
    );

    res.json({
      message: 'Profile updated successfully',
      user: updatedUser[0]
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const changePassword = async (req, res) => {
  try {
    const passwordSchema = Joi.object({
      current_password: Joi.string().required(),
      new_password: Joi.string().min(6).required(),
      confirm_password: Joi.string().valid(Joi.ref('new_password')).required()
    });

    const { error } = passwordSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { current_password, new_password } = req.body;

    // Get current user password
    const user = await db.executeQuery(
      'SELECT password FROM users WHERE id = ?',
      [req.user.id]
    );

    if (!user.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(current_password, user[0].password);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(new_password, saltRounds);

    // Update password
    await db.executeQuery(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, req.user.id]
    );

    res.json({ message: 'Password changed successfully' });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  login,
  register,
  getProfile,
  updateProfile,
  changePassword
};
