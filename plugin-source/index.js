import { DOMPurify, showdown } from '../../../../lib.js';
import { substituteParams } from '../../../../script.js';

const EXTENSION_NAME = '文心';
const DB_NAME = 'sillytavern-wenxin';
const DB_VERSION = 1;
const PAPER_PRESETS = {
    portrait: { label: '竖页', width: 720, height: 1080 },
    wide: { label: '宽页', width: 1080, height: 720 },
    square: { label: '方页', width: 900, height: 900 },
    landscape: { label: '横页', width: 1280, height: 720 },
    ultrawide: { label: '超宽', width: 1600, height: 640 },
};
const BUILT_IN_FONTS = Object.freeze([
    { id: 'builtin-huiwen-mincho', name: '汇文明朝', family: 'Huiwen-mincho', source: 'https://fontsapi.zeoseven.com/256/main/result.css', kind: 'css', builtIn: true },
    { id: 'builtin-kinghwa-old-song', name: '京华老宋', family: 'KingHwaOldSong', source: 'https://fontsapi.zeoseven.com/309/main/result.css', kind: 'css', builtIn: true },
    { id: 'builtin-lxgw-wenkai', name: '霞鹜文楷', family: 'LXGW WenKai', source: 'https://fontsapi.zeoseven.com/292/main/result.css', kind: 'css', builtIn: true },
    { id: 'builtin-zhuque-fangsong', name: '朱雀仿宋', family: 'Zhuque Fangsong (technical preview)', source: 'https://fontsapi.zeoseven.com/7/main/result.css', kind: 'css', builtIn: true },
]);
const SILLYTAVERN_FONT_FAMILY = 'var(--mainFontFamily)';
const BUILT_IN_GALLERY_VERSION = 2;
const BUILT_IN_GALLERY_FOLDER_ID = 'folder-builtin-gallery';
const BUILT_IN_GALLERY_IMAGES = Object.freeze([
    ['10', 'https://i.postimg.cc/2Sb80XS1/10.jpg'],
    ['11', 'https://i.postimg.cc/y8gYLr89/11.jpg'],
    ['12', 'https://i.postimg.cc/4x7NWFxV/12.jpg'],
    ['13', 'https://i.postimg.cc/wjyTwbjD/13.jpg'],
    ['14', 'https://i.postimg.cc/y8gYLr8F/14.jpg'],
    ['15', 'https://i.postimg.cc/qvhM1ZvX/15.jpg'],
    ['16', 'https://i.postimg.cc/L8Y6x08D/16.jpg'],
    ['17', 'https://i.postimg.cc/8zJPZnzw/17.jpg'],
    ['18', 'https://i.postimg.cc/4x7NWFxB/18.jpg'],
    ['19', 'https://i.postimg.cc/K8kv0s8q/19.jpg'],
    ['23', 'https://i.postimg.cc/zGsD6Syn/23.jpg'],
    ['5', 'https://i.postimg.cc/bwDNmFwD/5.jpg'],
    ['7', 'https://i.postimg.cc/YCGqdyCj/7.jpg'],
    ['8', 'https://i.postimg.cc/T3LYtH3y/8.jpg'],
]);
const converter = new showdown.Converter({ simpleLineBreaks: true, strikethrough: true, tables: true });

let db;
let state;
let dialog;
let currentView = 'library';
let workspace = createWorkspace();
let selectedLayerId = null;
let selectionText = '';
let saveTimer;
let assetPickerCallback;
let activeBookletId = null;
let activeBookPageId = null;
let inspectorOpen = false;
let pendingConfirmAction = null;
let paperChoiceCallback = null;
let cropDraft = null;
let cropTarget = null;
let mergeSelection = null;
let composerSessionActive = false;
let pendingComposerLeaveAction = null;
let bookReaderResizeObserver = null;
let pendingTemplateWorkspace = null;
const stageViewStates = new WeakMap();
const activeTagFilters = { gallery: null, template: null, booklet: null };
const activeFolderIds = { gallery: null, template: null };
const TAG_SCOPE_LABELS = { gallery: '图库', template: '模板库', booklet: '册子' };
const SMART_TEXT_DEFINITIONS = Object.freeze({
    char: { macro: '{{char}}', name: '角色名' },
    user: { macro: '{{user}}', name: '用户名' },
    date: { macro: '{{date}}', name: '日期' },
    time: { macro: '{{time}}', name: '时间' },
});
const TEXT_STYLE_PRESETS = Object.freeze({
    heading1: { label: '标题 1', fontSize: 64, fontWeight: 800, lineHeight: 1.18 },
    heading2: { label: '标题 2', fontSize: 52, fontWeight: 750, lineHeight: 1.22 },
    heading3: { label: '标题 3', fontSize: 42, fontWeight: 700, lineHeight: 1.28 },
    body: { label: '正文', fontSize: 30, fontWeight: 400, lineHeight: 1.55 },
});
const READER_TRANSITIONS = Object.freeze({
    none: '无效果',
    smooth: '平滑',
    simulation: '仿真翻页',
    fade: '渐变',
    zoom: '缩放',
});
const templatePreviewCache = new Map();
const bookletPreviewCache = new Map();
const bookReaderThumbnailCache = new WeakMap();

function uid(prefix = 'wx') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clone(value) {
    return structuredClone(value);
}

function createWorkspace(width = 720, height = 1080) {
    return { version: 1, width, height, background: '#f5efe5', backgroundOpacity: 1, layers: [] };
}

function defaultState() {
    return {
        version: 1,
        library: [],
        fonts: [],
        images: [],
        folders: [],
        tags: [],
        templates: [],
        booklets: [],
        preferences: { lastView: 'library', readerTransition: 'simulation', builtInGalleryVersion: 0 },
    };
}

function escapeHtml(value) {
    const node = document.createElement('div');
    node.textContent = String(value ?? '');
    return node.innerHTML;
}

function markdown(value) {
    return DOMPurify.sanitize(converter.makeHtml(String(value ?? '')), {
        FORBID_TAGS: ['style', 'script', 'iframe', 'object'],
        FORBID_ATTR: ['style', 'onerror', 'onclick'],
    });
}

function resolvedFontFamily(fontFamily) {
    if (fontFamily !== SILLYTAVERN_FONT_FAMILY) return fontFamily || 'serif';
    return getComputedStyle(document.documentElement).getPropertyValue('--mainFontFamily').trim() || 'sans-serif';
}

function applyMaskRules(value, rules = []) {
    let output = String(value ?? '');
    for (const rule of rules) {
        if (!rule?.target || !output.includes(rule.target)) continue;
        const length = Math.max(2, [...rule.target].length);
        const replacement = rule.style === 'dots' ? '•'.repeat(length) : rule.style === 'blocks' ? '■'.repeat(length) : '█'.repeat(length);
        output = output.split(rule.target).join(replacement);
    }
    return output;
}

function smartTextDefinition(layer) {
    if (layer?.type !== 'text') return null;
    if (Object.hasOwn(SMART_TEXT_DEFINITIONS, layer.smartTextKind)) return [layer.smartTextKind, SMART_TEXT_DEFINITIONS[layer.smartTextKind]];
    const macroMatch = Object.entries(SMART_TEXT_DEFINITIONS).find(([, definition]) => definition.macro === layer.smartTextMacro);
    if (macroMatch) return macroMatch;
    return Object.entries(SMART_TEXT_DEFINITIONS).find(([, definition]) => definition.name === layer.name) || null;
}

function resolveSmartTextLayer(layer) {
    const match = smartTextDefinition(layer);
    if (!match) return false;
    const [kind, definition] = match;
    layer.smartTextKind = kind;
    layer.smartTextMacro = definition.macro;
    layer.content = substituteParams(definition.macro) || definition.macro;
    return true;
}

function resolveWorkspaceSmartText(sourceWorkspace) {
    sourceWorkspace?.layers?.forEach(resolveSmartTextLayer);
    return sourceWorkspace;
}

function templateWorkspace(template) {
    return resolveWorkspaceSmartText(clone(template.workspace));
}

function formatTime(value) {
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(value);
}

function notify(message, type = 'success') {
    let stack = dialog?.querySelector('.wx-toast-stack');
    if (!stack) {
        stack = document.createElement('div');
        stack.className = 'wx-toast-stack';
        (dialog?.querySelector('.wx-shell') || document.body).append(stack);
    }
    const toast = document.createElement('div');
    toast.className = `wx-toast is-${type}`;
    toast.innerHTML = `<i class="fa-solid ${type === 'error' ? 'fa-circle-exclamation' : type === 'warning' ? 'fa-triangle-exclamation' : type === 'info' ? 'fa-circle-info' : 'fa-circle-check'}"></i><span>${escapeHtml(message)}</span>`;
    stack.append(toast);
    setTimeout(() => toast.classList.add('is-leaving'), 2800);
    setTimeout(() => toast.remove(), 3200);
}

async function openDatabase() {
    if (db) return db;
    db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => request.result.createObjectStore('data');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    return db;
}

async function loadState() {
    const database = await openDatabase();
    const saved = await new Promise((resolve, reject) => {
        const request = database.transaction('data').objectStore('data').get('state');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    state = { ...defaultState(), ...(saved || {}) };
    state.preferences = { ...defaultState().preferences, ...(saved?.preferences || {}) };
    for (const key of ['library', 'fonts', 'images', 'folders', 'tags', 'templates', 'booklets']) {
        if (!Array.isArray(state[key])) state[key] = [];
    }
    migrateLegacyTags();
    if (seedBuiltInGallery()) await persistState();
    if (state.preferences.composerDraft?.layers) {
        workspace = clone(state.preferences.composerDraft);
        composerSessionActive = true;
    }
    currentView = state.preferences?.lastView || 'library';
    if (currentView === 'booklet-editor') currentView = 'booklets';
    applyFonts();
}

function seedBuiltInGallery() {
    const installedVersion = Number(state.preferences.builtInGalleryVersion) || 0;
    if (installedVersion >= BUILT_IN_GALLERY_VERSION) return false;
    const shouldSeedMissingImages = installedVersion < 1;
    if (shouldSeedMissingImages && !state.folders.some(folder => folder.id === BUILT_IN_GALLERY_FOLDER_ID)) {
        state.folders.push({ id: BUILT_IN_GALLERY_FOLDER_ID, kind: 'gallery', name: '内置图库', tagIds: [], builtIn: true });
    }
    const existingSources = new Set(state.images.map(image => image.source));
    const seededAt = Date.now();
    for (const [name, source] of BUILT_IN_GALLERY_IMAGES) {
        const existingImage = state.images.find(image => image.id === `builtin-image-${name}`);
        if (existingImage) {
            existingImage.source = source;
            continue;
        }
        if (!shouldSeedMissingImages) continue;
        if (existingSources.has(source)) continue;
        state.images.push({
            id: `builtin-image-${name}`,
            name: `内置素材 ${name}`,
            source,
            folderId: BUILT_IN_GALLERY_FOLDER_ID,
            tagIds: [],
            builtIn: true,
            createdAt: seededAt,
        });
    }
    state.preferences.builtInGalleryVersion = BUILT_IN_GALLERY_VERSION;
    return true;
}

function migrateLegacyTags() {
    const legacyTags = state.tags.filter(tag => !tag.kind);
    if (!legacyTags.length) return;
    const scopedTags = state.tags.filter(tag => tag.kind);
    const idMap = new Map();
    for (const tag of legacyTags) {
        const scopeMap = {};
        for (const scope of Object.keys(TAG_SCOPE_LABELS)) {
            let scoped = scopedTags.find(item => item.kind === scope && item.name === tag.name);
            if (!scoped) {
                scoped = { id: uid('tag'), name: tag.name, kind: scope };
                scopedTags.push(scoped);
            }
            scopeMap[scope] = scoped.id;
        }
        idMap.set(tag.id, scopeMap);
    }
    const remap = (items, scopeOf) => items.forEach(item => {
        const scope = scopeOf(item);
        item.tagIds = [...new Set((item.tagIds || []).map(id => idMap.get(id)?.[scope] || id).filter(id => scopedTags.some(tag => tag.id === id && tag.kind === scope)))];
    });
    remap(state.folders, item => item.kind);
    remap(state.images, () => 'gallery');
    remap(state.templates, () => 'template');
    remap(state.booklets, () => 'booklet');
    state.tags = scopedTags;
}

async function persistState() {
    clearTimeout(saveTimer);
    const database = await openDatabase();
    await new Promise((resolve, reject) => {
        const transaction = database.transaction('data', 'readwrite');
        transaction.objectStore('data').put(state, 'state');
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
    });
}

function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persistState().catch(error => notify(error.message, 'error')), 250);
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function applyFonts() {
    document.querySelectorAll('[data-wx-font]').forEach(element => element.remove());
    for (const font of [...BUILT_IN_FONTS, ...(state?.fonts || [])]) {
        if (font.kind === 'css') {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = font.source;
            link.dataset.wxFont = font.id;
            document.head.append(link);
        } else {
            const style = document.createElement('style');
            style.dataset.wxFont = font.id;
            style.textContent = `@font-face{font-family:${JSON.stringify(font.family)};src:url(${JSON.stringify(font.source)})}`;
            document.head.append(style);
        }
    }
}

function createDialog() {
    dialog = document.createElement('dialog');
    dialog.id = 'wx-app';
    dialog.className = 'wx-app';
    dialog.innerHTML = `
        <div class="wx-shell">
            <header class="wx-header">
                <button class="wx-brand" data-action="home" aria-label="文心首页"><span>文</span><strong>文心</strong></button>
                <nav class="wx-nav" aria-label="主要功能">
                    ${navButton('library', 'fa-book-open', '文库')}
                    ${navButton('gallery', 'fa-images', '图库')}
                    ${navButton('composer', 'fa-pen-ruler', '排版')}
                    ${navButton('templates', 'fa-layer-group', '模板库')}
                    ${navButton('booklets', 'fa-book', '册子')}
                </nav>
                <button class="wx-icon-button" data-action="close" title="关闭"><i class="fa-solid fa-xmark"></i></button>
            </header>
            <main id="wx-content" class="wx-content"></main>
            <div id="wx-overlay" class="wx-overlay" hidden></div>
        </div>`;
    document.body.append(dialog);
    dialog.addEventListener('click', handleClick);
    dialog.addEventListener('input', handleInput);
    dialog.addEventListener('change', handleChange);
    dialog.addEventListener('keydown', event => {
        if (event.key === 'Enter' && event.target.matches('.wx-hex-color')) {
            event.preventDefault();
            applyHexInput(event.target);
        } else if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.wx-folder[data-action="open-folder"]')) {
            event.preventDefault();
            activeFolderIds[event.target.dataset.kind] = event.target.dataset.id || null;
            render();
        }
    });
    dialog.addEventListener('dragstart', handleDragStart);
    dialog.addEventListener('dragover', event => event.preventDefault());
    dialog.addEventListener('drop', handleDrop);
    document.addEventListener('fullscreenchange', handleBookReaderFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleBookReaderFullscreenChange);
    dialog.addEventListener('cancel', event => {
        event.preventDefault();
        if (mergeSelection) return cancelMergeSelection();
        const overlay = dialog.querySelector('#wx-overlay');
        if (overlay && !overlay.hidden) closeOverlay();
        else closeApp();
    });
}

function navButton(view, icon, label) {
    return `<button data-view="${view}" title="${label}"><i class="fa-solid ${icon}"></i><span>${label}</span></button>`;
}

async function openApp(view = currentView) {
    if (!state) await loadState();
    if (!dialog) createDialog();
    dialog.showModal();
    navigateToView(view);
}

function closeApp() {
    if (currentView === 'composer' && composerSessionActive) {
        requestComposerLeave(closeAppImmediately);
        return;
    }
    closeAppImmediately();
}

function closeAppImmediately() {
    mergeSelection = null;
    closeOverlay();
    dialog?.close();
}

function navigateToView(view) {
    mergeSelection = null;
    const overlay = dialog?.querySelector('#wx-overlay');
    if (overlay && !overlay.hidden && overlay.dataset.overlayKind === 'paper' && overlay.dataset.overlayOwner !== view) closeOverlay();
    if (view === 'composer' && !composerSessionActive && state.preferences.composerDraft?.layers) {
        workspace = clone(state.preferences.composerDraft);
        composerSessionActive = true;
    }
    currentView = view;
    render();
    if (view === 'composer' && !composerSessionActive) paperModal();
}

function requestComposerLeave(onLeave) {
    if (!composerSessionActive) return onLeave();
    pendingComposerLeaveAction = onLeave;
    showOverlay('是否暂存当前排版？', `<div class="wx-confirm-message"><i class="fa-solid fa-box-archive"></i><div><p>暂存后可切换到文库、图库、模板库或册子，返回排版页时继续编辑。</p><small>选择“不保存”会清除当前画布，下次进入排版时重新选择纸张。</small></div></div>`, `<button class="wx-button wx-quiet" data-action="close-overlay">取消</button><button class="wx-button wx-danger-button" data-action="leave-composer-discard">不保存</button><button class="wx-button" data-action="leave-composer-save">暂存并离开</button>`);
}

function finishComposerLeave(shouldSave) {
    const onLeave = pendingComposerLeaveAction;
    pendingComposerLeaveAction = null;
    if (shouldSave) {
        state.preferences.composerDraft = clone(workspace);
    } else {
        stageViewStates.delete(workspace);
        workspace = createWorkspace();
        composerSessionActive = false;
        delete state.preferences.composerDraft;
        selectedLayerId = null;
        inspectorOpen = false;
    }
    scheduleSave();
    closeOverlay();
    onLeave?.();
}

function render() {
    if (!dialog) return;
    dialog.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('is-active', button.dataset.view === currentView));
    const content = dialog.querySelector('#wx-content');
    const renderers = { library: renderLibrary, gallery: renderGallery, composer: renderComposer, templates: renderTemplates, booklets: renderBooklets, 'booklet-editor': renderBookletComposer };
    content.innerHTML = renderers[currentView]?.() || renderLibrary();
    state.preferences.lastView = currentView;
    scheduleSave();
    if (currentView === 'composer' || currentView === 'booklet-editor') {
        renderStage();
        renderInspector();
    }
    if (currentView === 'templates') renderTemplatePreviews();
    if (currentView === 'booklets') renderBookletPreviews();
}

function pageHeader(title, subtitle, actions = '') {
    return `<div class="wx-page-head"><div><p class="wx-eyebrow">WENXIN STUDIO</p><h1>${title}</h1><p>${subtitle}</p></div><div class="wx-page-actions">${actions}</div></div>`;
}

function renderLibrary() {
    const cards = state.library.map(item => `
        <article class="wx-quote-card" data-id="${item.id}">
            <label class="wx-check"><input type="checkbox" data-select-quote="${item.id}"><span></span></label>
            <blockquote>${escapeHtml(item.text)}</blockquote>
            <footer><span>${formatTime(item.updatedAt || item.createdAt)}</span><div>
                <button data-action="edit-quote" data-id="${item.id}">编辑</button>
                <button data-action="compose-quote" data-id="${item.id}">排版</button>
                <button class="wx-danger" data-action="delete-quote" data-id="${item.id}" title="删除"><i class="fa-solid fa-trash"></i></button>
            </div></footer>
        </article>`).join('');
    return `<section class="wx-page">
        ${pageHeader('文库', '把聊天里值得留下的句子，收进自己的文字标本册。', `
            <button class="wx-button wx-quiet" data-action="fonts"><i class="fa-solid fa-font"></i> 字体库</button>
            <button class="wx-button" data-action="new-quote"><i class="fa-solid fa-plus"></i> 新建摘录</button>`)}
        <div class="wx-library-tools"><label class="wx-search"><i class="fa-solid fa-magnifying-glass"></i><input id="wx-library-search" placeholder="搜索文库"></label><button data-action="compose-selected">排版所选</button></div>
        <div class="wx-card-grid" id="wx-library-grid">${cards || emptyState('fa-book-open', '文库还是空的', '在聊天中选中文字，或新建一条摘录。')}</div>
    </section>`;
}

function emptyState(icon, title, text) {
    return `<div class="wx-empty"><i class="fa-solid ${icon}"></i><strong>${title}</strong><span>${text}</span></div>`;
}

function folderOptions(kind, selected = '') {
    const folders = state.folders.filter(folder => folder.kind === kind);
    return `<option value="">未分类</option>${folders.map(folder => `<option value="${folder.id}" ${folder.id === selected ? 'selected' : ''}>${escapeHtml(folder.name)}</option>`).join('')}`;
}

function tagsForScope(scope) {
    return state.tags.filter(tag => tag.kind === scope);
}

function tagOptions(selectedIds = [], scope = 'gallery') {
    return tagsForScope(scope).map(tag => `<label class="wx-tag-option"><input type="checkbox" value="${tag.id}" ${selectedIds.includes(tag.id) ? 'checked' : ''}><span>${escapeHtml(tag.name)}</span></label>`).join('') || `<p class="wx-hint">${TAG_SCOPE_LABELS[scope]}还没有标签，可稍后在本页“标签管理”中创建。</p>`;
}

function tagBadges(tagIds = []) {
    return tagIds.map(id => state.tags.find(tag => tag.id === id)).filter(Boolean).map(tag => `<span class="wx-tag-badge">${escapeHtml(tag.name)}</span>`).join('');
}

function tagFilterBar(kind) {
    const active = activeTagFilters[kind];
    return `<div class="wx-tag-filter"><button class="${!active ? 'is-active' : ''}" data-action="filter-tag" data-kind="${kind}" data-id="">全部 <small>${tagScopeItems(kind).length}</small></button>${tagsForScope(kind).map(tag => `<button class="${active === tag.id ? 'is-active' : ''}" data-action="filter-tag" data-kind="${kind}" data-id="${tag.id}">${escapeHtml(tag.name)} <small>${tagUsageCount(tag.id, kind)}</small></button>`).join('')}</div>`;
}

function matchesTagFilter(item, kind) {
    const tagId = activeTagFilters[kind];
    return !tagId || (item.tagIds || []).includes(tagId);
}

function currentFolder(kind) {
    const id = activeFolderIds[kind];
    const folder = state.folders.find(item => item.id === id && item.kind === kind);
    if (!folder) activeFolderIds[kind] = null;
    return folder || null;
}

function folderMatchesFilter(folder, kind, collection) {
    return matchesTagFilter(folder, kind) || collection.some(item => item.folderId === folder.id && matchesTagFilter(item, kind));
}

function folderBreadcrumb(kind, folder) {
    if (!folder) return '';
    const rootLabel = kind === 'gallery' ? '图库根目录' : '模板库根目录';
    return `<nav class="wx-folder-breadcrumb" aria-label="文件夹路径">
        <button data-action="open-folder" data-kind="${kind}" data-id="" data-folder-drop="" title="返回${rootLabel}"><i class="fa-solid fa-house"></i> ${rootLabel}</button>
        <i class="fa-solid fa-chevron-right"></i><span><i class="fa-solid fa-folder-open"></i> ${escapeHtml(folder.name)}</span>
    </nav>`;
}

function renderGallery() {
    const folder = currentFolder('gallery');
    const folders = folder ? [] : state.folders.filter(item => item.kind === 'gallery' && folderMatchesFilter(item, 'gallery', state.images));
    const folderCards = folders.map(item => `<article class="wx-folder" draggable="true" data-drag-kind="folder" data-action="open-folder" data-kind="gallery" data-id="${item.id}" tabindex="0"><i class="fa-solid fa-folder"></i><strong>${escapeHtml(item.name)}</strong><span>${state.images.filter(image => image.folderId === item.id).length} 张</span><div class="wx-card-tags">${tagBadges(item.tagIds)}</div><button class="wx-folder-tags" data-action="assign-tags" data-kind="folder" data-id="${item.id}" title="设置标签"><i class="fa-solid fa-tags"></i></button><button data-action="delete-folder" data-id="${item.id}" title="删除文件夹"><i class="fa-solid fa-xmark"></i></button></article>`).join('');
    const images = state.images.filter(image => (image.folderId || null) === (folder?.id || null) && matchesTagFilter(image, 'gallery')).map(image => `<article class="wx-image-card" draggable="true" data-drag-kind="image" data-id="${image.id}">
        <img src="${escapeHtml(image.source)}" alt="${escapeHtml(image.name)}"><div><strong>${escapeHtml(image.name)}</strong><span>${escapeHtml(state.folders.find(folder => folder.id === image.folderId)?.name || '未分类')}</span><div class="wx-card-tags">${tagBadges(image.tagIds)}</div></div>
        <button class="wx-image-tags" data-action="assign-tags" data-kind="image" data-id="${image.id}" title="设置标签"><i class="fa-solid fa-tags"></i></button><button data-action="delete-image" data-id="${image.id}" title="删除"><i class="fa-solid fa-trash"></i></button></article>`).join('');
    return `<section class="wx-page">
        ${pageHeader('图库', '集中管理背景、贴纸与打码素材，排版时随时调用。', `
            <button class="wx-button wx-quiet" data-action="new-folder" data-kind="gallery"><i class="fa-solid fa-folder-plus"></i> 文件夹</button>
            <button class="wx-button wx-quiet" data-action="manage-tags"><i class="fa-solid fa-tags"></i> 标签管理</button>
            <button class="wx-button" data-action="add-image"><i class="fa-solid fa-plus"></i> 导入图片</button>`)}
        ${tagFilterBar('gallery')}
        ${folderBreadcrumb('gallery', folder)}
        ${folderCards ? `<div class="wx-folder-row">${folderCards}</div>` : ''}
        <div class="wx-image-grid">${images || emptyState('fa-images', folder ? '这个文件夹还是空的' : '根目录没有图片', folder ? '可将图片拖入此文件夹，或导入图片时选择它。' : '打开文件夹查看其中图片，或导入未分类图片。')}</div>
    </section>`;
}

function renderComposer() {
    return `<section class="wx-composer">
        <div class="wx-composer-top">
            <div><button class="wx-back-button" data-action="exit-composer" title="返回"><i class="fa-solid fa-arrow-left"></i><span>返回</span></button><strong>自由排版</strong><span>${workspace.width} × ${workspace.height}px</span></div>
            <div><button data-action="undo-reset" title="清空画布"><i class="fa-solid fa-rotate-left"></i></button><button data-action="toggle-settings" title="画布设置"><i class="fa-solid fa-gear"></i></button></div>
        </div>
        <div class="wx-editor ${inspectorOpen ? 'has-inspector' : ''}">
            <div class="wx-stage-scroll"><div id="wx-stage-wrap" class="wx-stage-wrap"><div id="wx-stage" class="wx-stage"></div></div><button class="wx-stage-view-control" data-action="reset-stage-view" title="适应屏幕"><i class="fa-solid fa-expand"></i><span class="wx-stage-zoom-value">100%</span></button></div>
            <aside id="wx-inspector" class="wx-inspector ${inspectorOpen ? 'is-open' : ''}"></aside>
        </div>
        ${composerToolbar()}
    </section>`;
}

function composerToolbar(extra = '') {
    return `<div class="wx-toolbar" role="toolbar">
            <button data-action="add-text"><i class="fa-solid fa-font"></i><span>文字</span></button>
            <button data-action="add-from-library"><i class="fa-solid fa-book-open"></i><span>文库</span></button>
            <button data-action="composer-template"><i class="fa-solid fa-layer-group"></i><span>模板库</span></button>
            <button data-action="add-from-gallery"><i class="fa-solid fa-image"></i><span>图片</span></button>
            <button data-action="add-shape"><i class="fa-solid fa-shapes"></i><span>图形</span></button>
            <button data-action="add-mask"><i class="fa-solid fa-user-secret"></i><span>打码</span></button>
            <button data-action="layer-down"><i class="fa-solid fa-arrow-down"></i><span>下移</span></button>
            <button data-action="layer-up"><i class="fa-solid fa-arrow-up"></i><span>上移</span></button>
            <button data-action="delete-layer"><i class="fa-solid fa-trash"></i><span>删除</span></button>
            ${extra || '<button class="wx-toolbar-primary" data-action="export-menu"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></button>'}
        </div>`;
}

function renderTemplates() {
    const folder = currentFolder('template');
    const folders = folder ? [] : state.folders.filter(item => item.kind === 'template' && folderMatchesFilter(item, 'template', state.templates));
    const trees = folders.map(item => `<article class="wx-folder" draggable="true" data-drag-kind="folder" data-action="open-folder" data-kind="template" data-id="${item.id}" tabindex="0"><i class="fa-solid fa-folder"></i><strong>${escapeHtml(item.name)}</strong><span>${state.templates.filter(template => template.folderId === item.id).length} 个</span><div class="wx-card-tags">${tagBadges(item.tagIds)}</div><button class="wx-folder-tags" data-action="assign-tags" data-kind="folder" data-id="${item.id}" title="设置标签"><i class="fa-solid fa-tags"></i></button><button data-action="delete-folder" data-id="${item.id}"><i class="fa-solid fa-xmark"></i></button></article>`).join('');
    const templates = state.templates.filter(template => (template.folderId || null) === (folder?.id || null) && matchesTagFilter(template, 'template')).map(template => `<article class="wx-template-card" draggable="true" data-drag-kind="template" data-id="${template.id}">
        <label class="wx-check"><input type="checkbox" data-select-template="${template.id}"><span></span></label>
        <div class="wx-template-preview" data-template-preview="${template.id}" style="--ratio:${template.workspace.width}/${template.workspace.height};background:${colorWithOpacity(template.workspace.background, template.workspace.backgroundOpacity ?? 1)}" aria-label="${escapeHtml(template.name)}预览"><i class="fa-solid fa-spinner fa-spin"></i></div>
        <div><strong>${escapeHtml(template.name)}</strong><span>${template.workspace.width} × ${template.workspace.height}</span><div class="wx-card-tags">${tagBadges(template.tagIds)}</div></div>
        <button class="wx-template-tags" data-action="assign-tags" data-kind="template" data-id="${template.id}" title="设置标签"><i class="fa-solid fa-tags"></i></button>
        <footer><button data-action="use-template" data-id="${template.id}">使用</button><button data-action="export-template" data-id="${template.id}">导出</button><button class="wx-danger" data-action="delete-template" data-id="${template.id}"><i class="fa-solid fa-trash"></i></button></footer>
    </article>`).join('');
    return `<section class="wx-page">
        ${pageHeader('模板库', '模板只保存排版结构与字体名称，方便交换和复用。', `
            <button class="wx-button wx-quiet" data-action="new-folder" data-kind="template"><i class="fa-solid fa-folder-plus"></i> 文件夹</button>
            <button class="wx-button wx-quiet" data-action="manage-tags"><i class="fa-solid fa-tags"></i> 标签管理</button>
            <button class="wx-button wx-quiet" data-action="import-template"><i class="fa-solid fa-file-import"></i> 导入</button>
            <button class="wx-button wx-danger-button" data-action="delete-selected-templates"><i class="fa-solid fa-trash"></i> 批量删除</button>`)}
        ${tagFilterBar('template')}${folderBreadcrumb('template', folder)}${trees ? `<div class="wx-folder-row">${trees}</div>` : ''}<div class="wx-template-grid">${templates || emptyState('fa-layer-group', folder ? '这个文件夹还是空的' : '根目录没有模板', folder ? '保存模板时可选择这个文件夹。' : '打开文件夹查看其中模板，或保存未分类模板。')}</div>
    </section>`;
}

async function renderTemplatePreviews() {
    const previews = [...dialog.querySelectorAll('[data-template-preview]')];
    for (const preview of previews) {
        const id = preview.dataset.templatePreview;
        const cached = templatePreviewCache.get(id);
        if (cached) {
            preview.innerHTML = `<img src="${cached}" alt="模板预览">`;
            continue;
        }
        const template = state.templates.find(item => item.id === id);
        if (!template) continue;
        try {
            const full = await workspaceToCanvas(template.workspace);
            const scale = Math.min(1, 420 / Math.max(full.width, full.height));
            const thumbnail = document.createElement('canvas');
            thumbnail.width = Math.max(1, Math.round(full.width * scale));
            thumbnail.height = Math.max(1, Math.round(full.height * scale));
            thumbnail.getContext('2d').drawImage(full, 0, 0, thumbnail.width, thumbnail.height);
            const source = thumbnail.toDataURL('image/png');
            templatePreviewCache.set(id, source);
            if (preview.isConnected) preview.innerHTML = `<img src="${source}" alt="${escapeHtml(template.name)}预览">`;
        } catch (error) {
            if (preview.isConnected) {
                preview.classList.add('is-error');
                preview.innerHTML = '<i class="fa-solid fa-image"></i><span>预览不可用</span>';
            }
        }
    }
}

function renderBooklets() {
    const cards = state.booklets.filter(booklet => matchesTagFilter(booklet, 'booklet')).map(booklet => {
        normaliseBookletPages(booklet);
        const firstPage = booklet.pages[0];
        const firstWorkspace = firstPage?.workspace;
        return `<article class="wx-book-card" data-id="${booklet.id}">
        <div class="wx-template-preview wx-book-preview" ${firstWorkspace ? `data-booklet-preview="${booklet.id}"` : ''} aria-label="${escapeHtml(booklet.name)}第一页预览"><i class="fa-solid ${firstWorkspace ? 'fa-spinner fa-spin' : 'fa-book-open'}"></i><span>${booklet.pages.length} 页</span></div>
        <div><strong>${escapeHtml(booklet.name)}</strong><span>${formatTime(booklet.updatedAt || booklet.createdAt)}</span><div class="wx-card-tags">${tagBadges(booklet.tagIds)}</div></div>
        <button class="wx-book-tags" data-action="assign-tags" data-kind="booklet" data-id="${booklet.id}" title="设置标签"><i class="fa-solid fa-tags"></i></button>
        <footer><button data-action="view-booklet" data-id="${booklet.id}"><i class="fa-solid fa-book-open-reader"></i> 阅览</button><button data-action="edit-booklet" data-id="${booklet.id}">编辑</button><button data-action="export-booklet-json" data-id="${booklet.id}" title="导出 JSON"><i class="fa-solid fa-file-export"></i></button><button class="wx-danger" data-action="delete-booklet" data-id="${booklet.id}"><i class="fa-solid fa-trash"></i></button></footer>
    </article>`;
    }).join('');
    return `<section class="wx-page">
        ${pageHeader('册子', '把模板成品和图片拼成册，可逐页导图或合成 PDF。', `<button class="wx-button wx-quiet" data-action="manage-tags"><i class="fa-solid fa-tags"></i> 标签管理</button><button class="wx-button wx-quiet" data-action="import-booklet-json"><i class="fa-solid fa-file-import"></i> 导入册子</button><button class="wx-button" data-action="new-booklet"><i class="fa-solid fa-plus"></i> 新建册子</button>`)}
        ${tagFilterBar('booklet')}
        <div class="wx-book-grid">${cards || emptyState('fa-book', '书架还是空的', '新建一本册子，开始拼页。')}</div>
    </section>`;
}

async function renderBookletPreviews() {
    const previews = [...dialog.querySelectorAll('[data-booklet-preview]')];
    for (const preview of previews) {
        const id = preview.dataset.bookletPreview;
        const booklet = state.booklets.find(item => item.id === id);
        const firstWorkspace = booklet?.pages[0]?.workspace;
        if (!booklet || !firstWorkspace) continue;
        const pageCount = `<span>${booklet.pages.length} 页</span>`;
        const cached = bookletPreviewCache.get(id);
        if (cached) {
            preview.innerHTML = `<img src="${cached}" alt="${escapeHtml(booklet.name)}第一页预览">${pageCount}`;
            continue;
        }
        try {
            const full = await workspaceToCanvas(firstWorkspace);
            const scale = Math.min(1, 420 / Math.max(full.width, full.height));
            const thumbnail = document.createElement('canvas');
            thumbnail.width = Math.max(1, Math.round(full.width * scale));
            thumbnail.height = Math.max(1, Math.round(full.height * scale));
            thumbnail.getContext('2d').drawImage(full, 0, 0, thumbnail.width, thumbnail.height);
            const source = thumbnail.toDataURL('image/png');
            bookletPreviewCache.set(id, source);
            if (preview.isConnected) preview.innerHTML = `<img src="${source}" alt="${escapeHtml(booklet.name)}第一页预览">${pageCount}`;
        } catch (error) {
            if (preview.isConnected) {
                preview.classList.add('is-error');
                preview.innerHTML = `<i class="fa-solid fa-image"></i><small>预览不可用</small>${pageCount}`;
            }
        }
    }
}

function getActiveBooklet() {
    return state.booklets.find(booklet => booklet.id === activeBookletId);
}

function imagePageWorkspace(page) {
    const pageWorkspace = createWorkspace();
    const layer = {
        id: uid('image'), type: 'image', name: page.name || '图片', source: page.source, imageId: null,
        x: 0, y: 0, width: pageWorkspace.width, height: pageWorkspace.height, z: 1, opacity: 1,
        rotation: 0, fit: 'contain', align: 'center', cropX: 50, cropY: 50, cropZoom: 1, borderWidth: 0, borderStyle: 'solid', borderColor: '#332b26', borderOpacity: 1, borderRadius: 0, visible: true,
    };
    pageWorkspace.layers.push(layer);
    return pageWorkspace;
}

function normaliseBookletPages(booklet) {
    for (const page of booklet.pages) {
        if (page.kind === 'image') {
            page.workspace = imagePageWorkspace(page);
            page.kind = 'workspace';
            delete page.source;
        }
    }
}

function renderBookletComposer() {
    const booklet = getActiveBooklet();
    if (!booklet) {
        currentView = 'booklets';
        return renderBooklets();
    }
    normaliseBookletPages(booklet);
    const activePage = booklet.pages.find(page => page.id === activeBookPageId) || booklet.pages[0];
    if (activePage && activePage.id !== activeBookPageId) {
        activeBookPageId = activePage.id;
        workspace = activePage.workspace;
    }
    const pageRail = booklet.pages.map((page, index) => `<article class="wx-book-page-tab ${page.id === activeBookPageId ? 'is-active' : ''}" draggable="true" data-drag-kind="book-page" data-id="${page.id}">
        <button data-action="select-book-page" data-id="${page.id}"><span>${index + 1}</span><div style="background:${colorWithOpacity(page.workspace.background, page.workspace.backgroundOpacity ?? 1)}"><i class="fa-solid fa-file-lines"></i></div><strong>${escapeHtml(page.name || `第 ${index + 1} 页`)}</strong></button>
        <button class="wx-page-to-template" data-action="book-page-to-template" data-id="${page.id}" title="添加本页到模板库" aria-label="添加本页到模板库"><i class="fa-solid fa-layer-group"></i></button>
        <button class="wx-page-delete" data-action="delete-book-page" data-id="${page.id}" title="删除本页"><i class="fa-solid fa-xmark"></i></button>
    </article>`).join('');
    const editor = activePage ? `<div class="wx-editor ${inspectorOpen ? 'has-inspector' : ''}"><div class="wx-stage-scroll"><div id="wx-stage-wrap" class="wx-stage-wrap"><div id="wx-stage" class="wx-stage"></div></div><button class="wx-stage-view-control" data-action="reset-stage-view" title="适应屏幕"><i class="fa-solid fa-expand"></i><span class="wx-stage-zoom-value">100%</span></button></div><aside id="wx-inspector" class="wx-inspector ${inspectorOpen ? 'is-open' : ''}"></aside></div>${composerToolbar('<button class="wx-toolbar-primary" data-action="book-save-page"><i class="fa-solid fa-check"></i><span>完成本页</span></button>')}` : `<div class="wx-book-empty-editor">${emptyState('fa-file-circle-plus', '册子还没有页面', '从左侧新建空白页，或导入模板和图片。')}</div>`;
    return `<section class="wx-composer wx-book-composer">
        <div class="wx-composer-top">
            <div><button class="wx-back-button" data-action="exit-booklet-editor"><i class="fa-solid fa-arrow-left"></i><span>返回书架</span></button><strong>${escapeHtml(booklet.name)}</strong><span>${booklet.pages.length} 页</span></div>
            <div><button data-action="export-book-images" title="导出图片"><i class="fa-solid fa-images"></i></button><button data-action="export-book-pdf" title="导出 PDF"><i class="fa-solid fa-file-pdf"></i></button>${activePage ? '<button data-action="toggle-settings" title="页面设置"><i class="fa-solid fa-gear"></i></button>' : ''}</div>
        </div>
        <div class="wx-book-workbench">
            <aside class="wx-book-page-rail"><div class="wx-book-page-actions"><button data-action="book-new-page"><i class="fa-solid fa-file-circle-plus"></i><span>空白页</span></button><button data-action="book-add-template"><i class="fa-solid fa-layer-group"></i><span>模板</span></button><button data-action="book-add-gallery"><i class="fa-solid fa-images"></i><span>图库</span></button><label><i class="fa-solid fa-upload"></i><span>上传</span><input id="wx-book-upload" type="file" accept="image/*" multiple></label></div><div class="wx-book-page-list">${pageRail}</div></aside>
            <div class="wx-book-editor-main">${editor}</div>
        </div>
    </section>`;
}

function makeTextLayer(text = '双击这里，写下你的文字。') {
    const maxWidth = Math.max(220, workspace.width - 120);
    return {
        id: uid('text'), type: 'text', name: '文本', content: text, markdown: true,
        x: 60, y: 80 + workspace.layers.length * 24, width: Math.min(520, maxWidth), height: 180,
        z: workspace.layers.length + 1, opacity: 1, rotation: 0, fontFamily: 'serif', fontSize: 30, fontWeight: 400, lineHeight: 1.55, textStyle: 'body',
        color: '#332b26', align: 'left', verticalAlign: 'top', borderWidth: 0, borderStyle: 'solid', borderColor: '#332b26', borderOpacity: 1, borderRadius: 0,
        padding: 20, backgroundEnabled: false, backgroundColor: '#ffffff', backgroundOpacity: 1, writingMode: 'horizontal-tb', priority: workspace.layers.filter(layer => layer.type === 'text').length + 1, visible: true,
    };
}

function makeImageLayer(image) {
    const size = Math.min(360, workspace.width - 80);
    return {
        id: uid('image'), type: 'image', name: image?.name || '图片', source: image?.source || '', imageId: image?.id || null,
        x: 40, y: 40, width: size, height: size, z: workspace.layers.length + 1, opacity: 1,
        rotation: 0, fit: 'cover', align: 'center', cropX: 50, cropY: 50, cropZoom: 1, borderWidth: 0, borderStyle: 'solid', borderColor: '#332b26', borderOpacity: 1, borderRadius: 0, visible: true,
    };
}

function makeShapeLayer(kind = 'rectangle') {
    const isLine = kind === 'line' || kind === 'dashed-line';
    return {
        id: uid('shape'), type: 'shape', name: kind === 'circle' ? '圆形' : kind === 'ellipse' ? '椭圆' : kind === 'line' ? '直线' : kind === 'dashed-line' ? '虚线' : '长方形', shapeKind: kind,
        x: 70, y: 90, width: isLine ? 320 : 280, height: isLine ? 60 : kind === 'circle' ? 240 : 200,
        z: workspace.layers.length + 1, opacity: 1, rotation: 0, fillEnabled: !isLine, fillColor: '#d9a38f', strokeColor: '#332b26', strokeWidth: 4,
        strokeStyle: kind === 'dashed-line' ? 'dashed' : 'solid', borderWidth: 0, borderStyle: 'solid', borderColor: '#332b26', borderOpacity: 1, borderRadius: 0, visible: true,
    };
}

function shapeSvg(layer) {
    const stroke = escapeHtml(layer.strokeColor || '#332b26');
    const fill = layer.fillEnabled ? escapeHtml(layer.fillColor || '#d9a38f') : 'none';
    const width = Math.max(0.1, Number(layer.strokeWidth) || 0.1);
    const dash = layer.strokeStyle === 'dashed' ? ` stroke-dasharray="${width * 3} ${width * 2}"` : layer.strokeStyle === 'dotted' ? ` stroke-dasharray="${width} ${width * 1.8}" stroke-linecap="round"` : '';
    const inset = width / 2;
    let geometry;
    if (layer.shapeKind === 'circle' || layer.shapeKind === 'ellipse') geometry = `<ellipse cx="50%" cy="50%" rx="${Math.max(0, layer.width / 2 - inset)}" ry="${Math.max(0, layer.height / 2 - inset)}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"${dash}/>`;
    else if (layer.shapeKind === 'line' || layer.shapeKind === 'dashed-line') geometry = `<line x1="${inset}" y1="50%" x2="${Math.max(inset, layer.width - inset)}" y2="50%" stroke="${stroke}" stroke-width="${width}"${dash}/>`;
    else geometry = `<rect x="${inset}" y="${inset}" width="${Math.max(0, layer.width - width)}" height="${Math.max(0, layer.height - width)}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"${dash}/>`;
    return `<svg class="wx-layer-shape" viewBox="0 0 ${layer.width} ${layer.height}" preserveAspectRatio="none" aria-hidden="true">${geometry}</svg>`;
}

function renderStage() {
    const stage = dialog?.querySelector('#wx-stage');
    const wrap = dialog?.querySelector('#wx-stage-wrap');
    const scroll = dialog?.querySelector('.wx-stage-scroll');
    if (!stage || !wrap || !scroll) return;
    const view = getStageView(scroll);
    stage.style.width = `${workspace.width}px`;
    stage.style.height = `${workspace.height}px`;
    stage.style.background = colorWithOpacity(workspace.background, workspace.backgroundOpacity ?? 1);
    stage.innerHTML = workspaceBackgroundHtml(workspace) + [...workspace.layers].sort((a, b) => a.z - b.z).map(layerHtml).join('') + groupSelectionHtml();
    applyStageView(scroll, stage, wrap, view);
    stage.querySelectorAll('.wx-layer').forEach(element => attachLayerPointer(element));
    const groupSelection = stage.querySelector('.wx-group-selection');
    if (groupSelection) attachGroupPointer(groupSelection);
    renderMergeSelectionBar(scroll);
    stage.onpointerdown = event => {
        if (!mergeSelection && !event.target.closest('.wx-layer, .wx-group-selection')) clearLayerSelection();
    };
    attachStageViewport(scroll, stage, wrap, view);
}

function getStageView(scroll) {
    let view = stageViewStates.get(workspace);
    if (!view) {
        const availableWidth = Math.max(180, scroll.clientWidth - 72);
        const availableHeight = Math.max(220, scroll.clientHeight - 72);
        const zoom = Math.min(1, availableWidth / workspace.width, availableHeight / workspace.height);
        view = {
            zoom,
            x: (scroll.clientWidth - workspace.width * zoom) / 2,
            y: (scroll.clientHeight - workspace.height * zoom) / 2,
        };
        stageViewStates.set(workspace, view);
    }
    return view;
}

function applyStageView(scroll, stage, wrap, view) {
    wrap.style.left = `${view.x}px`;
    wrap.style.top = `${view.y}px`;
    wrap.style.width = `${workspace.width * view.zoom}px`;
    wrap.style.height = `${workspace.height * view.zoom}px`;
    stage.style.transform = `scale(${view.zoom})`;
    stage.dataset.scale = view.zoom;
    scroll.querySelector('.wx-stage-zoom-value')?.replaceChildren(`${Math.round(view.zoom * 100)}%`);
}

function zoomStageAt(scroll, stage, wrap, view, requestedZoom, clientX, clientY) {
    const nextZoom = Math.max(0.1, Math.min(5, requestedZoom));
    if (Math.abs(nextZoom - view.zoom) < 0.0001) return;
    const bounds = scroll.getBoundingClientRect();
    const pointX = clientX - bounds.left;
    const pointY = clientY - bounds.top;
    const paperX = (pointX - view.x) / view.zoom;
    const paperY = (pointY - view.y) / view.zoom;
    view.x = pointX - paperX * nextZoom;
    view.y = pointY - paperY * nextZoom;
    view.zoom = nextZoom;
    applyStageView(scroll, stage, wrap, view);
}

function attachStageViewport(scroll, stage, wrap, view) {
    const pointers = new Map();
    let gesture = null;
    const localPoint = event => {
        const bounds = scroll.getBoundingClientRect();
        return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    const pinchMetrics = () => {
        const [first, second] = [...pointers.values()].slice(0, 2);
        return {
            center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
            distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        };
    };
    scroll.onwheel = event => {
        event.preventDefault();
        const factor = Math.exp(-event.deltaY * 0.0015);
        zoomStageAt(scroll, stage, wrap, view, view.zoom * factor, event.clientX, event.clientY);
    };
    scroll.onpointerdown = event => {
        if (event.target.closest('.wx-stage-view-control, .wx-merge-mode-bar')) return;
        const point = localPoint(event);
        if (event.pointerType === 'touch') pointers.set(event.pointerId, point);
        if (event.pointerType === 'touch' && pointers.size >= 2) {
            const metrics = pinchMetrics();
            gesture = {
                mode: 'pinch',
                startZoom: view.zoom,
                startDistance: metrics.distance,
                paperX: (metrics.center.x - view.x) / view.zoom,
                paperY: (metrics.center.y - view.y) / view.zoom,
            };
            scroll.dataset.pinching = 'true';
            clearLayerSelection();
            for (const pointerId of pointers.keys()) {
                try { scroll.setPointerCapture(pointerId); } catch { /* The layer may already own this touch pointer. */ }
            }
            event.preventDefault();
            return;
        }
        if (event.button !== 0 || event.target.closest('.wx-layer')) return;
        gesture = { mode: 'pan', pointerId: event.pointerId, startX: point.x, startY: point.y, viewX: view.x, viewY: view.y, moved: false };
        scroll.setPointerCapture(event.pointerId);
        clearLayerSelection();
        event.preventDefault();
    };
    scroll.onpointermove = event => {
        const point = localPoint(event);
        if (event.pointerType === 'touch' && pointers.has(event.pointerId)) pointers.set(event.pointerId, point);
        if (gesture?.mode === 'pinch' && pointers.size >= 2) {
            const metrics = pinchMetrics();
            const nextZoom = Math.max(0.1, Math.min(5, gesture.startZoom * metrics.distance / gesture.startDistance));
            view.zoom = nextZoom;
            view.x = metrics.center.x - gesture.paperX * nextZoom;
            view.y = metrics.center.y - gesture.paperY * nextZoom;
            applyStageView(scroll, stage, wrap, view);
            event.preventDefault();
        } else if (gesture?.mode === 'pan' && gesture.pointerId === event.pointerId) {
            const dx = point.x - gesture.startX;
            const dy = point.y - gesture.startY;
            if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
            gesture.moved = true;
            view.x = gesture.viewX + dx;
            view.y = gesture.viewY + dy;
            scroll.classList.add('is-panning');
            applyStageView(scroll, stage, wrap, view);
            event.preventDefault();
        }
    };
    const endPointer = event => {
        pointers.delete(event.pointerId);
        if (gesture?.mode === 'pinch' && pointers.size < 2) {
            gesture = null;
        } else if (gesture?.mode === 'pan' && gesture.pointerId === event.pointerId) gesture = null;
        if (pointers.size === 0) delete scroll.dataset.pinching;
        scroll.classList.remove('is-panning');
    };
    scroll.onpointerup = endPointer;
    scroll.onpointercancel = endPointer;
}

function resetStageView() {
    stageViewStates.delete(workspace);
    renderStage();
}

function clearLayerSelection() {
    if (mergeSelection) return;
    if (!selectedLayerId) return;
    selectedLayerId = null;
    setInspectorOpen(false);
    dialog?.querySelectorAll('.wx-layer.is-selected, .wx-layer.is-group-member-selected').forEach(element => element.classList.remove('is-selected', 'is-group-member-selected'));
    dialog?.querySelector('.wx-group-selection')?.remove();
}

function selectedLayer() {
    return workspace.layers.find(layer => layer.id === selectedLayerId) || null;
}

function isGroupedLayer(layer) {
    return Boolean(layer?.groupId && workspace.layers.filter(item => item.groupId === layer.groupId).length > 1);
}

function selectedLayers() {
    const layer = selectedLayer();
    if (!layer) return [];
    return isGroupedLayer(layer) ? workspace.layers.filter(item => item.groupId === layer.groupId) : [layer];
}

function layerGroupBounds(layers) {
    if (!layers.length) return null;
    const left = Math.min(...layers.map(layer => layer.x));
    const top = Math.min(...layers.map(layer => layer.y));
    const right = Math.max(...layers.map(layer => layer.x + layer.width));
    const bottom = Math.max(...layers.map(layer => layer.y + layer.height));
    return { left, top, width: right - left, height: bottom - top };
}

function colorWithOpacity(color, opacity = 1) {
    const match = String(color || '#000000').match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
    if (!match) return color || 'transparent';
    return `rgba(${parseInt(match[1], 16)},${parseInt(match[2], 16)},${parseInt(match[3], 16)},${Math.max(0, Math.min(1, opacity))})`;
}

function normaliseHexColor(value, fallback = '#000000') {
    const text = String(value || '').trim();
    const expanded = /^#[\da-f]{3}$/i.test(text) ? `#${[...text.slice(1)].map(character => character + character).join('')}` : text;
    if (/^#[\da-f]{6}$/i.test(expanded)) return expanded.toLowerCase();
    const rgb = text.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgb) return `#${rgb.slice(1, 4).map(channel => Math.max(0, Math.min(255, Number(channel))).toString(16).padStart(2, '0')).join('')}`;
    return fallback;
}

function colorControl(scope, prop, value, label, className = '') {
    const color = normaliseHexColor(value);
    return `<label class="wx-color-control ${className}">${label}<span><input class="wx-hex-color" type="text" inputmode="text" maxlength="7" spellcheck="false" value="${color}" data-color-scope="${scope}" data-color-prop="${prop}" aria-label="${label}十六进制颜色码"><input class="wx-color-picker" type="color" value="${color}" data-color-picker-scope="${scope}" data-color-prop="${prop}" title="打开调色盘" aria-label="${label}调色盘"><button type="button" data-action="apply-hex-color" title="应用颜色" aria-label="应用${label}"><i class="fa-solid fa-check"></i></button></span></label>`;
}

function commitColor(scope, prop, raw, control) {
    if (!/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(String(raw).trim())) {
        notify('请输入 #RRGGBB 格式的十六进制颜色码。', 'warning');
        return false;
    }
    const value = normaliseHexColor(raw);
    const target = scope === 'workspace' ? workspace : workspace.layers.find(item => item.id === selectedLayerId);
    if (!target) return false;
    target[prop] = value;
    const hexInput = control?.querySelector('.wx-hex-color');
    const picker = control?.querySelector('.wx-color-picker');
    if (hexInput) hexInput.value = value;
    if (picker) picker.value = value;
    renderStage();
    touchActiveBooklet();
    scheduleSave();
    return true;
}

function applyHexInput(input) {
    if (!input) return;
    commitColor(input.dataset.colorScope, input.dataset.colorProp, input.value, input.closest('.wx-color-control'));
}

function workspaceBackgroundHtml(sourceWorkspace) {
    if (!sourceWorkspace.backgroundImage) return '';
    const viewport = sourceWorkspace.backgroundImageViewport;
    const placement = viewport ? `inset:auto;left:${viewport.x}px;top:${viewport.y}px;width:${viewport.width}px;height:${viewport.height}px;max-width:none;` : '';
    return `<img class="wx-stage-background-image" src="${escapeHtml(sourceWorkspace.backgroundImage)}" alt="" draggable="false" style="${placement}object-fit:${viewport?.fit || sourceWorkspace.backgroundImageFit || 'cover'};opacity:${sourceWorkspace.backgroundImageOpacity ?? 1}">`;
}

function croppedImageHtml(layer) {
    const crop = layer.cropRect;
    const sourceWidth = crop.sourceWidth || layer.cropSourceWidth || layer.width / Math.max(0.0001, crop.width);
    const sourceHeight = crop.sourceHeight || layer.cropSourceHeight || layer.height / Math.max(0.0001, crop.height);
    const cropAspect = (sourceWidth * crop.width) / Math.max(0.0001, sourceHeight * crop.height);
    const boxAspect = layer.width / Math.max(0.0001, layer.height);
    const ratio = cropAspect / boxAspect;
    const fit = layer.fit || 'cover';
    let frameWidth = 100, frameHeight = 100, frameLeft = 0, frameTop = 0;
    if (fit === 'contain') {
        if (ratio > 1) { frameHeight = 100 / ratio; frameTop = (100 - frameHeight) / 2; }
        else { frameWidth = 100 * ratio; frameLeft = (100 - frameWidth) / 2; }
    } else if (fit === 'cover') {
        if (ratio > 1) { frameWidth = 100 * ratio; frameLeft = (100 - frameWidth) / 2; }
        else { frameHeight = 100 / Math.max(0.0001, ratio); frameTop = (100 - frameHeight) / 2; }
    }
    return `<div class="wx-layer-image-clip"><div class="wx-cropped-image-frame" style="left:${frameLeft}%;top:${frameTop}%;width:${frameWidth}%;height:${frameHeight}%"><img src="${escapeHtml(layer.source)}" alt="" draggable="false" style="position:absolute;left:${-crop.x / crop.width * 100}%;top:${-crop.y / crop.height * 100}%;width:${100 / crop.width}%;height:${100 / crop.height}%;max-width:none;object-fit:fill"></div></div>`;
}

function layerHtml(layer) {
    const activeLayer = selectedLayer();
    const selected = mergeSelection ? mergeSelection.ids.has(layer.id) ? ' is-merge-selected' : ' is-merge-candidate' : layer.id === selectedLayerId && !isGroupedLayer(layer) ? ' is-selected' : isGroupedLayer(activeLayer) && layer.groupId === activeLayer.groupId ? ' is-group-member-selected' : '';
    const border = layer.type === 'shape' ? '0 solid transparent' : `${layer.borderWidth || 0}px ${layer.borderStyle || 'solid'} ${colorWithOpacity(layer.borderColor, layer.borderOpacity ?? 1)}`;
    const common = `left:${layer.x}px;top:${layer.y}px;width:${layer.width}px;height:${layer.height}px;z-index:${layer.z};opacity:${layer.visible === false ? 0.16 : layer.opacity};transform:rotate(${layer.rotation || 0}deg);border:${border};border-radius:${layer.borderRadius || 0}px;`;
    let body;
    if (layer.type === 'text') {
        const displayContent = applyMaskRules(layer.content, layer.maskRules);
        const verticalPosition = layer.verticalAlign === 'middle' ? 'center' : layer.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start';
        body = `<div class="wx-layer-text wx-md" contenteditable="true" spellcheck="false" title="直接点击文字编辑" style="font-family:${escapeHtml(layer.fontFamily)};font-size:${layer.fontSize}px;font-weight:${layer.fontWeight || 400};line-height:${layer.lineHeight || 1.45};color:${layer.color};text-align:${layer.align};padding:${layer.padding || 0}px;writing-mode:${layer.writingMode || 'horizontal-tb'};justify-content:${verticalPosition};background:${layer.backgroundEnabled ? colorWithOpacity(layer.backgroundColor || '#ffffff', layer.backgroundOpacity ?? 1) : 'transparent'};" data-layer-content="${layer.id}">${layer.markdown ? markdown(displayContent) : escapeHtml(displayContent)}</div>`;
    } else if (layer.type === 'image') {
        if (layer.cropRect) body = croppedImageHtml(layer);
        else {
            const cropX = layer.cropX ?? 50, cropY = layer.cropY ?? 50, cropZoom = layer.cropZoom ?? 1;
            body = `<div class="wx-layer-image-clip"><img src="${escapeHtml(layer.source)}" alt="" draggable="false" style="object-fit:${layer.fit || 'cover'};object-position:${cropX}% ${cropY}%;transform:scale(${cropZoom});transform-origin:${cropX}% ${cropY}%"></div>`;
        }
    } else body = shapeSvg(layer);
    const resizeHandles = ['nw', 'ne', 'sw', 'se'].map(direction => `<button class="wx-resize-handle" data-resize-layer="${layer.id}" data-resize-direction="${direction}" title="拖动缩放"></button>`).join('');
    return `<div class="wx-layer wx-layer-${layer.type}${selected}" data-layer-id="${layer.id}" style="${common}">${body}<div class="wx-layer-selection-frame" aria-hidden="true"></div><button class="wx-move-handle" data-move-layer="${layer.id}" title="拖动移动图层" aria-label="拖动移动图层"><i class="fa-solid fa-up-down-left-right"></i></button><div class="wx-layer-quick-actions">${layer.type === 'image' ? '<button data-action="crop-image" title="裁剪图片" aria-label="裁剪图片"><i class="fa-solid fa-crop-simple"></i></button>' : ''}<button data-action="merge-layers" title="与其他图层合并" aria-label="与其他图层合并"><i class="fa-solid fa-object-group"></i></button><button data-action="layer-down" title="下移图层" aria-label="下移图层"><i class="fa-solid fa-arrow-down"></i></button><button data-action="layer-up" title="上移图层" aria-label="上移图层"><i class="fa-solid fa-arrow-up"></i></button><button data-action="delete-layer" title="删除图层" aria-label="删除图层"><i class="fa-solid fa-trash"></i></button></div>${resizeHandles}</div>`;
}

function groupSelectionHtml() {
    if (mergeSelection) return '';
    const layers = selectedLayers();
    if (layers.length < 2 || !layers[0].groupId) return '';
    const bounds = layerGroupBounds(layers);
    const handles = ['nw', 'ne', 'sw', 'se'].map(direction => `<button class="wx-resize-handle" data-group-resize="${direction}" data-resize-direction="${direction}" title="统一缩放"></button>`).join('');
    return `<div class="wx-group-selection" data-group-id="${escapeHtml(layers[0].groupId)}" style="left:${bounds.left}px;top:${bounds.top}px;width:${bounds.width}px;height:${bounds.height}px"><button class="wx-move-handle" data-group-move title="整组移动"><i class="fa-solid fa-up-down-left-right"></i></button><div class="wx-layer-quick-actions"><button data-action="ungroup-layers" title="取消合并"><i class="fa-solid fa-object-ungroup"></i></button><button data-action="delete-layer" title="删除整组"><i class="fa-solid fa-trash"></i></button></div>${handles}</div>`;
}

function renderMergeSelectionBar(scroll) {
    scroll.querySelector('.wx-merge-mode-bar')?.remove();
    if (!mergeSelection) return;
    const count = mergeSelection.ids.size;
    scroll.insertAdjacentHTML('beforeend', `<div class="wx-merge-mode-bar"><span><i class="fa-solid fa-hand-pointer"></i> 点击图层选择 <strong>${count}</strong> 项</span><button data-action="cancel-merge-layers" title="取消合并" aria-label="取消合并"><i class="fa-solid fa-xmark"></i></button><button class="is-confirm" data-action="confirm-merge-layers" title="完成合并" aria-label="完成合并" ${count < 2 ? 'disabled' : ''}><i class="fa-solid fa-check"></i></button></div>`);
}

function attachLayerPointer(element) {
    element.addEventListener('pointerdown', event => {
        const layer = workspace.layers.find(item => item.id === element.dataset.layerId);
        if (!layer) return;
        if (mergeSelection) {
            event.preventDefault();
            event.stopPropagation();
            let targetLayer = layer;
            if (layer.id === mergeSelection.anchorId) {
                const stackedLayerElement = document.elementsFromPoint(event.clientX, event.clientY)
                    .map(node => node.closest?.('.wx-layer'))
                    .find((node, index, nodes) => node && node.dataset.layerId !== layer.id && nodes.indexOf(node) === index);
                targetLayer = workspace.layers.find(item => item.id === stackedLayerElement?.dataset.layerId) || layer;
            }
            if (targetLayer.id !== mergeSelection.anchorId) {
                if (mergeSelection.ids.has(targetLayer.id)) mergeSelection.ids.delete(targetLayer.id);
                else mergeSelection.ids.add(targetLayer.id);
            }
            renderStage();
            return;
        }
        const wasSelected = selectedLayers().some(item => item.id === layer.id);
        selectedLayerId = layer.id;
        setInspectorOpen(true);
        renderInspector();
        if (isGroupedLayer(layer)) {
            const quickAction = event.target.closest('.wx-layer-quick-actions');
            if (!wasSelected) {
                renderStage();
                return;
            }
            if (!quickAction) beginGroupTransform(element, event);
            return;
        }
        dialog.querySelector('.wx-group-selection')?.remove();
        dialog.querySelectorAll('.wx-layer').forEach(item => {
            item.classList.remove('is-group-member-selected');
            item.classList.toggle('is-selected', item === element);
        });
        const resize = event.target.closest('[data-resize-layer]');
        const moveHandle = event.target.closest('[data-move-layer]');
        const quickAction = event.target.closest('.wx-layer-quick-actions');
        if ((!wasSelected && !resize && !moveHandle) || quickAction) return;
        const scale = Number(dialog.querySelector('#wx-stage').dataset.scale) || 1;
        const start = { x: event.clientX, y: event.clientY, left: layer.x, top: layer.y, width: layer.width, height: layer.height };
        const resizeDirection = resize?.dataset.resizeDirection || 'se';
        let moved = false;
        element.setPointerCapture(event.pointerId);
        const move = moveEvent => {
            if (element.closest('.wx-stage-scroll')?.dataset.pinching === 'true') return;
            const dx = (moveEvent.clientX - start.x) / scale;
            const dy = (moveEvent.clientY - start.y) / scale;
            if (!moved && Math.hypot(dx, dy) < 4) return;
            moved = true;
            moveEvent.preventDefault();
            element.classList.add('is-dragging');
            if (resize) {
                const movesLeft = resizeDirection.includes('w');
                const movesTop = resizeDirection.includes('n');
                const minWidth = layer.type === 'shape' ? 1 : 60;
                const minHeight = layer.type === 'shape' ? 1 : 40;
                if (movesLeft) {
                    layer.x = Math.max(0, Math.min(start.left + start.width - minWidth, start.left + dx));
                    layer.width = start.width + start.left - layer.x;
                } else {
                    layer.width = Math.max(minWidth, Math.min(workspace.width - start.left, start.width + dx));
                }
                if (movesTop) {
                    layer.y = Math.max(0, Math.min(start.top + start.height - minHeight, start.top + dy));
                    layer.height = start.height + start.top - layer.y;
                } else {
                    layer.height = Math.max(minHeight, Math.min(workspace.height - start.top, start.height + dy));
                }
                element.style.left = `${layer.x}px`;
                element.style.top = `${layer.y}px`;
                element.style.width = `${layer.width}px`;
                element.style.height = `${layer.height}px`;
            } else {
                layer.x = Math.max(0, Math.min(workspace.width - layer.width, start.left + dx));
                layer.y = Math.max(0, Math.min(workspace.height - layer.height, start.top + dy));
                element.style.left = `${layer.x}px`;
                element.style.top = `${layer.y}px`;
            }
        };
        const end = endEvent => {
            element.removeEventListener('pointermove', move);
            element.removeEventListener('pointerup', end);
            element.removeEventListener('pointercancel', end);
            element.classList.remove('is-dragging');
            if (moved) {
                endEvent.preventDefault();
                element.dataset.justDragged = 'true';
                element.querySelector('[contenteditable]')?.blur();
                setTimeout(() => delete element.dataset.justDragged, 0);
            }
            scheduleSave();
            touchActiveBooklet();
            renderInspector();
        };
        element.addEventListener('pointermove', move);
        element.addEventListener('pointerup', end);
        element.addEventListener('pointercancel', end);
    });
    element.addEventListener('click', event => {
        if (element.dataset.justDragged) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);
    const editable = element.querySelector('[contenteditable]');
    editable?.addEventListener('focus', () => {
        const layer = workspace.layers.find(item => item.id === element.dataset.layerId);
        if (layer) editable.textContent = layer.content;
    });
    editable?.addEventListener('blur', () => {
        const layer = workspace.layers.find(item => item.id === element.dataset.layerId);
        if (!layer) return;
        layer.content = editable.innerText;
        const displayContent = applyMaskRules(layer.content, layer.maskRules);
        editable.innerHTML = layer.markdown ? markdown(displayContent) : escapeHtml(displayContent);
        touchActiveBooklet();
        scheduleSave();
    });
}

function beginGroupTransform(captureElement, event, resizeDirection = null) {
    const layers = selectedLayers();
    const bounds = layerGroupBounds(layers);
    if (layers.length < 2 || !bounds) return;
    event.preventDefault();
    event.stopPropagation();
    const scale = Number(dialog.querySelector('#wx-stage').dataset.scale) || 1;
    const snapshots = layers.map(layer => ({ layer, x: layer.x, y: layer.y, width: layer.width, height: layer.height }));
    const startX = event.clientX, startY = event.clientY;
    let moved = false;
    captureElement.setPointerCapture(event.pointerId);
    const move = moveEvent => {
        const dx = (moveEvent.clientX - startX) / scale;
        const dy = (moveEvent.clientY - startY) / scale;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        let next = { ...bounds };
        if (resizeDirection) {
            const right = bounds.left + bounds.width, bottom = bounds.top + bounds.height;
            if (resizeDirection.includes('w')) { next.left = Math.max(0, Math.min(right - 40, bounds.left + dx)); next.width = right - next.left; }
            if (resizeDirection.includes('e')) next.width = Math.max(40, Math.min(workspace.width - bounds.left, bounds.width + dx));
            if (resizeDirection.includes('n')) { next.top = Math.max(0, Math.min(bottom - 40, bounds.top + dy)); next.height = bottom - next.top; }
            if (resizeDirection.includes('s')) next.height = Math.max(40, Math.min(workspace.height - bounds.top, bounds.height + dy));
            const scaleX = next.width / Math.max(1, bounds.width);
            const scaleY = next.height / Math.max(1, bounds.height);
            snapshots.forEach(item => {
                item.layer.x = next.left + (item.x - bounds.left) * scaleX;
                item.layer.y = next.top + (item.y - bounds.top) * scaleY;
                item.layer.width = Math.max(item.layer.type === 'shape' ? 1 : 20, item.width * scaleX);
                item.layer.height = Math.max(item.layer.type === 'shape' ? 1 : 20, item.height * scaleY);
            });
        } else {
            const moveX = Math.max(-bounds.left, Math.min(workspace.width - bounds.left - bounds.width, dx));
            const moveY = Math.max(-bounds.top, Math.min(workspace.height - bounds.top - bounds.height, dy));
            next.left = bounds.left + moveX;
            next.top = bounds.top + moveY;
            snapshots.forEach(item => { item.layer.x = item.x + moveX; item.layer.y = item.y + moveY; });
        }
        snapshots.forEach(item => {
            const node = dialog.querySelector(`.wx-layer[data-layer-id="${item.layer.id}"]`);
            if (!node) return;
            node.style.left = `${item.layer.x}px`; node.style.top = `${item.layer.y}px`;
            node.style.width = `${item.layer.width}px`; node.style.height = `${item.layer.height}px`;
        });
        const outline = dialog.querySelector('.wx-group-selection');
        if (outline) { outline.style.left = `${next.left}px`; outline.style.top = `${next.top}px`; outline.style.width = `${next.width}px`; outline.style.height = `${next.height}px`; }
    };
    const end = () => {
        captureElement.removeEventListener('pointermove', move);
        captureElement.removeEventListener('pointerup', end);
        captureElement.removeEventListener('pointercancel', end);
        if (moved) {
            touchActiveBooklet();
            scheduleSave();
            renderStage();
            renderInspector();
        }
    };
    captureElement.addEventListener('pointermove', move);
    captureElement.addEventListener('pointerup', end);
    captureElement.addEventListener('pointercancel', end);
}

function attachGroupPointer(element) {
    element.addEventListener('pointerdown', event => {
        if (event.target.closest('.wx-layer-quick-actions')) return;
        const resize = event.target.closest('[data-group-resize]');
        const move = event.target.closest('[data-group-move]');
        if (!resize && !move) return;
        beginGroupTransform(element, event, resize?.dataset.resizeDirection || null);
    });
}

function setInspectorOpen(open) {
    inspectorOpen = open;
    const editor = dialog?.querySelector('.wx-editor');
    const inspector = dialog?.querySelector('#wx-inspector');
    editor?.classList.toggle('has-inspector', open);
    inspector?.classList.toggle('is-open', open);
}

function fontOptions(selected) {
    const system = [
        [SILLYTAVERN_FONT_FAMILY, '跟随 SillyTavern 系统字体'],
        ['serif', '衬线体'], ['sans-serif', '无衬线体'], ['monospace', '等宽体'], ['cursive', '手写体'],
    ];
    const available = [...BUILT_IN_FONTS, ...state.fonts].filter((font, index, fonts) => fonts.findIndex(item => item.family === font.family) === index);
    return [...system, ...available.map(font => [font.family, font.name])]
        .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function textStylePresetHtml(layer) {
    return `<div class="wx-text-style-presets wx-span-2"><span>文字样式</span><div>${Object.entries(TEXT_STYLE_PRESETS).map(([key, preset]) => `<button type="button" class="${layer.textStyle === key ? 'is-active' : ''}" data-action="apply-text-style" data-style="${key}">${preset.label}</button>`).join('')}</div></div>`;
}

function inspectorSection(title, content, open = true) {
    return `<details class="wx-inspector-section" ${open ? 'open' : ''}><summary><span>${title}</span><i class="fa-solid fa-chevron-down"></i></summary><div class="wx-field-grid">${content}</div></details>`;
}

function renderInspector() {
    const inspector = dialog?.querySelector('#wx-inspector');
    if (!inspector) return;
    const layer = workspace.layers.find(item => item.id === selectedLayerId);
    if (!layer) {
        inspector.innerHTML = `<div class="wx-inspector-head"><strong>画布与图层</strong><button data-action="close-inspector"><i class="fa-solid fa-xmark"></i></button></div>
            ${inspectorSection('快捷文本', `<div class="wx-quick-text-import wx-span-2"><div><button data-action="add-smart-text" data-kind="char"><i class="fa-solid fa-user-tag"></i><span>{{char}}</span></button><button data-action="add-smart-text" data-kind="user"><i class="fa-solid fa-user"></i><span>{{user}}</span></button><button data-action="add-smart-text" data-kind="date"><i class="fa-solid fa-calendar-day"></i><span>日期</span></button><button data-action="add-smart-text" data-kind="time"><i class="fa-solid fa-clock"></i><span>时间</span></button></div></div>`)}
            ${inspectorSection('纸张尺寸与颜色', `<label>宽度<input type="number" min="240" max="4000" data-workspace="width" value="${workspace.width}"></label><label>高度<input type="number" min="240" max="6000" data-workspace="height" value="${workspace.height}"></label><button class="wx-inspector-action wx-span-2" data-action="crop-workspace"><i class="fa-solid fa-crop-simple"></i> 裁切画布</button>${colorControl('workspace', 'background', workspace.background, '纸张颜色', 'wx-span-2')}<label class="wx-span-2">纸张颜色透明度<input type="range" min="0" max="1" step="0.05" data-workspace="backgroundOpacity" value="${workspace.backgroundOpacity ?? 1}"></label>`)}
            ${inspectorSection('纸张背景图', `<div class="wx-workspace-background wx-span-2"><span>纸张背景图</span>${workspace.backgroundImage ? `<img src="${escapeHtml(workspace.backgroundImage)}" alt="当前纸张背景图">` : '<small>尚未选择背景图片</small>'}<div><button data-action="workspace-background-image"><i class="fa-solid fa-images"></i> 从图库选择</button>${workspace.backgroundImage ? '<button data-action="remove-workspace-background-image"><i class="fa-solid fa-trash"></i> 移除</button>' : ''}</div></div><label class="wx-span-2">背景图填充<select data-workspace="backgroundImageFit"><option value="cover" ${(workspace.backgroundImageFit || 'cover') === 'cover' ? 'selected' : ''}>裁切铺满</option><option value="contain" ${workspace.backgroundImageFit === 'contain' ? 'selected' : ''}>完整显示</option><option value="fill" ${workspace.backgroundImageFit === 'fill' ? 'selected' : ''}>拉伸</option></select></label><label class="wx-span-2">背景图透明度<input type="range" min="0" max="1" step="0.05" data-workspace="backgroundImageOpacity" value="${workspace.backgroundImageOpacity ?? 1}"></label>`)}
            <div class="wx-layer-list"><strong>图层 <small>拖动可排序</small></strong>${[...workspace.layers].sort((a, b) => b.z - a.z).map(item => `<button draggable="true" data-drag-kind="layer-list" data-action="select-layer" data-id="${item.id}"><i class="fa-solid fa-grip-vertical wx-layer-grip"></i><i class="fa-solid ${item.visible === false ? 'fa-eye-slash' : 'fa-eye'}" data-action="toggle-layer" data-id="${item.id}"></i><span>${escapeHtml(item.name)}</span><small>${item.type === 'text' ? '文字' : item.type === 'image' ? '图片' : '图形'}</small></button>`).join('') || '<p>画布上还没有图层。</p>'}</div>`;
        return;
    }
    const typeFields = layer.type === 'text' ? `
        ${textStylePresetHtml(layer)}
        <label class="wx-span-2">字体<select data-layer-prop="fontFamily">${fontOptions(layer.fontFamily)}</select></label>
        <label>字号<input type="number" min="8" max="300" data-layer-prop="fontSize" value="${layer.fontSize}"></label>
        ${colorControl('layer', 'color', layer.color, '文字颜色')}
        <label>文字方向<select data-layer-prop="writingMode"><option value="horizontal-tb" ${(layer.writingMode || 'horizontal-tb') === 'horizontal-tb' ? 'selected' : ''}>横排</option><option value="vertical-rl" ${layer.writingMode === 'vertical-rl' ? 'selected' : ''}>竖排</option></select></label>
        <label>替换优先级<input type="number" min="1" max="999" data-layer-prop="priority" value="${layer.priority || 1}"></label>
        <label class="wx-inline-check wx-span-2"><input type="checkbox" data-layer-prop="markdown" ${layer.markdown ? 'checked' : ''}> 启用 Markdown</label>
        <label class="wx-inline-check wx-span-2"><input type="checkbox" data-layer-prop="backgroundEnabled" ${layer.backgroundEnabled ? 'checked' : ''}> 启用文本底色</label>
        ${colorControl('layer', 'backgroundColor', layer.backgroundColor || '#ffffff', '文本底色', 'wx-span-2')}
        <label class="wx-span-2">文本底色透明度<input type="range" min="0" max="1" step="0.05" data-layer-prop="backgroundOpacity" value="${layer.backgroundOpacity ?? 1}"></label>
        <button class="wx-inspector-action wx-span-2" data-action="text-background-image"><i class="fa-solid fa-image"></i> 从图库添加背景图层</button>` : layer.type === 'image' ? `
        <label class="wx-span-2">填充<select data-layer-prop="fit"><option value="cover" ${layer.fit === 'cover' ? 'selected' : ''}>裁切铺满</option><option value="contain" ${layer.fit === 'contain' ? 'selected' : ''}>完整显示</option><option value="fill" ${layer.fit === 'fill' ? 'selected' : ''}>拉伸</option></select></label>
        <button class="wx-inspector-action wx-span-2" data-action="crop-image"><i class="fa-solid fa-crop-simple"></i> 裁剪图片</button>` : `
        <label class="wx-inline-check wx-span-2"><input type="checkbox" data-layer-prop="fillEnabled" ${layer.fillEnabled ? 'checked' : ''} ${layer.shapeKind === 'line' || layer.shapeKind === 'dashed-line' ? 'disabled' : ''}> 填充图形</label>
        ${colorControl('layer', 'fillColor', layer.fillColor || '#d9a38f', '填充颜色', 'wx-span-2')}
        ${colorControl('layer', 'strokeColor', layer.strokeColor || '#332b26', '线条颜色', 'wx-span-2')}
        <label>线条粗细<input type="number" min="0.1" step="0.1" data-layer-prop="strokeWidth" value="${layer.strokeWidth || 1}"></label>
        <label>线条样式<select data-layer-prop="strokeStyle"><option value="solid" ${(layer.strokeStyle || 'solid') === 'solid' ? 'selected' : ''}>实线</option><option value="dashed" ${layer.strokeStyle === 'dashed' ? 'selected' : ''}>虚线</option><option value="dotted" ${layer.strokeStyle === 'dotted' ? 'selected' : ''}>点线</option></select></label>`;
    const borderFields = layer.type === 'shape' ? '' : `<label>边框粗细<input type="number" min="0" max="40" step="1" data-layer-prop="borderWidth" value="${layer.borderWidth || 0}"></label><label>边框样式<select data-layer-prop="borderStyle"><option value="solid" ${(layer.borderStyle || 'solid') === 'solid' ? 'selected' : ''}>实线</option><option value="dashed" ${layer.borderStyle === 'dashed' ? 'selected' : ''}>虚线</option><option value="dotted" ${layer.borderStyle === 'dotted' ? 'selected' : ''}>点线</option><option value="double" ${layer.borderStyle === 'double' ? 'selected' : ''}>双线</option></select></label>${colorControl('layer', 'borderColor', layer.borderColor || '#332b26', '边框颜色')}<label>框线透明度<input type="range" min="0" max="1" step="0.05" data-layer-prop="borderOpacity" value="${layer.borderOpacity ?? 1}"></label><label class="wx-span-2">圆角<input type="range" min="0" max="200" data-layer-prop="borderRadius" value="${layer.borderRadius || 0}"></label>`;
    const alignment = layer.type === 'text'
        ? `<div class="wx-paper-align wx-span-2"><span>文本框内文字对齐</span><div><button data-action="align-text" data-position="left" title="文字靠纸张左侧"><i class="fa-solid fa-align-left"></i></button><button data-action="align-text" data-position="center" title="文字水平居中"><i class="fa-solid fa-align-center"></i></button><button data-action="align-text" data-position="right" title="文字靠纸张右侧"><i class="fa-solid fa-align-right"></i></button><button data-action="align-text" data-position="top" title="文字靠纸张顶端"><i class="fa-solid fa-arrow-up-to-line"></i></button><button data-action="align-text" data-position="middle" title="文字垂直居中"><i class="fa-solid fa-arrows-up-down-to-line"></i></button><button data-action="align-text" data-position="bottom" title="文字靠纸张底端"><i class="fa-solid fa-arrow-down-to-line"></i></button></div></div>`
        : `<div class="wx-paper-align wx-span-2"><span>图层相对纸张对齐</span><div><button data-action="align-layer" data-position="left" title="纸张左对齐"><i class="fa-solid fa-align-left"></i></button><button data-action="align-layer" data-position="hcenter" title="纸张水平居中"><i class="fa-solid fa-arrows-left-right-to-line"></i></button><button data-action="align-layer" data-position="right" title="纸张右对齐"><i class="fa-solid fa-align-right"></i></button><button data-action="align-layer" data-position="top" title="纸张顶端对齐"><i class="fa-solid fa-arrow-up-to-line"></i></button><button data-action="align-layer" data-position="vcenter" title="纸张垂直居中"><i class="fa-solid fa-arrows-up-down-to-line"></i></button><button data-action="align-layer" data-position="bottom" title="纸张底端对齐"><i class="fa-solid fa-arrow-down-to-line"></i></button></div></div>`;
    inspector.innerHTML = `<div class="wx-inspector-head"><div><strong>${escapeHtml(layer.name)}</strong><span>${layer.type === 'text' ? '文字图层' : layer.type === 'image' ? '图片图层' : '图形图层'}</span></div><button data-action="close-inspector"><i class="fa-solid fa-xmark"></i></button></div>
        ${inspectorSection(layer.type === 'text' ? '文字样式' : layer.type === 'image' ? '图片设置' : '图形样式', typeFields)}
        ${inspectorSection('对齐与位置', `${alignment}<label>透明度<input type="range" min="0" max="1" step="0.05" data-layer-prop="opacity" value="${layer.opacity}"></label><label>旋转<input type="number" min="-360" max="360" data-layer-prop="rotation" value="${layer.rotation || 0}"></label>`)}
        ${borderFields ? inspectorSection('边框与圆角', borderFields, false) : ''}`;
}

function showOverlay(title, body, actions = '') {
    const overlay = dialog.querySelector('#wx-overlay');
    delete overlay.dataset.overlayKind;
    delete overlay.dataset.overlayOwner;
    overlay.hidden = false;
    overlay.innerHTML = `<div class="wx-modal-backdrop" data-action="close-overlay"></div><section class="wx-modal" role="dialog" aria-modal="true"><header><h2>${title}</h2><button data-action="close-overlay"><i class="fa-solid fa-xmark"></i></button></header><div class="wx-modal-body">${body}</div>${actions ? `<footer>${actions}</footer>` : ''}</section>`;
}

function confirmModal(title, message, onConfirm, confirmText = '确定') {
    pendingConfirmAction = onConfirm;
    showOverlay(title, `<div class="wx-confirm-message"><i class="fa-solid fa-circle-question"></i><p>${escapeHtml(message)}</p></div>`, `<button class="wx-button wx-quiet" data-action="close-overlay">取消</button><button class="wx-button wx-danger-button" data-action="confirm-modal">${escapeHtml(confirmText)}</button>`);
}

function folderModal(kind) {
    showOverlay('新建文件夹', `<div class="wx-form-stack"><label>文件夹名称<input id="wx-folder-name" maxlength="80" autofocus placeholder="输入名称"></label><fieldset class="wx-tag-picker"><legend>分类标签（选填）</legend>${tagOptions([], kind)}</fieldset></div>`, `<button class="wx-button wx-quiet" data-action="close-overlay">取消</button><button class="wx-button" data-action="create-folder" data-kind="${kind}">创建</button>`);
}

function templateSaveModal(sourceWorkspace = workspace, suggestedName = `文心模板 ${state.templates.length + 1}`, title = '保存为模板') {
    pendingTemplateWorkspace = sourceWorkspace;
    showOverlay(title, `<div class="wx-form-stack"><label>模板名称<input id="wx-template-name" maxlength="100" value="${escapeHtml(suggestedName)}" autofocus></label><label>保存到<select id="wx-template-folder">${folderOptions('template', currentFolder('template')?.id)}</select></label><fieldset class="wx-tag-picker"><legend>分类标签（选填）</legend>${tagOptions([], 'template')}</fieldset></div>`, `<button class="wx-button wx-quiet" data-action="close-overlay">取消</button><button class="wx-button" data-action="confirm-save-template">保存模板</button>`);
}

function bookletNameModal() {
    showOverlay('新建册子', `<div class="wx-form-stack"><label>册子名称<input id="wx-booklet-name" maxlength="100" value="我的册子 ${state.booklets.length + 1}" autofocus></label><fieldset class="wx-tag-picker"><legend>分类标签（选填）</legend>${tagOptions([], 'booklet')}</fieldset></div>`, `<button class="wx-button wx-quiet" data-action="close-overlay">取消</button><button class="wx-button" data-action="create-booklet">创建并编辑</button>`);
}

function readerLayerHtml(layer) {
    const border = layer.type === 'shape' ? '0 solid transparent' : `${layer.borderWidth || 0}px ${layer.borderStyle || 'solid'} ${colorWithOpacity(layer.borderColor, layer.borderOpacity ?? 1)}`;
    const common = `left:${layer.x}px;top:${layer.y}px;width:${layer.width}px;height:${layer.height}px;z-index:${layer.z};opacity:${layer.visible === false ? 0 : layer.opacity};transform:rotate(${layer.rotation || 0}deg);border:${border};border-radius:${layer.borderRadius || 0}px;`;
    let body;
    if (layer.type === 'text') {
        const displayContent = applyMaskRules(layer.content, layer.maskRules);
        const verticalPosition = layer.verticalAlign === 'middle' ? 'center' : layer.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start';
        body = `<div class="wx-layer-text wx-md" style="font-family:${escapeHtml(layer.fontFamily)};font-size:${layer.fontSize}px;font-weight:${layer.fontWeight || 400};line-height:${layer.lineHeight || 1.45};color:${layer.color};text-align:${layer.align};padding:${layer.padding || 0}px;writing-mode:${layer.writingMode || 'horizontal-tb'};justify-content:${verticalPosition};background:${layer.backgroundEnabled ? colorWithOpacity(layer.backgroundColor || '#ffffff', layer.backgroundOpacity ?? 1) : 'transparent'};">${layer.markdown ? markdown(displayContent) : escapeHtml(displayContent)}</div>`;
    } else if (layer.type === 'image') {
        if (layer.cropRect) body = croppedImageHtml(layer);
        else {
            const cropX = layer.cropX ?? 50, cropY = layer.cropY ?? 50, cropZoom = layer.cropZoom ?? 1;
            body = `<div class="wx-layer-image-clip"><img src="${escapeHtml(layer.source)}" alt="" draggable="false" style="object-fit:${layer.fit || 'cover'};object-position:${cropX}% ${cropY}%;transform:scale(${cropZoom});transform-origin:${cropX}% ${cropY}%"></div>`;
        }
    } else body = shapeSvg(layer);
    return `<div class="wx-reader-layer wx-layer-${layer.type}" style="${common}">${body}</div>`;
}

function renderBookReaderScale() {
    const page = dialog?.querySelector('.wx-book-reader-page');
    const sheet = dialog?.querySelector('.wx-book-reader-sheet');
    const stage = dialog?.querySelector('.wx-book-reader-stage');
    if (!page || !sheet || !stage) return;
    const width = Number(stage.dataset.width) || 1;
    const height = Number(stage.dataset.height) || 1;
    const edge = window.matchMedia('(max-width: 760px)').matches ? 4 : 28;
    const scale = Math.max(0.01, Math.min(Math.max(1, page.clientWidth - edge) / width, Math.max(1, page.clientHeight - edge) / height));
    sheet.style.width = `${width * scale}px`;
    sheet.style.height = `${height * scale}px`;
    stage.style.transform = `scale(${scale})`;
}

function attachBookReaderResize() {
    bookReaderResizeObserver?.disconnect();
    const page = dialog?.querySelector('.wx-book-reader-page');
    if (!page || typeof ResizeObserver === 'undefined') return;
    bookReaderResizeObserver = new ResizeObserver(() => requestAnimationFrame(renderBookReaderScale));
    bookReaderResizeObserver.observe(page);
}

function bookReaderIsFullscreen() {
    return document.fullscreenElement === dialog || document.webkitFullscreenElement === dialog || dialog?.classList.contains('is-reader-expanded');
}

function updateBookReaderFullscreenButton() {
    const button = dialog?.querySelector('[data-action="toggle-reader-fullscreen"]');
    if (!button) return;
    const active = bookReaderIsFullscreen();
    button.classList.toggle('is-active', active);
    button.title = active ? '退出全屏' : '全屏阅览';
    button.setAttribute('aria-label', button.title);
    button.innerHTML = `<i class="fa-solid ${active ? 'fa-compress' : 'fa-expand'}"></i>`;
    requestAnimationFrame(renderBookReaderScale);
}

function setBookReaderChromeVisible(visible) {
    const reader = dialog?.querySelector('.wx-gallery-reader');
    if (!reader) return;
    reader.classList.toggle('is-clean', !visible);
    const page = reader.querySelector('.wx-book-reader-page');
    if (page) page.title = visible ? '轻点页面进入纯净阅览，左右滑动翻页' : '轻点页面显示操作界面，左右滑动翻页';
    requestAnimationFrame(renderBookReaderScale);
}

function toggleBookReaderChrome() {
    const reader = dialog?.querySelector('.wx-gallery-reader');
    if (!reader) return;
    setBookReaderChromeVisible(reader.classList.contains('is-clean'));
}

function handleBookReaderFullscreenChange() {
    setBookReaderChromeVisible(!bookReaderIsFullscreen());
    updateBookReaderFullscreenButton();
}

async function toggleBookReaderFullscreen() {
    if (!dialog?.querySelector('.wx-gallery-reader')) return;
    const nativeFullscreen = document.fullscreenElement === dialog || document.webkitFullscreenElement === dialog;
    if (nativeFullscreen) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
    } else if (dialog.classList.contains('is-reader-expanded')) {
        dialog.classList.remove('is-reader-expanded');
    } else {
        const request = dialog.requestFullscreen || dialog.webkitRequestFullscreen;
        if (request) {
            try {
                await request.call(dialog, { navigationUI: 'hide' });
            } catch {
                dialog.classList.add('is-reader-expanded');
            }
        } else {
            dialog.classList.add('is-reader-expanded');
        }
    }
    setBookReaderChromeVisible(!bookReaderIsFullscreen());
    updateBookReaderFullscreenButton();
}

function attachBookReaderSwipe(id, index, total) {
    const page = dialog?.querySelector('.wx-book-reader-page');
    if (!page) return;
    let startX = null;
    page.addEventListener('pointerdown', event => {
        startX = event.clientX;
        page.setPointerCapture(event.pointerId);
    });
    page.addEventListener('pointerup', event => {
        if (startX === null) return;
        const delta = event.clientX - startX;
        startX = null;
        if (delta < -50 && index < total - 1) bookletReaderModal(id, index + 1, 1);
        else if (delta > 50 && index > 0) bookletReaderModal(id, index - 1, -1);
        else if (Math.abs(delta) < 10) toggleBookReaderChrome();
    });
    page.addEventListener('pointercancel', () => { startX = null; });
}

function attachBookReaderKeyboard(id, index, total) {
    const reader = dialog?.querySelector('.wx-gallery-reader');
    if (!reader) return;
    reader.addEventListener('keydown', event => {
        if (event.target.closest('select, button')) return;
        if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); bookletReaderModal(id, index - 1, -1); }
        if (event.key === 'ArrowRight' && index < total - 1) { event.preventDefault(); bookletReaderModal(id, index + 1, 1); }
        if (event.key === 'Escape') closeOverlay();
    });
}

async function renderBookReaderThumbnails(booklet) {
    const targets = [...dialog.querySelectorAll('[data-reader-thumbnail]')];
    for (const target of targets) {
        const page = booklet.pages.find(item => item.id === target.dataset.readerThumbnail);
        if (!page?.workspace) continue;
        let source = bookReaderThumbnailCache.get(page.workspace);
        if (!source) {
            try {
                const canvas = await workspaceToCanvas(page.workspace, 0.14);
                source = canvas.toDataURL('image/jpeg', 0.82);
                bookReaderThumbnailCache.set(page.workspace, source);
            } catch {
                source = '';
            }
        }
        if (!target.isConnected) return;
        target.innerHTML = source ? `<img src="${source}" alt="">` : '<i class="fa-solid fa-file-image"></i>';
    }
}

function bookletReaderModal(id, requestedIndex = 0, direction = 0) {
    const booklet = state.booklets.find(item => item.id === id);
    if (!booklet?.pages.length) return notify('这本册子还没有页面。', 'warning');
    normaliseBookletPages(booklet);
    const index = Math.max(0, Math.min(booklet.pages.length - 1, Number(requestedIndex) || 0));
    const page = booklet.pages[index];
    const sourceWorkspace = page.workspace;
    const effect = Object.hasOwn(READER_TRANSITIONS, state.preferences.readerTransition) ? state.preferences.readerTransition : 'simulation';
    const animationClass = direction > 0 ? ` is-next effect-${effect}` : direction < 0 ? ` is-prev effect-${effect}` : '';
    const layers = [...sourceWorkspace.layers].sort((a, b) => a.z - b.z).map(readerLayerHtml).join('');
    const background = colorWithOpacity(sourceWorkspace.background || '#ffffff', sourceWorkspace.backgroundOpacity ?? 1);
    const transitionOptions = Object.entries(READER_TRANSITIONS).map(([value, label]) => `<option value="${value}" ${effect === value ? 'selected' : ''}>${label}</option>`).join('');
    const thumbnails = booklet.pages.map((item, pageIndex) => `<button class="wx-reader-thumbnail ${pageIndex === index ? 'is-active' : ''}" data-action="reader-page" data-id="${id}" data-current="${index}" data-index="${pageIndex}" title="${escapeHtml(item.name || `第 ${pageIndex + 1} 页`)}"><span data-reader-thumbnail="${item.id}" style="aspect-ratio:${item.workspace.width}/${item.workspace.height}"><i class="fa-solid fa-spinner fa-spin"></i></span><small>${pageIndex + 1}</small></button>`).join('');
    showOverlay('', `<div class="wx-gallery-reader" tabindex="0"><header class="wx-gallery-reader-head"><div><i class="fa-solid fa-book-open-reader"></i><span><strong>${escapeHtml(booklet.name)}</strong><small>${escapeHtml(page.name || `第 ${index + 1} 页`)}</small></span></div><label>翻页效果<select id="wx-reader-transition">${transitionOptions}</select></label><button data-action="toggle-reader-fullscreen" title="${bookReaderIsFullscreen() ? '退出全屏' : '全屏阅览'}" aria-label="${bookReaderIsFullscreen() ? '退出全屏' : '全屏阅览'}"><i class="fa-solid ${bookReaderIsFullscreen() ? 'fa-compress' : 'fa-expand'}"></i></button><button data-action="close-overlay" title="退出阅览" aria-label="退出阅览"><i class="fa-solid fa-xmark"></i></button></header><main class="wx-gallery-reader-main"><button class="wx-gallery-page-nav is-prev" data-action="reader-page" data-id="${id}" data-current="${index}" data-index="${index - 1}" title="上一页" ${index === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button><div class="wx-book-reader-page" title="左右滑动翻页"><div class="wx-book-reader-sheet${animationClass}"><div class="wx-book-reader-stage" data-width="${sourceWorkspace.width}" data-height="${sourceWorkspace.height}" style="width:${sourceWorkspace.width}px;height:${sourceWorkspace.height}px;background:${background};">${workspaceBackgroundHtml(sourceWorkspace)}${layers}</div></div></div><button class="wx-gallery-page-nav is-next" data-action="reader-page" data-id="${id}" data-current="${index}" data-index="${index + 1}" title="下一页" ${index === booklet.pages.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></main><footer class="wx-gallery-reader-foot"><div class="wx-reader-filmstrip">${thumbnails}</div><span>${index + 1} / ${booklet.pages.length}</span></footer></div>`);
    dialog.querySelector('#wx-overlay')?.classList.add('is-reader');
    dialog.querySelector('.wx-modal')?.classList.add('wx-reader-dialog');
    requestAnimationFrame(() => {
        renderBookReaderScale();
        const reader = dialog.querySelector('.wx-gallery-reader');
        reader?.focus({ preventScroll: true });
        dialog.querySelector('.wx-reader-thumbnail.is-active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    });
    attachBookReaderSwipe(id, index, booklet.pages.length);
    attachBookReaderKeyboard(id, index, booklet.pages.length);
    attachBookReaderResize();
    if (bookReaderIsFullscreen()) setBookReaderChromeVisible(false);
    updateBookReaderFullscreenButton();
    renderBookReaderThumbnails(booklet);
}

function selectedTagIds(container = dialog) {
    return [...container.querySelectorAll('.wx-tag-picker input:checked')].map(input => input.value);
}

function tagScopeForView() {
    return currentView === 'templates' ? 'template' : currentView === 'booklets' ? 'booklet' : 'gallery';
}

function tagScopeItems(scope) {
    return scope === 'gallery' ? [...state.folders.filter(item => item.kind === 'gallery'), ...state.images] : scope === 'template' ? [...state.folders.filter(item => item.kind === 'template'), ...state.templates] : [...state.booklets];
}

function tagUsageCount(id, scope) {
    return tagScopeItems(scope).filter(item => (item.tagIds || []).includes(id)).length;
}

function tagManagerModal(scope = tagScopeForView()) {
    const items = tagsForScope(scope).map(tag => `<div class="wx-tag-manage-row"><span class="wx-tag-badge">${escapeHtml(tag.name)}</span><small>${tagUsageCount(tag.id, scope)} 项</small><button data-action="delete-tag" data-id="${tag.id}" data-kind="${scope}" title="删除标签"><i class="fa-solid fa-trash"></i></button></div>`).join('');
    showOverlay(`${TAG_SCOPE_LABELS[scope]}标签管理`, `<div class="wx-tag-create"><input id="wx-new-tag-name" maxlength="40" placeholder="新标签名称"><button class="wx-button" data-action="create-tag" data-kind="${scope}"><i class="fa-solid fa-plus"></i> 添加</button></div><div class="wx-tag-manage-list">${items || emptyState('fa-tags', '还没有标签', `这里创建的标签只用于${TAG_SCOPE_LABELS[scope]}。`)}</div>`);
}

function findTaggable(kind, id) {
    if (kind === 'folder') return state.folders.find(item => item.id === id);
    if (kind === 'image') return state.images.find(item => item.id === id);
    if (kind === 'template') return state.templates.find(item => item.id === id);
    if (kind === 'booklet') return state.booklets.find(item => item.id === id);
}

function assignTagsModal(kind, id) {
    const item = findTaggable(kind, id);
    if (!item) return;
    const scope = kind === 'folder' ? item.kind : kind === 'image' ? 'gallery' : kind === 'template' ? 'template' : 'booklet';
    showOverlay(`设置标签 · ${escapeHtml(item.name)}`, `<fieldset class="wx-tag-picker"><legend>${TAG_SCOPE_LABELS[scope]}标签（可多选，也可全部不选）</legend>${tagOptions(item.tagIds || [], scope)}</fieldset>`, `<button class="wx-button wx-quiet" data-action="close-overlay">取消</button><button class="wx-button" data-action="save-assigned-tags" data-kind="${kind}" data-id="${id}">保存</button>`);
}

function closeOverlay() {
    const overlay = dialog?.querySelector('#wx-overlay');
    if (!overlay) return;
    const wasReader = overlay.classList.contains('is-reader');
    bookReaderResizeObserver?.disconnect();
    bookReaderResizeObserver = null;
    overlay.hidden = true;
    overlay.innerHTML = '';
    overlay.classList.remove('is-reader');
    delete overlay.dataset.overlayKind;
    delete overlay.dataset.overlayOwner;
    assetPickerCallback = null;
    pendingConfirmAction = null;
    pendingComposerLeaveAction = null;
    paperChoiceCallback = null;
    cropDraft = null;
    cropTarget = null;
    pendingTemplateWorkspace = null;
    if (wasReader) {
        dialog?.classList.remove('is-reader-expanded');
        if (document.fullscreenElement === dialog || document.webkitFullscreenElement === dialog) {
            const exit = document.exitFullscreen || document.webkitExitFullscreen;
            exit?.call(document).catch?.(() => {});
        }
    }
}

function quoteModal(item) {
    showOverlay(item ? '编辑摘录' : '新建摘录', `<label class="wx-modal-field">文字<textarea id="wx-quote-text" rows="9" autofocus>${escapeHtml(item?.text || '')}</textarea></label>`, `<button class="wx-button wx-quiet" data-action="close-overlay">取消</button><button class="wx-button" data-action="save-quote" data-id="${item?.id || ''}">保存</button>`);
}

function fontModal() {
    const fontCard = font => `<article class="wx-font-card${font.builtIn ? ' is-built-in' : ''}"><div style="font-family:${escapeHtml(font.family)}">文心 · Aa</div><strong>${escapeHtml(font.name)}</strong><span>${font.builtIn ? '内置字体' : font.kind === 'css' ? 'CSS 链接' : '字体文件'}</span>${font.builtIn ? '<i class="fa-solid fa-box-open" title="内置字体"></i>' : `<button data-action="delete-font" data-id="${font.id}" title="删除字体"><i class="fa-solid fa-trash"></i></button>`}</article>`;
    const builtInCards = BUILT_IN_FONTS.map(fontCard).join('');
    const customCards = state.fonts.map(fontCard).join('');
    showOverlay('字体库', `<div class="wx-font-import"><label>显示名称<input id="wx-font-name" placeholder="例如：自定义字体"></label><label>CSS/字体链接<input id="wx-font-url" type="url" placeholder="https://.../font.css 或 .woff2"></label><label>CSS 中的字体名<input id="wx-font-family" placeholder="例如：My Font"></label><span>或者</span><label class="wx-file-button"><i class="fa-solid fa-upload"></i> 上传字体文件<input id="wx-font-file" type="file" accept=".ttf,.otf,.woff,.woff2,font/*"></label><button class="wx-button" data-action="save-font">导入字体</button></div><div class="wx-font-list"><h3>内置字体</h3>${builtInCards}<h3>我的字体</h3>${customCards || '<p class="wx-font-empty">还没有导入自定义字体。</p>'}</div>`);
}

function imageModal() {
    showOverlay('导入图片', `<div class="wx-form-stack"><label>图片名称<input id="wx-image-name" placeholder="例如：米色纸张"></label><label>图片 URL<input id="wx-image-url" type="url" placeholder="https://..."></label><div class="wx-or"><span>或上传本地图片</span></div><label class="wx-file-button"><i class="fa-solid fa-upload"></i> 选择图片文件<input id="wx-image-file" type="file" accept="image/*"></label><label>保存到<select id="wx-image-folder">${folderOptions('gallery', currentFolder('gallery')?.id)}</select></label><fieldset class="wx-tag-picker"><legend>分类标签（选填）</legend>${tagOptions([], 'gallery')}</fieldset></div>`, `<button class="wx-button wx-quiet" data-action="close-overlay">取消</button><button class="wx-button" data-action="save-image">导入</button>`);
}

function paperModal(onChoose = null) {
    paperChoiceCallback = onChoose;
    const options = Object.entries(PAPER_PRESETS).map(([key, paper]) => `<button class="wx-paper-option" data-action="choose-paper" data-key="${key}"><span style="aspect-ratio:${paper.width}/${paper.height}"></span><strong>${paper.label}</strong><small>${paper.width} × ${paper.height}</small></button>`).join('');
    showOverlay('选择纸张', `<p class="wx-modal-intro">先确定画布比例，进入排版后仍可在齿轮设置中调整。</p><div class="wx-paper-grid">${options}</div><div class="wx-custom-paper"><strong>自定义尺寸</strong><label>宽<input id="wx-paper-width" type="number" min="240" max="4000" value="720"> px</label><label>高<input id="wx-paper-height" type="number" min="240" max="6000" value="1080"> px</label><button class="wx-button" data-action="choose-custom-paper">开始排版</button></div>`);
    const overlay = dialog.querySelector('#wx-overlay');
    overlay.dataset.overlayKind = 'paper';
    overlay.dataset.overlayOwner = currentView;
}

function chooseAssets(kind, callback, multiple = false) {
    assetPickerCallback = callback;
    const items = kind === 'library' ? state.library : state.images;
    const cards = items.map(item => kind === 'library'
        ? `<label class="wx-picker-quote"><input type="${multiple ? 'checkbox' : 'radio'}" name="wx-picker" value="${item.id}"><span>${escapeHtml(item.text)}</span></label>`
        : `<label class="wx-picker-image"><input type="radio" name="wx-picker" value="${item.id}"><img src="${escapeHtml(item.source)}" alt=""><span>${escapeHtml(item.name)}</span></label>`).join('');
    showOverlay(kind === 'library' ? '从文库导入' : '从图库选择', `<div class="wx-picker-grid">${cards || emptyState(kind === 'library' ? 'fa-book-open' : 'fa-images', '这里还是空的', '请先添加内容。')}</div>`, `<button class="wx-button wx-quiet" data-action="close-overlay">取消</button><button class="wx-button" data-action="confirm-picker" data-kind="${kind}" data-multiple="${multiple}">导入</button>`);
}

async function exportModal() {
    showOverlay('生成预览', `<div class="wx-preview-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>正在生成排版预览…</span></div>`);
    try {
        const canvas = await workspaceToCanvas(workspace);
        const preview = canvas.toDataURL('image/png');
        showOverlay('保存前预览', `<div class="wx-save-preview"><img src="${preview}" alt="排版预览"><span>${workspace.width} × ${workspace.height}px</span></div><div class="wx-export-options"><button data-action="save-template"><i class="fa-solid fa-layer-group"></i><strong>保存到模板库</strong><span>保留可编辑图层</span></button><button data-action="export-image"><i class="fa-solid fa-image"></i><strong>保存为 PNG 图片</strong><span>按画布原始尺寸导出</span></button></div>`);
    } catch (error) {
        showOverlay('预览生成失败', `<p class="wx-modal-intro">${escapeHtml(error.message)}。如果画布使用了外链图片，请改为上传到图库后重试。</p>`, `<button class="wx-button" data-action="close-overlay">返回编辑</button>`);
    }
}

function composerTemplateModal() {
    const cards = state.templates.map(template => `<label class="wx-template-pick"><input type="radio" name="wx-composer-template" value="${template.id}"><div style="background:${escapeHtml(template.workspace.background)}"><i class="fa-solid fa-layer-group"></i></div><strong>${escapeHtml(template.name)}</strong><span>${template.workspace.width} × ${template.workspace.height}</span></label>`).join('');
    showOverlay('从模板库导入', `<p class="wx-modal-intro">选择模板后将替换当前画布；模板中的快捷文本会自动匹配当前 SillyTavern 信息。</p><div class="wx-template-pick-grid">${cards || emptyState('fa-layer-group', '模板库为空', '请先在排版页保存模板。')}</div>`, `<button class="wx-button wx-quiet" data-action="close-overlay">取消</button><button class="wx-button" data-action="apply-composer-template">导入模板</button>`);
}

function applyComposerTemplate() {
    const templateId = dialog.querySelector('input[name="wx-composer-template"]:checked')?.value;
    const template = state.templates.find(item => item.id === templateId);
    if (!template) return notify('请先选择一个模板。', 'warning');
    workspace = templateWorkspace(template);
    workspace.layers.forEach(layer => {
        layer.id = uid(layer.type);
        if (layer.type === 'text') {
            layer.priority ??= layer.z || 1;
            layer.writingMode ??= 'horizontal-tb';
        }
    });
    selectedLayerId = null;
    inspectorOpen = false;
    composerSessionActive = true;
    delete state.preferences.composerDraft;
    closeOverlay();
    render();
}

function quickShareModal(text) {
    selectionText = text;
    const templates = state.templates.map(template => `<button data-action="share-template" data-id="${template.id}"><i class="fa-solid fa-layer-group"></i><strong>${escapeHtml(template.name)}</strong><span>${template.workspace.width} × ${template.workspace.height}</span></button>`).join('');
    showOverlay('选择分享版式', `<p class="wx-modal-intro">选中的文字会放入模板的第一个文字图层；若模板没有文字图层，将自动新建。</p><div class="wx-share-template-grid"><button data-action="share-blank"><i class="fa-solid fa-file"></i><strong>空白纸张</strong><span>720 × 1080</span></button>${templates}</div>`);
}

async function startShare(text) {
    await openApp('composer');
    if (state.templates.length) quickShareModal(text);
    else {
        workspace = createWorkspace();
        composerSessionActive = true;
        delete state.preferences.composerDraft;
        addText(text);
        render();
    }
}

async function handleClick(event) {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) {
        const targetView = viewButton.dataset.view;
        if (currentView === 'composer' && targetView !== 'composer') requestComposerLeave(() => navigateToView(targetView));
        else navigateToView(targetView);
        return;
    }
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id, kind, key } = button.dataset;
    if (mergeSelection && !['confirm-merge-layers', 'cancel-merge-layers'].includes(action)) return;
    if (action === 'close') closeApp();
    else if (action === 'home') {
        if (currentView === 'composer') requestComposerLeave(() => navigateToView('library'));
        else navigateToView('library');
    }
    else if (action === 'close-overlay') closeOverlay();
    else if (action === 'leave-composer-save') finishComposerLeave(true);
    else if (action === 'leave-composer-discard') finishComposerLeave(false);
    else if (action === 'confirm-modal') { const callback = pendingConfirmAction; pendingConfirmAction = null; closeOverlay(); callback?.(); }
    else if (action === 'apply-hex-color') applyHexInput(button.closest('.wx-color-control')?.querySelector('.wx-hex-color'));
    else if (action === 'new-quote') quoteModal();
    else if (action === 'edit-quote') quoteModal(state.library.find(item => item.id === id));
    else if (action === 'save-quote') saveQuoteFromModal(id);
    else if (action === 'delete-quote') deleteItem('library', id, '摘录');
    else if (action === 'compose-quote') composeQuotes([id]);
    else if (action === 'compose-selected') composeQuotes([...dialog.querySelectorAll('[data-select-quote]:checked')].map(input => input.dataset.selectQuote));
    else if (action === 'fonts') fontModal();
    else if (action === 'save-font') await saveFont();
    else if (action === 'delete-font') deleteFont(id);
    else if (action === 'add-image') imageModal();
    else if (action === 'save-image') await saveImage();
    else if (action === 'delete-image') deleteItem('images', id, '图片');
    else if (action === 'manage-tags') tagManagerModal(tagScopeForView());
    else if (action === 'create-tag') createTag(kind);
    else if (action === 'delete-tag') deleteTag(id, kind);
    else if (action === 'assign-tags') assignTagsModal(kind, id);
    else if (action === 'save-assigned-tags') saveAssignedTags(kind, id);
    else if (action === 'filter-tag') { activeTagFilters[kind] = id || null; render(); }
    else if (action === 'open-folder') { activeFolderIds[kind] = id || null; render(); }
    else if (action === 'new-folder') folderModal(kind);
    else if (action === 'create-folder') createFolder(kind);
    else if (action === 'delete-folder') deleteFolder(id);
    else if (action === 'choose-paper') choosePaper(PAPER_PRESETS[key]);
    else if (action === 'choose-custom-paper') chooseCustomPaper();
    else if (action === 'add-text') addText();
    else if (action === 'add-from-library') chooseAssets('library', items => addQuotesToWorkspace(items), true);
    else if (action === 'composer-template') composerTemplateModal();
    else if (action === 'apply-composer-template') applyComposerTemplate();
    else if (action === 'add-from-gallery') chooseAssets('gallery', items => addImageToWorkspace(items[0]));
    else if (action === 'add-shape') shapeModal();
    else if (action === 'add-shape-kind') addShape(kind);
    else if (action === 'add-mask') addMask();
    else if (action === 'apply-mask-style') applyMaskStyle(button.dataset.style);
    else if (action === 'add-smart-text') addSmartText(kind);
    else if (action === 'workspace-background-image') chooseWorkspaceBackgroundImage();
    else if (action === 'remove-workspace-background-image') removeWorkspaceBackgroundImage();
    else if (action === 'text-background-image') chooseTextBackgroundImage();
    else if (action === 'crop-image') await cropImageModal();
    else if (action === 'apply-image-crop') applyImageCrop();
    else if (action === 'crop-workspace') await cropWorkspaceModal();
    else if (action === 'apply-workspace-crop') applyWorkspaceCrop();
    else if (action === 'merge-layers') mergeLayersModal();
    else if (action === 'confirm-merge-layers') mergeSelectedLayers();
    else if (action === 'cancel-merge-layers') cancelMergeSelection();
    else if (action === 'ungroup-layers') ungroupLayers();
    else if (action === 'confirm-picker') confirmPicker(kind, button.dataset.multiple === 'true');
    else if (action === 'select-layer') { selectedLayerId = id; setInspectorOpen(true); renderStage(); renderInspector(); }
    else if (action === 'toggle-layer') toggleLayer(id);
    else if (action === 'align-layer') alignLayer(button.dataset.position);
    else if (action === 'align-text') alignText(button.dataset.position);
    else if (action === 'apply-text-style') applyTextStyle(button.dataset.style);
    else if (action === 'close-inspector') { selectedLayerId = null; setInspectorOpen(false); renderStage(); }
    else if (action === 'toggle-settings') { const shouldOpen = !inspectorOpen || selectedLayerId !== null; selectedLayerId = null; setInspectorOpen(shouldOpen); if (shouldOpen) renderInspector(); renderStage(); }
    else if (action === 'reset-stage-view') resetStageView();
    else if (action === 'exit-composer') requestComposerLeave(() => {
        selectedLayerId = null;
        setInspectorOpen(false);
        navigateToView('library');
    });
    else if (action === 'layer-up') moveLayer(1);
    else if (action === 'layer-down') moveLayer(-1);
    else if (action === 'delete-layer') deleteLayer();
    else if (action === 'undo-reset') resetWorkspace();
    else if (action === 'export-menu') await exportModal();
    else if (action === 'save-template') templateSaveModal();
    else if (action === 'confirm-save-template') saveTemplateFromModal();
    else if (action === 'export-image') await exportWorkspaceImage(workspace, '文心排版.png');
    else if (action === 'share-blank') { workspace = createWorkspace(); composerSessionActive = true; delete state.preferences.composerDraft; addText(selectionText); closeOverlay(); render(); }
    else if (action === 'share-template') shareWithTemplate(id);
    else if (action === 'use-template') useTemplate(id);
    else if (action === 'export-template') exportTemplateModal(id);
    else if (action === 'export-template-image') await exportTemplateImage(id);
    else if (action === 'export-template-json') exportTemplateJson(id);
    else if (action === 'import-template') importTemplate();
    else if (action === 'delete-template') deleteItem('templates', id, '模板');
    else if (action === 'delete-selected-templates') deleteSelectedTemplates();
    else if (action === 'new-booklet') bookletNameModal();
    else if (action === 'create-booklet') createBooklet();
    else if (action === 'view-booklet') bookletReaderModal(id, 0);
    else if (action === 'reader-page') {
        const targetIndex = Number(button.dataset.index);
        bookletReaderModal(id, targetIndex, targetIndex - Number(button.dataset.current));
    }
    else if (action === 'toggle-reader-fullscreen') await toggleBookReaderFullscreen();
    else if (action === 'export-booklet-json') exportBookletJson(id);
    else if (action === 'import-booklet-json') importBookletJson();
    else if (action === 'edit-booklet') openBooklet(id);
    else if (action === 'exit-booklet-editor') { activeBookletId = null; activeBookPageId = null; selectedLayerId = null; setInspectorOpen(false); currentView = 'booklets'; render(); }
    else if (action === 'select-book-page') selectBookPage(id);
    else if (action === 'book-new-page') addBlankBookPage();
    else if (action === 'book-page-to-template') saveBookPageAsTemplateModal(id);
    else if (action === 'book-save-page') { touchActiveBooklet(); selectedLayerId = null; setInspectorOpen(false); render(); notify('本页已保存。'); }
    else if (action === 'delete-booklet') deleteItem('booklets', id, '册子');
    else if (action === 'book-add-template') addBookAssets('template');
    else if (action === 'book-add-gallery') addBookAssets('gallery');
    else if (action === 'delete-book-page') deleteBookPage(id);
    else if (action === 'export-book-images') await exportBookImages();
    else if (action === 'export-book-pdf') await exportBookPdf();
}

function handleInput(event) {
    if (event.target.id === 'wx-library-search') {
        const query = event.target.value.trim().toLocaleLowerCase();
        dialog.querySelectorAll('.wx-quote-card').forEach(card => card.hidden = !card.textContent.toLocaleLowerCase().includes(query));
        return;
    }
    const prop = event.target.dataset.layerProp;
    if (prop) {
        const layer = workspace.layers.find(item => item.id === selectedLayerId);
        if (!layer) return;
        let value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
        if (event.target.type === 'number' || event.target.type === 'range') value = Number(value);
        layer[prop] = value;
        if (prop === 'fontSize') {
            delete layer.textStyle;
            dialog.querySelectorAll('.wx-text-style-presets button').forEach(button => button.classList.remove('is-active'));
        }
        renderStage();
        touchActiveBooklet();
        scheduleSave();
        return;
    }
    const workspaceProp = event.target.dataset.workspace;
    if (workspaceProp) {
        workspace[workspaceProp] = event.target.type === 'number' ? Math.max(240, Number(event.target.value)) : event.target.type === 'range' ? Number(event.target.value) : event.target.value;
        if (workspaceProp === 'backgroundImageFit') delete workspace.backgroundImageViewport;
        touchActiveBooklet();
        renderStage();
        scheduleSave();
    }
}

async function handleChange(event) {
    if (event.target.id === 'wx-reader-transition') {
        const value = event.target.value;
        if (Object.hasOwn(READER_TRANSITIONS, value)) {
            state.preferences.readerTransition = value;
            scheduleSave();
        }
        return;
    }
    const colorScope = event.target.dataset.colorScope || event.target.dataset.colorPickerScope;
    const colorProp = event.target.dataset.colorProp;
    if (colorScope && colorProp) {
        commitColor(colorScope, colorProp, event.target.value, event.target.closest('.wx-color-control'));
        return;
    }
    if (event.target.id === 'wx-book-upload') {
        const booklet = getActiveBooklet();
        if (!booklet) return;
        let lastPage;
        for (const file of event.target.files) {
            const imagePage = { id: uid('page'), kind: 'image', name: file.name, source: await fileToDataUrl(file) };
            imagePage.workspace = imagePageWorkspace(imagePage);
            imagePage.kind = 'workspace';
            delete imagePage.source;
            booklet.pages.push(imagePage);
            lastPage = imagePage;
        }
        if (lastPage) selectBookPage(lastPage.id);
        touchActiveBooklet();
        render();
    }
}

function saveQuoteFromModal(id) {
    const text = dialog.querySelector('#wx-quote-text')?.value.trim();
    if (!text) return notify('请先填写摘录文字。', 'warning');
    const item = state.library.find(entry => entry.id === id);
    if (item) { item.text = text; item.updatedAt = Date.now(); }
    else state.library.unshift({ id: uid('quote'), text, createdAt: Date.now(), updatedAt: Date.now(), source: 'manual' });
    scheduleSave();
    closeOverlay();
    render();
}

function deleteItem(collection, id, label) {
    const item = state[collection].find(entry => entry.id === id);
    if (!item) return;
    confirmModal(`删除${label}`, `确定删除“${item.name || item.text?.slice(0, 16) || label}”吗？`, () => {
        state[collection] = state[collection].filter(entry => entry.id !== id);
        scheduleSave();
        if (collection === 'booklets') activeBookletId = null;
        render();
    }, '删除');
}

function composeQuotes(ids) {
    const quotes = ids.map(id => state.library.find(item => item.id === id)).filter(Boolean);
    if (!quotes.length) return notify('请先选择至少一条摘录。', 'warning');
    workspace = createWorkspace();
    composerSessionActive = true;
    delete state.preferences.composerDraft;
    addQuotesToWorkspace(quotes);
    currentView = 'composer';
    closeOverlay();
    render();
}

function addQuotesToWorkspace(quotes) {
    for (const [index, quote] of quotes.entries()) {
        const layer = makeTextLayer(quote.text);
        layer.y = 60 + index * 210;
        layer.height = 180;
        workspace.layers.push(layer);
        selectedLayerId = layer.id;
    }
    closeOverlay();
    if (currentView === 'composer') { renderStage(); renderInspector(); }
}

async function saveFont() {
    const name = dialog.querySelector('#wx-font-name').value.trim();
    const url = dialog.querySelector('#wx-font-url').value.trim();
    const familyInput = dialog.querySelector('#wx-font-family').value.trim();
    const file = dialog.querySelector('#wx-font-file').files[0];
    if (!name || (!url && !file)) return notify('请填写名称并提供链接或字体文件。', 'warning');
    const family = familyInput || `WenXin ${name}`;
    const source = file ? await fileToDataUrl(file) : url;
    const kind = file || !/\.css(?:[?#]|$)/i.test(url) ? 'font' : 'css';
    state.fonts.push({ id: uid('font'), name, family, source, kind, createdAt: Date.now() });
    applyFonts();
    scheduleSave();
    fontModal();
    notify(`字体“${name}”已导入。`);
}

function deleteFont(id) {
    state.fonts = state.fonts.filter(font => font.id !== id);
    applyFonts();
    scheduleSave();
    fontModal();
}

async function saveImage() {
    const name = dialog.querySelector('#wx-image-name').value.trim();
    const url = dialog.querySelector('#wx-image-url').value.trim();
    const file = dialog.querySelector('#wx-image-file').files[0];
    const folderId = dialog.querySelector('#wx-image-folder').value || null;
    if (!url && !file) return notify('请填写图片 URL 或选择图片文件。', 'warning');
    const source = file ? await fileToDataUrl(file) : url;
    state.images.unshift({ id: uid('image'), name: name || file?.name || '未命名图片', source, folderId, tagIds: selectedTagIds(), createdAt: Date.now() });
    scheduleSave();
    closeOverlay();
    render();
}

function createFolder(kind) {
    const name = dialog.querySelector('#wx-folder-name')?.value.trim();
    if (!name) return notify('请填写文件夹名称。', 'warning');
    const folder = { id: uid('folder'), kind, name, tagIds: selectedTagIds() };
    state.folders.push(folder);
    activeFolderIds[kind] = folder.id;
    scheduleSave();
    closeOverlay();
    render();
}

function createTag(scope) {
    const name = dialog.querySelector('#wx-new-tag-name')?.value.trim();
    if (!name) return notify('请填写标签名称。', 'warning');
    if (!TAG_SCOPE_LABELS[scope]) return;
    if (state.tags.some(tag => tag.kind === scope && tag.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return notify(`${TAG_SCOPE_LABELS[scope]}中已经存在这个标签。`, 'warning');
    state.tags.push({ id: uid('tag'), name, kind: scope });
    scheduleSave();
    render();
    tagManagerModal(scope);
}

function deleteTag(id, scope) {
    const tag = state.tags.find(item => item.id === id);
    if (!tag) return;
    confirmModal('删除标签', `删除标签“${tag.name}”？文件和文件夹本身不会被删除。`, () => {
        state.tags = state.tags.filter(item => item.id !== id);
        for (const collection of [state.folders, state.images, state.templates, state.booklets]) {
            collection.forEach(item => item.tagIds = (item.tagIds || []).filter(tagId => tagId !== id));
        }
        if (activeTagFilters.gallery === id) activeTagFilters.gallery = null;
        if (activeTagFilters.template === id) activeTagFilters.template = null;
        if (activeTagFilters.booklet === id) activeTagFilters.booklet = null;
        scheduleSave();
        render();
        tagManagerModal(scope || tag.kind);
    }, '删除标签');
}

function saveAssignedTags(kind, id) {
    const item = findTaggable(kind, id);
    if (!item) return;
    item.tagIds = selectedTagIds();
    scheduleSave();
    closeOverlay();
    render();
}

function deleteFolder(id) {
    const folder = state.folders.find(item => item.id === id);
    if (!folder) return;
    confirmModal('删除文件夹', `删除“${folder.name}”后，其中内容会移到未分类。`, () => {
        state.images.forEach(image => { if (image.folderId === id) image.folderId = null; });
        state.templates.forEach(template => { if (template.folderId === id) template.folderId = null; });
        state.folders.forEach(item => { if (item.parentId === id) item.parentId = null; });
        state.folders = state.folders.filter(item => item.id !== id);
        if (activeFolderIds[folder.kind] === id) activeFolderIds[folder.kind] = null;
        scheduleSave(); render();
    }, '删除');
}

function choosePaper(paper) {
    const chosenWorkspace = createWorkspace(paper.width, paper.height);
    const callback = paperChoiceCallback;
    paperChoiceCallback = null;
    if (callback) callback(chosenWorkspace);
    else {
        workspace = chosenWorkspace;
        composerSessionActive = true;
        delete state.preferences.composerDraft;
    }
    selectedLayerId = null;
    inspectorOpen = false;
    closeOverlay();
    render();
}

function chooseCustomPaper() {
    const width = Math.max(240, Math.min(4000, Number(dialog.querySelector('#wx-paper-width').value) || 720));
    const height = Math.max(240, Math.min(6000, Number(dialog.querySelector('#wx-paper-height').value) || 1080));
    choosePaper({ width, height });
}

function addText(text) {
    const layer = makeTextLayer(text);
    workspace.layers.push(layer);
    selectedLayerId = layer.id;
    setInspectorOpen(true);
    touchActiveBooklet();
    renderStage();
    renderInspector();
}

function addImageToWorkspace(image) {
    if (!image) return;
    const layer = makeImageLayer(image);
    workspace.layers.push(layer);
    selectedLayerId = layer.id;
    setInspectorOpen(true);
    touchActiveBooklet();
    closeOverlay();
    renderStage();
    renderInspector();
}

function shapeModal() {
    showOverlay('添加基础图形', `<div class="wx-shape-grid"><button data-action="add-shape-kind" data-kind="rectangle"><span class="wx-shape-demo rectangle"></span><strong>长方形</strong></button><button data-action="add-shape-kind" data-kind="circle"><span class="wx-shape-demo circle"></span><strong>圆形</strong></button><button data-action="add-shape-kind" data-kind="ellipse"><span class="wx-shape-demo ellipse"></span><strong>椭圆</strong></button><button data-action="add-shape-kind" data-kind="line"><span class="wx-shape-demo line"></span><strong>直线</strong></button><button data-action="add-shape-kind" data-kind="dashed-line"><span class="wx-shape-demo dashed"></span><strong>虚线</strong></button></div><p class="wx-hint">添加后可在图层属性中切换填充状态、颜色、线型和线条粗细。</p>`);
}

function addShape(kind) {
    const layer = makeShapeLayer(kind);
    workspace.layers.push(layer);
    selectedLayerId = layer.id;
    setInspectorOpen(true);
    touchActiveBooklet();
    closeOverlay();
    renderStage();
    renderInspector();
}

function chooseTextBackgroundImage() {
    const textId = selectedLayerId;
    const textLayer = workspace.layers.find(item => item.id === textId && item.type === 'text');
    if (!textLayer) return notify('请先选择文字图层。', 'warning');
    chooseAssets('gallery', items => addTextBackgroundImage(textId, items[0]));
}

function chooseWorkspaceBackgroundImage() {
    chooseAssets('gallery', items => {
        const image = items[0];
        if (!image) return;
        workspace.backgroundImage = image.source;
        workspace.backgroundImageId = image.id;
        workspace.backgroundImageFit ||= 'cover';
        delete workspace.backgroundImageViewport;
        workspace.backgroundImageOpacity ??= 1;
        touchActiveBooklet();
        scheduleSave();
        closeOverlay();
        renderStage();
        renderInspector();
        notify('纸张背景图片已更新。');
    });
}

function removeWorkspaceBackgroundImage() {
    delete workspace.backgroundImage;
    delete workspace.backgroundImageId;
    delete workspace.backgroundImageViewport;
    touchActiveBooklet();
    scheduleSave();
    renderStage();
    renderInspector();
    notify('纸张背景图片已移除。', 'info');
}

function addSmartText(kind) {
    const definition = SMART_TEXT_DEFINITIONS[kind];
    if (!definition) return;
    const resolved = substituteParams(definition.macro);
    const layer = makeTextLayer(resolved || definition.macro);
    layer.name = definition.name;
    layer.smartTextKind = kind;
    layer.smartTextMacro = definition.macro;
    layer.height = 120;
    layer.width = Math.min(420, Math.max(220, workspace.width - 120));
    workspace.layers.push(layer);
    selectedLayerId = layer.id;
    setInspectorOpen(true);
    touchActiveBooklet();
    scheduleSave();
    renderStage();
    renderInspector();
    notify(`已创建${definition.name}文本框。`);
}

function addTextBackgroundImage(textId, image) {
    const textLayer = workspace.layers.find(item => item.id === textId);
    if (!textLayer || !image) return;
    const background = makeImageLayer(image);
    background.name = `${textLayer.name}背景`;
    background.x = textLayer.x;
    background.y = textLayer.y;
    background.width = textLayer.width;
    background.height = textLayer.height;
    const ordered = [...workspace.layers].sort((a, b) => a.z - b.z);
    ordered.splice(Math.max(0, ordered.findIndex(item => item.id === textId)), 0, background);
    ordered.forEach((item, index) => item.z = index + 1);
    workspace.layers = ordered;
    selectedLayerId = background.id;
    setInspectorOpen(true);
    touchActiveBooklet();
    scheduleSave();
    closeOverlay();
    renderStage();
    renderInspector();
    notify('背景图片已作为独立图层添加到文字下方。');
}

async function cropImageModal() {
    const layer = workspace.layers.find(item => item.id === selectedLayerId && item.type === 'image');
    if (!layer) return notify('请先选择图片图层。', 'warning');
    showOverlay('裁剪图片', `<div class="wx-preview-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>正在载入原图…</span></div>`);
    try {
        cropTarget = 'image';
        const image = await imageFromSource(layer.source);
        if (layer.cropRect) cropDraft = clone(layer.cropRect);
        else {
            const zoom = Math.max(1, layer.cropZoom || 1);
            const imageRatio = image.naturalWidth / image.naturalHeight;
            const boxRatio = layer.width / layer.height;
            let width = 1, height = 1;
            if ((layer.fit || 'cover') === 'cover') {
                if (imageRatio > boxRatio) width = boxRatio / imageRatio;
                else height = imageRatio / boxRatio;
            }
            width /= zoom; height /= zoom;
            cropDraft = { x: (1 - width) * ((layer.cropX ?? 50) / 100), y: (1 - height) * ((layer.cropY ?? 50) / 100), width, height };
        }
        cropDraft.sourceWidth = image.naturalWidth;
        cropDraft.sourceHeight = image.naturalHeight;
        showOverlay('在原图上框选裁剪区域', `<p class="wx-modal-intro">拖动框内区域可移动裁剪框，拖动四角可自由调整宽窄和高度。</p><div class="wx-crop-image-stage" style="aspect-ratio:${image.naturalWidth}/${image.naturalHeight}"><img src="${escapeHtml(layer.source)}" alt="原图"><div class="wx-crop-selection"><span class="wx-crop-grid"></span>${['nw', 'ne', 'sw', 'se'].map(direction => `<button data-crop-handle="${direction}" aria-label="调整${direction}角"></button>`).join('')}</div></div>`, `<button class="wx-button wx-quiet" data-action="close-overlay">取消</button><button class="wx-button" data-action="apply-image-crop">应用裁剪</button>`);
        updateCropSelection();
        attachCropSelection();
    } catch (error) {
        showOverlay('图片载入失败', `<p class="wx-modal-intro">${escapeHtml(error.message)}</p>`, `<button class="wx-button" data-action="close-overlay">返回</button>`);
    }
}

function updateCropSelection() {
    const selection = dialog.querySelector('.wx-crop-selection');
    if (!selection || !cropDraft) return;
    selection.style.left = `${cropDraft.x * 100}%`;
    selection.style.top = `${cropDraft.y * 100}%`;
    selection.style.width = `${cropDraft.width * 100}%`;
    selection.style.height = `${cropDraft.height * 100}%`;
}

function attachCropSelection() {
    const selection = dialog.querySelector('.wx-crop-selection');
    const stage = dialog.querySelector('.wx-crop-image-stage');
    if (!selection || !stage) return;
    selection.addEventListener('pointerdown', event => {
        event.preventDefault();
        const handle = event.target.closest('[data-crop-handle]')?.dataset.cropHandle;
        const bounds = stage.getBoundingClientRect();
        const start = { pointerX: event.clientX, pointerY: event.clientY, ...cropDraft };
        selection.setPointerCapture(event.pointerId);
        const move = moveEvent => {
            const dx = (moveEvent.clientX - start.pointerX) / bounds.width;
            const dy = (moveEvent.clientY - start.pointerY) / bounds.height;
            if (!handle) {
                cropDraft.x = Math.max(0, Math.min(1 - start.width, start.x + dx));
                cropDraft.y = Math.max(0, Math.min(1 - start.height, start.y + dy));
            } else {
                const right = start.x + start.width, bottom = start.y + start.height;
                if (handle.includes('w')) { cropDraft.x = Math.max(0, Math.min(right - 0.02, start.x + dx)); cropDraft.width = right - cropDraft.x; }
                if (handle.includes('e')) cropDraft.width = Math.max(0.02, Math.min(1 - start.x, start.width + dx));
                if (handle.includes('n')) { cropDraft.y = Math.max(0, Math.min(bottom - 0.02, start.y + dy)); cropDraft.height = bottom - cropDraft.y; }
                if (handle.includes('s')) cropDraft.height = Math.max(0.02, Math.min(1 - start.y, start.height + dy));
            }
            updateCropSelection();
        };
        const end = () => {
            selection.removeEventListener('pointermove', move);
            selection.removeEventListener('pointerup', end);
            selection.removeEventListener('pointercancel', end);
        };
        selection.addEventListener('pointermove', move);
        selection.addEventListener('pointerup', end);
        selection.addEventListener('pointercancel', end);
    });
}

function applyImageCrop() {
    const layer = workspace.layers.find(item => item.id === selectedLayerId && item.type === 'image');
    if (!layer || !cropDraft || cropTarget !== 'image') return;
    layer.cropRect = clone(cropDraft);
    delete layer.cropX; delete layer.cropY; delete layer.cropZoom;
    cropDraft = null;
    cropTarget = null;
    touchActiveBooklet();
    scheduleSave();
    closeOverlay();
    renderStage();
    renderInspector();
}

async function cropWorkspaceModal() {
    showOverlay('裁切画布', `<div class="wx-preview-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>正在生成画布预览…</span></div>`);
    try {
        const canvas = await workspaceToCanvas(workspace);
        const source = canvas.toDataURL('image/png');
        cropTarget = 'workspace';
        cropDraft = { x: 0, y: 0, width: 1, height: 1, sourceWidth: workspace.width, sourceHeight: workspace.height };
        showOverlay('在画布上框选保留区域', `<p class="wx-modal-intro">操作方式与图片裁剪一致：拖动框内区域可移动裁剪框，拖动四角可调整宽高。应用后纸张尺寸会改为所选区域，所有图层会同步平移。</p><div class="wx-crop-image-stage" style="aspect-ratio:${workspace.width}/${workspace.height}"><img src="${source}" alt="画布预览"><div class="wx-crop-selection"><span class="wx-crop-grid"></span>${['nw', 'ne', 'sw', 'se'].map(direction => `<button data-crop-handle="${direction}" aria-label="调整${direction}角"></button>`).join('')}</div></div>`, `<button class="wx-button wx-quiet" data-action="close-overlay">取消</button><button class="wx-button" data-action="apply-workspace-crop">应用裁切</button>`);
        updateCropSelection();
        attachCropSelection();
    } catch (error) {
        cropDraft = null;
        cropTarget = null;
        showOverlay('画布预览失败', `<p class="wx-modal-intro">${escapeHtml(error.message)}</p>`, `<button class="wx-button" data-action="close-overlay">返回</button>`);
    }
}

function applyWorkspaceCrop() {
    if (!cropDraft || cropTarget !== 'workspace') return;
    const left = Math.round(cropDraft.x * cropDraft.sourceWidth);
    const top = Math.round(cropDraft.y * cropDraft.sourceHeight);
    const width = Math.round(cropDraft.width * cropDraft.sourceWidth);
    const height = Math.round(cropDraft.height * cropDraft.sourceHeight);
    if (width < 240 || height < 240) return notify('画布裁切后的宽度和高度不能小于 240px。', 'warning');
    const oldWidth = workspace.width, oldHeight = workspace.height;
    workspace.layers.forEach(layer => { layer.x -= left; layer.y -= top; });
    if (workspace.backgroundImage) {
        const previous = workspace.backgroundImageViewport;
        workspace.backgroundImageViewport = previous
            ? { ...previous, x: previous.x - left, y: previous.y - top }
            : { x: -left, y: -top, width: oldWidth, height: oldHeight, fit: workspace.backgroundImageFit || 'cover' };
    }
    workspace.width = width;
    workspace.height = height;
    cropDraft = null;
    cropTarget = null;
    stageViewStates.delete(workspace);
    selectedLayerId = null;
    setInspectorOpen(false);
    touchActiveBooklet();
    scheduleSave();
    closeOverlay();
    render();
    notify(`画布已裁切为 ${width} × ${height}px。`);
}

function addMask() {
    showOverlay('匹配文字并打码', `<label class="wx-modal-field">需要打码的原文字<input id="wx-mask-target" autocomplete="off" placeholder="例如：真实姓名"></label><p class="wx-hint">选择样式后，会在当前页面的所有文字图层中精确匹配这段文字，并直接显示遮罩。编辑文字时仍可看到原文。</p><div class="wx-mask-grid wx-mask-grid-compact"><button data-action="apply-mask-style" data-style="bar"><span class="wx-mask-demo bar">敏感文字</span><strong>黑条</strong></button><button data-action="apply-mask-style" data-style="dots"><span class="wx-mask-demo">••••••</span><strong>圆点</strong></button><button data-action="apply-mask-style" data-style="blocks"><span class="wx-mask-demo blocks">■■■■■■</span><strong>方块</strong></button></div>`);
}

function applyMaskStyle(style) {
    const target = dialog.querySelector('#wx-mask-target')?.value;
    if (!target) return notify('请先填写需要打码的文字。', 'warning');
    const matches = workspace.layers.filter(layer => layer.type === 'text' && String(layer.content).includes(target));
    if (!matches.length) return notify('当前页面的文字图层中没有找到这段文字。', 'warning');
    for (const layer of matches) {
        layer.maskRules ||= [];
        const existing = layer.maskRules.find(rule => rule.target === target);
        if (existing) existing.style = style;
        else layer.maskRules.push({ target, style });
    }
    touchActiveBooklet();
    scheduleSave();
    closeOverlay();
    renderStage();
    renderInspector();
    notify(`已在 ${matches.length} 个文字图层中完成匹配打码。`);
}

function confirmPicker(kind, multiple) {
    const checked = [...dialog.querySelectorAll('.wx-picker-grid input:checked')].map(input => input.value);
    if (!checked.length) return notify('请先选择内容。', 'warning');
    const source = kind === 'library' ? state.library : state.images;
    const values = checked.map(id => source.find(item => item.id === id)).filter(Boolean);
    const callback = assetPickerCallback;
    assetPickerCallback = null;
    callback?.(multiple ? values : values.slice(0, 1));
}

function toggleLayer(id) {
    const layer = workspace.layers.find(item => item.id === id);
    if (!layer) return;
    layer.visible = layer.visible === false;
    touchActiveBooklet();
    renderStage();
    renderInspector();
}

function moveLayer(direction) {
    const layers = selectedLayers();
    if (!layers.length) return notify('请先选择一个图层。', 'warning');
    const selectedIds = new Set(layers.map(layer => layer.id));
    const ordered = [...workspace.layers].sort((a, b) => a.z - b.z);
    if (direction > 0) {
        for (let index = ordered.length - 2; index >= 0; index -= 1) {
            if (selectedIds.has(ordered[index].id) && !selectedIds.has(ordered[index + 1].id)) {
                [ordered[index], ordered[index + 1]] = [ordered[index + 1], ordered[index]];
            }
        }
    } else {
        for (let index = 1; index < ordered.length; index += 1) {
            if (selectedIds.has(ordered[index].id) && !selectedIds.has(ordered[index - 1].id)) {
                [ordered[index], ordered[index - 1]] = [ordered[index - 1], ordered[index]];
            }
        }
    }
    ordered.forEach((item, index) => item.z = index + 1);
    workspace.layers = ordered;
    touchActiveBooklet();
    scheduleSave();
    renderStage(); renderInspector();
}

function alignLayer(position) {
    const layer = workspace.layers.find(item => item.id === selectedLayerId);
    if (!layer) return notify('请先选择一个图层。', 'warning');
    if (position === 'left') layer.x = 0;
    if (position === 'hcenter') layer.x = (workspace.width - layer.width) / 2;
    if (position === 'right') layer.x = workspace.width - layer.width;
    if (position === 'top') layer.y = 0;
    if (position === 'vcenter') layer.y = (workspace.height - layer.height) / 2;
    if (position === 'bottom') layer.y = workspace.height - layer.height;
    layer.x = Math.max(0, layer.x);
    layer.y = Math.max(0, layer.y);
    touchActiveBooklet();
    renderStage();
}

function alignText(position) {
    const layer = workspace.layers.find(item => item.id === selectedLayerId && item.type === 'text');
    if (!layer) return notify('请先选择一个文本框。', 'warning');
    if (['left', 'center', 'right'].includes(position)) layer.align = position;
    if (['top', 'middle', 'bottom'].includes(position)) layer.verticalAlign = position;
    touchActiveBooklet();
    renderStage();
    scheduleSave();
}

function applyTextStyle(style) {
    const layer = workspace.layers.find(item => item.id === selectedLayerId && item.type === 'text');
    const preset = Object.hasOwn(TEXT_STYLE_PRESETS, style) ? TEXT_STYLE_PRESETS[style] : null;
    if (!layer || !preset) return;
    layer.textStyle = style;
    layer.fontSize = preset.fontSize;
    layer.fontWeight = preset.fontWeight;
    layer.lineHeight = preset.lineHeight;
    touchActiveBooklet();
    scheduleSave();
    renderStage();
    renderInspector();
}

function deleteLayer() {
    const ids = new Set(selectedLayers().map(layer => layer.id));
    if (!ids.size) return notify('请先选择一个图层。', 'warning');
    workspace.layers = workspace.layers.filter(layer => !ids.has(layer.id));
    selectedLayerId = null;
    setInspectorOpen(false);
    touchActiveBooklet();
    renderStage(); renderInspector();
}

function mergeLayersModal() {
    const current = selectedLayer();
    if (!current) return notify('请先选择一个图层。', 'warning');
    mergeSelection = { anchorId: current.id, ids: new Set([current.id]) };
    setInspectorOpen(false);
    renderStage();
}

function mergeSelectedLayers() {
    const checkedIds = [...(mergeSelection?.ids || [])];
    if (checkedIds.length < 2) return notify('请至少再选择一个图层。', 'warning');
    const selectedGroups = new Set(workspace.layers.filter(layer => checkedIds.includes(layer.id) && layer.groupId).map(layer => layer.groupId));
    const groupId = uid('group');
    const members = workspace.layers.filter(layer => checkedIds.includes(layer.id) || selectedGroups.has(layer.groupId));
    members.forEach(layer => layer.groupId = groupId);
    selectedLayerId = members[0]?.id || null;
    mergeSelection = null;
    touchActiveBooklet();
    scheduleSave();
    renderStage();
    renderInspector();
    notify(`已合并 ${members.length} 个图层。`);
}

function cancelMergeSelection() {
    if (!mergeSelection) return;
    selectedLayerId = mergeSelection.anchorId;
    mergeSelection = null;
    renderStage();
    renderInspector();
    notify('已取消本次合并选择。', 'info');
}

function ungroupLayers() {
    const layers = selectedLayers();
    if (layers.length < 2 || !layers[0].groupId) return;
    layers.forEach(layer => delete layer.groupId);
    selectedLayerId = layers[0].id;
    touchActiveBooklet();
    scheduleSave();
    renderStage();
    renderInspector();
    notify('已取消合并。', 'info');
}

function resetWorkspace() {
    confirmModal('清空画布', '确定清空当前画布上的全部图层吗？', () => {
        workspace.layers = [];
        mergeSelection = null;
        selectedLayerId = null;
        setInspectorOpen(false);
        touchActiveBooklet();
        render();
    }, '清空');
}

function saveTemplateFromModal() {
    const name = dialog.querySelector('#wx-template-name')?.value.trim();
    const folderId = dialog.querySelector('#wx-template-folder')?.value || null;
    if (!name) return notify('请填写模板名称。', 'warning');
    const savedWorkspace = clone(pendingTemplateWorkspace || workspace);
    savedWorkspace.layers.forEach(layer => smartTextDefinition(layer) && resolveSmartTextLayer(layer));
    state.templates.unshift({ id: uid('template'), name, folderId, tagIds: selectedTagIds(), workspace: savedWorkspace, createdAt: Date.now() });
    scheduleSave(); closeOverlay(); notify(`模板“${name}”已保存。`);
}

function saveBookPageAsTemplateModal(id) {
    const booklet = getActiveBooklet();
    const page = booklet?.pages.find(item => item.id === id);
    if (!page?.workspace) return notify('找不到这个册页。', 'warning');
    templateSaveModal(page.workspace, page.name || '册子页模板', '添加册页到模板库');
}

function useTemplate(id) {
    const template = state.templates.find(item => item.id === id);
    if (!template) return;
    workspace = templateWorkspace(template);
    composerSessionActive = true;
    delete state.preferences.composerDraft;
    workspace.layers.forEach(layer => layer.id = uid(layer.type));
    selectedLayerId = null;
    currentView = 'composer';
    render();
}

function shareWithTemplate(id) {
    const template = state.templates.find(item => item.id === id);
    if (!template) return;
    workspace = templateWorkspace(template);
    composerSessionActive = true;
    delete state.preferences.composerDraft;
    workspace.layers.forEach(layer => layer.id = uid(layer.type));
    const textLayer = workspace.layers.find(layer => layer.type === 'text' && !smartTextDefinition(layer));
    if (textLayer) textLayer.content = selectionText;
    else addText(selectionText);
    selectedLayerId = textLayer?.id || selectedLayerId;
    closeOverlay();
    render();
}

function cleanTemplate(template) {
    const exportedWorkspace = clone(template.workspace);
    exportedWorkspace.layers.forEach(layer => {
        const match = smartTextDefinition(layer);
        if (!match) return;
        layer.smartTextKind = match[0];
        layer.smartTextMacro = match[1].macro;
    });
    return { format: 'wenxin-template', version: 2, name: template.name, workspace: exportedWorkspace };
}

function exportTemplateModal(id) {
    const template = state.templates.find(item => item.id === id);
    if (!template) return;
    showOverlay('导出模板', `<p class="wx-modal-intro">选择“图片”可分享排版成品；选择“JSON”可保留图层、宏匹配与全部可编辑信息。</p><div class="wx-export-options"><button data-action="export-template-image" data-id="${template.id}"><i class="fa-solid fa-image"></i><strong>导出图片</strong><span>PNG · 按模板原始尺寸生成</span></button><button data-action="export-template-json" data-id="${template.id}"><i class="fa-solid fa-file-code"></i><strong>导出 JSON</strong><span>保留可编辑图层与快捷宏</span></button></div>`, `<button class="wx-button wx-quiet" data-action="close-overlay">取消</button>`);
}

async function exportTemplateImage(id) {
    const template = state.templates.find(item => item.id === id);
    if (!template) return;
    await exportWorkspaceImage(template.workspace, `${template.name}.png`);
}

function exportTemplateJson(id) {
    const template = state.templates.find(item => item.id === id);
    if (!template) return;
    downloadBlob(new Blob([JSON.stringify(cleanTemplate(template), null, 2)], { type: 'application/json' }), `${template.name}.wenxin.json`);
    closeOverlay();
    notify('模板 JSON 已导出。');
}

function importTemplate() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,.wenxin.json'; input.multiple = true;
    input.onchange = async () => {
        let count = 0;
        for (const file of input.files) {
            try {
                const data = JSON.parse(await file.text());
                if (data.format !== 'wenxin-template' || !data.workspace?.layers) throw new Error('格式不正确');
                const importedWorkspace = resolveWorkspaceSmartText(normaliseImportedWorkspace(data.workspace));
                state.templates.unshift({ id: uid('template'), name: data.name || file.name.replace(/\.wenxin\.json$/i, ''), folderId: null, tagIds: [], workspace: importedWorkspace, createdAt: Date.now() });
                count++;
            } catch (error) { notify(`${file.name}：${error.message}`, 'error'); }
        }
        scheduleSave(); render(); notify(`已导入 ${count} 个模板。`);
    };
    input.click();
}

function deleteSelectedTemplates() {
    const ids = [...dialog.querySelectorAll('[data-select-template]:checked')].map(input => input.dataset.selectTemplate);
    if (!ids.length) return notify('请先勾选模板。', 'warning');
    confirmModal('批量删除模板', `确定删除选中的 ${ids.length} 个模板吗？`, () => {
        state.templates = state.templates.filter(template => !ids.includes(template.id));
        scheduleSave(); render();
    }, '全部删除');
}

function createBooklet() {
    const name = dialog.querySelector('#wx-booklet-name')?.value.trim();
    if (!name) return notify('请填写册子名称。', 'warning');
    const booklet = { id: uid('book'), name, pages: [], tagIds: selectedTagIds(), createdAt: Date.now(), updatedAt: Date.now() };
    state.booklets.unshift(booklet);
    activeBookletId = booklet.id;
    activeBookPageId = null;
    currentView = 'booklet-editor';
    scheduleSave();
    closeOverlay();
    render();
}

function cleanBooklet(booklet) {
    return {
        format: 'wenxin-booklet',
        version: 1,
        name: booklet.name,
        pages: clone(booklet.pages),
    };
}

function exportBookletJson(id) {
    const booklet = state.booklets.find(item => item.id === id);
    if (!booklet) return;
    normaliseBookletPages(booklet);
    const blob = new Blob([JSON.stringify(cleanBooklet(booklet), null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${booklet.name}.wenxin-booklet.json`);
    notify('册子 JSON 已导出，可分享给其他文心用户。');
}

function normaliseImportedWorkspace(source) {
    if (!source || !Number.isFinite(Number(source.width)) || !Number.isFinite(Number(source.height)) || !Array.isArray(source.layers)) throw new Error('册页画布格式不正确');
    const imported = clone(source);
    imported.width = Math.max(240, Number(imported.width));
    imported.height = Math.max(240, Number(imported.height));
    imported.version ||= 1;
    imported.background ||= '#f5efe5';
    imported.backgroundOpacity = Math.max(0, Math.min(1, Number(imported.backgroundOpacity ?? 1)));
    if (imported.backgroundImageViewport) {
        const viewport = imported.backgroundImageViewport;
        const fit = ['cover', 'contain', 'fill'].includes(viewport.fit) ? viewport.fit : 'cover';
        imported.backgroundImageViewport = {
            x: Number(viewport.x) || 0,
            y: Number(viewport.y) || 0,
            width: Math.max(1, Number(viewport.width) || imported.width),
            height: Math.max(1, Number(viewport.height) || imported.height),
            fit,
        };
    }
    imported.layers.sort((a, b) => (Number(a.z) || 0) - (Number(b.z) || 0));
    const importedGroupIds = new Map();
    imported.layers.forEach((layer, index) => {
        if (!['text', 'image', 'shape'].includes(layer.type)) throw new Error('包含不支持的图层类型');
        layer.id = uid(layer.type);
        layer.z = index + 1;
        layer.x = Number.isFinite(Number(layer.x)) ? Number(layer.x) : 0;
        layer.y = Number.isFinite(Number(layer.y)) ? Number(layer.y) : 0;
        layer.width = Math.max(40, Number(layer.width) || 200);
        layer.height = Math.max(40, Number(layer.height) || 120);
        layer.opacity = Math.max(0, Math.min(1, Number(layer.opacity) || 0));
        if (layer.opacity === 0 && source.layers[index].opacity == null) layer.opacity = 1;
        layer.rotation = Number(layer.rotation) || 0;
        layer.visible = layer.visible !== false;
        if (layer.groupId) {
            const sourceGroupId = String(layer.groupId);
            if (!importedGroupIds.has(sourceGroupId)) importedGroupIds.set(sourceGroupId, uid('group'));
            layer.groupId = importedGroupIds.get(sourceGroupId);
        } else delete layer.groupId;
        if (layer.type === 'text') {
            layer.content = String(layer.content || '');
            layer.fontFamily = String(layer.fontFamily || 'serif').replace(/[;"'<>]/g, '');
            layer.fontSize = Math.max(8, Number(layer.fontSize) || 36);
            layer.fontWeight = Math.max(100, Math.min(900, Number(layer.fontWeight) || 400));
            layer.lineHeight = Math.max(0.8, Math.min(3, Number(layer.lineHeight) || 1.45));
            if (!Object.hasOwn(TEXT_STYLE_PRESETS, layer.textStyle)) delete layer.textStyle;
            const match = smartTextDefinition(layer);
            if (match) {
                layer.smartTextKind = match[0];
                layer.smartTextMacro = match[1].macro;
            } else {
                delete layer.smartTextKind;
                delete layer.smartTextMacro;
            }
        }
        if (layer.type === 'image') layer.source = String(layer.source || '');
    });
    return imported;
}

function importBookletJson() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,.wenxin-booklet.json'; input.multiple = true;
    input.onchange = async () => {
        let count = 0;
        for (const file of input.files) {
            try {
                const data = JSON.parse(await file.text());
                if (data.format !== 'wenxin-booklet' || !Array.isArray(data.pages)) throw new Error('不是有效的文心册子文件');
                const pages = data.pages.map((page, index) => {
                    if (page.kind !== 'workspace' || !page.workspace) throw new Error(`第 ${index + 1} 页格式不正确`);
                    return { id: uid('page'), kind: 'workspace', name: page.name || `第 ${index + 1} 页`, workspace: normaliseImportedWorkspace(page.workspace) };
                });
                state.booklets.unshift({ id: uid('book'), name: data.name || file.name.replace(/\.wenxin-booklet\.json$/i, ''), pages, tagIds: [], createdAt: Date.now(), updatedAt: Date.now() });
                count++;
            } catch (error) {
                notify(`${file.name}：${error.message}`, 'error');
            }
        }
        scheduleSave();
        render();
        notify(`已导入 ${count} 本册子，可直接阅览或编辑。`);
    };
    input.click();
}

function openBooklet(id) {
    const booklet = state.booklets.find(item => item.id === id);
    if (!booklet) return;
    activeBookletId = id;
    normaliseBookletPages(booklet);
    activeBookPageId = booklet.pages[0]?.id || null;
    if (booklet.pages[0]) workspace = booklet.pages[0].workspace;
    selectedLayerId = null;
    inspectorOpen = false;
    currentView = 'booklet-editor';
    render();
}

function addBookAssets(type) {
    const booklet = getActiveBooklet();
    if (!booklet) return;
    if (type === 'template') {
        const body = state.templates.map(template => `<label class="wx-picker-quote"><input type="checkbox" value="${template.id}"><span>${escapeHtml(template.name)} · ${template.workspace.width}×${template.workspace.height}</span></label>`).join('');
        showOverlay('添加模板页面', `<div class="wx-picker-grid">${body || emptyState('fa-layer-group', '模板库为空', '请先保存模板。')}</div>`, `<button class="wx-button" id="wx-book-confirm-assets">添加页面</button>`);
        dialog.querySelector('#wx-book-confirm-assets')?.addEventListener('click', () => {
            let lastPage;
            for (const input of dialog.querySelectorAll('.wx-picker-grid input:checked')) {
                const template = state.templates.find(item => item.id === input.value);
                if (!template) continue;
                lastPage = { id: uid('page'), kind: 'workspace', name: template.name, workspace: templateWorkspace(template) };
                lastPage.workspace.layers.forEach(layer => layer.id = uid(layer.type));
                booklet.pages.push(lastPage);
            }
            if (!lastPage) return notify('请先选择模板。', 'warning');
            activeBookPageId = lastPage.id; workspace = lastPage.workspace; selectedLayerId = null; inspectorOpen = false;
            touchActiveBooklet(); closeOverlay(); render();
        });
    } else {
        const body = state.images.map(image => `<label class="wx-picker-image"><input type="checkbox" value="${image.id}"><img src="${escapeHtml(image.source)}" alt=""><span>${escapeHtml(image.name)}</span></label>`).join('');
        showOverlay('添加图库页面', `<div class="wx-picker-grid">${body || emptyState('fa-images', '图库为空', '请先导入图片。')}</div>`, `<button class="wx-button" id="wx-book-confirm-assets">添加页面</button>`);
        dialog.querySelector('#wx-book-confirm-assets')?.addEventListener('click', () => {
            let lastPage;
            for (const input of dialog.querySelectorAll('.wx-picker-grid input:checked')) {
                const image = state.images.find(item => item.id === input.value);
                if (!image) continue;
                lastPage = { id: uid('page'), kind: 'image', name: image.name, source: image.source };
                lastPage.workspace = imagePageWorkspace(lastPage); lastPage.kind = 'workspace'; delete lastPage.source;
                booklet.pages.push(lastPage);
            }
            if (!lastPage) return notify('请先选择图片。', 'warning');
            activeBookPageId = lastPage.id; workspace = lastPage.workspace; selectedLayerId = null; inspectorOpen = false;
            touchActiveBooklet(); closeOverlay(); render();
        });
    }
}

function touchActiveBooklet() {
    const booklet = getActiveBooklet();
    if (!booklet) return;
    bookletPreviewCache.delete(booklet.id);
    booklet.updatedAt = Date.now();
    scheduleSave();
}

function selectBookPage(id) {
    const booklet = getActiveBooklet();
    const page = booklet?.pages.find(item => item.id === id);
    if (!page) return;
    activeBookPageId = id;
    workspace = page.workspace;
    selectedLayerId = null;
    inspectorOpen = false;
    render();
}

function addBlankBookPage() {
    paperModal(pageWorkspace => {
        const booklet = getActiveBooklet();
        if (!booklet) return;
        const page = { id: uid('page'), kind: 'workspace', name: `第 ${booklet.pages.length + 1} 页`, workspace: pageWorkspace };
        booklet.pages.push(page);
        activeBookPageId = page.id;
        workspace = page.workspace;
        touchActiveBooklet();
    });
}

function deleteBookPage(id) {
    const booklet = getActiveBooklet();
    if (!booklet) return;
    const pageIndex = booklet.pages.findIndex(page => page.id === id);
    if (pageIndex < 0) return;
    confirmModal('删除册页', `确定删除第 ${pageIndex + 1} 页吗？`, () => {
        booklet.pages.splice(pageIndex, 1);
        const nextPage = booklet.pages[Math.min(pageIndex, booklet.pages.length - 1)];
        activeBookPageId = nextPage?.id || null;
        if (nextPage) workspace = nextPage.workspace;
        selectedLayerId = null; inspectorOpen = false;
        touchActiveBooklet(); render();
    }, '删除本页');
}

function handleDragStart(event) {
    const item = event.target.closest('[data-drag-kind]');
    if (!item) return;
    event.dataTransfer.setData('application/x-wenxin', JSON.stringify({ kind: item.dataset.dragKind, id: item.dataset.id }));
    event.dataTransfer.effectAllowed = 'move';
}

function handleDrop(event) {
    const raw = event.dataTransfer.getData('application/x-wenxin');
    if (!raw) return;
    const source = JSON.parse(raw);
    const folder = event.target.closest('.wx-folder');
    const rootTarget = event.target.closest('[data-folder-drop]');
    if ((folder || rootTarget) && ['template', 'image'].includes(source.kind)) {
        const collection = source.kind === 'template' ? state.templates : state.images;
        const item = collection.find(entry => entry.id === source.id);
        const targetFolder = folder ? state.folders.find(entry => entry.id === folder.dataset.id) : null;
        const targetKind = source.kind === 'template' ? 'template' : 'gallery';
        if (item && rootTarget && rootTarget.dataset.kind === targetKind) item.folderId = null;
        else if (item && targetFolder && targetFolder.kind === targetKind) item.folderId = targetFolder.id;
    } else if (source.kind === 'book-page') {
        const target = event.target.closest('[data-drag-kind="book-page"]');
        const booklet = state.booklets.find(item => item.id === activeBookletId);
        if (target && booklet) {
            const from = booklet.pages.findIndex(page => page.id === source.id);
            const to = booklet.pages.findIndex(page => page.id === target.dataset.id);
            const [page] = booklet.pages.splice(from, 1); booklet.pages.splice(to, 0, page); touchActiveBooklet(); render();
        }
    } else if (source.kind === 'layer-list') {
        const target = event.target.closest('[data-drag-kind="layer-list"]');
        if (target && target.dataset.id !== source.id) {
            const ordered = [...workspace.layers].sort((a, b) => b.z - a.z);
            const from = ordered.findIndex(layer => layer.id === source.id);
            const to = ordered.findIndex(layer => layer.id === target.dataset.id);
            if (from >= 0 && to >= 0) {
                const [layer] = ordered.splice(from, 1);
                ordered.splice(to, 0, layer);
                ordered.forEach((item, index) => item.z = ordered.length - index);
                workspace.layers = ordered;
                selectedLayerId = null;
                inspectorOpen = true;
                touchActiveBooklet();
            }
        }
    }
    scheduleSave();
    if (!dialog.querySelector('.wx-modal:not([hidden])')) render();
}

function imageFromSource(source) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        if (!String(source).startsWith('data:')) image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('图片无法载入或未允许跨域访问'));
        image.src = source;
    });
}

function wrapText(context, text, maxWidth) {
    const lines = [];
    for (const paragraph of String(text).replace(/\r/g, '').split('\n')) {
        let line = '';
        for (const character of paragraph) {
            if (context.measureText(line + character).width > maxWidth && line) { lines.push(line); line = character; }
            else line += character;
        }
        lines.push(line || ' ');
    }
    return lines;
}

function plainMarkdown(text) {
    return String(text).replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_~`>#-]/g, '');
}

function drawImageInBox(context, image, fit, width, height) {
    if (fit === 'fill') {
        context.drawImage(image, 0, 0, width, height);
        return;
    }
    const imageAspect = image.naturalWidth / image.naturalHeight;
    const boxAspect = width / height;
    if (fit === 'contain') {
        const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
        const drawWidth = image.naturalWidth * scale, drawHeight = image.naturalHeight * scale;
        context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
        return;
    }
    let sx = 0, sy = 0, sw = image.naturalWidth, sh = image.naturalHeight;
    if (imageAspect > boxAspect) {
        sw = image.naturalHeight * boxAspect;
        sx = (image.naturalWidth - sw) / 2;
    } else {
        sh = image.naturalWidth / boxAspect;
        sy = (image.naturalHeight - sh) / 2;
    }
    context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
}

function drawCroppedImage(context, image, layer) {
    const crop = layer.cropRect;
    let sx = image.naturalWidth * crop.x;
    let sy = image.naturalHeight * crop.y;
    let sw = image.naturalWidth * crop.width;
    let sh = image.naturalHeight * crop.height;
    const fit = layer.fit || 'cover';
    if (fit === 'contain') {
        const scale = Math.min(layer.width / sw, layer.height / sh);
        const width = sw * scale, height = sh * scale;
        context.drawImage(image, sx, sy, sw, sh, (layer.width - width) / 2, (layer.height - height) / 2, width, height);
        return;
    }
    if (fit === 'cover') {
        const cropAspect = sw / sh;
        const boxAspect = layer.width / layer.height;
        if (cropAspect > boxAspect) {
            const nextWidth = sh * boxAspect;
            sx += (sw - nextWidth) / 2;
            sw = nextWidth;
        } else {
            const nextHeight = sw / boxAspect;
            sy += (sh - nextHeight) / 2;
            sh = nextHeight;
        }
    }
    context.drawImage(image, sx, sy, sw, sh, 0, 0, layer.width, layer.height);
}

async function workspaceToCanvas(sourceWorkspace, pixelRatio = 1) {
    await document.fonts.ready;
    const fontLayers = sourceWorkspace.layers.filter(layer => layer.type === 'text');
    await Promise.all(fontLayers.map(layer => document.fonts.load(`${layer.fontWeight || 400} ${Math.max(8, layer.fontSize || 16)}px ${JSON.stringify(resolvedFontFamily(layer.fontFamily))}`).catch(() => [])));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sourceWorkspace.width * pixelRatio); canvas.height = Math.round(sourceWorkspace.height * pixelRatio);
    const context = canvas.getContext('2d');
    context.scale(pixelRatio, pixelRatio);
    context.clearRect(0, 0, sourceWorkspace.width, sourceWorkspace.height);
    context.save();
    context.globalAlpha = sourceWorkspace.backgroundOpacity ?? 1;
    context.fillStyle = sourceWorkspace.background || '#ffffff';
    context.fillRect(0, 0, sourceWorkspace.width, sourceWorkspace.height);
    context.restore();
    if (sourceWorkspace.backgroundImage) {
        const backgroundImage = await imageFromSource(sourceWorkspace.backgroundImage);
        context.save();
        context.globalAlpha = sourceWorkspace.backgroundImageOpacity ?? 1;
        const viewport = sourceWorkspace.backgroundImageViewport;
        if (viewport) {
            context.translate(viewport.x, viewport.y);
            drawImageInBox(context, backgroundImage, viewport.fit || sourceWorkspace.backgroundImageFit || 'cover', viewport.width, viewport.height);
        } else drawImageInBox(context, backgroundImage, sourceWorkspace.backgroundImageFit || 'cover', sourceWorkspace.width, sourceWorkspace.height);
        context.restore();
    }
    for (const layer of [...sourceWorkspace.layers].filter(item => item.visible !== false).sort((a, b) => a.z - b.z)) {
        context.save();
        context.globalAlpha = layer.opacity ?? 1;
        context.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
        context.rotate((layer.rotation || 0) * Math.PI / 180);
        context.translate(-layer.width / 2, -layer.height / 2);
        if (layer.borderWidth) {
            context.strokeStyle = colorWithOpacity(layer.borderColor, layer.borderOpacity ?? 1); context.lineWidth = layer.borderWidth;
            if (layer.borderStyle === 'dashed') context.setLineDash([layer.borderWidth * 3, layer.borderWidth * 2]);
            if (layer.borderStyle === 'dotted') { context.setLineDash([layer.borderWidth, layer.borderWidth * 1.6]); context.lineCap = 'round'; }
            context.strokeRect(layer.borderWidth / 2, layer.borderWidth / 2, layer.width - layer.borderWidth, layer.height - layer.borderWidth);
            if (layer.borderStyle === 'double' && layer.borderWidth >= 3) {
                const inset = layer.borderWidth * 1.5;
                context.lineWidth = Math.max(1, layer.borderWidth / 3);
                context.strokeRect(inset, inset, layer.width - inset * 2, layer.height - inset * 2);
            }
            context.setLineDash([]); context.lineCap = 'butt';
        }
        if (layer.type === 'shape') {
            const lineWidth = Math.max(0.1, Number(layer.strokeWidth) || 0.1);
            context.lineWidth = lineWidth;
            context.strokeStyle = layer.strokeColor || '#332b26';
            context.fillStyle = layer.fillColor || '#d9a38f';
            if (layer.strokeStyle === 'dashed') context.setLineDash([lineWidth * 3, lineWidth * 2]);
            if (layer.strokeStyle === 'dotted') { context.setLineDash([lineWidth, lineWidth * 1.8]); context.lineCap = 'round'; }
            context.beginPath();
            if (layer.shapeKind === 'circle' || layer.shapeKind === 'ellipse') context.ellipse(layer.width / 2, layer.height / 2, Math.max(0, layer.width / 2 - lineWidth / 2), Math.max(0, layer.height / 2 - lineWidth / 2), 0, 0, Math.PI * 2);
            else if (layer.shapeKind === 'line' || layer.shapeKind === 'dashed-line') { context.moveTo(lineWidth / 2, layer.height / 2); context.lineTo(layer.width - lineWidth / 2, layer.height / 2); }
            else context.rect(lineWidth / 2, lineWidth / 2, Math.max(0, layer.width - lineWidth), Math.max(0, layer.height - lineWidth));
            if (layer.fillEnabled && layer.shapeKind !== 'line' && layer.shapeKind !== 'dashed-line') context.fill();
            context.stroke();
            context.setLineDash([]); context.lineCap = 'butt';
        } else if (layer.type === 'image') {
            const image = await imageFromSource(layer.source);
            const imageRatio = image.naturalWidth / image.naturalHeight;
            const boxRatio = layer.width / layer.height;
            let sx = 0, sy = 0, sw = image.naturalWidth, sh = image.naturalHeight;
            if (layer.cropRect) {
                drawCroppedImage(context, image, layer);
            } else if (layer.fit === 'cover') {
                if (imageRatio > boxRatio) sw = image.naturalHeight * boxRatio;
                else sh = image.naturalWidth / boxRatio;
                const zoom = Math.max(1, layer.cropZoom || 1);
                sw /= zoom; sh /= zoom;
                const cropX = Math.max(0, Math.min(1, (layer.cropX ?? 50) / 100));
                const cropY = Math.max(0, Math.min(1, (layer.cropY ?? 50) / 100));
                sx = (image.naturalWidth - sw) * cropX;
                sy = (image.naturalHeight - sh) * cropY;
                context.drawImage(image, sx, sy, sw, sh, 0, 0, layer.width, layer.height);
            } else if (layer.fit === 'contain') {
                const ratio = Math.min(layer.width / image.naturalWidth, layer.height / image.naturalHeight);
                const width = image.naturalWidth * ratio, height = image.naturalHeight * ratio;
                const x = layer.align === 'left' ? 0 : layer.align === 'right' ? layer.width - width : (layer.width - width) / 2;
                context.drawImage(image, x, (layer.height - height) / 2, width, height);
            } else context.drawImage(image, 0, 0, layer.width, layer.height);
        } else {
            const padding = layer.padding || 0;
            if (layer.backgroundEnabled) {
                context.save();
                context.globalAlpha = (layer.opacity ?? 1) * (layer.backgroundOpacity ?? 1);
                context.fillStyle = layer.backgroundColor || '#ffffff';
                context.fillRect(0, 0, layer.width, layer.height);
                context.restore();
            }
            context.font = `${layer.fontWeight || 400} ${layer.fontSize}px ${JSON.stringify(resolvedFontFamily(layer.fontFamily))}`;
            context.fillStyle = layer.color || '#000000';
            context.textBaseline = 'top'; context.textAlign = layer.align || 'left';
            const maskedContent = applyMaskRules(layer.content, layer.maskRules);
            const plainText = layer.markdown ? plainMarkdown(maskedContent) : maskedContent;
            if (layer.writingMode === 'vertical-rl') {
                context.textAlign = 'center';
                const step = layer.fontSize * (layer.lineHeight || 1.35);
                let x = layer.width - padding - layer.fontSize / 2;
                const availableHeight = Math.max(0, layer.height - padding * 2);
                const charactersPerColumn = Math.max(1, Math.floor(availableHeight / step));
                const firstColumnLength = Math.min(charactersPerColumn, String(plainText).split('\n')[0].length);
                const firstColumnHeight = firstColumnLength * step;
                let y = layer.verticalAlign === 'middle' ? padding + Math.max(0, (availableHeight - firstColumnHeight) / 2) : layer.verticalAlign === 'bottom' ? layer.height - padding - firstColumnHeight : padding;
                for (const character of String(plainText)) {
                    if (character === '\n' || y + layer.fontSize > layer.height - padding) { x -= step; y = padding; if (character === '\n') continue; }
                    if (x < padding) break;
                    context.fillText(character, x, y);
                    y += step;
                }
            } else {
                const lines = wrapText(context, plainText, layer.width - padding * 2);
                const x = layer.align === 'center' ? layer.width / 2 : layer.align === 'right' ? layer.width - padding : padding;
                const lineHeight = layer.fontSize * (layer.lineHeight || 1.45);
                const textHeight = lines.length * lineHeight;
                const availableHeight = Math.max(0, layer.height - padding * 2);
                const startY = layer.verticalAlign === 'middle' ? padding + Math.max(0, (availableHeight - textHeight) / 2) : layer.verticalAlign === 'bottom' ? Math.max(padding, layer.height - padding - textHeight) : padding;
                lines.forEach((line, index) => context.fillText(line, x, startY + index * lineHeight));
            }
        }
        context.restore();
    }
    return canvas;
}

async function exportWorkspaceImage(sourceWorkspace, filename, shouldDownload = true) {
    try {
        const canvas = await workspaceToCanvas(sourceWorkspace);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (shouldDownload) { downloadBlob(blob, filename); closeOverlay(); notify('图片已导出。'); }
        return blob;
    } catch (error) {
        notify(`${error.message}。若使用外链图片，请改为上传到图库后再导出。`, 'error');
        throw error;
    }
}

async function deflateBytes(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function canvasToPdfImage(canvas, pageWidth, pageHeight) {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const rgb = new Uint8Array(canvas.width * canvas.height * 3);
    for (let source = 0, target = 0; source < rgba.length; source += 4) {
        const alpha = rgba[source + 3] / 255;
        rgb[target++] = Math.round(rgba[source] * alpha + 255 * (1 - alpha));
        rgb[target++] = Math.round(rgba[source + 1] * alpha + 255 * (1 - alpha));
        rgb[target++] = Math.round(rgba[source + 2] * alpha + 255 * (1 - alpha));
    }
    const compressed = await deflateBytes(rgb);
    if (compressed) return { bytes: compressed, width: canvas.width, height: canvas.height, pageWidth, pageHeight, filter: 'FlateDecode' };
    const dataUrl = canvas.toDataURL('image/jpeg', 1);
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), character => character.charCodeAt(0));
    return { bytes, width: canvas.width, height: canvas.height, pageWidth, pageHeight, filter: 'DCTDecode' };
}

async function pageToPdfImage(page) {
    let canvas;
    let pageWidth, pageHeight;
    if (page.kind === 'workspace') {
        const maxPixels = 24_000_000;
        const ratio = Math.min(2, Math.max(0.5, Math.sqrt(maxPixels / (page.workspace.width * page.workspace.height))));
        canvas = await workspaceToCanvas(page.workspace, ratio);
        pageWidth = page.workspace.width; pageHeight = page.workspace.height;
    }
    else {
        const image = await imageFromSource(page.source);
        canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        pageWidth = image.naturalWidth; pageHeight = image.naturalHeight;
    }
    return canvasToPdfImage(canvas, pageWidth, pageHeight);
}

function createPdf(images) {
    const encoder = new TextEncoder();
    const chunks = [];
    const offsets = [0];
    let length = 0;
    const push = value => { const bytes = typeof value === 'string' ? encoder.encode(value) : value; chunks.push(bytes); length += bytes.length; };
    push('%PDF-1.4\n%âãÏÓ\n');
    const objectCount = 2 + images.length * 3;
    const pageIds = images.map((_, index) => 3 + index * 3);
    const object = (id, parts) => { offsets[id] = length; push(`${id} 0 obj\n`); for (const part of parts) push(part); push('\nendobj\n'); };
    object(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
    object(2, [`<< /Type /Pages /Count ${images.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`]);
    images.forEach((image, index) => {
        const pageId = pageIds[index], imageId = pageId + 1, contentId = pageId + 2;
        const pointsWidth = image.pageWidth * 0.75, pointsHeight = image.pageHeight * 0.75;
        object(pageId, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pointsWidth} ${pointsHeight}] /Resources << /XObject << /Im${index} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`]);
        object(imageId, [`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${image.filter} /Length ${image.bytes.length} >>\nstream\n`, image.bytes, '\nendstream']);
        const command = `q ${pointsWidth} 0 0 ${pointsHeight} 0 0 cm /Im${index} Do Q`;
        object(contentId, [`<< /Length ${command.length} >>\nstream\n${command}\nendstream`]);
    });
    const xref = length;
    push(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
    for (let id = 1; id <= objectCount; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(chunks, { type: 'application/pdf' });
}

async function exportBookImages() {
    const booklet = state.booklets.find(item => item.id === activeBookletId);
    if (!booklet?.pages.length) return notify('册子还没有页面。', 'warning');
    for (const [index, page] of booklet.pages.entries()) {
        if (page.kind === 'workspace') await exportWorkspaceImage(page.workspace, `${booklet.name}-${index + 1}.png`);
        else downloadBlob(await (await fetch(page.source)).blob(), `${booklet.name}-${index + 1}.png`);
        await new Promise(resolve => setTimeout(resolve, 120));
    }
    notify(`已导出 ${booklet.pages.length} 张图片。`);
}

async function exportBookPdf() {
    const booklet = state.booklets.find(item => item.id === activeBookletId);
    if (!booklet?.pages.length) return notify('册子还没有页面。', 'warning');
    try {
        notify('正在生成 PDF，请稍候。', 'info');
        const images = [];
        for (const page of booklet.pages) images.push(await pageToPdfImage(page));
        downloadBlob(createPdf(images), `${booklet.name}.pdf`);
        notify('PDF 已导出。');
    } catch (error) { notify(error.message, 'error'); }
}

function addWandEntry() {
    if (document.querySelector('#wx-wand-entry')) return;
    const menu = document.querySelector('#extensionsMenu');
    if (!menu) return;
    const entry = document.createElement('div');
    entry.id = 'wx-wand-entry'; entry.title = '文心 · 摘录与排版';
    entry.innerHTML = '<div class="fa-solid fa-feather-pointed extensionsMenuExtensionButton"></div><span>文心</span>';
    entry.addEventListener('click', () => openApp());
    menu.append(entry);
}

function ensureSelectionPopover() {
    if (document.querySelector('#wx-selection-popover')) return;
    const popover = document.createElement('div');
    popover.id = 'wx-selection-popover'; popover.className = 'wx-selection-popover'; popover.hidden = true;
    popover.innerHTML = '<button data-selection-action="save"><i class="fa-solid fa-bookmark"></i>保存</button><button data-selection-action="share"><i class="fa-solid fa-share-nodes"></i>分享</button>';
    popover.addEventListener('pointerdown', event => event.preventDefault());
    popover.addEventListener('click', async event => {
        const action = event.target.closest('[data-selection-action]')?.dataset.selectionAction;
        if (!action || !selectionText) return;
        if (!state) await loadState();
        if (action === 'save') {
            state.library.unshift({ id: uid('quote'), text: selectionText, source: 'chat-selection', createdAt: Date.now(), updatedAt: Date.now() });
            scheduleSave(); notify('已保存到文库。');
        } else {
            await startShare(selectionText);
        }
        popover.hidden = true; window.getSelection()?.removeAllRanges();
    });
    document.body.append(popover);
}

function updateSelectionPopover() {
    const popover = document.querySelector('#wx-selection-popover');
    if (!popover) return;
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text || selection.rangeCount === 0) { popover.hidden = true; return; }
    const range = selection.getRangeAt(0);
    const ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (!ancestor?.closest?.('#chat .mes_text') || ancestor.closest('#wx-app')) { popover.hidden = true; return; }
    selectionText = text;
    const rect = range.getBoundingClientRect();
    popover.hidden = false;
    const width = popover.offsetWidth;
    popover.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.left + rect.width / 2 - width / 2))}px`;
    popover.style.top = `${Math.max(8, rect.top - popover.offsetHeight - 10)}px`;
}

async function initialize() {
    try { await loadState(); } catch (error) { console.error('[文心] 数据库初始化失败', error); state = defaultState(); }
    addWandEntry(); ensureSelectionPopover();
    const observer = new MutationObserver(addWandEntry);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('selectionchange', () => setTimeout(updateSelectionPopover, 20));
    document.addEventListener('pointerdown', event => {
        if (!event.target.closest('#wx-selection-popover')) document.querySelector('#wx-selection-popover')?.setAttribute('hidden', '');
    });
    window.addEventListener('resize', () => {
        if (dialog?.open && (currentView === 'composer' || currentView === 'booklet-editor')) renderStage();
        if (dialog?.querySelector('.wx-book-reader-stage')) renderBookReaderScale();
    });
}

$(document).ready(initialize);
