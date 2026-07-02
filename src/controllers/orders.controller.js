import { pool } from "../config/db.js";
import { logAudit } from "../lib/auditLog.js";
import { sendOrderConfirmationEmail } from "../services/nodemailer.service.js";
import razorpayInstance from "../config/razorpay.js";

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
  // 1. Fetch the cart's JSON items
  const [cartRows] = await pool.query("SELECT items FROM cart WHERE id = ?", [
    cartId,
  ]);
  if (cartRows.length === 0) return [];

  const itemsArray = safeParseJSON(cartRows[0].items);
  if (itemsArray.length === 0) return [];

  // 2. Extract product IDs from the cart items
  const productIds = itemsArray.map((item) => item.product_id);
  const placeholders = productIds.map(() => "?").join(",");

  // 3. Query current product data + primary image (from product_media)
  const [products] = await pool.query(
    `
    SELECT 
      p.id AS product_id,
      p.sku,
      p.price,
      p.name AS product_name,
      (
        SELECT image_url 
        FROM product_media 
        WHERE product_id = p.id 
          AND status = 'active' 
        ORDER BY sort_order ASC, id ASC 
        LIMIT 1
      ) AS primary_image
    FROM product p
    WHERE p.id IN (${placeholders})
    `,
    productIds,
  );

  // 4. Build a map for quick lookup
  const productMap = new Map();
  products.forEach((prod) => productMap.set(prod.product_id, prod));

  // 5. Enrich each cart item with current product data (skip if product missing)
  const enrichedItems = [];
  for (const item of itemsArray) {
    const prod = productMap.get(item.product_id);
    if (prod) {
      enrichedItems.push({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price, // snapshot price at add time
        sku: prod.sku,
        price: prod.price, // current live price
        product_name: prod.product_name,
        primary_image: prod.primary_image, // current primary image
      });
    }
    // If product is not found, you could still include the item with null values
    // but we follow the original behaviour: skip missing products.
  }

  return enrichedItems;
};

export const validateCoupon = async (db, couponCode, subtotal, userId) => {
  const now = new Date();

  // Fetch coupon
  const [couponRows] = await db.query(
    `
  SELECT *,
         NOW() AS mysql_now,
         valid_from <= NOW() AS from_ok,
         valid_to >= NOW() AS to_ok,
         code = ? AS code_ok
  FROM coupons
  WHERE code = ?
  `,
    [couponCode, couponCode],
  );

  if (couponRows.length === 0) {
    const err = new Error("Invalid or expired coupon");
    err.status = 400;
    throw err;
  }
  const coupon = couponRows[0];

  // Minimum order amount check
  if (subtotal < Number(coupon.min_order_amount)) {
    const err = new Error(
      `Minimum order amount is ₹${coupon.min_order_amount}`,
    );
    err.status = 400;
    throw err;
  }

  // Global usage limit
  if (coupon.total_usage_limit !== null) {
    const [[usage]] = await db.query(
      `
      SELECT COUNT(*) AS total
      FROM coupons
      WHERE id = ?
      `,
      [coupon.id],
    );

    if (usage.total >= coupon.total_usage_limit) {
      const err = new Error("Coupon usage limit reached.");
      err.status = 400;
      throw err;
    }
  }

  // Global usage
  const [[usage]] = await db.query(
    `
  SELECT COUNT(*) AS total
  FROM orders
  WHERE coupon_id = ?
  `,
    [coupon.id],
  );

  // User usage
  const [[userUsage]] = await db.query(
    `
  SELECT COUNT(*) AS total
  FROM orders
  WHERE coupon_id = ?
    AND user_id = ?
    AND payment_status = 'paid'
  `,
    [coupon.id, userId],
  );

  if (userUsage.total >= coupon.usage_limit_per_user) {
    throw new Error("You have already used this coupon");
  }
  // Calculate discount
  let discount_amount = 0;

  if (coupon.discount_type === "percentage") {
    discount_amount = (subtotal * Number(coupon.discount_value)) / 100;

    if (
      coupon.max_discount_amount !== null &&
      discount_amount > Number(coupon.max_discount_amount)
    ) {
      discount_amount = Number(coupon.max_discount_amount);
    }
  } else {
    discount_amount = Number(coupon.discount_value);
  }

  // Discount cannot exceed subtotal
  discount_amount = Math.min(discount_amount, subtotal);

  return {
    appliedCouponId: coupon.id,
    coupon_code: coupon.code,
    discount_amount: Number(discount_amount.toFixed(2)),
    coupon,
  };
};

// ========== CREATING order from cart ==========

// =============================================================
// STEP 1 — Initiate: validate cart + coupon, create Razorpay order
// =============================================================
// export const initiateRazorpayCheckout = async (req, res) => {
//   const userId = req.user?.id;
//   console.log("Initialize payment");
//   const connection = await pool.getConnection();
//   if (!userId) {
//     return res.status(401).json({ success: false, message: "Unauthorized" });
//   }

//   const {
//     shipping_address_id,
//     billing_address_id,
//     coupon_code = null,
//   } = req.body;

//   if (!shipping_address_id || !billing_address_id) {
//     return res.status(400).json({
//       success: false,
//       message: "Shipping and Billing addresses are required",
//     });
//   }

//   // 1. Fetch cart
//   const [cartRows] = await pool.query("SELECT id FROM cart WHERE user_id = ?", [
//     userId,
//   ]);
//   if (cartRows.length === 0) {
//     return res.status(400).json({ success: false, message: "Cart not found" });
//   }

//   const cartId = cartRows[0].id;
//   const items = await getCartItems(cartId);

//   if (items.length === 0) {
//     return res.status(400).json({ success: false, message: "Cart is empty" });
//   }

//   // 2. Calculate subtotal
//   let subtotal = 0;
//   for (const item of items) subtotal += item.quantity * item.unit_price;

//   // 3. Validate coupon (read-only — no transaction needed here)
//   let discount_amount = 0;
//   if (coupon_code) {
//     try {
//       // FOR UPDATE is fine on pool without a transaction; it locks for the
//       // duration of the single query which is all we need here.
//       ({ discount_amount } = await validateCoupon(
//         pool,
//         coupon_code,
//         subtotal,
//         userId,
//       ));
//     } catch (err) {
//       return res
//         .status(err.status || 400)
//         .json({ success: false, message: err.message });
//     }
//   }

//   // 4. Calculate total
//   const shipping_cost = parseFloat(req.body.shipping_cost) || 0;
//   const tax_amount = parseFloat(req.body.tax_amount) || 0;
//   const total_amount = subtotal + shipping_cost + tax_amount - discount_amount;

//   if (total_amount <= 0) {
//     return res
//       .status(400)
//       .json({ success: false, message: "Invalid total amount" });
//   }

//   try {
//     // 5. Create Razorpay order — store all checkout data in notes so the
//     //    verify step can reconstruct it without relying on session state.
//     const razorpayOrder = await razorpayInstance.orders.create({
//       amount: Math.round(total_amount * 100), // paise
//       currency: "INR",
//       receipt: `receipt_${Date.now()}`,
//       notes: {
//         user_id: String(userId),
//         cart_id: String(cartId),
//         shipping_address_id: String(shipping_address_id),
//         billing_address_id: String(billing_address_id),
//         coupon_code: coupon_code || "",
//         calculated_discount: String(discount_amount),
//         shipping_cost: String(shipping_cost),
//         tax_amount: String(tax_amount),
//         subtotal: String(subtotal),
//       },
//     });

//     return res.status(200).json({
//       success: true,
//       data: {
//         razorpayOrderId: razorpayOrder.id,
//         amount: razorpayOrder.amount,
//         currency: razorpayOrder.currency,
//         key: process.env.RAZORPAY_KEY_ID,
//       },
//     });
//   } catch (error) {
//     console.error("Razorpay Init Error:", error);
//     return res
//       .status(500)
//       .json({ success: false, message: "Failed to initiate payment" });
//   }
// };

export const initiateRazorpayCheckout = async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const {
      shipping_address_id,
      billing_address_id,
      coupon_code = null,
    } = req.body;

    if (!shipping_address_id || !billing_address_id) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Shipping and Billing addresses are required",
      });
    }

    // Fetch cart
    const [cartRows] = await connection.query(
      "SELECT id FROM cart WHERE user_id = ?",
      [userId],
    );

    if (cartRows.length === 0) {
      await connection.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Cart not found" });
    }

    const cartId = cartRows[0].id;
    const items = await getCartItems(cartId);

    if (items.length === 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Cart is empty" });
    }

    let subtotal = 0;
    for (const item of items) {
      subtotal += item.quantity * item.unit_price;
    }

    let discount_amount = 0;

    if (coupon_code) {
      ({ discount_amount } = await validateCoupon(
        connection,
        coupon_code,
        subtotal,
        userId,
      ));
    }

    const shipping_cost = parseFloat(req.body.shipping_cost) || 0;
    const tax_amount = parseFloat(req.body.tax_amount) || 0;

    const total_amount =
      subtotal + shipping_cost + tax_amount - discount_amount;

    if (total_amount <= 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid total amount",
      });
    }

    // Nothing is written to DB, so commit before Razorpay call
    await connection.commit();

    const razorpayOrder = await razorpayInstance.orders.create({
      amount: Math.round(total_amount * 100),
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
      notes: {
        user_id: String(userId),
        cart_id: String(cartId),
        shipping_address_id: String(shipping_address_id),
        billing_address_id: String(billing_address_id),
        coupon_code: coupon_code || "",
        calculated_discount: String(discount_amount),
        shipping_cost: String(shipping_cost),
        tax_amount: String(tax_amount),
        subtotal: String(subtotal),
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        razorpayOrderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        key: process.env.RAZORPAY_KEY_ID,
      },
    });
  } catch (err) {
    await connection.rollback();
    console.log(err);

    return res.status(err.status || 500).json({
      success: false,
      message: err.responsemessage || "Something went wrong",
    });
  } finally {
    connection.release();
  }
};
// =============================================================
// STEP 2 — Verify: confirm payment, deduct stock, create order
// =============================================================
import crypto from "crypto";
export const verifyRazorpayAndCreateOrder = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res
      .status(400)
      .json({ success: false, message: "Missing payment fields" });
  }

  // 1. Verify signature
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const generatedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (generatedSignature !== razorpay_signature) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid payment signature" });
  }

  // 2. Fetch the Razorpay order to retrieve the notes saved during initiation
  let razorpayOrder;
  try {
    razorpayOrder = await razorpayInstance.orders.fetch(razorpay_order_id);
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch Razorpay order" });
  }

  const notes = razorpayOrder.notes;
  const userId = parseInt(notes.user_id);
  const cartId = parseInt(notes.cart_id);
  const shipping_address_id = parseInt(notes.shipping_address_id);
  const billing_address_id = parseInt(notes.billing_address_id);
  const coupon_code = notes.coupon_code || null;
  const shipping_cost = parseFloat(notes.shipping_cost) || 0;
  const tax_amount = parseFloat(notes.tax_amount) || 0;

  // 3. Re-fetch cart items (always use latest DB prices — never trust client data)
  const items = await getCartItems(cartId);
  if (items.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "Cart is empty or already cleared" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // --- A) Stock checks (lock rows with FOR UPDATE) ---
    for (const item of items) {
      const [stockRow] = await connection.query(
        "SELECT available_stock FROM product WHERE id = ? FOR UPDATE",
        [item.product_id],
      );
      if (!stockRow.length || stockRow[0].available_stock < item.quantity) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${item.product_name}`,
        });
      }
    }

    // --- B) Deduct stock ---
    for (const item of items) {
      await connection.query(
        "UPDATE product SET available_stock = available_stock - ? WHERE id = ?",
        [item.quantity, item.product_id],
      );
      await connection.query(
        `INSERT INTO product_stock (product_id, quantity, reserved_quantity)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE reserved_quantity = reserved_quantity + ?`,
        [item.product_id, 0, item.quantity, item.quantity],
      );
    }

    // --- C) Re-validate coupon inside the transaction ---
    let subtotal = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
    let discount_amount = 0;
    let appliedCouponId = null;

    if (coupon_code) {
      try {
        ({ discount_amount, appliedCouponId } = await validateCoupon(
          connection,
          coupon_code,
          subtotal,
          userId,
        ));
      } catch (err) {
        await connection.rollback();
        return res
          .status(err.status || 400)
          .json({ success: false, message: err.message });
      }
    }

    // --- D) Final totals ---
    const total_amount =
      subtotal + shipping_cost + tax_amount - discount_amount;
    console.log(appliedCouponId, "applied#$%^&*()*&^%$#%^&*(");
    // --- E) Insert order ---
    const [orderResult] = await connection.query(
      `INSERT INTO orders
         (user_id, shipping_address_id, billing_address_id,
          subtotal, shipping_cost, tax_amount, discount_amount, total_amount,
          currency_code, payment_status, payment_method, coupon_id,
          razorpay_order_id, razorpay_payment_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INR', 'paid', 'razorpay', ?, ?, ?)`,
      [
        userId,
        shipping_address_id,
        billing_address_id,
        subtotal,
        shipping_cost,
        tax_amount,
        discount_amount,
        total_amount,
        appliedCouponId,
        razorpay_order_id,
        razorpay_payment_id,
      ],
    );
    const orderId = orderResult.insertId;

    // --- F) Insert order items (snapshot prices at time of purchase) ---
    for (const item of items) {
      const snapshot = {
        product_name: item.product_name,
        sku: item.sku,
        unit_price_at_purchase: item.unit_price,
      };
      await connection.query(
        `INSERT INTO order_items
           (order_id, product_id, quantity, unit_price, product_data_snapshot)
         VALUES (?, ?, ?, ?, ?)`,
        [
          orderId,
          item.product_id,
          item.quantity,
          item.unit_price,
          JSON.stringify(snapshot),
        ],
      );
    }

    // --- G) Insert transaction record ---
    await connection.query(
      `INSERT INTO transactions
         (order_id, payment_method, transaction_type, amount, currency_code,
          gateway_order_id, gateway_reference_id, status, gateway_response)
       VALUES (?, 'razorpay', 'payment', ?, 'INR', ?, ?, 'success', ?)`,
      [
        orderId,
        total_amount,
        razorpay_order_id,
        razorpay_payment_id,
        JSON.stringify({
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature,
        }),
      ],
    );

    // --- H) Create shipment row ---
    const [addressRows] = await connection.query(
      `SELECT full_name, phone, line1, line2, landmark, city, state, postal_code
       FROM user_addresses WHERE id = ?`,
      [shipping_address_id],
    );

    if (!addressRows.length) {
      await connection.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Shipping address not found" });
    }

    const addr = addressRows[0];
    const fullAddressString = [
      addr.full_name,
      addr.line1,
      addr.line2,
      addr.landmark,
      `${addr.city}, ${addr.state} - ${addr.postal_code}`,
      `Phone: ${addr.phone}`,
    ]
      .filter(Boolean)
      .join(", ");

    await connection.query(
      `INSERT INTO shipments (order_id, recipient_address, current_status)
       VALUES (?, ?, 'pending')`,
      [orderId, fullAddressString],
    );

    // --- I) Clear cart ---
    await connection.query("UPDATE cart SET items = ? WHERE id = ?", [
      JSON.stringify([]),
      cartId,
    ]);

    await connection.commit();

    // Respond before sending email
    res.status(201).json({
      success: true,
      data: {
        order_id: orderId,
        total_amount,
        payment_id: razorpay_payment_id,
      },
    });

    // Fire-and-forget confirmation email
    sendOrderConfirmationEmail({ orderId, userId, total_amount }).catch((err) =>
      console.error("Order email error:", err),
    );
  } catch (error) {
    await connection.rollback();
    console.error("Order Creation Error:", error);
    res.status(500).json({ success: false, message: "Order creation failed" });
  } finally {
    connection.release();
  }
};

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
      `SELECT id, product_id, quantity, unit_price, total_price, product_data_snapshot
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
    let updateQuery = `
  UPDATE orders
  SET order_status = ?, admin_notes = ?
`;
    const params = [order_status, admin_notes || null];

    if (order_status === "delivered" && oldStatus !== "delivered") {
      updateQuery += `, delivered_at = NOW()`;
    }

    updateQuery += ` WHERE id = ?`;
    params.push(id);

    await pool.query(updateQuery, params);

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
        "SELECT product_id, quantity FROM order_items WHERE order_id = ?",
        [id],
      );
      for (const item of items) {
        await pool.query(
          "UPDATE product_items SET available_stock = available_stock + ? WHERE id = ?",
          [item.quantity, item.product_id],
        );
        // Also reduce reserved_quantity in product_stock
        await pool.query(
          `UPDATE product_stock SET reserved_quantity = GREATEST(reserved_quantity - ?, 0)
                     WHERE product_id = ?`,
          [item.quantity, item.product_id],
        );
      }
    }
    res.json({ success: true, message: "Order status updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

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
    whereClause = "WHERE o.order_status = ?";
    params.push(status);
  }

  try {
    // Get total count
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM orders o ${whereClause}`,
      params,
    );
    const total = countResult[0].total;

    // Get orders with user and address details
    const [orders] = await pool.query(
      `SELECT 
        o.*,
        u.full_name as customer_name,
        u.email as customer_email,
        u.phone as customer_phone,
        u.profile_image as customer_profile_image,
        u.role as customer_role,
        -- Shipping Address
        sa.full_name as shipping_full_name,
        sa.phone as shipping_phone,
        sa.line1 as shipping_line1,
        sa.line2 as shipping_line2,
        sa.landmark as shipping_landmark,
        sa.city as shipping_city,
        sa.state as shipping_state,
        sa.postal_code as shipping_postal_code,
        sa.country as shipping_country,
        CONCAT_WS(', ',
          sa.line1,
          sa.line2,
          sa.landmark,
          sa.city,
          sa.state,
          sa.postal_code,
          sa.country
        ) as shipping_full_address,
        -- Billing Address
        ba.full_name as billing_full_name,
        ba.phone as billing_phone,
        ba.line1 as billing_line1,
        ba.line2 as billing_line2,
        ba.landmark as billing_landmark,
        ba.city as billing_city,
        ba.state as billing_state,
        ba.postal_code as billing_postal_code,
        ba.country as billing_country,
        CONCAT_WS(', ',
          ba.line1,
          ba.line2,
          ba.landmark,
          ba.city,
          ba.state,
          ba.postal_code,
          ba.country
        ) as billing_full_address
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN user_addresses sa ON o.shipping_address_id = sa.id
      LEFT JOIN user_addresses ba ON o.billing_address_id = ba.id
      ${whereClause}
      ORDER BY o.order_date DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    // Get order items for all orders
    const orderIds = orders.map((order) => order.id);
    let orderItemsMap = {};

    if (orderIds.length > 0) {
      // Get all order items with product details (now directly from product table)
      const [items] = await pool.query(
        `SELECT 
          oi.id,
          oi.order_id,
          oi.product_id,
          oi.quantity,
          oi.unit_price,
          oi.total_price,
          oi.product_data_snapshot as product_snapshot,
          p.name as product_name,
          p.slug as product_slug,
          p.status as product_status,
          p.sku as product_sku,
          p.price as current_price,
          p.weight,
          p.width,
          p.height,
          p.depth,
          p.is_available,
          p.available_stock
        FROM order_items oi
        LEFT JOIN product p ON oi.product_id = p.id
        WHERE oi.order_id IN (?)
        ORDER BY oi.order_id, oi.id`,
        [orderIds],
      );

      // Group items by order_id
      orderItemsMap = items.reduce((acc, item) => {
        if (!acc[item.order_id]) {
          acc[item.order_id] = [];
        }
        // Parse the JSON snapshot or use the individual fields
        let productSnapshot = item.product_snapshot;
        if (typeof productSnapshot === "string") {
          try {
            productSnapshot = JSON.parse(productSnapshot);
          } catch (e) {
            productSnapshot = {};
          }
        }

        acc[item.order_id].push({
          id: item.id,
          product_id: item.product_id, // renamed from product_item_id
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price,
          product: {
            id: item.product_id, // product id directly
            name: item.product_name || productSnapshot?.product_name,
            slug: item.product_slug,
            sku: item.product_sku || productSnapshot?.sku,
            // variation may be stored in snapshot, if needed:
            variation: productSnapshot?.variation || null,
            status: item.product_status,
            current_price: item.current_price,
            weight: item.weight,
            dimensions: {
              width: item.width,
              height: item.height,
              depth: item.depth,
            },
            is_available: item.is_available,
            available_stock: item.available_stock,
            snapshot: productSnapshot, // Keep the full snapshot for reference
          },
        });
        return acc;
      }, {});
    }

    // Combine orders with their items and calculate summary
    const ordersWithDetails = orders.map((order) => ({
      ...order,
      items: orderItemsMap[order.id] || [],
      item_count: orderItemsMap[order.id]?.length || 0,
      summary: {
        subtotal: order.subtotal,
        shipping_cost: order.shipping_cost,
        tax_amount: order.tax_amount,
        discount_amount: order.discount_amount,
        total_amount: order.total_amount,
        currency: order.currency_code,
      },
      customer: {
        id: order.user_id,
        name: order.customer_name,
        email: order.customer_email,
        phone: order.customer_phone,
        profile_image: order.customer_profile_image,
        role: order.customer_role,
      },
      shipping_address: {
        id: order.shipping_address_id,
        full_name: order.shipping_full_name,
        phone: order.shipping_phone,
        line1: order.shipping_line1,
        line2: order.shipping_line2,
        landmark: order.shipping_landmark,
        city: order.shipping_city,
        state: order.shipping_state,
        postal_code: order.shipping_postal_code,
        country: order.shipping_country,
        full_address: order.shipping_full_address,
      },
      billing_address: {
        id: order.billing_address_id,
        full_name: order.billing_full_name,
        phone: order.billing_phone,
        line1: order.billing_line1,
        line2: order.billing_line2,
        landmark: order.billing_landmark,
        city: order.billing_city,
        state: order.billing_state,
        postal_code: order.billing_postal_code,
        country: order.billing_country,
        full_address: order.billing_full_address,
      },
    }));

    res.json({
      success: true,
      data: ordersWithDetails,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
