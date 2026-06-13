// controllers/productItemController.js
import pool from "../config/db.js";

// Helper: check if SKU already exists (for uniqueness)
const isSkuUnique = async (sku, excludeId = null) => {
  let query = "SELECT id FROM product_items WHERE sku = ?";
  let params = [sku];
  if (excludeId) {
    query += " AND id != ?";
    params.push(excludeId);
  }
  const [rows] = await pool.query(query, params);
  return rows.length === 0;
};

//  GET product items with filters, pagination
export const getAllProductItems = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const { product_id, variation_id, is_available, sku } = req.query;

    let whereConditions = [];
    let params = [];

    if (product_id) {
      whereConditions.push("product_id = ?");
      params.push(product_id);
    }
    if (variation_id) {
      whereConditions.push("variation_id = ?");
      params.push(variation_id);
    }
    if (is_available !== undefined) {
      whereConditions.push("is_available = ?");
      params.push(is_available === "true");
    }
    if (sku) {
      whereConditions.push("sku LIKE ?");
      params.push(`%${sku}%`);
    }

    const whereClause = whereConditions.length
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM product_items ${whereClause}`,
      params,
    );
    const total = countResult[0].total;

    const [rows] = await pool.query(
      `SELECT pi.*, vt.variation_type 
             FROM product_items pi
             LEFT JOIN product_variations vt ON pi.variation_id = vt.id
             ${whereClause}
             ORDER BY pi.id ASC
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

//  GET single product item by id
export const getProductItemById = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT pi.*, vt.variation_type 
             FROM product_items pi
             LEFT JOIN product_variations vt ON pi.variation_id = vt.id
             WHERE pi.id = ?`,
      [id],
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Product item not found" });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

//  CREATE product item
export const createProductItem = async (req, res) => {
  const {
    product_id,
    variation_id,
    variation_value,
    sku,
    price,
    weight,
    width,
    height,
    depth,
    is_available,
  } = req.body;

  if (
    !product_id ||
    !variation_id ||
    !variation_value ||
    !sku ||
    price === undefined
  ) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields" });
  }

  try {
    // Validate foreign keys
    const [product] = await pool.query("SELECT id FROM products WHERE id = ?", [
      product_id,
    ]);
    if (product.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "Invalid product_id" });

    const [variation] = await pool.query(
      "SELECT id FROM product_variations WHERE id = ?",
      [variation_id],
    );
    if (variation.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "Invalid variation_id" });

    if (!(await isSkuUnique(sku))) {
      return res
        .status(400)
        .json({ success: false, message: "SKU already exists" });
    }

    const [result] = await pool.query(
      `INSERT INTO product_items 
             (product_id, variation_id, variation_value, sku, price, weight, width, height, depth, is_available)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        product_id,
        variation_id,
        variation_value,
        sku,
        price,
        weight || null,
        width || null,
        height || null,
        depth || null,
        is_available ?? true,
      ],
    );

    const [newItem] = await pool.query(
      "SELECT * FROM product_items WHERE id = ?",
      [result.insertId],
    );
    res.status(201).json({ success: true, data: newItem[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Database error" });
  }
};

//  UPDATE product item
export const updateProductItem = async (req, res) => {
  const { id } = req.params;
  const {
    product_id,
    variation_id,
    variation_value,
    sku,
    price,
    weight,
    width,
    height,
    depth,
    is_available,
  } = req.body;

  try {
    const [existing] = await pool.query(
      "SELECT id, sku FROM product_items WHERE id = ?",
      [id],
    );
    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Product item not found" });
    }

    if (product_id) {
      const [product] = await pool.query(
        "SELECT id FROM products WHERE id = ?",
        [product_id],
      );
      if (product.length === 0)
        return res
          .status(400)
          .json({ success: false, message: "Invalid product_id" });
    }
    if (variation_id) {
      const [variation] = await pool.query(
        "SELECT id FROM product_variations WHERE id = ?",
        [variation_id],
      );
      if (variation.length === 0)
        return res
          .status(400)
          .json({ success: false, message: "Invalid variation_id" });
    }
    if (sku && sku !== existing[0].sku && !(await isSkuUnique(sku, id))) {
      return res
        .status(400)
        .json({ success: false, message: "SKU already exists" });
    }

    await pool.query(
      `UPDATE product_items SET
                product_id = COALESCE(?, product_id),
                variation_id = COALESCE(?, variation_id),
                variation_value = COALESCE(?, variation_value),
                sku = COALESCE(?, sku),
                price = COALESCE(?, price),
                weight = COALESCE(?, weight),
                width = COALESCE(?, width),
                height = COALESCE(?, height),
                depth = COALESCE(?, depth),
                is_available = COALESCE(?, is_available)
             WHERE id = ?`,
      [
        product_id,
        variation_id,
        variation_value,
        sku,
        price,
        weight,
        width,
        height,
        depth,
        is_available,
        id,
      ],
    );

    const [updated] = await pool.query(
      "SELECT * FROM product_items WHERE id = ?",
      [id],
    );
    res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Update error" });
  }
};

//  DELETE product item
export const deleteProductItem = async (req, res) => {
  const { id } = req.params;
  try {
    // Check for associated stock records
    const [stock] = await pool.query(
      "SELECT id FROM product_stock WHERE product_item_id = ? LIMIT 1",
      [id],
    );
    if (stock.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete product item because it has stock records",
      });
    }
    const [result] = await pool.query(
      "DELETE FROM product_items WHERE id = ?",
      [id],
    );
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Product item not found" });
    }
    res.json({ success: true, message: "Product item deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
