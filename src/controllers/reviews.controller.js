import { pool } from "../config/db.js";

// Customer: add review for a purchased product (verified purchase)
export const addReview = async (req, res) => {
  const { order_item_id, rating, title, content } = req.body;
  const userId = req.user.id;

  if (!order_item_id || !rating || rating < 1 || rating > 5) {
    return res
      .status(400)
      .json({
        success: false,
        message: "Invalid rating or missing order_item_id",
      });
  }

  try {
    // Verify order_item belongs to user and order is delivered
    const [orderItem] = await pool.query(
      `SELECT oi.id, o.user_id, o.order_status, oi.product_item_id
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE oi.id = ? AND o.user_id = ? AND o.order_status = 'delivered'`,
      [order_item_id, userId],
    );
    if (!orderItem.length) {
      return res
        .status(403)
        .json({
          success: false,
          message: "You can only review delivered items",
        });
    }
    const productItemId = orderItem[0].product_item_id;

    // Check if already reviewed
    const [existing] = await pool.query(
      `SELECT id FROM reviews WHERE order_item_id = ? AND user_id = ?`,
      [order_item_id, userId],
    );
    if (existing.length) {
      return res
        .status(400)
        .json({ success: false, message: "You already reviewed this item" });
    }

    await pool.query(
      `INSERT INTO reviews (user_id, product_item_id, order_item_id, rating, title, content, is_verified_purchase, status)
       VALUES (?, ?, ?, ?, ?, ?, TRUE, 'pending')`,
      [userId, productItemId, order_item_id, rating, title, content],
    );

    res
      .status(201)
      .json({ success: true, message: "Review submitted, pending approval" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Admin/Staff: approve/reject review
export const moderateReview = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status" });
  }

  try {
    await pool.query(`UPDATE reviews SET status = ? WHERE id = ?`, [
      status,
      id,
    ]);
    res.json({ success: true, message: `Review ${status}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Public: get approved reviews for a product (product_item_id)
export const getProductReviews = async (req, res) => {
  const { productItemId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  try {
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM reviews WHERE product_item_id = ? AND status = 'approved'`,
      [productItemId],
    );
    console.log(countResult);
    
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    const [reviews] = await pool.query(
      `SELECT r.*, u.full_name
       FROM reviews r
       JOIN users u ON r.user_id = u.id
       WHERE r.product_item_id = ? AND r.status = 'approved'
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [productItemId, limit, offset],
    );

    res.json({
      success: true,
      data: reviews,
      pagination: { page, limit, totalItems, totalPages },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Admin/Staff: get all reviews (for moderation)
export const getAllReviews = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  const { status, search } = req.query;

  let whereClause = "1=1";
  const params = [];
  if (status) {
    whereClause += ` AND r.status = ?`;
    params.push(status);
  }
  if (search) {
    whereClause += ` AND (u.full_name LIKE ? OR p.name LIKE ?)`;
    const pattern = `%${search}%`;
    params.push(pattern, pattern);
  }

  const [countResult] = await pool.query(
    `SELECT COUNT(*) as total FROM reviews r 
     JOIN users u ON r.user_id = u.id 
     JOIN product_items pi ON r.product_item_id = pi.id
     JOIN products p ON pi.product_id = p.id
     WHERE ${whereClause}`,
    params,
  );
  const totalItems = countResult[0].total;
  const totalPages = Math.ceil(totalItems / limit);

  const [reviews] = await pool.query(
    `SELECT r.*, u.full_name, p.name as product_name
     FROM reviews r
     JOIN users u ON r.user_id = u.id
     JOIN product_items pi ON r.product_item_id = pi.id
     JOIN products p ON pi.product_id = p.id
     WHERE ${whereClause}
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  res.json({
    success: true,
    data: reviews,
    pagination: { page, limit, totalItems, totalPages },
  });
};
