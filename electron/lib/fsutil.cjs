const fs = require("fs");
const path = require("path");

function atomicWriteFile(filePath, data, encoding) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = filePath + ".tmp";
  try {
    fs.writeFileSync(tmpPath, data, encoding);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
    throw err;
  }
}

function trashDir(workspaceRoot) {
  const dir = path.join(workspaceRoot, ".trash");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function moveToTrash(workspaceRoot, filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stamp = new Date().toISOString().replace(/:/g, "-");
  let destination = path.join(trashDir(workspaceRoot), `${stamp}_${path.basename(filePath)}`);
  let suffix = 1;
  while (fs.existsSync(destination)) {
    destination = path.join(trashDir(workspaceRoot), `${stamp}_${suffix}_${path.basename(filePath)}`);
    suffix += 1;
  }
  fs.renameSync(filePath, destination);
  return destination;
}

function cleanupTrash(workspaceRoot, maxAgeDays = 30) {
  const dir = path.join(workspaceRoot, ".trash");
  if (!fs.existsSync(dir)) return 0;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(dir, entry.name);
    try {
      if (fs.statSync(file).mtimeMs < cutoff) {
        fs.unlinkSync(file);
        removed += 1;
      }
    } catch {}
  }
  return removed;
}

module.exports = { atomicWriteFile, moveToTrash, cleanupTrash };
