// controllers/admin/couponAdmin.controller.js
import { pool } from "../config/db.js";
import { logAudit } from "../lib/auditLog.js";
import crypto from "crypto";

// Helper: generate unique coupon code
const generateCouponCode = (prefix = "") => {
  const random = crypto.randomBytes(4).toString("hex").toUpperCase();
  return prefix ? `${prefix}${random}` : `COUPON${random}`;
};

// ========== CREATE A COUPON TEMPLATE (master record) ==========
// export const createCouponTemplate = async (req, res) => {
//   const {
//     discount_type,
//     discount_value,
//     min_order_amount,
//     max_discount_amount,
//     total_usage_limit,
//     valid_from,
//     valid_to,
//     description,
//     code,
//   } = req.body;
//   if (!discount_type || !discount_value || !valid_from || !valid_to || !code) {
//     return res
//       .status(400)
//       .json({ success: false, message: "Missing required fields" });
//   }
//   try {
//     const validFrom = new Date(valid_from);
//     const validTo = new Date(valid_to);

//     const [result] = await pool.query(
//       `INSERT INTO coupons
//              (code, discount_type, discount_value, min_order_amount, max_discount_amount,
//               usage_limit_per_user, total_usage_limit, valid_from, valid_to, description, created_by_user_id)
//              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         code,
//         discount_type,
//         discount_value,
//         min_order_amount || 0,
//         max_discount_amount || null,
//         1,
//         total_usage_limit || null,
//         validFrom,
//         validTo,
//         description || null,
//         req.user.id,
//       ],
//     );
//     await logAudit({
//       userId: req.user.id,
//       action: "CREATE_COUPON_TEMPLATE",
//       tableName: "coupons",
//       recordId: result.insertId,
//       oldData: null,
//       newData: { code, discount_type, discount_value },
//       req,
//     });
//     res
//       .status(201)
//       .json({ success: true, data: { id: result.insertId, code } });
//   } catch (error) {
//     console.error(error);
//     res
//       .status(500)
//       .json({ success: false, message: "Failed to create coupon" });
//   }
// };
export const createCouponTemplate = async (req, res) => {
  const {
    discount_type,
    discount_value,
    min_order_amount,
    max_discount_amount,
    total_usage_limit,
    valid_from,
    valid_to,
    description,
    code,
  } = req.body;

  if (
    !discount_type ||
    discount_value === undefined ||
    !valid_from ||
    !valid_to ||
    !code
  ) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields",
    });
  }

  try {
    // Expected input: YYYY-MM-DD
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    if (!datePattern.test(valid_from) || !datePattern.test(valid_to)) {
      return res.status(400).json({
        success: false,
        message: "Dates must be in YYYY-MM-DD format",
      });
    }

    // Valid for the complete selected day
    const validFrom = `${valid_from} 00:00:00`;
    const validTo = `${valid_to} 23:59:59`;

    if (valid_to < valid_from) {
      return res.status(400).json({
        success: false,
        message: "valid_to cannot be before valid_from",
      });
    }

    const normalizedCode = code.trim().toUpperCase();

    const [result] = await pool.query(
      `INSERT INTO coupons (
        code,
        discount_type,
        discount_value,
        min_order_amount,
        max_discount_amount,
        usage_limit_per_user,
        total_usage_limit,
        valid_from,
        valid_to,
        description,
        created_by_user_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizedCode,
        discount_type,
        Number(discount_value),
        Number(min_order_amount || 0),
        max_discount_amount !== undefined &&
        max_discount_amount !== null &&
        max_discount_amount !== ""
          ? Number(max_discount_amount)
          : null,
        1,
        total_usage_limit !== undefined &&
        total_usage_limit !== null &&
        total_usage_limit !== ""
          ? Number(total_usage_limit)
          : null,
        validFrom,
        validTo,
        description?.trim() || null,
        req.user.id,
      ],
    );

    await logAudit({
      userId: req.user.id,
      action: "CREATE_COUPON_TEMPLATE",
      tableName: "coupons",
      recordId: result.insertId,
      oldData: null,
      newData: {
        code: normalizedCode,
        discount_type,
        discount_value,
        valid_from: validFrom,
        valid_to: validTo,
      },
      req,
    });

    return res.status(201).json({
      success: true,
      message: "Coupon created successfully",
      data: {
        id: result.insertId,
        code: normalizedCode,
        valid_from: validFrom,
        valid_to: validTo,
      },
    });
  } catch (error) {
    console.error("Create coupon error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create coupon",
      error: error.message,
    });
  }
};

// export const updateCouponTemplate = async (req, res) => {
//   const { id } = req.params;

//   const {
//     discount_type,
//     discount_value,
//     min_order_amount,
//     max_discount_amount,
//     total_usage_limit,
//     valid_from,
//     valid_to,
//     description,
//     code,
//   } = req.body;

//   if (!discount_type || !discount_value || !valid_from || !valid_to) {
//     return res.status(400).json({
//       success: false,
//       message: "Missing required fields",
//     });
//   }

//   try {
//     // Check coupon exists
//     const [[existingCoupon]] = await pool.query(
//       "SELECT * FROM coupons WHERE id = ?",
//       [id],
//     );

//     if (!existingCoupon) {
//       return res.status(404).json({
//         success: false,
//         message: "Coupon not found",
//       });
//     }

//     // Prevent duplicate code
//     if (code) {
//       const [[duplicate]] = await pool.query(
//         "SELECT id FROM coupons WHERE code = ? AND id != ?",
//         [code, id],
//       );

//       if (duplicate) {
//         return res.status(400).json({
//           success: false,
//           message: "Coupon code already exists",
//         });
//       }
//     }

//     const validFrom = new Date(valid_from);
//     const validTo = new Date(valid_to);

//     await pool.query(
//       `UPDATE coupons
//        SET
//          code = ?,
//          discount_type = ?,
//          discount_value = ?,
//          min_order_amount = ?,
//          max_discount_amount = ?,
//          total_usage_limit = ?,
//          valid_from = ?,
//          valid_to = ?,
//          description = ?
//        WHERE id = ?`,
//       [
//         code || existingCoupon.code,
//         discount_type,
//         discount_value,
//         min_order_amount || 0,
//         max_discount_amount || null,
//         total_usage_limit || null,
//         validFrom,
//         validTo,
//         description || null,
//         id,
//       ],
//     );

//     await logAudit({
//       userId: req.user.id,
//       action: "UPDATE_COUPON_TEMPLATE",
//       tableName: "coupons",
//       recordId: id,
//       oldData: existingCoupon,
//       newData: {
//         ...existingCoupon,
//         code: code || existingCoupon.code,
//         discount_type,
//         discount_value,
//         min_order_amount: min_order_amount || 0,
//         max_discount_amount: max_discount_amount || null,
//         total_usage_limit: total_usage_limit || null,
//         valid_from: validFrom,
//         valid_to: validTo,
//         description: description || null,
//       },
//       req,
//     });

//     res.json({
//       success: true,
//       message: "Coupon updated successfully",
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to update coupon",
//     });
//   }
// };

// ========== GET ALL COUPON TEMPLATES (admin) ==========

export const updateCouponTemplate = async (req, res) => {
  const couponId = Number(req.params.id);

  const {
    discount_type,
    discount_value,
    min_order_amount,
    max_discount_amount,
    total_usage_limit,
    valid_from,
    valid_to,
    description,
    code,
  } = req.body;

  if (!Number.isInteger(couponId) || couponId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Valid coupon ID is required",
    });
  }

  if (
    !discount_type ||
    discount_value === undefined ||
    discount_value === null ||
    valid_from === undefined ||
    valid_to === undefined
  ) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields",
    });
  }

  if (!["percentage", "fixed"].includes(discount_type)) {
    return res.status(400).json({
      success: false,
      message: "discount_type must be percentage or fixed",
    });
  }

  const discountValue = Number(discount_value);

  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return res.status(400).json({
      success: false,
      message: "discount_value must be greater than 0",
    });
  }

  try {
    const [[existingCoupon]] = await pool.query(
      `SELECT *
       FROM coupons
       WHERE id = ?
       LIMIT 1`,
      [couponId],
    );

    if (!existingCoupon) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
      });
    }

    const normalizedCode = code
      ? String(code).trim().toUpperCase()
      : existingCoupon.code;

    if (!normalizedCode) {
      return res.status(400).json({
        success: false,
        message: "Coupon code is required",
      });
    }

    const [[duplicate]] = await pool.query(
      `SELECT id
       FROM coupons
       WHERE code = ?
         AND id != ?
       LIMIT 1`,
      [normalizedCode, couponId],
    );

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "Coupon code already exists",
      });
    }

    /*
     * Supports values such as:
     * 2026-07-14
     * 2026-07-14T00:00
     * 2026-07-14T00:00:00.000Z
     * 2026-07-14 00:00:00
     */
    const fromDate = String(valid_from).slice(0, 10);
    const toDate = String(valid_to).slice(0, 10);

    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    if (!datePattern.test(fromDate) || !datePattern.test(toDate)) {
      return res.status(400).json({
        success: false,
        message: "Dates must use YYYY-MM-DD format",
      });
    }

    if (toDate < fromDate) {
      return res.status(400).json({
        success: false,
        message: "valid_to cannot be before valid_from",
      });
    }

    // Make the coupon valid for the complete selected date range
    const validFromDateTime = `${fromDate} 00:00:00`;
    const validToDateTime = `${toDate} 23:59:59`;

    const minOrderAmount =
      min_order_amount !== undefined &&
      min_order_amount !== null &&
      min_order_amount !== ""
        ? Number(min_order_amount)
        : 0;

    const maxDiscountAmount =
      max_discount_amount !== undefined &&
      max_discount_amount !== null &&
      max_discount_amount !== ""
        ? Number(max_discount_amount)
        : null;

    const totalUsageLimit =
      total_usage_limit !== undefined &&
      total_usage_limit !== null &&
      total_usage_limit !== ""
        ? Number(total_usage_limit)
        : null;

    if (!Number.isFinite(minOrderAmount) || minOrderAmount < 0) {
      return res.status(400).json({
        success: false,
        message: "min_order_amount must be 0 or greater",
      });
    }

    if (
      maxDiscountAmount !== null &&
      (!Number.isFinite(maxDiscountAmount) || maxDiscountAmount < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "max_discount_amount must be 0 or greater",
      });
    }

    if (
      totalUsageLimit !== null &&
      (!Number.isInteger(totalUsageLimit) || totalUsageLimit <= 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "total_usage_limit must be a positive integer",
      });
    }

    const updatedCoupon = {
      code: normalizedCode,
      discount_type,
      discount_value: discountValue,
      min_order_amount: minOrderAmount,
      max_discount_amount: maxDiscountAmount,
      total_usage_limit: totalUsageLimit,
      valid_from: validFromDateTime,
      valid_to: validToDateTime,
      description: description?.trim() || null,
    };

    await pool.query(
      `UPDATE coupons
       SET
         code = ?,
         discount_type = ?,
         discount_value = ?,
         min_order_amount = ?,
         max_discount_amount = ?,
         total_usage_limit = ?,
         valid_from = ?,
         valid_to = ?,
         description = ?
       WHERE id = ?`,
      [
        updatedCoupon.code,
        updatedCoupon.discount_type,
        updatedCoupon.discount_value,
        updatedCoupon.min_order_amount,
        updatedCoupon.max_discount_amount,
        updatedCoupon.total_usage_limit,
        updatedCoupon.valid_from,
        updatedCoupon.valid_to,
        updatedCoupon.description,
        couponId,
      ],
    );

    await logAudit({
      userId: req.user.id,
      action: "UPDATE_COUPON_TEMPLATE",
      tableName: "coupons",
      recordId: couponId,
      oldData: existingCoupon,
      newData: {
        ...existingCoupon,
        ...updatedCoupon,
      },
      req,
    });

    return res.status(200).json({
      success: true,
      message: "Coupon updated successfully",
      data: {
        id: couponId,
        ...updatedCoupon,
      },
    });
  } catch (error) {
    console.error("Update coupon error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update coupon",
      error: error.message,
    });
  }
};

export const getAllCouponTemplates = async (req, res) => {
  try {
    // Pagination
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;

    // Filters
    const { search, status } = req.query;

    let whereClause = "WHERE 1=1";
    const params = [];

    // Status filter
    if (status) {
      if (status === "active") {
        whereClause += " AND is_active = ?";
        params.push(1);
      } else if (status === "inactive") {
        whereClause += " AND is_active = ?";
        params.push(0);
      }
    }

    // Search filter
    if (search && search.trim()) {
      whereClause += " AND code LIKE ?";
      params.push(`%${search.trim()}%`);
    }

    // Count query
    const [countResult] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM coupons
       ${whereClause}`,
      params,
    );

    const total = countResult[0].total;

    // Data query
    const [rows] = await pool.query(
      `SELECT *
       FROM coupons
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// export const getCouponById = async (req, res) => {
//   const couponId = Number(req.params.id);

//   if (!Number.isInteger(couponId) || couponId <= 0) {
//     return res.status(400).json({
//       success: false,
//       message: "Valid coupon ID is required",
//     });
//   }

//   try {
//     const [couponRows] = await pool.query(
//       `SELECT
//         c.id,
//         c.code,
//         c.discount_type,
//         c.discount_value,
//         c.min_order_amount,
//         c.max_discount_amount,
//         c.usage_limit_per_user,
//         c.total_usage_limit,
//         c.valid_from,
//         c.valid_to,
//         c.description,
//         c.is_active,
//         c.created_by_user_id,
//         c.created_at,
//         c.updated_at,

//         CASE
//           WHEN c.is_active = 0 THEN 'inactive'
//           WHEN NOW() < c.valid_from THEN 'upcoming'
//           WHEN NOW() > c.valid_to THEN 'expired'
//           ELSE 'active'
//         END AS coupon_status,

//         COUNT(DISTINCT o.id) AS total_used,
//         COUNT(DISTINCT o.user_id) AS unique_users,
//         COALESCE(SUM(o.discount_amount), 0) AS total_discount_given

//        FROM coupons c

//        LEFT JOIN orders o
//          ON o.coupon_id = c.id

//        WHERE c.id = ?

//        GROUP BY
//         c.id,
//         c.code,
//         c.discount_type,
//         c.discount_value,
//         c.min_order_amount,
//         c.max_discount_amount,
//         c.usage_limit_per_user,
//         c.total_usage_limit,
//         c.valid_from,
//         c.valid_to,
//         c.description,
//         c.is_active,
//         c.created_by_user_id,
//         c.created_at,
//         c.updated_at

//        LIMIT 1`,
//       [couponId],
//     );

//     if (couponRows.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: "Coupon not found",
//       });
//     }

//     const coupon = couponRows[0];

//     const [usageRows] = await pool.query(
//       `SELECT
//         o.id AS order_id,
//         o.user_id,
//         o.order_status,
//         o.order_date,
//         o.subtotal,
//         o.shipping_cost,
//         o.tax_amount,
//         o.discount_amount,
//         o.total_amount,
//         o.currency_code,
//         o.payment_method,
//         o.payment_status,

//         u.full_name AS customer_name,
//         u.email AS customer_email,
//         u.phone AS customer_phone,

//         oi.id AS order_item_id,
//         oi.product_id,
//         oi.quantity,
//         oi.unit_price,
//         oi.total_price,
//         oi.product_data_snapshot,

//         p.name AS product_name

//        FROM orders o

//        INNER JOIN users u
//          ON u.id = o.user_id

//        LEFT JOIN order_items oi
//          ON oi.order_id = o.id

//        LEFT JOIN products p
//          ON p.id = oi.product_id

//        WHERE o.coupon_id = ?

//        ORDER BY o.order_date DESC, o.id DESC, oi.id ASC`,
//       [couponId],
//     );

//     const orderMap = new Map();

//     for (const row of usageRows) {
//       if (!orderMap.has(row.order_id)) {
//         orderMap.set(row.order_id, {
//           order_id: row.order_id,
//           coupon_used_at: row.order_date,

//           customer: {
//             id: row.user_id,
//             full_name: row.customer_name,
//             email: row.customer_email,
//             phone: row.customer_phone,
//           },

//           order: {
//             order_status: row.order_status,
//             payment_status: row.payment_status,
//             payment_method: row.payment_method,
//             currency_code: row.currency_code,
//             subtotal: Number(row.subtotal || 0),
//             shipping_cost: Number(row.shipping_cost || 0),
//             tax_amount: Number(row.tax_amount || 0),
//             discount_amount: Number(row.discount_amount || 0),
//             total_amount: Number(row.total_amount || 0),
//           },

//           products: [],
//         });
//       }

//       if (row.order_item_id) {
//         let snapshot = row.product_data_snapshot;

//         if (typeof snapshot === "string") {
//           try {
//             snapshot = JSON.parse(snapshot);
//           } catch {
//             snapshot = null;
//           }
//         }

//         orderMap.get(row.order_id).products.push({
//           order_item_id: row.order_item_id,
//           product_id: row.product_id,
//           product_name:
//             snapshot?.product_name ||
//             snapshot?.name ||
//             row.product_name ||
//             "Product unavailable",
//           sku: snapshot?.sku || row.product_sku || null,
//           quantity: Number(row.quantity || 0),
//           unit_price: Number(row.unit_price || 0),
//           total_price: Number(row.total_price || 0),
//         });
//       }
//     }

//     const usageHistory = Array.from(orderMap.values());

//     const usedByMap = new Map();

//     for (const usage of usageHistory) {
//       const userId = usage.customer.id;

//       if (!usedByMap.has(userId)) {
//         usedByMap.set(userId, {
//           user_id: userId,
//           full_name: usage.customer.full_name,
//           email: usage.customer.email,
//           phone: usage.customer.phone,
//           total_orders: 0,
//           total_discount_received: 0,
//           orders: [],
//         });
//       }

//       const user = usedByMap.get(userId);

//       user.total_orders += 1;
//       user.total_discount_received += usage.order.discount_amount;

//       user.orders.push({
//         order_id: usage.order_id,
//         coupon_used_at: usage.coupon_used_at,
//         order_status: usage.order.order_status,
//         payment_status: usage.order.payment_status,
//         discount_amount: usage.order.discount_amount,
//         total_amount: usage.order.total_amount,
//         products: usage.products,
//       });
//     }

//     const usedBy = Array.from(usedByMap.values());

//     coupon.discount_value = Number(coupon.discount_value);
//     coupon.min_order_amount = Number(coupon.min_order_amount);

//     coupon.max_discount_amount =
//       coupon.max_discount_amount !== null
//         ? Number(coupon.max_discount_amount)
//         : null;

//     coupon.total_usage_limit =
//       coupon.total_usage_limit !== null
//         ? Number(coupon.total_usage_limit)
//         : null;

//     coupon.is_active = Boolean(coupon.is_active);
//     coupon.total_used = Number(coupon.total_used || 0);
//     coupon.unique_users = Number(coupon.unique_users || 0);
//     coupon.total_discount_given = Number(coupon.total_discount_given || 0);

//     const remainingUsage =
//       coupon.total_usage_limit !== null
//         ? Math.max(coupon.total_usage_limit - coupon.total_used, 0)
//         : null;

//     return res.status(200).json({
//       success: true,
//       message: "Coupon details fetched successfully",
//       data: {
//         coupon: {
//           ...coupon,
//           remaining_usage: remainingUsage,
//         },

//         usage_summary: {
//           total_used: coupon.total_used,
//           unique_users: usedBy.length,
//           total_discount_given: coupon.total_discount_given,
//           total_usage_limit: coupon.total_usage_limit,
//           remaining_usage: remainingUsage,
//         },

//         used_by: usedBy,

//         usage_history: usageHistory,
//       },
//     });
//   } catch (error) {
//     console.error("Get coupon details error:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch coupon details",
//       error: error.message,
//     });
//   }
// };

// ========== GET USER'S COUPONS (admin view) ==========

export const getCouponById = async (req, res) => {
  const couponId = Number(req.params.id);

  if (!Number.isInteger(couponId) || couponId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Valid coupon ID is required",
    });
  }

  try {
    // Get coupon and overall usage summary
    const [couponRows] = await pool.query(
      `SELECT
        c.id,
        c.code,
        c.discount_type,
        c.discount_value,
        c.min_order_amount,
        c.max_discount_amount,
        c.usage_limit_per_user,
        c.total_usage_limit,
        c.valid_from,
        c.valid_to,
        c.description,
        c.is_active,
        c.created_by_user_id,
        c.created_at,
        c.updated_at,

        CASE
          WHEN c.is_active = 0 THEN 'inactive'
          WHEN NOW() < c.valid_from THEN 'upcoming'
          WHEN NOW() > c.valid_to THEN 'expired'
          ELSE 'active'
        END AS coupon_status,

        COUNT(DISTINCT o.id) AS total_used,
        COUNT(DISTINCT o.user_id) AS unique_users,
        COALESCE(SUM(o.discount_amount), 0) AS total_discount_given

      FROM coupons c

      LEFT JOIN orders o
        ON o.coupon_id = c.id

      WHERE c.id = ?

      GROUP BY
        c.id,
        c.code,
        c.discount_type,
        c.discount_value,
        c.min_order_amount,
        c.max_discount_amount,
        c.usage_limit_per_user,
        c.total_usage_limit,
        c.valid_from,
        c.valid_to,
        c.description,
        c.is_active,
        c.created_by_user_id,
        c.created_at,
        c.updated_at

      LIMIT 1`,
      [couponId],
    );

    if (couponRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
      });
    }

    const coupon = couponRows[0];

    // Get all orders and products that used this coupon
    const [usageRows] = await pool.query(
      `SELECT
        o.id AS order_id,
        o.user_id,
        o.order_status,
        o.order_date,
        o.subtotal,
        o.shipping_cost,
        o.tax_amount,
        o.discount_amount,
        o.total_amount,
        o.currency_code,
        o.payment_method,
        o.payment_status,
        o.razorpay_order_id,
        o.razorpay_payment_id,

        u.full_name AS customer_name,
        u.email AS customer_email,
        u.phone AS customer_phone,

        oi.id AS order_item_id,
        oi.product_id,
        oi.quantity,
        oi.unit_price,
        oi.total_price,
        oi.product_data_snapshot,

        p.name AS product_name
       

      FROM orders o

      INNER JOIN users u
        ON u.id = o.user_id

      LEFT JOIN order_items oi
        ON oi.order_id = o.id

      LEFT JOIN products p
        ON p.id = oi.product_id

      WHERE o.coupon_id = ?

      ORDER BY
        o.order_date DESC,
        o.id DESC,
        oi.id ASC`,
      [couponId],
    );

    /*
     * One order can contain multiple order items.
     * Group the repeated SQL rows into one order object.
     */
    const orderMap = new Map();

    for (const row of usageRows) {
      if (!orderMap.has(row.order_id)) {
        orderMap.set(row.order_id, {
          order_id: row.order_id,
          coupon_used_at: row.order_date,

          customer: {
            id: row.user_id,
            full_name: row.customer_name,
            email: row.customer_email,
            phone: row.customer_phone,
          },

          order: {
            order_status: row.order_status,
            payment_status: row.payment_status,
            payment_method: row.payment_method,
            currency_code: row.currency_code,

            subtotal: Number(row.subtotal || 0),
            shipping_cost: Number(row.shipping_cost || 0),
            tax_amount: Number(row.tax_amount || 0),
            discount_amount: Number(row.discount_amount || 0),
            total_amount: Number(row.total_amount || 0),

            razorpay_order_id: row.razorpay_order_id,
            razorpay_payment_id: row.razorpay_payment_id,
          },

          products: [],
        });
      }

      if (row.order_item_id) {
        let snapshot = row.product_data_snapshot;

        if (typeof snapshot === "string") {
          try {
            snapshot = JSON.parse(snapshot);
          } catch {
            snapshot = null;
          }
        }

        orderMap.get(row.order_id).products.push({
          order_item_id: row.order_item_id,
          product_id: row.product_id,

          product_name:
            snapshot?.product_name ||
            snapshot?.name ||
            row.product_name ||
            "Product unavailable",

          sku: snapshot?.sku || row.product_sku || null,

          quantity: Number(row.quantity || 0),
          unit_price: Number(row.unit_price || 0),
          total_price: Number(row.total_price || 0),
        });
      }
    }

    const usageHistory = Array.from(orderMap.values());

    // Group coupon usage by customer
    const usedByMap = new Map();

    for (const usage of usageHistory) {
      const userId = usage.customer.id;

      if (!usedByMap.has(userId)) {
        usedByMap.set(userId, {
          user_id: userId,
          full_name: usage.customer.full_name,
          email: usage.customer.email,
          phone: usage.customer.phone,
          total_orders: 0,
          total_order_amount: 0,
          total_discount_received: 0,
          orders: [],
        });
      }

      const user = usedByMap.get(userId);

      user.total_orders += 1;
      user.total_order_amount += usage.order.total_amount;
      user.total_discount_received += usage.order.discount_amount;

      user.orders.push({
        order_id: usage.order_id,
        coupon_used_at: usage.coupon_used_at,
        order_status: usage.order.order_status,
        payment_status: usage.order.payment_status,
        payment_method: usage.order.payment_method,
        currency_code: usage.order.currency_code,
        discount_amount: usage.order.discount_amount,
        total_amount: usage.order.total_amount,
        products: usage.products,
      });
    }

    const usedBy = Array.from(usedByMap.values()).map((user) => ({
      ...user,
      total_order_amount: Number(user.total_order_amount.toFixed(2)),
      total_discount_received: Number(user.total_discount_received.toFixed(2)),
    }));

    // Convert MySQL decimal and tinyint values
    coupon.discount_value = Number(coupon.discount_value || 0);
    coupon.min_order_amount = Number(coupon.min_order_amount || 0);

    coupon.max_discount_amount =
      coupon.max_discount_amount !== null
        ? Number(coupon.max_discount_amount)
        : null;

    coupon.usage_limit_per_user = Number(coupon.usage_limit_per_user || 0);

    coupon.total_usage_limit =
      coupon.total_usage_limit !== null
        ? Number(coupon.total_usage_limit)
        : null;

    coupon.is_active = Boolean(coupon.is_active);
    coupon.total_used = Number(coupon.total_used || 0);
    coupon.unique_users = Number(coupon.unique_users || 0);
    coupon.total_discount_given = Number(coupon.total_discount_given || 0);

    const remainingUsage =
      coupon.total_usage_limit !== null
        ? Math.max(coupon.total_usage_limit - coupon.total_used, 0)
        : null;

    return res.status(200).json({
      success: true,
      message: "Coupon details fetched successfully",
      data: {
        coupon: {
          ...coupon,
          remaining_usage: remainingUsage,
        },

        usage_summary: {
          total_used: coupon.total_used,
          unique_users: coupon.unique_users,
          total_discount_given: coupon.total_discount_given,
          total_usage_limit: coupon.total_usage_limit,
          remaining_usage: remainingUsage,
        },

        // Customer-wise usage details
        used_by: usedBy,

        // Order-wise usage details
        usage_history: usageHistory,
      },
    });
  } catch (error) {
    console.error("Get coupon details error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch coupon details",
      error: error.message,
    });
  }
};

export const getUserCouponsAdmin = async (req, res) => {
  const { userId } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT c.*,
              COALESCE((
                SELECT COUNT(*) FROM orders 
                WHERE orders.coupon_id = c.id AND orders.user_id = ?
              ), 0) AS times_used_by_user,
              COALESCE((
                SELECT COUNT(*) FROM orders 
                WHERE orders.coupon_id = c.id
              ), 0) AS times_used_globally
       FROM coupons c
       ORDER BY c.created_at DESC`,
      [userId],
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getUserCoupons = async (req, res) => {
  const userId = req.user.id;
  try {
    const [rows] = await pool.query(
      `SELECT c.id as coupon_id, c.code, c.discount_type, c.discount_value,
              c.min_order_amount, c.max_discount_amount, c.description,
              c.usage_limit_per_user, c.total_usage_limit,
              c.valid_from, c.valid_to,
              COALESCE((
                SELECT COUNT(*) FROM orders 
                WHERE orders.coupon_id = c.id AND orders.user_id = ?
              ), 0) AS times_used_by_user,
              COALESCE((
                SELECT COUNT(*) FROM orders 
                WHERE orders.coupon_id = c.id
              ), 0) AS times_used_globally
       FROM coupons c
       WHERE c.is_active = 1
         AND c.valid_from <= NOW() 
         AND c.valid_to >= NOW()
       ORDER BY c.valid_from ASC`,
      [userId],
    );

    // Filter coupons where user can still use them (if per-user limit exists)
    const availableCoupons = rows.filter((coupon) => {
      if (
        coupon.usage_limit_per_user !== null &&
        coupon.times_used_by_user >= coupon.usage_limit_per_user
      ) {
        return false;
      }
      if (
        coupon.total_usage_limit !== null &&
        coupon.times_used_globally >= coupon.total_usage_limit
      ) {
        return false;
      }
      return true;
    });

    res.json({ success: true, data: availableCoupons });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
export const applyCoupon = async (req, res) => {
  const userId = req.user.id;
  const { coupon_code, order_subtotal } = req.body;
  console.log(coupon_code);

  if (!coupon_code || order_subtotal === undefined) {
    return res.status(400).json({
      success: false,
      message: "Coupon code and order subtotal are required",
    });
  }

  try {
    // Fetch coupon details
    const [couponRows] = await pool.query(
      `SELECT * FROM coupons
       WHERE code = ? 
         AND is_active = 1
         AND valid_from <= NOW() 
         AND valid_to >= NOW()`,
      [coupon_code],
    );

    if (couponRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired coupon",
      });
    }

    const coupon = couponRows[0];

    // Check per‑user usage limit
    if (coupon.usage_limit_per_user !== null) {
      const [userUsage] = await pool.query(
        `SELECT COUNT(*) as count FROM orders
         WHERE user_id = ? AND coupon_id = ?`,
        [userId, coupon.id],
      );
      if (userUsage[0].count >= coupon.usage_limit_per_user) {
        return res.status(400).json({
          success: false,
          message: `You have already used this coupon ${coupon.usage_limit_per_user} time(s)`,
        });
      }
    }

    // Check global total usage limit
    if (coupon.total_usage_limit !== null) {
      const [globalUsage] = await pool.query(
        `SELECT COUNT(*) as count FROM orders WHERE coupon_id = ?`,
        [coupon.id],
      );
      if (globalUsage[0].count >= coupon.total_usage_limit) {
        return res.status(400).json({
          success: false,
          message: "This coupon has reached its global usage limit",
        });
      }
    }

    // Minimum order amount check
    if (order_subtotal < coupon.min_order_amount) {
      return res.status(400).json({
        success: false,
        message: `This coupon requires a minimum order amount of ₹${coupon.min_order_amount}`,
      });
    }

    // Calculate discount
    let discountAmount = 0;
    if (coupon.discount_type === "percentage") {
      discountAmount = (order_subtotal * coupon.discount_value) / 100;
      if (
        coupon.max_discount_amount &&
        discountAmount > coupon.max_discount_amount
      ) {
        discountAmount = coupon.max_discount_amount;
      }
    } else {
      discountAmount = Math.min(coupon.discount_value, order_subtotal);
    }

    console.log(discountAmount, typeof discountAmount);

    // Return success (no user_coupon_id anymore)
    res.json({
      success: true,
      discount_amount: parseFloat(discountAmount).toFixed(2),
      coupon_id: coupon.id, // changed from user_coupon_id
      coupon_code: coupon.code,
      discount_type: coupon.discount_type,
      discount_value: parseFloat(coupon.discount_value),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Server error while applying coupon",
    });
  }
};

// ========== UPDATE COUPON ACTIVE STATUS (admin) ==========

export const updateCouponStatus = async (req, res) => {
  const { id } = req.params;

  try {
    // Check if coupon exists
    const [rows] = await pool.query(
      "SELECT is_active FROM coupons WHERE id = ?",
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
      });
    }

    const oldStatus = rows[0].is_active;
    const newStatus = oldStatus === 1 ? 0 : 1;

    // Update status
    await pool.query("UPDATE coupons SET is_active = ? WHERE id = ?", [
      newStatus,
      id,
    ]);

    // Audit log
    await logAudit({
      userId: req.user.id,
      action: "UPDATE_COUPON_STATUS",
      tableName: "coupons",
      recordId: id,
      oldData: { is_active: oldStatus },
      newData: { is_active: newStatus },
      req,
    });

    return res.status(200).json({
      success: true,
      message: `Coupon ${newStatus ? "activated" : "deactivated"} successfully.`,
      data: {
        id,
        is_active: newStatus,
      },
    });
  } catch (error) {
    console.error("Error updating coupon status:", error);

    return res.status(500).json({
      success: false,
      message: "Server error while updating coupon status",
    });
  }
};

// ========== DELETE COUPON (admin) ==========
export const deleteCoupon = async (req, res) => {
  const { id } = req.params;

  try {
    // Check if coupon exists
    const [rows] = await pool.query("SELECT * FROM coupons WHERE id = ?", [id]);
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
      });
    }

    // Prevent deletion if the coupon has been used in any order
    const [orderRows] = await pool.query(
      "SELECT COUNT(*) as count FROM orders WHERE coupon_id = ?",
      [id],
    );
    if (orderRows[0].count > 0) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete coupon that has been used in orders. Consider deactivating it instead.",
      });
    }

    const oldData = rows[0];
    await pool.query("DELETE FROM coupons WHERE id = ?", [id]);

    // Log the deletion
    await logAudit({
      userId: req.user.id,
      action: "DELETE_COUPON",
      tableName: "coupons",
      recordId: id,
      oldData,
      newData: null,
      req,
    });

    res.json({
      success: true,
      message: "Coupon deleted successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Server error while deleting coupon",
    });
  }
};
