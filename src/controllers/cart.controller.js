import { pool } from "../config/db.js";

// Helper: get or create cart for user/session
const getOrCreateCart = async (userId, sessionToken) => {
  let cartId = null;
  if (userId) {
    const [rows] = await pool.query("SELECT id FROM cart WHERE user_id = ?", [
      userId,
    ]);
    if (rows.length) cartId = rows[0].id;
  }
  if (!cartId && sessionToken) {
    const [rows] = await pool.query(
      "SELECT id FROM cart WHERE session_token = ?",
      [sessionToken],
    );
    if (rows.length) cartId = rows[0].id;
  }
  if (cartId) return cartId;

  // Create new cart
  const [result] = await pool.query(
    "INSERT INTO cart (user_id, session_token) VALUES (?, ?)",
    [userId || null, sessionToken || null],
  );
  return result.insertId;
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
    const cartId = await getOrCreateCart(userId, sessionToken);
    const [items] = await pool.query(
      `SELECT ci.id, ci.product_item_id, ci.quantity, ci.unit_price, ci.added_at,
                    pi.sku, pi.price as current_price, pi.variation_value,
                    p.name as product_name, pi.available_stock
             FROM cart_items ci
             JOIN product_items pi ON ci.product_item_id = pi.id
             JOIN products p ON pi.product_id = p.id
             WHERE ci.cart_id = ?`,
      [cartId],
    );
    res.json({ success: true, data: items });
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
  try {
    const userId = req.user?.id || null;
    const sessionToken = req.headers["x-session-token"] || null;
    const cartId = await getOrCreateCart(userId, sessionToken);

    // Get current price and stock from product_items
    const [itemRow] = await pool.query(
      "SELECT price, available_stock FROM product_items WHERE id = ?",
      [product_item_id],
    );
    console.log(itemRow);
    if (itemRow.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Product item not found" });
    }
    const unitPrice = itemRow[0].price;
    const availableStock = itemRow[0].available_stock;

    // Check existing cart item
    const [existing] = await pool.query(
      "SELECT id, quantity FROM cart_items WHERE cart_id = ? AND product_item_id = ?",
      [cartId, product_item_id],
    );
    let newQuantity = quantity;
    if (existing.length > 0) {
      newQuantity = existing[0].quantity + quantity;
    }
    if (newQuantity > availableStock) {
      return res
        .status(400)
        .json({ success: false, message: "Not enough stock" });
    }

    if (existing.length > 0) {
      await pool.query("UPDATE cart_items SET quantity = ? WHERE id = ?", [
        newQuantity,
        existing[0].id,
      ]);
    } else {
      await pool.query(
        "INSERT INTO cart_items (cart_id, product_item_id, quantity, unit_price) VALUES (?, ?, ?, ?)",
        [cartId, product_item_id, quantity, unitPrice],
      );
    }
    res.json({ success: true, message: "Item added to cart" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ========== UPDATE cart item quantity ==========
export const updateCartItem = async (req, res) => {
  const { itemId } = req.params;
  const { quantity } = req.body;
  if (!quantity || quantity <= 0) {
    return res
      .status(400)
      .json({ success: false, message: "Quantity must be positive" });
  }
  try {
    const userId = req.user?.id || null;
    const sessionToken = req.headers["x-session-token"] || null;
    const cartId = await getOrCreateCart(userId, sessionToken);

    // Verify item belongs to this cart
    const [item] = await pool.query(
      "SELECT product_item_id FROM cart_items WHERE id = ? AND cart_id = ?",
      [itemId, cartId],
    );
    if (item.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Cart item not found" });
    }
    const [stockRow] = await pool.query(
      "SELECT available_stock FROM product_items WHERE id = ?",
      [item[0].product_item_id],
    );
    if (quantity > stockRow[0].available_stock) {
      return res
        .status(400)
        .json({ success: false, message: "Not enough stock" });
    }
    await pool.query("UPDATE cart_items SET quantity = ? WHERE id = ?", [
      quantity,
      itemId,
    ]);
    res.json({ success: true, message: "Cart item updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ========== REMOVE item from cart ==========
export const removeCartItem = async (req, res) => {
  const { itemId } = req.params;
  try {
    const userId = req.user?.id || null;
    const sessionToken = req.headers["x-session-token"] || null;
    const cartId = await getOrCreateCart(userId, sessionToken);
    const [result] = await pool.query(
      "DELETE FROM cart_items WHERE id = ? AND cart_id = ?",
      [itemId, cartId],
    );
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Cart item not found" });
    }
    res.json({ success: true, message: "Item removed from cart" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ========== CLEAR entire cart ==========
export const clearCart = async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const sessionToken = req.headers["x-session-token"] || null;
    const cartId = await getOrCreateCart(userId, sessionToken);
    await pool.query("DELETE FROM cart_items WHERE cart_id = ?", [cartId]);
    res.json({ success: true, message: "Cart cleared" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
