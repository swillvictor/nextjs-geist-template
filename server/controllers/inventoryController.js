const Joi = require('joi');
const db = require('../config/database');

// Validation schemas
const productSchema = Joi.object({
  sku: Joi.string().required(),
  barcode: Joi.string().optional(),
  name: Joi.string().min(2).max(200).required(),
  description: Joi.string().optional(),
  category: Joi.string().max(100).optional(),
  brand: Joi.string().max(100).optional(),
  unit: Joi.string().max(20).default('pcs'),
  cost_price: Joi.number().min(0).required(),
  selling_price: Joi.number().min(0).required(),
  vat_rate: Joi.number().min(0).max(100).default(16.00),
  is_vat_inclusive: Joi.boolean().default(false),
  quantity_in_stock: Joi.number().integer().min(0).default(0),
  reorder_level: Joi.number().integer().min(0).default(0),
  max_stock_level: Joi.number().integer().min(0).default(1000),
  is_active: Joi.boolean().default(true),
  is_service: Joi.boolean().default(false),
  image_url: Joi.string().uri().optional()
});

const updateProductSchema = productSchema.fork(['sku'], (schema) => schema.optional());

const stockAdjustmentSchema = Joi.object({
  product_id: Joi.number().integer().required(),
  adjustment_type: Joi.string().valid('increase', 'decrease', 'set').required(),
  quantity: Joi.number().min(0).required(),
  reason: Joi.string().required(),
  notes: Joi.string().optional()
});

const getAllProducts = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      search = '', 
      category = '', 
      is_active = '', 
      low_stock = false 
    } = req.query;

    const offset = (page - 1) * limit;
    let whereConditions = [];
    let queryParams = [];

    // Build WHERE conditions
    if (search) {
      whereConditions.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (category) {
      whereConditions.push('p.category = ?');
      queryParams.push(category);
    }

    if (is_active !== '') {
      whereConditions.push('p.is_active = ?');
      queryParams.push(is_active === 'true');
    }

    if (low_stock === 'true') {
      whereConditions.push('p.quantity_in_stock <= p.reorder_level');
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    // Get products with creator info
    const query = `
      SELECT 
        p.*,
        u.username as created_by_username,
        CASE 
          WHEN p.quantity_in_stock <= p.reorder_level THEN 'low'
          WHEN p.quantity_in_stock >= p.max_stock_level THEN 'high'
          ELSE 'normal'
        END as stock_status
      FROM products p
      LEFT JOIN users u ON p.created_by = u.id
      ${whereClause}
      ORDER BY p.name ASC
      LIMIT ? OFFSET ?
    `;

    const products = await db.executeQuery(query, [...queryParams, parseInt(limit), offset]);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM products p
      ${whereClause}
    `;
    const countResult = await db.executeQuery(countQuery, queryParams);
    const total = countResult[0].total;

    res.json({
      products,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    const products = await db.executeQuery(`
      SELECT 
        p.*,
        u.username as created_by_username
      FROM products p
      LEFT JOIN users u ON p.created_by = u.id
      WHERE p.id = ?
    `, [id]);

    if (!products.length) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ product: products[0] });

  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const createProduct = async (req, res) => {
  try {
    const { error } = productSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const productData = req.body;
    productData.created_by = req.user.id;

    // Check if SKU already exists
    const existingProduct = await db.executeQuery(
      'SELECT id FROM products WHERE sku = ?',
      [productData.sku]
    );

    if (existingProduct.length > 0) {
      return res.status(409).json({ error: 'SKU already exists' });
    }

    // Check if barcode already exists (if provided)
    if (productData.barcode) {
      const existingBarcode = await db.executeQuery(
        'SELECT id FROM products WHERE barcode = ?',
        [productData.barcode]
      );

      if (existingBarcode.length > 0) {
        return res.status(409).json({ error: 'Barcode already exists' });
      }
    }

    // Insert product
    const fields = Object.keys(productData);
    const placeholders = fields.map(() => '?').join(', ');
    const values = Object.values(productData);

    const result = await db.executeQuery(
      `INSERT INTO products (${fields.join(', ')}) VALUES (${placeholders})`,
      values
    );

    // Get created product
    const newProduct = await db.executeQuery(
      'SELECT * FROM products WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({
      message: 'Product created successfully',
      product: newProduct[0]
    });

  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = updateProductSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const updates = req.body;
    const updateFields = Object.keys(updates);
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Check if product exists
    const existingProduct = await db.executeQuery(
      'SELECT id FROM products WHERE id = ?',
      [id]
    );

    if (!existingProduct.length) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Check SKU uniqueness if being updated
    if (updates.sku) {
      const duplicateSku = await db.executeQuery(
        'SELECT id FROM products WHERE sku = ? AND id != ?',
        [updates.sku, id]
      );

      if (duplicateSku.length > 0) {
        return res.status(409).json({ error: 'SKU already exists' });
      }
    }

    // Check barcode uniqueness if being updated
    if (updates.barcode) {
      const duplicateBarcode = await db.executeQuery(
        'SELECT id FROM products WHERE barcode = ? AND id != ?',
        [updates.barcode, id]
      );

      if (duplicateBarcode.length > 0) {
        return res.status(409).json({ error: 'Barcode already exists' });
      }
    }

    // Build dynamic update query
    const setClause = updateFields.map(field => `${field} = ?`).join(', ');
    const values = [...Object.values(updates), id];

    await db.executeQuery(
      `UPDATE products SET ${setClause} WHERE id = ?`,
      values
    );

    // Get updated product
    const updatedProduct = await db.executeQuery(
      'SELECT * FROM products WHERE id = ?',
      [id]
    );

    res.json({
      message: 'Product updated successfully',
      product: updatedProduct[0]
    });

  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if product exists
    const existingProduct = await db.executeQuery(
      'SELECT id FROM products WHERE id = ?',
      [id]
    );

    if (!existingProduct.length) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Check if product is used in any sales or purchases
    const usageCheck = await db.executeQuery(`
      SELECT 
        (SELECT COUNT(*) FROM sale_items WHERE product_id = ?) as sales_count,
        (SELECT COUNT(*) FROM purchase_items WHERE product_id = ?) as purchase_count
    `, [id, id]);

    const { sales_count, purchase_count } = usageCheck[0];

    if (sales_count > 0 || purchase_count > 0) {
      // Soft delete - deactivate instead of deleting
      await db.executeQuery(
        'UPDATE products SET is_active = FALSE WHERE id = ?',
        [id]
      );

      return res.json({
        message: 'Product deactivated successfully (has transaction history)'
      });
    }

    // Hard delete if no transaction history
    await db.executeQuery('DELETE FROM products WHERE id = ?', [id]);

    res.json({ message: 'Product deleted successfully' });

  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const adjustStock = async (req, res) => {
  try {
    const { error } = stockAdjustmentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { product_id, adjustment_type, quantity, reason, notes } = req.body;

    // Get current product
    const products = await db.executeQuery(
      'SELECT id, name, quantity_in_stock FROM products WHERE id = ?',
      [product_id]
    );

    if (!products.length) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = products[0];
    let newQuantity;

    switch (adjustment_type) {
      case 'increase':
        newQuantity = product.quantity_in_stock + quantity;
        break;
      case 'decrease':
        newQuantity = Math.max(0, product.quantity_in_stock - quantity);
        break;
      case 'set':
        newQuantity = quantity;
        break;
      default:
        return res.status(400).json({ error: 'Invalid adjustment type' });
    }

    // Update product stock
    await db.executeQuery(
      'UPDATE products SET quantity_in_stock = ? WHERE id = ?',
      [newQuantity, product_id]
    );

    res.json({
      message: 'Stock adjusted successfully',
      product: {
        id: product_id,
        name: product.name,
        previous_quantity: product.quantity_in_stock,
        new_quantity: newQuantity,
        adjustment: quantity,
        adjustment_type
      }
    });

  } catch (error) {
    console.error('Stock adjustment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getLowStockProducts = async (req, res) => {
  try {
    const products = await db.executeQuery(`
      SELECT 
        id, sku, name, quantity_in_stock, reorder_level,
        (reorder_level - quantity_in_stock) as shortage
      FROM products 
      WHERE quantity_in_stock <= reorder_level 
        AND is_active = TRUE
      ORDER BY shortage DESC
    `);

    res.json({ products });

  } catch (error) {
    console.error('Get low stock products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getCategories = async (req, res) => {
  try {
    const categories = await db.executeQuery(`
      SELECT 
        category,
        COUNT(*) as product_count,
        SUM(quantity_in_stock * selling_price) as total_value
      FROM products 
      WHERE category IS NOT NULL 
        AND category != ''
        AND is_active = TRUE
      GROUP BY category
      ORDER BY category ASC
    `);

    res.json({ categories });

  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  adjustStock,
  getLowStockProducts,
  getCategories
};
