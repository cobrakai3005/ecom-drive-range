// routes/subcategoryRoutes.js
import express from "express";
const router = express.Router();
import * as categoryController from "../controllers/category.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import upload from "../middlewares/multer.middleware.js";

router.get(
  "/get_all_categories",

  categoryController.getAllCategories,
);
router.get(
  "/get_category_by_id/:identifier",
  verifyToken,
  categoryController.getCategoryByIdOrSlug,
);
router.post(
  "/create_category",
  verifyToken,
  authorize("Admin", "Staff"),
  (req, res, next) => {
    upload.single("image_url")(req, res, (err) => {
      if (err) {
        // Multer error (file size, type, etc.)
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  categoryController.createCategory,
);
router.put(
  "/update_category/:id",
  verifyToken,
  authorize("Admin", "Staff"),
  (req, res, next) => {
    upload.single("image_url")(req, res, (err) => {
      if (err) {
        // Multer error (file size, type, etc.)
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  categoryController.updateCategory,
);
router.delete(
  "/image/:id",
  verifyToken,
  authorize("Admin"),
  categoryController.deleteCategoryImage,
);
router.delete(
  "/delete_category/:id",
  verifyToken,
  authorize("Admin"),
  categoryController.deleteCategory,
);

router.patch(
  "/toggle_status/:id",
  verifyToken,
  authorize("Admin"),
  categoryController.toggleCategoryStatus,
);

export default router;
