import pool from "../config/db.js";

const allowedStatuses = ["active", "inactive"];

const normalizeState = (state) => {
  return String(state || "")
    .trim()
    .replace(/\s+/g, " ");
};

/**
 * Create shipping cost
 * POST /api/shipping-costs
 */
export const createShippingCost = async (req, res) => {
  try {
    const {
      state,
      shipping_cost,
      estimated_delivery_days,
      status = "active",
    } = req.body;

    const normalizedState = normalizeState(state);
    const parsedShippingCost = Number(shipping_cost);

    if (!normalizedState) {
      return res.status(400).json({
        success: false,
        message: "State is required",
      });
    }

    if (
      shipping_cost === undefined ||
      shipping_cost === null ||
      shipping_cost === "" ||
      !Number.isFinite(parsedShippingCost)
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid shipping cost is required",
      });
    }

    if (parsedShippingCost < 0) {
      return res.status(400).json({
        success: false,
        message: "Shipping cost cannot be negative",
      });
    }

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be active or inactive",
      });
    }

    const [existingRows] = await pool.query(
      `SELECT id
       FROM shipping_costs
       WHERE LOWER(TRIM(state)) = LOWER(TRIM(?))
       LIMIT 1`,
      [normalizedState],
    );

    if (existingRows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Shipping cost for this state already exists",
      });
    }

    const [result] = await pool.query(
      `INSERT INTO shipping_costs (
        state,
        shipping_cost,
        estimated_delivery_days,
        status
      )
      VALUES (?, ?, ?, ?)`,
      [
        normalizedState,
        parsedShippingCost,
        estimated_delivery_days?.trim() || null,
        status,
      ],
    );

    const [[createdShippingCost]] = await pool.query(
      `SELECT *
       FROM shipping_costs
       WHERE id = ?`,
      [result.insertId],
    );

    return res.status(201).json({
      success: true,
      message: "Shipping cost created successfully",
      data: createdShippingCost,
    });
  } catch (error) {
    console.error("Create shipping cost error:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "Shipping cost for this state already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create shipping cost",
      error: error.message,
    });
  }
};

/**
 * Get all shipping costs
 * GET /api/shipping-costs
 *
 * Query:
 * page=1
 * limit=10
 * search=Madhya
 * status=active
 * sort_by=latest | oldest | cost_high | cost_low | state_asc | state_desc
 */
export const getAllShippingCosts = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 10),
    );

    const offset = (page - 1) * limit;

    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const sortBy = String(req.query.sort_by || "latest").trim();

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be active or inactive",
      });
    }

    const conditions = [];
    const params = [];

    if (search) {
      conditions.push(`(state LIKE ? OR estimated_delivery_days LIKE ?)`);

      params.push(`%${search}%`, `%${search}%`);
    }

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sortOptions = {
      latest: "created_at DESC",
      oldest: "created_at ASC",
      cost_high: "shipping_cost DESC",
      cost_low: "shipping_cost ASC",
      state_asc: "state ASC",
      state_desc: "state DESC",
    };

    const orderBy = sortOptions[sortBy] || sortOptions.latest;

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM shipping_costs
       ${whereClause}`,
      params,
    );

    const total = Number(countRows[0].total);

    const [shippingCosts] = await pool.query(
      `SELECT
        id,
        state,
        shipping_cost,
        estimated_delivery_days,
        status,
        created_at,
        updated_at
       FROM shipping_costs
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return res.status(200).json({
      success: true,
      data: shippingCosts,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
        has_next_page: page < Math.ceil(total / limit),
        has_previous_page: page > 1,
      },
    });
  } catch (error) {
    console.error("Get all shipping costs error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch shipping costs",
      error: error.message,
    });
  }
};

/**
 * Get shipping cost by ID
 * GET /api/shipping-costs/:id
 */
export const getShippingCostById = async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid shipping cost ID",
      });
    }

    const [rows] = await pool.query(
      `SELECT
        id,
        state,
        shipping_cost,
        estimated_delivery_days,
        status,
        created_at,
        updated_at
       FROM shipping_costs
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Shipping cost not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    console.error("Get shipping cost by ID error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch shipping cost",
      error: error.message,
    });
  }
};

/**
 * Update shipping cost
 * PUT /api/shipping-costs/:id
 */
export const updateShippingCost = async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid shipping cost ID",
      });
    }

    const [existingRows] = await pool.query(
      `SELECT *
       FROM shipping_costs
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    if (existingRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Shipping cost not found",
      });
    }

    const existingShippingCost = existingRows[0];

    const normalizedState =
      req.body.state !== undefined
        ? normalizeState(req.body.state)
        : existingShippingCost.state;

    const parsedShippingCost =
      req.body.shipping_cost !== undefined
        ? Number(req.body.shipping_cost)
        : Number(existingShippingCost.shipping_cost);

    const estimatedDeliveryDays =
      req.body.estimated_delivery_days !== undefined
        ? req.body.estimated_delivery_days?.trim() || null
        : existingShippingCost.estimated_delivery_days;

    const status =
      req.body.status !== undefined
        ? req.body.status
        : existingShippingCost.status;

    if (!normalizedState) {
      return res.status(400).json({
        success: false,
        message: "State is required",
      });
    }

    if (!Number.isFinite(parsedShippingCost)) {
      return res.status(400).json({
        success: false,
        message: "Shipping cost must be a valid number",
      });
    }

    if (parsedShippingCost < 0) {
      return res.status(400).json({
        success: false,
        message: "Shipping cost cannot be negative",
      });
    }

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be active or inactive",
      });
    }

    const [duplicateRows] = await pool.query(
      `SELECT id
       FROM shipping_costs
       WHERE LOWER(TRIM(state)) = LOWER(TRIM(?))
         AND id != ?
       LIMIT 1`,
      [normalizedState, id],
    );

    if (duplicateRows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Shipping cost for this state already exists",
      });
    }

    await pool.query(
      `UPDATE shipping_costs
       SET
         state = ?,
         shipping_cost = ?,
         estimated_delivery_days = ?,
         status = ?
       WHERE id = ?`,
      [normalizedState, parsedShippingCost, estimatedDeliveryDays, status, id],
    );

    const [[updatedShippingCost]] = await pool.query(
      `SELECT *
       FROM shipping_costs
       WHERE id = ?`,
      [id],
    );

    return res.status(200).json({
      success: true,
      message: "Shipping cost updated successfully",
      data: updatedShippingCost,
    });
  } catch (error) {
    console.error("Update shipping cost error:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "Shipping cost for this state already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update shipping cost",
      error: error.message,
    });
  }
};

/**
 * Update only status
 * PATCH /api/shipping-costs/:id/status
 */
export const updateShippingCostStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid shipping cost ID",
      });
    }

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be active or inactive",
      });
    }

    const [result] = await pool.query(
      `UPDATE shipping_costs
       SET status = ?
       WHERE id = ?`,
      [status, id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Shipping cost not found",
      });
    }

    const [[updatedShippingCost]] = await pool.query(
      `SELECT *
       FROM shipping_costs
       WHERE id = ?`,
      [id],
    );

    return res.status(200).json({
      success: true,
      message: "Shipping cost status updated successfully",
      data: updatedShippingCost,
    });
  } catch (error) {
    console.error("Update shipping cost status error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update shipping cost status",
      error: error.message,
    });
  }
};

/**
 * Delete shipping cost
 * DELETE /api/shipping-costs/:id
 */
// export const deleteShippingCost = async (req, res) => {
//   try {
//     const id = Number(req.params.id);

//     if (!Number.isInteger(id) || id <= 0) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid shipping cost ID",
//       });
//     }

//     const [result] = await pool.query(
//       `DELETE FROM shipping_costs
//        WHERE id = ?`,
//       [id],
//     );

//     if (result.affectedRows === 0) {
//       return res.status(404).json({
//         success: false,
//         message: "Shipping cost not found",
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       message: "Shipping cost deleted successfully",
//     });
//   } catch (error) {
//     console.error("Delete shipping cost error:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Failed to delete shipping cost",
//       error: error.message,
//     });
//   }
// };
export const deleteShippingCost = async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid shipping cost ID",
      });
    }

    const [existing] = await pool.query(
      `SELECT id , status
       FROM shipping_costs
       WHERE id = ? `,
      [id],
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Shipping cost not found",
      });
    }

    if (existing[0].status === "inactive") {
      return res.status(400).json({
        success: false,
        message: "Shipping cost is already deleted",
      });
    }

    await pool.query(
      `UPDATE shipping_costs
       SET
         status = 'inactive'
       WHERE id = ?`,
      [id],
    );

    return res.status(200).json({
      success: true,
      message: "Shipping cost deleted successfully",
    });
  } catch (error) {
    console.error("Delete shipping cost error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete shipping cost",
      error: error.message,
    });
  }
};
/**
 * Get active shipping rate by state
 * GET /api/shipping-costs/state/:state
 *
 * Useful during checkout.
 */
export const getShippingCostByState = async (req, res) => {
  try {
    const state = normalizeState(req.params.state);

    if (!state) {
      return res.status(400).json({
        success: false,
        message: "State is required",
      });
    }

    const [rows] = await pool.query(
      `SELECT
        id,
        state,
        shipping_cost,
        estimated_delivery_days,
        status
       FROM shipping_costs
       WHERE LOWER(TRIM(state)) = LOWER(TRIM(?))
         AND status = 'active'
       LIMIT 1`,
      [state],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Shipping is not available for ${state}`,
      });
    }

    return res.status(200).json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    console.error("Get shipping cost by state error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch shipping cost",
      error: error.message,
    });
  }
};
