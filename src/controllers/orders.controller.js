import { pool } from "../config/db.js";

// Helper: get cart contents (used when placing order)
const getCartItems = async (cartId) => {
  const [items] = await pool.query(
    `SELECT ci.product_item_id, ci.quantity, ci.unit_price,
                pi.sku, pi.price, p.name as product_name, 
                pv.variation_type, pi.variation_value
         FROM cart_items ci
         JOIN product_items pi ON ci.product_item_id = pi.id
         JOIN products p ON pi.product_id = p.id
         LEFT JOIN product_variations pv ON pi.variation_id = pv.id
         WHERE ci.cart_id = ?`,
    [cartId],
  );
  return items;
};

// Helper: build product snapshot JSON
const buildProductSnapshot = (item) => {
  return {
    product_name: item.product_name,
    sku: item.sku,
    variation: item.variation_type
      ? `${item.variation_type}: ${item.variation_value}`
      : null,
    unit_price_at_purchase: item.unit_price,
  };
};

// ========== CREATE order from cart ==========
export const createOrder = async (req, res) => {
  const {
    shipping_address_id,
    billing_address_id,
    customer_notes,
    shipping_cost = 0,
    tax_amount = 0,
    discount_amount = 0,
    currency_code = "IND",
  } = req.body;

  if (!shipping_address_id || !billing_address_id) {
    return res
      .status(400)
      .json({ success: false, message: "Addresses required" });
  }

  const userId = req.user?.id;
  if (!userId) {
    return res
      .status(401)
      .json({ success: false, message: "Login required to place order" });
  }

  // Get session token from header (for guest cart) – but user is logged in, so cart is tied to user_id
  const sessionToken = req.headers["x-session-token"] || null;
  console.log(sessionToken);
  
  let cartId = null;
  // Find cart for this user (priority: user_id, then session)
  const [cartRows] = await pool.query("SELECT id FROM cart WHERE user_id = ?", [
    userId,
  ]);
  console.log(cartRows);

  if (cartRows.length) cartId = cartRows[0].id;
  if (!cartId && sessionToken) {
    const [guestCart] = await pool.query(
      "SELECT id FROM cart WHERE session_token = ?",
      [sessionToken],
    );
    if (guestCart.length) cartId = guestCart[0].id;
  }
  if (!cartId) {
    return res.status(400).json({ success: false, message: "Cart is empty" });
  }

  const items = await getCartItems(cartId);
  console.log(items);
  if (items.length === 0) {
    return res.status(400).json({ success: false, message: "Cart is empty" });
  }

  // Calculate subtotal and total
  let subtotal = 0;
  for (const item of items) {
    subtotal += item.quantity * item.unit_price;
  }
  const total_amount = subtotal + shipping_cost + tax_amount - discount_amount;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Check stock availability for all items
    for (const item of items) {
      const [stockRow] = await connection.query(
        "SELECT available_stock FROM product_items WHERE id = ? FOR UPDATE",
        [item.product_item_id],
      );
      if (stockRow[0].available_stock < item.quantity) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${item.product_name}`,
        });
      }
    }

    // 2. Reserve stock (reduce available_stock)
    for (const item of items) {
      await connection.query(
        "UPDATE product_items SET available_stock = available_stock - ? WHERE id = ?",
        [item.quantity, item.product_item_id],
      );
      // Also record reservation in product_stock (optional, but keep for tracking)
      await connection.query(
        `INSERT INTO product_stock (product_item_id, quantity, reserved_quantity)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE reserved_quantity = reserved_quantity + ?`,
        [item.product_item_id, 0, item.quantity, item.quantity],
      );
    }

    // 3. Create order
    const [orderResult] = await connection.query(
      `INSERT INTO orders 
             (user_id, shipping_address_id, billing_address_id, subtotal, shipping_cost, 
              tax_amount, discount_amount, total_amount, currency_code, customer_notes, payment_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        userId,
        shipping_address_id,
        billing_address_id,
        subtotal,
        shipping_cost,
        tax_amount,
        discount_amount,
        total_amount,
        currency_code,
        customer_notes,
      ],
    );
    const orderId = orderResult.insertId;

    // 4. Create order_items with snapshots
    for (const item of items) {
      const snapshot = buildProductSnapshot(item);
      await connection.query(
        `INSERT INTO order_items 
                 (order_id, product_item_id, quantity, unit_price, product_data_snapshot)
                 VALUES (?, ?, ?, ?, ?)`,
        [
          orderId,
          item.product_item_id,
          item.quantity,
          item.unit_price,
          JSON.stringify(snapshot),
        ],
      );
    }

    // 5. Clear cart
    await connection.query("DELETE FROM cart_items WHERE cart_id = ?", [
      cartId,
    ]);

    await connection.commit();
    res
      .status(201)
      .json({ success: true, data: { order_id: orderId, total_amount } });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ success: false, message: "Order creation failed" });
  } finally {
    connection.release();
  }
};

// ========== GET all orders for logged-in user ==========
export const getUserOrders = async (req, res) => {
  const userId = req.user.id;
  try {
    const [orders] = await pool.query(
      `SELECT id, order_status, order_date, total_amount, payment_status
             FROM orders
             WHERE user_id = ?
             ORDER BY order_date DESC`,
      [userId],
    );
    res.json({ success: true, data: orders });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ========== GET single order with items ==========
export const getOrderDetails = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  console.log(userId);

  try {
    const [orderRows] = await pool.query(
      `SELECT * FROM orders WHERE id = ? AND user_id = ?`,
      [id, userId],
    );
    if (orderRows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }
    const [items] = await pool.query(
      `SELECT id, product_item_id, quantity, unit_price, total_price, product_data_snapshot
             FROM order_items WHERE order_id = ?`,
      [id],
    );
    res.json({ success: true, data: { ...orderRows[0], items } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ========== ADMIN: update order status ==========
export const updateOrderStatus = async (req, res) => {
  const { id } = req.params;
  const { order_status, admin_notes } = req.body;
  const allowedStatuses = [
    "pending",
    "confirmed",
    "processing",
    "shipped",
    "delivered",
    "cancelled",
    "refunded",
  ];
  if (!allowedStatuses.includes(order_status)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid order status" });
  }
  try {
    const [existing] = await pool.query(
      "SELECT order_status FROM orders WHERE id = ?",
      [id],
    );
    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }
    const oldStatus = existing[0].order_status;
    await pool.query(
      "UPDATE orders SET order_status = ?, admin_notes = ? WHERE id = ?",
      [order_status, admin_notes || null, id],
    );
    // If cancelling, restore stock
    if (order_status === "cancelled" && oldStatus !== "cancelled") {
      // Restore available_stock for each order item
      const [items] = await pool.query(
        "SELECT product_item_id, quantity FROM order_items WHERE order_id = ?",
        [id],
      );
      for (const item of items) {
        await pool.query(
          "UPDATE product_items SET available_stock = available_stock + ? WHERE id = ?",
          [item.quantity, item.product_item_id],
        );
        // Also reduce reserved_quantity in product_stock
        await pool.query(
          `UPDATE product_stock SET reserved_quantity = GREATEST(reserved_quantity - ?, 0)
                     WHERE product_item_id = ?`,
          [item.quantity, item.product_item_id],
        );
      }
    }
    res.json({ success: true, message: "Order status updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ========== ADMIN: get all orders (with pagination & filters) ==========
export const getAllOrders = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  const status = req.query.status;
  let whereClause = "";
  let params = [];
  if (
    status &&
    [
      "pending",
      "confirmed",
      "processing",
      "shipped",
      "delivered",
      "cancelled",
      "refunded",
    ].includes(status)
  ) {
    whereClause = "WHERE order_status = ?";
    params.push(status);
  }
  try {
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM orders ${whereClause}`,
      params,
    );
    const total = countResult[0].total;
    const [rows] = await pool.query(
      `SELECT o.*, u.full_name as customer_name
             FROM orders o
             LEFT JOIN users u ON o.user_id = u.id
             ${whereClause}
             ORDER BY o.order_date DESC
             LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    res.json({
      success: true,
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
