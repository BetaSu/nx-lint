import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as devkit from "@nx/devkit";
import { setWorkspaceRoot } from "nx/src/utils/workspace-root";

/** Private filesystem fixture. Public test helpers own its lifetime. */
export class TempFs {
  readonly tempDir: string;
  private readonly previousWorkspaceRoot: string;

  constructor(prefix: string, overrideWorkspaceRoot = true) {
    this.tempDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
    );
    this.previousWorkspaceRoot = devkit.workspaceRoot;
    if (overrideWorkspaceRoot) setWorkspaceRoot(this.tempDir);
    this.createFileSync("nx.json", "{}");
  }

  createFilesSync(files: Record<string, string>) {
    for (const [name, content] of Object.entries(files))
      this.createFileSync(name, content);
  }
  async createFiles(files: Record<string, string>) {
    await Promise.all(
      Object.entries(files).map(([name, content]) =>
        this.createFile(name, content),
      ),
    );
  }
  createFileSync(name: string, content: string) {
    const target = path.join(this.tempDir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  async createFile(name: string, content: string) {
    this.createFileSync(name, content);
  }
  createSymlinkSync(target: string, name: string, type: "dir" | "file") {
    const output = path.join(this.tempDir, name);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.symlinkSync(path.join(this.tempDir, target), output, type);
  }
  async readFile(name: string) {
    return fs.readFileSync(path.join(this.tempDir, name), "utf8");
  }
  removeFileSync(name: string) {
    fs.unlinkSync(path.join(this.tempDir, name));
  }
  appendFile(name: string, content: string) {
    fs.appendFileSync(path.join(this.tempDir, name), content);
  }
  writeFile(name: string, content: string) {
    fs.writeFileSync(path.join(this.tempDir, name), content);
  }
  renameFile(from: string, to: string) {
    fs.renameSync(path.join(this.tempDir, from), path.join(this.tempDir, to));
  }
  reset() {
    fs.rmSync(this.tempDir, { recursive: true, force: true, maxRetries: 5 });
    fs.mkdirSync(this.tempDir, { recursive: true });
  }
  cleanup() {
    try {
      fs.rmSync(this.tempDir, { recursive: true, force: true, maxRetries: 5 });
    } finally {
      setWorkspaceRoot(this.previousWorkspaceRoot);
    }
  }
}
