const db = require('../config/database');
const moment = require('moment');

const getDashboardStats = async (req, res) => {
  try {
    const { period = 'today' } = req.query;
    
    let dateFilter = '';
    let dateParams = [];
    
    switch (period) {
      case 'today':
        dateFilter = 'DATE(created_at) = CURDATE()';
        break;
      case 'week':
        dateFilter = 'created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
        break;
      case 'month':
        dateFilter = 'created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
        break;
      case 'year':
        dateFilter = 'created_at >= DATE_SUB(NOW(), INTERVAL 365 DAY)';
        break;
      default:
        dateFilter = 'DATE(created_at) = CURDATE()';
    }

    // Sales statistics
    const salesStats = await db.executeQuery(`
      SELECT 
        COUNT(*) as total_sales,
        COALESCE(SUM(total_amount), 0) as total_revenue,
        COALESCE(AVG(total_amount), 0) as average_sale,
        COALESCE(SUM(vat_amount), 0) as total_vat
      FROM sales 
      WHERE status = 'completed' AND ${dateFilter}
    `, dateParams);

    // Purchase statistics
    const purchaseStats = await db.executeQuery(`
      SELECT 
        COUNT(*) as total_purchases,
        COALESCE(SUM(total_amount), 0) as total_spent,
        COALESCE(AVG(total_amount), 0) as average_purchase
      FROM purchases 
      WHERE status != 'cancelled' AND ${dateFilter}
    `, dateParams);

    // Inventory statistics
    const inventoryStats = await db.executeQuery(`
      SELECT 
        COUNT(*) as total_products,
        SUM(quantity_in_stock) as total_stock_quantity,
        SUM(quantity_in_stock * cost_price) as total_stock_value,
        COUNT(CASE WHEN quantity_in_stock <= reorder_level THEN 1 END) as low_stock_products
      FROM products 
      WHERE is_active = TRUE
    `);

    // Customer statistics
    const customerStats = await db.executeQuery(`
      SELECT 
        COUNT(*) as total_customers,
        COUNT(CASE WHEN is_active = TRUE THEN 1 END) as active_customers
      FROM customers
    `);

    // Recent sales trend (last 7 days)
    const salesTrend = await db.executeQuery(`
      SELECT 
        DATE(sale_date) as date,
        COUNT(*) as sales_count,
        COALESCE(SUM(total_amount), 0) as revenue
      FROM sales 
      WHERE status = 'completed' 
        AND sale_date >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(sale_date)
      ORDER BY date ASC
    `);

    // Top selling products
    const topProducts = await db.executeQuery(`
      SELECT 
        p.name,
        p.sku,
        SUM(si.quantity) as total_sold,
        SUM(si.line_total) as total_revenue
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id
      WHERE s.status = 'completed' AND ${dateFilter.replace('created_at', 's.sale_date')}
      GROUP BY p.id, p.name, p.sku
      ORDER BY total_sold DESC
      LIMIT 5
    `, dateParams);

    res.json({
      sales: salesStats[0],
      purchases: purchaseStats[0],
      inventory: inventoryStats[0],
      customers: customerStats[0],
      sales_trend: salesTrend,
      top_products: topProducts
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getProfitLossReport = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }

    // Revenue from sales
    const revenue = await db.executeQuery(`
      SELECT 
        COALESCE(SUM(total_amount), 0) as total_revenue,
        COALESCE(SUM(vat_amount), 0) as total_vat,
        COALESCE(SUM(total_amount - vat_amount), 0) as net_revenue
      FROM sales 
      WHERE status = 'completed' 
        AND DATE(sale_date) BETWEEN ? AND ?
    `, [start_date, end_date]);

    // Cost of goods sold
    const cogs = await db.executeQuery(`
      SELECT 
        COALESCE(SUM(si.quantity * p.cost_price), 0) as total_cogs
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id
      WHERE s.status = 'completed' 
        AND DATE(s.sale_date) BETWEEN ? AND ?
    `, [start_date, end_date]);

    // Operating expenses (purchases for the period)
    const expenses = await db.executeQuery(`
      SELECT 
        COALESCE(SUM(total_amount), 0) as total_expenses
      FROM purchases 
      WHERE status = 'received' 
        AND DATE(purchase_date) BETWEEN ? AND ?
    `, [start_date, end_date]);

    const totalRevenue = revenue[0].total_revenue;
    const totalCOGS = cogs[0].total_cogs;
    const totalExpenses = expenses[0].total_expenses;
    const grossProfit = totalRevenue - totalCOGS;
    const netProfit = grossProfit - totalExpenses;

    res.json({
      period: { start_date, end_date },
      revenue: {
        total_revenue: totalRevenue,
        total_vat: revenue[0].total_vat,
        net_revenue: revenue[0].net_revenue
      },
      costs: {
        cost_of_goods_sold: totalCOGS,
        operating_expenses: totalExpenses,
        total_costs: totalCOGS + totalExpenses
      },
      profit: {
        gross_profit: grossProfit,
        net_profit: netProfit,
        gross_margin: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0,
        net_margin: totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0
      }
    });

  } catch (error) {
    console.error('Get profit loss report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getInventoryReport = async (req, res) => {
  try {
    const { category = '', low_stock_only = false } = req.query;

    let whereConditions = ['is_active = TRUE'];
    let queryParams = [];

    if (category) {
      whereConditions.push('category = ?');
      queryParams.push(category);
    }

    if (low_stock_only === 'true') {
      whereConditions.push('quantity_in_stock <= reorder_level');
    }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    const inventoryReport = await db.executeQuery(`
      SELECT 
        id,
        sku,
        name,
        category,
        quantity_in_stock,
        reorder_level,
        cost_price,
        selling_price,
        (quantity_in_stock * cost_price) as stock_value,
        (quantity_in_stock * selling_price) as potential_revenue,
        CASE 
          WHEN quantity_in_stock <= 0 THEN 'Out of Stock'
          WHEN quantity_in_stock <= reorder_level THEN 'Low Stock'
          WHEN quantity_in_stock >= max_stock_level THEN 'Overstock'
          ELSE 'Normal'
        END as stock_status
      FROM products
      ${whereClause}
      ORDER BY stock_value DESC
    `, queryParams);

    // Summary statistics
    const summary = await db.executeQuery(`
      SELECT 
        COUNT(*) as total_products,
        SUM(quantity_in_stock) as total_quantity,
        SUM(quantity_in_stock * cost_price) as total_stock_value,
        SUM(quantity_in_stock * selling_price) as total_potential_revenue,
        COUNT(CASE WHEN quantity_in_stock <= 0 THEN 1 END) as out_of_stock,
        COUNT(CASE WHEN quantity_in_stock <= reorder_level AND quantity_in_stock > 0 THEN 1 END) as low_stock,
        COUNT(CASE WHEN quantity_in_stock >= max_stock_level THEN 1 END) as overstock
      FROM products
      ${whereClause}
    `, queryParams);

    res.json({
      inventory: inventoryReport,
      summary: summary[0]
    });

  } catch (error) {
    console.error('Get inventory report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getVATReport = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }

    // VAT collected from sales
    const vatCollected = await db.executeQuery(`
      SELECT 
        COALESCE(SUM(vat_amount), 0) as total_vat_collected,
        COUNT(*) as total_sales
      FROM sales 
      WHERE status = 'completed' 
        AND DATE(sale_date) BETWEEN ? AND ?
    `, [start_date, end_date]);

    // VAT paid on purchases
    const vatPaid = await db.executeQuery(`
      SELECT 
        COALESCE(SUM(vat_amount), 0) as total_vat_paid,
        COUNT(*) as total_purchases
      FROM purchases 
      WHERE status = 'received' 
        AND DATE(purchase_date) BETWEEN ? AND ?
    `, [start_date, end_date]);

    // Daily VAT breakdown
    const dailyVAT = await db.executeQuery(`
      SELECT 
        date,
        COALESCE(SUM(vat_collected), 0) as vat_collected,
        COALESCE(SUM(vat_paid), 0) as vat_paid,
        COALESCE(SUM(vat_collected), 0) - COALESCE(SUM(vat_paid), 0) as net_vat
      FROM (
        SELECT 
          DATE(sale_date) as date,
          SUM(vat_amount) as vat_collected,
          0 as vat_paid
        FROM sales 
        WHERE status = 'completed' 
          AND DATE(sale_date) BETWEEN ? AND ?
        GROUP BY DATE(sale_date)
        
        UNION ALL
        
        SELECT 
          DATE(purchase_date) as date,
          0 as vat_collected,
          SUM(vat_amount) as vat_paid
        FROM purchases 
        WHERE status = 'received' 
          AND DATE(purchase_date) BETWEEN ? AND ?
        GROUP BY DATE(purchase_date)
      ) vat_data
      GROUP BY date
      ORDER BY date ASC
    `, [start_date, end_date, start_date, end_date]);

    const totalVATCollected = vatCollected[0].total_vat_collected;
    const totalVATPaid = vatPaid[0].total_vat_paid;
    const netVAT = totalVATCollected - totalVATPaid;

    res.json({
      period: { start_date, end_date },
      summary: {
        vat_collected: totalVATCollected,
        vat_paid: totalVATPaid,
        net_vat: netVAT,
        total_sales: vatCollected[0].total_sales,
        total_purchases: vatPaid[0].total_purchases
      },
      daily_breakdown: dailyVAT
    });

  } catch (error) {
    console.error('Get VAT report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getCashFlowReport = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }

    // Cash inflows (sales)
    const cashInflows = await db.executeQuery(`
      SELECT 
        DATE(sale_date) as date,
        payment_method,
        COUNT(*) as transaction_count,
        SUM(total_amount) as amount
      FROM sales 
      WHERE status = 'completed' 
        AND DATE(sale_date) BETWEEN ? AND ?
      GROUP BY DATE(sale_date), payment_method
      ORDER BY date ASC, payment_method
    `, [start_date, end_date]);

    // Cash outflows (purchases)
    const cashOutflows = await db.executeQuery(`
      SELECT 
        DATE(purchase_date) as date,
        COUNT(*) as transaction_count,
        SUM(amount_paid) as amount
      FROM purchases 
      WHERE amount_paid > 0 
        AND DATE(purchase_date) BETWEEN ? AND ?
      GROUP BY DATE(purchase_date)
      ORDER BY date ASC
    `, [start_date, end_date]);

    // Net cash flow by day
    const netCashFlow = await db.executeQuery(`
      SELECT 
        date,
        COALESCE(SUM(inflow), 0) as total_inflow,
        COALESCE(SUM(outflow), 0) as total_outflow,
        COALESCE(SUM(inflow), 0) - COALESCE(SUM(outflow), 0) as net_cash_flow
      FROM (
        SELECT 
          DATE(sale_date) as date,
          SUM(total_amount) as inflow,
          0 as outflow
        FROM sales 
        WHERE status = 'completed' 
          AND DATE(sale_date) BETWEEN ? AND ?
        GROUP BY DATE(sale_date)
        
        UNION ALL
        
        SELECT 
          DATE(purchase_date) as date,
          0 as inflow,
          SUM(amount_paid) as outflow
        FROM purchases 
        WHERE amount_paid > 0 
          AND DATE(purchase_date) BETWEEN ? AND ?
        GROUP BY DATE(purchase_date)
      ) cash_data
      GROUP BY date
      ORDER BY date ASC
    `, [start_date, end_date, start_date, end_date]);

    res.json({
      period: { start_date, end_date },
      cash_inflows: cashInflows,
      cash_outflows: cashOutflows,
      net_cash_flow: netCashFlow
    });

  } catch (error) {
    console.error('Get cash flow report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getDashboardStats,
  getProfitLossReport,
  getInventoryReport,
  getVATReport,
  getCashFlowReport
};
