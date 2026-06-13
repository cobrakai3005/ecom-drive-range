import { pool } from "../config/db.js";

// Get all config keys (admin/staff)
export const getAllConfig = async (req, res) => {
  try {
    const [configs] = await pool.query(
      `SELECT config_key, config_value, description, updated_at FROM system_config`,
    );
    res.json({ success: true, data: configs });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Get a single config value (can be used publicly)
export const getConfig = async (req, res) => {
  const { key } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT config_value FROM system_config WHERE config_key = ?`,
      [key],
    );
    if (!rows.length)
      return res
        .status(404)
        .json({ success: false, message: "Config key not found" });
    res.json({ success: true, data: rows[0].config_value });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Set or update a config value (admin/staff)
export const setConfig = async (req, res) => {
  const { key } = req.params;
  const { value, description } = req.body;
  if (value === undefined) {
    return res.status(400).json({ success: false, message: "Value required" });
  }
  try {
    const [existing] = await pool.query(
      `SELECT config_key FROM system_config WHERE config_key = ?`,
      [key],
    );
    if (existing.length) {
      await pool.query(
        `UPDATE system_config SET config_value = ?, description = COALESCE(?, description) WHERE config_key = ?`,
        [JSON.stringify(value), description, key],
      );
    } else {
      await pool.query(
        `INSERT INTO system_config (config_key, config_value, description) VALUES (?, ?, ?)`,
        [key, JSON.stringify(value), description || null],
      );
    }
    // Optionally: Insert audit log manually or rely on trigger
    res.json({ success: true, message: "Config saved" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Delete config key (admin only)
export const deleteConfig = async (req, res) => {
  const { key } = req.params;
  try {
    await pool.query(`DELETE FROM system_config WHERE config_key = ?`, [key]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
