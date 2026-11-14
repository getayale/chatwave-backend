import {randomUUID} from "node:crypto";
import multer from "multer";
import path from "node:path";
const storage=multer.diskStorage({

    destination:(req,file,cb)=>{
   cb(null,"uploads/profile-photos");
    },
  
  filename: (req, file, cb) => {
  const extension = path.extname(file.originalname).toLowerCase();
  const filename = `${randomUUID()}${extension}`;

  cb(null, filename);
},

});


const fileFilter=(req:Express.Request,file:Express.Multer.File,cb:multer.FileFilterCallback)=>{
    const allowedTypes=[
   "image/jpeg",
   "image/png",
   "image/webp"
    ];

    if(allowedTypes.includes(file.mimetype)){
        cb(null,true);
    }
    else{
        cb(new Error("Only JPEG, PNG, and WebP images are allowed."));
    }
};







export const upload=multer({storage,fileFilter,limits:{fileSize:5*1024*1024,},});