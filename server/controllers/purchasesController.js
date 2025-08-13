const Joi = require('joi');
const db = require('../config/database');
const moment = require('moment');

// Validation schemas
const purchaseItemSchema = Joi.object({
  product_id: Joi.number().integer().required(),
  quantity_ordered: Joi.number().min(0.001).required(),
  unit_cost: Joi.number().min(0).required(),
  discount_amount: Joi.number().min(0).default(0)
});

const purchaseSchema = Joi.object({
  supplier_id: Joi.number().integer().required(),
  items: Joi.array().items(purchaseItemSchema).min(1).required(),
  expected_date: Joi.date().optional(),
  discount_amount: Joi.number().min(0).default(0),
  notes: Joi.string().optional()
});

const receiveItemSchema = Joi.object({
  purchase_item_id: Joi.number().integer().required(),
  quantity_received: Joi.number().min(0).required()
});

const generatePurchaseNumber = async () => {
  const today = moment().format('YYYYMMDD');
  const prefix = `PUR-${today}-`;
  
  const lastPurchase = await db.executeQuery(
    'SELECT purchase_number FROM purchases WHERE purchase_number LIKE ? ORDER BY id DESC LIMIT 1',
    [`${prefix}%`]
  );

  let sequence = 1;
  if (lastPurchase.length > 0) {
    const lastNumber = lastPurchase[0].purchase_number;
    const lastSequence = parseInt(lastNumber.split('-').pop());
    sequence = lastSequence + 1;
  }

  return `${prefix}${sequence.toString().padStart(4, '0')}`;
};

const calculateVAT = (amount, vatRate) => {
  return (amount * vatRate) / 100;
};

const createPurchase = async (req, res) => {
  let connection;
  
  try {
    const { error } = purchaseSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { supplier_id, items, expected_date, discount_amount = 0, notes } = req.body;

    // Start transaction
    connection = await db.beginTransaction();

    // Generate purchase number
    const purchaseNumber = await generatePurchaseNumber();

    // Validate supplier exists
    const suppliers = await connection.execute(
      'SELECT id FROM suppliers WHERE id = ? AND is_active = TRUE',
      [supplier_id]
    );

    if (!suppliers[0].length) {
      await db.rollbackTransaction(connection);
      return res.status(404).json({ error: 'Supplier not found or inactive' });
    }

    // Validate products and calculate totals
    let subtotal = 0;
    let totalVAT = 0;
    const validatedItems = [];

    for (const item of items) {
      const products = await connection.execute(
        'SELECT id, name, vat_rate FROM products WHERE id = ? AND is_active = TRUE',
        [item.product_id]
      );

      if (!products[0].length) {
        await db.rollbackTransaction(connection);
        return res.status(404).json({ error: `Product with ID ${item.product_id} not found` });
      }

      const product = products[0][0];

      // Calculate line totals
      const lineSubtotal = (item.unit_cost * item.quantity_ordered) - item.discount_amount;
      const vatAmount = calculateVAT(lineSubtotal, product.vat_rate);
      const lineTotal = lineSubtotal + vatAmount;

      validatedItems.push({
        ...item,
        vat_rate: product.vat_rate,
        vat_amount: vatAmount,
        line_total: lineTotal
      });

      subtotal += lineSubtotal;
      totalVAT += vatAmount;
    }

    const totalAmount = subtotal + totalVAT - discount_amount;

    // Insert purchase record
    const purchaseResult = await connection.execute(`
      INSERT INTO purchases (
        purchase_number, supplier_id, user_id, expected_date, subtotal, 
        vat_amount, discount_amount, total_amount, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      purchaseNumber, supplier_id, req.user.id, expected_date, subtotal,
      totalVAT, discount_amount, totalAmount, notes
    ]);

    const purchaseId = purchaseResult[0].insertId;

    // Insert purchase items
    for (const item of validatedItems) {
      await connection.execute(`
        INSERT INTO purchase_items (
          purchase_id, product_id, quantity_ordered, unit_cost, vat_rate,
          vat_amount, discount_amount, line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        purchaseId, item.product_id, item.quantity_ordered, item.unit_cost,
        item.vat_rate, item.vat_amount, item.discount_amount, item.line_total
      ]);
    }

    // Commit transaction
    await db.commitTransaction(connection);

    // Get complete purchase data
    const completePurchase = await db.executeQuery(`
      SELECT 
        p.*,
        s.name as supplier_name,
        u.username as created_by_username
      FROM purchases p
      JOIN suppliers s ON p.supplier_id = s.id
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `, [purchaseId]);

    res.status(201).json({
      message: 'Purchase order created successfully',
      purchase: completePurchase[0]
    });

  } catch (error) {
    if (connection) {
      await db.rollbackTransaction(connection);
    }
    console.error('Create purchase error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getAllPurchases = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      start_date = '', 
      end_date = '', 
      supplier_id = '',
      status = '',
      payment_status = ''
    } = req.query;

    const offset = (page - 1) * limit;
    let whereConditions = [];
    let queryParams = [];

    // Build WHERE conditions
    if (start_date) {
      whereConditions.push('DATE(p.purchase_date) >= ?');
      queryParams.push(start_date);
    }

    if (end_date) {
      whereConditions.push('DATE(p.purchase_date) <= ?');
      queryParams.push(end_date);
    }

    if (supplier_id) {
      whereConditions.push('p.supplier_id = ?');
      queryParams.push(supplier_id);
    }

    if (status) {
      whereConditions.push('p.status = ?');
      queryParams.push(status);
    }

    if (payment_status) {
      whereConditions.push('p.payment_status = ?');
      queryParams.push(payment_status);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    // Get purchases with supplier and user info
    const query = `
      SELECT 
        p.*,
        s.name as supplier_name,
        u.username as created_by_username
      FROM purchases p
      JOIN suppliers s ON p.supplier_id = s.id
      JOIN users u ON p.user_id = u.id
      ${whereClause}
      ORDER BY p.purchase_date DESC
      LIMIT ? OFFSET ?
    `;

    const purchases = await db.executeQuery(query, [...queryParams, parseInt(limit), offset]);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM purchases p
      ${whereClause}
    `;
    const countResult = await db.executeQuery(countQuery, queryParams);
    const total = countResult[0].total;

    res.json({
      purchases,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get purchases error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getPurchaseById = async (req, res) => {
  try {
    const { id } = req.params;

    // Get purchase with supplier and user info
    const purchases = await db.executeQuery(`
      SELECT 
        p.*,
        s.name as supplier_name,
        s.contact_person as supplier_contact,
        s.phone as supplier_phone,
        u.username as created_by_username
      FROM purchases p
      JOIN suppliers s ON p.supplier_id = s.id
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `, [id]);

    if (!purchases.length) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    // Get purchase items
    const purchaseItems = await db.executeQuery(`
      SELECT 
        pi.*,
        p.name as product_name,
        p.sku as product_sku
      FROM purchase_items pi
      JOIN products p ON pi.product_id = p.id
      WHERE pi.purchase_id = ?
    `, [id]);

    const purchase = purchases[0];
    purchase.items = purchaseItems;

    res.json({ purchase });

  } catch (error) {
    console.error('Get purchase error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updatePurchaseStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'ordered', 'received', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Check if purchase exists
    const existingPurchase = await db.executeQuery(
      'SELECT id, status FROM purchases WHERE id = ?',
      [id]
    );

    if (!existingPurchase.length) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    // Update purchase status
    await db.executeQuery(
      'UPDATE purchases SET status = ? WHERE id = ?',
      [status, id]
    );

    res.json({ message: 'Purchase status updated successfully' });

  } catch (error) {
    console.error('Update purchase status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const receiveItems = async (req, res) => {
  let connection;
  
  try {
    const { id } = req.params;
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is required' });
    }

    // Validate items
    for (const item of items) {
      const { error } = receiveItemSchema.validate(item);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }
    }

    // Start transaction
    connection = await db.beginTransaction();

    // Check if purchase exists and is in correct status
    const purchases = await connection.execute(
      'SELECT id, status FROM purchases WHERE id = ?',
      [id]
    );

    if (!purchases[0].length) {
      await db.rollbackTransaction(connection);
      return res.status(404).json({ error: 'Purchase not found' });
    }

    const purchase = purchases[0][0];
    if (purchase.status === 'cancelled') {
      await db.rollbackTransaction(connection);
      return res.status(400).json({ error: 'Cannot receive items for cancelled purchase' });
    }

    // Process each item
    for (const item of items) {
      // Get purchase item details
      const purchaseItems = await connection.execute(`
        SELECT pi.*, p.id as product_id
        FROM purchase_items pi
        JOIN products p ON pi.product_id = p.id
        WHERE pi.id = ? AND pi.purchase_id = ?
      `, [item.purchase_item_id, id]);

      if (!purchaseItems[0].length) {
        await db.rollbackTransaction(connection);
        return res.status(404).json({ error: `Purchase item ${item.purchase_item_id} not found` });
      }

      const purchaseItem = purchaseItems[0][0];

      // Update quantity received
      await connection.execute(
        'UPDATE purchase_items SET quantity_received = quantity_received + ? WHERE id = ?',
        [item.quantity_received, item.purchase_item_id]
      );

      // Update product stock
      await connection.execute(
        'UPDATE products SET quantity_in_stock = quantity_in_stock + ? WHERE id = ?',
        [item.quantity_received, purchaseItem.product_id]
      );
    }

    // Check if all items are fully received and update purchase status
    const itemsStatus = await connection.execute(`
      SELECT 
        COUNT(*) as total_items,
        SUM(CASE WHEN quantity_received >= quantity_ordered THEN 1 ELSE 0 END) as fully_received_items
      FROM purchase_items 
      WHERE purchase_id = ?
    `, [id]);

    const { total_items, fully_received_items } = itemsStatus[0][0];
    
    if (fully_received_items === total_items) {
      await connection.execute(
        'UPDATE purchases SET status = ? WHERE id = ?',
        ['received', id]
      );
    } else if (fully_received_items > 0) {
      await connection.execute(
        'UPDATE purchases SET status = ? WHERE id = ?',
        ['ordered', id]
      );
    }

    // Commit transaction
    await db.commitTransaction(connection);

    res.json({ message: 'Items received successfully' });

  } catch (error) {
    if (connection) {
      await db.rollbackTransaction(connection);
    }
    console.error('Receive items error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getPurchasesReport = async (req, res) => {
  try {
    const { start_date, end_date, group_by = 'day' } = req.query;

    let dateFormat;
    switch (group_by) {
      case 'day':
        dateFormat = '%Y-%m-%d';
        break;
      case 'month':
        dateFormat = '%Y-%m';
        break;
      case 'year':
        dateFormat = '%Y';
        break;
      default:
        dateFormat = '%Y-%m-%d';
    }

    let whereClause = "WHERE p.status != 'cancelled'";
    let queryParams = [];

    if (start_date) {
      whereClause += ' AND DATE(p.purchase_date) >= ?';
      queryParams.push(start_date);
    }

    if (end_date) {
      whereClause += ' AND DATE(p.purchase_date) <= ?';
      queryParams.push(end_date);
    }

    const reportQuery = `
      SELECT 
        DATE_FORMAT(p.purchase_date, ?) as period,
        COUNT(*) as total_purchases,
        SUM(p.total_amount) as total_amount,
        AVG(p.total_amount) as average_purchase,
        SUM(p.vat_amount) as total_vat
      FROM purchases p
      ${whereClause}
      GROUP BY DATE_FORMAT(p.purchase_date, ?)
      ORDER BY period DESC
    `;

    const report = await db.executeQuery(reportQuery, [dateFormat, ...queryParams, dateFormat]);

    res.json({ report });

  } catch (error) {
    console.error('Get purchases report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  createPurchase,
  getAllPurchases,
  getPurchaseById,
  updatePurchaseStatus,
  receiveItems,
  getPurchasesReport
};
