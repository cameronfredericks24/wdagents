const fs = require("fs");
const path = require("path");

/**
 * Writes a file, creating directories as needed.
 * @param {string} filePath
 * @param {string} content
 */
function writeFileRecursive(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, "utf8");
}

module.exports = { writeFileRecursive };
