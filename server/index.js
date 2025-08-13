const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const inventoryRoutes = require('./routes/inventory');
const salesRoutes = require('./routes/sales');
const purchasesRoutes = require('./routes/purchases');
const suppliersRoutes = require('./routes/suppliers');
const accountingRoutes = require('./routes/accounting');
const crmRoutes = require('./routes/crm');
const systemSettingsRoutes = require('./routes/systemSettings');
const mpesaRoutes = require('./routes/mpesa');
const usersRoutes = require('./routes/users');

const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/settings', systemSettingsRoutes);
app.use('/api/mpesa', mpesaRoutes);
app.use('/api/users', usersRoutes);

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`ERP/POS Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
