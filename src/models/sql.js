export const sql = `
        CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,

    role ENUM('Customer', 'Admin', 'Staff') DEFAULT 'Staff',

    profile_image TEXT,

    phone VARCHAR(15) UNIQUE NOT NULL,

    full_name VARCHAR(100)  NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,

    otp VARCHAR(6),

    otp_verify BOOLEAN DEFAULT FALSE,

    otp_expire TIMESTAMP NULL,

    profile_image_id TEXT,

    password TEXT,

    is_delete BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);



CREATE TABLE IF NOT EXISTS user_addresses (
   id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    address_type ENUM('billing', 'shipping', 'returns') NOT NULL,
    full_name VARCHAR(100) NOT NULL,          -- Recipient name (optional but useful)
    phone VARCHAR(15) NOT NULL,               -- Alternative contact for delivery
    line1 VARCHAR(255) NOT NULL,              -- House/building, street, area
    line2 VARCHAR(255) DEFAULT NULL,          -- Landmark, nearby location
    landmark VARCHAR(255) DEFAULT NULL,       -- Explicit landmark field (common in India)
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,              -- Indian states (e.g., 'Maharashtra')
    postal_code CHAR(6) NOT NULL,             -- PIN code – always 6 digits
    country VARCHAR(100) DEFAULT 'India',
    is_default BOOLEAN DEFAULT FALSE,
    is_deleted BOOLEAN DEFAULT FALSE,         -- Soft delete flag
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_postal_code (postal_code)       -- Useful for zone-based delivery
);



-- =============================================
-- 1. CATEGORIES table
-- =============================================
CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    image_url VARCHAR(255),
    display_order INT DEFAULT 0,
    status ENUM('active', 'inactive') DEFAULT 'active'
);

-- =============================================
-- 2. SUBCATEGORY table
-- =============================================
CREATE TABLE IF NOT EXISTS subcategory (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    image_url VARCHAR(255),
    display_order INT DEFAULT 0,
    status ENUM('active', 'inactive') DEFAULT 'active',
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- =============================================
-- 3. BRANDS table
-- =============================================
CREATE TABLE IF NOT EXISTS brands (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    logo_url VARCHAR(255),
    website VARCHAR(255)
);

-- ===========================================
-- 4. PRODUCTS table
-- ===========================================
CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT NOT NULL,
    sub_category_id INT NOT NULL,
    brand_id INT NOT NULL,
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(200) NOT NULL,
    short_description TEXT,
    long_description TEXT,
    seo_title VARCHAR(200),
    seo_description TEXT,
    seo_keywords VARCHAR(500),
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (sub_category_id) REFERENCES subcategory(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE RESTRICT ON UPDATE CASCADE,

     -- Indexes
    UNIQUE INDEX idx_products_slug (slug),
    INDEX idx_products_category_id (category_id),
    INDEX idx_products_sub_category_id (sub_category_id),
    INDEX idx_products_status (status)
);



-- ===========================================
-- 6. PRODUCTS ITEMS
-- ===========================================
CREATE TABLE IF NOT EXISTS product_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    variation_value VARCHAR(100) NOT NULL,         -- e.g., 'Red', '6000K', 'H7'
    sku VARCHAR(100) NOT NULL UNIQUE,
    price DECIMAL(10,2) NOT NULL DEFAULT 0.00,    -- current selling price
    weight DECIMAL(8,2),                           -- in kg or lb (choose unit)
    width DECIMAL(8,2),                            -- in cm or inches
    height DECIMAL(8,2),
    depth DECIMAL(8,2),
    is_available BOOLEAN DEFAULT TRUE,
    available_stock INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_product_id (product_id)
);

-- ===========================================
-- 7. Product Images table
-- ===========================================
CREATE TABLE IF NOT EXISTS product_images (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    image_url VARCHAR(500) NOT NULL,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE,
    
    INDEX idx_product_id (product_id),
    INDEX idx_sort_order (sort_order)
);

-- ===========================================
-- 8. PRODUCTS TECHNICAL ATTRIBUTES
-- ===========================================
CREATE TABLE IF NOT EXISTS product_technical_attributes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    attribute_name VARCHAR(100) NOT NULL,
    attribute_value VARCHAR(500) NOT NULL,
    unit VARCHAR(50) NULL,                         -- e.g., 'mm', 'kg', 'lumens'
    display_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE,
    
    INDEX idx_product_id (product_id),
    INDEX idx_attribute_name (attribute_name)
);

-- ===========================================
-- 9. PRODUCTS STOCK
-- ===========================================
CREATE TABLE IF NOT EXISTS product_stock (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_item_id INT NOT NULL,                  -- references product_items (SKU)
    quantity INT NOT NULL DEFAULT 0,
    reserved_quantity INT NOT NULL DEFAULT 0,      -- for pending orders
    backorder_allowed BOOLEAN DEFAULT FALSE,
    threshold_quantity INT NOT NULL DEFAULT 0,
    last_restocked_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (product_item_id) REFERENCES product_items(id) ON DELETE CASCADE ON UPDATE CASCADE,
    
   
    INDEX idx_quantity (quantity)
);


-- =============================================
-- 10. CART table (supports both logged-in users and guests)
-- =============================================
CREATE TABLE IF NOT EXISTS cart (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,                           -- NULL for guest carts
    session_token VARCHAR(255) NULL,            -- unique token for guest carts
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Ensure either user_id or session_token is present (optional, can be enforced in app)
    INDEX idx_user_id (user_id),
    INDEX idx_session_token (session_token),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- =============================================
-- 11. CART_ITEMS table
-- =============================================
CREATE TABLE IF NOT EXISTS cart_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    cart_id INT NOT NULL,
    product_item_id INT NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10,2) NOT NULL,           -- snapshot price at add time
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (cart_id) REFERENCES cart(id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (product_item_id) REFERENCES product_items(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    
    INDEX idx_cart_id (cart_id),
    INDEX idx_product_item_id (product_item_id)
);

-- =============================================
-- 12. ORDERS table
-- =============================================
CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    order_status ENUM('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded') DEFAULT 'pending',
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    shipping_address_id INT NOT NULL,
    billing_address_id INT NOT NULL,
    subtotal DECIMAL(10,2) NOT NULL,
    shipping_cost DECIMAL(10,2) DEFAULT 0.00,
    tax_amount DECIMAL(10,2) DEFAULT 0.00,
    discount_amount DECIMAL(10,2) DEFAULT 0.00,
    total_amount DECIMAL(10,2) NOT NULL,
    currency_code VARCHAR(3) DEFAULT 'USD',      -- e.g., USD, EUR, INR
    customer_notes TEXT,
    admin_notes TEXT,
    payment_status ENUM('pending', 'paid', 'failed', 'refunded') DEFAULT 'pending',
    return_date TIMESTAMP NULL,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (shipping_address_id) REFERENCES user_addresses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (billing_address_id) REFERENCES user_addresses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    
    INDEX idx_user_id (user_id),
    INDEX idx_order_status (order_status),
    INDEX idx_order_date (order_date)
);

-- =============================================
-- 13 ORDER_ITEMS table
-- =============================================
CREATE TABLE IF NOT EXISTS order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_item_id INT NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    product_data_snapshot JSON NOT NULL,         -- stores product_name, SKU, attributes at purchase time
    
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (product_item_id) REFERENCES product_items(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    
    INDEX idx_order_id (order_id),
    INDEX idx_product_item_id (product_item_id)
);

-- =============================================
-- 14 Guest Token
-- =============================================

CREATE TABLE IF NOT EXISTS guest_sessions (
token VARCHAR(255) PRIMARY KEY,
 created_at TIMESTAMP,
  last_used TIMESTAMP);




  
-- =============================================
-- 15 SHIPMENTS
-- =============================================
CREATE TABLE IF NOT EXISTS shipments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    carrier VARCHAR(100) NOT NULL,
    tracking_number VARCHAR(255),
    tracking_url TEXT,
    shipped_at TIMESTAMP NULL,
    delivered_at TIMESTAMP NULL,
    shipment_status ENUM('processing', 'in_transit', 'delivered', 'returned') DEFAULT 'processing',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_order_id (order_id),
    INDEX idx_shipment_status (shipment_status),
    INDEX idx_tracking_number (tracking_number)
);

-- =============================================
-- 16 Shipments Table
-- =============================================
CREATE TABLE IF NOT EXISTS shipment_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shipment_id INT NOT NULL,
    order_item_id INT NOT NULL,
    quantity_shipped INT NOT NULL CHECK (quantity_shipped > 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    UNIQUE KEY unique_shipment_item (shipment_id, order_item_id),
    INDEX idx_shipment_id (shipment_id),
    INDEX idx_order_item_id (order_item_id)
);

-- =============================================
-- 17 Payment Methods
-- =============================================
CREATE TABLE IF NOT EXISTS payment_methods (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    method_type ENUM('credit_card', 'upi', 'afterpay', 'bank_transfer') NOT NULL,
    tokenised_details TEXT NOT NULL, -- encrypted payment details
    last_four VARCHAR(4), -- Last 4 digits for card, useful for display
    expiry_date VARCHAR(7), -- MM/YYYY format for cards
    card_holder_name VARCHAR(100),
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_method_type (method_type),
    INDEX idx_is_default (is_default),
    INDEX idx_is_active (is_active)
);

-- =============================================
-- 18 Transactions
-- =============================================e
CREATE TABLE IF NOT EXISTS transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    payment_method_id INT NULL,
    transaction_type ENUM('authorisation', 'capture', 'refund', 'void') NOT NULL,
    amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
    currency_code CHAR(3) DEFAULT 'IND',
    gateway_reference_id VARCHAR(255), -- reference from payment processor (e.g., Stripe charge ID)
    status ENUM('pending', 'success', 'failed') DEFAULT 'pending',
    error_message TEXT, -- Store failure reason if any
    transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_order_id (order_id),
    INDEX idx_payment_method_id (payment_method_id),
    INDEX idx_transaction_type (transaction_type),
    INDEX idx_status (status),
    INDEX idx_gateway_reference (gateway_reference_id),
    INDEX idx_transaction_date (transaction_date)
);



-- =============================================
-- 19. RETURNS table (with extra handwritten fields)
-- =============================================
CREATE TABLE IF NOT EXISTS returns (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    user_id INT NOT NULL,
    return_reason ENUM('defective', 'not_as_described', 'changed_mind', 'warranty_claim') NOT NULL,
    return_status ENUM('requested', 'approved', 'rejected', 'received', 'refund_issued') DEFAULT 'requested',
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMP NULL,
    received_at TIMESTAMP NULL,
    refund_amount DECIMAL(10,2) NOT NULL,
    refund_estimated_date DATE NULL,          -- handwritten: "Estimate date"
    refund_credited_at TIMESTAMP NULL,        -- handwritten: "Refund credited"
    expense_count INT DEFAULT 0,              -- handwritten: "Count in Expense"
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_order_id (order_id),
    INDEX idx_user_id (user_id),
    INDEX idx_return_status (return_status)
);

-- =============================================
-- 20. RETURN_ITEMS table
-- =============================================
CREATE TABLE IF NOT EXISTS return_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    return_id INT NOT NULL,
    order_item_id INT NOT NULL,
    quantity_returned INT NOT NULL CHECK (quantity_returned > 0),
    restocking_fee DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (return_id) REFERENCES returns(id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_return_id (return_id),
    INDEX idx_order_item_id (order_item_id)
);

-- =============================================
-- 21. WARRANTY_REGISTRATIONS table
-- =============================================
CREATE TABLE IF NOT EXISTS warranty_registrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    order_item_id INT NOT NULL,
    registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    warranty_end_date DATE NOT NULL,          -- calculated from purchase date
    warranty_number VARCHAR(100) UNIQUE NOT NULL,
    status ENUM('active', 'expired', 'claimed') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_order_item_id (order_item_id),
    INDEX idx_warranty_number (warranty_number),
    INDEX idx_status (status)
);

-- =============================================
-- 22. SUPPORT_TICKETS table
-- =============================================
CREATE TABLE IF NOT EXISTS support_tickets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    order_id INT NULL,                        -- nullable if not related to an order
    subject VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    ticket_status ENUM('open', 'in_progress', 'resolved', 'closed', 'answered', 'awaiting') DEFAULT 'open',
    priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_order_id (order_id),
    INDEX idx_ticket_status (ticket_status),
    INDEX idx_priority (priority)
);

-- =============================================
-- 23. TICKET_COMMUNICATIONS table
-- =============================================
CREATE TABLE IF NOT EXISTS ticket_communications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    author_user_id INT NOT NULL,
    message_body TEXT NOT NULL,
    attachment_urls JSON NULL,                -- array of file links
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_ticket_id (ticket_id),
    INDEX idx_author_user_id (author_user_id)
);

-- =============================================
-- 24. REVIEWS table
-- =============================================
CREATE TABLE IF NOT EXISTS reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    product_item_id INT NOT NULL,
    order_item_id INT NOT NULL,
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title VARCHAR(200),
    content TEXT,
    is_verified_purchase BOOLEAN DEFAULT FALSE,
    helpful_count INT DEFAULT 0,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (product_item_id) REFERENCES product_items(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_product_item_id (product_item_id),
    INDEX idx_order_item_id (order_item_id),
    INDEX idx_rating (rating),
    INDEX idx_status (status)
);

-- =============================================
-- 25. TAX_RATES table
-- =============================================
CREATE TABLE IF NOT EXISTS tax_rates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    country_code CHAR(2) NOT NULL,
    state_code VARCHAR(10) NULL,
    tax_rate DECIMAL(5,4) NOT NULL,           -- e.g., 0.10 for 10%
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_country_state (country_code, state_code),
    INDEX idx_is_active (is_active)
);

-- =============================================
-- 26. SHIPPING_METHODS table
-- =============================================
CREATE TABLE IF NOT EXISTS shipping_methods (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,               -- e.g., "Australia Post Standard"
    price DECIMAL(10,2) NOT NULL,
    free_shipping_threshold DECIMAL(10,2) NULL,
    estimated_days_min INT NOT NULL,
    estimated_days_max INT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_is_active (is_active)
);

-- =============================================
-- 27. AUDIT_LOG table
-- =============================================
CREATE TABLE IF NOT EXISTS audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,                     -- admin/staff who performed action
    action VARCHAR(255) NOT NULL,             -- e.g., "updated_product_price"
    table_name VARCHAR(100) NOT NULL,
    record_id INT NOT NULL,
    old_data JSON NULL,
    new_data JSON NULL,
    source_ip VARCHAR(45) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_table_record (table_name, record_id),
    INDEX idx_action (action),
    INDEX idx_created_at (created_at)
);

-- =============================================
-- 28. SYSTEM_CONFIG table (key-value store)
-- =============================================
CREATE TABLE IF NOT EXISTS system_config (
    config_key VARCHAR(100) PRIMARY KEY,
    config_value JSON NOT NULL,               -- allows storing any type (string, number, object)
    description TEXT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);


`;
