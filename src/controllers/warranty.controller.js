import { pool } from "../config/db.js";

// Automatically register warranty when an order item is delivered?
// We'll provide manual registration endpoint.
export const registerWarranty = async (req, res) => {
  const { order_item_id, warranty_number } = req.body;
  const userId = req.user.id;

  if (!order_item_id || !warranty_number) {
    return res.status(400).json({
      success: false,
      message: "Missing order_item_id or warranty_number",
    });
  }

  try {
    // Verify order_item belongs to user and order is delivered
    const [orderItem] = await pool.query(
      `SELECT oi.id, o.user_id, o.order_status, o.order_date
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE oi.id = ? AND o.user_id = ?`,
      [order_item_id, userId],
    );
    if (!orderItem.length || orderItem[0].order_status !== "delivered") {
      return res
        .status(403)
        .json({ success: false, message: "Item not delivered or not yours" });
    }

    // Calculate warranty end date (3 years from order date)
    const orderDate = new Date(orderItem[0].order_date);
    const warrantyEnd = new Date(
      orderDate.setFullYear(orderDate.getFullYear() + 3),
    );
    const warrantyEndDate = warrantyEnd.toISOString().split("T")[0];

    // Check if already registered
    const [existing] = await pool.query(
      `SELECT id FROM warranty_registrations WHERE order_item_id = ?`,
      [order_item_id],
    );
    if (existing.length) {
      return res
        .status(400)
        .json({ success: false, message: "Warranty already registered" });
    }

    await pool.query(
      `INSERT INTO warranty_registrations (user_id, order_item_id, warranty_end_date, warranty_number, status)
       VALUES (?, ?, ?, ?, 'active')`,
      [userId, order_item_id, warrantyEndDate, warranty_number],
    );

    res.status(201).json({ success: true, message: "Warranty registered" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Customer: get my warranty registrations
export const getUserWarranties = async (req, res) => {
  const userId = req.user.id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  try {
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM warranty_registrations WHERE user_id = ?`,
      [userId],
    );
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    const [warranties] = await pool.query(
      `SELECT w.*, oi.product_data_snapshot, o.id AS order_number
       FROM warranty_registrations w
       JOIN order_items oi ON w.order_item_id = oi.id
       JOIN orders o ON oi.order_id = o.id
       WHERE w.user_id = ?
       ORDER BY w.registration_date DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset],
    );

    res.json({
      success: true,
      data: warranties,
      pagination: { page, limit, totalItems, totalPages },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Admin/Staff: get all warranties
export const getAllWarranties = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  const { search, status } = req.query;

  let whereClause = "1=1";
  const params = [];
  if (search) {
    whereClause += ` AND (w.warranty_number LIKE ? OR u.full_name LIKE ?)`;
    const pattern = `%${search}%`;
    params.push(pattern, pattern);
  }
  if (status) {
    whereClause += ` AND w.status = ?`;
    params.push(status);
  }

  const [countResult] = await pool.query(
    `SELECT COUNT(*) as total FROM warranty_registrations w JOIN users u ON w.user_id = u.id WHERE ${whereClause}`,
    params,
  );
  const totalItems = countResult[0].total;
  const totalPages = Math.ceil(totalItems / limit);

  const [warranties] = await pool.query(
    `SELECT w.*, u.full_name, o.id AS order_number
     FROM warranty_registrations w
     JOIN users u ON w.user_id = u.id
     JOIN order_items oi ON w.order_item_id = oi.id
     JOIN orders o ON oi.order_id = o.id
     WHERE ${whereClause}
     ORDER BY w.registration_date DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  res.json({
    success: true,
    data: warranties,
    pagination: { page, limit, totalItems, totalPages },
  });
};

// Admin/Staff: update warranty status (e.g., to 'claimed')
export const updateWarrantyStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!["active", "expired", "claimed"].includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status" });
  }

  try {
    await pool.query(
      `UPDATE warranty_registrations SET status = ? WHERE id = ?`,
      [status, id],
    );
    res.json({ success: true, message: "Warranty status updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
