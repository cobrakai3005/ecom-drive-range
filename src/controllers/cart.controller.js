
import { pool } from "../config/db.js";

const safeParseJSON = (jsonField) => {
  // If it's already an array or object, return it directly
  if (Array.isArray(jsonField)) return jsonField;
  if (jsonField && typeof jsonField === "object") return jsonField;

  // If it's a string, try to parse it
  if (typeof jsonField === "string") {
    if (!jsonField || jsonField === "") return [];
    try {
      const parsed = JSON.parse(jsonField);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("JSON parse error:", e.message, "Value:", jsonField);
      return [];
    }
  }

  // Fallback for null, undefined, or other types
  return [];
};
// Helper: get or create cart for user/session
const getOrCreateCart = async (userId, sessionToken, connection = null) => {
  const db = connection || pool;
  let cartId = null;
  console.log(userId);

  if (userId) {
    const [rows] = await db.query(
      "SELECT id, items FROM cart WHERE user_id = ?",
      [userId],
    );
    if (rows.length) return rows[0];
  }
  if (!cartId && sessionToken) {
    const [rows] = await db.query(
      "SELECT id, items FROM cart WHERE session_token = ?",
      [sessionToken],
    );
    if (rows.length) return rows[0];
  }

  // Create new cart
  const [result] = await db.query(
    "INSERT INTO cart (user_id, session_token, items) VALUES (?, ?, ?)",
    [userId || null, sessionToken || null, JSON.stringify([])],
  );
  return { id: result.insertId, items: [] };
};

// ========== GET cart contents ==========
export const getCart = async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const sessionToken = req.headers["x-session-token"] || null;
    if (!userId && !sessionToken) {
      return res
        .status(400)
        .json({ success: false, message: "User or session token required" });
    }

    const cart = await getOrCreateCart(userId, sessionToken);
    const itemsArray = Array.isArray(cart.items)
      ? cart.items
      : JSON.parse(cart.items || "[]");

    // Enrich items with product details
    const enrichedItems = [];
    for (const item of itemsArray) {
      const [productRows] = await pool.query(
        `SELECT pi.sku, pi.price as current_price, pi.variation_value, pi.available_stock,
                p.name as product_name
         FROM product_items pi
         JOIN products p ON pi.product_id = p.id
         WHERE pi.id = ?`,
        [item.product_item_id],
      );
      if (productRows.length) {
        enrichedItems.push({
          ...item,
          product_name: productRows[0].product_name,
          sku: productRows[0].sku,
          current_price: productRows[0].current_price,
          variation_value: productRows[0].variation_value,
          available_stock: productRows[0].available_stock,
        });
      }
    }

    res.json({ success: true, data: enrichedItems });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ========== ADD item to cart ==========
export const addToCart = async (req, res) => {
  const { product_item_id, quantity } = req.body;
  if (!product_item_id || !quantity || quantity <= 0) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid product item or quantity" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const userId = req.user?.id || null;
    const sessionToken = req.headers["x-session-token"] || null;
    if (!userId && !sessionToken) {
      await connection.rollback();
      return res
        .status(400)
        .json({ success: false, message: "User or session token required" });
    }

    // Get or create cart within transaction
    let cartRow;
    if (userId) {
      [cartRow] = await connection.query(
        "SELECT id, items FROM cart WHERE user_id = ? FOR UPDATE",
        [userId],
      );
    }
    if ((!cartRow || cartRow.length === 0) && sessionToken) {
      [cartRow] = await connection.query(
        "SELECT id, items FROM cart WHERE session_token = ? FOR UPDATE",
        [sessionToken],
      );
    }

    let cartId, itemsArray;
    if (cartRow && cartRow.length > 0) {
      cartId = cartRow[0].id;
      itemsArray = safeParseJSON(cartRow[0].items); // No 'let' here
    } else {
      const [result] = await connection.query(
        "INSERT INTO cart (user_id, session_token, items) VALUES (?, ?, ?)",
        [userId || null, sessionToken || null, JSON.stringify([])],
      );
      cartId = result.insertId;
      itemsArray = [];
    }

    // Validate product item and stock
    const [itemRows] = await connection.query(
      "SELECT price, available_stock FROM product_items WHERE id = ? FOR UPDATE",
      [product_item_id],
    );
    if (itemRows.length === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Product item not found" });
    }
    const unitPrice = itemRows[0].price;
    const availableStock = itemRows[0].available_stock;

    // Find existing item index
    const existingIndex = itemsArray.findIndex(
      (item) => item.product_item_id === product_item_id,
    );
    let newQuantity = quantity;
    if (existingIndex !== -1) {
      newQuantity = itemsArray[existingIndex].quantity + quantity;
    }
    if (newQuantity > availableStock) {
      await connection.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Not enough stock" });
    }

    // Update or insert item
    if (existingIndex !== -1) {
      itemsArray[existingIndex].quantity = newQuantity;
      // optional: update unit_price if price changed? Keep original snapshot.
    } else {
      itemsArray.push({
        product_item_id,
        quantity,
        unit_price: unitPrice,
        added_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      });
    }

    // Save back to database
    await connection.query(
      "UPDATE cart SET items = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [JSON.stringify(itemsArray), cartId],
    );

    await connection.commit();
    res.json({ success: true, message: "Item added to cart" });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    connection.release();
  }
};

// ========== UPDATE cart item quantity ==========
export const updateCartItem = async (req, res) => {
  const { itemId } = req.params; // product_item_id
  const { quantity } = req.body;
  if (!quantity || quantity <= 0) {
    return res
      .status(400)
      .json({ success: false, message: "Quantity must be positive" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const userId = req.user?.id || null;
    const sessionToken = req.headers["x-session-token"] || null;
    if (!userId && !sessionToken) {
      await connection.rollback();
      return res
        .status(400)
        .json({ success: false, message: "User or session token required" });
    }

    // Get cart with lock
    let cartRow;
    if (userId) {
      [cartRow] = await connection.query(
        "SELECT id, items FROM cart WHERE user_id = ? FOR UPDATE",
        [userId],
      );
    }
    if ((!cartRow || cartRow.length === 0) && sessionToken) {
      [cartRow] = await connection.query(
        "SELECT id, items FROM cart WHERE session_token = ? FOR UPDATE",
        [sessionToken],
      );
    }
    if (!cartRow || cartRow.length === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Cart not found" });
    }

    const cartId = cartRow[0].id;
    let itemsArray = safeParseJSON(cartRow[0].items || "[]");
    const itemIndex = itemsArray.findIndex(
      (item) => item.product_item_id == itemId,
    );
    if (itemIndex === -1) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Cart item not found" });
    }

    // Check stock
    const [stockRow] = await connection.query(
      "SELECT available_stock FROM product_items WHERE id = ? FOR UPDATE",
      [itemId],
    );
    if (stockRow.length === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Product item not found" });
    }
    if (quantity > stockRow[0].available_stock) {
      await connection.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Not enough stock" });
    }

    itemsArray[itemIndex].quantity = quantity;
    await connection.query(
      "UPDATE cart SET items = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [JSON.stringify(itemsArray), cartId],
    );

    await connection.commit();
    res.json({ success: true, message: "Cart item updated" });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    connection.release();
  }
};

// ========== REMOVE item from cart ==========
export const removeCartItem = async (req, res) => {
  const { itemId } = req.params; // product_item_id
  console.log(itemId);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const userId = req.user?.id || null;
    const sessionToken = req.headers["x-session-token"] || null;
    if (!userId && !sessionToken) {
      await connection.rollback();
      return res
        .status(400)
        .json({ success: false, message: "User or session token required" });
    }

    let cartRow;
    if (userId) {
      [cartRow] = await connection.query(
        "SELECT id, items FROM cart WHERE user_id = ? FOR UPDATE",
        [userId],
      );
    }

    console.log(cartRow);

    if ((!cartRow || cartRow.length === 0) && sessionToken) {
      [cartRow] = await connection.query(
        "SELECT id, items FROM cart WHERE session_token = ? FOR UPDATE",
        [sessionToken],
      );
    }
    if (!cartRow || cartRow.length === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Cart not found" });
    }

    const cartId = cartRow[0].id;
    let itemsArray = safeParseJSON(cartRow[0].items);
    const newItemsArray = itemsArray.filter(
      (item) => item.product_item_id != itemId,
    );
    if (newItemsArray.length === itemsArray.length) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Cart item not found" });
    }

    await connection.query(
      "UPDATE cart SET items = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [JSON.stringify(newItemsArray), cartId],
    );

    await connection.commit();
    res.json({ success: true, message: "Item removed from cart" });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    connection.release();
  }
};

// ========== CLEAR entire cart ==========
export const clearCart = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const userId = req.user?.id || null;
    const sessionToken = req.headers["x-session-token"] || null;
    if (!userId && !sessionToken) {
      await connection.rollback();
      return res
        .status(400)
        .json({ success: false, message: "User or session token required" });
    }

    let cartRow;
    if (userId) {
      [cartRow] = await connection.query(
        "SELECT id FROM cart WHERE user_id = ? FOR UPDATE",
        [userId],
      );
    }
    if ((!cartRow || cartRow.length === 0) && sessionToken) {
      [cartRow] = await connection.query(
        "SELECT id FROM cart WHERE session_token = ? FOR UPDATE",
        [sessionToken],
      );
    }
    if (!cartRow || cartRow.length === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Cart not found" });
    }

    await connection.query(
      "UPDATE cart SET items = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [JSON.stringify([]), cartRow[0].id],
    );

    await connection.commit();
    res.json({ success: true, message: "Cart cleared" });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    connection.release();
  }
};
