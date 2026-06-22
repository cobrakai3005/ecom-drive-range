// // controllers/productImageController.js
// import { pool } from "../config/db.js";
// import cloudinary from "../config/cloudinary.js";

// //  GET images for a product (sorted by sort_order)
// export const getProductImages = async (req, res) => {
//   const { productId } = req.params;
//   try {
//     const [rows] = await pool.query(
//       "SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC",
//       [productId],
//     );
//     res.json({ success: true, data: rows });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };

// //  ADD an image to a product
// export const addProductImage = async (req, res) => {
//   const { productId } = req.params;
//   try {
//     if (!req.file) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Image file is required" });
//     }
//     const { sort_order } = req.body;
//     const image_url = req.file.path;

//     const [result] = await pool.query(
//       "INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)",
//       [productId, image_url, sort_order || 0],
//     );
//     const [newImage] = await pool.query(
//       "SELECT * FROM product_images WHERE id = ?",
//       [result.insertId],
//     );
//     res.status(201).json({ success: true, data: newImage[0] });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Upload error" });
//   }
// };

// //  DELETE a product image
// export const deleteProductImage = async (req, res) => {
//   const { imageId } = req.params;
//   try {
//     const [image] = await pool.query(
//       "SELECT image_url FROM product_images WHERE id = ?",
//       [imageId],
//     );
//     if (image.length === 0) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Image not found" });
//     }
//     // Delete from Cloudinary
//     if (image[0].image_url) {
//       const publicId = image[0].image_url
//         .split("/")
//         .slice(-2)
//         .join("/")
//         .split(".")[0];
//       await cloudinary.uploader.destroy(publicId);
//     }
//     await pool.query("DELETE FROM product_images WHERE id = ?", [imageId]);
//     res.json({ success: true, message: "Image deleted successfully" });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };

// //  Update sort order (reorder images)
// export const reorderProductImages = async (req, res) => {
//   const { productId } = req.params;
//   const { orderedIds } = req.body; // array of image ids in desired order
//   if (!Array.isArray(orderedIds)) {
//     return res
//       .status(400)
//       .json({ success: false, message: "orderedIds must be an array" });
//   }
//   try {
//     for (let i = 0; i < orderedIds.length; i++) {
//       await pool.query(
//         "UPDATE product_images SET sort_order = ? WHERE id = ? AND product_id = ?",
//         [i, orderedIds[i], productId],
//       );
//     }
//     console.log("Updated");

//     const [updated] = await pool.query(
//       "SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC",
//       [productId],
//     );
//     res.json({ success: true, data: updated });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Reorder error" });
//   }
// };

// controllers/productImageController.js
import { pool } from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

// GET images for a product (sorted by sort_order, with status filtering)
export const getProductImages = async (req, res) => {
  const { productId } = req.params;
  const { status } = req.query; // Optional status filter: 'active', 'inactive', or 'all'

  try {
    let query = "SELECT * FROM product_images WHERE product_id = ?";
    const params = [productId];

    // Handle status filter
    if (status === "all") {
      // Show ALL images regardless of status - no additional WHERE clause
      // (query already has product_id filter)
    } else if (status && ["active", "inactive"].includes(status)) {
      // Show only active or only inactive
      query += " AND status = ?";
      params.push(status);
    } else {
      // Default: only show active images
      query += " AND status = 'active'";
    }

    query += " ORDER BY sort_order ASC, id ASC";

    const [rows] = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET a single image by id
export const getImageById = async (req, res) => {
  const { imageId } = req.params;

  try {
    const [rows] = await pool.query(
      "SELECT * FROM product_images WHERE id = ?",
      [imageId],
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Image not found" });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ADD an image to a product
export const addProductImage = async (req, res) => {
  const { productId } = req.params;

  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Image file is required" });
    }

    const { sort_order, status } = req.body;
    const image_url = req.file.path;

    const [result] = await pool.query(
      `INSERT INTO product_images (product_id, image_url, sort_order, status) 
       VALUES (?, ?, ?, ?)`,
      [productId, image_url, sort_order || 0, status || "active"],
    );

    const [newImage] = await pool.query(
      "SELECT * FROM product_images WHERE id = ?",
      [result.insertId],
    );

    res.status(201).json({ success: true, data: newImage[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Upload error" });
  }
};

// UPDATE a product image (status, sort_order)
export const updateProductImage = async (req, res) => {
  const { imageId } = req.params;

  try {
    const [existing] = await pool.query(
      "SELECT * FROM product_images WHERE id = ?",
      [imageId],
    );

    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Image not found" });
    }

    const { sort_order, status } = req.body;

    await pool.query(
      `UPDATE product_images 
       SET sort_order = COALESCE(?, sort_order),
           status = COALESCE(?, status)
       WHERE id = ?`,
      [sort_order, status, imageId],
    );

    const [updated] = await pool.query(
      "SELECT * FROM product_images WHERE id = ?",
      [imageId],
    );

    res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Update error" });
  }
};

// DELETE a product image (soft delete - set status to inactive)
export const deleteProductImage = async (req, res) => {
  const { imageId } = req.params;

  try {
    const [image] = await pool.query(
      "SELECT image_url, status FROM product_images WHERE id = ?",
      [imageId],
    );

    if (image.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Image not found" });
    }

    // Soft delete - just set status to inactive
    await pool.query(
      "UPDATE product_images SET status = 'inactive' WHERE id = ?",
      [imageId],
    );

    res.json({
      success: true,
      message: "Image deleted successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// HARD DELETE - Remove permanently from database and Cloudinary
export const hardDeleteProductImage = async (req, res) => {
  const { imageId } = req.params;

  try {
    const [image] = await pool.query(
      "SELECT image_url FROM product_images WHERE id = ?",
      [imageId],
    );

    if (image.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Image not found" });
    }

    // Delete from Cloudinary
    if (image[0].image_url) {
      const publicId = image[0].image_url
        .split("/")
        .slice(-2)
        .join("/")
        .split(".")[0];
      await cloudinary.uploader.destroy(publicId);
    }

    // Delete from database
    await pool.query("DELETE FROM product_images WHERE id = ?", [imageId]);

    res.json({ success: true, message: "Image permanently deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Update sort order (reorder images)
export const reorderProductImages = async (req, res) => {
  const { productId } = req.params;
  const { orderedIds } = req.body; // array of image ids in desired order

  if (!Array.isArray(orderedIds)) {
    return res
      .status(400)
      .json({ success: false, message: "orderedIds must be an array" });
  }

  try {
    // Start a transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      for (let i = 0; i < orderedIds.length; i++) {
        await connection.query(
          "UPDATE product_images SET sort_order = ? WHERE id = ? AND product_id = ?",
          [i, orderedIds[i], productId],
        );
      }

      await connection.commit();
      connection.release();
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }

    const [updated] = await pool.query(
      "SELECT * FROM product_images WHERE product_id = ? AND status = 'active' ORDER BY sort_order ASC",
      [productId],
    );

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Reorder error" });
  }
};

// Toggle image status (active ↔ inactive)
export const toggleImageStatus = async (req, res) => {
  const { imageId } = req.params;

  try {
    const [rows] = await pool.query(
      "SELECT status FROM product_images WHERE id = ?",
      [imageId],
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Image not found" });
    }

    const currentStatus = rows[0].status;
    const newStatus = currentStatus === "active" ? "inactive" : "active";

    await pool.query("UPDATE product_images SET status = ? WHERE id = ?", [
      newStatus,
      imageId,
    ]);

    const [updated] = await pool.query(
      "SELECT * FROM product_images WHERE id = ?",
      [imageId],
    );

    res.json({
      success: true,
      message: `Image status toggled to ${newStatus}`,
      data: updated[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
