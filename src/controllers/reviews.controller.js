import { pool } from "../config/db.js";

// Customer: add review for a purchased product (verified purchase)
export const addReview = async (req, res) => {
  const { order_item_id, rating, review } = req.body;
  const userId = req.user.id;

  if (
    !order_item_id ||
    !Number.isInteger(Number(rating)) ||
    rating < 1 ||
    rating > 5
  ) {
    return res.status(400).json({
      success: false,
      message: "Rating must be between 1 and 5.",
    });
  }

  try {
    // Verify order_item belongs to user and order is delivered
    const [orderItem] = await pool.query(
      `SELECT oi.id, o.user_id, o.order_status, oi.product_id
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE oi.id = ? AND o.user_id = ? AND o.order_status = 'delivered'`,
      [order_item_id, userId],
    );
    if (!orderItem.length) {
      return res.status(403).json({
        success: false,
        message: "You can only review delivered items",
      });
    }
    const productItemId = orderItem[0].product_id;

    // Check if already reviewed
    const [existing] = await pool.query(
      `SELECT id FROM product_reviews WHERE order_item_id = ? AND user_id = ?`,
      [order_item_id, userId],
    );
    if (existing.length) {
      return res
        .status(400)
        .json({ success: false, message: "You already reviewed this item" });
    }
    console.log("Product ID:", productItemId);
    await pool.query(
      `INSERT INTO product_reviews (user_id, product_id, order_item_id, rating, review, is_verified_purchase, status)
     VALUES (?, ?, ?, ?, ?, TRUE, 'pending')`,
      [userId, productItemId, order_item_id, rating, review],
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
  if (!["approved", "rejected", "pending"].includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status" });
  }

  try {
    await pool.query(`UPDATE product_reviews SET status = ? WHERE id = ?`, [
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
// Public: Get approved reviews for a product
export const getProductReviews = async (req, res) => {
  const { productId } = req.params;

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  try {
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM product_reviews
       WHERE product_id = ?
       AND status = 'approved'`,
      [productId],
    );

    const [reviews] = await pool.query(
      `SELECT
          r.id,
          r.product_id,
          r.user_id,
          r.order_item_id,
          r.rating,
          r.review,
          r.is_verified_purchase,
          r.status,
          r.created_at,
          r.updated_at,
          u.full_name,
          p.name AS product_name
       FROM product_reviews r
       INNER JOIN users u
           ON u.id = r.user_id
       INNER JOIN product p
           ON p.id = r.product_id
       WHERE r.product_id = ?
         AND r.status = 'approved'
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [productId, limit, offset],
    );

    res.json({
      success: true,
      data: reviews,
      pagination: {
        page,
        limit,
        totalItems: total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
// Admin/Staff: get all reviews (for moderation)
// Admin/Staff: Get all reviews
export const getAllReviews = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const { status, search } = req.query;

    let whereClause = "1=1";
    const params = [];

    if (status) {
      whereClause += " AND r.status = ?";
      params.push(status);
    }

    if (search) {
      whereClause += " AND (u.full_name LIKE ? OR p.name LIKE ?)";
      const pattern = `%${search}%`;
      params.push(pattern, pattern);
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM product_reviews r
       JOIN users u ON u.id = r.user_id
       JOIN product p ON p.id = r.product_id
       WHERE ${whereClause}`,
      params,
    );

    const [reviews] = await pool.query(
      `SELECT
          r.*,
          u.full_name,
          p.name AS product_name
       FROM product_reviews r
       JOIN users u ON u.id = r.user_id
       JOIN product p ON p.id = r.product_id
       WHERE ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    res.json({
      success: true,
      data: reviews,
      pagination: {
        page,
        limit,
        totalItems: total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// User: Delete own review
export const deleteReview = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    // Check review ownership
    const [reviews] = await pool.query(
      `SELECT id
       FROM product_reviews
       WHERE id = ? AND user_id = ?`,
      [id, userId],
    );

    if (!reviews.length) {
      return res.status(404).json({
        success: false,
        message: "Review not found or you are not authorized to delete it.",
      });
    }

    await pool.query(
      `DELETE FROM product_reviews
       WHERE id = ?`,
      [id],
    );

    res.json({
      success: true,
      message: "Review deleted successfully.",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
