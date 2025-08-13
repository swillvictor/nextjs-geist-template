CREATE TABLE IF NOT EXISTS system_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT,
  setting_type ENUM('string', 'number', 'boolean', 'json') DEFAULT 'string',
  description TEXT,
  is_editable BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_key (setting_key)
);

INSERT INTO system_settings (setting_key, setting_value, setting_type, description, is_editable) VALUES
('company_name', 'Your Company Name', 'string', 'Company name for receipts and reports', TRUE),
('company_address', 'P.O. Box 123, Nairobi, Kenya', 'string', 'Company address', TRUE),
('company_phone', '+254700000000', 'string', 'Company phone number', TRUE),
('company_email', 'info@company.com', 'string', 'Company email address', TRUE),
('kra_pin', 'P000000000A', 'string', 'KRA PIN number', TRUE),
('vat_rate', '16.00', 'number', 'Default VAT rate percentage', TRUE),
('currency', 'KES', 'string', 'Default currency', TRUE),
('receipt_footer', 'Thank you for your business!', 'string', 'Receipt footer message', TRUE),
('mpesa_till_number', '000000', 'string', 'M-Pesa Till Number', TRUE),
('mpesa_paybill', '000000', 'string', 'M-Pesa Paybill Number', TRUE),
('low_stock_alert', '10', 'number', 'Low stock alert threshold', TRUE),
('auto_backup', 'true', 'boolean', 'Enable automatic backups', TRUE),
('receipt_printer_ip', '192.168.1.100', 'string', 'Thermal printer IP address', TRUE),
('receipt_printer_port', '9100', 'number', 'Thermal printer port', TRUE)
ON DUPLICATE KEY UPDATE setting_key = setting_key;
