// import { pool } from "../config/db.js";

// // Automatically register warranty when an order item is delivered?
// // We'll provide manual registration endpoint.
// export const registerWarranty = async (req, res) => {
//   const { order_item_id, warranty_number } = req.body;
//   const userId = req.user.id;

//   if (!order_item_id || !warranty_number) {
//     return res.status(400).json({
//       success: false,
//       message: "Missing order_item_id or warranty_number",
//     });
//   }

//   try {
//     // Verify order_item belongs to user and order is delivered
//     const [orderItem] = await pool.query(
//       `SELECT oi.id, o.user_id, o.order_status, o.order_date
//        FROM order_items oi
//        JOIN orders o ON oi.order_id = o.id
//        WHERE oi.id = ? AND o.user_id = ?`,
//       [order_item_id, userId],
//     );
//     if (!orderItem.length || orderItem[0].order_status !== "delivered") {
//       return res
//         .status(403)
//         .json({ success: false, message: "Item not delivered or not yours" });
//     }

//     // Calculate warranty end date (3 years from order date)
//     const orderDate = new Date(orderItem[0].order_date);
//     const warrantyEnd = new Date(
//       orderDate.setFullYear(orderDate.getFullYear() + 3),
//     );
//     const warrantyEndDate = warrantyEnd.toISOString().split("T")[0];

//     // Check if already registered
//     const [existing] = await pool.query(
//       `SELECT id FROM warranty_registrations WHERE order_item_id = ?`,
//       [order_item_id],
//     );
//     if (existing.length) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Warranty already registered" });
//     }

//     await pool.query(
//       `INSERT INTO warranty_registrations (user_id, order_item_id, warranty_end_date, warranty_number, status)
//        VALUES (?, ?, ?, ?, 'active')`,
//       [userId, order_item_id, warrantyEndDate, warranty_number],
//     );

//     res.status(201).json({ success: true, message: "Warranty registered" });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };

// // Customer: get my warranty registrations
// export const getUserWarranties = async (req, res) => {
//   const userId = req.user.id;
//   const page = parseInt(req.query.page) || 1;
//   const limit = parseInt(req.query.limit) || 10;
//   const offset = (page - 1) * limit;

//   try {
//     const [countResult] = await pool.query(
//       `SELECT COUNT(*) as total FROM warranty_registrations WHERE user_id = ?`,
//       [userId],
//     );
//     const totalItems = countResult[0].total;
//     const totalPages = Math.ceil(totalItems / limit);

//     const [warranties] = await pool.query(
//       `SELECT w.*, oi.product_data_snapshot, o.id AS order_number
//        FROM warranty_registrations w
//        JOIN order_items oi ON w.order_item_id = oi.id
//        JOIN orders o ON oi.order_id = o.id
//        WHERE w.user_id = ?
//        ORDER BY w.registration_date DESC
//        LIMIT ? OFFSET ?`,
//       [userId, limit, offset],
//     );

//     res.json({
//       success: true,
//       data: warranties,
//       pagination: { page, limit, totalItems, totalPages },
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };

// // Admin/Staff: get all warranties
// export const getAllWarranties = async (req, res) => {
//   const page = parseInt(req.query.page) || 1;
//   const limit = parseInt(req.query.limit) || 10;
//   const offset = (page - 1) * limit;
//   const { search, status } = req.query;

//   let whereClause = "1=1";
//   const params = [];
//   if (search) {
//     whereClause += ` AND (w.warranty_number LIKE ? OR u.full_name LIKE ?)`;
//     const pattern = `%${search}%`;
//     params.push(pattern, pattern);
//   }
//   if (status) {
//     whereClause += ` AND w.status = ?`;
//     params.push(status);
//   }

//   const [countResult] = await pool.query(
//     `SELECT COUNT(*) as total FROM warranty_registrations w JOIN users u ON w.user_id = u.id WHERE ${whereClause}`,
//     params,
//   );
//   const totalItems = countResult[0].total;
//   const totalPages = Math.ceil(totalItems / limit);

//   const [warranties] = await pool.query(
//     `SELECT w.*, u.full_name, o.id AS order_number
//      FROM warranty_registrations w
//      JOIN users u ON w.user_id = u.id
//      JOIN order_items oi ON w.order_item_id = oi.id
//      JOIN orders o ON oi.order_id = o.id
//      WHERE ${whereClause}
//      ORDER BY w.registration_date DESC
//      LIMIT ? OFFSET ?`,
//     [...params, limit, offset],
//   );

//   res.json({
//     success: true,
//     data: warranties,
//     pagination: { page, limit, totalItems, totalPages },
//   });
// };

// // Admin/Staff: update warranty status (e.g., to 'claimed')
// export const updateWarrantyStatus = async (req, res) => {
//   const { id } = req.params;
//   const { status } = req.body;
//   if (!["active", "expired", "claimed"].includes(status)) {
//     return res.status(400).json({ success: false, message: "Invalid status" });
//   }

//   try {
//     await pool.query(
//       `UPDATE warranty_registrations SET status = ? WHERE id = ?`,
//       [status, id],
//     );
//     res.json({ success: true, message: "Warranty status updated" });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };

import { pool } from "../config/db.js";

export const getMyWarrantyItems = async (req, res) => {
  const userId = req.user.id;

  try {
    const [items] = await pool.query(
      `
      SELECT
        oi.id AS order_item_id,
        oi.order_id,
        oi.product_id,
        oi.quantity,
        oi.claimed_quantity,
        oi.warranty_claimed_at,

        o.order_status,
        o.delivered_at,

        p.name AS product_name,
        p.sku,
        p.warranty_months,

        DATE_ADD(o.delivered_at, INTERVAL p.warranty_months MONTH) AS warranty_end_date,

        CASE
          WHEN p.warranty_months IS NULL THEN 'no_warranty'
          WHEN o.delivered_at IS NULL THEN 'not_delivered'
          WHEN CURDATE() > DATE_ADD(o.delivered_at, INTERVAL p.warranty_months MONTH) THEN 'expired'
          WHEN oi.claimed_quantity >= oi.quantity THEN 'fully_claimed'
          WHEN oi.claimed_quantity > 0 THEN 'partial'
          ELSE 'active'
        END AS warranty_status

      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN product p ON p.id = oi.product_id

      WHERE o.user_id = ?
        AND o.order_status = 'delivered'
        AND p.warranty_months IS NOT NULL

      ORDER BY o.delivered_at DESC
      `,
      [userId],
    );

    res.json({ success: true, data: items });
  } catch (error) {
    console.error("Get warranty items error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const claimWarranty = async (req, res) => {
  const userId = req.user.id;
  const { orderItemId } = req.params;
  const claimQuantity = Number(req.body.claim_quantity || 1);

  if (!claimQuantity || claimQuantity <= 0) {
    return res.status(400).json({
      success: false,
      message: "Valid claim_quantity is required",
    });
  }

  try {
    const [rows] = await pool.query(
      `
      SELECT
        oi.id,
        oi.quantity,
        oi.claimed_quantity,

        o.order_status,
        o.delivered_at,

        p.warranty_months,

        DATE_ADD(o.delivered_at, INTERVAL p.warranty_months MONTH) AS warranty_end_date

      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN product p ON p.id = oi.product_id

      WHERE oi.id = ?
        AND o.user_id = ?
      `,
      [orderItemId, userId],
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Order item not found",
      });
    }

    const item = rows[0];

    if (item.order_status !== "delivered") {
      return res.status(400).json({
        success: false,
        message: "Warranty can be claimed only after delivery",
      });
    }
    console.log(item);

    if (!item.warranty_months) {
      return res.status(400).json({
        success: false,
        message: "This product has no warranty",
      });
    }

    const today = new Date();
    const warrantyEndDate = new Date(item.warranty_end_date);

    if (today > warrantyEndDate) {
      return res.status(400).json({
        success: false,
        message: "Warranty has expired",
      });
    }

    const remainingQuantity = item.quantity - item.claimed_quantity;

    if (claimQuantity > remainingQuantity) {
      return res.status(400).json({
        success: false,
        message: `You can claim only ${remainingQuantity} item(s)`,
      });
    }

    await pool.query(
      `
      UPDATE order_items
      SET claimed_quantity = claimed_quantity + ?,
          warranty_claimed_at = NOW()
      WHERE id = ?
      `,
      [claimQuantity, orderItemId],
    );

    res.json({
      success: true,
      message: "Warranty claimed successfully",
    });
  } catch (error) {
    console.error("Claim warranty error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
// For Admin
export const getClaimedWarrantyItemsAdmin = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;

    // Total count
    const [[{ total }]] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM order_items oi
      WHERE oi.claimed_quantity > 0
      `,
    );

    // Data
    const [items] = await pool.query(
      `
     SELECT
        -- Order item details
        oi.id AS order_item_id,
        oi.order_id,
        oi.product_id,
        oi.quantity,
        oi.claimed_quantity,
        oi.warranty_claimed_at,
        oi.unit_price,
        oi.total_price,

        -- Order details
        o.id AS order_id,
        o.order_status,
        o.payment_status,
        o.subtotal,
        o.shipping_cost,
        o.tax_amount,
        o.discount_amount,
        o.total_amount,
        o.delivered_at,
        o.order_date AS order_created_at,

        -- Customer details
        u.id AS user_id,
        u.full_name AS customer_name,
        u.email AS customer_email,
        u.phone AS customer_phone,

        -- Product details
        p.id AS product_id,
        p.name AS product_name,
        p.slug AS product_slug,
        p.sku,
        p.price AS product_price,
        p.warranty_months,

        -- Category / brand details
        c.name AS category_name,
        sc.name AS sub_category_name,
        b.name AS brand_name,

        -- Warranty calculated details
        DATE_ADD(o.delivered_at, INTERVAL p.warranty_months MONTH) AS warranty_end_date,

        CASE
          WHEN p.warranty_months IS NULL THEN 'no_warranty'
          WHEN o.delivered_at IS NULL THEN 'not_delivered'
          WHEN CURDATE() > DATE_ADD(o.delivered_at, INTERVAL p.warranty_months MONTH) THEN 'expired'
          WHEN oi.claimed_quantity >= oi.quantity THEN 'fully_claimed'
          WHEN oi.claimed_quantity > 0 THEN 'partial'
          ELSE 'active'
        END AS warranty_status,

        GREATEST(oi.quantity - oi.claimed_quantity, 0) AS remaining_claim_quantity

      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN users u ON u.id = o.user_id
      JOIN product p ON p.id = oi.product_id

      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN subcategory sc ON sc.id = p.sub_category_id
      LEFT JOIN brands b ON b.id = p.brand_id

      WHERE oi.claimed_quantity > 0

      ORDER BY oi.warranty_claimed_at DESC
      `,
      [limit, offset],
    );

    res.json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        totalItems: total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get claimed warranties error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
