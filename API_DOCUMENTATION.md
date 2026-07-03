# API Documentation — Ecommerce Backend

**Base URL:** `http://<host>:<port>/api`

**Auth:** Most routes require a JWT token sent via `Authorization: Bearer <token>` header or `httpOnly` cookie named `token`.

**Roles:** `Admin`, `Staff`, `Customer`

---

## 1. Auth (`/api/auth`)

### POST `/api/auth/register`
- **Input:** `multipart/form-data`
  - `full_name`, `email`, `phone`, `password` (required)
  - `profile_image` (optional, file)
- **Response:** `201` - `{ success, message, otp, data }`

### POST `/api/auth/login`
- **Input:** `application/json` - `{ email, password }`
- **Response:** `200` - `{ success, message, token, user }`

### POST `/api/auth/logout`
- **Auth:** Required
- **Input:** None
- **Response:** `200` - `{ success, message }`

### POST `/api/auth/verify-otp`
- **Input:** `application/json` - `{ phone, otp }`
- **Response:** `200` - `{ success, message }`

### POST `/api/auth/resend`
- **Input:** `application/json` - `{ email }`
- **Response:** `201` - `{ success, message, data }`

### POST `/api/auth/forget-password`
- **Input:** `application/json` - `{ email, otp, password, confirmPassword }`
- **Response:** `201` - `{ success, message, data }`

### PATCH `/api/auth/update-profile-image`
- **Auth:** Required
- **Input:** `multipart/form-data` - `profile_image` (file)
- **Response:** `200` - `{ success, message, data }`

### GET `/api/auth/me`
- **Auth:** Required
- **Response:** `200` - `{ id, role, profile_image, phone, full_name, email, ... }`

---

## 2. Users (`/api/users`)

### GET `/api/users/get-users`
- **Auth:** Admin
- **Query:** `page`, `limit`, `search`, `status` (active/inactive), `role`
- **Response:** `{ success, data, pagination }`

### GET `/api/users/me`
- **Auth:** Admin/Staff/Customer
- **Response:** `{ success, data }`

### POST `/api/users/create-user`
- **Auth:** Admin
- **Input:** `multipart/form-data` - `full_name`, `email`, `phone`, `password`, `role` (optional), `profile_image` (optional, file)
- **Response:** `201` - `{ success, message, data }`

### PUT `/api/users/update-profile`
- **Auth:** Admin/Staff/Customer
- **Input:** `multipart/form-data` - `full_name` (optional), `profile_image` (optional, file)
- **Response:** `200` - `{ success, message, data }`

### POST `/api/users/change-password`
- **Auth:** Admin/Staff/Customer
- **Input:** `application/json` - `{ currentPassword, newPassword, confirmPassword }`
- **Response:** `200` - `{ success, message }`

### PATCH `/api/users/deactivate-user/:id`
- **Auth:** Admin
- **Input:** None
- **Response:** `200` - `{ success, message }`

### PUT `/api/users/:id`
- **Auth:** Admin/Staff/Customer
- **Input:** `multipart/form-data` - any updatable fields (`role`, `full_name`, `phone`, `email`, `password`, etc.)
- **Response:** `{ success, message }`

### DELETE `/api/users/:id`
- **Auth:** None
- **Response:** `{ success, message }`

---

## 3. Categories (`/api/categories`)

### GET `/api/categories/get_all_categories`
- **Query:** `page`, `limit`, `status`, `is_front`, `search`
- **Response:** `{ success, data, pagination }`

### GET `/api/categories/get_category_by_id/:id`
- **Auth:** Required
- **Query:** `status`
- **Response:** `{ success, data }`

### POST `/api/categories/create_category`
- **Auth:** Admin/Staff
- **Input:** `multipart/form-data`
  - `name` (required), `description`, `status`, `is_front`, `image_url` (file)
- **Response:** `201` - `{ success, data }`

### PUT `/api/categories/update_category/:id`
- **Auth:** Admin/Staff
- **Input:** `multipart/form-data` - `name`, `description`, `status`, `is_front`, `image_url` (file)
- **Response:** `{ success, data }`

### PATCH `/api/categories/toggle_status/:id`
- **Auth:** Admin
- **Response:** `{ success, message, data }`

### DELETE `/api/categories/delete_category/:id`
- **Auth:** Admin
- **Response:** `{ success, message }`

### DELETE `/api/categories/image/:id`
- **Auth:** Admin
- **Response:** `{ success, message, data }`

---

## 4. Sub Categories (`/api/sub-categories`)

### GET `/api/sub-categories/get_all_subcategories`
- **Query:** `page`, `limit`, `status`, `category_id`, `search`
- **Response:** `{ success, data, pagination }`

### GET `/api/sub-categories/get_subcategory_by_id/:id`
- **Auth:** Required
- **Query:** `status`
- **Response:** `{ success, data }`

### POST `/api/sub-categories/create_subcategory`
- **Auth:** Admin/Staff
- **Input:** `multipart/form-data` - `category_id`, `name`, `description`, `status`, `is_front`, `image_url` (file)
- **Response:** `201` - `{ success, data }`

### PUT `/api/sub-categories/update_subcategory/:id`
- **Auth:** Admin/Staff
- **Input:** `multipart/form-data` - `category_id`, `name`, `description`, `status`, `is_front`, `image_url` (file)
- **Response:** `{ success, data }`

### PATCH `/api/sub-categories/toggle_status/:id`
- **Auth:** Admin
- **Response:** `{ success, message, data }`

### DELETE `/api/sub-categories/delete_subcategory/:id`
- **Auth:** Admin/Staff
- **Response:** `{ success, message }`

### DELETE `/api/sub-categories/image/:id`
- **Auth:** Admin
- **Response:** `{ success, message, data }`

---

## 5. Brands (`/api/brands`)

### GET `/api/brands/get_all_brands`
- **Query:** `page`, `limit`, `search`, `status`
- **Response:** `{ success, data, pagination }`

### GET `/api/brands/get_brand_by_id/:id`
- **Auth:** Required
- **Query:** `status`
- **Response:** `{ success, data }`

### POST `/api/brands/create_brand`
- **Auth:** Admin
- **Input:** `multipart/form-data` - `name`, `website`, `status`, `logo_url` (file)
- **Response:** `201` - `{ success, data }`

### PUT `/api/brands/update_brand/:id`
- **Auth:** Admin
- **Input:** `multipart/form-data` - `name`, `website`, `status`, `logo_url` (file)
- **Response:** `{ success, data }`

### DELETE `/api/brands/delete_brand/:id`
- **Auth:** Admin
- **Response:** `{ success, message }`

---

## 6. Products (`/api/products`)

### GET `/api/products/get_all_products`
- **Query:** `page`, `limit`, `search`, `category_id`, `brand_id`, `status`, `is_featured`, `is_front`, `sort`
- **Response:** `{ success, data (with media), pagination }`

### GET `/api/products/get_all_vehicle_products`
- **Query:** `make_id`, `model_id`, `generation_id`, `compatibility_id`, `page`, `per_page`
- **Response:** `{ data, pagination }`

### GET `/api/products/get_product_by_id/:identifier`
- `:identifier` can be numeric (id) or slug (string)
- **Response:** `{ success, data (with media, compatibility) }`

### POST `/api/products/create_product`
- **Auth:** Admin
- **Input:** `multipart/form-data`
  - `name`, `sku`, `category_id`, `sub_category_id` (required)
  - `brand_id`, `short_description`, `long_description`, `seo_title`, `seo_description`, `seo_keywords`
  - `price`, `weight`, `width`, `height`, `depth`
  - `is_available`, `is_featured`, `is_front`, `available_stock`, `status`, `warranty_months`
  - `vehicle_generation_ids` (JSON array string)
  - `product_media` (multiple files, field name)
- **Response:** `201` - `{ success, data }`

### PUT `/api/products/update_product/:id`
- **Auth:** Admin
- **Input:** `multipart/form-data` - same fields as create, `product_media` (files)
- **Response:** `{ success, data }`

### PATCH `/api/products/toggle_status/:id`
- **Auth:** Admin
- **Response:** `{ success, message, status }`

### DELETE `/api/products/delete_product/:id`
- **Auth:** Admin
- **Response:** `{ success, message, deletedCloudinaryIds }`

---

## 7. Product Images (`/api/products/:productId/images`)

### GET `/api/products/:productId/images`
- **Query:** `status` (active/inactive/all)
- **Response:** `{ success, data }`

### POST `/api/products/:productId/images`
- **Auth:** Admin/Staff
- **Input:** `multipart/form-data` - `product_images` (multiple files)
- **Response:** `201` - `{ success, data }`

### PATCH `/api/products/:productId/images/reorder`
- **Auth:** Admin/Staff
- **Input:** `application/json` - `{ orderedIds: [1, 2, 3, ...] }`
- **Response:** `{ success, data }`

### PATCH `/api/products/images/:imageId/toggle-status`
- **Auth:** None
- **Response:** `{ success, message, data }`

### DELETE `/api/products/images/:imageId`
- **Auth:** Admin/Staff
- **Response:** `{ success, message }`

---

## 8. Product Stock (`/api/available-stocks`)

### GET `/api/available-stocks/items/:productItemId/stock`
- **Auth:** Admin/Staff
- **Query:** `location`
- **Response:** `{ success, data }`

### PUT `/api/available-stocks/items/:productItemId/stock`
- **Auth:** Admin/Staff
- **Input:** `application/json` - `{ quantity, reserved_quantity, backorder_allowed, threshold_quantity, last_restocked_at }`
- **Response:** `{ success, data }`

### PATCH `/api/available-stocks/items/:productItemId/stock/adjust`
- **Auth:** Admin/Staff
- **Input:** `application/json` - `{ quantity_change, reserved_change, backorder_allowed, threshold_quantity }`
- **Response:** `{ success, data }`

### DELETE `/api/available-stocks/stock/:stockId`
- **Auth:** Admin/Staff
- **Response:** `{ success, message }`

### GET `/api/available-stocks/items/:productItemId/stock/status`
- **Auth:** Admin/Staff
- **Response:** `{ success, data }` (includes `available_quantity`, `stock_status`, `alert_message`)

### PUT `/api/available-stocks/items/:productItemId/stock/threshold`
- **Auth:** Admin/Staff
- **Input:** `application/json` - `{ threshold_quantity }`
- **Response:** `{ success, message, data }`

### POST `/api/available-stocks/items/:productItemId/stock/backorder`
- **Auth:** Admin/Staff
- **Input:** `application/json` - `{ requested_quantity }`
- **Response:** `{ success, data: { can_backorder, reason, shortfall? } }`

### GET `/api/available-stocks/stock/reorder`
- **Auth:** Admin/Staff
- **Query:** `include_backorder_allowed` (true/false)
- **Response:** `{ success, count, data }`

---

## 9. Guest Token (`/api/guests/token`)

### POST `/api/guests/token`
- **Input:** None
- **Response:** `{ success, token }`

---

## 10. Cart (`/api/carts`)

All cart endpoints use `authenticateAndHandleGuests` middleware. If user is logged in, they are identified via JWT. If guest, send `x-session-token` header.

### GET `/api/carts`
- **Headers:** `x-session-token` (optional)
- **Query:** `page`, `limit`, `search`
- **Response:** `{ success, data (enriched items with product details), pagination }`

### POST `/api/carts/add`
- **Headers:** `x-session-token` (optional for guests)
- **Input:** `application/json` - `{ product_id, quantity }`
- **Response:** `{ success, message }`

### PUT `/api/carts/item/:productId`
- **Headers:** `x-session-token` (optional)
- **Input:** `application/json` - `{ quantity }`
- **Response:** `{ success, message }`

### DELETE `/api/carts/item/:productId`
- **Headers:** `x-session-token` (optional)
- **Response:** `{ success, message }`

### DELETE `/api/carts/clear`
- **Headers:** `x-session-token` (optional)
- **Response:** `{ success, message }`

---

## 11. Orders (`/api/orders`)

### POST `/api/orders/create`
- **Auth:** Required
- **Input:** `application/json` - `{ shipping_address_id, billing_address_id, coupon_code?, shipping_cost?, tax_amount? }`
- **Response:** `{ success, data: { razorpayOrderId, amount, currency, key } }`

### POST `/api/orders/verify-payment`
- **Auth:** Required
- **Input:** `application/json` - `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }`
- **Response:** `201` - `{ success, data: { order_id, total_amount, payment_id } }`

### GET `/api/orders/my-orders`
- **Auth:** Required
- **Response:** `{ success, data }`

### GET `/api/orders/my-orders/:id`
- **Auth:** Required
- **Response:** `{ success, data (with items) }`

### GET `/api/orders/admin/all`
- **Auth:** Admin
- **Query:** `page`, `limit`, `status`
- **Response:** `{ success, data (with customer, addresses, items), pagination }`

### PUT `/api/orders/admin/:id/status`
- **Auth:** Admin/Staff
- **Input:** `application/json` - `{ order_status, admin_notes? }`
- **Valid statuses:** pending, confirmed, processing, shipped, delivered, cancelled, refunded
- **Response:** `{ success, message }`

---

## 12. Coupons (`/api/coupons`)

### POST `/api/coupons/create-template`
- **Auth:** Admin
- **Input:** `application/json` - `{ code, discount_type, discount_value, valid_from, valid_to, min_order_amount?, max_discount_amount?, total_usage_limit?, description? }`
- **Response:** `201` - `{ success, data }`

### PUT `/api/coupons/update-template/:id`
- **Auth:** Admin
- **Input:** `application/json` - same fields as create
- **Response:** `{ success, message }`

### GET `/api/coupons/templates`
- **Auth:** Admin
- **Query:** `page`, `limit`, `search`, `status`
- **Response:** `{ success, data, pagination }`

### GET `/api/coupons/user-coupons/:userId`
- **Auth:** Admin
- **Response:** `{ success, data }`

### GET `/api/coupons/my-coupons`
- **Auth:** Required
- **Response:** `{ success, data (only active & valid coupons) }`

### POST `/api/coupons/apply`
- **Auth:** Required
- **Input:** `application/json` - `{ coupon_code, order_subtotal }`
- **Response:** `{ success, discount_amount, coupon_id, coupon_code, discount_type, discount_value }`

### PUT `/api/coupons/:id/status`
- **Auth:** Admin
- **Response:** `{ success, message, data }`

### DELETE `/api/coupons/delete-coupon/:id`
- **Auth:** Admin
- **Response:** `{ success, message }`

---

## 13. User Addresses (`/api/user-addresses`)

### GET `/api/user-addresses`
- **Auth:** Admin/Customer
- **Query:** `page`, `limit`, `search`, `type` (billing/shipping/returns), `status` (active/deleted/all)
- **Response:** `{ success, data, pagination }`

### GET `/api/user-addresses/:addressId`
- **Auth:** Admin/Customer (with ownership check)
- **Response:** `{ success, data }`

### POST `/api/user-addresses/create_address`
- **Auth:** Admin/Customer
- **Input:** `application/json` - `{ address_type, full_name, phone, line1, line2?, landmark?, city, state, postal_code, country?, is_default?, user_id? (admin only) }`
- **Response:** `201` - `{ success, data }`

### PUT `/api/user-addresses/update-address/:addressId`
- **Auth:** Admin/Customer (with ownership check)
- **Input:** `application/json` - any updatable fields
- **Response:** `{ success, data }`

### DELETE `/api/user-addresses/delete_address/:addressId`
- **Auth:** Admin/Customer (with ownership check)
- **Response:** `{ success, message, is_deleted }` (toggle soft delete)

### PUT `/api/user-addresses/default`
- **Auth:** Customer only
- **Input:** `application/json` - `{ address_id, address_type }`
- **Response:** `{ success, message }`

### GET `/api/user-addresses/order/:orderId/delivery-address`
- **Auth:** Delivery agent
- **Response:** `{ success, data }`

---

## 14. Returns (`/api/returns`)

### POST `/api/returns/request`
- **Auth:** Customer
- **Input:** `application/json` - `{ order_id, return_reason, items: [{ order_item_id, quantity_returned }] }`
- **Response:** `201` - `{ success, data: { return_id } }`

### GET `/api/returns/my-returns`
- **Auth:** Customer
- **Query:** `page`, `limit`
- **Response:** `{ success, data, pagination }`

### GET `/api/returns/my-returns/:id`
- **Auth:** Customer
- **Response:** `{ success, data (with items) }`

### GET `/api/returns/admin/all`
- **Auth:** Admin/Staff
- **Query:** `page`, `limit`, `search`, `return_status`, `order_id`
- **Response:** `{ success, data, pagination }`

### GET `/api/returns/admin/:id`
- **Auth:** Admin/Staff
- **Response:** `{ success, data }`

### PUT `/api/returns/admin/:id/status`
- **Auth:** Admin/Staff
- **Input:** `application/json` - `{ return_status, refund_estimated_date?, restocking_fees?: [{ order_item_id, restocking_fee }] }`
- **Valid statuses:** approved, rejected, received, refund_issued
- **Response:** `{ success, message }`

---

## 15. Warranty (`/api/warranty`)

### GET `/api/warranty/my-warranties`
- **Auth:** Customer
- **Response:** `{ success, data }` (items with warranty status)

### POST `/api/warranty/claim/:orderItemId`
- **Auth:** Customer
- **Input:** `application/json` - `{ claim_quantity }`
- **Response:** `{ success, message }`

### GET `/api/warranty/admin/show-claims`
- **Auth:** Admin/Staff
- **Query:** `page`, `limit`
- **Response:** `{ success, data, pagination }` (all items where `claimed_quantity > 0`)

---

## 16. Reviews (`/api/reviews`)

### POST `/api/reviews/add`
- **Auth:** Customer
- **Input:** `multipart/form-data` - `order_item_id`, `rating` (1-5), `review`, `review_images` (up to 5 files)
- **Response:** `201` - `{ success, message }`

### PUT `/api/reviews/update/:id`
- **Auth:** Customer
- **Input:** `multipart/form-data` - `rating`, `review`, `review_images` (files)
- **Response:** `{ success, message }`

### GET `/api/reviews/product/:productId`
- **Query:** `page`, `limit`
- **Response:** `{ success, data (approved only), pagination }`

### GET `/api/reviews/admin/all`
- **Auth:** Admin/Staff
- **Query:** `page`, `limit`, `status`, `search`
- **Response:** `{ success, data, pagination }`

### GET `/api/reviews/get_featured_reviews`
- **Query:** `page`, `limit`
- **Response:** `{ success, data, pagination }`

### PUT `/api/reviews/admin/:id/moderate`
- **Auth:** Admin/Staff
- **Input:** `application/json` - `{ status }` (approved/rejected/pending)
- **Response:** `{ success, message }`

### DELETE `/api/reviews/admin/:id/delete`
- **Auth:** Admin/Staff/Customer
- **Response:** `{ success, message }`

### DELETE `/api/reviews/admin/:id/delete_images`
- **Auth:** Admin/Staff/Customer
- **Input:** `application/json` - `{ public_ids: [...] }`
- **Response:** `{ success, message, data }`

### PATCH `/api/reviews/admin/:id/toggle_is_front`
- **Auth:** Admin/Staff/Customer
- **Response:** `{ success, message, data }`

---

## 17. Website Reviews (`/api/website-reviews`)

### POST `/api/website-reviews/add`
- **Auth:** Customer
- **Input:** `application/json` - `{ rating, review }`
- **Response:** `201` - `{ success, message, reviewId }`

### GET `/api/website-reviews`
- **Query:** `page`, `limit`
- **Response:** `{ success, data (approved only), pagination }`

### GET `/api/website-reviews/admin/all`
- **Auth:** Admin/Staff
- **Query:** `page`, `limit`, `status`, `search`
- **Response:** `{ success, data, pagination }`

### PATCH `/api/website-reviews/admin/moderate/:id`
- **Auth:** Admin/Staff
- **Input:** `application/json` - `{ status }` (approved/rejected/pending)
- **Response:** `{ success, message }`

### DELETE `/api/website-reviews/delete/:id`
- **Auth:** Customer/Admin/Staff
- **Response:** `{ success, message }`

---

## 18. Vehicle Makes (`/api/vehicle-makes`)

### GET `/api/vehicle-makes/get_all_makes`
- **Query:** `page`, `limit`, `search`, `status`
- **Response:** `{ success, data, pagination }`

### GET `/api/vehicle-makes/get_make_by_id/:id`
- **Response:** `{ success, data }`

### POST `/api/vehicle-makes/create_make`
- **Auth:** Admin
- **Input:** `multipart/form-data` - `name`, `country`, `logo_url` (file)
- **Response:** `201` - `{ success, data }`

### PUT `/api/vehicle-makes/update_make/:id`
- **Auth:** Admin
- **Input:** `multipart/form-data` - `name`, `country`, `status`, `logo_url` (file)
- **Response:** `{ success, data }`

### DELETE `/api/vehicle-makes/delete_make/:id`
- **Auth:** Admin
- **Response:** `{ success, message }`

---

## 19. Vehicle Models (`/api/vehicle-models`)

### GET `/api/vehicle-models/get_all_models`
- **Query:** `page`, `limit`, `search`, `make_id`, `status`
- **Response:** `{ success, data (with make_name), pagination }`

### GET `/api/vehicle-models/get_model_by_id/:id`
- **Response:** `{ success, data }`

### POST `/api/vehicle-models/create_model`
- **Auth:** Admin
- **Input:** `multipart/form-data` - `make_id`, `name`, `description`, `status`, `model_image_url` (file)
- **Response:** `201` - `{ success, data }`

### PUT `/api/vehicle-models/update_model/:id`
- **Auth:** Admin
- **Input:** `multipart/form-data` - `make_id`, `name`, `description`, `status`, `model_image_url` (file)
- **Response:** `{ success, data }`

### DELETE `/api/vehicle-models/delete_model/:id`
- **Auth:** Admin
- **Response:** `{ success, message }`

---

## 20. Vehicle Generations (`/api/vehicle-generations`)

### GET `/api/vehicle-generations/get_all_generations`
- **Query:** `page`, `limit`, `model_id`, `year`, `status`, `search`
- **Response:** `{ success, data (with model_name, make_name), pagination }`

### GET `/api/vehicle-generations/get_all_available_generation/:productId`
- **Response:** `{ success, data }` (generations NOT already compatible with this product)

### GET `/api/vehicle-generations/get_generation_by_id/:id`
- **Response:** `{ success, data }`

### POST `/api/vehicle-generations/create_generation`
- **Auth:** Admin
- **Input:** `application/json` - `{ model_id, generation_name?, year_from, year_to?, engine_options?, status? }`
- **Response:** `201` - `{ success, data }`

### PUT `/api/vehicle-generations/update_generation/:id`
- **Auth:** Admin
- **Input:** `application/json` - any updatable fields
- **Response:** `{ success, data }`

### DELETE `/api/vehicle-generations/delete_generation/:id`
- **Auth:** Admin
- **Response:** `{ success, message }`

---

## 21. Vehicle Compatibility (`/api/vehicle-compatibility`)

### GET `/api/vehicle-compatibility/product/:productId`
- **Response:** `{ success, data }` (compatibility records with generation/model/make details)

### GET `/api/vehicle-compatibility/vehicle/:generationId/products`
- **Query:** `page`, `limit`
- **Response:** `{ success, data, pagination }`

### POST `/api/vehicle-compatibility/product/:productId`
- **Auth:** Admin
- **Input:** `application/json` - `{ vehicle_generation_ids: [...], compatibility_notes? }`
- **Response:** `201` - `{ success, data }`

### PUT `/api/vehicle-compatibility/product/:productId`
- **Auth:** Admin
- **Input:** `application/json` - `{ vehicle_generation_ids: [...], compatibility_notes? }`
- **Response:** `{ success, data }`

### DELETE `/api/vehicle-compatibility/:id`
- **Auth:** Admin
- **Response:** `{ success, message }`

---

## 22. Shipments (`/api/shipments`)

### POST `/api/shipments`
- **Auth:** Admin/Staff
- **Input:** `application/json` - `{ order_id, carrier?, recipient_address?, current_status? }`
- **Response:** `201` - `{ id, message }`

### GET `/api/shipments`
- **Auth:** Admin/Staff
- **Query:** `page`, `limit`, `search`, `status`, `carrier`
- **Response:** `{ success, data, pagination }`

### GET `/api/shipments/:id`
- **Auth:** Admin/Staff
- **Response:** shipment with order, customer, address & item details

### PUT `/api/shipments/:id`
- **Auth:** Admin/Staff
- **Input:** `application/json` - `{ carrier?, recipient_address?, status? }`
- **Response:** `{ message }`

### PATCH `/api/shipments/:id/status`
- **Auth:** Admin/Staff
- **Input:** `application/json` - `{ status }`
- **Valid statuses:** pending, assigned, picked_up, in_transit, out_for_delivery, delivered, failed, returned, cancelled
- **Response:** `{ success, message }`

### POST `/api/shipments/:id/tracking`
- **Auth:** Admin/Staff
- **Input:** `application/json` - `{ event: { location?, description?, scan_time? } }`
- **Response:** `{ message }`

### DELETE `/api/shipments/:id`
- **Auth:** Admin/Staff
- **Response:** `{ message }`

---

## 23. Transactions (`/api/transactions`)

### GET `/api/transactions`
- **Auth:** Admin/Staff/Customer
- **Query:** `page`, `limit`, `search`, `order_id`, `transaction_type`, `status`
- **Response:** `{ success, data, pagination }`

### GET `/api/transactions/:id`
- **Auth:** Admin/Staff/Customer (customer must own the order)
- **Response:** `{ success, data }`

### POST `/api/transactions`
- **Auth:** Admin/Staff
- **Input:** `application/json` - `{ order_id, payment_method, transaction_type, amount, currency_code?, gateway_reference_id?, status?, error_message? }`
- **Response:** `201` - `{ success, data }`

### PATCH `/api/transactions/:id/status`
- **Auth:** Admin/Staff
- **Input:** `application/json` - `{ status, gateway_reference_id?, error_message? }`
- **Response:** `{ success, message }`

---

## 24. Audit Logs (`/api/audit-logs`)

### GET `/api/audit-logs`
- **Auth:** Admin
- **Query:** `page`, `limit`, `table_name`, `record_id`, `user_id`, `action`, `search`
- **Response:** `{ success, data (with user info), pagination }`

### GET `/api/audit-logs/audit-logs/actions`
- **Response:** `{ success, data: ["ACTION1", "ACTION2", ...] }` (distinct action list)

### GET `/api/audit-logs/:table_name/:record_id`
- **Auth:** Admin
- **Response:** `{ success, data }`

---

## Middleware Explanation

- **`verifyToken`** (`auth.middleware.js`): Checks `Authorization: Bearer <token>` header or `token` cookie. Verifies JWT, checks user exists & not deactivated & OTP verified. Attaches `req.user`.
- **`authorize(...roles)`** (`authorize.middleware.js`): Checks `req.user.role` against allowed roles.
- **`authenticateAndHandleGuests`** (`authorize.middleware.js`): Tries to decode JWT but does not fail if missing — used for guest cart.
- **`checkAddressOwnership`** (`authorize.middleware.js`): Ensures Customer can only access their own addresses; Admin can access any.
- **`upload`** (`multer.middleware.js`): Multer with Cloudinary storage. Accepts `.jpg`, `.jpeg`, `.png` up to 50MB. Field names vary per endpoint.

---

## Common Response Format

Success:
```json
{ "success": true, "data": {...} }
```

Error:
```json
{ "success": false, "message": "error description" }
```

Paginated:
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "totalPages": 10
  }
}
```
