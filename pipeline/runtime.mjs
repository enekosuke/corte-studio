import { execFile } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RequestError } from './errors.mjs';

// Resolución multiplataforma de herramientas externas: Python y fuentes empaquetadas.

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const fontsDir = fileURLToPath(new URL('./assets/fonts/', import.meta.url));

const validation = 'import sys; print(sys.version_info[:2])';
const cache = new Map();

/** Candidatos en orden de prioridad: variable de entorno, entornos virtuales del proyecto y el Python del sistema. */
export function pythonCandidates(env = process.env, platform = process.platform) {
  // En Windows `python3` suele ser un acceso directo de la Tienda o una versión distinta de la que tiene las dependencias
  // instaladas, así que allí se prueba antes `python`. En Linux y macOS manda `python3`.
  const names = platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  return [
    env.CORTE_PYTHON?.trim(),
    join(projectRoot, '.venv', 'bin', 'python'),
    join(projectRoot, '.venv', 'Scripts', 'python.exe'),
    ...names,
  ].filter(Boolean);
}

function runsPython(command) {
  return new Promise((resolve) => {
    execFile(command, ['-c', validation], { timeout: 8000, windowsHide: true }, (error, stdout) => {
      resolve(!error && /\(\s*3\s*,\s*\d+\s*\)/.test(String(stdout)));
    });
  });
}

async function usable(command) {
  const isPath = /[\\/]/.test(command);
  if (isPath) {
    try { await access(command); } catch { return false; }
  }
  return runsPython(command);
}

/**
 * Devuelve el primer intérprete de Python 3 que funciona. El resultado se guarda en caché por valor de CORTE_PYTHON.
 * Si ninguno responde lanza un error claro; `fallback` permite arrancar igualmente con el nombre clásico.
 */
export function resolvePython({ env = process.env, force = false } = {}) {
  const key = env.CORTE_PYTHON ?? '';
  if (!force && cache.has(key)) return cache.get(key);
  const pending = (async () => {
    for (const command of pythonCandidates(env)) {
      if (await usable(command)) return command;
    }
    throw new RequestError(503, 'No se encontró Python 3. Instálalo o indica su ruta en CORTE_PYTHON y reinicia el estudio.');
  })();
  cache.set(key, pending);
  pending.catch(() => cache.delete(key));
  return pending;
}

/** Python para módulos que necesitan un nombre ya resuelto al cargarse: nunca lanza. */
export async function pythonOrDefault() {
  return resolvePython().catch(() => process.env.CORTE_PYTHON?.trim() || (process.platform === 'win32' ? 'python' : 'python3'));
}

/** Carpeta de fuentes empaquetadas si contiene alguna fuente; null en caso contrario. */
export async function bundledFontsDir() {
  try {
    const names = await readdir(fontsDir);
    return names.some((name) => /\.(?:ttf|otf)$/i.test(name)) ? fontsDir : null;
  } catch {
    return null;
  }
}

/** Ruta de una fuente empaquetada concreta, o null si no está disponible. */
export async function bundledFont(fileName) {
  if (!/^[\w.-]+\.(?:ttf|otf)$/i.test(fileName)) return null;
  const path = join(fontsDir, fileName);
  return access(path).then(() => path, () => null);
}

/** Extiende PATH-like variables sin duplicar entradas. */
export function joinPaths(...entries) {
  return [...new Set(entries.flatMap((entry) => String(entry ?? '').split(delimiter)).filter(Boolean))].join(delimiter);
}
