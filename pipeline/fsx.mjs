import { rename } from 'node:fs/promises';

// En Windows, renombrar sobre un archivo que otro proceso está leyendo o que el antivirus o el indexador acaban de tocar
// falla un instante con EPERM/EBUSY/EACCES. Las escrituras atómicas (escribir en .tmp y renombrar) lo reintentan unos
// milisegundos antes de rendirse.
export async function renameWithRetry(from, to, attempts = 8) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (error) {
      if (attempt >= attempts || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
    }
  }
}
