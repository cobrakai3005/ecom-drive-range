import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";
import multer from "multer";
import path from "path";
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const ext = file.originalname.split(".").pop();

    return {
      resource_type: "auto",
      folder: "my-app-media",
      public_id: `${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
      format: ext,
    };
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ["image/jpeg", "image/png", "image/jpg"];

    const allowedExtensions = [".jpg", ".jpeg", ".png"];

    const ext = path.extname(file.originalname).toLowerCase();

    const isMimeAllowed = allowedMimeTypes.includes(file.mimetype);
    const isExtAllowed = allowedExtensions.includes(ext);

    if (isMimeAllowed || isExtAllowed) {
      return cb(null, true);
    }

    return cb(new Error("Only images and mp4 videos allowed"));
  },
});
export default upload;
