import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveClaudeBinary } from '../claude/ClaudeSession';
import type { AuthStatus } from '../../shared/ipc';

const execFileAsync = promisify(execFile);
const AUTH_STATUS_TIMEOUT_MS = 10_000;

// Real shape confirmed by hand: `claude auth status --json` ->
// {"loggedIn": boolean, "authMethod": "oauth_token", "apiProvider": "firstParty"}.
// No email/username/subscription-tier field exists here or anywhere else locally-readable.
export async function getAuthStatus(): Promise<AuthStatus | null> {
  try {
    const bin = resolveClaudeBinary();
    const { stdout } = await execFileAsync(bin, ['auth', 'status', '--json'], {
      timeout: AUTH_STATUS_TIMEOUT_MS,
    });
    const parsed = JSON.parse(stdout) as Partial<AuthStatus>;
    if (typeof parsed.loggedIn !== 'boolean') return null;
    return {
      loggedIn: parsed.loggedIn,
      authMethod: parsed.authMethod ?? 'unknown',
      apiProvider: parsed.apiProvider ?? 'unknown',
    };
  } catch {
    return null;
  }
}
