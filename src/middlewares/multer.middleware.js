import multer from "multer";
import path from "path";
import fs from "fs";

const createUpload = (folderName) => {
  const uploadDirectory = path.join(process.cwd(), "uploads", folderName);

  if (!fs.existsSync(uploadDirectory)) {
    fs.mkdirSync(uploadDirectory, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadDirectory);
    },

    filename: (req, file, cb) => {
      const extension = path.extname(file.originalname).toLowerCase();

      const uniqueName = `${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 10)}${extension}`;

      cb(null, uniqueName);
    },
  });

  return multer({
    storage,
    limits: {
      fileSize: 50 * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
      
      const allowedMimeTypes = [
        "image/jpeg",
        "image/png",
        "image/jpg",
        "image/webp",
        "image/gif",
        "image/bmp",
        "image/tiff",
        "image/svg+xml",
        "image/avif",
        "image/heic",
        "image/heif",
      ];

      const allowedExtensions = [
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".gif",
        ".bmp",
        ".tif",
        ".tiff",
        ".svg",
        ".avif",
        ".heic",
        ".heif",
      ];

      const extension = path.extname(file.originalname).toLowerCase();

      const isMimeAllowed = allowedMimeTypes.includes(file.mimetype);
      const isExtensionAllowed = allowedExtensions.includes(extension);

      if (isMimeAllowed || isExtensionAllowed) {
        return cb(null, true);
      }

      return cb(new Error("Only PNG, JPEG, and JPG images are allowed"), false);
    },
  });
};

export default createUpload;
