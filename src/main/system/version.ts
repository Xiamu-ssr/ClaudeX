import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveClaudeBinary } from '../claude/ClaudeSession';

const execFileAsync = promisify(execFile);
const DOCTOR_TIMEOUT_MS = 20_000;

export async function getClaudeVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(resolveClaudeBinary(), ['--version']);
    return stdout.trim();
  } catch {
    return null;
  }
}

// `claude doctor` spawns real stdio MCP servers from the target directory's .mcp.json to
// health-check them, so it's scoped to the caller-supplied cwd and only ever run on an
// explicit user click — never automatically — same trust boundary as running it by hand.
export async function runDoctor(cwd: string): Promise<{ output: string; ok: boolean }> {
  try {
    const { stdout, stderr } = await execFileAsync(resolveClaudeBinary(), ['doctor'], {
      cwd,
      timeout: DOCTOR_TIMEOUT_MS,
    });
    return { output: (stdout + stderr).trim(), ok: true };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    const output = [e.stdout, e.stderr].filter(Boolean).join('\n').trim() || e.message;
    return { output, ok: false };
  }
}
