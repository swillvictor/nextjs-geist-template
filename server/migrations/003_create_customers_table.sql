CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(100),
  phone VARCHAR(20),
  address TEXT,
  city VARCHAR(100),
  postal_code VARCHAR(20),
  kra_pin VARCHAR(20),
  id_number VARCHAR(20),
  customer_type ENUM('individual', 'corporate') DEFAULT 'individual',
  credit_limit DECIMAL(12, 2) DEFAULT 0.00,
  current_balance DECIMAL(12, 2) DEFAULT 0.00,
  loyalty_points INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_customer_code (customer_code),
  INDEX idx_name (name),
  INDEX idx_phone (phone),
  INDEX idx_active (is_active)
);

-- Insert walk-in customer
INSERT INTO customers (customer_code, name, customer_type) 
VALUES ('WALK-IN', 'Walk-in Customer', 'individual')
ON DUPLICATE KEY UPDATE name = name;
