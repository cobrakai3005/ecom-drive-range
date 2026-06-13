// controllers/productStockController.js
import { pool } from "../config/db.js";

const refreshAvailableStock = async (productItemId) => {
  // Get the single stock record's quantity and reserved_quantity
  const [stock] = await pool.query(
    `SELECT quantity, reserved_quantity 
         FROM product_stock 
         WHERE product_item_id = ?`,
    [productItemId],
  );
  if (stock.length === 0) {
    // No stock record → available = 0
    await pool.query(
      "UPDATE product_items SET available_stock = 0 WHERE id = ?",
      [productItemId],
    );
    return;
  }
  const available = Math.max(0, stock[0].quantity - stock[0].reserved_quantity);
  await pool.query(
    "UPDATE product_items SET available_stock = ? WHERE id = ?",
    [available, productItemId],
  );
};
// ========== Get stock for a product item (optionally by location) ==========
export const getStock = async (req, res) => {
  const { productItemId } = req.params;
  const { location } = req.query;
  try {
    let query = "SELECT * FROM product_stock WHERE product_item_id = ?";
    let params = [productItemId];
    if (location) {
      query += " AND location = ?";
      params.push(location);
    }
    const [rows] = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// // ========== Create or update stock (upsert) ==========
// export const setStock = async (req, res) => {
//   const { productItemId } = req.params;
//   const { quantity, reserved_quantity } = req.body;
//   if (quantity === undefined) {
//     return res
//       .status(400)
//       .json({ success: false, message: "quantity is required" });
//   }
//   try {
//     // Check if product item exists
//     const [item] = await pool.query(
//       "SELECT id FROM product_items WHERE id = ?",
//       [productItemId],
//     );
//     if (item.length === 0) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Product item not found" });
//     }

//     const [existing] = await pool.query(
//       "SELECT id FROM product_stock WHERE product_item_id = ?",
//       [productItemId],
//     );
//     if (existing.length === 0) {
//       // Insert new
//       const [result] = await pool.query(
//         "INSERT INTO product_stock (product_item_id, quantity, reserved_quantity) VALUES (?, ?, ?)",
//         [productItemId, quantity, reserved_quantity || 0],
//       );
//       await refreshAvailableStock(productItemId);
//       const [newStock] = await pool.query(
//         "SELECT * FROM product_stock WHERE id = ?",
//         [result.insertId],
//       );
//       res.status(201).json({ success: true, data: newStock[0] });
//     } else {
//       // Update existing
//       await pool.query(
//         "UPDATE product_stock SET quantity = ?, reserved_quantity = COALESCE(?, reserved_quantity) WHERE id = ?",
//         [quantity, reserved_quantity, existing[0].id],
//       );
//       await refreshAvailableStock(productItemId);
//       const [updated] = await pool.query(
//         "SELECT * FROM product_stock WHERE id = ?",
//         [existing[0].id],
//       );
//       res.json({ success: true, data: updated[0] });
//     }
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Stock update error" });
//   }
// };

// // ========== Adjust stock (increment/decrement) ==========
// export const adjustStock = async (req, res) => {
//   const { productItemId } = req.params;
//   const { quantity_change, reserved_change } = req.body;
//   if (quantity_change === undefined && reserved_change === undefined) {
//     return res.status(400).json({
//       success: false,
//       message: "At least one of quantity_change or reserved_change is required",
//     });
//   }
//   try {
//     const [existing] = await pool.query(
//       "SELECT id, quantity, reserved_quantity FROM product_stock WHERE product_item_id = ?",
//       [productItemId],
//     );
//     if (existing.length === 0) {
//       // Create with initial values using the deltas (assuming starting from 0)
//       const newQuantity =
//         quantity_change !== undefined ? Math.max(0, quantity_change) : 0;
//       const newReserved =
//         reserved_change !== undefined ? Math.max(0, reserved_change) : 0;
//       const [result] = await pool.query(
//         "INSERT INTO product_stock (product_item_id, quantity, reserved_quantity) VALUES (?, ?, ?)",
//         [productItemId, newQuantity, newReserved],
//       );
//       await refreshAvailableStock(productItemId);
//       const [newStock] = await pool.query(
//         "SELECT * FROM product_stock WHERE id = ?",
//         [result.insertId],
//       );
//       return res.json({ success: true, data: newStock[0] });
//     }

//     let updateFields = [];
//     let params = [];
//     if (quantity_change !== undefined) {
//       const newQuantity = Math.max(0, existing[0].quantity + quantity_change);
//       updateFields.push("quantity = ?");
//       params.push(newQuantity);
//     }
//     if (reserved_change !== undefined) {
//       const newReserved = Math.max(
//         0,
//         existing[0].reserved_quantity + reserved_change,
//       );
//       updateFields.push("reserved_quantity = ?");
//       params.push(newReserved);
//     }
//     params.push(existing[0].id);
//     await pool.query(
//       `UPDATE product_stock SET ${updateFields.join(", ")} WHERE id = ?`,
//       params,
//     );
//     await refreshAvailableStock(productItemId);
//     const [updated] = await pool.query(
//       "SELECT * FROM product_stock WHERE id = ?",
//       [existing[0].id],
//     );
//     res.json({ success: true, data: updated[0] });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Stock adjustment error" });
//   }
// };

// ========== Create or update stock (upsert) ==========
export const setStock = async (req, res) => {
  const { productItemId } = req.params;
  const {
    quantity,
    reserved_quantity,
    backorder_allowed,
    threshold_quantity,
    last_restocked_at,
  } = req.body;

  if (quantity === undefined) {
    return res
      .status(400)
      .json({ success: false, message: "quantity is required" });
  }

  try {
    // Check if product item exists
    const [item] = await pool.query(
      "SELECT id FROM product_items WHERE id = ?",
      [productItemId],
    );
    if (item.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Product item not found" });
    }

    const [existing] = await pool.query(
      "SELECT id FROM product_stock WHERE product_item_id = ?",
      [productItemId],
    );

    if (existing.length === 0) {
      // Insert new stock record with all fields
      const [result] = await pool.query(
        `INSERT INTO product_stock 
         (product_item_id, quantity, reserved_quantity, backorder_allowed, threshold_quantity, last_restocked_at) 
         VALUES (?, ?, ?, COALESCE(?, FALSE), COALESCE(?, 0), ?)`,
        [
          productItemId,
          quantity,
          reserved_quantity || 0,
          backorder_allowed,
          threshold_quantity,
          last_restocked_at || null,
        ],
      );
      await refreshAvailableStock(productItemId);
      const [newStock] = await pool.query(
        "SELECT * FROM product_stock WHERE id = ?",
        [result.insertId],
      );
      res.status(201).json({ success: true, data: newStock[0] });
    } else {
      // Build dynamic update query for existing record
      const updateFields = [];
      const params = [];

      updateFields.push("quantity = ?");
      params.push(quantity);

      if (reserved_quantity !== undefined) {
        updateFields.push("reserved_quantity = ?");
        params.push(reserved_quantity);
      }

      if (backorder_allowed !== undefined) {
        updateFields.push("backorder_allowed = ?");
        params.push(backorder_allowed);
      }

      if (threshold_quantity !== undefined) {
        updateFields.push("threshold_quantity = ?");
        params.push(threshold_quantity);
      }

      if (last_restocked_at !== undefined) {
        updateFields.push("last_restocked_at = ?");
        params.push(last_restocked_at);
      }

      params.push(existing[0].id);

      await pool.query(
        `UPDATE product_stock SET ${updateFields.join(", ")} WHERE id = ?`,
        params,
      );
      await refreshAvailableStock(productItemId);
      const [updated] = await pool.query(
        "SELECT * FROM product_stock WHERE id = ?",
        [existing[0].id],
      );
      res.json({ success: true, data: updated[0] });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Stock update error" });
  }
};

// ========== Adjust stock (increment/decrement) ==========
export const adjustStock = async (req, res) => {
  const { productItemId } = req.params;
  const {
    quantity_change,
    reserved_change,
    backorder_allowed,
    threshold_quantity,
  } = req.body;

  if (
    quantity_change === undefined &&
    reserved_change === undefined &&
    backorder_allowed === undefined &&
    threshold_quantity === undefined
  ) {
    return res.status(400).json({
      success: false,
      message: "At least one field to update is required",
    });
  }

  try {
    const [existing] = await pool.query(
      "SELECT id, quantity, reserved_quantity, backorder_allowed, threshold_quantity FROM product_stock WHERE product_item_id = ?",
      [productItemId],
    );

    if (existing.length === 0) {
      // Create new stock record with provided values
      const newQuantity =
        quantity_change !== undefined ? Math.max(0, quantity_change) : 0;
      const newReserved =
        reserved_change !== undefined ? Math.max(0, reserved_change) : 0;

      const [result] = await pool.query(
        `INSERT INTO product_stock 
         (product_item_id, quantity, reserved_quantity, backorder_allowed, threshold_quantity) 
         VALUES (?, ?, ?, COALESCE(?, FALSE), COALESCE(?, 0))`,
        [
          productItemId,
          newQuantity,
          newReserved,
          backorder_allowed,
          threshold_quantity,
        ],
      );
      await refreshAvailableStock(productItemId);
      const [newStock] = await pool.query(
        "SELECT * FROM product_stock WHERE id = ?",
        [result.insertId],
      );
      return res.json({ success: true, data: newStock[0] });
    }

    let updateFields = [];
    let params = [];

    // Handle quantity changes
    if (quantity_change !== undefined) {
      const newQuantity = Math.max(0, existing[0].quantity + quantity_change);
      updateFields.push("quantity = ?");
      params.push(newQuantity);

      // Auto-update last_restocked_at when quantity increases
      if (quantity_change > 0) {
        updateFields.push("last_restocked_at = NOW()");
      }
    }

    // Handle reserved quantity changes
    if (reserved_change !== undefined) {
      const newReserved = Math.max(
        0,
        existing[0].reserved_quantity + reserved_change,
      );
      updateFields.push("reserved_quantity = ?");
      params.push(newReserved);
    }

    // Handle backorder_allowed toggle
    if (backorder_allowed !== undefined) {
      updateFields.push("backorder_allowed = ?");
      params.push(backorder_allowed);
    }

    // Handle threshold_quantity update
    if (threshold_quantity !== undefined) {
      updateFields.push("threshold_quantity = ?");
      params.push(threshold_quantity);
    }

    params.push(existing[0].id);

    await pool.query(
      `UPDATE product_stock SET ${updateFields.join(", ")} WHERE id = ?`,
      params,
    );
    await refreshAvailableStock(productItemId);

    const [updated] = await pool.query(
      "SELECT * FROM product_stock WHERE id = ?",
      [existing[0].id],
    );
    res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Stock adjustment error" });
  }
};

// ========== Check if backorder is allowed for a product ==========
export const canBackorder = async (req, res) => {
  const { productItemId } = req.params;
  const { requested_quantity = 1 } = req.body;

  try {
    const [stock] = await pool.query(
      "SELECT quantity, reserved_quantity, backorder_allowed, threshold_quantity FROM product_stock WHERE product_item_id = ?",
      [productItemId],
    );

    if (stock.length === 0) {
      return res.json({
        success: true,
        data: {
          can_backorder: false,
          reason: "No stock record found",
        },
      });
    }

    const currentStock = stock[0];
    const availableStock =
      currentStock.quantity - currentStock.reserved_quantity;

    if (availableStock >= requested_quantity) {
      return res.json({
        success: true,
        data: {
          can_backorder: false,
          reason: "Sufficient stock available, backorder not needed",
        },
      });
    }

    if (currentStock.backorder_allowed) {
      return res.json({
        success: true,
        data: {
          can_backorder: true,
          reason: "Backorder is allowed for this product",
          shortfall: requested_quantity - availableStock,
        },
      });
    } else {
      return res.json({
        success: true,
        data: {
          can_backorder: false,
          reason: "Backorder is not allowed for this product",
        },
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Backorder check error" });
  }
};

// ========== Get stock status with alerts for threshold ==========
export const getStockStatus = async (req, res) => {
  const { productItemId } = req.params;

  try {
    const [stock] = await pool.query(
      `SELECT 
        ps.*,
        (ps.quantity - ps.reserved_quantity) as available_quantity,
        CASE 
          WHEN (ps.quantity - ps.reserved_quantity) <= 0 THEN 'OUT_OF_STOCK'
          WHEN (ps.quantity - ps.reserved_quantity) <= ps.threshold_quantity THEN 'LOW_STOCK'
          ELSE 'IN_STOCK'
        END as stock_status,
        CASE 
          WHEN (ps.quantity - ps.reserved_quantity) <= ps.threshold_quantity 
            AND (ps.quantity - ps.reserved_quantity) > 0 
          THEN CONCAT('Only ', (ps.quantity - ps.reserved_quantity), ' units remaining. Reorder soon.')
          WHEN (ps.quantity - ps.reserved_quantity) <= 0 AND ps.backorder_allowed = TRUE
          THEN 'Out of stock but backorders accepted'
          WHEN (ps.quantity - ps.reserved_quantity) <= 0 AND ps.backorder_allowed = FALSE
          THEN 'Out of stock - backorders not accepted'
          ELSE NULL
        END as alert_message
      FROM product_stock ps
      WHERE ps.product_item_id = ?`,
      [productItemId],
    );

    if (stock.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Stock record not found",
      });
    }

    res.json({ success: true, data: stock[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Stock status error" });
  }
};

// ========== Bulk update threshold for low-stock products ==========
export const updateLowStockThreshold = async (req, res) => {
  const { productItemId } = req.params;
  const { threshold_quantity } = req.body;

  if (threshold_quantity === undefined || threshold_quantity < 0) {
    return res.status(400).json({
      success: false,
      message: "Valid threshold_quantity is required",
    });
  }

  try {
    const [result] = await pool.query(
      "UPDATE product_stock SET threshold_quantity = ? WHERE product_item_id = ?",
      [threshold_quantity, productItemId],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Stock record not found",
      });
    }

    const [updated] = await pool.query(
      "SELECT * FROM product_stock WHERE product_item_id = ?",
      [productItemId],
    );

    res.json({
      success: true,
      message: "Threshold quantity updated successfully",
      data: updated[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Threshold update error" });
  }
};

// ========== Get all products that need reordering (below threshold) ==========
export const getProductsNeedingReorder = async (req, res) => {
  const { include_backorder_allowed = "false" } = req.query;

  try {
    let query = `
      SELECT 
        ps.product_item_id,
        pi.sku,
        pi.name,
        ps.quantity,
        ps.reserved_quantity,
        (ps.quantity - ps.reserved_quantity) as available_quantity,
        ps.threshold_quantity,
        ps.backorder_allowed,
        ps.last_restocked_at,
        CASE 
          WHEN (ps.quantity - ps.reserved_quantity) <= 0 THEN 'URGENT'
          WHEN (ps.quantity - ps.reserved_quantity) <= ps.threshold_quantity THEN 'LOW'
          ELSE 'OK'
        END as priority
      FROM product_stock ps
      JOIN product_items pi ON ps.product_item_id = pi.id
      WHERE (ps.quantity - ps.reserved_quantity) <= ps.threshold_quantity
    `;

    if (include_backorder_allowed === "false") {
      query += " AND ps.backorder_allowed = FALSE";
    }

    query += " ORDER BY (ps.quantity - ps.reserved_quantity) ASC";

    const [results] = await pool.query(query);

    res.json({
      success: true,
      count: results.length,
      data: results,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Reorder list error" });
  }
};

// ========== Delete stock record (for a location) ==========
export const deleteStock = async (req, res) => {
  const { stockId } = req.params;
  try {
    // Get product_item_id before deleting
    const [stock] = await pool.query(
      "SELECT product_item_id FROM product_stock WHERE id = ?",
      [stockId],
    );
    if (stock.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Stock record not found" });
    }
    const productItemId = stock[0].product_item_id;

    await pool.query("DELETE FROM product_stock WHERE id = ?", [stockId]);
    await refreshAvailableStock(productItemId);
    res.json({ success: true, message: "Stock record deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
