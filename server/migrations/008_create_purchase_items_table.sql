CREATE TABLE IF NOT EXISTS purchase_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  purchase_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity_ordered DECIMAL(10, 3) NOT NULL,
  quantity_received DECIMAL(10, 3) DEFAULT 0,
  unit_cost DECIMAL(12, 2) NOT NULL,
  vat_rate DECIMAL(5, 2) NOT NULL,
  vat_amount DECIMAL(12, 2) NOT NULL,
  discount_amount DECIMAL(12, 2) DEFAULT 0.00,
  line_total DECIMAL(12, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  INDEX idx_purchase (purchase_id),
  INDEX idx_product (product_id)
);
