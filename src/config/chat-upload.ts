
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import multer from "multer";
import path from "node:path";

const uploadDirectory = "uploads/chat-files";

mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDirectory);
  },

  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const filename = `${randomUUID()}${extension}`;

    cb(null, filename);
  },
});

const allowedTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
];

const fileFilter = (
  req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("This file type is not supported."));
  }
};

export const chatUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 5,
  },
});
