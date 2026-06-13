import { pool } from "../config/db.js";
import crypto from "crypto";

// Encryption key (32 bytes for AES-256) - store in environment variables
const ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
const IV_LENGTH = 16; // For AES, this is always 16 bytes

// Helper: Encrypt data
const encrypt = (text) => {
  // Generate a random initialization vector
  const iv = crypto.randomBytes(IV_LENGTH);

  // Create cipher using AES-256-CBC algorithm
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY, "hex"),
    iv,
  );

  // Encrypt the text
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  // Return IV + encrypted data (both needed for decryption)
  return iv.toString("hex") + ":" + encrypted;
};

// Helper: Decrypt data (for admin panel or internal use)
const decrypt = (encryptedText) => {
  try {
    // Split the stored text into IV and encrypted data
    const parts = encryptedText.split(":");
    const iv = Buffer.from(parts.shift(), "hex");
    const encrypted = parts.join(":");

    // Create decipher
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(ENCRYPTION_KEY, "hex"),
      iv,
    );

    // Decrypt
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

  // Access control
  if (userRole !== "Admin" && targetUserId != userId) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  // Pagination parameters
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  // Search parameter
  const search = req.query.search || "";

  try {
    // Build WHERE clause with search
    let whereClause = "user_id = ? AND is_active = TRUE";
    const queryParams = [targetUserId];

    if (search) {
      whereClause += ` AND (
        method_type LIKE ? OR 
        last_four LIKE ? OR 
        card_holder_name LIKE ? OR
        expiry_date LIKE ?
      )`;
      const searchPattern = `%${search}%`;
      queryParams.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
      );
    }

    // Count total records for pagination metadata
    const countQuery = `
      SELECT COUNT(*) as total
      FROM payment_methods
      WHERE ${whereClause}
    `;
    const [countResult] = await pool.query(countQuery, queryParams);
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    // Main query with pagination and sorting
    const dataQuery = `
      SELECT id, method_type, last_four, expiry_date, card_holder_name, 
             is_default, is_active, created_at
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
  const userId = req.user.id;
  const userRole = req.user.role;
  const {
    user_id,
    method_type,
    card_number,
    expiry_date,
    card_holder_name,
    is_default,
  } = req.body;

  let targetUserId = userId;
  if (userRole === "Admin" && user_id) targetUserId = user_id;

  if (!method_type || !card_number || !expiry_date || !card_holder_name) {
    return res.status(400).json({
      success: false,
      message:
        "Missing required fields: method_type, card_number, expiry_date, card_holder_name",
    });
  }

  const allowedTypes = ["credit_card", "upi", "afterpay", "bank_transfer"];
  if (!allowedTypes.includes(method_type)) {
    return res.status(400).json({
      success: false,
      message:
        "Invalid method_type. Allowed: credit_card, upi, afterpay, bank_transfer",
    });
  }

  let lastFour = null;
  if (method_type === "credit_card") {
    lastFour = card_number.slice(-4);
  }

  // Encrypt the sensitive payment details
  const encryptedDetails = encrypt(card_number);

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
       (user_id, method_type, tokenised_details, last_four, expiry_date, 
        card_holder_name, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        targetUserId,
        method_type,
        encryptedDetails,
        lastFour,
        expiry_date,
        card_holder_name,
        is_default || false,
      ],
    );

    await connection.commit();
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
  const { is_default, is_active, expiry_date, card_holder_name } = req.body;

  try {
    const [methods] = await pool.query(
      "SELECT user_id FROM payment_methods WHERE id = ?",
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
    if (expiry_date) {
      updates.push("expiry_date = ?");
      values.push(expiry_date);
    }
    if (card_holder_name) {
      updates.push("card_holder_name = ?");
      values.push(card_holder_name);
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

    await connection.commit();
    res.json({ success: true, message: "Payment method updated" });
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
      "SELECT user_id FROM payment_methods WHERE id = ?",
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
    res.json({ success: true, message: "Payment method deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
