// controllers/productAttributeController.js
import { pool } from "../config/db.js";

//  GET attributes for a product
export const getProductAttributes = async (req, res) => {
  const { productId } = req.params;
  try {
    const [rows] = await pool.query(
      "SELECT * FROM product_technical_attributes WHERE product_id = ? ORDER BY display_order ASC, id ASC",
      [productId],
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

//  ADD an attribute to a product
export const addProductAttribute = async (req, res) => {
  const { productId } = req.params;
  const { attribute_name, attribute_value, unit, display_order } = req.body;
  if (!attribute_name || !attribute_value) {
    return res.status(400).json({
      success: false,
      message: "attribute_name and attribute_value are required",
    });
  }
  try {
    const [result] = await pool.query(
      `INSERT INTO product_technical_attributes 
             (product_id, attribute_name, attribute_value, unit, display_order)
             VALUES (?, ?, ?, ?, ?)`,
      [
        productId,
        attribute_name,
        attribute_value,
        unit || null,
        display_order || 0,
      ],
    );
    const [newAttr] = await pool.query(
      "SELECT * FROM product_technical_attributes WHERE id = ?",
      [result.insertId],
    );
    res.status(201).json({ success: true, data: newAttr[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Database error" });
  }
};

//  UPDATE an attribute
export const updateProductAttribute = async (req, res) => {
  const { attributeId } = req.params;
  const { attribute_name, attribute_value, unit, display_order } = req.body;
  try {
    const [existing] = await pool.query(
      "SELECT id FROM product_technical_attributes WHERE id = ?",
      [attributeId],
    );
    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Attribute not found" });
    }
    await pool.query(
      `UPDATE product_technical_attributes SET
                attribute_name = COALESCE(?, attribute_name),
                attribute_value = COALESCE(?, attribute_value),
                unit = COALESCE(?, unit),
                display_order = COALESCE(?, display_order)
             WHERE id = ?`,
      [attribute_name, attribute_value, unit, display_order, attributeId],
    );
    const [updated] = await pool.query(
      "SELECT * FROM product_technical_attributes WHERE id = ?",
      [attributeId],
    );
    res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Update error" });
  }
};

//  DELETE an attribute
export const deleteProductAttribute = async (req, res) => {
  const { attributeId } = req.params;
  try {
    const [result] = await pool.query(
      "DELETE FROM product_technical_attributes WHERE id = ?",
      [attributeId],
    );
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Attribute not found" });
    }
    res.json({ success: true, message: "Attribute deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
