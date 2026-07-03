import { pool } from "../config/db.js";

// Customer: add review for a purchased product (verified purchase)
export const addReview = async (req, res) => {
  const { order_item_id, rating, review, is_front } = req.body;
  const userId = req.user.id;

  if (
    !order_item_id ||
    !Number.isInteger(Number(rating)) ||
    Number(rating) < 1 ||
    Number(rating) > 5
  ) {
    return res.status(400).json({
      success: false,
      message: "Rating must be between 1 and 5.",
    });
  }

  const images =
    req.files?.map((file) => ({
      url: file.path,
      public_id: file.filename, // or file.public_id depending on your configuration
    })) || [];

  try {
    // Verify order_item belongs to user and order is delivered
    const [orderItem] = await pool.query(
      `SELECT oi.id, oi.product_id, o.user_id, o.order_status
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE oi.id = ? 
         AND o.user_id = ? 
         AND o.order_status = 'delivered'`,
      [order_item_id, userId],
    );

    if (!orderItem.length) {
      return res.status(403).json({
        success: false,
        message: "You can only review delivered items.",
      });
    }

    const productId = orderItem[0].product_id;

    // Check if already reviewed
    const [existing] = await pool.query(
      `SELECT id
       FROM product_reviews
       WHERE order_item_id = ?
         AND user_id = ?`,
      [order_item_id, userId],
    );

    if (existing.length) {
      return res.status(400).json({
        success: false,
        message: "You have already reviewed this item.",
      });
    }

    // Insert review
    await pool.query(
      `INSERT INTO product_reviews (
          user_id,
          product_id,
          order_item_id,
          rating,
          review,
          is_front,
          images,
          is_verified_purchase,
          status
      )
      VALUES (?, ?, ?, ?, ?,FALSE, ?, TRUE, 'pending')`,
      [
        userId,
        productId,
        order_item_id,
        Number(rating),
        review || null,
        JSON.stringify(images),
      ],
    );

    return res.status(201).json({
      success: true,
      message: "Review submitted successfully and is pending approval.",
    });
  } catch (error) {
    console.error("Add Review Error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

export const getMyReviews = async (req, res) => {
  try {
    const userId = req.user.id;

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;

    const { status, search } = req.query;

    const whereConditions = ["r.user_id = ?"];
    const params = [userId];

    if (status) {
      whereConditions.push("r.status = ?");
      params.push(status);
    }

    if (search) {
      whereConditions.push(
        "(p.name LIKE ? OR p.sku LIKE ? OR r.review LIKE ?)",
      );

      const keyword = `%${search}%`;
      params.push(keyword, keyword, keyword);
    }

    const whereClause = whereConditions.join(" AND ");

    // Total count
    const [[{ total }]] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM product_reviews r
      JOIN product p ON p.id = r.product_id
      WHERE ${whereClause}
      `,
      params,
    );

    // Reviews
    const [reviews] = await pool.query(
      `
      SELECT
        r.id,
        r.product_id,
        r.order_item_id,
        r.rating,
        r.review,
        r.is_verified_purchase,
        r.status,
        r.created_at,
        r.updated_at,

        p.name AS product_name,
        p.sku,
        p.price,
        (
          SELECT pm.image_url
          FROM product_media pm
          WHERE pm.product_id = p.id
            AND pm.status = 'active'
          ORDER BY pm.sort_order ASC, pm.id ASC
          LIMIT 1
        ) AS product_image

      FROM product_reviews r
      JOIN product p ON p.id = r.product_id

      WHERE ${whereClause}

      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset],
    );

    return res.status(200).json({
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
    console.error("Get My Reviews Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch your reviews.",
      error: error.message,
    });
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

// Get Featured Review

export const getFeaturedReviews = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM product_reviews
       WHERE status = 'approved'
         AND is_front = TRUE`,
    );

    const [reviews] = await pool.query(
      `SELECT
          r.id,
          r.rating,
          r.review,
          r.images,
          r.created_at,
          r.is_verified_purchase,
          u.full_name,
          p.name AS product_name
       FROM product_reviews r
       JOIN users u ON u.id = r.user_id
       JOIN product p ON p.id = r.product_id
       WHERE r.status = 'approved'
         AND r.is_front = TRUE
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset],
    );

    return res.json({
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
    console.error("Get Featured Reviews Error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// User: Delete own review
import cloudinary from "../config/cloudinary.js";

export const deleteReview = async (req, res) => {
  const { id } = req.params;
  const { id: userId, role } = req.user;

  try {
    let query;
    let params;

    if (role === "Admin") {
      // Admin can delete any review
      query = `
        SELECT images
        FROM product_reviews
        WHERE id = ?`;
      params = [id];
    } else {
      // User can delete only their own review
      query = `
        SELECT images
        FROM product_reviews
        WHERE id = ? AND user_id = ?`;
      params = [id, userId];
    }

    const [reviews] = await pool.query(query, params);

    if (!reviews.length) {
      return res.status(404).json({
        success: false,
        message: "Review not found or you are not authorized to delete it.",
      });
    }

    const images = reviews[0].images ? JSON.parse(reviews[0].images) : [];

    // Delete Cloudinary images
    await Promise.all(
      images.map(async (image) => {
        if (image.public_id) {
          try {
            await cloudinary.uploader.destroy(image.public_id);
          } catch (err) {
            console.error(`Failed to delete image ${image.public_id}:`, err);
          }
        }
      }),
    );

    await pool.query(
      `DELETE FROM product_reviews
       WHERE id = ?`,
      [id],
    );

    return res.json({
      success: true,
      message: "Review deleted successfully.",
    });
  } catch (error) {
    console.error("Delete Review Error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

export const updateReview = async (req, res) => {
  const { id } = req.params;
  const { rating, review } = req.body;
  const userId = req.user.id;

  if (
    !Number.isInteger(Number(rating)) ||
    Number(rating) < 1 ||
    Number(rating) > 5
  ) {
    return res.status(400).json({
      success: false,
      message: "Rating must be between 1 and 5.",
    });
  }

  const images = req.files?.map((file) => ({
    url: file.path, // Cloudinary URL
    public_id: file.filename, // or file.public_id depending on your setup
  }));

  try {
    const [reviews] = await pool.query(
      `SELECT id
       FROM product_reviews
       WHERE id = ? AND user_id = ?`,
      [id, userId],
    );

    if (!reviews.length) {
      return res.status(404).json({
        success: false,
        message: "Review not found or you are not authorized to update it.",
      });
    }

    await pool.query(
      `UPDATE product_reviews
       SET
         rating = ?,
         review = ?,
         images = ?,
         status = 'pending',
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [Number(rating), review || null, JSON.stringify(images), id],
    );

    return res.json({
      success: true,
      message: "Review updated successfully and is pending approval.",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

export const toggleReviewFrontStatus = async (req, res) => {
  const { id } = req.params;

  try {
    // Check if review exists
    const [reviews] = await pool.query(
      `SELECT id, is_front
       FROM product_reviews
       WHERE id = ?`,
      [id],
    );

    if (!reviews.length) {
      return res.status(404).json({
        success: false,
        message: "Review not found.",
      });
    }

    const currentStatus = Boolean(reviews[0].is_front);
    const newStatus = !currentStatus;

    await pool.query(
      `UPDATE product_reviews
       SET
         is_front = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newStatus, id],
    );

    return res.json({
      success: true,
      message: `Review ${
        newStatus ? "added to" : "removed from"
      } front successfully.`,
      data: {
        id: Number(id),
        is_front: newStatus,
      },
    });
  } catch (error) {
    console.error("Toggle Review Front Status Error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

export const deleteReviewImages = async (req, res) => {
  const { id } = req.params;
  const { public_ids } = req.body;
  const { id: userId, role } = req.user;

  if (!Array.isArray(public_ids) || public_ids.length === 0) {
    return res.status(400).json({
      success: false,
      message: "public_ids must be a non-empty array.",
    });
  }

  try {
    // Admin can delete images from any review
    // User can only delete images from their own review
    const [reviews] = await pool.query(
      role === "Admin"
        ? `SELECT images
           FROM product_reviews
           WHERE id = ?`
        : `SELECT images
           FROM product_reviews
           WHERE id = ? AND user_id = ?`,
      role === "admin" ? [id] : [id, userId],
    );

    if (!reviews.length) {
      return res.status(404).json({
        success: false,
        message: "Review not found or you are not authorized.",
      });
    }

    const images = Array.isArray(reviews[0].images)
      ? reviews[0].images
      : JSON.parse(reviews[0].images || "[]");

    // Delete matching images from Cloudinary
    await Promise.all(
      images
        .filter((image) => public_ids.includes(image.public_id))
        .map(async (image) => {
          try {
            await cloudinary.uploader.destroy(image.public_id);
          } catch (err) {
            console.error(`Failed to delete ${image.public_id}:`, err);
          }
        }),
    );

    // Keep only remaining images
    const remainingImages = images.filter(
      (image) => !public_ids.includes(image.public_id),
    );

    await pool.query(
      `UPDATE product_reviews
       SET images = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [JSON.stringify(remainingImages), id],
    );

    return res.json({
      success: true,
      message: "Image(s) deleted successfully.",
      data: remainingImages,
    });
  } catch (error) {
    console.error("Delete Review Images Error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};
