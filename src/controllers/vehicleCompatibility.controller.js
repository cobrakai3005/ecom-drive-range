import { pool } from "../config/db.js";
import { logAudit } from "../lib/auditLog.js";

// ========== Get compatibility list for a product ==========
// export const getCompatibilityByProduct = async (req, res) => {
//   const { productId } = req.params;
//   try {
//     const [rows] = await pool.query(
//       `SELECT pvc.*,
//               g.generation_name, g.year_from, g.year_to,
//               m.name as model_name, mk.name as make_name
//        FROM product_vehicle_compatibility pvc
//        JOIN vehicle_generations g ON pvc.vehicle_generation_id = g.id
//        JOIN vehicle_models m ON g.model_id = m.id
//        JOIN vehicle_makes mk ON m.make_id = mk.id
//        WHERE pvc.product_id = ?
//        ORDER BY mk.name, m.name, g.year_from`,
//       [productId],
//     );
//     res.json({ success: true, data: rows });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };

export const getCompatibilityByProduct = async (req, res) => {
  const { productId } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT pvc.*, 
              g.generation_name, 
              g.year_from, 
              g.year_to,
              m.name as model_name,
              m.model_image_url as model_image_url,
              mk.name as make_name,
              mk.logo_url as make_logo_url,
              mk.country as make_country
       FROM product_vehicle_compatibility pvc
       JOIN vehicle_generations g ON pvc.vehicle_generation_id = g.id
       JOIN vehicle_models m ON g.model_id = m.id
       JOIN vehicle_makes mk ON m.make_id = mk.id
       WHERE pvc.product_id = ?
       ORDER BY mk.name, m.name, g.year_from`,
      [productId],
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ========== Add vehicle compatibility to a product ==========
// export const addCompatibility = async (req, res) => {
//   const { productId } = req.params;
//   const { vehicle_generation_id, compatibility_notes } = req.body;
//   if (!vehicle_generation_id) {
//     return res.status(400).json({
//       success: false,
//       message: "vehicle_generation_id is required",
//     });
//   }
//   try {
//     // Verify product exists
//     const [product] = await pool.query("SELECT id FROM products WHERE id = ?", [
//       productId,
//     ]);
//     if (product.length === 0) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Product not found" });
//     }
//     const [gen] = await pool.query(
//       "SELECT id FROM vehicle_generations WHERE id = ?",
//       [vehicle_generation_id],
//     );
//     if (gen.length === 0) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Invalid vehicle_generation_id" });
//     }
//     const [result] = await pool.query(
//       `INSERT INTO product_vehicle_compatibility 
//        (product_id, vehicle_generation_id, compatibility_notes)
//        VALUES (?, ?, ?)`,
//       [productId, vehicle_generation_id, compatibility_notes || null],
//     );
//     const [newCompat] = await pool.query(
//       `SELECT pvc.*, g.generation_name, g.year_from, g.year_to, m.name as model_name, mk.name as make_name
//        FROM product_vehicle_compatibility pvc
//        JOIN vehicle_generations g ON pvc.vehicle_generation_id = g.id
//        JOIN vehicle_models m ON g.model_id = m.id
//        JOIN vehicle_makes mk ON m.make_id = mk.id
//        WHERE pvc.id = ?`,
//       [result.insertId],
//     );
//     await logAudit({
//       userId: req.user.id,
//       action: "ADD_PRODUCT_VEHICLE_COMPATIBILITY",
//       tableName: "product_vehicle_compatibility",
//       recordId: result.insertId,
//       oldData: null,
//       newData: newCompat[0],
//       req,
//     });
//     res.status(201).json({ success: true, data: newCompat[0] });
//   } catch (error) {
//     console.error(error);
//     if (error.code === "ER_DUP_ENTRY") {
//       return res.status(400).json({
//         success: false,
//         message: "This compatibility already exists for the product",
//       });
//     }
//     res.status(500).json({ success: false, message: "Database error" });
//   }
// };


export const addCompatibility = async (req, res) => {
  const { productId } = req.params;
  const { vehicle_generation_ids, compatibility_notes } = req.body;

  // Validate input
  if (!vehicle_generation_ids || !Array.isArray(vehicle_generation_ids) || vehicle_generation_ids.length === 0) {
    return res.status(400).json({
      success: false,
      message: "vehicle_generation_ids must be a non‑empty array",
    });
  }

  try {
    // 1. Verify product exists
    const [product] = await pool.query("SELECT id FROM products WHERE id = ?", [productId]);
    if (product.length === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    // 2. Validate all generation IDs exist
    const placeholders = vehicle_generation_ids.map(() => '?').join(',');
    const [generations] = await pool.query(
      `SELECT id FROM vehicle_generations WHERE id IN (${placeholders})`,
      vehicle_generation_ids
    );
    const foundIds = generations.map(row => row.id);
    const missingIds = vehicle_generation_ids.filter(id => !foundIds.includes(id));
    if (missingIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid vehicle_generation_id(s): ${missingIds.join(', ')}`,
      });
    }

    // 3. Check for existing entries to avoid duplicates (optional, can also rely on UNIQUE constraint)
    const [existing] = await pool.query(
      `SELECT vehicle_generation_id FROM product_vehicle_compatibility 
       WHERE product_id = ? AND vehicle_generation_id IN (${placeholders})`,
      [productId, ...vehicle_generation_ids]
    );
    const existingIds = existing.map(row => row.vehicle_generation_id);
    if (existingIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Compatibility already exists for generation(s): ${existingIds.join(', ')}`,
      });
    }

    // 4. Prepare values for bulk insert
    const values = vehicle_generation_ids.map(id => [
      productId,
      id,
      compatibility_notes || null,
    ]);

    // 5. Bulk insert
    const [result] = await pool.query(
      `INSERT INTO product_vehicle_compatibility 
       (product_id, vehicle_generation_id, compatibility_notes)
       VALUES ?`,
      [values]
    );

    // 6. Fetch all newly inserted records (using the first insertId and row count)
    const [newCompat] = await pool.query(
      `SELECT pvc.*, 
              g.generation_name, g.year_from, g.year_to, 
              m.name AS model_name, 
              mk.name AS make_name
       FROM product_vehicle_compatibility pvc
       JOIN vehicle_generations g ON pvc.vehicle_generation_id = g.id
       JOIN vehicle_models m ON g.model_id = m.id
       JOIN vehicle_makes mk ON m.make_id = mk.id
       WHERE pvc.id >= ? AND pvc.id < ? + ? 
         AND pvc.product_id = ?
       ORDER BY pvc.id ASC`,
      [result.insertId, result.insertId, result.affectedRows, productId]
    );

    // 7. Audit log for each new record
    for (const record of newCompat) {
      await logAudit({
        userId: req.user.id,
        action: "ADD_PRODUCT_VEHICLE_COMPATIBILITY",
        tableName: "product_vehicle_compatibility",
        recordId: record.id,
        oldData: null,
        newData: record,
        req,
      });
    }

    res.status(201).json({ success: true, data: newCompat });
  } catch (error) {
    console.error(error);
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        success: false,
        message: "One or more compatibility entries already exist for the product",
      });
    }
    res.status(500).json({ success: false, message: "Database error" });
  }
};

// ========== Remove compatibility ==========
export const removeCompatibility = async (req, res) => {
  const { id } = req.params;
  try {
    const [existing] = await pool.query(
      "SELECT * FROM product_vehicle_compatibility WHERE id = ?",
      [id],
    );
    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Compatibility record not found" });
    }
    await pool.query("DELETE FROM product_vehicle_compatibility WHERE id = ?", [
      id,
    ]);
    await logAudit({
      userId: req.user.id,
      action: "REMOVE_PRODUCT_VEHICLE_COMPATIBILITY",
      tableName: "product_vehicle_compatibility",
      recordId: id,
      oldData: existing[0],
      newData: null,
      req,
    });
    res.json({ success: true, message: "Compatibility removed" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ========== Get products that fit a specific vehicle generation ==========
export const getProductsByVehicle = async (req, res) => {
  const { generationId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  try {
    const countQuery = `
      SELECT COUNT(*) as total
      FROM product_vehicle_compatibility pvc
      WHERE pvc.vehicle_generation_id = ?
    `;
    const [countResult] = await pool.query(countQuery, [generationId]);
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);
    const [rows] = await pool.query(
      `SELECT p.*, pvc.compatibility_notes
       FROM product_vehicle_compatibility pvc
       JOIN products p ON pvc.product_id = p.id
       WHERE pvc.vehicle_generation_id = ?
       LIMIT ? OFFSET ?`,
      [generationId, limit, offset],
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
