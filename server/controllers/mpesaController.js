const axios = require('axios');
const Joi = require('joi');
const db = require('../config/database');

// Validation schemas
const stkPushSchema = Joi.object({
  phone_number: Joi.string().pattern(/^254[17]\d{8}$/).required(),
  amount: Joi.number().min(1).max(150000).required(),
  account_reference: Joi.string().max(100).required(),
  transaction_desc: Joi.string().max(200).required(),
  sale_id: Joi.number().integer().optional()
});

// M-Pesa API configuration
const MPESA_CONFIG = {
  consumer_key: process.env.MPESA_CONSUMER_KEY,
  consumer_secret: process.env.MPESA_CONSUMER_SECRET,
  business_short_code: process.env.MPESA_BUSINESS_SHORT_CODE,
  passkey: process.env.MPESA_PASSKEY,
  environment: process.env.MPESA_ENVIRONMENT || 'sandbox',
  callback_url: process.env.MPESA_CALLBACK_URL
};

// Get M-Pesa access token
const getAccessToken = async () => {
  try {
    const auth = Buffer.from(`${MPESA_CONFIG.consumer_key}:${MPESA_CONFIG.consumer_secret}`).toString('base64');
    
    const baseUrl = MPESA_CONFIG.environment === 'production' 
      ? 'https://api.safaricom.co.ke' 
      : 'https://sandbox.safaricom.co.ke';

    const response = await axios.get(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: {
        'Authorization': `Basic ${auth}`
      }
    });

    return response.data.access_token;
  } catch (error) {
    console.error('M-Pesa access token error:', error.response?.data || error.message);
    throw new Error('Failed to get M-Pesa access token');
  }
};

// Generate timestamp for M-Pesa
const generateTimestamp = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  
  return `${year}${month}${day}${hour}${minute}${second}`;
};

// Generate password for M-Pesa
const generatePassword = (timestamp) => {
  const data = `${MPESA_CONFIG.business_short_code}${MPESA_CONFIG.passkey}${timestamp}`;
  return Buffer.from(data).toString('base64');
};

const initiateSTKPush = async (req, res) => {
  try {
    const { error } = stkPushSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { phone_number, amount, account_reference, transaction_desc, sale_id } = req.body;

    // Validate M-Pesa configuration
    if (!MPESA_CONFIG.consumer_key || !MPESA_CONFIG.consumer_secret) {
      return res.status(500).json({ error: 'M-Pesa configuration not found' });
    }

    // Get access token
    const accessToken = await getAccessToken();
    
    // Generate timestamp and password
    const timestamp = generateTimestamp();
    const password = generatePassword(timestamp);

    const baseUrl = MPESA_CONFIG.environment === 'production' 
      ? 'https://api.safaricom.co.ke' 
      : 'https://sandbox.safaricom.co.ke';

    // Prepare STK Push request
    const stkPushData = {
      BusinessShortCode: MPESA_CONFIG.business_short_code,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phone_number,
      PartyB: MPESA_CONFIG.business_short_code,
      PhoneNumber: phone_number,
      CallBackURL: MPESA_CONFIG.callback_url,
      AccountReference: account_reference,
      TransactionDesc: transaction_desc
    };

    // Make STK Push request
    const response = await axios.post(`${baseUrl}/mpesa/stkpush/v1/processrequest`, stkPushData, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const { MerchantRequestID, CheckoutRequestID, ResponseCode, ResponseDescription } = response.data;

    if (ResponseCode === '0') {
      // Save transaction to database
      await db.executeQuery(`
        INSERT INTO mpesa_transactions (
          merchant_request_id, checkout_request_id, sale_id, phone_number, 
          amount, account_reference, transaction_desc, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        MerchantRequestID, CheckoutRequestID, sale_id, phone_number,
        amount, account_reference, transaction_desc, 'pending'
      ]);

      res.json({
        success: true,
        message: 'STK Push initiated successfully',
        merchant_request_id: MerchantRequestID,
        checkout_request_id: CheckoutRequestID
      });
    } else {
      res.status(400).json({
        success: false,
        message: ResponseDescription,
        response_code: ResponseCode
      });
    }

  } catch (error) {
    console.error('STK Push error:', error.response?.data || error.message);
    res.status(500).json({ 
      success: false,
      error: 'Failed to initiate STK Push',
      details: error.response?.data || error.message
    });
  }
};

const handleCallback = async (req, res) => {
  try {
    const callbackData = req.body;
    console.log('M-Pesa Callback received:', JSON.stringify(callbackData, null, 2));

    const { Body } = callbackData;
    const { stkCallback } = Body;

    const {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata
    } = stkCallback;

    // Update transaction in database
    let transactionId = null;
    let amount = null;
    let phoneNumber = null;

    if (ResultCode === 0 && CallbackMetadata) {
      // Extract transaction details from callback metadata
      const items = CallbackMetadata.Item;
      
      for (const item of items) {
        switch (item.Name) {
          case 'MpesaReceiptNumber':
            transactionId = item.Value;
            break;
          case 'Amount':
            amount = item.Value;
            break;
          case 'PhoneNumber':
            phoneNumber = item.Value;
            break;
        }
      }
    }

    // Update transaction status
    const status = ResultCode === 0 ? 'success' : 'failed';
    
    await db.executeQuery(`
      UPDATE mpesa_transactions 
      SET 
        transaction_id = ?,
        result_code = ?,
        result_desc = ?,
        status = ?,
        callback_received = TRUE,
        updated_at = CURRENT_TIMESTAMP
      WHERE checkout_request_id = ?
    `, [transactionId, ResultCode, ResultDesc, status, CheckoutRequestID]);

    // If successful, update associated sale
    if (ResultCode === 0) {
      const transaction = await db.executeQuery(
        'SELECT sale_id, amount FROM mpesa_transactions WHERE checkout_request_id = ?',
        [CheckoutRequestID]
      );

      if (transaction.length > 0 && transaction[0].sale_id) {
        await db.executeQuery(`
          UPDATE sales 
          SET 
            amount_paid = ?,
            payment_reference = ?,
            status = 'completed'
          WHERE id = ?
        `, [amount || transaction[0].amount, transactionId, transaction[0].sale_id]);
      }
    }

    // Acknowledge callback
    res.json({ ResultCode: 0, ResultDesc: 'Callback processed successfully' });

  } catch (error) {
    console.error('M-Pesa callback error:', error);
    res.status(500).json({ ResultCode: 1, ResultDesc: 'Callback processing failed' });
  }
};

const queryTransactionStatus = async (req, res) => {
  try {
    const { checkout_request_id } = req.params;

    if (!checkout_request_id) {
      return res.status(400).json({ error: 'Checkout request ID is required' });
    }

    // Get transaction from database
    const transactions = await db.executeQuery(
      'SELECT * FROM mpesa_transactions WHERE checkout_request_id = ?',
      [checkout_request_id]
    );

    if (!transactions.length) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const transaction = transactions[0];

    // If callback not received, query M-Pesa API
    if (!transaction.callback_received) {
      try {
        const accessToken = await getAccessToken();
        const timestamp = generateTimestamp();
        const password = generatePassword(timestamp);

        const baseUrl = MPESA_CONFIG.environment === 'production' 
          ? 'https://api.safaricom.co.ke' 
          : 'https://sandbox.safaricom.co.ke';

        const queryData = {
          BusinessShortCode: MPESA_CONFIG.business_short_code,
          Password: password,
          Timestamp: timestamp,
          CheckoutRequestID: checkout_request_id
        };

        const response = await axios.post(`${baseUrl}/mpesa/stkpushquery/v1/query`, queryData, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        });

        const { ResultCode, ResultDesc, ResponseCode } = response.data;

        if (ResponseCode === '0') {
          // Update transaction status based on query result
          const status = ResultCode === '0' ? 'success' : 
                        ResultCode === '1032' ? 'cancelled' : 'failed';

          await db.executeQuery(`
            UPDATE mpesa_transactions 
            SET 
              result_code = ?,
              result_desc = ?,
              status = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE checkout_request_id = ?
          `, [ResultCode, ResultDesc, status, checkout_request_id]);

          transaction.result_code = ResultCode;
          transaction.result_desc = ResultDesc;
          transaction.status = status;
        }
      } catch (queryError) {
        console.error('M-Pesa query error:', queryError.response?.data || queryError.message);
      }
    }

    res.json({
      transaction: {
        merchant_request_id: transaction.merchant_request_id,
        checkout_request_id: transaction.checkout_request_id,
        phone_number: transaction.phone_number,
        amount: transaction.amount,
        status: transaction.status,
        result_code: transaction.result_code,
        result_desc: transaction.result_desc,
        transaction_id: transaction.transaction_id,
        created_at: transaction.created_at
      }
    });

  } catch (error) {
    console.error('Query transaction status error:', error);
    res.status(500).json({ error: 'Failed to query transaction status' });
  }
};

const getAllTransactions = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      status = '',
      start_date = '',
      end_date = '',
      phone_number = ''
    } = req.query;

    const offset = (page - 1) * limit;
    let whereConditions = [];
    let queryParams = [];

    // Build WHERE conditions
    if (status) {
      whereConditions.push('status = ?');
      queryParams.push(status);
    }

    if (start_date) {
      whereConditions.push('DATE(created_at) >= ?');
      queryParams.push(start_date);
    }

    if (end_date) {
      whereConditions.push('DATE(created_at) <= ?');
      queryParams.push(end_date);
    }

    if (phone_number) {
      whereConditions.push('phone_number LIKE ?');
      queryParams.push(`%${phone_number}%`);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    // Get transactions
    const query = `
      SELECT 
        mt.*,
        s.sale_number
      FROM mpesa_transactions mt
      LEFT JOIN sales s ON mt.sale_id = s.id
      ${whereClause}
      ORDER BY mt.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const transactions = await db.executeQuery(query, [...queryParams, parseInt(limit), offset]);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM mpesa_transactions mt
      ${whereClause}
    `;
    const countResult = await db.executeQuery(countQuery, queryParams);
    const total = countResult[0].total;

    res.json({
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get M-Pesa transactions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getTransactionSummary = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let whereClause = '';
    let queryParams = [];

    if (start_date && end_date) {
      whereClause = 'WHERE DATE(created_at) BETWEEN ? AND ?';
      queryParams = [start_date, end_date];
    } else if (start_date) {
      whereClause = 'WHERE DATE(created_at) >= ?';
      queryParams = [start_date];
    } else if (end_date) {
      whereClause = 'WHERE DATE(created_at) <= ?';
      queryParams = [end_date];
    }

    const summary = await db.executeQuery(`
      SELECT 
        COUNT(*) as total_transactions,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_transactions,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_transactions,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_transactions,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_transactions,
        COALESCE(SUM(CASE WHEN status = 'success' THEN amount ELSE 0 END), 0) as total_successful_amount,
        COALESCE(AVG(CASE WHEN status = 'success' THEN amount ELSE NULL END), 0) as average_transaction_amount
      FROM mpesa_transactions
      ${whereClause}
    `, queryParams);

    res.json({ summary: summary[0] });

  } catch (error) {
    console.error('Get M-Pesa summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  initiateSTKPush,
  handleCallback,
  queryTransactionStatus,
  getAllTransactions,
  getTransactionSummary
};
