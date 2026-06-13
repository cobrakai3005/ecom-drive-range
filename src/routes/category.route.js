// routes/subcategoryRoutes.js
import express from "express";
const router = express.Router();
import * as categoryController from "../controllers/category.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import upload from "../middlewares/multer.middleware.js";

router.get(
  "/get_all_categories",
  verifyToken,
  categoryController.getAllCategories,
);
router.get(
  "/get_category_by_id/:id",
  verifyToken,
  categoryController.getCategoryById,
);
router.post(
  "/create_category",
  verifyToken,
  authorize("Admin", "Staff"),
  upload.single("image_url"),
  categoryController.createCategory,
);
router.put(
  "/update_category/:id",
  verifyToken,
  authorize("Admin", "Staff"),
  upload.single("image_url"),
  categoryController.updateCategory,
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
