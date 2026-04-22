import { Logger } from '../core/logger';

const log = new Logger('ollama');

/**
 * Check if Ollama server is running.
 */
export async function isOllamaRunning(baseUrl = 'http://localhost:11434'): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * List currently loaded/running models.
 */
export async function listRunningModels(baseUrl = 'http://localhost:11434'): Promise<string[]> {
  try {
    const response = await fetch(`${baseUrl}/api/ps`);
    if (!response.ok) return [];
    const data = await response.json() as { models: Array<{ name: string }> };
    return data.models?.map(m => m.name) ?? [];
  } catch {
    return [];
  }
}

/**
 * List available (downloaded) models.
 */
export async function listAvailableModels(baseUrl = 'http://localhost:11434'): Promise<string[]> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) return [];
    const data = await response.json() as { models: Array<{ name: string }> };
    return data.models?.map(m => m.name) ?? [];
  } catch {
    return [];
  }
}

/**
 * Ensure a model is loaded and ready. Pulls if not available.
 */
export async function ensureModel(model: string, baseUrl = 'http://localhost:11434'): Promise<boolean> {
  // Check if already available
  const available = await listAvailableModels(baseUrl);
  if (available.some(m => m === model || m.startsWith(model + ':'))) {
    return true;
  }

  // Pull the model
  log.info(`Pulling model: ${model}...`);
  try {
    const proc = Bun.spawn(['ollama', 'pull', model], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await proc.exited;
    const exitCode = proc.exitCode;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      log.error(`Failed to pull ${model}: ${stderr}`);
      return false;
    }
    log.info(`Model ${model} pulled successfully`);
    return true;
  } catch (e) {
    log.error(`Failed to pull ${model}: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

/**
 * Stop a running model to free VRAM.
 */
export async function stopModel(model: string, baseUrl = 'http://localhost:11434'): Promise<boolean> {
  try {
    const proc = Bun.spawn(['ollama', 'stop', model], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Ensure Ollama server is running. Start it if not.
 */
export async function ensureOllamaRunning(baseUrl = 'http://localhost:11434'): Promise<boolean> {
  if (await isOllamaRunning(baseUrl)) return true;

  log.info('Ollama not running, starting...');
  try {
    // Start ollama serve in background
    Bun.spawn(['ollama', 'serve'], {
      stdout: 'ignore',
      stderr: 'ignore',
    });

    // Wait for it to come up
    for (let i = 0; i < 30; i++) {
      await Bun.sleep(1000);
      if (await isOllamaRunning(baseUrl)) {
        log.info('Ollama started');
        return true;
      }
    }
    log.error('Ollama failed to start within 30 seconds');
    return false;
  } catch (e) {
    log.error(`Failed to start Ollama: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}
