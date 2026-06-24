// controllers/subcategoryController.js
import cloudinary from "../config/cloudinary.js";
import { pool } from "../config/db.js";

// Get all subcategories with pagination, status filter, and optional category_id filter
export const getAllSubcategories = async (req, res) => {
  try {
    // Query parameters
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const status = req.query.status; // 'active', 'inactive', or undefined
    const category_id = req.query.category_id
      ? parseInt(req.query.category_id)
      : undefined;
    const offset = (page - 1) * limit;
    const search = req.query.search;

    // Build WHERE clause dynamically
    let whereConditions = [];
    let params = [];

    whereConditions.push("status = ?");
    if (status && ["active", "inactive"].includes(status)) {
      params.push(status);
    } else {
      params.push("active");
    }

    if (category_id && !isNaN(category_id)) {
      whereConditions.push("category_id = ?");
      params.push(category_id);
    }
// Search (Multiple columns)
    if (search) {
      whereConditions.push("(s.name LIKE ? OR s.description LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM subcategory s ${whereClause}`;
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    // Get paginated data - ✅ Removed display_order
    const dataQuery = `
            SELECT * FROM subcategory s 
            ${whereClause}
            ORDER BY id ASC 
            LIMIT ? OFFSET ?
        `;
    const dataParams = [...params, limit, offset];
    const [rows] = await pool.query(dataQuery, dataParams);

    res.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Get single subcategory by id – accepts optional ?status= query param
export const getSubcategoryById = async (req, res) => {
  const { id } = req.params;
  const { status } = req.query;

  try {
    let query = "SELECT * FROM subcategory WHERE id = ?";
    const params = [id];

    query += " AND status = ?";
    if (status && ["active", "inactive"].includes(status)) {
      params.push(status);
    } else {
      params.push("active");
    }

    const [rows] = await pool.query(query, params);
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: status
          ? `Subcategory not found with id ${id} and status ${status}`
          : "Subcategory not found",
      });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// CREATE subcategory with image upload - ✅ Removed display_order
export const createSubcategory = async (req, res) => {
  try {
    const { category_id, name, description, status, is_front } = req.body; // ✅ Removed display_order

    if (!category_id) {
      return res
        .status(400)
        .json({ success: false, message: "category_id is required" });
    }
    if (!name || name.trim() === "") {
      return res
        .status(400)
        .json({ success: false, message: "Name is required" });
    }

    // Verify category exists
    const [catCheck] = await pool.query(
      "SELECT id FROM categories WHERE id = ?",
      [category_id],
    );
    if (catCheck.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid category_id" });
    }

    const image_url = req.file ? req.file.path : null;

    // ✅ Convert is_front to 1 or 0
    const isFrontValue =
      is_front === true || is_front === "true" || is_front === 1 ? 1 : 0;

    const [result] = await pool.query(
      `INSERT INTO subcategory (category_id, name, description, image_url, status, is_front)  
             VALUES (?, ?, ?, ?, ?, ?)`, // ✅ Removed display_order
      [
        category_id,
        name,
        description || null,
        image_url,
        status || "active",
        isFrontValue,
      ],
    );

    const [newSubcat] = await pool.query(
      "SELECT * FROM subcategory WHERE id = ?",
      [result.insertId],
    );
    res.status(201).json({ success: true, data: newSubcat[0] });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "Database or upload error" });
  }
};

// UPDATE subcategory with optional image replacement - ✅ Removed display_order
export const updateSubcategory = async (req, res) => {
  const { id } = req.params;

  try {
    const [existing] = await pool.query(
      "SELECT id, image_url FROM subcategory WHERE id = ?",
      [id],
    );
    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Subcategory not found" });
    }

    const { category_id, name, description, status, is_front } = req.body; // ✅ Removed display_order
    let image_url = existing[0].image_url; // keep old by default

    if (req.file) {
      image_url = req.file.path;
      // Optional: delete old image from Cloudinary
      if (existing[0].image_url) {
        const publicId = existing[0].image_url
          .split("/")
          .slice(-2)
          .join("/")
          .split(".")[0];
        await cloudinary.uploader.destroy(publicId);
      }
    }

    // If category_id is being updated, verify it exists
    if (category_id) {
      const [catCheck] = await pool.query(
        "SELECT id FROM categories WHERE id = ?",
        [category_id],
      );
      if (catCheck.length === 0) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid category_id" });
      }
    }

    // ✅ Convert is_front to 1 or 0
    const isFrontValue =
      is_front === true || is_front === "true" || is_front === 1 ? 1 : 0;

    await pool.query(
      `UPDATE subcategory
             SET category_id = COALESCE(?, category_id),
                 name = COALESCE(?, name),
                 description = COALESCE(?, description),
                 image_url = ?,
                 status = COALESCE(?, status),
                 is_front = ? 
             WHERE id = ?`,
      [
        category_id || null,
        name || null,
        description || null,
        image_url,
        status || null,
        isFrontValue,
        id,
      ],
    );

    const [updated] = await pool.query(
      "SELECT * FROM subcategory WHERE id = ?",
      [id],
    );
    res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Update error" });
  }
};

// DELETE subcategory (and optionally delete image from Cloudinary)
export const deleteSubcategory = async (req, res) => {
  const { id } = req.params;
  try {
    // Check for products using this subcategory
    const [products] = await pool.query(
      "SELECT id FROM products WHERE sub_category_id = ? LIMIT 1",
      [id],
    );
    if (products.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete subcategory because it has associated products",
      });
    }

    // Get image URL before deleting record
    const [subcat] = await pool.query(
      "SELECT image_url FROM subcategory WHERE id = ?",
      [id],
    );
    if (subcat.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Subcategory not found" });
    }

    const imageUrl = subcat[0].image_url;

    // Delete from database
    const [result] = await pool.query("DELETE FROM subcategory WHERE id = ?", [
      id,
    ]);
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Subcategory not found" });
    }

    // Delete image from Cloudinary if exists
    if (imageUrl) {
      const publicId = imageUrl.split("/").slice(-2).join("/").split(".")[0];
      await cloudinary.uploader.destroy(publicId);
    }

    res.json({ success: true, message: "Subcategory deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Toggle subcategory status (active ↔ inactive)
export const toggleSubcategoryStatus = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      "SELECT status FROM subcategory WHERE id = ?",
      [id],
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Subcategory not found" });
    }

    const currentStatus = rows[0].status;
    const newStatus = currentStatus === "active" ? "inactive" : "active";

    await pool.query("UPDATE subcategory SET status = ? WHERE id = ?", [
      newStatus,
      id,
    ]);

    const [updated] = await pool.query(
      "SELECT * FROM subcategory WHERE id = ?",
      [id],
    );
    res.json({
      success: true,
      message: `Subcategory status toggled to ${newStatus}`,
      data: updated[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
