// Las pruebas nunca deben escribir en las carpetas reales del usuario (vídeos, marcas).
// Cada archivo de pruebas corre en su propio proceso, así que cada uno recibe su propia carpeta temporal.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sandbox = join(tmpdir(), 'corte-export-tests', String(process.pid));
mkdirSync(sandbox, { recursive: true });
process.env.CORTE_EXPORT_DIR = join(sandbox, 'Vídeos');
process.env.CORTE_EXPORT_INDEX = join(sandbox, 'index.json');
process.env.CORTE_BRANDS_FILE = join(sandbox, 'brands.json');
writeFileSync(process.env.CORTE_BRANDS_FILE, JSON.stringify({
  defaultBrandId: 'risawow',
  brands: [{ id: 'risawow', name: 'RisaWOW', handle: '@RisaWOW', showWatermark: true, accentHex: '#FFE600', defaultHashtags: ['#gameplay', '#clips'] }],
}));
