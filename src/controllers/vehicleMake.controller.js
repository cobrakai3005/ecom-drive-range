import { pool } from "../config/db.js";
import { logAudit } from "../lib/auditLog.js";
import { deleteImage } from "../utils/deleteImages.js";

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
      "SELECT id FROM vehicle_makes WHERE slug = ? AND (id != ? OR ? IS NULL)",
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
// ========== GET all vehicle makes (public + pagination + search) ==========
export const getAllMakes = async (req, res) => {
  try {
    // Pagination
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;

    // Filters
    const search = req.query.search?.trim() || "";
    let status = req.query.status?.trim() || "active"; // default to active

    // Build WHERE conditions dynamically
    const conditions = [];
    const params = [];

    // Always add status filter unless explicitly set to 'all'
    if (status === "deleted") {
      conditions.push("status = 'inactive'");
      conditions.push("is_deleted = 1");
    } else if (status === "all") {
      conditions.push("is_deleted = 0");
    } else if (status && ["active", "inactive"].includes(status)) {
      conditions.push("status = ?");
      conditions.push("is_deleted = 0");
      params.push(status);
    }

    if (search) {
      conditions.push("name LIKE ?");
      params.push(`%${search}%`);
    }

    // If no conditions, we want all rows (but we usually have at least status)
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    // Count total matching items
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM vehicle_makes ${whereClause}`,
      params,
    );
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit) || 1;

    // Fetch paginated results
    const [rows] = await pool.query(
      `SELECT * FROM vehicle_makes ${whereClause}
       
      ORDER BY  created_at DESC, id DESC ,name ASC 

       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

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

// ========== GET single make by id ==========
export const getMakeByIdOrSlug = async (req, res) => {
  const { identifier } = req.params;
  const isNumeric = !isNaN(identifier);
  try {
    const field = isNumeric ? "p.id" : "p.slug";
    const [rows] = await pool.query(
      `SELECT * FROM vehicle_makes WHERE ${field} = ? and is_deleted = 0`,
      [identifier],
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Vehicle make not found" });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ========== CREATE new vehicle make (admin only) ==========
export const createMake = async (req, res) => {
  const { name, country } = req.body;
  if (!name) {
    return res
      .status(400)
      .json({ success: false, message: "Name is required" });
  }
  let slug = generateSlug(name);
  slug = await makeSlugUnique(slug);
  const logo_url = req.file
    ? `${req.protocol}://${req.get("host")}/uploads/brands/${req.file.filename}`
    : null;

  try {
    const [result] = await pool.query(
      "INSERT INTO vehicle_makes (name, logo_url, country, slug) VALUES (?, ?, ?, ?)",
      [name, logo_url || null, country || null, slug],
    );
    const [newMake] = await pool.query(
      "SELECT * FROM vehicle_makes WHERE id = ?",
      [result.insertId],
    );
    await logAudit({
      userId: req.user.id,
      action: "CREATE_VEHICLE_MAKE",
      tableName: "vehicle_makes",
      recordId: result.insertId,
      oldData: null,
      newData: newMake[0],
      req,
    });
    res.status(201).json({ success: true, data: newMake[0] });
  } catch (error) {
    console.error(error);
    if (error.code === "ER_DUP_ENTRY") {
      return res
        .status(400)
        .json({ success: false, message: "Make name already exists" });
    }
    res.status(500).json({ success: false, message: "Database error" });
  }
};

// ========== UPDATE vehicle make ==========
export const updateMake = async (req, res) => {
  const { id } = req.params;
  const { name, country, status } = req.body;
  try {
    const [existing] = await pool.query(
      "SELECT * FROM vehicle_makes WHERE id = ?",
      [id],
    );
    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Vehicle make not found" });
    }
    let logo_url = null;
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
      logo_url = `${req.protocol}://${req.get("host")}/uploads/vehicle_makes/${req.file.filename}`;
    }

    let slug = existing[0].slug;
    if (name && name !== existing[0].name) {
      slug = generateSlug(name);
      slug = await makeSlugUnique(slug, id);
    }
    await pool.query(
      `UPDATE vehicle_makes
       SET name = COALESCE(?, name), logo_url = COALESCE(?, logo_url), country = COALESCE(?, country), status = COALESCE(?, status), slug = COALESCE(?, slug) WHERE id = ?`,
      [name, logo_url, country, status, slug, id],
    );
    const [updated] = await pool.query(
      "SELECT * FROM vehicle_makes WHERE id = ?",
      [id],
    );
    await logAudit({
      userId: req.user.id,
      action: "UPDATE_VEHICLE_MAKE",
      tableName: "vehicle_makes",
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

// ========== DELETE vehicle make (only if no models exist) ==========
export const deleteMake = async (req, res) => {
  const { id } = req.params;
  try {
    const [models] = await pool.query(
      "SELECT id FROM vehicle_models WHERE make_id = ? LIMIT 1",
      [id],
    );
    if (models.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete make because it has associated models",
      });
    }
    const [existing] = await pool.query(
      "SELECT * FROM vehicle_makes WHERE id = ?",
      [id],
    );
    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Vehicle make not found" });
    }

    if (existing[0].is_deleted === 1) {
      return res.status(400).json({
        success: false,
        message: "Vehicle Makes is already deleted",
      });
    }

    const [result] = await pool.query(
      `UPDATE  vehicle_makes
      SET
        is_deleted = 1,
        status = 'inactive'
      WHERE id = ?`,
      [id],
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: "Vehicle Makes could not be deleted",
      });
    }
    await logAudit({
      userId: req.user.id,
      action: "DELETE_VEHICLE_MAKE",
      tableName: "vehicle_makes",
      recordId: id,
      oldData: existing[0],
      newData: null,
      req,
    });
    res.json({ success: true, message: "Vehicle make deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const restoreMake = async (req, res) => {
  const { id } = req.params;

  try {
    const [existing] = await pool.query(
      `
      SELECT *
      FROM vehicle_makes
      WHERE id = ?
      LIMIT 1
      `,
      [id],
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Vehicle make not found",
      });
    }

    if (Number(existing[0].is_deleted) === 0) {
      return res.status(400).json({
        success: false,
        message: "Vehicle make is not deleted",
      });
    }

    const [result] = await pool.query(
      `
      UPDATE vehicle_makes
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
        message: "Vehicle make could not be restored",
      });
    }

    const newData = {
      ...existing[0],
      is_deleted: 0,
      status: "active",
    };

    await logAudit({
      userId: req.user.id,
      action: "RESTORE_VEHICLE_MAKE",
      tableName: "vehicle_makes",
      recordId: id,
      oldData: existing[0],
      newData,
      req,
    });

    return res.status(200).json({
      success: true,
      message: "Vehicle make restored successfully",
    });
  } catch (error) {
    console.error("Error in restoreMake:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const toggleStatus = async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await pool.query(
      "SELECT status FROM vehicle_makes WHERE id = ?",
      [id],
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Vehicle Makes not found" });
    }

    const currentStatus = rows[0].status;
    const newStatus = currentStatus === "active" ? "inactive" : "active";

    await pool.query("UPDATE vehicle_makes SET status = ? WHERE id = ?", [
      newStatus,
      id,
    ]);

    const [updated] = await pool.query("SELECT * FROM brands WHERE id = ?", [
      id,
    ]);
    res.json({
      success: true,
      message: `Vehicle Makes  status Changed to ${newStatus}`,
      data: updated[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
// export const deleteMake = async (req, res) => {
//   const { id } = req.params;
//   try {
//     const [models] = await pool.query(
//       "SELECT id FROM vehicle_models WHERE make_id = ? LIMIT 1",
//       [id],
//     );
//     if (models.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: "Cannot delete make because it has associated models",
//       });
//     }
//     const [existing] = await pool.query(
//       "SELECT * FROM vehicle_makes WHERE id = ?",
//       [id],
//     );
//     if (existing.length === 0) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Vehicle make not found" });
//     }

//     if (existing[0].logo_url) {
//       await deleteImage(brand[0].logo_url);
//     }
//     await pool.query("DELETE FROM vehicle_makes WHERE id = ?", [id]);
//     await logAudit({
//       userId: req.user.id,
//       action: "DELETE_VEHICLE_MAKE",
//       tableName: "vehicle_makes",
//       recordId: id,
//       oldData: existing[0],
//       newData: null,
//       req,
//     });
//     res.json({ success: true, message: "Vehicle make deleted" });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };
