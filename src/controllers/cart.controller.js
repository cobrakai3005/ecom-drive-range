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
export const getOrCreateCart = async (
  userId,
  sessionToken,
  connection = null,
) => {
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

    // Pagination & search params
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search
      ? req.query.search.trim().toLowerCase()
      : "";

    if (!userId && !sessionToken) {
      return res
        .status(400)
        .json({ success: false, message: "User or session token required" });
    }

    const cart = await getOrCreateCart(userId, sessionToken);
    const itemsArray = Array.isArray(cart.items)
      ? cart.items
      : JSON.parse(cart.items || "[]");

    if (itemsArray.length === 0) {
      return res.json({
        success: true,
        data: [],
        pagination: { total: 0, page, limit, totalPages: 0 },
      });
    }

    // Extract product IDs
    const productIds = itemsArray.map((item) => item.product_id);

    // Fetch current product data + primary image
    const [productRows] = await pool.query(
      `
      SELECT 
        p.id AS product_id,
        p.name AS product_name,
        p.sku,
        p.price AS current_price,
        p.tax_percentage,
        p.available_stock,
        (
          SELECT image_url 
          FROM product_media 
          WHERE product_id = p.id 
            AND status = 'active' 
          ORDER BY sort_order ASC, id ASC 
          LIMIT 1
        ) AS primary_image
      FROM product p
      WHERE p.id IN (?)
      `,
      [productIds],
    );

    // Build map
    const productMap = {};
    productRows.forEach((row) => {
      productMap[row.product_id] = {
        product_id: row.product_id,
        product_name: row.product_name,
        sku: row.sku,
        current_price: row.current_price,
        available_stock: row.available_stock,
        primary_image: row.primary_image || null,
        tax_percentage: row.tax_percentage || null,
      };
    });

    // Enrich all items
    let enrichedItems = itemsArray.map((item) => {
      const details = productMap[item.product_id];
      return {
        product_id: details?.product_id || item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        added_at: item.added_at,
        snapshot_name: item.name,
        snapshot_image: item.image_url,
        product_name: details?.product_name || item.name,
        sku: details?.sku || null,
        current_price: details?.current_price || item.unit_price,
        available_stock: details?.available_stock || null,
        primary_image: details?.primary_image || item.image_url,
        tax_percentage: details?.tax_percentage || null,  
      };
    });

    // --- Apply search filter ---
    if (search) {
      enrichedItems = enrichedItems.filter(
        (item) =>
          item.product_name?.toLowerCase().includes(search) ||
          item.snapshot_name?.toLowerCase().includes(search),
      );
    }

    // --- Pagination ---
    const total = enrichedItems.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = Math.min(startIndex + limit, total);
    const paginatedItems = enrichedItems.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: paginatedItems,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ========== ADD item to cart ==========

export const addToCart = async (req, res) => {
  const { product_id, quantity } = req.body;
  if (!product_id || !quantity || quantity <= 0) {
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
      itemsArray = safeParseJSON(cartRow[0].items);
    } else {
      const [result] = await connection.query(
        "INSERT INTO cart (user_id, session_token, items) VALUES (?, ?, ?)",
        [userId || null, sessionToken || null, JSON.stringify([])],
      );
      cartId = result.insertId;
      itemsArray = [];
    }

    // ----- MODIFIED PRODUCT QUERY -----
    // Fetch price, stock, name, and the primary image URL (first active image)
    const [itemRows] = await connection.query(
      `SELECT p.price, p.available_stock, p.name,
              (SELECT image_url 
               FROM product_media 
               WHERE product_id = p.id AND status = 'active' 
               ORDER BY sort_order ASC, id ASC LIMIT 1) AS image_url
       FROM product p
       WHERE p.id = ? FOR UPDATE`,
      [product_id],
    );

    if (itemRows.length === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Product item not found" });
    }

    const unitPrice = itemRows[0].price;
    const availableStock = itemRows[0].available_stock;
    const productName = itemRows[0].name;
    const productImage = itemRows[0].image_url || null; // null if no active image

    // Find existing item index
    const existingIndex = itemsArray.findIndex(
      (item) => item.product_id === product_id,
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
      // Keep existing snapshot of name/image (do not overwrite)
    } else {
      // ----- ADD MORE DETAILS TO NEW ITEM -----
      itemsArray.push({
        product_id,
        quantity,
        unit_price: unitPrice,
        added_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        name: productName, // snapshot product name
        image_url: productImage, // snapshot primary image URL
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
  const { productId } = req.params; // product_id
  const { quantity } = req.body;
  if (!parseInt(quantity) || parseInt(quantity) <= 0) {
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
      (item) => item.product_id == productId,
    );
    if (itemIndex === -1) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Cart item not found" });
    }

    // Check stock
    const [stockRow] = await connection.query(
      "SELECT available_stock FROM product WHERE id = ? FOR UPDATE",
      [productId],
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
  const { productId } = req.params; // product_id

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
      (item) => item.product_id != productId,
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
