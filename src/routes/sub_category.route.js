// routes/subcategoryRoutes.js
import express from "express";
const router = express.Router();
import * as subcategoryController from "../controllers/subcategory.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import upload from "../middlewares/multer.middleware.js";

router.get(
  "/get_all_subcategories",
  verifyToken,
  subcategoryController.getAllSubcategories,
);
router.get(
  "/get_subcategory_by_id/:id",
  verifyToken,
  subcategoryController.getSubcategoryById,
);
router.post(
  "/create_subcategory",
  verifyToken,
  authorize("Admin", "Staff"),
  upload.single("image_url"),
  subcategoryController.createSubcategory,
);
router.put(
  "/update_subcategory/:id",
  verifyToken,
  authorize("Admin", "Staff"),
  upload.single("image_url"),
  subcategoryController.updateSubcategory,
);
router.delete(
  "/delete_subcategory/:id",
  verifyToken,
  authorize("Admin", "Staff"),
  subcategoryController.deleteSubcategory,
);

router.patch(
  "/toggle_status/:id",
  verifyToken,
  authorize("Admin"),
  subcategoryController.toggleSubcategoryStatus,
);

export default router;
