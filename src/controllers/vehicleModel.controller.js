import { pool } from "../config/db.js";
import { logAudit } from "../lib/auditLog.js";

// ========== GET models (filter by make_id, pagination, search) ==========
export const getAllModels = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || "";
    const make_id = req.query.make_id;

    let whereClause = "1=1";
    let params = [];
    if (make_id) {
      whereClause += " AND m.make_id = ?";
      params.push(make_id);
    }
    if (search) {
      whereClause += " AND m.name LIKE ?";
      params.push(`%${search}%`);
    }

    const countQuery = `
      SELECT COUNT(*) as total 
      FROM vehicle_models m
      LEFT JOIN vehicle_makes mk ON m.make_id = mk.id
      WHERE ${whereClause}
    `;
    const [countResult] = await pool.query(countQuery, params);
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    const dataQuery = `
      SELECT m.*, mk.name as make_name
      FROM vehicle_models m
      LEFT JOIN vehicle_makes mk ON m.make_id = mk.id
      WHERE ${whereClause}
      ORDER BY mk.name ASC, m.name ASC
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
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ========== GET single model by id ==========
export const getModelById = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT m.*, mk.name as make_name 
       FROM vehicle_models m
       LEFT JOIN vehicle_makes mk ON m.make_id = mk.id
       WHERE m.id = ?`,
      [id],
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Vehicle model not found" });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ========== CREATE model ==========
export const createModel = async (req, res) => {
  const { make_id, name, description } = req.body;
  if (!make_id || !name) {
    return res.status(400).json({
      success: false,
      message: "make_id and name are required",
    });
  }
  try {
    // Check if make exists
    const [make] = await pool.query(
      "SELECT id FROM vehicle_makes WHERE id = ?",
      [make_id],
    );
    if (make.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid make_id" });
    }

    // Get uploaded image URL (if any)
    const model_image_url = req.file ? req.file.path : null;

    const [result] = await pool.query(
      "INSERT INTO vehicle_models (make_id, name, description, model_image_url) VALUES (?, ?, ?, ?)",
      [make_id, name, description || null, model_image_url],
    );
    const [newModel] = await pool.query(
      "SELECT * FROM vehicle_models WHERE id = ?",
      [result.insertId],
    );
    await logAudit({
      userId: req.user.id,
      action: "CREATE_VEHICLE_MODEL",
      tableName: "vehicle_models",
      recordId: result.insertId,
      oldData: null,
      newData: newModel[0],
      req,
    });
    res.status(201).json({ success: true, data: newModel[0] });
  } catch (error) {
    console.error(error);
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        success: false,
        message: "Model already exists for this make",
      });
    }
    res.status(500).json({ success: false, message: "Database error" });
  }
};

// ========== UPDATE model ==========
export const updateModel = async (req, res) => {
  const { id } = req.params;
  const { make_id, name, description } = req.body;
  try {
    const [existing] = await pool.query(
      "SELECT * FROM vehicle_models WHERE id = ?",
      [id],
    );
    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Vehicle model not found" });
    }
    if (make_id) {
      const [make] = await pool.query(
        "SELECT id FROM vehicle_makes WHERE id = ?",
        [make_id],
      );
      if (make.length === 0) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid make_id" });
      }
    }

    // Handle new image upload
    let model_image_url = existing[0].model_image_url; // keep old by default
    if (req.file) {
      model_image_url = req.file.path;
      // Optional: delete old image from Cloudinary if needed
    }

    await pool.query(
      "UPDATE vehicle_models SET make_id = COALESCE(?, make_id), name = COALESCE(?, name), description = COALESCE(?, description), model_image_url = ? WHERE id = ?",
      [make_id, name, description, model_image_url, id],
    );
    const [updated] = await pool.query(
      "SELECT * FROM vehicle_models WHERE id = ?",
      [id],
    );
    await logAudit({
      userId: req.user.id,
      action: "UPDATE_VEHICLE_MODEL",
      tableName: "vehicle_models",
      recordId: id,
      oldData: existing[0],
      newData: updated[0],
      req,
    });
    res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Update error" });
  }
};

// ========== DELETE model (only if no generations exist) ==========
export const deleteModel = async (req, res) => {
  const { id } = req.params;
  try {
    const [generations] = await pool.query(
      "SELECT id FROM vehicle_generations WHERE model_id = ? LIMIT 1",
      [id],
    );
    if (generations.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete model because it has associated generations",
      });
    }
    const [existing] = await pool.query(
      "SELECT * FROM vehicle_models WHERE id = ?",
      [id],
    );
    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Vehicle model not found" });
    }
    await pool.query("DELETE FROM vehicle_models WHERE id = ?", [id]);
    await logAudit({
      userId: req.user.id,
      action: "DELETE_VEHICLE_MODEL",
      tableName: "vehicle_models",
      recordId: id,
      oldData: existing[0],
      newData: null,
      req,
    });
    res.json({ success: true, message: "Vehicle model deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
