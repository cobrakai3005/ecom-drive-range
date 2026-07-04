// controllers/productController.js
import pool from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

// ------------------- HELPERS -------------------
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
      "SELECT id FROM product WHERE slug = ? AND (id != ? OR ? IS NULL)",
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

// Helper to get product media
const getProductMedia = async (productId) => {
  const [media] = await pool.query(
    "SELECT id, image_url, image_url_id, sort_order, status FROM product_media WHERE product_id = ? ORDER BY sort_order ASC",
    [productId],
  );
  return media;
};

// ------------------- CONTROLLERS -------------------

// GET /api/products
// Query params: page, limit, search, category, brand, status, is_featured, is_front
export const getAllProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      category_id,
      brand_id,
      status,
      is_featured,
      is_front,
      sort = "product_created_at DESC",
    } = req.query;

    const offset = (page - 1) * limit;
    const params = [];
    let whereClauses = [];

    if (search) {
      whereClauses.push("(name LIKE ? OR sku LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    if (category_id) {
      whereClauses.push("category_id = ?");
      params.push(category_id);
    }
    if (brand_id) {
      whereClauses.push("brand_id = ?");
      params.push(brand_id);
    }
    if (status) {
      whereClauses.push("status = ?");
      params.push(status);
    }
    if (is_featured !== undefined) {
      whereClauses.push("is_featured = ?");
      params.push(is_featured);
    }
    if (is_front !== undefined) {
      whereClauses.push("is_front = ?");
      params.push(is_front);
    }

    const whereSQL = whereClauses.length
      ? `WHERE ${whereClauses.join(" AND ")}`
      : "";

    // Count total
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM product ${whereSQL}`,
      params,
    );
    const total = countResult[0]?.total || 0;

    // Fetch products
    const [products] = await pool.query(
      `SELECT * FROM product ${whereSQL} ORDER BY ${sort} LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)],
    );

    // Fetch media for each product
    for (let product of products) {
      product.media = await getProductMedia(product.id);
    }

    res.status(200).json({
      success: true,
      data: products,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error in getAllProducts:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// GET /api/products/:identifier (id or slug)
export const getProductByIdOrSlug = async (req, res) => {
  try {
    const { identifier } = req.params;
    const isNumeric = !isNaN(identifier);

    const field = isNumeric ? "id" : "slug";
    const [rows] = await pool.query(
      `SELECT * FROM product WHERE ${field} = ?`,
      [identifier],
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    const product = rows[0];
    product.media = await getProductMedia(product.id);

    res.status(200).json({ success: true, data: product });
  } catch (error) {
    console.error("Error in getProductByIdOrSlug:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
// controllers/productController.js

// ------------------- CREATE PRODUCT -------------------
export const createProduct = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const {
      category_id,
      sub_category_id,
      brand_id = null,
      name,
      short_description,
      long_description,
      seo_title,
      seo_description,
      seo_keywords,
      sku,
      price,
      weight,
      width,
      height,
      depth,
      is_available,
      is_featured,
      is_front,
      tax_percentage,
      available_stock,
      active,

      vehicle_generation_ids = [], // 👈 add this
    } = req.body;
    const warranty_months =
      req.body.warranty_months === 0 ? null : req.body.warranty_months;
    // Validate required
    if (!category_id || !sub_category_id || !name || !sku) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message:
          "category_id, sub_category_id, brand_id, name, and sku are required",
      });
    }

    // Slug
    let slug = generateSlug(name);
    slug = await makeSlugUnique(slug);

    // Insert product
    const [result] = await connection.query(
      `INSERT INTO product (
    category_id, sub_category_id, brand_id, name, slug,
    short_description, long_description, seo_title, seo_description, seo_keywords,
    sku, price, weight, width, height, depth,
    is_available, is_featured, is_front, available_stock,
    status, product_created_at, product_updated_at,warranty_months,tax_percentage
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?)`,
      [
        category_id,
        sub_category_id,
        brand_id || null,
        name,
        slug,
        short_description || null,
        long_description || null,
        seo_title || null,
        seo_description || null,
        seo_keywords || null,
        sku,
        price || 0,
        weight || null,
        width || null,
        height || null,
        depth || null,
        is_available !== undefined ? is_available : 1,
        is_featured !== undefined ? is_featured : 1,
        is_front !== undefined ? is_front : 1,
        available_stock || 0,
        active || "active",
        warranty_months || null,
        tax_percentage || 0.0,
      ],
    );

    const productId = result.insertId;

    // ---------- HANDLE MEDIA (skip empty files) ----------
    const product_media = req.files?.map((el) => [
      productId,
      el.path,
      el.filename,
      0,
      "active",
    ]);
    // Insert media

    if (product_media.length > 0) {
      await connection.query(
        `INSERT INTO product_media
    (product_id, image_url, image_url_id, sort_order, status)
    VALUES ?`,
        [product_media],
      );
    }
    console.log(vehicle_generation_ids);

    // ---------- HANDLE VEHICLE COMPATIBILITY ----------
    if (
      Array.isArray(vehicle_generation_ids) &&
      vehicle_generation_ids.length > 0
    ) {
      const uniqueIds = [...new Set(vehicle_generation_ids)];

      // Validate all generation ids exist
      const placeholders = uniqueIds.map(() => "?").join(",");

      const [generations] = await connection.query(
        `SELECT id
     FROM vehicle_generations
     WHERE id IN (${placeholders})`,
        uniqueIds,
      );

      if (generations.length !== uniqueIds.length) {
        await connection.rollback();

        const foundIds = generations.map((g) => g.id);

        const invalidIds = uniqueIds.filter((id) => !foundIds.includes(id));

        if (invalidIds.length) {
          await connection.rollback();

          return res.status(400).json({
            success: false,
            message: `Invalid vehicle generation IDs: ${invalidIds.join(", ")}`,
          });
        }
      }

      const compatibilityValues = uniqueIds.map((generationId) => [
        productId,
        generationId,
        null,
      ]);

      await connection.query(
        `INSERT INTO product_vehicle_compatibility
      (product_id, vehicle_generation_id, compatibility_notes)
      VALUES ?`,
        [compatibilityValues],
      );
    }

    await connection.commit();
    // Fetch complete product with media
    const [productRows] = await pool.query(
      "SELECT * FROM product WHERE id = ?",
      [productId],
    );
    const product = productRows[0];
    product.media = await getProductMedia(productId);

    const [compatibility] = await pool.query(
      `SELECT
              pvc.id,
              pvc.compatibility_notes,
              vg.id AS vehicle_generation_id,
              vg.year_from,
              vg.year_to,
              vm.name AS model_name,
              mk.name AS make_name
          FROM product_vehicle_compatibility pvc
          JOIN vehicle_generations vg
              ON pvc.vehicle_generation_id = vg.id
          JOIN vehicle_models vm
              ON vg.model_id = vm.id
          JOIN vehicle_makes mk
              ON vm.make_id = mk.id
          WHERE pvc.product_id = ?
          ORDER BY mk.name, vm.name, vg.year_from`,
      [productId],
    );

    product.compatibility = compatibility;

    res.status(201).json({ success: true, data: product });
  } catch (error) {
    await connection.rollback();
    console.error("Error in createProduct:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  } finally {
    connection.release();
  }
};

// ------------------- UPDATE PRODUCT -------------------
export const updateProduct = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

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
      sku,
      price,
      weight,
      width,
      height,
      depth,
      is_available,
      is_featured,
      is_front,
      available_stock,
      status,
      vehicle_generation_ids,
      tax_percentage,
    } = req.body;
    const warranty_months =
      req.body.warranty_months === 0 ? null : req.body.warranty_months;
    // Check existence
    console.log(req.body, "3456789");
    const [existing] = await connection.query(
      "SELECT * FROM product WHERE id = ?",
      [id],
    );

    if (existing.length === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }
    const productId = existing[0].id;
    // Generate slug only if name changed
    let slug = existing[0].slug;
    if (name && name !== existing[0].name) {
      slug = generateSlug(name);
      slug = await makeSlugUnique(slug, id);
    }

    const now = new Date();

    // ---------- CORRECTED UPDATE ----------
    await connection.query(
      `UPDATE product SET
        category_id = ?,
        sub_category_id = ?,
        brand_id = ?,
        name = ?,
        slug = ?,
        short_description = ?,
        long_description = ?,
        seo_title = ?,
        seo_description = ?,
        seo_keywords = ?,
        sku = ?,
        price = ?,
        weight = ?,
        width = ?,
        height = ?,
        depth = ?,
        is_available = ?,
        is_featured = ?,
        is_front = ?,
        available_stock = ?,
        status = ?,
        product_updated_at = ?,
        warranty_months = ?,
        tax_percentage = ?
      WHERE id = ?`,
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
        sku,
        price || 0,
        weight || null,
        width || null,
        height || null,
        depth || null,
        is_available !== undefined ? is_available : 1,
        is_featured !== undefined ? is_featured : 1,
        is_front !== undefined ? is_front : 1,
        available_stock || 0,
        status || "active",
        now, // only one timestamp
        warranty_months,
        tax_percentage || 0.0,
        id,
      ],
    );
    // Add Images If Sent
    let product_media;

    if (req.files && req.files.length > 0) {
      product_media = req.files?.map((el) => [
        productId,
        el.path,
        el.filename,
        0,
        "active",
      ]);
      // Insert media

      await connection.query(
        `INSERT INTO product_media (product_id, image_url, image_url_id, sort_order, status) VALUES ?`,
        [product_media],
      );
    }

    // ---------- UPDATE VEHICLE COMPATIBILITY ----------

    // Remove existing compatibility
    //   await connection.query(
    //     `DELETE FROM product_vehicle_compatibility
    //  WHERE product_id = ?`,
    //     [productId],
    //   );

    if (
      Array.isArray(vehicle_generation_ids) &&
      vehicle_generation_ids.length > 0
    ) {
      const uniqueIds = [...new Set(vehicle_generation_ids)];

      const placeholders = uniqueIds.map(() => "?").join(",");

      // Validate IDs
      const [generations] = await connection.query(
        `SELECT id
     FROM vehicle_generations
     WHERE id IN (${placeholders})`,
        uniqueIds,
      );

      if (generations.length !== uniqueIds.length) {
        const foundIds = generations.map((g) => g.id);

        const invalidIds = uniqueIds.filter((id) => !foundIds.includes(id));

        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: `Invalid vehicle generation IDs: ${invalidIds.join(", ")}`,
        });
      }

      const compatibilityValues = uniqueIds.map((generationId) => [
        productId,
        generationId,
        null,
      ]);

      await connection.query(
        `INSERT INTO product_vehicle_compatibility
      (product_id, vehicle_generation_id, compatibility_notes)
      VALUES ?`,
        [compatibilityValues],
      );
    }

    await connection.commit();

    // Fetch updated product
    const [productRows] = await connection.query(
      "SELECT * FROM product WHERE id = ?",
      [id],
    );

    const [compatibility] = await pool.query(
      `SELECT
      pvc.id,
      pvc.compatibility_notes,
      vg.id AS vehicle_generation_id,
      vg.year_from,
      vg.year_to,
      vm.name AS model_name,
      mk.name AS make_name
  FROM product_vehicle_compatibility pvc
  JOIN vehicle_generations vg
      ON pvc.vehicle_generation_id = vg.id
  JOIN vehicle_models vm
      ON vg.model_id = vm.id
  JOIN vehicle_makes mk
      ON vm.make_id = mk.id
  WHERE pvc.product_id = ?
  ORDER BY mk.name, vm.name, vg.year_from`,
      [productId],
    );

    const product = productRows[0];
    product.media = await getProductMedia(id);
    product.compatibility = compatibility;
    res.status(200).json({ success: true, data: product });
  } catch (error) {
    await connection.rollback();
    console.error("Error in updateProduct:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  } finally {
    connection.release();
  }
};

// ------------------- OTHER CONTROLLERS (getAll, getById, delete, toggle) -------------------
// ... keep the same as earlier

export const deleteProduct = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const { id } = req.params;

    // Check if exists
    const [existing] = await connection.query(
      "SELECT * FROM product WHERE id = ?",
      [id],
    );
    if (existing.length === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    // Get media to delete from Cloudinary (if you have a function)
    const [mediaRows] = await connection.query(
      "SELECT image_url_id FROM product_media WHERE product_id = ? AND image_url_id IS NOT NULL",
      [id],
    );

    // (Optional) Delete images from Cloudinary using image_url_id
    // You would call a Cloudinary destroy function here.

    // Inside deleteProduct after fetching mediaRows
    for (const row of mediaRows) {
      if (row.image_url_id) {
        try {
          await cloudinary.uploader.destroy(row.image_url_id);
        } catch (err) {
          console.error(
            `Failed to delete Cloudinary image ${row.image_url_id}:`,
            err,
          );
        }
      }
    }

    // Delete media (cascaded by FK, but we do it explicitly if needed)
    await connection.query("DELETE FROM product_media WHERE product_id = ?", [
      id,
    ]);
    // Delete product
    await connection.query("DELETE FROM product WHERE id = ?", [id]);

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "Product deleted successfully",
      deletedCloudinaryIds: mediaRows
        .map((row) => row.image_url_id)
        .filter(Boolean),
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error in deleteProduct:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  } finally {
    connection.release();
  }
};

// PATCH /api/products/:id/toggle-status
export const toggleProductStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await pool.query(
      "SELECT id, status FROM product WHERE id = ?",
      [id],
    );
    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    const newStatus = existing[0].status === "active" ? "inactive" : "active";

    await pool.query(
      "UPDATE product SET status = ?, product_updated_at = NOW() WHERE id = ?",
      [newStatus, id],
    );

    res.status(200).json({
      success: true,
      message: `Product status toggled to ${newStatus}`,
      status: newStatus,
    });
  } catch (error) {
    console.error("Error in toggleProductStatus:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * GET /api/products
 * Query params:
 *   - make_id (optional)
 *   - model_id (optional)
 *   - generation_id (optional)
 *   - compatibility_id (optional)
 *   - page (default 1)
 *   - per_page (default 15, max 100)
 */
export const getVehicleProducts = async (req, res, next) => {
  try {
    // 1. Parse and validate query params
    const {
      make_id,
      model_id,
      generation_id,
      compatibility_id,
      page = 1,
      per_page = 15,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const perPageNum = Math.min(100, Math.max(1, parseInt(per_page, 10) || 15));
    const offset = (pageNum - 1) * perPageNum;

    // 2. Build the base SQL with filters
    //    We'll use a single query that joins all tables and selects distinct products.
    //    We'll conditionally append WHERE clauses.
    let sql = `
      SELECT DISTINCT p.*
      FROM product p
      INNER JOIN product_vehicle_compatibility pvc ON p.id = pvc.product_id
      INNER JOIN vehicle_generations vg ON pvc.vehicle_generation_id = vg.id
      INNER JOIN vehicle_models vm ON vg.model_id = vm.id
      INNER JOIN vehicle_makes vmk ON vm.make_id = vmk.id
      WHERE p.status = 'active'
        AND vg.status = 'active'
        AND vm.status = 'active'
        AND vmk.status = 'active'
    `;

    // 3. Append filters conditionally
    const params = [];
    if (make_id) {
      sql += ` AND vmk.id = ?`;
      params.push(make_id);
    }
    if (model_id) {
      sql += ` AND vm.id = ?`;
      params.push(model_id);
    }
    if (generation_id) {
      sql += ` AND vg.id = ?`;
      params.push(generation_id);
    }
    if (compatibility_id) {
      sql += ` AND pvc.id = ?`;
      params.push(compatibility_id);
    }

    // 4. Count query (total matching products)
    const countSql = `
      SELECT COUNT(DISTINCT p.id) AS total
      FROM product p
      INNER JOIN product_vehicle_compatibility pvc ON p.id = pvc.product_id
      INNER JOIN vehicle_generations vg ON pvc.vehicle_generation_id = vg.id
      INNER JOIN vehicle_models vm ON vg.model_id = vm.id
      INNER JOIN vehicle_makes vmk ON vm.make_id = vmk.id
      WHERE p.status = 'active'
        AND vg.status = 'active'
        AND vm.status = 'active'
        AND vmk.status = 'active'
        ${make_id ? " AND vmk.id = ?" : ""}
        ${model_id ? " AND vm.id = ?" : ""}
        ${generation_id ? " AND vg.id = ?" : ""}
        ${compatibility_id ? " AND pvc.id = ?" : ""}
    `;
    // Build params for count (same as data query)
    const countParams = [];
    if (make_id) countParams.push(make_id);
    if (model_id) countParams.push(model_id);
    if (generation_id) countParams.push(generation_id);
    if (compatibility_id) countParams.push(compatibility_id);

    // 5. Execute count query
    const [countRows] = await pool.query(countSql, countParams);
    const total = countRows[0].total;

    // 6. Add pagination (ORDER BY and LIMIT/OFFSET)
    const dataSql = sql + ` ORDER BY p.id ASC LIMIT ? OFFSET ?`;
    const dataParams = [...params, perPageNum, offset];

    // 7. Execute data query
    const [dataRows] = await pool.query(dataSql, dataParams);

    // 8. Send response
    res.json({
      data: dataRows,
      pagination: {
        current_page: pageNum,
        per_page: perPageNum,
        total,
        total_pages: Math.ceil(total / perPageNum),
      },
    });
  } catch (error) {
    next(error);
  }
};
