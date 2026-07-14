// utils/deleteImage.js

import fs from "fs";
import path from "path";

export const deleteImage = (imageUrl) => {
  if (!imageUrl) return;

  try {
    // Extract: /uploads/categories/image.jpg
    const pathname = new URL(imageUrl).pathname;

    // Convert to absolute path
    const filePath = path.join(process.cwd(), pathname);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error("Error deleting image:", error.message);
  }
};