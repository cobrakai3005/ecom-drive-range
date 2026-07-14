import { pool } from "../config/db.js";
import { logAudit } from "../lib/auditLog.js";
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
      "SELECT id FROM vehicle_models WHERE slug = ? AND (id != ? OR ? IS NULL)",
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
// ========== GET models (filter by make_id, search, status, pagination) ==========
export const getAllModels = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;

    const search = req.query.search?.trim() || "";
    const make_id = req.query.make_id;
    const status = req.query.status?.trim() || "active";

    // Include deleted as a valid filter
    if (!["active", "inactive", "deleted"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "status must be 'active', 'inactive', or 'deleted'",
      });
    }

    const conditions = [];
    const params = [];

    if (status === "deleted") {
      conditions.push("m.status = 'inactive'");
      conditions.push("m.is_deleted = 1");
    } else {
      conditions.push("m.status = ?");
      conditions.push("m.is_deleted = 0");
      params.push(status);
    }

    // Only include non-deleted makes
    conditions.push("mk.is_deleted = 0");

    if (make_id) {
      conditions.push("m.make_id = ?");
      params.push(make_id);
    }

    if (search) {
      conditions.push("m.name LIKE ?");
      params.push(`%${search}%`);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const joins = `
      FROM vehicle_models m
      INNER JOIN vehicle_makes mk
        ON m.make_id = mk.id
    `;

    const countQuery = `
      SELECT COUNT(*) AS total
      ${joins}
      ${whereClause}
    `;

    const [countResult] = await pool.query(countQuery, params);
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit) || 1;

    const dataQuery = `
      SELECT
        m.*,
        mk.name AS make_name
      ${joins}
      ${whereClause}
      ORDER BY m.created_at DESC, mk.name ASC, m.name ASC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.query(dataQuery, [...params, limit, offset]);

    return res.status(200).json({
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
    console.error("Error getting vehicle models:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
// ========== GET single model by id ==========
export const getModelByIdOrSlug = async (req, res) => {
  const { identifier } = req.params;
  const isNumeric = !isNaN(identifier);
  try {
    const field = isNumeric ? "m.id" : "m.slug";
    const [rows] = await pool.query(
      `SELECT m.*, mk.name as make_name 
       FROM vehicle_models m
       LEFT JOIN vehicle_makes mk ON m.make_id = mk.id
       WHERE ${field} = ?
         AND m.is_deleted = 0
        AND mk.is_deleted = 0
        AND m.status = 'active'
        AND mk.status = 'active'
        LIMIT 1
       `,
      [identifier],
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
  const { make_id, name, description, status } = req.body;
  if (!make_id || !name) {
    return res.status(400).json({
      success: false,
      message: "make_id and name are required",
    });
  }

  // Validate status if provided
  if (status && !["active", "inactive"].includes(status)) {
    return res.status(400).json({
      success: false,
      message: "status must be 'active' or 'inactive'",
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
    const model_image_url = req.file
      ? `${req.protocol}://${req.get("host")}/uploads/brands/${req.file.filename}`
      : null;

    // Use provided status, default to 'active' if not given
    const finalStatus = status || "active";
    let slug = generateSlug(name);
    slug = await makeSlugUnique(slug);
    const [result] = await pool.query(
      "INSERT INTO vehicle_models (make_id, name, description, model_image_url, status, slug) VALUES (?, ?, ?, ?, ?, ?)",
      [make_id, name, description || null, model_image_url, finalStatus, slug],
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
  const { make_id, name, description, status } = req.body;

  // Validate status if provided
  if (status && !["active", "inactive"].includes(status)) {
    return res.status(400).json({
      success: false,
      message: "status must be 'active' or 'inactive'",
    });
  }

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
    let slug = existing[0].slug;
    if (name && name !== existing[0].name) {
      slug = generateSlug(name);
      slug = await makeSlugUnique(slug, id);
    }
    // Validate make_id if provided
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

    // Handle image upload (if any)
    let model_image_url = existing[0].model_image_url; // keep old by default
    if (req.file) {
      await deleteImage(existing[0].logo_url);
      model_image_url = `${req.protocol}://${req.get("host")}/uploads/vehicle_models/${req.file.filename}`;
      // Optional: delete old image from Cloudinary if needed
    }

    // Build update fields dynamically (only provided fields)
    const fields = [];
    const values = [];

    if (make_id) {
      fields.push("make_id = ?");
      values.push(make_id);
    }
    if (name) {
      fields.push("name = ?");
      values.push(name);

      fields.push("slug = ?");
      values.push(slug);
    }
    if (description !== undefined) {
      fields.push("description = ?");
      values.push(description);
    }
    if (status) {
      fields.push("status = ?");
      values.push(status);
    }
    if (req.file) {
      fields.push("model_image_url = ?");
      values.push(model_image_url);
    }

    // If nothing to update
    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update",
      });
    }

    values.push(id);
    await pool.query(
      `UPDATE vehicle_models SET ${fields.join(", ")} WHERE id = ?`,
      values,
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
// export const deleteModel = async (req, res) => {
//   const { id } = req.params;
//   try {
//     const [generations] = await pool.query(
//       "SELECT id FROM vehicle_generations WHERE model_id = ? LIMIT 1",
//       [id],
//     );
//     if (generations.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: "Cannot delete model because it has associated generations",
//       });
//     }
//     const [existing] = await pool.query(
//       "SELECT * FROM vehicle_models WHERE id = ?",
//       [id],
//     );
//     if (existing.length === 0) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Vehicle model not found" });
//     }
//     const image = existing[0].model_image_url;

//     await deleteImage(image);
//     await pool.query("DELETE FROM vehicle_models WHERE id = ?", [id]);
//     await logAudit({
//       userId: req.user.id,
//       action: "DELETE_VEHICLE_MODEL",
//       tableName: "vehicle_models",
//       recordId: id,
//       oldData: existing[0],
//       newData: null,
//       req,
//     });
//     res.json({ success: true, message: "Vehicle model deleted" });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };

export const deleteModel = async (req, res) => {
  const { id } = req.params;

  try {
    const [existing] = await pool.query(
      `
      SELECT *
      FROM vehicle_models
      WHERE id = ?
      LIMIT 1
      `,
      [id],
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Vehicle model not found",
      });
    }

    if (Number(existing[0].is_deleted) === 1) {
      return res.status(400).json({
        success: false,
        message: "Vehicle model is already deleted",
      });
    }

    const [result] = await pool.query(
      `
      UPDATE vehicle_models
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
        message: "Vehicle model could not be deleted",
      });
    }

    const newData = {
      ...existing[0],
      is_deleted: 1,
      status: "inactive",
    };

    await logAudit({
      userId: req.user.id,
      action: "SOFT_DELETE_VEHICLE_MODEL",
      tableName: "vehicle_models",
      recordId: id,
      oldData: existing[0],
      newData,
      req,
    });

    return res.status(200).json({
      success: true,
      message: "Vehicle model deleted successfully",
    });
  } catch (error) {
    console.error("Error in deleteModel:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const restoreModel = async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query(
      `
      UPDATE vehicle_models
      SET
        is_deleted = 0,
        status = 'active'
      WHERE id = ?
        AND is_deleted = 1
      `,
      [id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Deleted vehicle model not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Vehicle model restored successfully",
    });
  } catch (error) {
    console.error("Error in restoreModel:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
