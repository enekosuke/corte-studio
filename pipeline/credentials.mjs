import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export const credentialFile = new URL('../.corte-data/gemini.dpapi', import.meta.url);
export const openRouterCredentialFile = new URL('../.corte-data/openrouter.dpapi', import.meta.url);
export const geminiKeyPattern = /^[A-Za-z0-9_.-]{20,180}$/;

const prepare = "$null = [Reflection.Assembly]::LoadWithPartialName('System.Security'); $value = [Console]::In.ReadToEnd(); $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser;";
const protect = `${prepare} $bytes = [Text.Encoding]::UTF8.GetBytes($value); $encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope); [Console]::Write([Convert]::ToBase64String($encrypted))`;
const unprotect = `${prepare} $bytes = [Convert]::FromBase64String($value); $clear = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope); [Console]::Write([Text.Encoding]::UTF8.GetString($clear))`;

function windowsCredential(input, command) {
  if (process.platform !== 'win32') throw new Error('El almacén de credenciales local requiere Windows.');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; ${command}`,
    ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stdin.on('error', reject);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && output.trim()) resolve(output.trim());
      else reject(new Error('Windows no pudo abrir o proteger la credencial de Corte Studio.'));
    });
    child.stdin.end(input, 'utf8');
  });
}

export async function encryptGeminiKey(key) {
  if (!geminiKeyPattern.test(key)) throw new Error('La credencial no tiene un formato válido.');
  return windowsCredential(key, protect);
}

async function loadDpapiKey(file, envName) {
  let encrypted;
  try {
    encrypted = (await readFile(file, 'utf8')).trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const environmentKey = process.env[envName]?.trim() ?? '';
    return geminiKeyPattern.test(environmentKey) ? environmentKey : null;
  }
  const key = await windowsCredential(encrypted, unprotect);
  if (!geminiKeyPattern.test(key)) throw new Error('La credencial local de Corte Studio no es válida.');
  return key;
}

export function loadGeminiKey() {
  return loadDpapiKey(credentialFile, 'CORTE_GEMINI_API_KEY');
}

export function loadOpenRouterKey() {
  return loadDpapiKey(openRouterCredentialFile, 'CORTE_OPENROUTER_API_KEY');
}
