const Joi = require('joi');
const db = require('../config/database');

// Validation schemas
const customerSchema = Joi.object({
  customer_code: Joi.string().required(),
  name: Joi.string().min(2).max(200).required(),
  email: Joi.string().email().optional(),
  phone: Joi.string().pattern(/^(\+254|0)[17]\d{8}$/).optional(),
  address: Joi.string().optional(),
  city: Joi.string().max(100).optional(),
  postal_code: Joi.string().max(20).optional(),
  kra_pin: Joi.string().max(20).optional(),
  id_number: Joi.string().max(20).optional(),
  customer_type: Joi.string().valid('individual', 'corporate').default('individual'),
  credit_limit: Joi.number().min(0).default(0),
  is_active: Joi.boolean().default(true)
});

const updateCustomerSchema = customerSchema.fork(['customer_code'], (schema) => schema.optional());

const getAllCustomers = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      search = '', 
      customer_type = '',
      is_active = '' 
    } = req.query;

    const offset = (page - 1) * limit;
    let whereConditions = [];
    let queryParams = [];

    // Build WHERE conditions
    if (search) {
      whereConditions.push('(name LIKE ? OR customer_code LIKE ? OR phone LIKE ? OR email LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (customer_type) {
      whereConditions.push('customer_type = ?');
      queryParams.push(customer_type);
    }

    if (is_active !== '') {
      whereConditions.push('is_active = ?');
      queryParams.push(is_active === 'true');
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    // Get customers with sales summary
    const query = `
      SELECT 
        c.*,
        (SELECT COUNT(*) FROM sales WHERE customer_id = c.id) as total_sales,
        (SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE customer_id = c.id AND status = 'completed') as total_spent,
        (SELECT MAX(sale_date) FROM sales WHERE customer_id = c.id) as last_purchase_date
      FROM customers c
      ${whereClause}
      ORDER BY c.name ASC
      LIMIT ? OFFSET ?
    `;

    const customers = await db.executeQuery(query, [...queryParams, parseInt(limit), offset]);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM customers c
      ${whereClause}
    `;
    const countResult = await db.executeQuery(countQuery, queryParams);
    const total = countResult[0].total;

    res.json({
      customers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;

    const customers = await db.executeQuery(`
      SELECT 
        c.*,
        (SELECT COUNT(*) FROM sales WHERE customer_id = ?) as total_sales,
        (SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE customer_id = ? AND status = 'completed') as total_spent,
        (SELECT MAX(sale_date) FROM sales WHERE customer_id = ?) as last_purchase_date
      FROM customers c 
      WHERE c.id = ?
    `, [id, id, id, id]);

    if (!customers.length) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json({ customer: customers[0] });

  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const createCustomer = async (req, res) => {
  try {
    const { error } = customerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const customerData = req.body;

    // Check if customer code already exists
    const existingCustomer = await db.executeQuery(
      'SELECT id FROM customers WHERE customer_code = ?',
      [customerData.customer_code]
    );

    if (existingCustomer.length > 0) {
      return res.status(409).json({ error: 'Customer code already exists' });
    }

    // Insert customer
    const fields = Object.keys(customerData);
    const placeholders = fields.map(() => '?').join(', ');
    const values = Object.values(customerData);

    const result = await db.executeQuery(
      `INSERT INTO customers (${fields.join(', ')}) VALUES (${placeholders})`,
      values
    );

    // Get created customer
    const newCustomer = await db.executeQuery(
      'SELECT * FROM customers WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({
      message: 'Customer created successfully',
      customer: newCustomer[0]
    });

  } catch (error) {
    console.error('Create customer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = updateCustomerSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const updates = req.body;
    const updateFields = Object.keys(updates);
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Check if customer exists
    const existingCustomer = await db.executeQuery(
      'SELECT id FROM customers WHERE id = ?',
      [id]
    );

    if (!existingCustomer.length) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Check customer code uniqueness if being updated
    if (updates.customer_code) {
      const duplicateCode = await db.executeQuery(
        'SELECT id FROM customers WHERE customer_code = ? AND id != ?',
        [updates.customer_code, id]
      );

      if (duplicateCode.length > 0) {
        return res.status(409).json({ error: 'Customer code already exists' });
      }
    }

    // Build dynamic update query
    const setClause = updateFields.map(field => `${field} = ?`).join(', ');
    const values = [...Object.values(updates), id];

    await db.executeQuery(
      `UPDATE customers SET ${setClause} WHERE id = ?`,
      values
    );

    // Get updated customer
    const updatedCustomer = await db.executeQuery(
      'SELECT * FROM customers WHERE id = ?',
      [id]
    );

    res.json({
      message: 'Customer updated successfully',
      customer: updatedCustomer[0]
    });

  } catch (error) {
    console.error('Update customer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if customer exists
    const existingCustomer = await db.executeQuery(
      'SELECT id, customer_code FROM customers WHERE id = ?',
      [id]
    );

    if (!existingCustomer.length) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Prevent deletion of walk-in customer
    if (existingCustomer[0].customer_code === 'WALK-IN') {
      return res.status(400).json({ error: 'Cannot delete walk-in customer' });
    }

    // Check if customer has sales
    const salesCount = await db.executeQuery(
      'SELECT COUNT(*) as count FROM sales WHERE customer_id = ?',
      [id]
    );

    if (salesCount[0].count > 0) {
      // Soft delete - deactivate instead of deleting
      await db.executeQuery(
        'UPDATE customers SET is_active = FALSE WHERE id = ?',
        [id]
      );

      return res.json({
        message: 'Customer deactivated successfully (has sales history)'
      });
    }

    // Hard delete if no sales history
    await db.executeQuery('DELETE FROM customers WHERE id = ?', [id]);

    res.json({ message: 'Customer deleted successfully' });

  } catch (error) {
    console.error('Delete customer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getCustomerSales = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    // Check if customer exists
    const customer = await db.executeQuery(
      'SELECT id, name FROM customers WHERE id = ?',
      [id]
    );

    if (!customer.length) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Get customer sales
    const sales = await db.executeQuery(`
      SELECT 
        s.*,
        u.username as cashier_name
      FROM sales s
      JOIN users u ON s.cashier_id = u.id
      WHERE s.customer_id = ?
      ORDER BY s.sale_date DESC
      LIMIT ? OFFSET ?
    `, [id, parseInt(limit), offset]);

    // Get total count
    const countResult = await db.executeQuery(
      'SELECT COUNT(*) as total FROM sales WHERE customer_id = ?',
      [id]
    );
    const total = countResult[0].total;

    res.json({
      customer: customer[0],
      sales,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get customer sales error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateLoyaltyPoints = async (req, res) => {
  try {
    const { id } = req.params;
    const { points, operation } = req.body;

    if (!['add', 'subtract', 'set'].includes(operation)) {
      return res.status(400).json({ error: 'Invalid operation. Use add, subtract, or set' });
    }

    if (typeof points !== 'number' || points < 0) {
      return res.status(400).json({ error: 'Points must be a positive number' });
    }

    // Check if customer exists
    const customer = await db.executeQuery(
      'SELECT id, loyalty_points FROM customers WHERE id = ?',
      [id]
    );

    if (!customer.length) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    let newPoints;
    const currentPoints = customer[0].loyalty_points;

    switch (operation) {
      case 'add':
        newPoints = currentPoints + points;
        break;
      case 'subtract':
        newPoints = Math.max(0, currentPoints - points);
        break;
      case 'set':
        newPoints = points;
        break;
    }

    // Update loyalty points
    await db.executeQuery(
      'UPDATE customers SET loyalty_points = ? WHERE id = ?',
      [newPoints, id]
    );

    res.json({
      message: 'Loyalty points updated successfully',
      previous_points: currentPoints,
      new_points: newPoints
    });

  } catch (error) {
    console.error('Update loyalty points error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getCustomerAnalytics = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let whereClause = "WHERE s.status = 'completed'";
    let queryParams = [];

    if (start_date) {
      whereClause += ' AND DATE(s.sale_date) >= ?';
      queryParams.push(start_date);
    }

    if (end_date) {
      whereClause += ' AND DATE(s.sale_date) <= ?';
      queryParams.push(end_date);
    }

    // Get top customers by sales
    const topCustomers = await db.executeQuery(`
      SELECT 
        c.id,
        c.name,
        c.customer_code,
        COUNT(s.id) as total_sales,
        SUM(s.total_amount) as total_spent,
        AVG(s.total_amount) as average_sale
      FROM customers c
      JOIN sales s ON c.id = s.customer_id
      ${whereClause}
      GROUP BY c.id, c.name, c.customer_code
      ORDER BY total_spent DESC
      LIMIT 10
    `, queryParams);

    // Get customer type distribution
    const customerTypes = await db.executeQuery(`
      SELECT 
        customer_type,
        COUNT(*) as count,
        COALESCE(SUM(total_spent), 0) as total_revenue
      FROM (
        SELECT 
          c.customer_type,
          (SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE customer_id = c.id AND status = 'completed') as total_spent
        FROM customers c
        WHERE c.is_active = TRUE
      ) customer_summary
      GROUP BY customer_type
    `);

    res.json({
      top_customers: topCustomers,
      customer_types: customerTypes
    });

  } catch (error) {
    console.error('Get customer analytics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getAllCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerSales,
  updateLoyaltyPoints,
  getCustomerAnalytics
};
