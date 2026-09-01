import { readFileSync, writeFileSync } from 'node:fs';
const engine = readFileSync('prototype/engine.js', 'utf8');
const tpl = readFileSync('prototype/app.template.html', 'utf8');
writeFileSync('prototype/ledger-prototype.html', tpl.replace('/*__ENGINE__*/', engine));
console.log('prototype/ledger-prototype.html');
