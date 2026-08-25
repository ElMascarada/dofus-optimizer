import { readFile } from 'node:fs/promises';
import { validateSpellSnapshot } from '../js/data-loader.js';

const url = new URL('../data/normalized/spell-data.json', import.meta.url);
const snapshot = JSON.parse(await readFile(url, 'utf8'));
const catalog = validateSpellSnapshot(snapshot);
const report = catalog.supportReport;

console.log('SPELL_SUPPORT_REPORT_BEGIN');
console.log(JSON.stringify(report, null, 2));
console.log('SPELL_SUPPORT_REPORT_END');
