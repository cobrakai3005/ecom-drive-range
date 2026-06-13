// controllers/categoryController.js
import cloudinary from "../config/cloudinary.js";
import { pool } from "../config/db.js";

// Get all categories with pagination and status filter
export const getAllCategories = async (req, res) => {
  try {
    // Query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status; // 'active', 'inactive', or undefined (all)
    const offset = (page - 1) * limit;

    // Base query parts
    let whereClause = "";
    let params = [];

    whereClause = "WHERE status = ?";
    if (status && ["active", "inactive"].includes(status)) {
      params.push(status);
    } else {
      params.push("active");
    }

    // Get total count for pagination metadata
    const countQuery = `SELECT COUNT(*) as total FROM categories ${whereClause}`;
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    // Get paginated data
    const dataQuery = `
            SELECT * FROM categories 
            ${whereClause}
            ORDER BY display_order ASC, id ASC
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

// Create a new category (unchanged)
export const createCategory = async (req, res) => {
  const { name, description, display_order, status } = req.body;

  // Get Cloudinary URL from uploaded file
  const image_url = req.file ? req.file.path : null; // 'path' contains the secure URL
  if (!name || name.trim() === "") {
    return res
      .status(400)
      .json({ success: false, message: "Name is required" });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO categories (name, description, image_url, display_order, status)
             VALUES (?, ?, ?, ?, ?)`,
      [
        name,
        description || null,
        image_url || null,
        display_order || 0,
        status || "active",
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

    const { name, description, display_order, status } = req.body;
    let image_url = existing[0].image_url; // keep old by default

    // If new file uploaded, use its URL
    if (req.file) {
      image_url = req.file.path;
      //   Optional: delete old image from Cloudinary to save space
      const publicId = existing[0].image_url
        .split("/")
        .slice(-2)
        .join("/")
        .split(".")[0];
      await cloudinary.uploader.destroy(publicId);
    }

    await pool.query(
      `UPDATE categories
             SET name = COALESCE(?, name),
                 description = COALESCE(?, description),
                 image_url = ?,
                 display_order = COALESCE(?, display_order),
                 status = COALESCE(?, status)
             WHERE id = ?`,
      [name, description, image_url, display_order, status, id],
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
