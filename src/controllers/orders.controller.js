import { pool } from "../config/db.js";
import { logAudit } from "../lib/auditLog.js";
import { sendOrderConfirmationEmail } from "../services/nodemailer.service.js";

// Helper to safely parse JSON (reuse from cart controller or define here)
const safeParseJSON = (jsonField) => {
  if (Array.isArray(jsonField)) return jsonField;
  if (jsonField && typeof jsonField === "object") return jsonField;
  if (typeof jsonField === "string") {
    if (!jsonField || jsonField === "") return [];
    try {
      const parsed = JSON.parse(jsonField);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("JSON parse error:", e.message);
      return [];
    }
  }
  return [];
};

// ========== Helper: get cart items from JSON column ==========
const getCartItems = async (cartId) => {
  // Fetch cart row with items JSON
  const [cartRows] = await pool.query("SELECT items FROM cart WHERE id = ?", [
    cartId,
  ]);
  if (cartRows.length === 0) return [];

  const itemsArray = safeParseJSON(cartRows[0].items);
  if (itemsArray.length === 0) return [];

  // Get product details for each item
  const productItemIds = itemsArray.map((item) => item.product_item_id);
  const placeholders = productItemIds.map(() => "?").join(",");
  const [productItems] = await pool.query(
    `SELECT pi.id as product_item_id, pi.sku, pi.price, p.name as product_name
     FROM product_items pi
     JOIN products p ON pi.product_id = p.id
     WHERE pi.id IN (${placeholders})`,
    productItemIds,
  );

  // Map product details back to cart items
  const productMap = new Map();
  productItems.forEach((pi) => productMap.set(pi.product_item_id, pi));

  const enrichedItems = [];
  for (const item of itemsArray) {
    const prod = productMap.get(item.product_item_id);
    if (prod) {
      enrichedItems.push({
        product_item_id: item.product_item_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        sku: prod.sku,
        price: prod.price,
        product_name: prod.product_name,
      });
    }
  }
  return enrichedItems;
};

// ========== CREATE order from cart ==========

export const createOrder = async (req, res) => {
  const {
    shipping_address_id,
    billing_address_id,
    customer_notes,
    shipping_cost = 0,
    tax_amount = 0,
    currency_code = "IND",
    coupon_code = null,
    payment_method,
  } = req.body;

  // Validation
  if (!shipping_address_id || !billing_address_id) {
    return res
      .status(400)
      .json({ success: false, message: "Addresses required" });
  }

  const allowedPaymentMethods = ["card", "upi", "bank_transfer", "cash"];
  if (!payment_method || !allowedPaymentMethods.includes(payment_method)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid or missing payment method" });
  }

  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ success: false, message: "Login required" });
  }

  // Find cart (existing logic – unchanged)
  const sessionToken = req.headers["x-session-token"] || null;
  let cartId = null;
  const [cartRows] = await pool.query("SELECT id FROM cart WHERE user_id = ?", [
    userId,
  ]);
  if (cartRows.length) cartId = cartRows[0].id;
  if (!cartId && sessionToken) {
    const [guestCart] = await pool.query(
      "SELECT id FROM cart WHERE session_token = ?",
      [sessionToken],
    );
    if (guestCart.length) cartId = guestCart[0].id;
  }
  if (!cartId) {
    return res.status(400).json({ success: false, message: "Cart not found" });
  }

  const items = await getCartItems(cartId);
  if (items.length === 0) {
    return res.status(400).json({ success: false, message: "Cart is empty" });
  }

  // Calculate subtotal
  let subtotal = 0;
  for (const item of items) {
    subtotal += item.quantity * item.unit_price;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Stock checks & reservation (unchanged)
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
    for (const item of items) {
      await connection.query(
        "UPDATE product_items SET available_stock = available_stock - ? WHERE id = ?",
        [item.quantity, item.product_item_id],
      );
      await connection.query(
        `INSERT INTO product_stock (product_item_id, quantity, reserved_quantity)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE reserved_quantity = reserved_quantity + ?`,
        [item.product_item_id, 0, item.quantity, item.quantity],
      );
    }

    // 2. Coupon validation (using your schema)
    let discount_amount = 0;
    let appliedCouponId = null;

    if (coupon_code) {
      // Fetch coupon details
      const [couponRows] = await connection.query(
        `SELECT * FROM coupons
         WHERE code = ? AND valid_from <= NOW() AND valid_to >= NOW()
         FOR UPDATE`,
        [coupon_code],
      );

      if (couponRows.length === 0) {
        await connection.rollback();
        return res
          .status(400)
          .json({ success: false, message: "Invalid or expired coupon" });
      }

      const coupon = couponRows[0];

      // Check minimum order amount
      console.log(subtotal);

      if (subtotal < coupon.min_order_amount) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Minimum order amount of ₹${coupon.min_order_amount} required for this coupon`,
        });
      }

      // Check per‑user usage limit
      if (coupon.usage_limit_per_user !== null) {
        const [userUsage] = await connection.query(
          `SELECT COUNT(*) as count FROM orders
           WHERE user_id = ? AND coupon_id = ?`,
          [userId, coupon.id],
        );
        if (userUsage[0].count >= coupon.usage_limit_per_user) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: `You have already used this coupon ${coupon.usage_limit_per_user} time(s)`,
          });
        }
      }

      // Check global total usage limit
      if (coupon.total_usage_limit !== null) {
        const [globalUsage] = await connection.query(
          `SELECT COUNT(*) as count FROM orders WHERE coupon_id = ?`,
          [coupon.id],
        );
        if (globalUsage[0].count >= coupon.total_usage_limit) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: "This coupon has reached its global usage limit",
          });
        }
      }

      // Calculate discount
      if (coupon.discount_type === "percentage") {
        discount_amount = (subtotal * coupon.discount_value) / 100;
        if (
          coupon.max_discount_amount &&
          discount_amount > coupon.max_discount_amount
        ) {
          discount_amount = coupon.max_discount_amount;
        }
      } else {
        // fixed amount
        discount_amount = Math.min(coupon.discount_value, subtotal);
      }

      appliedCouponId = coupon.id;
    }

    // 3. Calculate total
    const total_amount =
      subtotal + shipping_cost + tax_amount - discount_amount;

    // 4. Insert order (with coupon_id and payment_method)
    const [orderResult] = await connection.query(
      `INSERT INTO orders
         (user_id, shipping_address_id, billing_address_id, subtotal, shipping_cost,
          tax_amount, discount_amount, total_amount, currency_code, customer_notes,
          payment_status, payment_method, coupon_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
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
        payment_method,
        appliedCouponId,
      ],
    );
    const orderId = orderResult.insertId;

    // 5. Create order_items with snapshots (unchanged)
    for (const item of items) {
      const snapshot = {
        product_name: item.product_name,
        sku: item.sku,
        variation: null,
        unit_price_at_purchase: item.unit_price,
      };
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

    // 6. Clear cart
    await connection.query("UPDATE cart SET items = ? WHERE id = ?", [
      JSON.stringify([]),
      cartId,
    ]);

    // 7. Audit log
    const [newOrderRow] = await connection.query(
      "SELECT * FROM orders WHERE id = ?",
      [orderId],
    );
    await logAudit({
      userId: req.user.id,
      action: "CREATE_ORDER",
      tableName: "orders",
      recordId: orderId,
      oldData: null,
      newData: newOrderRow[0],
      req,
    });

    await connection.commit();

    // 8. Send email (unchanged, but include coupon info if needed)
    const [orderData] = await pool.query(
      `SELECT o.*, 
          u.full_name as customer_name,
          u.email as customer_email,
          sa.full_name as shipping_full_name,
          sa.phone as shipping_phone,
          sa.line1 as shipping_line1,
          sa.line2 as shipping_line2,
          sa.landmark as shipping_landmark,
          sa.city as shipping_city,
          sa.state as shipping_state,
          sa.postal_code as shipping_postal_code,
          ba.full_name as billing_full_name,
          ba.line1 as billing_line1,
          ba.city as billing_city,
          ba.state as billing_state,
          ba.postal_code as billing_postal_code
       FROM orders o
       JOIN users u ON o.user_id = u.id
       LEFT JOIN user_addresses sa ON o.shipping_address_id = sa.id
       LEFT JOIN user_addresses ba ON o.billing_address_id = ba.id
       WHERE o.id = ?`,
      [orderId],
    );

    const order = orderData[0];
    const shippingAddressString = `${order.shipping_line1 || ""} ${order.shipping_line2 || ""}\n${order.shipping_city || ""}, ${order.shipping_state || ""} ${order.shipping_postal_code || ""}`;

    const [orderItems] = await pool.query(
      `SELECT oi.product_item_id, oi.quantity, oi.unit_price, 
          JSON_UNQUOTE(JSON_EXTRACT(oi.product_data_snapshot, '$.product_name')) as product_name
       FROM order_items oi
       WHERE oi.order_id = ?`,
      [orderId],
    );

    const orderDetails = {
      order_id: order.id,
      order_date: order.order_date,
      order_status: order.order_status,
      customer_name: order.customer_name || "Valued Customer",
      subtotal: parseFloat(order.subtotal),
      shipping_cost: parseFloat(order.shipping_cost),
      tax_amount: parseFloat(order.tax_amount),
      discount_amount: parseFloat(order.discount_amount),
      total_amount: parseFloat(order.total_amount),
      currency_code: order.currency_code,
      customer_notes: order.customer_notes || "",
      shipping_address: shippingAddressString,
      items: orderItems.map((item) => ({
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: parseFloat(item.unit_price),
      })),
    };

    try {
      await sendOrderConfirmationEmail(order.customer_email, orderDetails);
    } catch (emailErr) {
      console.error("Email error:", emailErr);
    }

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
// The rest of your functions (getUserOrders, getOrderDetails, updateOrderStatus, getAllOrders) remain unchanged
// because they only touch orders/order_items, not the cart.

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
      "SELECT id, order_status FROM orders WHERE id = ?",
      [id],
    );
    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    const orderId = existing[0].id;

    // For Auditing
    // Before update: fetch current order data
    const [oldOrder] = await pool.query("SELECT * FROM orders WHERE id = ?", [
      orderId,
    ]);

    const oldStatus = existing[0].order_status;
    await pool.query(
      "UPDATE orders SET order_status = ?, admin_notes = ? WHERE id = ?",
      [order_status, admin_notes || null, id],
    );

    const [newOrder] = await pool.query("SELECT * FROM orders WHERE id = ?", [
      orderId,
    ]);

    // Log audit
    await logAudit({
      userId: req.user.id,
      action: "UPDATE",
      tableName: "orders",
      recordId: orderId,
      oldData: oldOrder[0],
      newData: newOrder[0],
      req,
    });

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
