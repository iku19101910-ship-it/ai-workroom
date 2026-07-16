// PDF / DOCX / PPTX からのテキスト抽出(§4.6)。純JS依存のみ(pdf-parse, adm-zip)。
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const MAX_LEN = 30000;

function decodeXmlEntities(t) {
  return t
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

async function pdfText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const mod = require("pdf-parse");
  // pdf-parse はバージョンによりAPIが異なるため両対応
  const fn = mod.default || mod;
  if (typeof fn === "function") {
    const data = await fn(buffer);
    return data.text || "";
  }
  if (mod.PDFParse) {
    const parser = new mod.PDFParse({ data: buffer });
    const result = await parser.getText();
    return result.text || "";
  }
  throw new Error("pdf-parse のAPIを解決できません");
}

function docxText(filePath) {
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry("word/document.xml");
  if (!entry) return "";
  const xml = entry.getData().toString("utf8");
  return decodeXmlEntities(
    xml
      .replace(/<w:p[ >]/g, "\n<w:p ")
      .replace(/<[^>]+>/g, "")
  );
}

function pptxText(filePath) {
  const zip = new AdmZip(filePath);
  const slides = zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => {
      const na = Number(a.entryName.match(/slide(\d+)/)[1]);
      const nb = Number(b.entryName.match(/slide(\d+)/)[1]);
      return na - nb;
    });
  const parts = [];
  for (const s of slides) {
    const xml = s.getData().toString("utf8");
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1]));
    if (texts.length) parts.push(texts.join(" "));
  }
  return parts.join("\n\n");
}

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let text = "";
  if (ext === ".pdf") text = await pdfText(filePath);
  else if (ext === ".docx") text = docxText(filePath);
  else if (ext === ".pptx") text = pptxText(filePath);
  else throw new Error("未対応の形式: " + ext);
  return text.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_LEN);
}

const SUPPORTED_EXTS = [".pdf", ".docx", ".pptx"];

module.exports = { extractText, SUPPORTED_EXTS };
