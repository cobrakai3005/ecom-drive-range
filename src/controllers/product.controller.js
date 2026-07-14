// controllers/productController.js
import pool from "../config/db.js";
import cloudinary from "../config/cloudinary.js";
import { deleteImage } from "../utils/deleteImages.js";
import fs from "fs/promises";
import path from "path";
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

// export const getAllProducts = async (req, res) => {
//   try {
//     const {
//       page = 1,
//       limit = 10,
//       search = "",
//       category_id,
//       sub_category_id,
//       brand_id,
//       status = "active",
//       is_featured,
//       is_front,
//       sort_by = "latest",
//     } = req.query;

//     const currentPage = Math.max(1, Number(page) || 1);
//     const currentLimit = Math.min(100, Math.max(1, Number(limit) || 10));
//     const offset = (currentPage - 1) * currentLimit;

//     // Adjust according to the role stored in your JWT
//     const isAdmin = ["Admin", "Staff"].includes(req.user?.role);

//     const whereClauses = [];
//     const params = [];

//     if (search.trim()) {
//       whereClauses.push("(p.name LIKE ? OR p.sku LIKE ?)");
//       params.push(`%${search.trim()}%`, `%${search.trim()}%`);
//     }

//     if (category_id) {
//       whereClauses.push("p.category_id = ?");
//       params.push(category_id);
//     }

//     if (sub_category_id) {
//       whereClauses.push("p.sub_category_id = ?");
//       params.push(sub_category_id);
//     }

//     if (brand_id) {
//       whereClauses.push("p.brand_id = ?");
//       params.push(brand_id);
//     }

//     if (status === "deleted") {
//       whereClauses.push("p.status = 'inactive'");
//       whereClauses.push("p.is_available = 0");
//     } else if (status) {
//       whereClauses.push("p.status = ?");
//       params.push(status);
//     }

//     if (is_featured !== undefined) {
//       whereClauses.push("p.is_featured = ?");
//       params.push(Number(is_featured));
//     }

//     if (is_front !== undefined) {
//       whereClauses.push("p.is_front = ?");
//       params.push(Number(is_front));
//     }

//     /*
//      * Customer panel:
//      * Hide products when their category, subcategory, or brand
//      * is deleted/inactive.
//      *
//      * Admin panel:
//      * Do not hide them. Return deletion flags instead.
//      */
//     if (!isAdmin) {
//       whereClauses.push("p.is_available = 1");

//       whereClauses.push("c.is_deleted = 0");

//       whereClauses.push("c.status = 'active'");

//       whereClauses.push("sc.is_deleted = 0");
//       whereClauses.push("sc.status = 'active'");

//       whereClauses.push("(br.is_deleted = 0 OR br.id IS NULL)");
//       whereClauses.push("(br.status = 'active' OR br.id IS NULL)");
//     }

//     const whereSQL = whereClauses.length
//       ? `WHERE ${whereClauses.join(" AND ")}`
//       : "";

//     const sortOptions = {
//       latest: "p.product_created_at DESC",
//       oldest: "p.product_created_at ASC",
//       price_low_high: "p.price ASC",
//       price_high_low: "p.price DESC",
//       name_az: "p.name ASC",
//       name_za: "p.name DESC",
//       stock_low_high: "p.available_stock ASC",
//       stock_high_low: "p.available_stock DESC",
//       featured: "p.is_featured DESC, p.product_created_at DESC",
//     };

//     const orderBy = sortOptions[sort_by] || sortOptions.latest;

//     const baseJoinSQL = `
//       FROM product p

//       LEFT JOIN categories c
//         ON p.category_id = c.id

//       LEFT JOIN subcategory sc
//         ON p.sub_category_id = sc.id

//       LEFT JOIN brands br
//         ON p.brand_id = br.id
//     `;

//     // Count must use the same JOINs and conditions as the product query
//     const [countResult] = await pool.query(
//       `
//         SELECT COUNT(DISTINCT p.id) AS total
//         ${baseJoinSQL}
//         ${whereSQL}
//       `,
//       params,
//     );

//     const total = countResult[0].total;

//     const [products] = await pool.query(
//       `
//         SELECT
//           p.*,

//           c.name AS category_name,
//           c.status AS category_status,
//           COALESCE(c.is_deleted, 1) AS category_is_deleted,

//           sc.name AS subcategory_name,
//           sc.status AS subcategory_status,
//           COALESCE(sc.is_deleted, 1) AS subcategory_is_deleted,

//           br.name AS brand_name,
//           br.status AS brand_status,
//           CASE
//             WHEN br.id IS NULL THEN 0
//             ELSE COALESCE(br.is_deleted, 1)
//           END AS brand_is_deleted,

//           CASE
//             WHEN c.id IS NULL THEN
//               'Category no longer exists'
//             WHEN c.is_deleted = 1 THEN
//               'Product is not deleted, but its category is deleted'
//             WHEN c.status = 'inactive' THEN
//               'Product is not deleted, but its category is inactive'
//             WHEN sc.id IS NULL THEN
//               'Subcategory no longer exists'
//             WHEN sc.is_deleted = 1 THEN
//               'Product is not deleted, but its subcategory is deleted'
//             WHEN sc.status = 'inactive' THEN
//               'Product is not deleted, but its subcategory is inactive'
//             WHEN br.id IS NOT NULL AND br.is_deleted = 1 THEN
//               'Product is not deleted, but its brand is deleted'
//             WHEN br.id IS NOT NULL AND br.status = 'inactive' THEN
//               'Product is not deleted, but its brand is inactive'
//             ELSE NULL
//           END AS relation_warning

//         ${baseJoinSQL}
//         ${whereSQL}

//         ORDER BY ${orderBy}
//         LIMIT ?
//         OFFSET ?
//       `,
//       [...params, currentLimit, offset],
//     );

//     await Promise.all(
//       products.map(async (product) => {
//         product.media = await getProductMedia(product.id);
//       }),
//     );

//     return res.status(200).json({
//       success: true,
//       data: products,
//       pagination: {
//         total,
//         page: currentPage,
//         limit: currentLimit,
//         totalPages: Math.ceil(total / currentLimit),
//       },
//     });
//   } catch (error) {
//     console.error("Error in getAllProducts:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Internal server error",
//     });
//   }
// };

export const getAllProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      category_id,
      sub_category_id,
      brand_id,
      status = "active",
      is_featured,
      is_front,
      sort_by = "latest",
    } = req.query;

    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const currentLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const offset = (currentPage - 1) * currentLimit;

    const isAdmin = ["Admin", "Staff"].includes(req.user?.role);

    const whereClauses = [];
    const params = [];

    // Converts true/false and 1/0 query strings into MySQL Boolean values.
    const parseBooleanQuery = (value) => {
      if (value === undefined || value === null || value === "") {
        return undefined;
      }

      const normalizedValue = String(value).trim().toLowerCase();

      if (["true", "1"].includes(normalizedValue)) {
        return 1;
      }

      if (["false", "0"].includes(normalizedValue)) {
        return 0;
      }

      return null;
    };

    /*
     * Search
     */
    if (String(search).trim()) {
      const searchValue = String(search).trim();

      whereClauses.push("(p.name LIKE ? OR p.sku LIKE ?)");
      params.push(`%${searchValue}%`, `%${searchValue}%`);
    }

    /*
     * Category filter
     */
    if (category_id) {
      whereClauses.push("p.category_id = ?");
      params.push(category_id);
    }

    /*
     * Subcategory filter
     */
    if (sub_category_id) {
      whereClauses.push("p.sub_category_id = ?");
      params.push(sub_category_id);
    }

    /*
     * Brand filter
     */
    if (brand_id) {
      whereClauses.push("p.brand_id = ?");
      params.push(brand_id);
    }

    /*
     * Product status filter
     */
    if (status === "deleted") {
      whereClauses.push("p.status = 'inactive'");
      whereClauses.push("p.is_available = 0");
    } else if (status) {
      if (!["active", "inactive"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "status must be active, inactive, or deleted",
        });
      }

      whereClauses.push("p.status = ?");
      params.push(status);
    }

    /*
     * Featured filter
     *
     * Supported:
     * ?is_featured=true
     * ?is_featured=false
     * ?is_featured=1
     * ?is_featured=0
     */
    const featuredValue = parseBooleanQuery(is_featured);

    if (featuredValue === null) {
      return res.status(400).json({
        success: false,
        message: "is_featured must be true, false, 1, or 0",
      });
    }

    if (featuredValue !== undefined) {
      whereClauses.push("p.is_featured = ?");
      params.push(featuredValue);
    }

    /*
     * Front-page filter
     *
     * Supported:
     * ?is_front=true
     * ?is_front=false
     * ?is_front=1
     * ?is_front=0
     */
    const frontValue = parseBooleanQuery(is_front);

    if (frontValue === null) {
      return res.status(400).json({
        success: false,
        message: "is_front must be true, false, 1, or 0",
      });
    }

    if (frontValue !== undefined) {
      whereClauses.push("p.is_front = ?");
      params.push(frontValue);
    }

    /*
     * Customer restrictions:
     * Hide unavailable products and products whose related
     * category, subcategory, or brand is deleted/inactive.
     *
     * Admin and Staff can see these products with warning fields.
     */
    if (!isAdmin) {
      whereClauses.push("p.is_available = 1");

      whereClauses.push("c.id IS NOT NULL");
      whereClauses.push("c.is_deleted = 0");
      whereClauses.push("c.status = 'active'");

      whereClauses.push("sc.id IS NOT NULL");
      whereClauses.push("sc.is_deleted = 0");
      whereClauses.push("sc.status = 'active'");

      whereClauses.push(
        "(br.id IS NULL OR (br.is_deleted = 0 AND br.status = 'active'))",
      );
    }

    const whereSQL =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    /*
     * Sorting
     */
    const sortOptions = {
      latest: "p.product_created_at DESC",
      oldest: "p.product_created_at ASC",
      price_low_high: "p.price ASC",
      price_high_low: "p.price DESC",
      name_az: "p.name ASC",
      name_za: "p.name DESC",
      stock_low_high: "p.available_stock ASC",
      stock_high_low: "p.available_stock DESC",
      featured: `
        p.is_featured DESC,
        p.product_created_at DESC
      `,
      front: `
        p.is_front DESC,
        p.product_created_at DESC
      `,
    };

    const orderBy = sortOptions[sort_by] || sortOptions.latest;

    /*
     * Make sure your actual table is named `subcategory`.
     * Change it to `subcategories` here if that is the real table name.
     */
    const baseJoinSQL = `
      FROM product p

      LEFT JOIN categories c
        ON p.category_id = c.id

      LEFT JOIN subcategory sc
        ON p.sub_category_id = sc.id

      LEFT JOIN brands br
        ON p.brand_id = br.id
    `;

    /*
     * Count query
     */
    const [countResult] = await pool.query(
      `
        SELECT COUNT(DISTINCT p.id) AS total
        ${baseJoinSQL}
        ${whereSQL}
      `,
      params,
    );

    const total = Number(countResult[0]?.total || 0);

    /*
     * Products query
     */
    const [products] = await pool.query(
      `
        SELECT
          p.*,

          c.name AS category_name,
          c.status AS category_status,
          COALESCE(c.is_deleted, 1) AS category_is_deleted,

          sc.name AS subcategory_name,
          sc.status AS subcategory_status,
          COALESCE(sc.is_deleted, 1) AS subcategory_is_deleted,

          br.name AS brand_name,
          br.status AS brand_status,

          CASE
            WHEN br.id IS NULL THEN 0
            ELSE COALESCE(br.is_deleted, 1)
          END AS brand_is_deleted,

          CASE
            WHEN c.id IS NULL THEN
              'Category no longer exists'

            WHEN c.is_deleted = 1 THEN
              'Product is not deleted, but its category is deleted'

            WHEN c.status = 'inactive' THEN
              'Product is not deleted, but its category is inactive'

            WHEN sc.id IS NULL THEN
              'Subcategory no longer exists'

            WHEN sc.is_deleted = 1 THEN
              'Product is not deleted, but its subcategory is deleted'

            WHEN sc.status = 'inactive' THEN
              'Product is not deleted, but its subcategory is inactive'

            WHEN br.id IS NOT NULL AND br.is_deleted = 1 THEN
              'Product is not deleted, but its brand is deleted'

            WHEN br.id IS NOT NULL AND br.status = 'inactive' THEN
              'Product is not deleted, but its brand is inactive'

            ELSE NULL
          END AS relation_warning

        ${baseJoinSQL}
        ${whereSQL}

        ORDER BY ${orderBy}
        LIMIT ?
        OFFSET ?
      `,
      [...params, currentLimit, offset],
    );

    /*
     * Load media for every product
     */
    await Promise.all(
      products.map(async (product) => {
        product.media = await getProductMedia(product.id);

        // Return actual Boolean values in the JSON response.
        product.is_available = Boolean(product.is_available);
        product.is_featured = Boolean(product.is_featured);
        product.is_front = Boolean(product.is_front);

        product.category_is_deleted = Boolean(product.category_is_deleted);
        product.subcategory_is_deleted = Boolean(
          product.subcategory_is_deleted,
        );
        product.brand_is_deleted = Boolean(product.brand_is_deleted);
      }),
    );

    return res.status(200).json({
      success: true,
      data: products,
      pagination: {
        total,
        page: currentPage,
        limit: currentLimit,
        totalPages: Math.ceil(total / currentLimit),
        hasNextPage: currentPage * currentLimit < total,
        hasPreviousPage: currentPage > 1,
      },
    });
  } catch (error) {
    console.error("Error in getAllProducts:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// GET /api/products/:identifier (id or slug)
export const getProductByIdOrSlug = async (req, res) => {
  try {
    const { identifier } = req.params;
    const isNumeric = !isNaN(identifier);

    const field = isNumeric ? "p.id" : "p.slug";
    const [rows] = await pool.query(
      `SELECT p.* , br.name  brand_name
       FROM product p
       INNER JOIN categories c
       ON p.category_id = c.id

       INNER JOIN subcategory sc
       ON p.sub_category_id = sc.id

       LEFT JOIN brands br ON p.brand_id = br.id
       WHERE ${field} = ?
       
        AND c.is_deleted = 0
        AND c.status = 'active'
        AND sc.is_deleted = 0
        AND (br.is_deleted = 0 OR br.id IS NULL)
        AND sc.status = 'active'
        AND (br.status = 'active' OR br.id IS NULL)
        AND p.is_available = 1
       `,
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
      is_universal,
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
    status, product_created_at, product_updated_at,warranty_months,tax_percentage,is_universal
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?)`,
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
        is_universal !== undefined ? is_universal : 0,
      ],
    );

    const productId = result.insertId;

    // ---------- HANDLE MEDIA (skip empty files) ----------
    // const product_media = req.files?.map((el) => [
    //   productId,
    //   el.path,
    //   el.filename,
    //   0,
    //   "active",
    // ]);
    const product_media = req.files?.map((file) => [
      productId,
      `${req.protocol}://${req.get("host")}/uploads/products/${file.filename}`,

      0,
      "active",
    ]);

    // Insert media

    if (product_media.length > 0) {
      await connection.query(
        `INSERT INTO product_media
    (product_id, image_url, sort_order, status)
    VALUES ?`,
        [product_media],
      );
    }

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
      is_universal,
    } = req.body;
    const warranty_months =
      req.body.warranty_months === 0 ? null : req.body.warranty_months;
    // Check existence
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
        tax_percentage = ?,
        is_universal = ?
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
        is_universal !== undefined ? is_universal : 0,
        id,
      ],
    );
    // Add Images If Sent
    // let product_media;

    // if (req.files && req.files.length > 0) {
    //   product_media = req.files?.map((file) => [
    //     productId,
    //     `${req.protocol}://${req.get("host")}/uploads/products/${file.filename}`,
    //     file.filename,
    //     0,
    //     "active",
    //   ]);
    //   // Insert media

    //   await connection.query(
    //     `INSERT INTO product_media (product_id, image_url, image_url_id, sort_order, status) VALUES ?`,
    //     [product_media],
    //   );
    // }

    // Add Images If Sent
    if (req.files && req.files.length > 0) {
      // Get existing images
      const [existingImages] = await connection.query(
        `SELECT image_url
     FROM product_media
     WHERE product_id = ?`,
        [productId],
      );

      // Delete files from disk
      for (const image of existingImages) {
        const filePath = path.join(
          process.cwd(),
          "uploads",
          "products",
          image.image_url,
        );

        try {
          await fs.unlink(filePath);
        } catch (err) {
          // Ignore if file doesn't exist
          if (err.code !== "ENOENT") {
            console.error("Failed to delete image:", err);
          }
        }
      }

      // Delete old DB records
      await connection.query(`DELETE FROM product_media WHERE product_id = ?`, [
        productId,
      ]);

      // Prepare new images
      const product_media = req.files.map((file) => [
        productId,
        `${req.protocol}://${req.get("host")}/uploads/products/${file.filename}`,
        file.filename,
        0,
        "active",
      ]);

      // Insert new records
      await connection.query(
        `INSERT INTO product_media
      (product_id, image_url, image_url_id, sort_order, status)
     VALUES ?`,
        [product_media],
      );
    }

    // ---------- UPDATE VEHICLE COMPATIBILITY ----------

    // if (
    //   Array.isArray(vehicle_generation_ids) &&
    //   vehicle_generation_ids.length > 0
    // ) {
    //   const uniqueIds = [...new Set(vehicle_generation_ids.map(Number))];

    //   const placeholders = uniqueIds.map(() => "?").join(",");

    //   const [generations] = await connection.query(
    //     `SELECT id
    //  FROM vehicle_generations
    //  WHERE id IN (${placeholders})`,
    //     uniqueIds,
    //   );

    //   if (generations.length !== uniqueIds.length) {
    //     const foundIds = generations.map((g) => Number(g.id));

    //     const invalidIds = uniqueIds.filter((id) => !foundIds.includes(id));

    //     await connection.rollback();

    //     return res.status(400).json({
    //       success: false,
    //       message: `Invalid vehicle generation IDs: ${invalidIds.join(", ")}`,
    //     });
    //   }

    //   const [existingRows] = await connection.query(
    //     `SELECT vehicle_generation_id
    //  FROM product_vehicle_compatibility
    //  WHERE product_id = ?
    //  AND vehicle_generation_id IN (${placeholders})`,
    //     [productId, ...uniqueIds],
    //   );

    //   const existingIds = existingRows.map((row) =>
    //     Number(row.vehicle_generation_id),
    //   );

    //   const newIds = uniqueIds.filter((id) => !existingIds.includes(id));

    //   if (newIds.length > 0) {
    //     const compatibilityValues = newIds.map((generationId) => [
    //       productId,
    //       generationId,
    //       null,
    //     ]);

    //     await connection.query(
    //       `INSERT INTO product_vehicle_compatibility
    //    (product_id, vehicle_generation_id, compatibility_notes)
    //    VALUES ?`,
    //       [compatibilityValues],
    //     );
    //   }
    // }

    // Replace existing vehicle compatibility with new compatibility
    if (Array.isArray(vehicle_generation_ids)) {
      const uniqueIds = [
        ...new Set(
          vehicle_generation_ids
            .map(Number)
            .filter((id) => Number.isInteger(id) && id > 0),
        ),
      ];

      // Validate selected generation IDs
      if (uniqueIds.length > 0) {
        const placeholders = uniqueIds.map(() => "?").join(",");

        const [generations] = await connection.query(
          `SELECT id
       FROM vehicle_generations
       WHERE id IN (${placeholders})`,
          uniqueIds,
        );

        if (generations.length !== uniqueIds.length) {
          const foundIds = generations.map((generation) =>
            Number(generation.id),
          );

          const invalidIds = uniqueIds.filter((id) => !foundIds.includes(id));

          await connection.rollback();

          return res.status(400).json({
            success: false,
            message: `Invalid vehicle generation IDs: ${invalidIds.join(", ")}`,
          });
        }
      }

      // Delete all existing compatibility for this product
      await connection.query(
        `DELETE FROM product_vehicle_compatibility
     WHERE product_id = ?`,
        [productId],
      );

      // Insert newly selected compatibility
      if (uniqueIds.length > 0) {
        const compatibilityValues = uniqueIds.map((generationId) => [
          productId,
          generationId,
          null,
        ]);

        await connection.query(
          `INSERT INTO product_vehicle_compatibility
       (
         product_id,
         vehicle_generation_id,
         compatibility_notes
       )
       VALUES ?`,
          [compatibilityValues],
        );
      }
    }

    await connection.commit();

    // Fetch updated product
    const [productRows] = await connection.query(
      "SELECT * FROM product WHERE id = ?",
      [id],
    );

    const [compatibility] = await connection.query(
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

// export const deleteProduct = async (req, res) => {
//   const connection = await pool.getConnection();
//   try {
//     await connection.beginTransaction();

//     const { id } = req.params;

//     // Check if exists
//     const [existing] = await connection.query(
//       "SELECT * FROM product WHERE id = ?",
//       [id],
//     );
//     if (existing.length === 0) {
//       await connection.rollback();
//       return res
//         .status(404)
//         .json({ success: false, message: "Product not found" });
//     }

//     // Get media to delete from Cloudinary (if you have a function)
//     const [mediaRows] = await connection.query(
//       "SELECT image_url FROM product_media WHERE product_id = ? AND image_url IS NOT NULL",
//       [id],
//     );

//     // (Optional) Delete images from Cloudinary using image_url_id
//     // You would call a Cloudinary destroy function here.

//     // Inside deleteProduct after fetching mediaRows
//     for (const row of mediaRows) {
//       if (row.image_url) {
//         try {
//           // await cloudinary.uploader.destroy(row.image_url_id);
//           await deleteImage(row.image_url);
//         } catch (err) {
//           console.error(
//             `Failed to delete Cloudinary image ${row.image_url_id}:`,
//             err,
//           );
//         }
//       }
//     }

//     // Delete media (cascaded by FK, but we do it explicitly if needed)
//     await connection.query("DELETE FROM product_media WHERE product_id = ?", [
//       id,
//     ]);
//     // Delete product
//     await connection.query("DELETE FROM product WHERE id = ?", [id]);

//     await connection.commit();

//     res.status(200).json({
//       success: true,
//       message: "Product deleted successfully",
//       deletedCloudinaryIds: mediaRows
//         .map((row) => row.image_url_id)
//         .filter(Boolean),
//     });
//   } catch (error) {
//     await connection.rollback();
//     console.error("Error in deleteProduct:", error);
//     res.status(500).json({ success: false, message: "Internal server error" });
//   } finally {
//     connection.release();
//   }
// };

export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if product exists
    const [existing] = await pool.query(
      "SELECT id, status, is_available FROM product WHERE id = ?",
      [id],
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Soft delete (deactivate product)
    await pool.query(
      `
      UPDATE product
      SET
        status = 'inactive',
        is_available = 0
      WHERE id = ?
      `,
      [id],
    );

    return res.status(200).json({
      success: true,
      message: "Product has been deactivated successfully",
    });
  } catch (error) {
    console.error("Error in deleteProduct:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const restoreProduct = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if product exists
    const [existing] = await pool.query(
      "SELECT id, status, is_available FROM product WHERE id = ?",
      [id],
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Restore product
    await pool.query(
      `
      UPDATE product
      SET
        status = 'active',
        is_available = 1
      WHERE id = ?
      `,
      [id],
    );

    return res.status(200).json({
      success: true,
      message: "Product restored successfully",
    });
  } catch (error) {
    console.error("Error in restoreProduct:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
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

    // Fetch media for each product
    for (let product of dataRows) {
      product.media = await getProductMedia(product.id);
    }

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
