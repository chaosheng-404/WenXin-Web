import { access, readFile } from 'node:fs/promises';

const required = ['index.html', 'index.js', 'style.css', 'sw.js', 'site.webmanifest', 'vendor/purify.min.js', 'vendor/showdown.min.js', 'assets/fontawesome.min.css', 'assets/solid.min.css', 'assets/brands.min.css', 'webfonts/fa-solid-900.woff2'];
await Promise.all(required.map(file => access(file)));
const source = await readFile('index.js', 'utf8');
const styles = await readFile('style.css', 'utf8');
const forbidden = ["from '../../../../lib.js'", "from '../../../../script.js'", '$(document).ready(initialize)'];
for (const token of forbidden) {
    if (source.includes(token)) throw new Error(`仍包含 SillyTavern 启动依赖：${token}`);
}
for (const token of ['textIndent', 'undoWorkspace()', 'redoWorkspace()', 'historyControlsHtml()', "action === 'toggle-settings'"]) {
    if (!source.includes(token)) throw new Error(`缺少编辑器功能：${token}`);
}
if (!source.includes('!hasFocusedTextEntry()')) throw new Error('移动端软键盘打开时仍可能重建画布并导致输入框失焦。');
if (!styles.includes('.wx-layer.wx-layer-shape { pointer-events: auto;')) throw new Error('图形图层仍无法接收移动与缩放操作。');
new Function(source);
JSON.parse(await readFile('site.webmanifest', 'utf8'));
console.log('文心网页静态检查通过。');
