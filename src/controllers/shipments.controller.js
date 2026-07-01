import { pool } from "../config/db.js"; // Your MySQL connection pool

// 1. CREATE
export const createShipment = async (req, res) => {
  const {
    order_id,
    // tracking_number,
    carrier,
    label_url,
    recipient_address,
    current_status,
  } = req.body;

  try {
    const [result] = await pool.query(
      `INSERT INTO shipments 
             (order_id carrier recipient_address, current_status) 
             VALUES (?, ?, ?, ?)`,
      [order_id, carrier, recipient_address, current_status || "pending"],
    );
    res.status(201).json({ id: result.insertId, message: "Shipment created" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 2. GET ALL (with filters)
export const getAllShipments = async (req, res) => {
  try {
    // 1. Parse query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const status = req.query.status; // 'pending', 'shipped', etc.
    const carrier = req.query.carrier; // 'UPS', 'FedEx', etc.
    const offset = (page - 1) * limit;

    // 2. Build WHERE clause dynamically
    let whereConditions = [];
    let params = [];

    // Search across multiple columns (tracking_number, carrier, recipient_address)
    if (search) {
      whereConditions.push("(carrier LIKE ? OR recipient_address LIKE ?)");
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    // Status filter
    if (status) {
      whereConditions.push("current_status = ?");
      params.push(status);
    }

    // Carrier filter (exact match)
    if (carrier) {
      whereConditions.push("carrier = ?");
      params.push(carrier);
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    // 3. Count total matching records (for pagination)
    const countQuery = `SELECT COUNT(*) as total FROM shipments ${whereClause}`;
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    // 4. Fetch paginated data
    const dataQuery = `
          SELECT 
          s.id,
          s.order_id,
          s.carrier,
          s.recipient_address,
          s.current_status,
          s.tracking_history,
          s.created_at,
          s.updated_at,
          u.full_name AS customer_name,
          u.email AS customer_email,
          u.phone AS customer_phone
      FROM shipments s
      JOIN orders o ON s.order_id = o.id
      JOIN users u ON o.user_id = u.id
      ${whereClause}
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?;
    `;
    const dataParams = [...params, limit, offset];
    const [rows] = await pool.query(dataQuery, dataParams);

    // 5. Send response
    res.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 3. GET BY ID
// export const getShipmentById = async (req, res) => {
//   const { id } = req.params;
//   try {
//     const [rows] = await pool.query("SELECT * FROM shipments WHERE id = ?", [
//       id,
//     ]);
//     if (rows.length === 0)
//       return res.status(404).json({ message: "Shipment not found" });
//     res.json(rows[0]);
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// };

export const getShipmentById = async (req, res) => {
  const { id } = req.params;
  try {
    const query = `
      SELECT 
        s.*,
        o.subtotal, o.shipping_cost, o.tax_amount, o.discount_amount, o.total_amount,
        o.order_status, o.payment_status, o.payment_method, o.order_date, o.admin_notes,
        u.email AS customer_email,
        u.phone AS customer_phone,
        u.role AS customer_role,
        u.full_name AS customer_name,
        sa.full_name AS shipping_full_name,
        sa.phone AS shipping_phone,
        sa.line1 AS shipping_line1,
        sa.line2 AS shipping_line2,
        sa.landmark AS shipping_landmark,
        sa.city AS shipping_city,
        sa.state AS shipping_state,
        sa.postal_code AS shipping_postal_code,
        sa.country AS shipping_country,
        ba.full_name AS billing_full_name,
        ba.phone AS billing_phone,
        ba.line1 AS billing_line1,
        ba.line2 AS billing_line2,
        ba.landmark AS billing_landmark,
        ba.city AS billing_city,
        ba.state AS billing_state,
        ba.postal_code AS billing_postal_code,
        ba.country AS billing_country,
        COALESCE(
          JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', oi.id,
              'quantity', oi.quantity,
              'unit_price', oi.unit_price,
              'total_price', oi.total_price,
              'product', JSON_OBJECT(
                'snapshot', oi.product_data_snapshot,
                'name', JSON_EXTRACT(oi.product_data_snapshot, '$.product_name'),
                'sku', JSON_EXTRACT(oi.product_data_snapshot, '$.sku'),
                'variation', JSON_EXTRACT(oi.product_data_snapshot, '$.variation')
              )
            )
          ),
          JSON_ARRAY()
        ) AS items
      FROM shipments s
      JOIN orders o ON s.order_id = o.id
      JOIN users u ON o.user_id = u.id
      LEFT JOIN user_addresses sa ON o.shipping_address_id = sa.id
      LEFT JOIN user_addresses ba ON o.billing_address_id = ba.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE s.id = ?
      GROUP BY s.id;
    `;
    const [rows] = await pool.query(query, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: "Shipment not found" });
    }
    const shipment = rows[0];

    // Ensure items is always an array (mysql2 may return JSON as string)
    if (typeof shipment.items === "string") {
      shipment.items = JSON.parse(shipment.items);
    }
    // Parse snapshot and fill convenience fields if needed
    if (Array.isArray(shipment.items)) {
      shipment.items = shipment.items.map((item) => {
        if (item.product && typeof item.product.snapshot === "string") {
          item.product.snapshot = JSON.parse(item.product.snapshot);
        }
        // Ensure name/sku/variation are available (fallback to snapshot)
        if (item.product) {
          item.product.name =
            item.product.name || item.product.snapshot?.product_name;
          item.product.sku = item.product.sku || item.product.snapshot?.sku;
          item.product.variation =
            item.product.variation || item.product.snapshot?.variation;
        }
        return item;
      });
    }

    res.json(shipment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
// 4. UPDATE (Full update)
export const updateShipment = async (req, res) => {
  const { id } = req.params;
  const { carrier, label_url, recipient_address, status } = req.body;

  try {
    await pool.query(
      `UPDATE shipments 
             SET 
                 carrier = COALESCE(?, carrier),
                
                 current_status = COALESCE(?, current_status),
                 recipient_address = COALESCE(?, recipient_address)
             WHERE id = ?`,
      [carrier, status, recipient_address, id],
    );
    res.json({ message: "Shipment updated" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 5. UPDATE STATUS ONLY
export const updateStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowedStatuses = [
    "pending",
    "assigned",
    "picked_up",
    "in_transit",
    "out_for_delivery",
    "delivered",
    "failed",
    "returned",
    "cancelled",
  ];

  if (!status) {
    return res.status(400).json({
      success: false,
      message: "Status is required",
    });
  }

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `Invalid status. Allowed statuses are: ${allowedStatuses.join(", ")}`,
    });
  }

  try {
    const systemEvent = {
      event: `Status changed to ${status}`,
      timestamp: new Date().toISOString(),
    };

    const [result] = await pool.query(
      `UPDATE shipments
       SET current_status = ?,
           tracking_history = JSON_ARRAY_APPEND(
             IFNULL(tracking_history, JSON_ARRAY()),
             '$',
             CAST(? AS JSON)
           )
       WHERE id = ?`,
      [status, JSON.stringify(systemEvent), id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Shipment not found",
      });
    }

    res.json({
      success: true,
      message: `Status updated to ${status}`,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// 6. ADD TRACKING EVENT (from carrier API)
export const addTrackingEvent = async (req, res) => {
  const { id } = req.params;
  const { event } = req.body; // Must be a JSON object: { location, description, scan_time }

  if (!event || typeof event !== "object") {
    return res
      .status(400)
      .json({ message: "Valid event JSON object required" });
  }

  try {
    await pool.query(
      `UPDATE shipments 
             SET tracking_history = JSON_ARRAY_APPEND(IFNULL(tracking_history, JSON_ARRAY()), '$', ?)
             WHERE id = ?`,
      [JSON.stringify(event), id],
    );
    res.json({ message: "Tracking event added" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 7. DELETE
export const deleteShipment = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM shipments WHERE id = ?", [id]);
    res.json({ message: "Shipment deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
