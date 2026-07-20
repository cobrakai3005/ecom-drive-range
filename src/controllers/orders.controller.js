import { pool } from "../config/db.js";
import { logAudit } from "../lib/auditLog.js";
import {
  sendOrderConfirmationEmail,
  sendOrderStatusEmail,
} from "../services/nodemailer.service.js";
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
      p.tax_percentage,
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
        tax_percentage: prod.tax_percentage,
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

export const initiateRazorpayCheckout = async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const connection = await pool.getConnection();
  await connection.query("SET time_zone = '+05:30'");

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

    // Shipping Cost Calulation upcomming
    /*
    // Get The shipping Address for Shipping Cost
    const [[shippingAddress]] = await connection.query(
      `SELECT
          id,
          user_id,
          state
        FROM user_addresses
        WHERE id = ?
          AND user_id = ?
          AND is_deleted = 0
        LIMIT 1`,
      [shipping_address_id, userId],
    );

    if (!shippingAddress) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Shipping address not found",
      });
    }
    // Get Shipping Rate From State From above address
    const [[shippingRate]] = await connection.query(
      `SELECT
            id,
            state,
            shipping_cost,
            estimated_delivery_days
          FROM shipping_costs
          WHERE LOWER(REPLACE(TRIM(state), ' ', '')) =
                LOWER(REPLACE(TRIM(?), ' ', ''))
            AND status = 'active'
          LIMIT 1`,
      [shippingAddress.state],
    );

    if (!shippingRate) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: `Shipping is not available for ${shippingAddress.state}`,
      });
    }
    if (!shippingAddress) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Shipping address not found",
      });
    }
    // const shipping_cost = parseFloat(req.body.shipping_cost) || 0;
    const shipping_cost = Number(shippingRate.shipping_cost || 0);


    */

    const shipping_cost = parseFloat(req.body.shipping_cost) || 0;

    let tax_amount = 0;

    for (const item of items) {
      const itemSubtotal = item.quantity * item.unit_price;

      const itemDiscount =
        subtotal > 0 ? (itemSubtotal / subtotal) * discount_amount : 0;

      const taxableAmount = itemSubtotal - itemDiscount;

      const itemTax =
        (taxableAmount * (parseFloat(item.tax_percentage) || 0)) / 100;

      tax_amount += itemTax;
    }

    tax_amount = Number(tax_amount.toFixed(2));

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
        calculated_discount: String(discount_amount),
        shipping_cost: String(shipping_cost),
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

  // 3. Re-fetch cart items (always use latest DB prices — never trust client data)
  const items = await getCartItems(cartId);
  if (items.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "Cart is empty or already cleared" });
  }

  const connection = await pool.getConnection();
  await connection.query("SET time_zone = '+05:30'");

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
    let tax_amount = 0;

    for (const item of items) {
      const itemSubtotal = item.quantity * item.unit_price;

      // Proportional discount per item
      const itemDiscount =
        subtotal > 0 ? (itemSubtotal / subtotal) * discount_amount : 0;

      const taxableAmount = itemSubtotal - itemDiscount;

      const itemTax =
        (taxableAmount * (parseFloat(item.tax_percentage) || 0)) / 100;

      tax_amount += itemTax;
    }

    tax_amount = Number(tax_amount.toFixed(2));

    // --- D) Final totals ---
    const total_amount =
      subtotal + shipping_cost + tax_amount - discount_amount;
    const razorpayPaidAmount = Number((razorpayOrder.amount / 100).toFixed(2));
    const backendTotalAmount = Number(total_amount.toFixed(2));

    if (razorpayPaidAmount !== backendTotalAmount) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Payment amount mismatch",
        details: {
          paid: razorpayPaidAmount,
          expected: backendTotalAmount,
        },
      });
    }

    // console.log(appliedCouponId, "applied#$%^&*()*&^%$#%^&*(");
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
      const itemSubtotal = item.quantity * item.unit_price;

      const itemDiscount =
        subtotal > 0 ? (itemSubtotal / subtotal) * discount_amount : 0;

      const taxableAmount = itemSubtotal - itemDiscount;

      const itemTax = Number(
        (
          (taxableAmount * (parseFloat(item.tax_percentage) || 0)) /
          100
        ).toFixed(2),
      );

      const snapshot = {
        product_name: item.product_name,
        sku: item.sku,
        unit_price_at_purchase: item.unit_price,
        tax_percentage: item.tax_percentage,
        tax_amount: itemTax,
      };

      await connection.query(
        //     `INSERT INTO order_items
        //    (order_id, product_id, quantity, unit_price, total_price,
        //     tax_percentage, tax_amount, product_data_snapshot)
        //  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        `INSERT INTO order_items
 (order_id, product_id, quantity, unit_price,
  tax_percentage, tax_amount, product_data_snapshot)
 VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          item.product_id,
          item.quantity,
          item.unit_price,

          item.tax_percentage || 0,
          itemTax,
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
    const [customerRows] = await connection.query(
      `SELECT full_name, email
   FROM users
   WHERE id = ?
   LIMIT 1`,
      [userId],
    );

    if (!customerRows.length) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Customer not found",
      });
    }

    const customer = customerRows[0];

    // Email Order Details

    const emailOrderDetails = {
      order_id: orderId,
      order_date: new Date(),
      order_status: "pending",

      customer_name: customer.full_name,

      items: items.map((item) => ({
        product_name: item.product_name,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
      })),

      subtotal: Number(subtotal),
      shipping_cost: Number(shipping_cost),
      tax_amount: Number(tax_amount),
      discount_amount: Number(discount_amount),
      total_amount: Number(total_amount),

      currency_code: "INR",
      shipping_address: fullAddressString,
      customer_notes: notes.customer_notes || null,
    };
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
    sendOrderConfirmationEmail(customer.email, emailOrderDetails).catch(
      (error) => {
        console.error("Order confirmation email failed:", error.message);
      },
    );
  } catch (error) {
    await connection.rollback();
    console.error("Order Creation Error:", error);
    res.status(500).json({ success: false, message: "Order creation failed" });
  } finally {
    connection.release();
  }
};

// ========== GET all orders for logged-in user ==========

export const getOrderDetails = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const connection = await pool.getConnection();
  await connection.query("SET SESSION time_zone = '+05:30'");
  try {
    const [orderRows] = await connection.query(
      `SELECT * FROM orders WHERE id = ? AND user_id = ?`,
      [id, userId],
    );

    if (orderRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const [items] = await connection.query(
      `
  SELECT
    oi.id,
    oi.product_id,
    oi.quantity,
    oi.claimed_quantity,
    oi.warranty_claimed_at,
    oi.unit_price,
    oi.total_price,
    oi.product_data_snapshot,
    oi.tax_percentage,
    oi.tax_amount,
    p.warranty_months,

    o.delivered_at,
    o.order_status,

    DATE_ADD(o.delivered_at, INTERVAL p.warranty_months MONTH) AS warranty_end_date,

    CASE
      WHEN p.warranty_months IS NULL THEN 'no_warranty'
      WHEN o.delivered_at IS NULL THEN 'not_delivered'
      WHEN CURDATE() > DATE_ADD(o.delivered_at, INTERVAL p.warranty_months MONTH)
        THEN 'expired'
      WHEN oi.claimed_quantity > 0
        THEN 'claimed'
      ELSE 'active'
    END AS warranty_status

  FROM order_items oi
  JOIN orders o
    ON oi.order_id = o.id
  JOIN product p
    ON oi.product_id = p.id

  WHERE oi.order_id = ?
  `,
      [id],
    );

    const [shipmentRows] = await connection.query(
      `SELECT 
        id,
        carrier,
        recipient_address,
        current_status,
        tracking_history,
        created_at,
        updated_at
       FROM shipments
       WHERE order_id = ?
       ORDER BY created_at DESC`,
      [id],
    );

    const shipments = shipmentRows.map((shipment) => ({
      ...shipment,
      tracking_history:
        typeof shipment.tracking_history === "string"
          ? JSON.parse(shipment.tracking_history || "[]")
          : shipment.tracking_history || [],
    }));

    return res.json({
      success: true,
      data: {
        ...orderRows[0],
        items,
        shipments,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  } finally {
    await connection.release();
  }
};
export const getUserOrders = async (req, res) => {
  try {
    const userId = req.user.id;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 10),
    );

    const offset = (page - 1) * limit;

    // Total orders count for this user
    const [countResult] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM orders
       WHERE user_id = ?`,
      [userId],
    );

    const total = Number(countResult[0].total);

    // Paginated user orders
    const [orders] = await pool.query(
      `SELECT
        id,
        order_status,
        order_date,
        total_amount,
        payment_status
       FROM orders
       WHERE user_id = ?
       ORDER BY order_date DESC, id DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset],
    );

    return res.status(200).json({
      success: true,
      data: orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Get user orders error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
// ========== ADMIN: update order status ==========
// export const updateOrderStatus = async (req, res) => {
//   const { id } = req.params;
//   const { order_status, admin_notes } = req.body;
//   const allowedStatuses = [
//     "pending",
//     "confirmed",
//     "processing",
//     "shipped",
//     "delivered",
//     "cancelled",
//     "returned",
//   ];
//   if (!allowedStatuses.includes(order_status)) {
//     return res
//       .status(400)
//       .json({ success: false, message: "Invalid order status" });
//   }
//   try {
//     const [existing] = await pool.query(
//       "SELECT id, order_status FROM orders WHERE id = ?",
//       [id],
//     );
//     if (existing.length === 0) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Order not found" });
//     }

//     const orderId = existing[0].id;

//     // For Auditing
//     // Before update: fetch current order data
//     const [oldOrder] = await pool.query("SELECT * FROM orders WHERE id = ?", [
//       orderId,
//     ]);

//     const oldStatus = existing[0].order_status;
//     let updateQuery = `
//   UPDATE orders
//   SET order_status = ?, admin_notes = ?
// `;
//     const params = [order_status, admin_notes || null];

//     if (order_status === "delivered" && oldStatus !== "delivered") {
//       updateQuery += `, delivered_at = NOW()`;
//     }

//     updateQuery += ` WHERE id = ?`;
//     params.push(id);

//     await pool.query(updateQuery, params);

//     const [newOrder] = await pool.query("SELECT * FROM orders WHERE id = ?", [
//       orderId,
//     ]);

//     // Log audit
//     await logAudit({
//       userId: req.user.id,
//       action: "UPDATE",
//       tableName: "orders",
//       recordId: orderId,
//       oldData: oldOrder[0],
//       newData: newOrder[0],
//       req,
//     });

//     // If cancelling, restore stock
//     if (order_status === "cancelled" && oldStatus !== "cancelled") {
//       // Restore available_stock for each order item
//       const [items] = await pool.query(
//         "SELECT product_id, quantity FROM order_items WHERE order_id = ?",
//         [id],
//       );
//       for (const item of items) {
//         await pool.query(
//           "UPDATE product_items SET available_stock = available_stock + ? WHERE id = ?",
//           [item.quantity, item.product_id],
//         );
//         // Also reduce reserved_quantity in product_stock
//         await pool.query(
//           `UPDATE product_stock SET reserved_quantity = GREATEST(reserved_quantity - ?, 0)
//                      WHERE product_id = ?`,
//           [item.quantity, item.product_id],
//         );
//       }
//     }
//     res.json({ success: true, message: "Order status updated" });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };
const orderTrackingEventMap = {
  pending: "Order pending",
  processing: "Order processing",
  shipped: "Order shipped",
  delivered: "Order delivered",
  cancelled: "Order cancelled",
  returned: "Order returned",
  refunded: "Order refunded",
};

/*
 * Shipment's current_status may be different from order_status.
 * Only update it when an equivalent shipment status exists.
 */
const orderToShipmentStatusMap = {
  pending: "pending",
  processing: "assigned",
  shipped: "in_transit",
  delivered: "delivered",
  cancelled: "cancelled",
  returned: "returned",
};
// export const updateOrderStatus = async (req, res) => {
//   const orderId = Number(req.params.id);
//   const { order_status, admin_notes } = req.body;

//   const allowedStatuses = [
//     "pending",
//     // "confirmed",
//     "processing",
//     "shipped",
//     "delivered",
//     "cancelled",
//     "returned",
//     "refunded",
//   ];

//   if (!Number.isInteger(orderId) || orderId <= 0) {
//     return res.status(400).json({
//       success: false,
//       message: "Invalid order ID",
//     });
//   }

//   if (!allowedStatuses.includes(order_status)) {
//     return res.status(400).json({
//       success: false,
//       message: "Invalid order status",
//     });
//   }

//   const connection = await pool.getConnection();

//   try {
//     await connection.query("SET time_zone = '+05:30'");
//     await connection.beginTransaction();

//     // Lock order while updating its status
//     const [existingOrders] = await connection.query(
//       `SELECT
//         o.*,
//         u.full_name AS customer_name,
//         u.email AS customer_email,

//         CONCAT_WS(
//           ', ',
//           sa.full_name,
//           sa.line1,
//           sa.line2,
//           sa.landmark,
//           CONCAT(sa.city, ', ', sa.state, ' - ', sa.postal_code),
//           sa.country,
//           CONCAT('Phone: ', sa.phone)
//         ) AS shipping_full_address

//        FROM orders o

//        LEFT JOIN users u
//          ON u.id = o.user_id

//        LEFT JOIN user_addresses sa
//          ON sa.id = o.shipping_address_id

//        WHERE o.id = ?

//        FOR UPDATE`,
//       [orderId],
//     );

//     if (existingOrders.length === 0) {
//       await connection.rollback();

//       return res.status(404).json({
//         success: false,
//         message: "Order not found",
//       });
//     }

//     const oldOrder = existingOrders[0];
//     const oldStatus = oldOrder.order_status;

//     // Avoid unnecessary update and duplicate email
//     if (oldStatus === order_status) {
//       await connection.rollback();

//       return res.status(200).json({
//         success: true,
//         message: `Order is already ${order_status}`,
//         email_sent: false,
//       });
//     }

//     /*
//      * You can optionally add transition validation here.
//      * For example, prevent delivered -> processing.
//      */

//     const updateFields = ["order_status = ?", "admin_notes = ?"];

//     const updateParams = [
//       order_status,
//       admin_notes !== undefined ? admin_notes : oldOrder.admin_notes,
//     ];

//     if (order_status === "delivered") {
//       updateFields.push("delivered_at = COALESCE(delivered_at, NOW())");
//     }

//     /*
//      * When cancelling an order that was not delivered,
//      * delivered_at should remain NULL.
//      */
//     if (order_status === "cancelled" && oldStatus !== "delivered") {
//       updateFields.push("delivered_at = NULL");
//     }

//     updateParams.push(orderId);

//     await connection.query(
//       `UPDATE orders
//        SET ${updateFields.join(", ")}
//        WHERE id = ?`,
//       updateParams,
//     );

//     /*
//      * Restore stock only when entering cancelled status.
//      * This prevents stock from being restored multiple times.
//      */
//     if (order_status === "cancelled" && oldStatus !== "cancelled") {
//       const [items] = await connection.query(
//         `SELECT product_id, quantity
//          FROM order_items
//          WHERE order_id = ?`,
//         [orderId],
//       );

//       for (const item of items) {
//         // Your original code used product_items, but your table is product
//         await connection.query(
//           `UPDATE product
//            SET available_stock = available_stock + ?
//            WHERE id = ?`,
//           [item.quantity, item.product_id],
//         );

//         await connection.query(
//           `UPDATE product_stock
//            SET reserved_quantity =
//              GREATEST(reserved_quantity - ?, 0)
//            WHERE product_id = ?`,
//           [item.quantity, item.product_id],
//         );
//       }
//     }

//     /*
//      * Do not automatically restore returned stock here unless
//      * your return has been inspected and approved.
//      *
//      * A returned product might be damaged or not resellable.
//      */

//     const [updatedOrders] = await connection.query(
//       `SELECT *
//        FROM orders
//        WHERE id = ?`,
//       [orderId],
//     );

//     const updatedOrder = updatedOrders[0];

//     // Get latest shipment information for the email
//     const [shipments] = await connection.query(
//       `SELECT
//         carrier,
//         current_status
//        FROM shipments
//        WHERE order_id = ?
//        ORDER BY created_at DESC
//        LIMIT 1`,
//       [orderId],
//     );

//     const shipment = shipments[0] || {};

//     await connection.commit();

//     // Audit after successful update
//     try {
//       await logAudit({
//         userId: req.user.id,
//         action: "UPDATE",
//         tableName: "orders",
//         recordId: orderId,
//         oldData: oldOrder,
//         newData: updatedOrder,
//         req,
//       });
//     } catch (auditError) {
//       console.error("Order status audit log failed:", auditError.message);
//     }

//     const emailStatuses = ["shipped", "delivered", "cancelled", "returned"];

//     const shouldSendEmail =
//       emailStatuses.includes(order_status) &&
//       oldStatus !== order_status &&
//       oldOrder.customer_email;

//     // Return API response without waiting for email SMTP
//     res.status(200).json({
//       success: true,
//       message: `Order status changed from ${oldStatus} to ${order_status}`,
//       email_scheduled: Boolean(shouldSendEmail),
//       data: {
//         order_id: orderId,
//         old_status: oldStatus,
//         new_status: order_status,
//       },
//     });

//     if (shouldSendEmail) {
//       const emailOrderDetails = {
//         order_id: orderId,
//         customer_name: oldOrder.customer_name,
//         order_status,
//         // tracking_number: shipment.tracking_number || null,
//         carrier: shipment.carrier || null,
//         total_amount: Number(updatedOrder.total_amount),
//         currency_code: updatedOrder.currency_code || "INR",
//         shipping_address: oldOrder.shipping_full_address,
//       };
//       sendOrderStatusEmail(oldOrder.customer_email, emailOrderDetails)
//         .then(() => {
//           console.log(
//             `Order ${order_status} email sent for order number${orderId}`,
//           );
//         })
//         .catch((emailError) => {
//           console.error(
//             `Order ${order_status} email failed for order #${orderId}:`,
//             emailError.message,
//           );
//         });
//     }
//   } catch (error) {
//     try {
//       await connection.rollback();
//     } catch (rollbackError) {
//       console.error("Rollback error:", rollbackError.message);
//     }

//     console.error("Update order status error:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Failed to update order status",
//       error: error.message,
//     });
//   } finally {
//     connection.release();
//   }
// };

export const updateOrderStatus = async (req, res) => {
  const orderId = Number(req.params.id);
  const { order_status, admin_notes } = req.body;

  const allowedStatuses = [
    "pending",
    "processing",
    "shipped",
    "delivered",
    "cancelled",
    "returned",
    "refunded",
  ];

  const orderTrackingEventMap = {
    pending: "Order pending",
    processing: "Order processing",
    shipped: "Order shipped",
    delivered: "Order delivered",
    cancelled: "Order cancelled",
    returned: "Order returned",
    refunded: "Order refunded",
  };

  const orderToShipmentStatusMap = {
    pending: "pending",
    processing: "assigned",
    shipped: "in_transit",
    delivered: "delivered",
    cancelled: "cancelled",
    returned: "returned",
  };

  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid order ID",
    });
  }

  if (!allowedStatuses.includes(order_status)) {
    return res.status(400).json({
      success: false,
      message: `Invalid order status. Allowed statuses are: ${allowedStatuses.join(
        ", ",
      )}`,
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.query("SET time_zone = '+05:30'");
    await connection.beginTransaction();

    const [existingOrders] = await connection.query(
      `SELECT
        o.*,
        u.full_name AS customer_name,
        u.email AS customer_email,

        CONCAT_WS(
          ', ',
          sa.full_name,
          sa.line1,
          sa.line2,
          sa.landmark,
          CONCAT(sa.city, ', ', sa.state, ' - ', sa.postal_code),
          sa.country,
          CONCAT('Phone: ', sa.phone)
        ) AS shipping_full_address

       FROM orders o

       LEFT JOIN users u
         ON u.id = o.user_id

       LEFT JOIN user_addresses sa
         ON sa.id = o.shipping_address_id

       WHERE o.id = ?

       FOR UPDATE`,
      [orderId],
    );

    if (existingOrders.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const oldOrder = existingOrders[0];
    const oldStatus = oldOrder.order_status;

    if (oldStatus === order_status) {
      await connection.rollback();

      return res.status(200).json({
        success: true,
        message: `Order is already ${order_status}`,
        email_sent: false,
      });
    }

    const updateFields = ["order_status = ?", "admin_notes = ?"];

    const updateParams = [
      order_status,
      admin_notes !== undefined ? admin_notes : oldOrder.admin_notes,
    ];

    if (order_status === "delivered") {
      updateFields.push("delivered_at = COALESCE(delivered_at, NOW())");
    }

    if (order_status === "cancelled" && oldStatus !== "delivered") {
      updateFields.push("delivered_at = NULL");
    }

    if (order_status === "returned") {
      updateFields.push("return_date = COALESCE(return_date, NOW())");
    }

    updateParams.push(orderId);

    await connection.query(
      `UPDATE orders
       SET ${updateFields.join(", ")}
       WHERE id = ?`,
      updateParams,
    );

    /*
     * Add the order status change to the latest shipment's
     * tracking history.
     */
    const [shipmentRows] = await connection.query(
      `SELECT
        id,
        carrier,
        current_status,
        tracking_history
       FROM shipments
       WHERE order_id = ?
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [orderId],
    );

    let shipment = null;
    let trackingAdded = false;

    if (shipmentRows.length > 0) {
      shipment = shipmentRows[0];

      let trackingHistory = shipment.tracking_history || [];

      if (typeof trackingHistory === "string") {
        try {
          trackingHistory = JSON.parse(trackingHistory);
        } catch (parseError) {
          console.error(
            "Shipment tracking history JSON parse error:",
            parseError.message,
          );

          trackingHistory = [];
        }
      }

      if (!Array.isArray(trackingHistory)) {
        trackingHistory = [];
      }

      const trackingEvent = orderTrackingEventMap[order_status];

      /*
       * Check using order_status rather than only event text.
       * This makes duplicate checking more reliable.
       */
      const alreadyExists = trackingHistory.some(
        (item) =>
          item.order_status === order_status || item.event === trackingEvent,
      );

      if (!alreadyExists) {
        trackingHistory.push({
          event: trackingEvent,
          order_status,
          previous_order_status: oldStatus,
          source: "order_status",
          date: new Date().toISOString(),
        });

        trackingAdded = true;
      }

      const shipmentStatus =
        orderToShipmentStatusMap[order_status] || shipment.current_status;

      await connection.query(
        `UPDATE shipments
         SET
           current_status = ?,
           tracking_history = ?
         WHERE id = ?`,
        [shipmentStatus, JSON.stringify(trackingHistory), shipment.id],
      );

      shipment.current_status = shipmentStatus;
      shipment.tracking_history = trackingHistory;
    }

    /*
     * Restore stock only when entering cancelled status.
     */
    if (order_status === "cancelled" && oldStatus !== "cancelled") {
      const [items] = await connection.query(
        `SELECT product_id, quantity
         FROM order_items
         WHERE order_id = ?`,
        [orderId],
      );

      for (const item of items) {
        await connection.query(
          `UPDATE product
           SET available_stock = available_stock + ?
           WHERE id = ?`,
          [item.quantity, item.product_id],
        );

        await connection.query(
          `UPDATE product_stock
           SET reserved_quantity =
             GREATEST(reserved_quantity - ?, 0)
           WHERE product_id = ?`,
          [item.quantity, item.product_id],
        );
      }
    }

    const [updatedOrders] = await connection.query(
      `SELECT *
       FROM orders
       WHERE id = ?`,
      [orderId],
    );

    const updatedOrder = updatedOrders[0];

    await connection.commit();

    try {
      await logAudit({
        userId: req.user.id,
        action: "UPDATE",
        tableName: "orders",
        recordId: orderId,
        oldData: oldOrder,
        newData: updatedOrder,
        req,
      });
    } catch (auditError) {
      console.error("Order status audit log failed:", auditError.message);
    }

    const emailStatuses = ["shipped", "delivered", "cancelled", "returned"];

    const shouldSendEmail =
      emailStatuses.includes(order_status) && oldOrder.customer_email;

    res.status(200).json({
      success: true,
      message: `Order status changed from ${oldStatus} to ${order_status}`,
      email_scheduled: Boolean(shouldSendEmail),
      data: {
        order_id: orderId,
        old_status: oldStatus,
        new_status: order_status,
        shipment_found: Boolean(shipment),
        shipment_status: shipment?.current_status || null,
        tracking_event: orderTrackingEventMap[order_status] || null,
        tracking_added: trackingAdded,
      },
    });

    if (shouldSendEmail) {
      const emailOrderDetails = {
        order_id: orderId,
        customer_name: oldOrder.customer_name,
        order_status,
        // tracking_number: shipment?.tracking_number || null,
        carrier: shipment?.carrier || null,
        total_amount: Number(updatedOrder.total_amount),
        currency_code: updatedOrder.currency_code || "INR",
        shipping_address: oldOrder.shipping_full_address,
      };

      sendOrderStatusEmail(oldOrder.customer_email, emailOrderDetails)
        .then(() => {
          console.log(`Order ${order_status} email sent for order #${orderId}`);
        })
        .catch((emailError) => {
          console.error(
            `Order ${order_status} email failed for order #${orderId}:`,
            emailError.message,
          );
        });
    }
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error("Rollback error:", rollbackError.message);
    }

    console.error("Update order status error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update order status",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};
// export const getAllOrders = async (req, res) => {
//   const page = parseInt(req.query.page) || 1;
//   const limit = parseInt(req.query.limit) || 10;
//   const offset = (page - 1) * limit;

//   const { status, from_date, to_date } = req.query;

//   const conditions = [];
//   const params = [];

//   if (
//     status &&
//     [
//       "pending",
//       "confirmed",
//       "processing",
//       "shipped",
//       "delivered",
//       "cancelled",
//       "returned",
//     ].includes(status)
//   ) {
//     conditions.push("o.order_status = ?");
//     params.push(status);
//   }

//   if (from_date) {
//     conditions.push("DATE(o.order_date) >= ?");
//     params.push(from_date);
//   }

//   if (to_date) {
//     conditions.push("DATE(o.order_date) <= ?");
//     params.push(to_date);
//   }

//   const whereClause =
//     conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

//   try {
//     // Get total count
//     const [countResult] = await pool.query(
//       `SELECT COUNT(*) AS total
//        FROM orders o
//        ${whereClause}`,
//       params,
//     );

//     const total = countResult[0].total;

//     // Get orders
//     const [orders] = await pool.query(
//       `SELECT
//         o.*,
//         u.full_name as customer_name,
//         u.email as customer_email,
//         u.phone as customer_phone,
//         u.profile_image as customer_profile_image,
//         u.role as customer_role,

//         -- Shipping Address
//         sa.full_name as shipping_full_name,
//         sa.phone as shipping_phone,
//         sa.line1 as shipping_line1,
//         sa.line2 as shipping_line2,
//         sa.landmark as shipping_landmark,
//         sa.city as shipping_city,
//         sa.state as shipping_state,
//         sa.postal_code as shipping_postal_code,
//         sa.country as shipping_country,
//         CONCAT_WS(', ',
//           sa.line1,
//           sa.line2,
//           sa.landmark,
//           sa.city,
//           sa.state,
//           sa.postal_code,
//           sa.country
//         ) as shipping_full_address,

//         -- Billing Address
//         ba.full_name as billing_full_name,
//         ba.phone as billing_phone,
//         ba.line1 as billing_line1,
//         ba.line2 as billing_line2,
//         ba.landmark as billing_landmark,
//         ba.city as billing_city,
//         ba.state as billing_state,
//         ba.postal_code as billing_postal_code,
//         ba.country as billing_country,
//         CONCAT_WS(', ',
//           ba.line1,
//           ba.line2,
//           ba.landmark,
//           ba.city,
//           ba.state,
//           ba.postal_code,
//           ba.country
//         ) as billing_full_address

//       FROM orders o
//       LEFT JOIN users u ON o.user_id = u.id
//       LEFT JOIN user_addresses sa ON o.shipping_address_id = sa.id
//       LEFT JOIN user_addresses ba ON o.billing_address_id = ba.id

//       ${whereClause}

//       ORDER BY o.order_date DESC
//       LIMIT ? OFFSET ?`,
//       [...params, limit, offset],
//     );
//     // Get order items for all orders
//     const orderIds = orders.map((order) => order.id);
//     let orderItemsMap = {};

//     if (orderIds.length > 0) {
//       // Get all order items with product details (now directly from product table)
//       const [items] = await pool.query(
//         `SELECT
//           oi.id,
//           oi.order_id,
//           oi.product_id,
//           oi.quantity,
//           oi.unit_price,
//           oi.total_price,
//           oi.product_data_snapshot as product_snapshot,
//           p.name as product_name,
//           p.slug as product_slug,
//           p.status as product_status,
//           p.sku as product_sku,
//           p.price as current_price,
//           p.weight,
//           p.width,
//           p.height,
//           p.depth,
//           p.is_available,
//           p.available_stock
//         FROM order_items oi
//         LEFT JOIN product p ON oi.product_id = p.id
//         WHERE oi.order_id IN (?)
//         ORDER BY oi.order_id, oi.id`,
//         [orderIds],
//       );

//       // Group items by order_id
//       orderItemsMap = items.reduce((acc, item) => {
//         if (!acc[item.order_id]) {
//           acc[item.order_id] = [];
//         }
//         // Parse the JSON snapshot or use the individual fields
//         let productSnapshot = item.product_snapshot;
//         if (typeof productSnapshot === "string") {
//           try {
//             productSnapshot = JSON.parse(productSnapshot);
//           } catch (e) {
//             productSnapshot = {};
//           }
//         }

//         acc[item.order_id].push({
//           id: item.id,
//           product_id: item.product_id, // renamed from product_item_id
//           quantity: item.quantity,
//           unit_price: item.unit_price,
//           total_price: item.total_price,
//           product: {
//             id: item.product_id, // product id directly
//             name: item.product_name || productSnapshot?.product_name,
//             slug: item.prodreuct_slug,
//             sku: item.product_sku || productSnapshot?.sku,
//             // variation may be stored in snapshot, if needed:
//             variation: productSnapshot?.variation || null,
//             status: item.product_status,
//             current_price: item.current_price,
//             weight: item.weight,
//             dimensions: {
//               width: item.width,
//               height: item.height,
//               depth: item.depth,
//             },
//             is_available: item.is_available,
//             available_stock: item.available_stock,
//             snapshot: productSnapshot, // Keep the full snapshot for reference
//           },
//         });
//         return acc;
//       }, {});
//     }

//     // Combine orders with their items and calculate summary
//     const ordersWithDetails = orders.map((order) => ({
//       ...order,
//       items: orderItemsMap[order.id] || [],
//       item_count: orderItemsMap[order.id]?.length || 0,
//       summary: {
//         subtotal: order.subtotal,
//         shipping_cost: order.shipping_cost,
//         tax_amount: order.tax_amount,
//         discount_amount: order.discount_amount,
//         total_amount: order.total_amount,
//         currency: order.currency_code,
//       },
//       customer: {
//         id: order.user_id,
//         name: order.customer_name,
//         email: order.customer_email,
//         phone: order.customer_phone,
//         profile_image: order.customer_profile_image,
//         role: order.customer_role,
//       },
//       shipping_address: {
//         id: order.shipping_address_id,
//         full_name: order.shipping_full_name,
//         phone: order.shipping_phone,
//         line1: order.shipping_line1,
//         line2: order.shipping_line2,
//         landmark: order.shipping_landmark,
//         city: order.shipping_city,
//         state: order.shipping_state,
//         postal_code: order.shipping_postal_code,
//         country: order.shipping_country,
//         full_address: order.shipping_full_address,
//       },
//       billing_address: {
//         id: order.billing_address_id,
//         full_name: order.billing_full_name,
//         phone: order.billing_phone,
//         line1: order.billing_line1,
//         line2: order.billing_line2,
//         landmark: order.billing_landmark,
//         city: order.billing_city,
//         state: order.billing_state,
//         postal_code: order.billing_postal_code,
//         country: order.billing_country,
//         full_address: order.billing_full_address,
//       },
//     }));

//     res.json({
//       success: true,
//       data: ordersWithDetails,
//       pagination: {
//         page,
//         limit,
//         total,
//         totalPages: Math.ceil(total / limit),
//       },
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };
// export const getAllOrders = async (req, res) => {
//   const page = parseInt(req.query.page) || 1;
//   const limit = parseInt(req.query.limit) || 10;
//   const offset = (page - 1) * limit;
//   const status = req.query.status;

//   let whereClause = "";
//   let params = [];

//   if (
//     status &&
//     [
//       "pending",
//       "confirmed",
//       "processing",
//       "shipped",
//       "delivered",
//       "cancelled",
//       "refunded",
//     ].includes(status)
//   ) {
//     whereClause = "WHERE o.order_status = ?";
//     params.push(status);
//   }

//   try {
//     // Get total count
//     const [countResult] = await pool.query(
//       `SELECT COUNT(*) as total FROM orders o ${whereClause}`,
//       params,
//     );
//     const total = countResult[0].total;

//     // Get orders with user and address details
//     const [orders] = await pool.query(
//       `SELECT
//         o.*,
//         u.full_name as customer_name,
//         u.email as customer_email,
//         u.phone as customer_phone,
//         u.profile_image as customer_profile_image,
//         u.role as customer_role,
//         -- Shipping Address
//         sa.full_name as shipping_full_name,
//         sa.phone as shipping_phone,
//         sa.line1 as shipping_line1,
//         sa.line2 as shipping_line2,
//         sa.landmark as shipping_landmark,
//         sa.city as shipping_city,
//         sa.state as shipping_state,
//         sa.postal_code as shipping_postal_code,
//         sa.country as shipping_country,
//         CONCAT_WS(', ',
//           sa.line1,
//           sa.line2,
//           sa.landmark,
//           sa.city,
//           sa.state,
//           sa.postal_code,
//           sa.country
//         ) as shipping_full_address,
//         -- Billing Address
//         ba.full_name as billing_full_name,
//         ba.phone as billing_phone,
//         ba.line1 as billing_line1,
//         ba.line2 as billing_line2,
//         ba.landmark as billing_landmark,
//         ba.city as billing_city,
//         ba.state as billing_state,
//         ba.postal_code as billing_postal_code,
//         ba.country as billing_country,
//         CONCAT_WS(', ',
//           ba.line1,
//           ba.line2,
//           ba.landmark,
//           ba.city,
//           ba.state,
//           ba.postal_code,
//           ba.country
//         ) as billing_full_address
//       FROM orders o
//       LEFT JOIN users u ON o.user_id = u.id
//       LEFT JOIN user_addresses sa ON o.shipping_address_id = sa.id
//       LEFT JOIN user_addresses ba ON o.billing_address_id = ba.id
//       ${whereClause}
//       ORDER BY o.order_date DESC
//       LIMIT ? OFFSET ?`,
//       [...params, limit, offset],
//     );

//     // Get order items for all orders
//     const orderIds = orders.map((order) => order.id);
//     let orderItemsMap = {};

//     if (orderIds.length > 0) {
//       // Get all order items with product details (now directly from product table)
//       const [items] = await pool.query(
//         `SELECT
//           oi.id,
//           oi.order_id,
//           oi.product_id,
//           oi.quantity,
//           oi.unit_price,
//           oi.total_price,
//           oi.product_data_snapshot as product_snapshot,
//           p.name as product_name,
//           p.slug as product_slug,
//           p.status as product_status,
//           p.sku as product_sku,
//           p.price as current_price,
//           p.weight,
//           p.width,
//           p.height,
//           p.depth,
//           p.is_available,
//           p.available_stock
//         FROM order_items oi
//         LEFT JOIN product p ON oi.product_id = p.id
//         WHERE oi.order_id IN (?)
//         ORDER BY oi.order_id, oi.id`,
//         [orderIds],
//       );

//       // Group items by order_id
//       orderItemsMap = items.reduce((acc, item) => {
//         if (!acc[item.order_id]) {
//           acc[item.order_id] = [];
//         }
//         // Parse the JSON snapshot or use the individual fields
//         let productSnapshot = item.product_snapshot;
//         if (typeof productSnapshot === "string") {
//           try {
//             productSnapshot = JSON.parse(productSnapshot);
//           } catch (e) {
//             productSnapshot = {};
//           }
//         }

//         acc[item.order_id].push({
//           id: item.id,
//           product_id: item.product_id, // renamed from product_item_id
//           quantity: item.quantity,
//           unit_price: item.unit_price,
//           total_price: item.total_price,
//           product: {
//             id: item.product_id, // product id directly
//             name: item.product_name || productSnapshot?.product_name,
//             slug: item.product_slug,
//             sku: item.product_sku || productSnapshot?.sku,
//             // variation may be stored in snapshot, if needed:
//             variation: productSnapshot?.variation || null,
//             status: item.product_status,
//             current_price: item.current_price,
//             weight: item.weight,
//             dimensions: {
//               width: item.width,
//               height: item.height,
//               depth: item.depth,
//             },
//             is_available: item.is_available,
//             available_stock: item.available_stock,
//             snapshot: productSnapshot, // Keep the full snapshot for reference
//           },
//         });
//         return acc;
//       }, {});
//     }

//     // Combine orders with their items and calculate summary
//     const ordersWithDetails = orders.map((order) => ({
//       ...order,
//       items: orderItemsMap[order.id] || [],
//       item_count: orderItemsMap[order.id]?.length || 0,
//       summary: {
//         subtotal: order.subtotal,
//         shipping_cost: order.shipping_cost,
//         tax_amount: order.tax_amount,
//         discount_amount: order.discount_amount,
//         total_amount: order.total_amount,
//         currency: order.currency_code,
//       },
//       customer: {
//         id: order.user_id,
//         name: order.customer_name,
//         email: order.customer_email,
//         phone: order.customer_phone,
//         profile_image: order.customer_profile_image,
//         role: order.customer_role,
//       },
//       shipping_address: {
//         id: order.shipping_address_id,
//         full_name: order.shipping_full_name,
//         phone: order.shipping_phone,
//         line1: order.shipping_line1,
//         line2: order.shipping_line2,
//         landmark: order.shipping_landmark,
//         city: order.shipping_city,
//         state: order.shipping_state,
//         postal_code: order.shipping_postal_code,
//         country: order.shipping_country,
//         full_address: order.shipping_full_address,
//       },
//       billing_address: {
//         id: order.billing_address_id,
//         full_name: order.billing_full_name,
//         phone: order.billing_phone,
//         line1: order.billing_line1,
//         line2: order.billing_line2,
//         landmark: order.billing_landmark,
//         city: order.billing_city,
//         state: order.billing_state,
//         postal_code: order.billing_postal_code,
//         country: order.billing_country,
//         full_address: order.billing_full_address,
//       },
//     }));

//     res.json({
//       success: true,
//       data: ordersWithDetails,
//       pagination: {
//         page,
//         limit,
//         total,
//         totalPages: Math.ceil(total / limit),
//       },
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };

export const getAllOrders = async (req, res) => {
  try {

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);

    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 10),
    );

    const offset = (page - 1) * limit;

    const { status, from_date, to_date } = req.query;

    const allowedStatuses = [
      "pending",
      "confirmed",
      "processing",
      "shipped",
      "delivered",
      "cancelled",
      "returned",
    ];

    const conditions = [];
    const params = [];

    if (status && allowedStatuses.includes(status)) {
      conditions.push("o.order_status = ?");
      params.push(status);
    }

    if (from_date) {
      conditions.push("DATE(o.order_date) >= ?");
      params.push(from_date);
    }

    if (to_date) {
      conditions.push("DATE(o.order_date) <= ?");
      params.push(to_date);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    
    // Total matching orders
    const [countResult] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM orders o
      ${whereClause}
      `,
      params,
    );

    const total = Number(countResult[0].total);

    // Only paginated orders
    const [orders] = await pool.query(
      `
  SELECT
    o.*,

    u.full_name AS customer_name,
    u.email AS customer_email,
    u.phone AS customer_phone,
    u.profile_image AS customer_profile_image,
    u.role AS customer_role,

    sa.full_name AS shipping_full_name,
    sa.phone AS shipping_phone,
    sa.line1 AS shipping_line1,
    sa.line2 AS shipping_line2,
    sa.landmark AS shipping_landmark,
    sa.city AS shipping_city,
    sa.state AS shipping_state,
    sa.postal_code AS shipping_postal_code,
    sa.country AS shipping_country,

    CONCAT_WS(
      ', ',
      sa.line1,
      sa.line2,
      sa.landmark,
      sa.city,
      sa.state,
      sa.postal_code,
      sa.country
    ) AS shipping_full_address,

    ba.full_name AS billing_full_name,
    ba.phone AS billing_phone,
    ba.line1 AS billing_line1,
    ba.line2 AS billing_line2,
    ba.landmark AS billing_landmark,
    ba.city AS billing_city,
    ba.state AS billing_state,
    ba.postal_code AS billing_postal_code,
    ba.country AS billing_country,

    CONCAT_WS(
      ', ',
      ba.line1,
      ba.line2,
      ba.landmark,
      ba.city,
      ba.state,
      ba.postal_code,
      ba.country
    ) AS billing_full_address

  FROM (
    SELECT o.*
    FROM orders o
    ${whereClause}
    ORDER BY o.order_date DESC, o.id DESC
    LIMIT ${limit}
    OFFSET ${offset}
  ) AS o

  LEFT JOIN users u
    ON o.user_id = u.id

  LEFT JOIN user_addresses sa
    ON o.shipping_address_id = sa.id

  LEFT JOIN user_addresses ba
    ON o.billing_address_id = ba.id

  ORDER BY o.order_date DESC, o.id DESC
  `,
      params,
    );

    // console.log("FINAL ORDERS LENGTH:", orders.length);
    // console.log(
    //   "FINAL ORDER IDS:",
    //   orders.map((order) => order.id),
    // );

    const orderIds = orders.map((order) => order.id);
    let orderItemsMap = {};

    if (orderIds.length > 0) {
      const placeholders = orderIds.map(() => "?").join(",");

      const [items] = await pool.query(
        `
        SELECT
          oi.id,
          oi.order_id,
          oi.product_id,
          oi.quantity,
          oi.unit_price,
          oi.total_price,
          oi.product_data_snapshot AS product_snapshot,

          p.name AS product_name,
          p.slug AS product_slug,
          p.status AS product_status,
          p.sku AS product_sku,
          p.price AS current_price,
          p.weight,
          p.width,
          p.height,
          p.depth,
          p.is_available,
          p.available_stock

        FROM order_items oi

        LEFT JOIN product p
          ON oi.product_id = p.id

        WHERE oi.order_id IN (${placeholders})

        ORDER BY oi.order_id, oi.id
        `,
        orderIds,
      );

      orderItemsMap = items.reduce((acc, item) => {
        let productSnapshot = item.product_snapshot;

        if (typeof productSnapshot === "string") {
          try {
            productSnapshot = JSON.parse(productSnapshot);
          } catch {
            productSnapshot = {};
          }
        }

        if (!acc[item.order_id]) {
          acc[item.order_id] = [];
        }

        acc[item.order_id].push({
          id: item.id,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price,

          product: {
            id: item.product_id,
            name: item.product_name || productSnapshot?.product_name,
            slug: item.product_slug,
            sku: item.product_sku || productSnapshot?.sku,
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
            snapshot: productSnapshot,
          },
        });

        return acc;
      }, {});
    }

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

    return res.status(200).json({
      success: true,
      data: ordersWithDetails,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Get all orders error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
export const getOrderDashboardStats = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        COUNT(*) AS total_orders,

        SUM(CASE
          WHEN order_status = 'pending' THEN 1
          ELSE 0
        END) AS pending_orders,

        SUM(CASE
          WHEN order_status = 'shipped' THEN 1
          ELSE 0
        END) AS shipped_orders,

        SUM(CASE
          WHEN order_status = 'delivered' THEN 1
          ELSE 0
        END) AS delivered_orders,

        SUM(CASE
          WHEN payment_status = 'pending' THEN 1
          ELSE 0
        END) AS payment_pending,

        SUM(CASE
          WHEN DATE(order_date) = CURDATE() THEN 1
          ELSE 0
        END) AS new_orders_today,

        SUM(CASE
          WHEN DATE(order_date) = CURDATE() THEN total_amount
          ELSE 0
        END) AS today_revenue

      FROM orders
    `);

    const stats = rows[0];

    return res.status(200).json({
      success: true,
      data: {
        total_orders: Number(stats.total_orders) || 0,
        pending_orders: Number(stats.pending_orders) || 0,
        shipped_orders: Number(stats.shipped_orders) || 0,
        delivered_orders: Number(stats.delivered_orders) || 0,
        payment_pending: Number(stats.payment_pending) || 0,
        new_orders_today: Number(stats.new_orders_today) || 0,
        today_revenue: Number(stats.today_revenue) || 0,
      },
    });
  } catch (error) {
    console.error("Order dashboard stats error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch order dashboard statistics",
    });
  }
};

function validateNewAddress(address) {
  const requiredFields = [
    "full_name",
    "phone",
    "line1",
    "city",
    "state",
    "postal_code",
  ];

  for (const field of requiredFields) {
    if (!address[field] || String(address[field]).trim() === "") {
      return `${field} is required`;
    }
  }

  if (!/^\d{6}$/.test(String(address.postal_code))) {
    return "postal_code must contain exactly 6 digits";
  }

  if (!/^\d{10,15}$/.test(String(address.phone))) {
    return "phone must contain 10 to 15 digits";
  }

  return null;
}

export const updateOrderAddresses = async (req, res) => {
  const { id } = req.params;

  const {
    shipping_address_id,
    billing_address_id,
    new_shipping_address,
    new_billing_address,
  } = req.body;

  const hasAddress =
    shipping_address_id ||
    billing_address_id ||
    new_shipping_address ||
    new_billing_address;

  if (!hasAddress) {
    return res.status(400).json({
      success: false,
      message:
        "Provide at least one of: shipping_address_id, billing_address_id, new_shipping_address, or new_billing_address.",
    });
  }
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [orders] = await connection.query(
      `SELECT
        id,
        user_id,
        order_status,
        shipping_address_id,
        billing_address_id
       FROM orders
       WHERE id = ?
       FOR UPDATE`,
      [id],
    );

    if (orders.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const order = orders[0];

    const blockedStatuses = ["shipped", "delivered", "cancelled", "returned"];

    if (blockedStatuses.includes(order.order_status)) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: `Address cannot be changed when order status is '${order.order_status}'`,
      });
    }

    let finalShippingAddressId = null;
    let finalBillingAddressId = null;

    // Existing shipping address
    if (shipping_address_id) {
      const [addresses] = await connection.query(
        `SELECT id
         FROM user_addresses
         WHERE id = ?
           AND user_id = ?
           AND address_type = 'shipping'
           AND is_deleted = 0`,
        [shipping_address_id, order.user_id],
      );

      if (addresses.length === 0) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Invalid shipping address",
        });
      }

      finalShippingAddressId = Number(shipping_address_id);
    }

    // Create new shipping address
    if (new_shipping_address) {
      const validationError = validateNewAddress(new_shipping_address);

      if (validationError) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: `Shipping address: ${validationError}`,
        });
      }

      const [result] = await connection.query(
        `INSERT INTO user_addresses (
          user_id,
          address_type,
          full_name,
          phone,
          line1,
          line2,
          landmark,
          city,
          state,
          postal_code,
          country,
          is_default
        )
        VALUES (?, 'shipping', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          order.user_id,
          new_shipping_address.full_name,
          new_shipping_address.phone,
          new_shipping_address.line1,
          new_shipping_address.line2 || null,
          new_shipping_address.landmark || null,
          new_shipping_address.city,
          new_shipping_address.state,
          new_shipping_address.postal_code,
          new_shipping_address.country || "India",
          new_shipping_address.is_default ? 1 : 0,
        ],
      );

      finalShippingAddressId = result.insertId;
    }

    // Existing billing address
    if (billing_address_id) {
      const [addresses] = await connection.query(
        `SELECT id
         FROM user_addresses
         WHERE id = ?
           AND user_id = ?
           AND address_type = 'billing'
           AND is_deleted = 0`,
        [billing_address_id, order.user_id],
      );

      if (addresses.length === 0) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Invalid billing address",
        });
      }

      finalBillingAddressId = Number(billing_address_id);
    }

    // Create new billing address
    if (new_billing_address) {
      const validationError = validateNewAddress(new_billing_address);

      if (validationError) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: `Billing address: ${validationError}`,
        });
      }

      const [result] = await connection.query(
        `INSERT INTO user_addresses (
          user_id,
          address_type,
          full_name,
          phone,
          line1,
          line2,
          landmark,
          city,
          state,
          postal_code,
          country,
          is_default
        )
        VALUES (?, 'billing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          order.user_id,
          new_billing_address.full_name,
          new_billing_address.phone,
          new_billing_address.line1,
          new_billing_address.line2 || null,
          new_billing_address.landmark || null,
          new_billing_address.city,
          new_billing_address.state,
          new_billing_address.postal_code,
          new_billing_address.country || "India",
          new_billing_address.is_default ? 1 : 0,
        ],
      );

      finalBillingAddressId = result.insertId;
    }

    const updateFields = [];
    const updateParams = [];

    if (finalShippingAddressId) {
      updateFields.push("shipping_address_id = ?");
      updateParams.push(finalShippingAddressId);
    }

    if (finalBillingAddressId) {
      updateFields.push("billing_address_id = ?");
      updateParams.push(finalBillingAddressId);
    }

    if (updateFields.length === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "No valid address was provided",
      });
    }

    updateParams.push(id);

    await connection.query(
      `UPDATE orders
       SET ${updateFields.join(", ")}
       WHERE id = ?`,
      updateParams,
    );
    // Update shipment recipient address when shipping address changes
    if (finalShippingAddressId) {
      const [addressRows] = await connection.query(
        `SELECT
      full_name,
      phone,
      line1,
      line2,
      landmark,
      city,
      state,
      postal_code,
      country
     FROM user_addresses
     WHERE id = ?
       AND user_id = ?
       AND is_deleted = 0
     LIMIT 1`,
        [finalShippingAddressId, order.user_id],
      );

      if (addressRows.length === 0) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Updated shipping address not found",
        });
      }

      const address = addressRows[0];

      const fullAddressString = [
        address.full_name,
        address.line1,
        address.line2,
        address.landmark,
        `${address.city}, ${address.state} - ${address.postal_code}`,
        address.country,
        `Phone: ${address.phone}`,
      ]
        .filter(Boolean)
        .join(", ");

      const [shipmentRows] = await connection.query(
        `SELECT id, current_status
     FROM shipments
     WHERE order_id = ?
     FOR UPDATE`,
        [order.id],
      );

      if (shipmentRows.length === 0) {
        // Create shipment if it does not exist
        await connection.query(
          `INSERT INTO shipments (
        order_id,
        recipient_address,
        current_status
      )
      VALUES (?, ?, 'pending')`,
          [order.id, fullAddressString],
        );
      } else {
        // Update all shipments connected to the order
        const [shipmentUpdateResult] = await connection.query(
          `UPDATE shipments
       SET recipient_address = ?
       WHERE order_id = ?`,
          [fullAddressString, order.id],
        );

       
      }
    }
    const [updatedOrders] = await connection.query(
      `SELECT
        o.id,
        o.user_id,
        o.order_status,
        o.shipping_address_id,
        o.billing_address_id,

        JSON_OBJECT(
          'id', shipping.id,
          'address_type', shipping.address_type,
          'full_name', shipping.full_name,
          'phone', shipping.phone,
          'line1', shipping.line1,
          'line2', shipping.line2,
          'landmark', shipping.landmark,
          'city', shipping.city,
          'state', shipping.state,
          'postal_code', shipping.postal_code,
          'country', shipping.country
        ) AS shipping_address,

        JSON_OBJECT(
          'id', billing.id,
          'address_type', billing.address_type,
          'full_name', billing.full_name,
          'phone', billing.phone,
          'line1', billing.line1,
          'line2', billing.line2,
          'landmark', billing.landmark,
          'city', billing.city,
          'state', billing.state,
          'postal_code', billing.postal_code,
          'country', billing.country
        ) AS billing_address

       FROM orders o

       LEFT JOIN user_addresses shipping
         ON shipping.id = o.shipping_address_id

       LEFT JOIN user_addresses billing
         ON billing.id = o.billing_address_id

       WHERE o.id = ?`,
      [id],
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Order address updated successfully",
      data: updatedOrders[0],
    });
  } catch (error) {
    await connection.rollback();

    console.error("Update order addresses error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update order address",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

export const cancelMyOrder = async (req, res) => {
  const orderId = Number(req.params.id);
  const userId = req.user.id;

  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid order ID",
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.query("SET time_zone = '+05:30'");
    await connection.beginTransaction();

    const [orders] = await connection.query(
      `SELECT
          o.*,
          u.full_name AS customer_name,
          u.email AS customer_email,

          CONCAT_WS(
            ', ',
            sa.full_name,
            sa.line1,
            sa.line2,
            sa.landmark,
            CONCAT(sa.city, ', ', sa.state, ' - ', sa.postal_code),
            sa.country,
            CONCAT('Phone: ', sa.phone)
          ) AS shipping_full_address

      FROM orders o
      JOIN users u
        ON u.id = o.user_id
      LEFT JOIN user_addresses sa
        ON sa.id = o.shipping_address_id
      WHERE o.id = ?
        AND o.user_id = ?
      FOR UPDATE`,
      [orderId, userId],
    );

    if (!orders.length) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const order = orders[0];

    if (order.order_status === "cancelled") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Order is already cancelled",
      });
    }

    const cancellableStatuses = ["pending", "processing"];

    if (!cancellableStatuses.includes(order.order_status)) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Order cannot be cancelled after it has been shipped.",
      });
    }

    await connection.query(
      `UPDATE orders
       SET
          order_status='cancelled',
          delivered_at=NULL
       WHERE id=?`,
      [orderId],
    );

    // Restore stock
    const [items] = await connection.query(
      `SELECT product_id, quantity
       FROM order_items
       WHERE order_id=?`,
      [orderId],
    );

    for (const item of items) {
      await connection.query(
        `UPDATE product
         SET available_stock = available_stock + ?
         WHERE id=?`,
        [item.quantity, item.product_id],
      );

      await connection.query(
        `UPDATE product_stock
         SET reserved_quantity =
           GREATEST(reserved_quantity - ?,0)
         WHERE product_id=?`,
        [item.quantity, item.product_id],
      );
    }

    // Shipment
    const [shipmentRows] = await connection.query(
      `SELECT id, tracking_history
       FROM shipments
       WHERE order_id=?
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [orderId],
    );

    if (shipmentRows.length) {
      let trackingHistory = shipmentRows[0].tracking_history || [];

      if (typeof trackingHistory === "string") {
        try {
          trackingHistory = JSON.parse(trackingHistory);
        } catch {
          trackingHistory = [];
        }
      }

      trackingHistory.push({
        event: "Order cancelled by customer",
        order_status: "cancelled",
        previous_order_status: order.order_status,
        source: "customer",
        date: new Date().toISOString(),
      });

      await connection.query(
        `UPDATE shipments
         SET
           current_status='cancelled',
           tracking_history=?
         WHERE id=?`,
        [JSON.stringify(trackingHistory), shipmentRows[0].id],
      );
    }

    await connection.commit();

    // Audit Log
    try {
      await logAudit({
        userId,
        action: "CANCEL",
        tableName: "orders",
        recordId: orderId,
        oldData: order,
        newData: {
          ...order,
          order_status: "cancelled",
        },
        req,
      });
    } catch (err) {
      console.error(err);
    }

    // Email
    try {
      await sendOrderStatusEmail(order.customer_email, {
        order_id: orderId,
        customer_name: order.customer_name,
        order_status: "cancelled",
        total_amount: Number(order.total_amount),
        currency_code: order.currency_code || "INR",
        shipping_address: order.shipping_full_address,
      });
    } catch (err) {
      console.error("Cancel email failed:", err.message);
    }

    return res.status(200).json({
      success: true,
      message: "Order cancelled successfully.",
    });
  } catch (error) {
    await connection.rollback();

    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Failed to cancel order.",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};
