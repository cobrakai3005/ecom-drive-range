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
export const createCouponTemplate = async (req, res) => {
  const {
    discount_type,
    discount_value,
    min_order_amount,
    max_discount_amount,
    usage_limit_per_user,
    total_usage_limit,
    valid_from,
    valid_to,
    description,
    custom_code,
  } = req.body;
  if (!discount_type || !discount_value || !valid_from || !valid_to) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields" });
  }
  try {
    const code = custom_code || generateCouponCode();
    const [result] = await pool.query(
      `INSERT INTO coupons 
             (code, discount_type, discount_value, min_order_amount, max_discount_amount, 
              usage_limit_per_user, total_usage_limit, valid_from, valid_to, description, created_by_user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code,
        discount_type,
        discount_value,
        min_order_amount || 0,
        max_discount_amount || null,
        usage_limit_per_user || 1,
        total_usage_limit || null,
        valid_from,
        valid_to,
        description || null,
        req.user.id,
      ],
    );
    await logAudit({
      userId: req.user.id,
      action: "CREATE_COUPON_TEMPLATE",
      tableName: "coupons",
      recordId: result.insertId,
      oldData: null,
      newData: { code, discount_type, discount_value },
      req,
    });
    res
      .status(201)
      .json({ success: true, data: { id: result.insertId, code } });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "Failed to create coupon" });
  }
};

// ========== GET ALL COUPON TEMPLATES (admin) ==========
export const getAllCouponTemplates = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  try {
    const [rows] = await pool.query(
      `SELECT * FROM coupons ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset],
    );
    const [countResult] = await pool.query(
      "SELECT COUNT(*) as total FROM coupons",
    );
    res.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        totalItems: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / limit),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ========== GET USER'S COUPONS (admin view) ==========
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
  const { is_active } = req.body; // expected: 0 or 1 (boolean)

  if (is_active === undefined) {
    return res.status(400).json({
      success: false,
      message: "is_active field is required (0 or 1)",
    });
  }

  try {
    // Check if coupon exists
    const [rows] = await pool.query("SELECT * FROM coupons WHERE id = ?", [id]);
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
      });
    }

    const oldData = rows[0];
    await pool.query("UPDATE coupons SET is_active = ? WHERE id = ?", [
      is_active,
      id,
    ]);

    // Log the status change
    await logAudit({
      userId: req.user.id,
      action: "UPDATE_COUPON_STATUS",
      tableName: "coupons",
      recordId: id,
      oldData: { is_active: oldData.is_active },
      newData: { is_active },
      req,
    });

    res.json({
      success: true,
      message: "Coupon status updated successfully",
      data: { id, is_active },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
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
