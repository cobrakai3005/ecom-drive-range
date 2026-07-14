import express from "express";
import {
  deactivateUser,
  getUsers,
  getAllUsers,
  createUser,
  deleteUser,
  getUserById,
  updateUser,
  getProfile,
  updateProfile,
  changePassword,
} from "../controllers/user.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
// import upload from "../middlewares/multer.middleware.js";
const router = express.Router();
import createUpload from "../middlewares/multer.middleware.js";
const upload = createUpload("profile_images");

router.post(
  "/create-user",
  verifyToken,
  authorize("Admin"),
  (req, res, next) => {
    upload.single("profile_image")(req, res, (err) => {
      if (err) {
        // Multer error (file size, type, etc.)
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },

  createUser,
);
router.get("/get-users", verifyToken, authorize("Admin"), getAllUsers);
router.patch(
  "/deactivate-user/:id",
  verifyToken,
  authorize("Admin"),
  deactivateUser,
);

router.get(
  "/me",
  verifyToken,
  authorize("Admin", "Staff", "Customer"),
  getProfile,
);

router.post(
  "/change-password",
  verifyToken,
  authorize("Admin", "Staff", "Customer"),
  changePassword,
);

router.put(
  "/update-profile",
  verifyToken,
  authorize("Admin", "Staff", "Customer"),
  (req, res, next) => {
    upload.single("profile_image")(req, res, (err) => {
      if (err) {
        // Multer error (file size, type, etc.)
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  updateProfile,
);

router.put(
  "/:id",
  verifyToken,
  authorize("Admin", "Staff", "Customer"),
  (req, res, next) => {
    upload.single("profile_image")(req, res, (err) => {
      if (err) {
        // Multer error (file size, type, etc.)
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  updateUser,
); // optional
router.delete("/:id", deleteUser);

export default router;
