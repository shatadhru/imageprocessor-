const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const pdf = require("pdf-poppler");
const sharp = require("sharp");
const { PDFDocument, rgb } = require("pdf-lib");

const app = express();

// ===== Multer setup (API upload) =====
const upload = multer({
  dest: "./uploads/",
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"), false);
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

// ===== A4 PDF layout =====
const A4_WIDTH = 595;
const A4_HEIGHT = 842;
const COLS = 2;
const ROWS = 4;
const IMAGE_WIDTH = A4_WIDTH / COLS;
const IMAGE_HEIGHT = (A4_HEIGHT / ROWS) * 0.9;

// ===== Image processing modes =====
const PROCESSING_MODES = {
  NEGATIVE: "negative",
  GRAYSCALE: "grayscale",
  SEPIA: "sepia",
  NORMAL: "normal",
};

// ===== Helper: clear folder =====
const clearFolder = (folder) => {
  if (fs.existsSync(folder)) {
    fs.readdirSync(folder).forEach((f) => {
      try {
        fs.unlinkSync(path.join(folder, f));
      } catch (err) {
        console.warn(`Could not delete file: ${f}`, err.message);
      }
    });
  } else {
    fs.mkdirSync(folder, { recursive: true });
  }
};

// ===== Helper: Process image based on mode =====
const processImage = async (imgPath, outputPath, mode) => {
  let sharpInstance = sharp(imgPath);

  switch (mode) {
    case PROCESSING_MODES.NEGATIVE:
      sharpInstance = sharpInstance.negate();
      break;
    case PROCESSING_MODES.GRAYSCALE:
      sharpInstance = sharpInstance.grayscale();
      break;
    case PROCESSING_MODES.SEPIA:
      sharpInstance = sharpInstance.tint({ r: 112, g: 66, b: 20 }); // Sepia tone
      break;
    case PROCESSING_MODES.NORMAL:
    default:
      // No processing, just copy
      break;
  }

  await sharpInstance.toFile(outputPath);
};

// ===== PDF to A4 Converter with multiple modes =====
const convertPDFToA4 = async (filePath, mode = PROCESSING_MODES.NEGATIVE) => {
  const outputDir = "./temp-images";
  const processedDir = "./temp-processed";

  clearFolder(outputDir);
  clearFolder(processedDir);

  // PDF → images
  const opts = {
    format: "jpeg",
    out_dir: path.resolve(outputDir),
    out_prefix: path.basename(filePath, path.extname(filePath)),
    page: null,
  };

  await pdf.convert(filePath, opts);

  // Read & process images based on mode
  let images = fs
    .readdirSync(outputDir)
    .filter((f) =>
      [".jpg", ".jpeg", ".png"].includes(path.extname(f).toLowerCase())
    )
    .sort((a, b) => {
      // Natural sort for page numbers
      const getNum = (str) => parseInt(str.match(/\d+/)?.[0] || 0);
      return getNum(a) - getNum(b);
    })
    .map((f) => path.join(outputDir, f));

  // Process images with selected mode
  for (const [index, imgPath] of images.entries()) {
    const outputFile = path.join(
      processedDir,
      `page_${String(index + 1).padStart(3, "0")}_${mode}.jpeg`
    );
    await processImage(imgPath, outputFile, mode);
  }

  // Create PDF with processed images
  const processedImages = fs
    .readdirSync(processedDir)
    .filter((f) =>
      [".jpg", ".jpeg", ".png"].includes(path.extname(f).toLowerCase())
    )
    .sort((a, b) => {
      const getNum = (str) => parseInt(str.match(/\d+/)?.[0] || 0);
      return getNum(a) - getNum(b);
    })
    .map((f) => path.join(processedDir, f));

  const pdfDoc = await PDFDocument.create();

  let page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  let x = 0,
    y = A4_HEIGHT - IMAGE_HEIGHT;
  let count = 0;
  let pageNumber = 1;

  // Page background based on mode
  const backgroundColor =
    mode === PROCESSING_MODES.NEGATIVE ? rgb(0, 0, 0) : rgb(1, 1, 1);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: A4_WIDTH,
    height: A4_HEIGHT,
    color: backgroundColor,
  });

  for (const imgPath of processedImages) {
    const imgBytes = fs.readFileSync(imgPath);
    const img = await pdfDoc.embedJpg(imgBytes);

    const borderColor =
      mode === PROCESSING_MODES.NEGATIVE
        ? rgb(0.7, 0.7, 0.7)
        : rgb(0.3, 0.3, 0.3);
    const radius = 12;
    const padding = 6;

    // Border Box with Radius
    page.drawRectangle({
      x: x,
      y: y,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      borderColor: borderColor,
      borderWidth: 2,
      color: backgroundColor,
      borderRadius: radius,
    });

    // Image inside border
    page.drawImage(img, {
      x: x + padding,
      y: y + padding,
      width: IMAGE_WIDTH - padding * 2,
      height: IMAGE_HEIGHT - padding * 2,
    });

    count++;
    x += IMAGE_WIDTH;

    if (count % COLS === 0) {
      x = 0;
      y -= IMAGE_HEIGHT;
    }

    // New page when current page is full
    if (count % (COLS * ROWS) === 0 && count < processedImages.length) {
      // Footer
      const footerColor =
        mode === PROCESSING_MODES.NEGATIVE ? rgb(1, 1, 1) : rgb(0, 0, 0);
      page.drawText("Made By Shatadhru", {
        x: 20,
        y: 20,
        size: 12,
        color: footerColor,
      });

      page.drawText(`Page ${pageNumber}`, {
        x: A4_WIDTH - 60,
        y: 20,
        size: 12,
        color: footerColor,
      });

      pageNumber++;

      // New page
      page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);

      // Set background for new page
      page.drawRectangle({
        x: 0,
        y: 0,
        width: A4_WIDTH,
        height: A4_HEIGHT,
        color: backgroundColor,
      });

      x = 0;
      y = A4_HEIGHT - IMAGE_HEIGHT;
    }
  }

  // Footer for last page
  const footerColor =
    mode === PROCESSING_MODES.NEGATIVE ? rgb(1, 1, 1) : rgb(0, 0, 0);
  page.drawText("Made By Shatadhru", {
    x: 20,
    y: 20,
    size: 12,
    color: footerColor,
  });

  page.drawText(`Page ${pageNumber}`, {
    x: A4_WIDTH - 60,
    y: 20,
    size: 12,
    color: footerColor,
  });

  const pdfBytes = await pdfDoc.save();

  // Clean up
  clearFolder(outputDir);
  clearFolder(processedDir);

  return pdfBytes;
};

// ===== Serve frontend =====
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ===== API endpoint for PDF to A4 conversion =====
app.post("/api/process-pdf", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF file uploaded" });
    }

    const mode = req.body.mode || PROCESSING_MODES.NEGATIVE;

    // Validate mode
    if (!Object.values(PROCESSING_MODES).includes(mode)) {
      return res.status(400).json({ error: "Invalid processing mode" });
    }

    const pdfBytes = await convertPDFToA4(req.file.path, mode);

    // Cleanup uploaded file
    try {
      fs.unlinkSync(req.file.path);
    } catch (err) {
      console.warn("Could not delete uploaded file:", err.message);
    }

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="processed_${mode}.pdf"`,
    });

    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("PDF Processing Error:", err);

    // Cleanup on error
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupErr) {
        console.warn("Cleanup error:", cleanupErr.message);
      }
    }

    res.status(500).json({
      error: "PDF processing failed",
      details: err.message,
    });
  }
});

// ===== API endpoint for PDF Merging =====
app.post("/api/merge-pdf", upload.array("pdfs", 20), async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No PDF files uploaded" });
    }

    if (files.length < 2) {
      return res
        .status(400)
        .json({ error: "Please upload at least 2 PDF files to merge" });
    }

    const mergedPdf = await PDFDocument.create();

    // Process files in order
    for (const file of files) {
      try {
        const pdfBytes = fs.readFileSync(file.path);
        const pdf = await PDFDocument.load(pdfBytes);

        // Copy all pages
        const pageIndices = pdf.getPageIndices();
        const copiedPages = await mergedPdf.copyPages(pdf, pageIndices);
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      } catch (fileErr) {
        console.error(`Error processing file ${file.originalname}:`, fileErr);
        // Continue with other files even if one fails
      }
    }

    // Check if any pages were added
    if (mergedPdf.getPageCount() === 0) {
      return res
        .status(400)
        .json({ error: "No valid PDF pages found in uploaded files" });
    }

    const mergedBytes = await mergedPdf.save();

    // Cleanup uploaded files
    files.forEach((file) => {
      try {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } catch (err) {
        console.warn(`Could not delete file ${file.path}:`, err.message);
      }
    });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="merged.pdf"',
    });

    res.send(Buffer.from(mergedBytes));
  } catch (err) {
    console.error("PDF Merge Error:", err);

    // Cleanup on error
    if (req.files) {
      req.files.forEach((file) => {
        try {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        } catch (cleanupErr) {
          console.warn("Cleanup error:", cleanupErr.message);
        }
      });
    }

    res.status(500).json({
      error: "PDF merge failed",
      details: err.message,
    });
  }
});

// ===== Health check endpoint =====
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    features: ["pdf-to-a4", "pdf-merge"],
  });
});

// ===== Error handling middleware =====
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large" });
    }
    if (error.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ error: "Too many files" });
    }
  }
  res.status(500).json({ error: "Internal server error" });
});

module.exports = app;
