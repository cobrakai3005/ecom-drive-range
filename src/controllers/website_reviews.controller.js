import { pool } from "../config/db.js";

export const addWebsiteReview = async (req, res) => {
  const { rating, review } = req.body;
  const userId = req.user.id;

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({
      success: false,
      message: "Rating must be between 1 and 5.",
    });
  }

  try {
    // Optional: Prevent multiple reviews per user
    const [existing] = await pool.query(
      `SELECT id
       FROM website_reviews
       WHERE user_id = ?`,
      [userId],
    );

    if (existing.length) {
      return res.status(400).json({
        success: false,
        message: "You have already submitted a website review.",
      });
    }

    const [result] = await pool.query(
      `INSERT INTO website_reviews
      (user_id, rating, review)
      VALUES (?, ?, ?)`,
      [userId, rating, review],
    );

    res.status(201).json({
      success: true,
      message: "Review submitted successfully.",
      reviewId: result.insertId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

export const getWebsiteReviews = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  try {
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM website_reviews
       WHERE status='approved'`,
    );

    const [reviews] = await pool.query(
      `SELECT
          wr.*,
          u.full_name
       FROM website_reviews wr
       JOIN users u
         ON u.id = wr.user_id
       WHERE wr.status='approved'
       ORDER BY wr.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset],
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
      message: "Server error.",
    });
  }
};

export const getAllWebsiteReviews = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  const { status, search } = req.query;

  let where = "1=1";
  const params = [];

  if (status) {
    where += " AND wr.status = ?";
    params.push(status);
  }

  if (search) {
    where += " AND u.full_name LIKE ?";
    params.push(`%${search}%`);
  }

  try {
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM website_reviews wr
       JOIN users u ON u.id = wr.user_id
       WHERE ${where}`,
      params,
    );

    const [reviews] = await pool.query(
      `SELECT
          wr.*,
          u.full_name
       FROM website_reviews wr
       JOIN users u
         ON u.id = wr.user_id
       WHERE ${where}
       ORDER BY wr.created_at DESC
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
      message: "Server error.",
    });
  }
};

export const moderateWebsiteReview = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!["approved", "rejected", "pending"].includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid status.",
    });
  }

  try {
    const [result] = await pool.query(
      `UPDATE website_reviews
       SET status = ?
       WHERE id = ?`,
      [status, id],
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: "Review not found.",
      });
    }

    res.json({
      success: true,
      message: `Review ${status} successfully.`,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

export const deleteWebsiteReview = async (req, res) => {
  const { id } = req.params;

  try {
    let result;
    if (req.user.role === "Customer") {
      [result] = await pool.query(
        `DELETE FROM website_reviews
          WHERE id = ? AND user_id = ?`,
        [id, req.user.id],
      );
    } else {
      [result] = await pool.query(
        `DELETE FROM website_reviews
          WHERE id = ?`,
        [id],
      );
    }

    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: "Review not found.",
      });
    }

    res.json({
      success: true,
      message: "Review deleted successfully.",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};
