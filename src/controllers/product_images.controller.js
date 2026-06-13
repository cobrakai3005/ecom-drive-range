// controllers/productImageController.js
import { pool } from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

//  GET images for a product (sorted by sort_order)
export const getProductImages = async (req, res) => {
  const { productId } = req.params;
  try {
    const [rows] = await pool.query(
      "SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC",
      [productId],
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

//  ADD an image to a product
export const addProductImage = async (req, res) => {
  const { productId } = req.params;
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Image file is required" });
    }
    const { sort_order } = req.body;
    const image_url = req.file.path;

    const [result] = await pool.query(
      "INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)",
      [productId, image_url, sort_order || 0],
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

//  DELETE a product image
export const deleteProductImage = async (req, res) => {
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
    await pool.query("DELETE FROM product_images WHERE id = ?", [imageId]);
    res.json({ success: true, message: "Image deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

//  Update sort order (reorder images)
export const reorderProductImages = async (req, res) => {
  const { productId } = req.params;
  const { orderedIds } = req.body; // array of image ids in desired order
  if (!Array.isArray(orderedIds)) {
    return res
      .status(400)
      .json({ success: false, message: "orderedIds must be an array" });
  }
  try {
    for (let i = 0; i < orderedIds.length; i++) {
      await pool.query(
        "UPDATE product_images SET sort_order = ? WHERE id = ? AND product_id = ?",
        [i, orderedIds[i], productId],
      );
    }
    console.log("Updated");

    const [updated] = await pool.query(
      "SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC",
      [productId],
    );
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Reorder error" });
  }
};
