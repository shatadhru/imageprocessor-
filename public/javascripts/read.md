const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const pdf = require("pdf-poppler");
const sharp = require("sharp");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");

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
    fileSize: 100 * 1024 * 1024, // 100 MB
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
      sharpInstance = sharpInstance
        .negate()
        .grayscale()
        .sharpen()
        .linear(1.3, -15);
      break;
    case PROCESSING_MODES.SEPIA:
      sharpInstance = sharpInstance.tint({ r: 112, g: 66, b: 20 });
      break;
    case PROCESSING_MODES.NORMAL:
    default:
      break;
  }

  await sharpInstance.toFile(outputPath);
};

// ===== Convert PDF to A4 with processed images and page numbers =====
const convertPDFToA4 = async (filePath, mode = PROCESSING_MODES.NORMAL) => {
  const outputDir = "./temp-images";
  const processedDir = "./temp-processed";

  clearFolder(outputDir);
  clearFolder(processedDir);

  // PDF → JPEG conversion with high DPI
  const opts = {
    format: "jpeg",
    out_dir: path.resolve(outputDir),
    out_prefix: path.basename(filePath, path.extname(filePath)),
    page: null,
    dpi: 600,
  };

  await pdf.convert(filePath, opts);

  // Read & sort images
  let images = fs
    .readdirSync(outputDir)
    .filter((f) =>
      [".jpg", ".jpeg", ".png"].includes(path.extname(f).toLowerCase())
    )
    .sort((a, b) => {
      const getNum = (str) => parseInt(str.match(/\d+/)?.[0] || 0);
      return getNum(a) - getNum(b);
    })
    .map((f) => path.join(outputDir, f));

  // Process images
  for (const [index, imgPath] of images.entries()) {
    const outputFile = path.join(
      processedDir,
      `page_${String(index + 1).padStart(3, "0")}.jpeg`
    );
    await processImage(imgPath, outputFile, mode);
  }

  // Embed processed images into A4 PDF
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
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  let page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  let x = 0,
    y = A4_HEIGHT - IMAGE_HEIGHT;
  let count = 0;
  let pdfPageNumber = 1;

  const backgroundColor = rgb(1, 1, 1); // white background

  page.drawRectangle({
    x: 0,
    y: 0,
    width: A4_WIDTH,
    height: A4_HEIGHT,
    color: backgroundColor,
  });

  for (const [index, imgPath] of processedImages.entries()) {
    const imgBytes = fs.readFileSync(imgPath);
    const img = await pdfDoc.embedJpg(imgBytes);

    const borderColor = rgb(0, 0, 0);
    const borderWidth = 1;
    const borderRadius = 5;
    const padding = 6;

    page.drawRectangle({
      x,
      y,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      borderColor,
      borderWidth,
      color: backgroundColor,
      borderRadius,
    });

    page.drawImage(img, {
      x: x + padding,
      y: y + padding,
      width: IMAGE_WIDTH - padding * 2,
      height: IMAGE_HEIGHT - padding * 2,
    });

    // --- Add small page number per image (bottom-right inside image) ---
    const imagePageNumberText = String(index + 1);
    const fontSize = 10;
    page.drawText(imagePageNumberText, {
      x:
        x + IMAGE_WIDTH - padding - fontSize * imagePageNumberText.length * 0.6,
      y: y + padding,
      size: 6,
      font,
      color: rgb(0, 0, 0),
    });

    count++;
    x += IMAGE_WIDTH;

    if (count % COLS === 0) {
      x = 0;
      y -= IMAGE_HEIGHT;
    }

    if (count % (COLS * ROWS) === 0 && count < processedImages.length) {
      // Footer for PDF page
      page.drawText("Shatadhru Innovations", {
        x: 20,
        y: 20,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
      page.drawText(`Page ${pdfPageNumber}`, {
        x: A4_WIDTH - 60,
        y: 20,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });

      pdfPageNumber++;
      page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
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

  // Last page footer
  page.drawText("Made By Shatadhru", {
    x: 20,
    y: 20,
    size: 12,
    font,
    color: rgb(0, 0, 0),
  });
  page.drawText(`Page ${pdfPageNumber}`, {
    x: A4_WIDTH - 60,
    y: 20,
    size: 12,
    font,
    color: rgb(0, 0, 0),
  });

  const pdfBytes = await pdfDoc.save();

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

    if (!Object.values(PROCESSING_MODES).includes(mode)) {
      return res.status(400).json({ error: "Invalid processing mode" });
    }

    const pdfBytes = await convertPDFToA4(req.file.path, mode);

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

// ===== PDF MERGE ROUTE =====
app.post("/api/merge-pdf", upload.array("pdfs", 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No PDF files uploaded" });
    }

    const mergedPdf = await PDFDocument.create();

    for (const file of req.files) {
      const pdfBytes = fs.readFileSync(file.path);
      const pdf = await PDFDocument.load(pdfBytes);
      const copiedPages = await mergedPdf.copyPages(
        pdf,
        pdf.getPageIndices()
      );

      copiedPages.forEach((page) => mergedPdf.addPage(page));

      // delete temp file
      try {
        fs.unlinkSync(file.path);
      } catch {}
    }

    const mergedPdfBytes = await mergedPdf.save();

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="merged.pdf"`,
    });

    res.send(Buffer.from(mergedPdfBytes));
  } catch (err) {
    console.error("PDF Merge Error:", err.message);

    res.status(500).json({
      error: "PDF merge failed",
      details: err.message,
    });
  }
});


module.exports = app;
