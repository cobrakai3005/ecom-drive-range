// controllers/subcategoryController.js
import cloudinary from "../config/cloudinary.js";
import { pool } from "../config/db.js";
import { deleteImage } from "../utils/deleteImages.js";
import fs from "fs";
// ------------------- HELPERS -------------------
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
};

const makeSlugUnique = async (slug, currentId = null) => {
  let uniqueSlug = slug;
  let counter = 1;
  let exists = true;

  while (exists) {
    const [rows] = await pool.query(
      "SELECT id FROM subcategory WHERE slug = ? AND (id != ? OR ? IS NULL)",
      [uniqueSlug, currentId || 0, currentId],
    );
    if (rows.length === 0) {
      exists = false;
    } else {
      uniqueSlug = `${slug}-${counter}`;
      counter++;
    }
  }
  return uniqueSlug;
};
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
    let whereConditions = ["c.is_deleted = 0"];
    let params = [];

    if (status === "deleted") {
      whereConditions.push("s.status = 'inactive'");
      whereConditions.push("s.is_deleted = 1");
    } else if (status && ["active", "inactive"].includes(status)) {
      whereConditions.push("s.status = ?");
      whereConditions.push("s.is_deleted = 0");
      params.push(status);
    } else {
      whereConditions.push("s.status = 'active'");
      whereConditions.push("s.is_deleted = 0");
    }

    if (category_id && !isNaN(category_id)) {
      whereConditions.push("s.category_id = ?");
      params.push(category_id);
    }
    // Search (Multiple columns)
    if (search) {
      whereConditions.push("(s.name LIKE ? OR s.description LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    const joins = `
      FROM subcategory s
      INNER JOIN categories c
        ON c.id = s.category_id
    `;
    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      ${joins}
      ${whereClause}
     
     `;
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    // Get paginated data - ✅ Removed display_order
    const dataQuery = `
            SELECT s.*,
             c.name as category_name
            FROM subcategory s
            JOIN categories c on c.id = s.category_id
            ${whereClause}
              ORDER BY is_front DESC, created_at DESC, id DESC  
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
export const getSubcategoryByIdOrSlug = async (req, res) => {
  const { identifier } = req.params;
  const isNumeric = !isNaN(identifier);

  const { status } = req.query;

  try {
    const field = isNumeric ? "p.id" : "p.slug";
    let query =
      "SELECT * FROM subcategory WHERE " + field + " = ? AND s.is_deleted = 0";
    const params = [identifier];

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
          ? `SubCategory not found with ${isNumeric ? "id" : "slug"} ${identifier} and status ${status}`
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
    console.log("SUbcategories_____", req.body);

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
    let slug = generateSlug(name);
    slug = await makeSlugUnique(slug);
    const image_url = req.file
      ? `${req.protocol}://${req.get("host")}/uploads/subcategories/${req.file.filename}`
      : null;
    // ✅ Convert is_front to 1 or 0
    const isFrontValue =
      is_front === true || is_front === "true" || is_front === 1 ? 1 : 0;

    const [result] = await pool.query(
      `INSERT INTO subcategory (category_id, name, description, image_url, status, is_front, slug)  
             VALUES (?, ?, ?, ?, ?, ?, ?)`, // ✅ Removed display_order
      [
        category_id,
        name,
        description || null,
        image_url,
        status || "active",
        isFrontValue,
        slug,
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
      image_url = req.file
        ? `${req.protocol}://${req.get("host")}/uploads/subcategories/${req.file.filename}`
        : null;
      // Optional: delete old image from Cloudinary
      if (existing[0]?.image_url) {
        // const publicId = existing[0].image_url
        //   .split("/")
        //   .slice(-2)
        //   .join("/")
        //   .split(".")[0];
        // await cloudinary.uploader.destroy(publicId);
        await deleteImage(existing[0]?.image_url);
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
    let slug = existing[0].slug;
    if (name && name !== existing[0].name) {
      slug = generateSlug(name);
      slug = await makeSlugUnique(slug, id);
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
                 is_front = ?,
                 slug = COALESCE(?, slug)
             WHERE id = ?`,
      [
        category_id || null,
        name || null,
        description || null,
        image_url,
        status || null,
        isFrontValue,
        slug || null,
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
// export const deleteSubcategory = async (req, res) => {
//   const { id } = req.params;
//   try {
//     // Check for products using this subcategory
//     const [products] = await pool.query(
//       "SELECT id FROM products WHERE sub_category_id = ? LIMIT 1",
//       [id],
//     );
//     if (products.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: "Cannot delete subcategory because it has associated products",
//       });
//     }

//     // Get image URL before deleting record
//     const [subcat] = await pool.query(
//       "SELECT image_url FROM subcategory WHERE id = ?",
//       [id],
//     );
//     if (subcat.length === 0) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Subcategory not found" });
//     }

//     const imageUrl = subcat[0].image_url;

//     // Delete from database
//     const [result] = await pool.query("DELETE FROM subcategory WHERE id = ?", [
//       id,
//     ]);
//     if (result.affectedRows === 0) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Subcategory not found" });
//     }

//     // Delete image from Cloudinary if exists
//     if (imageUrl) {
//       // const publicId = imageUrl.split("/").slice(-2).join("/").split(".")[0];
//       // await cloudinary.uploader.destroy(publicId);
//       await deleteImage(imageUrl);
//     }

//     res.json({ success: true, message: "Subcategory deleted successfully" });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };

export const deleteSubcategory = async (req, res) => {
  const { id } = req.params;

  try {
    const [subcategories] = await pool.query(
      `
      SELECT id, status, is_deleted
      FROM subcategory
      WHERE id = ?
      LIMIT 1
      `,
      [id],
    );

    if (subcategories.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Subcategory not found",
      });
    }

    if (Number(subcategories[0].is_deleted) === 1) {
      return res.status(400).json({
        success: false,
        message: "Subcategory is already deleted",
      });
    }

    const [result] = await pool.query(
      `
      UPDATE subcategory
      SET
        is_deleted = 1,
        status = 'inactive'
      WHERE id = ?
        AND is_deleted = 0
      `,
      [id],
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: "Subcategory could not be deleted",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Subcategory deleted successfully",
    });
  } catch (error) {
    console.error("Error in deleteSubcategory:", error);

    return res.status(500).json({
      success: false,
      message: "Server error while deleting subcategory",
    });
  }
};

export const restoreSubcategory = async (req, res) => {
  const { id } = req.params;

  try {
    const [subcategories] = await pool.query(
      `
      SELECT id, status, is_deleted
      FROM subcategory
      WHERE id = ?
      LIMIT 1
      `,
      [id],
    );

    if (subcategories.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Subcategory not found",
      });
    }

    if (Number(subcategories[0].is_deleted) === 0) {
      return res.status(400).json({
        success: false,
        message: "Subcategory is not deleted",
      });
    }

    const [result] = await pool.query(
      `
      UPDATE subcategory
      SET
        is_deleted = 0,
        status = 'active'
      WHERE id = ?
        AND is_deleted = 1
      `,
      [id],
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: "Subcategory could not be restored",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Subcategory restored successfully",
    });
  } catch (error) {
    console.error("Error in restoreSubcategory:", error);

    return res.status(500).json({
      success: false,
      message: "Server error while restoring subcategory",
    });
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

export const deleteSubcategoryImage = async (req, res) => {
  const { id } = req.params;

  try {
    // Check if category exists
    const [rows] = await pool.query(
      "SELECT image_url FROM subcategory WHERE id = ?",
      [id],
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Subategory not found",
      });
    }

    const imageUrl = rows[0].image_url;

    // Delete image from Cloudinary if exists
    if (imageUrl) {
      try {
        // Extract public_id from Cloudinary URL
        // const parts = imageUrl.split("/");
        // const fileName = parts.pop().split(".")[0];
        // const folder = parts.slice(parts.indexOf("upload") + 2).join("/");
        // const publicId = folder ? `${folder}/${fileName}` : fileName;

        // await cloudinary.uploader.destroy(publicId);
        await deleteImage(imageUrl);
      } catch (err) {
        console.error("Cloudinary delete failed:", err);
      }
    }

    // Remove image URL from database
    await pool.query("UPDATE subcategory SET image_url = NULL WHERE id = ?", [
      id,
    ]);

    const [updated] = await pool.query(
      "SELECT * FROM subcategory WHERE id = ?",
      [id],
    );

    res.json({
      success: true,
      message: "Subcategory image deleted successfully",
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
