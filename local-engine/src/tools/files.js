// Antigravity Local Agent Engine - Scoped File Operations Tool

const fs = require('fs');
const path = require('path');

class FilesTool {
  constructor(permissionManager) {
    this.permissionManager = permissionManager;
  }

  // List files in directory
  async listFiles(params = {}) {
    const rawPath = params.dirPath || params.directory || params.path || params.cwd || '.';
    const targetDir = path.resolve(rawPath);
    if (!this.permissionManager.isPathApproved(targetDir)) {
      throw new Error(`Directory "${targetDir}" is outside approved directories.`);
    }

    if (!fs.existsSync(targetDir)) {
      throw new Error(`Directory does not exist: "${targetDir}"`);
    }

    const recursive = Boolean(params.recursive);
    const maxDepth = typeof params.maxDepth === 'number' ? params.maxDepth : 2;
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
  async readFile(params = {}) {
    const rawPath = this.permissionManager.normalizeFilePath(params);
    if (!rawPath) {
      throw new Error('File path is required');
    }
    const resolved = path.resolve(rawPath);
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

    const maxLines = typeof params.maxLines === 'number' ? params.maxLines : 500;
    const offset = typeof params.offset === 'number' ? params.offset : 0;
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

  // Write or overwrite file atomically
  async writeFile(params = {}) {
    const rawPath = this.permissionManager.normalizeFilePath(params);
    if (!rawPath) {
      throw new Error('File path is required');
    }
    const resolved = path.resolve(rawPath);
    if (!this.permissionManager.isPathApproved(resolved)) {
      throw new Error(`Write path "${resolved}" is outside approved directories.`);
    }

    // Verify symlink destination does not escape approved directories
    if (fs.existsSync(resolved)) {
      try {
        const lstat = fs.lstatSync(resolved);
        if (lstat.isSymbolicLink()) {
          const real = fs.realpathSync(resolved);
          if (!this.permissionManager.isPathApproved(real)) {
            throw new Error(`Write target "${resolved}" is a symbolic link pointing outside approved workspace.`);
          }
        }
      } catch (e) {
        if (e.message.includes('outside approved workspace')) throw e;
      }
    }

    const content = params.content !== undefined ? String(params.content) : '';
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Atomic write via temp file and rename
    const tmpFile = `${resolved}.tmp.${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    try {
      fs.writeFileSync(tmpFile, content, 'utf8');
      if (process.platform === 'win32' && fs.existsSync(resolved)) {
        try {
          fs.renameSync(tmpFile, resolved);
        } catch (renameErr) {
          fs.copyFileSync(tmpFile, resolved);
          fs.unlinkSync(tmpFile);
        }
      } else {
        fs.renameSync(tmpFile, resolved);
      }
    } catch (writeErr) {
      if (fs.existsSync(tmpFile)) {
        try { fs.unlinkSync(tmpFile); } catch (e) {}
      }
      throw writeErr;
    }

    const stat = fs.statSync(resolved);
    return {
      success: true,
      filePath: resolved,
      bytesWritten: stat.size,
      modified: stat.mtime.toISOString()
    };
  }

  // Patch/Replace text inside file atomically
  async patchFile(params = {}) {
    const rawPath = this.permissionManager.normalizeFilePath(params);
    if (!rawPath) {
      throw new Error('File path is required');
    }
    const resolved = path.resolve(rawPath);
    if (!this.permissionManager.isPathApproved(resolved)) {
      throw new Error(`Patch path "${resolved}" is outside approved directories.`);
    }

    if (!fs.existsSync(resolved)) {
      throw new Error(`File does not exist: "${resolved}"`);
    }

    // Verify symlink destination does not escape approved directories
    try {
      const lstat = fs.lstatSync(resolved);
      if (lstat.isSymbolicLink()) {
        const real = fs.realpathSync(resolved);
        if (!this.permissionManager.isPathApproved(real)) {
          throw new Error(`Patch target "${resolved}" is a symbolic link pointing outside approved workspace.`);
        }
      }
    } catch (e) {
      if (e.message.includes('outside approved workspace')) throw e;
    }

    const targetContent = params.targetContent;
    const replacementContent = params.replacementContent !== undefined ? String(params.replacementContent) : '';
    if (targetContent === undefined || targetContent === null) {
      throw new Error('targetContent is required for patch_file');
    }

    const original = fs.readFileSync(resolved, 'utf8');
    if (!original.includes(targetContent)) {
      throw new Error(`Target text to replace was not found in "${path.basename(resolved)}"`);
    }

    const updated = original.replace(targetContent, replacementContent);
    const tmpFile = `${resolved}.tmp.${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    try {
      fs.writeFileSync(tmpFile, updated, 'utf8');
      if (process.platform === 'win32' && fs.existsSync(resolved)) {
        try {
          fs.renameSync(tmpFile, resolved);
        } catch (renameErr) {
          fs.copyFileSync(tmpFile, resolved);
          fs.unlinkSync(tmpFile);
        }
      } else {
        fs.renameSync(tmpFile, resolved);
      }
    } catch (patchErr) {
      if (fs.existsSync(tmpFile)) {
        try { fs.unlinkSync(tmpFile); } catch (e) {}
      }
      throw patchErr;
    }

    return {
      success: true,
      filePath: resolved,
      message: `Successfully replaced content in ${path.basename(resolved)}`
    };
  }

  // Search across files (simple grep)
  async searchFiles(params = {}) {
    const query = params.query;
    if (!query) throw new Error('Search query is required');

    const rawDir = params.dirPath || params.directory || params.path || '.';
    const targetDir = path.resolve(rawDir);
    if (!this.permissionManager.isPathApproved(targetDir)) {
      throw new Error(`Search dir "${targetDir}" is outside approved directories.`);
    }

    const filePattern = params.filePattern || null;
    const matches = [];
    let regex;
    try {
      regex = new RegExp(query, 'i');
    } catch (e) {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(escaped, 'i');
    }

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
            const queryLower = query.toLowerCase();
            lines.forEach((line, idx) => {
              const matched = (regex && regex.test(line)) || line.toLowerCase().includes(queryLower);
              if (matched && matches.length < 40) {
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
  async fileInfo(params = {}) {
    const rawPath = this.permissionManager.normalizeFilePath(params);
    if (!rawPath) {
      throw new Error('File path is required');
    }
    const resolved = path.resolve(rawPath);
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
  async deleteFile(params = {}) {
    const rawPath = this.permissionManager.normalizeFilePath(params);
    if (!rawPath) {
      throw new Error('File path is required');
    }
    const resolved = path.resolve(rawPath);
    if (!this.permissionManager.isPathApproved(resolved)) {
      throw new Error(`Delete path "${resolved}" is outside approved directories.`);
    }

    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: "${resolved}"`);
    }

    fs.unlinkSync(resolved);
    return { deleted: true, filePath: resolved };
  }

  // Create directory (Section 13)
  async createDirectory(params = {}) {
    const rawPath = params.dirPath || params.directory || params.path;
    if (!rawPath) throw new Error('Directory path is required');
    const resolved = path.resolve(rawPath);
    if (!this.permissionManager.isPathApproved(resolved)) {
      throw new Error(`Create directory path "${resolved}" is outside approved directories.`);
    }
    fs.mkdirSync(resolved, { recursive: true });
    return { created: true, dirPath: resolved };
  }

  // Copy file within approved directories
  async copyFile(params = {}) {
    const src = this.permissionManager.normalizeFilePath({ path: params.source || params.src || params.filePath });
    const dst = this.permissionManager.normalizeFilePath({ path: params.destination || params.dest || params.targetPath });
    if (!src || !dst) throw new Error('Both source and destination paths are required for copy_file');

    const resSrc = path.resolve(src);
    const resDst = path.resolve(dst);
    if (!this.permissionManager.isPathApproved(resSrc) || !this.permissionManager.isPathApproved(resDst)) {
      throw new Error('Source or destination path is outside approved workspace directories.');
    }
    if (!fs.existsSync(resSrc)) throw new Error(`Source file does not exist: "${resSrc}"`);

    const dstDir = path.dirname(resDst);
    if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });

    fs.copyFileSync(resSrc, resDst);
    return { copied: true, source: resSrc, destination: resDst };
  }

  // Move or rename file within approved directories
  async moveFile(params = {}) {
    const src = this.permissionManager.normalizeFilePath({ path: params.source || params.src || params.filePath });
    const dst = this.permissionManager.normalizeFilePath({ path: params.destination || params.dest || params.targetPath });
    if (!src || !dst) throw new Error('Both source and destination paths are required for move_file');

    const resSrc = path.resolve(src);
    const resDst = path.resolve(dst);
    if (!this.permissionManager.isPathApproved(resSrc) || !this.permissionManager.isPathApproved(resDst)) {
      throw new Error('Source or destination path is outside approved workspace directories.');
    }
    if (!fs.existsSync(resSrc)) throw new Error(`Source file does not exist: "${resSrc}"`);

    const dstDir = path.dirname(resDst);
    if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });

    try {
      fs.renameSync(resSrc, resDst);
    } catch (renameErr) {
      // Fallback for cross-device or permission lock
      fs.copyFileSync(resSrc, resDst);
      fs.unlinkSync(resSrc);
    }
    return { moved: true, source: resSrc, destination: resDst };
  }
}

module.exports = FilesTool;
