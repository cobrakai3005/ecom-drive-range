import { pool } from "../config/db.js";

// Helper: validate shipment status transitions
const isValidStatusTransition = (currentStatus, newStatus) => {
  const transitions = {
    processing: ["in_transit", "returned"],
    in_transit: ["delivered", "returned"],
    delivered: ["returned"],
    returned: [],
  };
  return transitions[currentStatus]?.includes(newStatus) || false;
};

// Get all shipments (Admin, Staff)
export const getAllShipments = async (req, res) => {
  try {
    // Pagination params
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Search/filter params
    const { search, order_id, shipment_status, carrier } = req.query;

    // Base query parts
    let whereClauses = [];
    let queryParams = [];

    if (search) {
      whereClauses.push(
        `(o.id LIKE ? OR s.carrier LIKE ? OR s.tracking_number LIKE ?)`,
      );
      const searchPattern = `%${search}%`;
      queryParams.push(searchPattern, searchPattern, searchPattern);
    }

    if (order_id) {
      whereClauses.push(`s.order_id = ?`);
      queryParams.push(order_id);
    }

    if (shipment_status) {
      whereClauses.push(`s.shipment_status = ?`);
      queryParams.push(shipment_status);
    }

    if (carrier) {
      whereClauses.push(`s.carrier LIKE ?`);
      queryParams.push(`%${carrier}%`);
    }

    const whereSql = whereClauses.length
      ? `WHERE ${whereClauses.join(" AND ")}`
      : "";

    // Count total records (for pagination metadata)
    const countQuery = `
      SELECT COUNT(DISTINCT s.id) as total
      FROM shipments s
      JOIN orders o ON s.order_id = o.id
      ${whereSql}
    `;
    const [countResult] = await pool.query(countQuery, queryParams);
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    // Main query with pagination
    const dataQuery = `
      SELECT s.*, 
             o.id AS order_number,
             COUNT(si.id) as total_items
      FROM shipments s
      JOIN orders o ON s.order_id = o.id
      LEFT JOIN shipment_items si ON s.id = si.shipment_id
      ${whereSql}
      GROUP BY s.id, o.id
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const dataParams = [...queryParams, limit, offset];
    const [shipments] = await pool.query(dataQuery, dataParams);

    res.json({
      success: true,
      data: shipments,
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

// Get shipment by ID (Admin, Staff, Customer - only own orders)
export const getShipmentById = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    let query = `
      SELECT s.*, 
             o.id AS order_number, 
             o.user_id,
             JSON_ARRAYAGG(
               JSON_OBJECT(
                 'order_item_id', si.order_item_id,
                 'quantity_shipped', si.quantity_shipped,
                 'product_name', JSON_UNQUOTE(JSON_EXTRACT(oi.product_data_snapshot, '$.product_name')),
                 'unit_price', oi.unit_price
               )
             ) AS items
      FROM shipments s
      JOIN orders o ON s.order_id = o.id
      JOIN shipment_items si ON s.id = si.shipment_id
      JOIN order_items oi ON si.order_item_id = oi.id
      WHERE s.id = ?
    `;
    const params = [id];

    if (userRole === 'Customer') {
      query += ' AND o.user_id = ?';
      params.push(userId);
    }

    query += ' GROUP BY s.id, o.id, o.user_id';

    const [shipments] = await pool.query(query, params);

    if (shipments.length === 0) {
      return res.status(404).json({ success: false, message: 'Shipment not found' });
    }

    res.json({ success: true, data: shipments[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
// Create a new shipment (Admin, Staff)
export const createShipment = async (req, res) => {
  const { order_id, carrier, tracking_number, tracking_url, items } = req.body;

  if (!order_id || !carrier || !items || !items.length) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Check order exists
    const [order] = await connection.query(
      "SELECT id FROM orders WHERE id = ? FOR UPDATE",
      [order_id],
    );
    if (!order.length) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    // Validate each order item quantity
    for (const item of items) {
      const [orderItem] = await connection.query(
        `SELECT oi.quantity, COALESCE(SUM(si.quantity_shipped), 0) as shipped
         FROM order_items oi
         LEFT JOIN shipment_items si ON oi.id = si.order_item_id
         WHERE oi.id = ? AND oi.order_id = ?
         GROUP BY oi.id`,
        [item.order_item_id, order_id],
      );
      if (!orderItem.length) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Invalid order_item_id: ${item.order_item_id}`,
        });
      }
      const remaining = orderItem[0].quantity - orderItem[0].shipped;
      if (item.quantity_shipped > remaining) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Quantity exceeds remaining for item ${item.order_item_id}`,
        });
      }
    }

    // Create shipment
    const [shipment] = await connection.query(
      `INSERT INTO shipments (order_id, carrier, tracking_number, tracking_url, shipment_status)
       VALUES (?, ?, ?, ?, 'processing')`,
      [order_id, carrier, tracking_number, tracking_url],
    );
    const shipmentId = shipment.insertId;

    // Insert shipment items
    for (const item of items) {
      await connection.query(
        `INSERT INTO shipment_items (shipment_id, order_item_id, quantity_shipped)
         VALUES (?, ?, ?)`,
        [shipmentId, item.order_item_id, item.quantity_shipped],
      );
    }

    await connection.commit();
    res.status(201).json({ success: true, data: { shipment_id: shipmentId } });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "Failed to create shipment" });
  } finally {
    connection.release();
  }
};

// Update shipment status (Admin, Staff)
export const updateShipmentStatus = async (req, res) => {
  const { id } = req.params;
  const { shipment_status } = req.body;

  if (!shipment_status) {
    return res
      .status(400)
      .json({ success: false, message: "Shipment status required" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [shipment] = await connection.query(
      "SELECT * FROM shipments WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!shipment.length) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Shipment not found" });
    }

    const current = shipment[0].shipment_status;
    if (!isValidStatusTransition(current, shipment_status)) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: `Invalid transition from ${current} to ${shipment_status}`,
      });
    }

    let shipped_at = shipment[0].shipped_at;
    let delivered_at = shipment[0].delivered_at;
    if (shipment_status === "in_transit" && !shipped_at)
      shipped_at = new Date();
    if (shipment_status === "delivered" && !delivered_at)
      delivered_at = new Date();

    await connection.query(
      `UPDATE shipments 
       SET shipment_status = ?, shipped_at = ?, delivered_at = ?
       WHERE id = ?`,
      [shipment_status, shipped_at, delivered_at, id],
    );

    // If delivered, check if all shipments for order are delivered
    if (shipment_status === "delivered") {
      const [result] = await connection.query(
        `SELECT COUNT(*) as total, 
                SUM(CASE WHEN shipment_status = 'delivered' THEN 1 ELSE 0 END) as delivered
         FROM shipments WHERE order_id = ?`,
        [shipment[0].order_id],
      );
      if (result[0].total === result[0].delivered) {
        await connection.query(
          'UPDATE orders SET order_status = "delivered" WHERE id = ?',
          [shipment[0].order_id],
        );
      }
    }

    await connection.commit();
    res.json({ success: true, message: "Shipment status updated" });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    connection.release();
  }
};

// Delete shipment (Admin only)
export const deleteShipment = async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await pool.query("DELETE FROM shipments WHERE id = ?", [
      id,
    ]);
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Shipment not found" });
    }
    res.json({ success: true, message: "Shipment deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
