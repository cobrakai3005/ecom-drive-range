// controllers/productVariationController.js
import { pool } from "../config/db.js";

//  GET all variation types (with pagination & optional search)
export const getAllVariationTypes = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const offset = (page - 1) * limit;

    let whereClause = "";
    let params = [];
    if (search) {
      whereClause = "WHERE variation_type LIKE ?";
      params.push(`%${search}%`);
    }

    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM product_variations ${whereClause}`,
      params,
    );
    const total = countResult[0].total;

    const [rows] = await pool.query(
      `SELECT * FROM product_variations ${whereClause}
             ORDER BY display_order ASC, id ASC
             LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    res.json({
      success: true,
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

//  GET single variation type by id
export const getVariationTypeById = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      "SELECT * FROM product_variations WHERE id = ?",
      [id],
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Variation type not found" });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

//  CREATE a new variation type
export const createVariationType = async (req, res) => {
  const { variation_type, display_order } = req.body;
  if (!variation_type || variation_type.trim() === "") {
    return res
      .status(400)
      .json({ success: false, message: "variation_type is required" });
  }
  try {
    const [result] = await pool.query(
      "INSERT INTO product_variations (variation_type, display_order) VALUES (?, ?)",
      [variation_type.trim(), display_order || 0],
    );
    const [newType] = await pool.query(
      "SELECT * FROM product_variations WHERE id = ?",
      [result.insertId],
    );
    res.status(201).json({ success: true, data: newType[0] });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res
        .status(400)
        .json({ success: false, message: "Variation type already exists" });
    }
    console.error(error);
    res.status(500).json({ success: false, message: "Database error" });
  }
};

//  UPDATE a variation type
export const updateVariationType = async (req, res) => {
  const { id } = req.params;
  const { variation_type, display_order } = req.body;
  try {
    const [existing] = await pool.query(
      "SELECT id FROM product_variations WHERE id = ?",
      [id],
    );
    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Variation type not found" });
    }
    await pool.query(
      "UPDATE product_variations SET variation_type = COALESCE(?, variation_type), display_order = COALESCE(?, display_order) WHERE id = ?",
      [variation_type, display_order, id],
    );
    const [updated] = await pool.query(
      "SELECT * FROM product_variations WHERE id = ?",
      [id],
    );
    res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Update error" });
  }
};

//  DELETE a variation type
export const deleteVariationType = async (req, res) => {
  const { id } = req.params;
  try {
    // Check if any product_item uses this variation type
    const [used] = await pool.query(
      "SELECT id FROM product_items WHERE variation_id = ? LIMIT 1",
      [id],
    );
    if (used.length > 0) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete variation type because it is used by some product items",
      });
    }
    const [result] = await pool.query(
      "DELETE FROM product_variations WHERE id = ?",
      [id],
    );
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Variation type not found" });
    }
    res.json({ success: true, message: "Variation type deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
