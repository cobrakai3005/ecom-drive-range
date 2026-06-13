// controllers/brandController.js
import { pool } from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

//  GET all brands (with pagination & optional search)
export const getAllBrands = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const offset = (page - 1) * limit;

    let whereClause = "";
    let params = [];
    if (search) {
      whereClause = "WHERE name LIKE ?";
      params.push(`%${search}%`);
    }

    const countQuery = `SELECT COUNT(*) as total FROM brands ${whereClause}`;
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    const dataQuery = `
            SELECT * FROM brands 
            ${whereClause}
            ORDER BY name ASC
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

//  GET single brand by id
export const getBrandById = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query("SELECT * FROM brands WHERE id = ?", [id]);
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Brand not found" });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

//  CREATE brand (with optional logo upload)
export const createBrand = async (req, res) => {
  try {
    const { name, website } = req.body;
    if (!name || name.trim() === "") {
      return res
        .status(400)
        .json({ success: false, message: "Name is required" });
    }

    const logo_url = req.file ? req.file.path : null;

    const [result] = await pool.query(
      "INSERT INTO brands (name, logo_url, website) VALUES (?, ?, ?)",
      [name, logo_url, website || null],
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

//  UPDATE brand (with optional logo replacement)
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

    const { name, website } = req.body;
    let logo_url = existing[0].logo_url;

    if (req.file) {
      // Delete old logo from Cloudinary
      if (existing[0].logo_url) {
        const publicId = existing[0].logo_url
          .split("/")
          .slice(-2)
          .join("/")
          .split(".")[0];
        await cloudinary.uploader.destroy(publicId);
      }
      logo_url = req.file.path;
    }

    await pool.query(
      "UPDATE brands SET name = COALESCE(?, name), logo_url = ?, website = COALESCE(?, website) WHERE id = ?",
      [name, logo_url, website, id],
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

//  DELETE brand (only if no products reference it)
export const deleteBrand = async (req, res) => {
  const { id } = req.params;
  try {
    const [products] = await pool.query(
      "SELECT id FROM products WHERE brand_id = ? LIMIT 1",
      [id],
    );
    if (products.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete brand because it has associated products",
      });
    }

    const [brand] = await pool.query(
      "SELECT logo_url FROM brands WHERE id = ?",
      [id],
    );
    if (brand.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Brand not found" });
    }

    // Delete logo from Cloudinary
    if (brand[0].logo_url) {
      const publicId = brand[0].logo_url
        .split("/")
        .slice(-2)
        .join("/")
        .split(".")[0];
      await cloudinary.uploader.destroy(publicId);
    }

    await pool.query("DELETE FROM brands WHERE id = ?", [id]);
    res.json({ success: true, message: "Brand deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
