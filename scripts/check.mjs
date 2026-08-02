import { access, readFile } from 'node:fs/promises';

const required = ['index.html', 'index.js', 'style.css', 'sw.js', 'site.webmanifest', 'vendor/purify.min.js', 'vendor/showdown.min.js', 'assets/fontawesome.min.css', 'assets/solid.min.css', 'assets/brands.min.css', 'webfonts/fa-solid-900.woff2'];
await Promise.all(required.map(file => access(file)));
const source = await readFile('index.js', 'utf8');
const forbidden = ["from '../../../../lib.js'", "from '../../../../script.js'", '$(document).ready(initialize)'];
for (const token of forbidden) {
    if (source.includes(token)) throw new Error(`仍包含 SillyTavern 启动依赖：${token}`);
}
new Function(source);
JSON.parse(await readFile('site.webmanifest', 'utf8'));
console.log('文心网页静态检查通过。');
