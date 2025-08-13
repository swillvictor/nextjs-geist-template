const Joi = require('joi');
const db = require('../config/database');
const moment = require('moment');

// Validation schemas
const saleItemSchema = Joi.object({
  product_id: Joi.number().integer().required(),
  quantity: Joi.number().min(0.001).required(),
  unit_price: Joi.number().min(0).required(),
  discount_amount: Joi.number().min(0).default(0)
});

const saleSchema = Joi.object({
  customer_id: Joi.number().integer().required(),
  items: Joi.array().items(saleItemSchema).min(1).required(),
  payment_method: Joi.string().valid('cash', 'mpesa', 'card', 'credit').required(),
  payment_reference: Joi.string().optional(),
  discount_amount: Joi.number().min(0).default(0),
  notes: Joi.string().optional()
});

const generateSaleNumber = async () => {
  const today = moment().format('YYYYMMDD');
  const prefix = `SAL-${today}-`;
  
  const lastSale = await db.executeQuery(
    'SELECT sale_number FROM sales WHERE sale_number LIKE ? ORDER BY id DESC LIMIT 1',
    [`${prefix}%`]
  );

  let sequence = 1;
  if (lastSale.length > 0) {
    const lastNumber = lastSale[0].sale_number;
    const lastSequence = parseInt(lastNumber.split('-').pop());
    sequence = lastSequence + 1;
  }

  return `${prefix}${sequence.toString().padStart(4, '0')}`;
};

const calculateVAT = (amount, vatRate, isInclusive = false) => {
  if (isInclusive) {
    return (amount * vatRate) / (100 + vatRate);
  } else {
    return (amount * vatRate) / 100;
  }
};

const createSale = async (req, res) => {
  let connection;
  
  try {
    const { error } = saleSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { customer_id, items, payment_method, payment_reference, discount_amount = 0, notes } = req.body;

    // Start transaction
    connection = await db.beginTransaction();

    // Generate sale number
    const saleNumber = await generateSaleNumber();

    // Validate customer exists
    const customers = await connection.execute(
      'SELECT id FROM customers WHERE id = ?',
      [customer_id]
    );

    if (!customers[0].length) {
      await db.rollbackTransaction(connection);
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Validate products and check stock
    let subtotal = 0;
    let totalVAT = 0;
    const validatedItems = [];

    for (const item of items) {
      const products = await connection.execute(
        'SELECT id, name, selling_price, vat_rate, is_vat_inclusive, quantity_in_stock, is_service FROM products WHERE id = ? AND is_active = TRUE',
        [item.product_id]
      );

      if (!products[0].length) {
        await db.rollbackTransaction(connection);
        return res.status(404).json({ error: `Product with ID ${item.product_id} not found` });
      }

      const product = products[0][0];

      // Check stock for physical products
      if (!product.is_service && product.quantity_in_stock < item.quantity) {
        await db.rollbackTransaction(connection);
        return res.status(400).json({ 
          error: `Insufficient stock for ${product.name}. Available: ${product.quantity_in_stock}, Required: ${item.quantity}` 
        });
      }

      // Calculate line totals
      const lineSubtotal = (item.unit_price * item.quantity) - item.discount_amount;
      const vatAmount = calculateVAT(lineSubtotal, product.vat_rate, product.is_vat_inclusive);
      const lineTotal = product.is_vat_inclusive ? lineSubtotal : lineSubtotal + vatAmount;

      validatedItems.push({
        ...item,
        vat_rate: product.vat_rate,
        vat_amount: vatAmount,
        line_total: lineTotal,
        is_service: product.is_service
      });

      subtotal += lineSubtotal;
      totalVAT += vatAmount;
    }

    const totalAmount = subtotal + totalVAT - discount_amount;

    // Insert sale record
    const saleResult = await connection.execute(`
      INSERT INTO sales (
        sale_number, customer_id, cashier_id, subtotal, vat_amount, 
        discount_amount, total_amount, payment_method, payment_reference, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      saleNumber, customer_id, req.user.id, subtotal, totalVAT,
      discount_amount, totalAmount, payment_method, payment_reference, notes
    ]);

    const saleId = saleResult[0].insertId;

    // Insert sale items and update stock
    for (const item of validatedItems) {
      // Insert sale item
      await connection.execute(`
        INSERT INTO sale_items (
          sale_id, product_id, quantity, unit_price, vat_rate, 
          vat_amount, discount_amount, line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        saleId, item.product_id, item.quantity, item.unit_price,
        item.vat_rate, item.vat_amount, item.discount_amount, item.line_total
      ]);

      // Update product stock for physical products
      if (!item.is_service) {
        await connection.execute(
          'UPDATE products SET quantity_in_stock = quantity_in_stock - ? WHERE id = ?',
          [item.quantity, item.product_id]
        );
      }
    }

    // Commit transaction
    await db.commitTransaction(connection);

    // Get complete sale data
    const completeSale = await db.executeQuery(`
      SELECT 
        s.*,
        c.name as customer_name,
        u.username as cashier_name
      FROM sales s
      JOIN customers c ON s.customer_id = c.id
      JOIN users u ON s.cashier_id = u.id
      WHERE s.id = ?
    `, [saleId]);

    res.status(201).json({
      message: 'Sale created successfully',
      sale: completeSale[0]
    });

  } catch (error) {
    if (connection) {
      await db.rollbackTransaction(connection);
    }
    console.error('Create sale error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getAllSales = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      start_date = '', 
      end_date = '', 
      customer_id = '',
      cashier_id = '',
      payment_method = '',
      status = ''
    } = req.query;

    const offset = (page - 1) * limit;
    let whereConditions = [];
    let queryParams = [];

    // Build WHERE conditions
    if (start_date) {
      whereConditions.push('DATE(s.sale_date) >= ?');
      queryParams.push(start_date);
    }

    if (end_date) {
      whereConditions.push('DATE(s.sale_date) <= ?');
      queryParams.push(end_date);
    }

    if (customer_id) {
      whereConditions.push('s.customer_id = ?');
      queryParams.push(customer_id);
    }

    if (cashier_id) {
      whereConditions.push('s.cashier_id = ?');
      queryParams.push(cashier_id);
    }

    if (payment_method) {
      whereConditions.push('s.payment_method = ?');
      queryParams.push(payment_method);
    }

    if (status) {
      whereConditions.push('s.status = ?');
      queryParams.push(status);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    // Get sales with customer and cashier info
    const query = `
      SELECT 
        s.*,
        c.name as customer_name,
        u.username as cashier_name
      FROM sales s
      JOIN customers c ON s.customer_id = c.id
      JOIN users u ON s.cashier_id = u.id
      ${whereClause}
      ORDER BY s.sale_date DESC
      LIMIT ? OFFSET ?
    `;

    const sales = await db.executeQuery(query, [...queryParams, parseInt(limit), offset]);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM sales s
      ${whereClause}
    `;
    const countResult = await db.executeQuery(countQuery, queryParams);
    const total = countResult[0].total;

    res.json({
      sales,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get sales error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getSaleById = async (req, res) => {
  try {
    const { id } = req.params;

    // Get sale with customer and cashier info
    const sales = await db.executeQuery(`
      SELECT 
        s.*,
        c.name as customer_name,
        c.phone as customer_phone,
        u.username as cashier_name
      FROM sales s
      JOIN customers c ON s.customer_id = c.id
      JOIN users u ON s.cashier_id = u.id
      WHERE s.id = ?
    `, [id]);

    if (!sales.length) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    // Get sale items
    const saleItems = await db.executeQuery(`
      SELECT 
        si.*,
        p.name as product_name,
        p.sku as product_sku
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      WHERE si.sale_id = ?
    `, [id]);

    const sale = sales[0];
    sale.items = saleItems;

    res.json({ sale });

  } catch (error) {
    console.error('Get sale error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateSaleStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'completed', 'cancelled', 'refunded'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Check if sale exists
    const existingSale = await db.executeQuery(
      'SELECT id, status FROM sales WHERE id = ?',
      [id]
    );

    if (!existingSale.length) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    // Update sale status
    await db.executeQuery(
      'UPDATE sales SET status = ? WHERE id = ?',
      [status, id]
    );

    res.json({ message: 'Sale status updated successfully' });

  } catch (error) {
    console.error('Update sale status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getSalesReport = async (req, res) => {
  try {
    const { start_date, end_date, group_by = 'day' } = req.query;

    let dateFormat;
    switch (group_by) {
      case 'hour':
        dateFormat = '%Y-%m-%d %H:00:00';
        break;
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

    const reportQuery = `
      SELECT 
        DATE_FORMAT(s.sale_date, ?) as period,
        COUNT(*) as total_sales,
        SUM(s.total_amount) as total_revenue,
        AVG(s.total_amount) as average_sale,
        SUM(s.vat_amount) as total_vat
      FROM sales s
      ${whereClause}
      GROUP BY DATE_FORMAT(s.sale_date, ?)
      ORDER BY period DESC
    `;

    const report = await db.executeQuery(reportQuery, [dateFormat, ...queryParams, dateFormat]);

    res.json({ report });

  } catch (error) {
    console.error('Get sales report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  createSale,
  getAllSales,
  getSaleById,
  updateSaleStatus,
  getSalesReport
};
