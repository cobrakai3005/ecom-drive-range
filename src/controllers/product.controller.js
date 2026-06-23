// controllers/productController.js
import pool from "../config/db.js";

// Helper: generate unique slug from name
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // remove special chars
    .replace(/\s+/g, "-") // replace spaces with hyphens
    .replace(/-+/g, "-"); // remove multiple hyphens
};

const makeSlugUnique = async (slug, currentId = null) => {
  let uniqueSlug = slug;
  let counter = 1;
  let exists = true;
  while (exists) {
    const [rows] = await pool.query(
      "SELECT id FROM products WHERE slug = ? AND (id != ? OR ? IS NULL)",
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

//  GET products with filters, pagination, search
// export const getAllProducts = async (req, res) => {
//   try {
//     // Pagination
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 10;
//     const offset = (page - 1) * limit;

//     // Filters
//     const status = req.query.status; // 'active' or 'inactive' (optional)
//     const category_id = req.query.category_id;
//     const sub_category_id = req.query.sub_category_id;
//     const brand_id = req.query.brand_id;
//     const search = req.query.search;

//     let whereConditions = [];
//     let params = [];

//     // Base conditions: product status defaults to 'active' unless overridden
//     if (status && ["active", "inactive"].includes(status)) {
//       whereConditions.push("p.status = ?");
//       params.push(status);
//     } else {
//       // Default: only active products
//       whereConditions.push("p.status = 'active'");
//     }

//     // Category must be active
//     whereConditions.push("c.status = 'active'");

//     // Subcategory: if exists, must be active; if null, ignore
//     whereConditions.push("(sc.id IS NULL OR sc.status = 'active')");

//     //Brand must be active
//     whereConditions.push("b.status = 'active'");
//     // Optional filters
//     if (category_id) {
//       whereConditions.push("p.category_id = ?");
//       params.push(category_id);
//     }
//     if (sub_category_id) {
//       whereConditions.push("p.sub_category_id = ?");
//       params.push(sub_category_id);
//     }
//     if (brand_id) {
//       whereConditions.push("p.brand_id = ?");
//       params.push(brand_id);
//     }
//     if (search) {
//       whereConditions.push("(p.name LIKE ? OR p.slug LIKE ?)");
//       params.push(`%${search}%`, `%${search}%`);
//     }

//     const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

//     // Count total
//     const countQuery = `
//       SELECT COUNT(*) as total
//       FROM products p
//       LEFT JOIN categories c ON p.category_id = c.id
//       LEFT JOIN subcategory sc ON p.sub_category_id = sc.id
//       LEFT JOIN brands b ON p.brand_id = b.id

//       ${whereClause}
//     `;
//     const [countResult] = await pool.query(countQuery, params);
//     const total = countResult[0].total;

//     // Fetch data with related info and variation aggregates
//     const dataQuery = `
//       SELECT
//         p.*,
//         c.name as category_name,
//         sc.name as subcategory_name,
//         b.name as brand_name,
//         (SELECT MIN(price) FROM product_items WHERE product_id = p.id AND is_available = TRUE) as min_price,
//         (SELECT MAX(price) FROM product_items WHERE product_id = p.id AND is_available = TRUE) as max_price,
//         EXISTS (SELECT 1 FROM product_items WHERE product_id = p.id AND available_stock > 0) as in_stock,
//         (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY sort_order LIMIT 1) as primary_image
//       FROM products p
//       LEFT JOIN categories c ON p.category_id = c.id
//       LEFT JOIN subcategory sc ON p.sub_category_id = sc.id
//       LEFT JOIN brands b ON p.brand_id = b.id
//       ${whereClause}
//       ORDER BY p.created_at DESC
//       LIMIT ? OFFSET ?
//     `;
//     const dataParams = [...params, limit, offset];
//     const [rows] = await pool.query(dataQuery, dataParams);

//     res.json({
//       success: true,
//       data: rows,
//       pagination: {
//         page,
//         limit,
//         total,
//         totalPages: Math.ceil(total / limit),
//       },
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };

export const getAllProducts = async (req, res) => {
  try {
    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Filters
    const status = req.query.status;
    const category_id = req.query.category_id;
    const sub_category_id = req.query.sub_category_id;
    const brand_id = req.query.brand_id;
    const search = req.query.search;

    let whereConditions = [];
    let params = [];

    // Product status filter
    if (status && ["active", "inactive"].includes(status)) {
      whereConditions.push("p.status = ?");
      params.push(status);
    } else {
      whereConditions.push("p.status = 'active'");
    }

    // Category must be active
    whereConditions.push("c.status = 'active'");

    // Subcategory: if exists, must be active; if null, allow it
    whereConditions.push("(sc.id IS NULL OR sc.status = 'active')");

    // ✅ FIX: Brand: if exists, must be active; if null, allow it
    whereConditions.push("(b.id IS NULL OR b.status = 'active')");

    // Optional filters
    if (category_id) {
      whereConditions.push("p.category_id = ?");
      params.push(category_id);
    }
    if (sub_category_id) {
      whereConditions.push("p.sub_category_id = ?");
      params.push(sub_category_id);
    }
    if (brand_id) {
      whereConditions.push("p.brand_id = ?");
      params.push(brand_id);
    }
    if (search) {
      whereConditions.push("(p.name LIKE ? OR p.slug LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

    // Count total
    const countQuery = `
      SELECT COUNT(*) as total
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN subcategory sc ON p.sub_category_id = sc.id
      LEFT JOIN brands b ON p.brand_id = b.id  -- ✅ Consistent JOIN
      ${whereClause}
    `;
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    // Fetch data
    const dataQuery = `
      SELECT 
        p.*,
        c.name as category_name,
        sc.name as subcategory_name,
        b.name as brand_name,
        (SELECT MIN(price) FROM product_items WHERE product_id = p.id AND is_available = TRUE) as min_price,
        (SELECT MAX(price) FROM product_items WHERE product_id = p.id AND is_available = TRUE) as max_price,
        EXISTS (SELECT 1 FROM product_items WHERE product_id = p.id AND available_stock > 0) as in_stock,
        (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY sort_order LIMIT 1) as primary_image
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN subcategory sc ON p.sub_category_id = sc.id
      LEFT JOIN brands b ON p.brand_id = b.id  -- ✅ Consistent JOIN
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const dataParams = [...params, limit, offset];
    const [rows] = await pool.query(dataQuery, dataParams);

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
//  GET single product by id or slug
export const getProductByIdOrSlug = async (req, res) => {
  const identifier = req.params.identifier;
  try {
    let query = `
   SELECT 
    p.*,
    b.name AS brand_name,
    c.name AS category_name,
    s.name AS subcategory_name,
    (
        SELECT image_url 
        FROM product_images 
        WHERE product_id = p.id 
        ORDER BY sort_order ASC 
        LIMIT 1
    ) AS primary_image_url
FROM products p
LEFT JOIN brands b ON p.brand_id = b.id
LEFT JOIN categories c ON p.category_id = c.id
LEFT JOIN subcategory s ON p.sub_category_id = s.id
WHERE p.id = ? OR p.slug = ?;
    
    
    `;
    const [rows] = await pool.query(query, [identifier, identifier]);
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

//  CREATE product
export const createProduct = async (req, res) => {
  const {
    category_id,
    sub_category_id,
    brand_id,
    name,
    short_description,
    long_description,
    seo_title,
    seo_description,
    seo_keywords,
    status,
  } = req.body;

  // Validation
  if (!category_id || !sub_category_id || !brand_id || !name) {
    return res.status(400).json({
      success: false,
      message:
        "Missing required fields (category_id, sub_category_id, brand_id, name)",
    });
  }

  try {
    // Verify foreign keys exist
    const [cat] = await pool.query("SELECT id FROM categories WHERE id = ?", [
      category_id,
    ]);
    if (cat.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "Invalid category_id" });

    const [subcat] = await pool.query(
      "SELECT id FROM subcategory WHERE id = ?",
      [sub_category_id],
    );
    if (subcat.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "Invalid sub_category_id" });

    const [brand] = await pool.query("SELECT id FROM brands WHERE id = ?", [
      brand_id,
    ]);
    if (brand.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "Invalid brand_id" });

    // Generate unique slug
    let slug = generateSlug(name);
    slug = await makeSlugUnique(slug);

    const [result] = await pool.query(
      `INSERT INTO products 
            (category_id, sub_category_id, brand_id, name, slug, short_description, long_description, 
             seo_title, seo_description, seo_keywords, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        category_id,
        sub_category_id,
        brand_id,
        name,
        slug,
        short_description || null,
        long_description || null,
        seo_title || null,
        seo_description || null,
        seo_keywords || null,
        status || "active",
      ],
    );

    const [newProduct] = await pool.query(
      "SELECT * FROM products WHERE id = ?",
      [result.insertId],
    );
    res.status(201).json({ success: true, data: newProduct[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Database error" });
  }
};

//  UPDATE product
export const updateProduct = async (req, res) => {
  const { id } = req.params;
  const {
    category_id,
    sub_category_id,
    brand_id,
    name,
    short_description,
    long_description,
    seo_title,
    seo_description,
    seo_keywords,
    status,
  } = req.body;

  try {
    const [existing] = await pool.query(
      "SELECT id, slug FROM products WHERE id = ?",
      [id],
    );
    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    // Validate foreign keys if provided
    if (category_id) {
      const [cat] = await pool.query("SELECT id FROM categories WHERE id = ?", [
        category_id,
      ]);
      if (cat.length === 0)
        return res
          .status(400)
          .json({ success: false, message: "Invalid category_id" });
    }
    if (sub_category_id) {
      const [subcat] = await pool.query(
        "SELECT id FROM subcategory WHERE id = ?",
        [sub_category_id],
      );
      if (subcat.length === 0)
        return res
          .status(400)
          .json({ success: false, message: "Invalid sub_category_id" });
    }
    if (brand_id) {
      const [brand] = await pool.query("SELECT id FROM brands WHERE id = ?", [
        brand_id,
      ]);
      if (brand.length === 0)
        return res
          .status(400)
          .json({ success: false, message: "Invalid brand_id" });
    }

    let slug = existing[0].slug;
    if (name && name !== existing[0].name) {
      let newSlug = generateSlug(name);
      newSlug = await makeSlugUnique(newSlug, id);
      slug = newSlug;
    }

    await pool.query(
      `UPDATE products SET
                category_id = COALESCE(?, category_id),
                sub_category_id = COALESCE(?, sub_category_id),
                brand_id = COALESCE(?, brand_id),
                name = COALESCE(?, name),
                slug = ?,
                short_description = COALESCE(?, short_description),
                long_description = COALESCE(?, long_description),
                seo_title = COALESCE(?, seo_title),
                seo_description = COALESCE(?, seo_description),
                seo_keywords = COALESCE(?, seo_keywords),
                status = COALESCE(?, status)
            WHERE id = ?`,
      [
        category_id,
        sub_category_id,
        brand_id,
        name,
        slug,
        short_description,
        long_description,
        seo_title,
        seo_description,
        seo_keywords,
        status,
        id,
      ],
    );

    const [updated] = await pool.query("SELECT * FROM products WHERE id = ?", [
      id,
    ]);
    res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Update error" });
  }
};

//  DELETE product
export const deleteProduct = async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await pool.query("DELETE FROM products WHERE id = ?", [
      id,
    ]);
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }
    res.json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

//  Toggle product status
export const toggleProductStatus = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      "SELECT status FROM products WHERE id = ?",
      [id],
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }
    const newStatus = rows[0].status === "active" ? "inactive" : "active";
    await pool.query("UPDATE products SET status = ? WHERE id = ?", [
      newStatus,
      id,
    ]);
    const [updated] = await pool.query("SELECT * FROM products WHERE id = ?", [
      id,
    ]);
    res.json({
      success: true,
      message: `Product status toggled to ${newStatus}`,
      data: updated[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
