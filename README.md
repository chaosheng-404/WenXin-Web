# 文心网页

文心的独立网页版本，用于摘录、文字排版、图库与字体管理、模板制作以及册子编排。无需 SillyTavern，也不需要账号或服务器。

## 数据与隐私

- 文库、图库、字体、模板、册子和设置保存在当前浏览器的 IndexedDB 中。
- 数据不会由本项目上传到服务器。内置在线图片和字体仍由对应的第三方资源网站提供。
- 清除站点数据、使用无痕窗口或更换浏览器会失去本地数据。请通过右上角“本地设置”定期导出完整备份。

## 本地运行

需要 Node.js 18 或更高版本：

```bash
npm run dev
```

然后访问 `http://127.0.0.1:4173`。不要直接双击 `index.html`，浏览器的本地文件模式不支持完整的离线缓存行为。

## 发布到 GitHub Pages

1. 在 GitHub 新建一个空仓库。
2. 将本项目提交并推送到仓库的 `main` 分支。
3. 在仓库的 **Settings → Pages → Build and deployment** 中，将 Source 设为 **GitHub Actions**。
4. 等待 `Deploy WenXin Web to GitHub Pages` 工作流完成。

网站地址通常为 `https://你的用户名.github.io/仓库名/`。

## 与 SillyTavern 插件的关系

本仓库由文心 SillyTavern 插件的源文件复制后独立改造。`plugin-source/` 保存了开始网页端开发时的完整插件源码快照；网页端的后续修改不会写回插件目录。

## 开源协议

[MIT](LICENSE)

浏览器端依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
