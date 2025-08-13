const Joi = require('joi');
const db = require('../config/database');

// Validation schemas
const supplierSchema = Joi.object({
  supplier_code: Joi.string().required(),
  name: Joi.string().min(2).max(200).required(),
  contact_person: Joi.string().max(100).optional(),
  email: Joi.string().email().optional(),
  phone: Joi.string().pattern(/^(\+254|0)[17]\d{8}$/).optional(),
  address: Joi.string().optional(),
  city: Joi.string().max(100).optional(),
  postal_code: Joi.string().max(20).optional(),
  kra_pin: Joi.string().max(20).optional(),
  payment_terms: Joi.string().max(100).default('Net 30'),
  credit_limit: Joi.number().min(0).default(0),
  is_active: Joi.boolean().default(true)
});

const updateSupplierSchema = supplierSchema.fork(['supplier_code'], (schema) => schema.optional());

const getAllSuppliers = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      search = '', 
      is_active = '' 
    } = req.query;

    const offset = (page - 1) * limit;
    let whereConditions = [];
    let queryParams = [];

    // Build WHERE conditions
    if (search) {
      whereConditions.push('(name LIKE ? OR supplier_code LIKE ? OR contact_person LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (is_active !== '') {
      whereConditions.push('is_active = ?');
      queryParams.push(is_active === 'true');
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    // Get suppliers
    const query = `
      SELECT 
        *,
        (SELECT COUNT(*) FROM purchases WHERE supplier_id = suppliers.id) as total_purchases,
        (SELECT COALESCE(SUM(total_amount), 0) FROM purchases WHERE supplier_id = suppliers.id AND status = 'received') as total_purchased_amount
      FROM suppliers
      ${whereClause}
      ORDER BY name ASC
      LIMIT ? OFFSET ?
    `;

    const suppliers = await db.executeQuery(query, [...queryParams, parseInt(limit), offset]);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM suppliers
      ${whereClause}
    `;
    const countResult = await db.executeQuery(countQuery, queryParams);
    const total = countResult[0].total;

    res.json({
      suppliers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get suppliers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getSupplierById = async (req, res) => {
  try {
    const { id } = req.params;

    const suppliers = await db.executeQuery(`
      SELECT 
        *,
        (SELECT COUNT(*) FROM purchases WHERE supplier_id = ?) as total_purchases,
        (SELECT COALESCE(SUM(total_amount), 0) FROM purchases WHERE supplier_id = ? AND status = 'received') as total_purchased_amount
      FROM suppliers 
      WHERE id = ?
    `, [id, id, id]);

    if (!suppliers.length) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    res.json({ supplier: suppliers[0] });

  } catch (error) {
    console.error('Get supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const createSupplier = async (req, res) => {
  try {
    const { error } = supplierSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const supplierData = req.body;

    // Check if supplier code already exists
    const existingSupplier = await db.executeQuery(
      'SELECT id FROM suppliers WHERE supplier_code = ?',
      [supplierData.supplier_code]
    );

    if (existingSupplier.length > 0) {
      return res.status(409).json({ error: 'Supplier code already exists' });
    }

    // Insert supplier
    const fields = Object.keys(supplierData);
    const placeholders = fields.map(() => '?').join(', ');
    const values = Object.values(supplierData);

    const result = await db.executeQuery(
      `INSERT INTO suppliers (${fields.join(', ')}) VALUES (${placeholders})`,
      values
    );

    // Get created supplier
    const newSupplier = await db.executeQuery(
      'SELECT * FROM suppliers WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({
      message: 'Supplier created successfully',
      supplier: newSupplier[0]
    });

  } catch (error) {
    console.error('Create supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateSupplier = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = updateSupplierSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const updates = req.body;
    const updateFields = Object.keys(updates);
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Check if supplier exists
    const existingSupplier = await db.executeQuery(
      'SELECT id FROM suppliers WHERE id = ?',
      [id]
    );

    if (!existingSupplier.length) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    // Check supplier code uniqueness if being updated
    if (updates.supplier_code) {
      const duplicateCode = await db.executeQuery(
        'SELECT id FROM suppliers WHERE supplier_code = ? AND id != ?',
        [updates.supplier_code, id]
      );

      if (duplicateCode.length > 0) {
        return res.status(409).json({ error: 'Supplier code already exists' });
      }
    }

    // Build dynamic update query
    const setClause = updateFields.map(field => `${field} = ?`).join(', ');
    const values = [...Object.values(updates), id];

    await db.executeQuery(
      `UPDATE suppliers SET ${setClause} WHERE id = ?`,
      values
    );

    // Get updated supplier
    const updatedSupplier = await db.executeQuery(
      'SELECT * FROM suppliers WHERE id = ?',
      [id]
    );

    res.json({
      message: 'Supplier updated successfully',
      supplier: updatedSupplier[0]
    });

  } catch (error) {
    console.error('Update supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteSupplier = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if supplier exists
    const existingSupplier = await db.executeQuery(
      'SELECT id FROM suppliers WHERE id = ?',
      [id]
    );

    if (!existingSupplier.length) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    // Check if supplier has purchases
    const purchaseCount = await db.executeQuery(
      'SELECT COUNT(*) as count FROM purchases WHERE supplier_id = ?',
      [id]
    );

    if (purchaseCount[0].count > 0) {
      // Soft delete - deactivate instead of deleting
      await db.executeQuery(
        'UPDATE suppliers SET is_active = FALSE WHERE id = ?',
        [id]
      );

      return res.json({
        message: 'Supplier deactivated successfully (has purchase history)'
      });
    }

    // Hard delete if no purchase history
    await db.executeQuery('DELETE FROM suppliers WHERE id = ?', [id]);

    res.json({ message: 'Supplier deleted successfully' });

  } catch (error) {
    console.error('Delete supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getSupplierPurchases = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    // Check if supplier exists
    const supplier = await db.executeQuery(
      'SELECT id, name FROM suppliers WHERE id = ?',
      [id]
    );

    if (!supplier.length) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    // Get supplier purchases
    const purchases = await db.executeQuery(`
      SELECT 
        p.*,
        u.username as created_by_username
      FROM purchases p
      JOIN users u ON p.user_id = u.id
      WHERE p.supplier_id = ?
      ORDER BY p.purchase_date DESC
      LIMIT ? OFFSET ?
    `, [id, parseInt(limit), offset]);

    // Get total count
    const countResult = await db.executeQuery(
      'SELECT COUNT(*) as total FROM purchases WHERE supplier_id = ?',
      [id]
    );
    const total = countResult[0].total;

    res.json({
      supplier: supplier[0],
      purchases,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get supplier purchases error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getAllSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getSupplierPurchases
};
