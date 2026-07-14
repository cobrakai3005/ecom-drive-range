// controllers/brandController.js
import { pool } from "../config/db.js";
import cloudinary from "../config/cloudinary.js";
import { deleteImage } from "../utils/deleteImages.js";
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
      "SELECT id FROM brands WHERE slug = ? AND (id != ? OR ? IS NULL)",
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
// GET all brands (with pagination, status filter, and optional search)
export const getAllBrands = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const status = req.query.status; // 'active', 'inactive', or undefined
    const offset = (page - 1) * limit;

    // Build WHERE clause dynamically
    let whereConditions = [];
    let params = [];

    if (search) {
      whereConditions.push("name LIKE ?");
      params.push(`%${search}%`);
    }

    if (status === "deleted") {
      whereConditions.push("status = 'inactive'");
      whereConditions.push("is_deleted = 1");
    } else if (status && ["active", "inactive"].includes(status)) {
      whereConditions.push("status = ?");
      whereConditions.push("is_deleted = 0");
      params.push(status);
    } else {
      whereConditions.push("status = 'active'");
      whereConditions.push("is_deleted = 0");
    }
    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    const countQuery = `SELECT COUNT(*) as total FROM brands ${whereClause}`;
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    const dataQuery = `
            SELECT * FROM brands 
            ${whereClause}
             ORDER BY  created_at DESC, id DESC  
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

// GET single brand by id (with optional status check)
export const getBrandByIdOrSlug = async (req, res) => {
  const { identifier } = req.params;
  const isNumeric = !isNaN(identifier);

  // const { status } = req.query;

  try {
    const field = isNumeric ? "p.id" : "p.slug";
    let query = `SELECT * FROM brands WHERE ${field} = ? and status = "active" and is_deleted = 0`;
    const params = [identifier];

    // if (status && ["active", "inactive"].includes(status)) {
    //   query += " AND status = ?";
    //   params.push(status);
    // }

    const [rows] = await pool.query(query, params);
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Brand not found with identifier ${identifier} `,
      });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// CREATE brand (with optional logo upload)
export const createBrand = async (req, res) => {
  try {
    const { name, website, status } = req.body;

    if (!name || name.trim() === "") {
      return res
        .status(400)
        .json({ success: false, message: "Name is required" });
    }
    let slug = generateSlug(name);
    slug = await makeSlugUnique(slug);
    const logo_url = req.file
      ? `${req.protocol}://${req.get("host")}/uploads/brands/${req.file.filename}`
      : null;

    const [result] = await pool.query(
      `INSERT INTO brands (name, slug, logo_url, website, status) 
       VALUES (?, ?, ?, ?, ?)`,
      [name, slug, logo_url, website || null, status || "active"],
    );

    const [newBrand] = await pool.query("SELECT * FROM brands WHERE id = ?", [
      result.insertId,
    ]);
    res.status(201).json({ success: true, data: newBrand[0] });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "Database or upload error" });
  }
};

// UPDATE brand (with optional logo replacement)
export const updateBrand = async (req, res) => {
  const { id } = req.params;

  try {
    const [existing] = await pool.query(
      "SELECT id, logo_url FROM brands WHERE id = ?",
      [id],
    );
    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Brand not found" });
    }

    const { name, website, status } = req.body;
    let logo_url = existing[0].logo_url;
    let slug = existing[0].slug;
    if (name && name !== existing[0].name) {
      slug = generateSlug(name);
      slug = await makeSlugUnique(slug, id);
    }
    if (req.file) {
      // Delete old logo from Cloudinary
      if (existing[0].logo_url) {
        // const publicId = existing[0].logo_url
        //   .split("/")
        //   .slice(-2)
        //   .join("/")
        //   .split(".")[0];
        // await cloudinary.uploader.destroy(publicId);
        await deleteImage(existing[0].logo_url);
      }
      logo_url = `${req.protocol}://${req.get("host")}/uploads/brands/${req.file.filename}`;
    }

    await pool.query(
      `UPDATE brands 
       SET name = COALESCE(?, name),
           logo_url = ?,
           website = COALESCE(?, website),
           status = COALESCE(?, status),
           slug = COALESCE(?, slug)
       WHERE id = ?`,
      [
        name || null,
        logo_url,
        website || null,
        status || null,
        slug || null,
        id,
      ],
    );

    const [updated] = await pool.query("SELECT * FROM brands WHERE id = ?", [
      id,
    ]);
    res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Update error" });
  }
};

// DELETE brand (only if no products reference it)
// export const deleteBrand = async (req, res) => {
//   const { id } = req.params;

//   try {
//     // Check if brand has associated products
//     const [products] = await pool.query(
//       "SELECT id FROM products WHERE brand_id = ? LIMIT 1",
//       [id],
//     );
//     if (products.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: "Cannot delete brand because it has associated products",
//       });
//     }

//     // Get logo URL before deleting
//     const [brand] = await pool.query(
//       "SELECT logo_url FROM brands WHERE id = ?",
//       [id],
//     );
//     if (brand.length === 0) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Brand not found" });
//     }

//     // Delete logo from Cloudinary if exists
//     if (brand[0].logo_url) {
//       // const publicId = brand[0].logo_url
//       //   .split("/")
//       //   .slice(-2)
//       //   .join("/")
//       //   .split(".")[0];
//       // await cloudinary.uploader.destroy(publicId);

//       await deleteImage(brand[0].logo_url);
//     }

//     // Delete from database
//     await pool.query("DELETE FROM brands WHERE id = ?", [id]);
//     res.json({ success: true, message: "Brand deleted successfully" });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };
export const deleteBrand = async (req, res) => {
  const { id } = req.params;

  try {
    const [brands] = await pool.query(
      `
      SELECT id, status, is_deleted
      FROM brands
      WHERE id = ?
      LIMIT 1
      `,
      [id],
    );

    if (brands.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Brand not found",
      });
    }

    if (Number(brands[0].is_deleted) === 1) {
      return res.status(400).json({
        success: false,
        message: "Brand is already deleted",
      });
    }

    const [result] = await pool.query(
      `
      UPDATE brands
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
        message: "Brand could not be deleted",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Brand deleted successfully",
    });
  } catch (error) {
    console.error("Error in deleteBrand:", error);

    return res.status(500).json({
      success: false,
      message: "Server error while deleting brand",
    });
  }
};

export const restoreBrand = async (req, res) => {
  const { id } = req.params;

  try {
    const [brands] = await pool.query(
      `
      SELECT id, status, is_deleted
      FROM brands
      WHERE id = ?
      LIMIT 1
      `,
      [id],
    );

    if (brands.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Brand not found",
      });
    }

    if (Number(brands[0].is_deleted) === 0) {
      return res.status(400).json({
        success: false,
        message: "Brand is not deleted",
      });
    }

    const [result] = await pool.query(
      `
      UPDATE brands
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
        message: "Brand could not be restored",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Brand restored successfully",
    });
  } catch (error) {
    console.error("Error in restoreBrand:", error);

    return res.status(500).json({
      success: false,
      message: "Server error while restoring brand",
    });
  }
};

// ✅ NEW: Toggle brand status (active ↔ inactive)
export const toggleBrandStatus = async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await pool.query("SELECT status FROM brands WHERE id = ?", [
      id,
    ]);
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Brand not found" });
    }

    const currentStatus = rows[0].status;
    const newStatus = currentStatus === "active" ? "inactive" : "active";

    await pool.query("UPDATE brands SET status = ? WHERE id = ?", [
      newStatus,
      id,
    ]);

    const [updated] = await pool.query("SELECT * FROM brands WHERE id = ?", [
      id,
    ]);
    res.json({
      success: true,
      message: `Brand status toggled to ${newStatus}`,
      data: updated[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// NEW: Get only active brands (convenience method for frontend dropdowns)
export const getActiveBrands = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM brands WHERE status = 'active' ORDER BY  name ASC",
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
