const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const pdf = require("pdf-poppler");
const sharp = require("sharp");
const { PDFDocument, rgb } = require("pdf-lib");

const app = express();

// ===== Multer setup (API upload) =====
const upload = multer({ dest: "./uploads/" });

// ===== A4 PDF layout =====
const A4_WIDTH = 595;
const A4_HEIGHT = 842;
const COLS = 2;
const ROWS = 4;
const IMAGE_WIDTH = A4_WIDTH / COLS;
const IMAGE_HEIGHT = (A4_HEIGHT / ROWS) * 0.9; // height slightly smaller

// ===== Helper: clear folder =====
const clearFolder = (folder) => {
  if (fs.existsSync(folder)) {
    fs.readdirSync(folder).forEach((f) => fs.unlinkSync(path.join(folder, f)));
  } else {
    fs.mkdirSync(folder, { recursive: true });
  }
};

// ===== Main processing function =====
const processPDF = async (filePath) => {
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

  // Read & process images (negate)
  let images = fs
    .readdirSync(outputDir)
    .filter((f) =>
      [".jpg", ".jpeg", ".png"].includes(path.extname(f).toLowerCase())
    )
    .sort()
    .map((f) => path.join(outputDir, f));

  for (const imgPath of images) {
    const outputFile = path.join(
      processedDir,
      path.basename(imgPath, path.extname(imgPath)) + "_neg.jpeg"
    );
    await sharp(imgPath).negate().toFile(outputFile);
  }

  // pdf-lib: create PDF
  const processedImages = fs
    .readdirSync(processedDir)
    .filter((f) =>
      [".jpg", ".jpeg", ".png"].includes(path.extname(f).toLowerCase())
    )
    .sort()
    .map((f) => path.join(processedDir, f));

  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  let x = 0,
    y = A4_HEIGHT - IMAGE_HEIGHT;
  let count = 0;
  let pageNumber = 1;

  for (const imgPath of processedImages) {
    const imgBytes = fs.readFileSync(imgPath);
    const img = await pdfDoc.embedJpg(imgBytes);
    page.drawImage(img, { x, y, width: IMAGE_WIDTH, height: IMAGE_HEIGHT });

    count++;
    x += IMAGE_WIDTH;
    if (count % COLS === 0) {
      x = 0;
      y -= IMAGE_HEIGHT;
    }

    // New page after 2x4 images
    if (count % (COLS * ROWS) === 0 && count < processedImages.length) {
      // Add footer: Made By Shatadhru + Page Number
      page.drawText("Made By Shatadhru", {
        x: 20,
        y: 20,
        size: 12,
        color: rgb(0, 0, 0),
      });
      page.drawText(`Page ${pageNumber}`, {
        x: A4_WIDTH - 60,
        y: 20,
        size: 12,
        color: rgb(0, 0, 0),
      });
      pageNumber++;

      // New page
      page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
      x = 0;
      y = A4_HEIGHT - IMAGE_HEIGHT;
    }
  }

  // Add footer to last page
  page.drawText("Made By Shatadhru", {
    x: 20,
    y: 20,
    size: 12,
    color: rgb(0, 0, 0),
  });
  page.drawText(`Page ${pageNumber}`, {
    x: A4_WIDTH - 60,
    y: 20,
    size: 12,
    color: rgb(0, 0, 0),
  });

  const pdfBytes = await pdfDoc.save();

  // Clean up
  clearFolder(outputDir);
  clearFolder(processedDir);

  return pdfBytes;
};

// ===== Serve frontend =====
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ===== API endpoint =====
app.post("/api/process-pdf", upload.single("pdf"), async (req, res) => {
  try {
    const pdfBytes = await processPDF(req.file.path);
    fs.unlinkSync(req.file.path); // delete uploaded PDF

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="processed.pdf"',
    });
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Processing failed", details: err.message });
  }
});

// ===== TEST WITHOUT API =====
const testPDF = "./assets/pdfs/chemistry.pdf";
processPDF(testPDF)
  .then((pdfBytes) => {
    fs.writeFileSync("./assets/final-test-output.pdf", pdfBytes);
    console.log("✅ Test PDF created: ./assets/final-test-output.pdf");
  })
  .catch((err) => console.error("❌ Test failed:", err));

module.exports = app;
