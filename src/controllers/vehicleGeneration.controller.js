import { pool } from "../config/db.js";
import { logAudit } from "../lib/auditLog.js";

// ========== GET generations (filter by model_id, year, pagination) ==========

export const getAllGenerations = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const model_id = req.query.model_id;
    const year = req.query.year;
    const status = req.query.status; // 'active' or 'inactive'
    const search = req.query.search; // free text search

    let whereClause = "1=1";
    let params = [];

    if (model_id) {
      whereClause += " AND g.model_id = ?";
      params.push(model_id);
    }
    if (year) {
      whereClause +=
        " AND g.year_from <= ? AND (g.year_to >= ? OR g.year_to IS NULL)";
      params.push(year, year);
    }
    if (status) {
      whereClause += " AND g.status = ?";
      params.push(status);
    }
    if (search) {
      whereClause +=
        " AND (g.generation_name LIKE ? OR m.name LIKE ? OR mk.name LIKE ?)";
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    // Count query – now includes joins because search may need them
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM vehicle_generations g
      JOIN vehicle_models m ON g.model_id = m.id
      JOIN vehicle_makes mk ON m.make_id = mk.id
      WHERE ${whereClause}
    `;
    const [countResult] = await pool.query(countQuery, params);
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    // Data query
    const dataQuery = `
      SELECT g.*, m.name as model_name, mk.name as make_name
      FROM vehicle_generations g
      JOIN vehicle_models m ON g.model_id = m.id
      JOIN vehicle_makes mk ON m.make_id = mk.id
      WHERE ${whereClause}
     
        ORDER BY  created_at DESC, mk.name ASC, m.name ASC, g.year_from ASC
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

// ========== GET single generation by id ==========
export const getAvailableVehicleGenerations = async (req, res) => {
  try {
    const { productId } = req.params;

    const [rows] = await pool.query(
      `SELECT
          vg.id,
          vg.year_from,
          vg.year_to,
          vm.name AS model_name,
          mk.name AS make_name
      FROM vehicle_generations vg
      JOIN vehicle_models vm
          ON vg.model_id = vm.id
      JOIN vehicle_makes mk
          ON vm.make_id = mk.id
      WHERE NOT EXISTS (
          SELECT 1
          FROM product_vehicle_compatibility pvc
          WHERE pvc.product_id = ?
            AND pvc.vehicle_generation_id = vg.id
      )
      ORDER BY mk.name, vm.name, vg.year_from`,
      [productId],
    );

    res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
export const getGenerationById = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT g.*, m.name as model_name, mk.name as make_name
       FROM vehicle_generations g
       JOIN vehicle_models m ON g.model_id = m.id
       JOIN vehicle_makes mk ON m.make_id = mk.id
       WHERE g.id = ?`,
      [id],
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Vehicle generation not found" });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ========== CREATE generation ==========
export const createGeneration = async (req, res) => {
  const {
    model_id,
    generation_name,
    year_from,
    year_to,
    engine_options,
    status,
  } = req.body;
  if (!model_id || !year_from) {
    return res.status(400).json({
      success: false,
      message: "model_id and year_from are required",
    });
  }
  if (year_to && year_to < year_from) {
    return res.status(400).json({
      success: false,
      message: "year_to cannot be less than year_from",
    });
  }
  try {
    const [model] = await pool.query(
      "SELECT id FROM vehicle_models WHERE id = ?",
      [model_id],
    );
    if (model.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid model_id" });
    }
    const [result] = await pool.query(
      `INSERT INTO vehicle_generations 
       (model_id, generation_name, year_from, year_to, engine_options, status) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        model_id,
        generation_name || null,
        year_from,
        year_to || null,
        engine_options || null,
        status || "active",
      ],
    );
    const [newGen] = await pool.query(
      "SELECT * FROM vehicle_generations WHERE id = ?",
      [result.insertId],
    );
    await logAudit({
      userId: req.user.id,
      action: "CREATE_VEHICLE_GENERATION",
      tableName: "vehicle_generations",
      recordId: result.insertId,
      oldData: null,
      newData: newGen[0],
      req,
    });
    res.status(201).json({ success: true, data: newGen[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Database error" });
  }
};

// ========== UPDATE generation ==========
export const updateGeneration = async (req, res) => {
  const { id } = req.params;
  const {
    model_id,
    generation_name,
    year_from,
    year_to,
    engine_options,
    status,
  } = req.body;
  try {
    const [existing] = await pool.query(
      "SELECT * FROM vehicle_generations WHERE id = ?",
      [id],
    );
    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Vehicle generation not found" });
    }
    if (model_id) {
      const [model] = await pool.query(
        "SELECT id FROM vehicle_models WHERE id = ?",
        [model_id],
      );
      if (model.length === 0) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid model_id" });
      }
    }
    await pool.query(
      `UPDATE vehicle_generations SET 
       model_id = COALESCE(?, model_id),
       generation_name = COALESCE(?, generation_name),
       year_from = COALESCE(?, year_from),
       year_to = COALESCE(?, year_to),
       engine_options = COALESCE(?, engine_options),
       status = COALESCE(?, engine_options)
       WHERE id = ?`,
      [
        model_id,
        generation_name,
        year_from,
        year_to,
        engine_options,
        status,
        id,
      ],
    );
    const [updated] = await pool.query(
      "SELECT * FROM vehicle_generations WHERE id = ?",
      [id],
    );
    await logAudit({
      userId: req.user.id,
      action: "UPDATE_VEHICLE_GENERATION",
      tableName: "vehicle_generations",
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

// ========== DELETE generation (only if no product compatibility exists) ==========
export const deleteGeneration = async (req, res) => {
  const { id } = req.params;
  try {
    const [compat] = await pool.query(
      "SELECT id FROM product_vehicle_compatibility WHERE vehicle_generation_id = ? LIMIT 1",
      [id],
    );
    if (compat.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete generation because it is linked to products",
      });
    }
    const [existing] = await pool.query(
      "SELECT * FROM vehicle_generations WHERE id = ?",
      [id],
    );
    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Vehicle generation not found" });
    }
    await pool.query("DELETE FROM vehicle_generations WHERE id = ?", [id]);
    await logAudit({
      userId: req.user.id,
      action: "DELETE_VEHICLE_GENERATION",
      tableName: "vehicle_generations",
      recordId: id,
      oldData: existing[0],
      newData: null,
      req,
    });
    res.json({ success: true, message: "Vehicle generation deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
