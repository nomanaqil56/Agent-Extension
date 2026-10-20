// Antigravity Local Agent Engine - Scoped File Operations Tool

const fs = require('fs');
const path = require('path');

class FilesTool {
  constructor(permissionManager) {
    this.permissionManager = permissionManager;
  }

  // List files in directory
  async listFiles({ dirPath = '.', recursive = false, maxDepth = 2 }) {
    const targetDir = path.resolve(dirPath);
    if (!this.permissionManager.isPathApproved(targetDir)) {
      throw new Error(`Directory "${targetDir}" is outside approved directories.`);
    }

    if (!fs.existsSync(targetDir)) {
      throw new Error(`Directory does not exist: "${targetDir}"`);
    }

    const results = [];
    const walk = (current, depth) => {
      if (depth > maxDepth) return;
      const entries = fs.readdirSync(current, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const fullPath = path.join(current, entry.name);
        const relPath = path.relative(targetDir, fullPath);

        if (entry.isDirectory()) {
          results.push({ name: entry.name, path: relPath, type: 'directory' });
          if (recursive) walk(fullPath, depth + 1);
        } else {
          try {
            const stat = fs.statSync(fullPath);
            results.push({
              name: entry.name,
              path: relPath,
              type: 'file',
              sizeBytes: stat.size,
              modified: stat.mtime.toISOString()
            });
          } catch (e) {}
        }
      }
    };

    walk(targetDir, 1);
    return {
      baseDir: targetDir,
      totalEntries: results.length,
      entries: results.slice(0, 100)
    };
  }

  // Read file content
  async readFile({ filePath, maxLines = 500, offset = 0 }) {
    const resolved = path.resolve(filePath);
    if (!this.permissionManager.isPathApproved(resolved)) {
      throw new Error(`Read path "${resolved}" is outside approved directories.`);
    }

    if (!fs.existsSync(resolved)) {
      throw new Error(`File does not exist: "${resolved}"`);
    }

    const stat = fs.statSync(resolved);
    if (stat.size > 5 * 1024 * 1024) {
      throw new Error(`File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max read size is 5MB.`);
    }

    const raw = fs.readFileSync(resolved, 'utf8');
    const lines = raw.split(/\r?\n/);
    const sliced = lines.slice(offset, offset + maxLines);

    return {
      filePath: resolved,
      totalLines: lines.length,
      offset,
      returnedLines: sliced.length,
      content: sliced.join('\n')
    };
  }

  // Write or overwrite file
  async writeFile({ filePath, content }) {
    const resolved = path.resolve(filePath);
    if (!this.permissionManager.isPathApproved(resolved)) {
      throw new Error(`Write path "${resolved}" is outside approved directories.`);
    }

    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolved, content, 'utf8');
    const stat = fs.statSync(resolved);

    return {
      success: true,
      filePath: resolved,
      bytesWritten: stat.size,
      modified: stat.mtime.toISOString()
    };
  }

  // Patch/Replace text inside file
  async patchFile({ filePath, targetContent, replacementContent }) {
    const resolved = path.resolve(filePath);
    if (!this.permissionManager.isPathApproved(resolved)) {
      throw new Error(`Patch path "${resolved}" is outside approved directories.`);
    }

    if (!fs.existsSync(resolved)) {
      throw new Error(`File does not exist: "${resolved}"`);
    }

    const original = fs.readFileSync(resolved, 'utf8');
    if (!original.includes(targetContent)) {
      throw new Error(`Target text to replace was not found in "${path.basename(resolved)}"`);
    }

    const updated = original.replace(targetContent, replacementContent);
    fs.writeFileSync(resolved, updated, 'utf8');

    return {
      success: true,
      filePath: resolved,
      message: `Successfully replaced content in ${path.basename(resolved)}`
    };
  }

  // Search across files (simple grep)
  async searchFiles({ query, dirPath = '.', filePattern = null }) {
    const targetDir = path.resolve(dirPath);
    if (!this.permissionManager.isPathApproved(targetDir)) {
      throw new Error(`Search dir "${targetDir}" is outside approved directories.`);
    }

    const matches = [];
    const regex = new RegExp(query, 'i');

    const searchDir = (current, depth) => {
      if (depth > 4 || matches.length >= 40) return;
      const entries = fs.readdirSync(current, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const fullPath = path.join(current, entry.name);

        if (entry.isDirectory()) {
          searchDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          if (filePattern && !entry.name.includes(filePattern)) continue;
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > 1024 * 1024) continue; // skip > 1MB

            const text = fs.readFileSync(fullPath, 'utf8');
            const lines = text.split(/\r?\n/);
            lines.forEach((line, idx) => {
              if (regex.test(line) && matches.length < 40) {
                matches.push({
                  file: path.relative(targetDir, fullPath),
                  line: idx + 1,
                  content: line.trim()
                });
              }
            });
          } catch (e) {}
        }
      }
    };

    searchDir(targetDir, 1);
    return { query, totalMatches: matches.length, matches };
  }

  // Get file metadata
  async fileInfo({ filePath }) {
    const resolved = path.resolve(filePath);
    if (!this.permissionManager.isPathApproved(resolved)) {
      throw new Error(`Path "${resolved}" is outside approved directories.`);
    }

    if (!fs.existsSync(resolved)) {
      return { exists: false, filePath: resolved };
    }

    const stat = fs.statSync(resolved);
    return {
      exists: true,
      filePath: resolved,
      isDirectory: stat.isDirectory(),
      sizeBytes: stat.size,
      created: stat.birthtime.toISOString(),
      modified: stat.mtime.toISOString()
    };
  }

  // Delete file (requires approval)
  async deleteFile({ filePath }) {
    const resolved = path.resolve(filePath);
    if (!this.permissionManager.isPathApproved(resolved)) {
      throw new Error(`Delete path "${resolved}" is outside approved directories.`);
    }

    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: "${resolved}"`);
    }

    fs.unlinkSync(resolved);
    return { deleted: true, filePath: resolved };
  }
}

module.exports = FilesTool;
