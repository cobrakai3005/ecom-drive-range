import { pool } from "../config/db.js";
import crypto from "crypto";
import { logAudit } from "../lib/auditLog.js";

// Encryption key (32 bytes for AES-256) - store in environment variables
const ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");

const IV_LENGTH = 16;

const encrypt = (text) => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY, "hex"),
    iv,
  );
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
};

const decrypt = (encryptedText) => {
  try {
    const parts = encryptedText.split(":");
    const iv = Buffer.from(parts.shift(), "hex");
    const encrypted = parts.join(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(ENCRYPTION_KEY, "hex"),
      iv,
    );
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("Decryption failed:", error);
    return null;
  }
};

// Get all payment methods for the logged-in user
export const getUserPaymentMethods = async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const targetUserId = req.params.userId || userId;

  if (userRole !== "Admin" && targetUserId != userId) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  const search = req.query.search || "";

  try {
    let whereClause = "user_id = ? AND is_active = TRUE";
    const queryParams = [targetUserId];

    if (search) {
      whereClause += ` AND (
        method_type LIKE ? OR 
        last_four LIKE ? OR 
        card_holder_name LIKE ? OR
        identifier LIKE ?
      )`;
      const searchPattern = `%${search}%`;
      queryParams.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
      );
    }

    const countQuery = `SELECT COUNT(*) as total FROM payment_methods WHERE ${whereClause}`;
    const [countResult] = await pool.query(countQuery, queryParams);
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    const dataQuery = `
      SELECT id, method_type, last_four, expiry_month, expiry_year, card_holder_name,
             gateway_reference, is_default, is_active, created_at
      FROM payment_methods
      WHERE ${whereClause}
      ORDER BY is_default DESC, created_at DESC
      LIMIT ? OFFSET ?
    `;
    const dataParams = [...queryParams, limit, offset];
    const [methods] = await pool.query(dataQuery, dataParams);

    res.json({
      success: true,
      data: methods,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Add new payment method
export const addPaymentMethod = async (req, res) => {
  const [ressss] = await pool.query(`SHOW COLUMNS FROM payment_methods;`);
  console.log(ressss);

  const userId = req.user.id;
  const userRole = req.user.role;
  const {
    user_id,
    method_type,
    identifier, // card number, UPI VPA, bank code, etc.
    gateway_reference,
    last_four,
    expiry_month,
    expiry_year,
    card_holder_name,
    is_default,
  } = req.body;

  let targetUserId = userId;
  if (userRole === "Admin" && user_id) targetUserId = user_id;

  // Validate method_type (match your ENUM)
  const allowedTypes = ["credit_card", "upi", "netbanking", "cash"];
  if (!allowedTypes.includes(method_type)) {
    return res.status(400).json({
      success: false,
      message:
        "Invalid method_type. Allowed: credit_card, upi, netbanking, cash",
    });
  }

  // Conditional validation
  if (method_type === "credit_card") {
    if (!identifier || !expiry_month || !expiry_year || !card_holder_name) {
      return res.status(400).json({
        success: false,
        message:
          "For credit_card, identifier (card number), expiry_month, expiry_year, and card_holder_name are required",
      });
    }
    if (expiry_month < 1 || expiry_month > 12) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid expiry_month (1-12)" });
    }
    if (!last_four) {
      // Auto-extract from identifier if not provided
      const cardNumber = identifier;
      if (cardNumber.length >= 4) {
        req.body.last_four = cardNumber.slice(-4);
      }
    }
  } else {
    // For upi, netbanking, cash: only identifier is required
    if (!identifier) {
      return res.status(400).json({
        success: false,
        message: `For ${method_type}, an identifier (e.g., UPI VPA, bank code) is required`,
      });
    }
  }

  // Encrypt the identifier
  const encryptedIdentifier = encrypt(identifier);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (is_default) {
      await connection.query(
        "UPDATE payment_methods SET is_default = FALSE WHERE user_id = ?",
        [targetUserId],
      );
    }

    const [result] = await connection.query(
      `INSERT INTO payment_methods 
       (user_id, method_type, identifier, gateway_reference, last_four, 
        expiry_month, expiry_year, card_holder_name, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        targetUserId,
        method_type,
        encryptedIdentifier,
        gateway_reference || null,
        method_type === "credit_card" ? req.body.last_four || last_four : null,
        method_type === "credit_card" ? expiry_month : null,
        method_type === "credit_card" ? expiry_year : null,
        method_type === "credit_card" ? card_holder_name : null,
        is_default || false,
      ],
    );

    await connection.commit();

    // Fetch the newly created row for audit log (exclude encrypted identifier)
    const [newPaymentMethod] = await pool.query(
      `SELECT id, user_id, method_type, gateway_reference, last_four, 
              expiry_month, expiry_year, card_holder_name, is_default, is_active
       FROM payment_methods WHERE id = ?`,
      [result.insertId],
    );

    await logAudit({
      userId: req.user.id,
      action: "CREATE_PAYMENT_METHOD",
      tableName: "payment_methods",
      recordId: result.insertId,
      oldData: null,
      newData: newPaymentMethod[0],
      req,
    });

    res.status(201).json({
      success: true,
      data: { payment_method_id: result.insertId },
    });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "Failed to add payment method" });
  } finally {
    connection.release();
  }
};

// Update payment method
export const updatePaymentMethod = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  const {
    is_default,
    is_active,
    expiry_month,
    expiry_year,
    card_holder_name,
    gateway_reference,
  } = req.body;

  try {
    const [methods] = await pool.query(
      "SELECT * FROM payment_methods WHERE id = ?",
      [id],
    );
    if (methods.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Payment method not found" });
    }
    if (userRole !== "Admin" && methods[0].user_id !== userId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    if (is_default === true) {
      await connection.query(
        "UPDATE payment_methods SET is_default = FALSE WHERE user_id = ?",
        [methods[0].user_id],
      );
    }

    const updates = [];
    const values = [];
    if (is_default !== undefined) {
      updates.push("is_default = ?");
      values.push(is_default);
    }
    if (is_active !== undefined) {
      updates.push("is_active = ?");
      values.push(is_active);
    }
    if (expiry_month !== undefined) {
      updates.push("expiry_month = ?");
      values.push(expiry_month);
    }
    if (expiry_year !== undefined) {
      updates.push("expiry_year = ?");
      values.push(expiry_year);
    }
    if (card_holder_name !== undefined) {
      updates.push("card_holder_name = ?");
      values.push(card_holder_name);
    }
    if (gateway_reference !== undefined) {
      updates.push("gateway_reference = ?");
      values.push(gateway_reference);
    }

    if (updates.length === 0) {
      await connection.rollback();
      return res
        .status(400)
        .json({ success: false, message: "No fields to update" });
    }

    values.push(id);
    await connection.query(
      `UPDATE payment_methods SET ${updates.join(", ")} WHERE id = ?`,
      values,
    );

    // Fetch updated row
    const [updatedMethod] = await connection.query(
      `SELECT id, user_id, method_type, gateway_reference, last_four, 
              expiry_month, expiry_year, card_holder_name, is_default, is_active
       FROM payment_methods WHERE id = ?`,
      [id],
    );

    await connection.commit();

    await logAudit({
      userId: req.user.id,
      action: "UPDATE_PAYMENT_METHOD",
      tableName: "payment_methods",
      recordId: id,
      oldData: methods[0],
      newData: updatedMethod[0],
      req,
    });

    res.json({
      success: true,
      message: "Payment method updated",
      data: updatedMethod[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Delete payment method
export const deletePaymentMethod = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const [methods] = await pool.query(
      "SELECT * FROM payment_methods WHERE id = ?",
      [id],
    );
    if (methods.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Payment method not found" });
    }
    if (userRole !== "Admin" && methods[0].user_id !== userId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    await pool.query("DELETE FROM payment_methods WHERE id = ?", [id]);
    await logAudit({
      userId: req.user.id,
      action: "DELETE_PAYMENT_METHOD",
      tableName: "payment_methods",
      recordId: id,
      oldData: methods[0],
      newData: null,
      req,
    });
    res.json({ success: true, message: "Payment method deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
