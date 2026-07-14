// routes/subcategoryRoutes.js
import express from "express";
const router = express.Router();
import * as subcategoryController from "../controllers/subcategory.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
// import upload from "../middlewares/multer.middleware.js";
import createUpload from "../middlewares/multer.middleware.js";

const upload = createUpload("subcategories");

router.get("/get_all_subcategories", subcategoryController.getAllSubcategories);
router.get(
  "/get_subcategory_by_id/:id",
  verifyToken,
  subcategoryController.getSubcategoryByIdOrSlug,
);
router.post(
  "/create_subcategory",
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
  subcategoryController.createSubcategory,
);
router.put(
  "/update_subcategory/:id",
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
  subcategoryController.updateSubcategory,
);

router.delete(
  "/image/:id",
  verifyToken,
  authorize("Admin"),
  subcategoryController.deleteSubcategoryImage,
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

router.get(
  "/restore/:id",
  verifyToken,
  authorize("Admin"),
  subcategoryController.restoreSubcategory,
);

export default router;
