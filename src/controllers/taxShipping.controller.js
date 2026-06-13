import { pool } from "../config/db.js";

// ============ TAX RATES ============
export const getAllTaxRates = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  try {
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM tax_rates`);
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    const [rates] = await pool.query(`SELECT * FROM tax_rates ORDER BY country_code, state_code LIMIT ? OFFSET ?`, [limit, offset]);
    res.json({ success: true, data: rates, pagination: { page, limit, totalItems, totalPages } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const createTaxRate = async (req, res) => {
  const { country_code, state_code, tax_rate, is_active } = req.body;
  if (!country_code || tax_rate === undefined) {
    return res.status(400).json({ success: false, message: "Country and tax rate required" });
  }
  try {
    const [result] = await pool.query(
      `INSERT INTO tax_rates (country_code, state_code, tax_rate, is_active) VALUES (?, ?, ?, ?)`,
      [country_code, state_code || null, tax_rate, is_active !== undefined ? is_active : true]
    );
    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const updateTaxRate = async (req, res) => {
  const { id } = req.params;
  const { tax_rate, is_active } = req.body;
  try {
    await pool.query(`UPDATE tax_rates SET tax_rate = COALESCE(?, tax_rate), is_active = COALESCE(?, is_active) WHERE id = ?`, [tax_rate, is_active, id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const deleteTaxRate = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM tax_rates WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ============ SHIPPING METHODS ============
export const getAllShippingMethods = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  try {
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM shipping_methods`);
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    const [methods] = await pool.query(`SELECT * FROM shipping_methods ORDER BY price ASC LIMIT ? OFFSET ?`, [limit, offset]);
    res.json({ success: true, data: methods, pagination: { page, limit, totalItems, totalPages } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const createShippingMethod = async (req, res) => {
  const { name, price, free_shipping_threshold, estimated_days_min, estimated_days_max, is_active } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ success: false, message: "Name and price required" });
  }
  try {
    const [result] = await pool.query(
      `INSERT INTO shipping_methods (name, price, free_shipping_threshold, estimated_days_min, estimated_days_max, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, price, free_shipping_threshold || null, estimated_days_min || 1, estimated_days_max || 7, is_active !== undefined ? is_active : true]
    );
    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const updateShippingMethod = async (req, res) => {
  const { id } = req.params;
  const { price, free_shipping_threshold, estimated_days_min, estimated_days_max, is_active } = req.body;
  try {
    await pool.query(
      `UPDATE shipping_methods 
       SET price = COALESCE(?, price),
           free_shipping_threshold = COALESCE(?, free_shipping_threshold),
           estimated_days_min = COALESCE(?, estimated_days_min),
           estimated_days_max = COALESCE(?, estimated_days_max),
           is_active = COALESCE(?, is_active)
       WHERE id = ?`,
      [price, free_shipping_threshold, estimated_days_min, estimated_days_max, is_active, id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const deleteShippingMethod = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM shipping_methods WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};