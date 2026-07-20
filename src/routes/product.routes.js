import express from "express";
import {
  createProduct,
  deleteProduct,
  getAllProducts,
  getProductByIdOrSlug,
  toggleProductStatus,
  getVehicleProducts,
  updateProduct,
  restoreProduct,
} from "../controllers/product.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import createUpload from "../middlewares/multer.middleware.js";

const upload = createUpload("products");
const router = express.Router();

router.get("/get_all_products", getAllProducts);
router.get("/get_all_vehicle_products", getVehicleProducts);
router.get("/get_product_by_id/:identifier", getProductByIdOrSlug);
router.post(
  "/create_product",
  verifyToken,
  authorize("Admin"),
  (req, res, next) => {
    upload.array("product_media", 8)(req, res, (err) => {
      if (err) {
        // Multer error (file size, type, etc.)
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  createProduct,
);
router.put(
  "/update_product/:id",
  verifyToken,
  authorize("Admin"),
  (req, res, next) => {
    upload.array("product_media")(req, res, (err) => {
      if (err) {
        // Multer error (file size, type, etc.)
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  updateProduct,
);
router.delete(
  "/delete_product/:id",
  verifyToken,
  authorize("Admin"),
  deleteProduct,
);
router.patch(
  "/toggle_status/:id",
  verifyToken,
  authorize("Admin"),
  toggleProductStatus,
);
router.get("/restore/:id", verifyToken, authorize("Admin"), restoreProduct);
// Product images

import {
  getProductImages,
  addProductImage,
  deleteProductImage,
  reorderProductImages,
  toggleImageStatus,
  addProductImages,
  hardDeleteProductImage,
} from "../controllers/product_images.controller.js";

router.get("/:productId/images", getProductImages);
// router.post(
//   "/:productId/images",
//   verifyToken,
//   authorize("Admin", "Staff"),
//   upload.single("product_images"),
//   addProductImage,
// );
router.post(
  "/:productId/images",
  verifyToken,
  authorize("Admin", "Staff"),
  (req, res, next) => {
    upload.array("product_images")(req, res, (err) => {
      if (err) {
        // Multer error (file size, type, etc.)
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  addProductImages, // renamed for clarity (optional)
);
router.delete(
  "/images/:imageId",
  verifyToken,
  authorize("Admin", "Staff"),
  hardDeleteProductImage,
);
router.patch(
  "/:productId/images/reorder",
  verifyToken,
  authorize("Admin", "Staff"),
  reorderProductImages,
);

router.patch("/images/:imageId/toggle-status", toggleImageStatus);

//--------Products Items---------
// import {
//   getAllProductItems,
//   getProductItemById,
//   createProductItem,
//   updateProductItem,
//   deleteProductItem,
// } from "../controllers/product_items.controller.js";

// router.get("/get_all_items", getAllProductItems);
// router.get("/get_item_by_id/:id", getProductItemById);
// router.post("/create_item", verifyToken, authorize("Admin"), createProductItem);
// router.put(
//   "/update_item/:id",
//   verifyToken,
//   authorize("Admin"),
//   updateProductItem,
// );
// router.delete(
//   "/delete_item/:id",
//   verifyToken,
//   authorize("Admin"),
//   deleteProductItem,
// );

// //--------Products Attributes---------

// import {
//   getProductAttributes,
//   addProductAttribute,
//   updateProductAttribute,
//   deleteProductAttribute,
// } from "../controllers/product_attribubtes.controller.js";

// router.get("/:productId/attributes/get_all_attributes", getProductAttributes);
// router.post(
//   "/:productId/attributes/create_attibute",
//   verifyToken,
//   authorize("Admin"),
//   addProductAttribute,
// );
// router.put("/attributes/update_attribute/:attributeId", updateProductAttribute);
// router.delete(
//   "/attributes/delete_attribute/:attributeId",
//   verifyToken,
//   authorize("Admin"),
//   deleteProductAttribute,
// );

export default router;
