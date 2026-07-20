/*
export const sql = `
        CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,

    role ENUM('Customer', 'Admin', 'Staff') DEFAULT 'Customer',

    profile_image TEXT,

    phone VARCHAR(15) UNIQUE NOT NULL,

    full_name VARCHAR(100)  NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,

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
 
    is_front BOOLEAN DEFAULT 0 NOT NULL ,

     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    is_front TINYINT(1) DEFAULT 0 NOT NULL, 

    status ENUM('active', 'inactive') DEFAULT 'active',
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- =============================================
-- 3. BRANDS table
-- =============================================
CREATE TABLE IF NOT EXISTS brands (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    logo_url VARCHAR(255),
    website VARCHAR(255),
    status ENUM('active', 'inactive') DEFAULT 'active' NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- =============================================
-- VEHICLE MAKES (e.g., Toyota, Honda, Ford)
-- =============================================
CREATE TABLE IF NOT EXISTS vehicle_makes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,          -- e.g., 'Toyota'
    logo_url VARCHAR(255) NULL,
    country VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    status ENUM('active', 'inactive') DEFAULT 'active' NOT NULL,
    INDEX idx_name (name)
);


-- =============================================
-- VEHICLE MODELS (e.g., Camry, Civic, F-150)
-- =============================================
CREATE TABLE IF NOT EXISTS vehicle_models (
    id INT AUTO_INCREMENT PRIMARY KEY,
    make_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,                 -- e.g., 'Camry'
    description TEXT NULL,
    model_image_url VARCHAR(255) NULL,
    status ENUM('active', 'inactive') DEFAULT 'active' NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (make_id) REFERENCES vehicle_makes(id) ON DELETE CASCADE ON UPDATE CASCADE,
    UNIQUE KEY idx_make_model (make_id, name),  -- ensures model name is unique per make
    INDEX idx_name (name)
);

-- =============================================
-- VEHICLE GENERATIONS (year range / generation code)
-- =============================================
CREATE TABLE IF NOT EXISTS vehicle_generations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    model_id INT NOT NULL,
    generation_name VARCHAR(100) NULL,          -- e.g., 'XV70', '10th Gen', 'Facelift'
    year_from INT NOT NULL,                     -- start year (e.g., 2018)
    year_to INT NULL,                           -- end year (e.g., 2022), NULL if current
    status ENUM('active', 'inactive') DEFAULT 'active' NOT NULL,
    engine_options TEXT NULL,                   -- optional: JSON or comma-separated
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (model_id) REFERENCES vehicle_models(id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_year_range (year_from, year_to),
    INDEX idx_generation (model_id, year_from)
);






-- =============================================
-- (Optional) Pivot table: Product <-> Vehicle Generation
-- Allows a product to fit multiple vehicle generations
-- =============================================
CREATE TABLE IF NOT EXISTS product_vehicle_compatibility (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    vehicle_generation_id INT NOT NULL,
    compatibility_notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (vehicle_generation_id) REFERENCES vehicle_generations(id) ON DELETE CASCADE,
    UNIQUE KEY idx_product_vehicle (product_id, vehicle_generation_id),
    INDEX idx_product_id (product_id),
    INDEX idx_vehicle_generation_id (vehicle_generation_id)
);



-- ===========================================
-- 7. Product Images table
-- ===========================================
CREATE TABLE IF NOT EXISTS product_images (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    image_url VARCHAR(500) NOT NULL,
    sort_order INT DEFAULT 0,
    status ENUM('active', 'inactive') DEFAULT 'active' NOT NULL,  -- ✅ Added
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE,
    
    INDEX idx_product_id (product_id),
    INDEX idx_sort_order (sort_order),
    INDEX idx_status (status)  -- ✅ Recommended for faster queries
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
    user_id INT NULL,
    session_token VARCHAR(255) NULL,
    items JSON NOT NULL DEFAULT (JSON_ARRAY()),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_session_token (session_token),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);



-- =============================================
-- 14 Guest Token
-- =============================================

CREATE TABLE IF NOT EXISTS guest_sessions (
token VARCHAR(255) PRIMARY KEY,
 created_at TIMESTAMP,
  last_used TIMESTAMP);

-- =============================================
-- 12. ORDERS table
-- =============================================
CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    order_status ENUM('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded') DEFAULT 'pending',
    delivered_at TIMESTAMP NULL,
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    shipping_address_id INT NOT NULL,
    billing_address_id INT NOT NULL,
    subtotal DECIMAL(10,2) NOT NULL,
    shipping_cost DECIMAL(10,2) DEFAULT 0.00,
    tax_amount DECIMAL(10,2) DEFAULT 0.00,
    discount_amount DECIMAL(10,2) DEFAULT 0.00,
    payment_method ENUM('card', 'upi', 'bank_transfer', 'cash', 'razorpay') ,
    total_amount DECIMAL(10,2) NOT NULL,
    currency_code VARCHAR(3) DEFAULT 'USD',
    customer_notes TEXT,
    admin_notes TEXT,
    payment_status ENUM('pending', 'paid', 'failed', 'refunded') DEFAULT 'pending',
    return_date TIMESTAMP NULL,

    razorpay_order_id VARCHAR(255),
    razorpay_payment_id VARCHAR(255),

    -- === NEW COLUMNS ===
    coupon_id INT NULL,                                    -- References the coupon used
  
    -- ==================

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (shipping_address_id) REFERENCES user_addresses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (billing_address_id) REFERENCES user_addresses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE SET NULL ON UPDATE CASCADE,   -- If coupon deleted, keep order history

    INDEX idx_user_id (user_id),
    INDEX idx_order_status (order_status),
    INDEX idx_order_date (order_date),
    INDEX idx_coupon_id (coupon_id)                         -- Optional but recommended
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
    claimed_quantity INT NOT NULL DEFAULT 0,
   warranty_claimed_at TIMESTAMP NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (product_item_id) REFERENCES product_items(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    tax_percentage DECIMAL(5,2) DEFAULT 0,
tax_amount DECIMAL(10,2) DEFAULT 0,
    
    INDEX idx_order_id (order_id),
    INDEX idx_product_item_id (product_item_id)
);



-- =============================================
-- COUPONS (master list of available coupons)
-- =============================================
CREATE TABLE IF NOT EXISTS coupons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    discount_type ENUM('percentage', 'fixed') NOT NULL,
    discount_value DECIMAL(10,2) NOT NULL,          -- e.g., 5 for 5% or 50 for ₹50
    min_order_amount DECIMAL(10,2) DEFAULT 0.00,
    max_discount_amount DECIMAL(10,2) NULL,         -- for percentage coupons, max discount cap
    usage_limit_per_user INT DEFAULT 1,             -- how many times one user can use this coupon
    total_usage_limit INT NULL,                     -- global usage limit (across all users)
     valid_from DATETIME NOT NULL,
 valid_to DATETIME NOT NULL,
    description TEXT NULL,
    is_active tinyint(1) DEFAULT true,
    created_by_user_id INT NULL,                    -- admin who created it (or system)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_code (code),
    INDEX idx_valid_dates (valid_from, valid_to),
    INDEX idx_discount_type (discount_type)
);


-- =============================================
-- 18 Transactions
-- =============================================e
CREATE TABLE IF NOT EXISTS transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    payment_method ENUM('card', 'upi', 'bank_transfer', 'cash', 'razorpay') ,
    transaction_type ENUM('payment', 'authorisation', 'capture', 'refund', 'void') NOT NULL, -- Added 'payment'
    amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
    currency_code CHAR(3) DEFAULT 'IND',
    
    -- 🔥 Two separate gateway IDs
    gateway_order_id VARCHAR(255) NULL,      -- Razorpay order_id / PhonePe merchantOrderId (Initial)
    gateway_reference_id VARCHAR(255) NULL,  -- Razorpay payment_id / PhonePe transactionId (Final)
    
    status ENUM('pending', 'success', 'failed') DEFAULT 'pending',
    error_message TEXT,
    
    -- 🔥 Save raw webhook data for debugging
    gateway_response JSON NULL,
    
    transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_order_id (order_id),
    INDEX idx_payment_method (payment_method),
    INDEX idx_transaction_type (transaction_type),
    INDEX idx_status (status),
    INDEX idx_gateway_order (gateway_order_id),      -- Index this for lookups
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
-- 24. REVIEWS table
-- =============================================
CREATE TABLE IF NOT EXISTS reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    product_id INT NOT NULL,
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



CREATE TABLE IF NOT EXISTS product_reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,

    product_id INT NOT NULL,
    user_id INT NOT NULL,
    order_id INT DEFAULT NULL,

    rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review TEXT DEFAULT NULL,
    is_verified_purchase BOOLEAN DEFAULT FALSE,

    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_review_product
        FOREIGN KEY (product_id)
        REFERENCES product(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_review_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_review_order
        FOREIGN KEY (order_id)
        REFERENCES orders(id)
        ON DELETE SET NULL,

    UNIQUE KEY unique_user_product_order (user_id, product_id, order_id),

    INDEX idx_product (product_id),
    INDEX idx_user (user_id),
    INDEX idx_status (status)
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
-- 28. Shipments
-- =============================================
CREATE TABLE IF NOT EXISTS shipments (
 id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    tracking_number VARCHAR(100),
    carrier VARCHAR(30),
    label_url VARCHAR(500),
    recipient_address TEXT, -- copied from order
    current_status VARCHAR(30) DEFAULT 'pending',
    tracking_history JSON DEFAULT NULL, -- stores all scan events
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX (order_id)
);



`;

*/

export const sql = `
          CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,

    role ENUM('Customer', 'Admin', 'Staff') DEFAULT 'Customer',

    profile_image TEXT,

    phone VARCHAR(15) UNIQUE NOT NULL,

    full_name VARCHAR(100)  NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,

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
    is_front BOOLEAN DEFAULT 0 NOT NULL,
    is_deleted TINYINT NOT NULL DEFAULT 0,
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
    is_front TINYINT(1) DEFAULT 0 NOT NULL, 
    is_deleted TINYINT NOT NULL DEFAULT 0,
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
    website VARCHAR(255),
    status ENUM('active', 'inactive') DEFAULT 'active' NOT NULL,
    is_deleted TINYINT NOT NULL DEFAULT 0
);

-- ===========================================
-- 4. PRODUCTS table
-- ===========================================

CREATE TABLE IF NOT EXISTS product (
    -- Product fields
    id INT NOT NULL  AUTO_INCREMENT PRIMARY KEY,
    category_id INT NOT NULL,
    sub_category_id INT NOT NULL,
    brand_id INT  NULL,
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(200) NOT NULL,
    short_description TEXT,
    long_description TEXT,
    seo_title VARCHAR(200),
    seo_description TEXT,
    seo_keywords VARCHAR(500),
    status ENUM('active', 'inactive') DEFAULT 'active',
    product_created_at TIMESTAMP,
    product_updated_at TIMESTAMP,
    sku VARCHAR(100) NOT NULL UNIQUE,
    price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    tax_percentage DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    weight DECIMAL(8,2),
    width DECIMAL(8,2),
    height DECIMAL(8,2),
    depth DECIMAL(8,2),
    warranty_months INT DEFAULT NULL ,
    is_available BOOLEAN DEFAULT TRUE,
    is_featured BOOLEAN DEFAULT TRUE,
    is_front BOOLEAN DEFAULT TRUE,
    available_stock INT NOT NULL DEFAULT 0,
    product_created_at TIMESTAMP,
    product_updated_at TIMESTAMP
);



CREATE TABLE IF NOT EXISTS product_media (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    image_url VARCHAR(500) NOT NULL,
    image_url_id VARCHAR(255) NULL COMMENT 'Cloudinary public ID for deletion', -- Added here
    sort_order INT DEFAULT 0,
    status ENUM('active', 'inactive') DEFAULT 'active' NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE,
    
    INDEX idx_product_id (product_id),
    INDEX idx_sort_order (sort_order),
    INDEX idx_status (status)
);



-- =============================================
-- 10. CART table (supports both logged-in users and guests)
-- =============================================

CREATE TABLE IF NOT EXISTS cart (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    session_token VARCHAR(255) NULL,
    items JSON NOT NULL DEFAULT (JSON_ARRAY()),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_session_token (session_token),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);
-- =============================================
-- 11 product_reviews table (supports verified_purcahse a)
-- =============================================

CREATE TABLE IF NOT EXISTS product_reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,

    product_id INT NOT NULL,
    user_id INT NOT NULL,
    order_item_id INT DEFAULT NULL,

    rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review TEXT DEFAULT NULL,
    is_verified_purchase BOOLEAN DEFAULT FALSE,

    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_review_product
        FOREIGN KEY (product_id)
        REFERENCES product(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_review_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_review_order
        FOREIGN KEY (order_item_id)
        REFERENCES order_items(id)
        ON DELETE SET NULL,

    UNIQUE KEY unique_user_product_order (user_id, product_id, order_item_id),

    INDEX idx_product (product_id),
    INDEX idx_user (user_id),
    INDEX idx_status (status)
);

-- =============================================
-- 11 Website Revoiew table (supports any one)
-- =============================================
CREATE TABLE IF NOT EXISTS website_reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,


    rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review TEXT DEFAULT NULL,
    status ENUM('pending', 'approved', 'rejected')
        DEFAULT 'pending',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

   

    CONSTRAINT fk_service_review_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,



    
    INDEX idx_user (user_id),
    INDEX idx_status (status)
);

-- =============================================
-- 12 Website Revoiew table (supports any one)
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



CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    car_model VARCHAR(255),
    car_year YEAR,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);



CREATE TABLE IF NOT EXISTS shipping_costs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  state VARCHAR(100) NOT NULL UNIQUE,
  shipping_cost DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  estimated_delivery_days VARCHAR(50) DEFAULT NULL,
  status ENUM('active', 'inactive') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP
);
`;
