// controllers/categoryController.js
import cloudinary from "../config/cloudinary.js";
import { pool } from "../config/db.js";

export const getAllCategories = async (req, res) => {
  try {
    // Parse and sanitize pagination
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;

    const { status, is_front, search } = req.query;

    const whereConditions = [];
    const params = [];

    // Status filter (only if provided)
    if (status && ["active", "inactive"].includes(status)) {
      whereConditions.push("status = ?");
      params.push(status);
    }

    // is_front filter (only if provided)
    if (is_front !== undefined && is_front !== null) {
      const isFrontValue = ["true", "1", 1].includes(is_front) ? 1 : 0;
      whereConditions.push("is_front = ?");
      params.push(isFrontValue);
    }

    // Search (multiple columns)
    if (search) {
      whereConditions.push("(c.name LIKE ? OR c.description LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = whereConditions.length
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

    // Count total
    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM categories c ${whereClause}`,
      params,
    );
    const total = countRows[0].total;

    // Fetch data
    const [rows] = await pool.query(
      `SELECT * FROM categories c
   ${whereClause}
  ORDER BY is_front DESC, created_at DESC, id DESC  
   LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

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
    console.error("Error in getAllCategories:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Get single category by id – now accepts optional ?status= query param
export const getCategoryById = async (req, res) => {
  const { id } = req.params;
  const { status } = req.query; // 'active' or 'inactive' (optional)

  try {
    let query = "SELECT * FROM categories WHERE id = ?";
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
          ? `Category not found with id ${id} and status ${status}`
          : "Category not found",
      });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const createCategory = async (req, res) => {
  const { name, description, status, is_front } = req.body; // ✅ Removed display_order

  // Get Cloudinary URL from uploaded file
  const image_url = req.file ? req.file.path : null; // 'path' contains the secure URL

  if (!name || name.trim() === "") {
    return res
      .status(400)
      .json({ success: false, message: "Name is required" });
  }

  try {
    // Explicitly convert to 1 or 0
    const isFrontValue =
      is_front === true || is_front === "true" || is_front === 1 ? 1 : 0;

    const [result] = await pool.query(
      `INSERT INTO categories (name, description, image_url, status, is_front)  
             VALUES (?, ?, ?, ?, ?)`,
      [
        name,
        description || null,
        image_url || null,
        status || "active",
        isFrontValue, // ✅ Now always 1 or 0
      ],
    );

    const [newCategory] = await pool.query(
      "SELECT * FROM categories WHERE id = ?",
      [result.insertId],
    );

    res.status(201).json({ success: true, data: newCategory[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Database error" });
  }
};

// Update category with optional image replacement
export const updateCategory = async (req, res) => {
  const { id } = req.params;

  try {
    // Check if category exists
    const [existing] = await pool.query(
      "SELECT id, image_url FROM categories WHERE id = ?",
      [id],
    );
    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    }

    const { name, description, status, is_front } = req.body; // Removed display_order
    let image_url = existing[0]?.image_url; // keep old by default

    console.log("Existing image_url:", image_url);

    // If new file uploaded, use its URL
    if (req.file) {
      image_url = req.file.path;

      if (existing[0]?.image_url) {
        const publicId = existing[0].image_url
          .split("/")
          .slice(-2)
          .join("/")
          .split(".")[0];

        await cloudinary.uploader.destroy(publicId);
      }
    }

    // ✅ Fixed: Explicitly convert is_front to 1 or 0
    const isFrontValue =
      is_front === true || is_front === "true" || is_front === 1 ? 1 : 0;

    console.log("is_front received:", is_front);
    console.log("isFrontValue stored:", isFrontValue);

    await pool.query(
      `UPDATE categories
             SET name = COALESCE(?, name),
                 description = COALESCE(?, description),
                 image_url = ?,
                 status = COALESCE(?, status),
                 is_front = ? 
             WHERE id = ?`,
      [
        name || null,
        description || null,
        image_url,
        status || null,
        isFrontValue, // ✅ Now always 1 or 0
        id,
      ],
    );

    const [updated] = await pool.query(
      "SELECT * FROM categories WHERE id = ?",
      [id],
    );
    res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Update error" });
  }
};

// Delete a category (unchanged)
export const deleteCategory = async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Check if any subcategories reference this category
    const [subcats] = await pool.query(
      "SELECT id FROM subcategory WHERE category_id = ? LIMIT 1",
      [id],
    );
    if (subcats.length > 0) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete category because it has associated subcategories",
      });
    }

    // 2. Get the category's image URL before deleting the record
    const [category] = await pool.query(
      "SELECT image_url FROM categories WHERE id = ?",
      [id],
    );
    if (category.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    const imageUrl = category[0].image_url;

    // 3. Delete the category from database
    const [result] = await pool.query("DELETE FROM categories WHERE id = ?", [
      id,
    ]);
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // 4. Delete the image from Cloudinary if it exists
    if (imageUrl) {
      // Extract public ID from URL
      // URL example: https://res.cloudinary.com/.../categories/filename.jpg
      const publicId = imageUrl.split("/").slice(-2).join("/").split(".")[0];
      await cloudinary.uploader.destroy(publicId);
    }

    res.json({
      success: true,
      message: "Category deleted successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Server error while deleting category",
    });
  }
};

//  Toggle category status (active ↔ inactive)
export const toggleCategoryStatus = async (req, res) => {
  const { id } = req.params;
  try {
    // Get current status
    const [rows] = await pool.query(
      "SELECT status FROM categories WHERE id = ?",
      [id],
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    }

    const currentStatus = rows[0].status;
    const newStatus = currentStatus === "active" ? "inactive" : "active";

    await pool.query("UPDATE categories SET status = ? WHERE id = ?", [
      newStatus,
      id,
    ]);

    // Return updated category
    const [updated] = await pool.query(
      "SELECT * FROM categories WHERE id = ?",
      [id],
    );
    res.json({
      success: true,
      message: `Category status toggled to ${newStatus}`,
      data: updated[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const deleteCategoryImage = async (req, res) => {
  const { id } = req.params;

  try {
    // Check if category exists
    const [rows] = await pool.query(
      "SELECT image_url FROM categories WHERE id = ?",
      [id],
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    const imageUrl = rows[0].image_url;

    // Delete image from Cloudinary if exists
    if (imageUrl) {
      try {
        // Extract public_id from Cloudinary URL
        const parts = imageUrl.split("/");
        const fileName = parts.pop().split(".")[0];
        const folder = parts.slice(parts.indexOf("upload") + 2).join("/");
        const publicId = folder ? `${folder}/${fileName}` : fileName;

        await cloudinary.uploader.destroy(publicId);
      } catch (err) {
        console.error("Cloudinary delete failed:", err);
      }
    }

    // Remove image URL from database
    await pool.query("UPDATE categories SET image_url = NULL WHERE id = ?", [
      id,
    ]);

    const [updated] = await pool.query(
      "SELECT * FROM categories WHERE id = ?",
      [id],
    );

    res.json({
      success: true,
      message: "Category image deleted successfully",
      data: updated[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Database error",
    });
  }
};
