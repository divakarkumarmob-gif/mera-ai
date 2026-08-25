import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface OrganizeResult {
  success: boolean;
  targetDirectory: string;
  totalFilesScanned: number;
  filesOrganized: number;
  breakdown: Record<string, number>;
  message: string;
}

export interface CleanupResult {
  success: boolean;
  tempDirectory: string;
  filesDeleted: number;
  spaceFreedMB: string;
  message: string;
}

const CATEGORY_MAP: Record<string, string[]> = {
  Images: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".ico"],
  Documents: [".pdf", ".docx", ".doc", ".txt", ".xlsx", ".xls", ".pptx", ".csv", ".epub"],
  Videos: [".mp4", ".mkv", ".mov", ".avi", ".webm", ".flv", ".wmv"],
  Audio: [".mp3", ".wav", ".aac", ".flac", ".m4a", ".ogg"],
  Archives: [".zip", ".rar", ".7z", ".tar", ".gz", ".iso"],
  Code: [".js", ".ts", ".tsx", ".py", ".html", ".css", ".json", ".cpp", ".java", ".sql", ".sh"],
  Installers: [".exe", ".msi", ".dmg", ".pkg", ".apk"],
};

class FileOrganizerService {
  /**
   * Organizes a cluttered folder (e.g. Downloads or Desktop) into categorized subfolders.
   */
  public async organizeDirectory(dirPath?: string): Promise<OrganizeResult> {
    const userHome = os.homedir();
    const targetDir = dirPath
      ? path.resolve(dirPath)
      : path.join(userHome, "Downloads");

    if (!fs.existsSync(targetDir)) {
      throw new Error(`Directory nahi mila: ${targetDir}`);
    }

    const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
    const breakdown: Record<string, number> = {
      Images: 0,
      Documents: 0,
      Videos: 0,
      Audio: 0,
      Archives: 0,
      Code: 0,
      Installers: 0,
      Others: 0,
    };

    let totalFilesScanned = 0;
    let filesOrganized = 0;

    for (const entry of entries) {
      if (entry.isDirectory()) continue; // Skip subfolders
      totalFilesScanned++;

      const ext = path.extname(entry.name).toLowerCase();
      let matchedCategory = "Others";

      for (const [cat, extensions] of Object.entries(CATEGORY_MAP)) {
        if (extensions.includes(ext)) {
          matchedCategory = cat;
          break;
        }
      }

      if (matchedCategory !== "Others") {
        const destDir = path.join(targetDir, matchedCategory);
        if (!fs.existsSync(destDir)) {
          await fs.promises.mkdir(destDir, { recursive: true });
        }

        const srcPath = path.join(targetDir, entry.name);
        const destPath = path.join(destDir, entry.name);

        try {
          // Avoid overwrite by checking existence
          if (!fs.existsSync(destPath)) {
            await fs.promises.rename(srcPath, destPath);
            breakdown[matchedCategory]++;
            filesOrganized++;
          }
        } catch (err) {
          console.warn(`[FileOrganizer] Could not move file ${entry.name}:`, err);
        }
      }
    }

    const message = `Boss, ${targetDir} me total ${totalFilesScanned} files scan hui aur ${filesOrganized} files ko unke categorized folders (Images, Documents, Videos, Code, etc.) me organize kar diya gaya hai!`;

    return {
      success: true,
      targetDirectory: targetDir,
      totalFilesScanned,
      filesOrganized,
      breakdown,
      message,
    };
  }

  /**
   * Cleans safe Windows / System temporary cache files.
   */
  public async cleanTempFiles(): Promise<CleanupResult> {
    const tempDir = os.tmpdir();
    let filesDeleted = 0;
    let bytesFreed = 0;

    try {
      const files = await fs.promises.readdir(tempDir);
      for (const file of files.slice(0, 100)) {
        const filePath = path.join(tempDir, file);
        try {
          const stats = await fs.promises.stat(filePath);
          if (stats.isFile()) {
            bytesFreed += stats.size;
            await fs.promises.unlink(filePath);
            filesDeleted++;
          }
        } catch {
          // Ignore files locked by active processes
        }
      }
    } catch (err) {
      console.warn("[FileOrganizer] Error cleaning temp directory:", err);
    }

    const spaceFreedMB = (bytesFreed / (1024 * 1024)).toFixed(2);
    const message = `Boss, system temp cache clean kar diya gaya hai! Total ${filesDeleted} temporary files delete hui aur lagbhag ${spaceFreedMB} MB storage space free hua.`;

    return {
      success: true,
      tempDirectory: tempDir,
      filesDeleted,
      spaceFreedMB,
      message,
    };
  }
}

export const fileOrganizerService = new FileOrganizerService();
