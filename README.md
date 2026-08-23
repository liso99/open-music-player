# 拾音 Open Music

一个可在 iPhone Safari 中直接运行、并支持“添加到主屏幕”的开源音乐播放器 PWA。它保留洛雪 / MusicFree 的插件协议：音源以插件形式由用户自行安装，客户端本身不内置任何版权曲库。

## 功能

- 内置 Apple Music 公开试听源，开箱即可搜索与播放
- 兼容 MusicFree 插件协议，支持 `.js` 单插件与 `plugins.json` 订阅地址
- 支持搜索、榜单、歌单详情、歌词、在线试听与 Range 音频代理
- 收藏、播放队列、随机播放、单曲/列表循环、音量控制
- 移动端优先，可在 iOS Safari 添加到主屏幕作为全屏应用使用

## 运行

```bash
npm install
npm run dev
```

打开终端输出的地址即可。手机与电脑在同一局域网时，可使用 `Network` 地址在 iPhone 上访问。

生产模式：

```bash
npm run build
npm start
```

## 目录

- `server/`：Node 插件运行时与音频代理，负责执行用户安装的 MusicFree 插件
- `src/`：React PWA 前端
- `plugins/`：用户安装的插件，运行时自动加载
- `data/`：插件变量与订阅记录

## iOS 原生 App

项目已用 Capacitor 生成完整的原生 Xcode 工程，目录为 `ios/`。

在 Mac 上打包：

```bash
npm install
npm run cap:sync
npm run cap:open:ios
```

或在 Xcode 中直接打开 `ios/App/App.xcodeproj`，选择真机或模拟器后运行。发布 `.ipa` 需要配置 Apple Developer 团队与签名，通过 Xcode 的 Product > Archive 生成。

原生 App 内运行 MusicFree 插件需要后端服务。默认 Apple Music 试听源无需后端；如需完整插件，先在“设置 > 后端服务地址”填入已部署的 `server/` 地址（建议使用 HTTPS）。后端部署后执行 `npm start` 即可。

### 不上架的安装方式

**最省事：PWA 添加到主屏幕。** iPhone 用 Safari 打开服务地址，点“分享 > 添加到主屏幕”。无需签名、无需电脑，也不存在 7 天失效问题。

**想要独立 App 图标：AltStore 侧载。** 仓库里已提供 `.github/workflows/build-ios.yml`，把它推送到 GitHub 后手动运行 Action，会自动在 macOS 环境生成一个未签名 `.ipa` 供下载。然后：

1. 在 Windows 安装 AltServer 并登录普通 Apple ID。
2. iPhone 通过 USB 连接电脑，用 AltStore 安装这个 `.ipa`。
3. 免费 Apple ID 签名的应用有效期为 7 天，之后用 AltStore 刷新即可。

未签名 IPA 由 AltStore 使用你的 Apple ID 现场签名，不需要 Apple Developer 账号。

## 免责声明

本项目是个人学习与本地播放工具，不提供任何音源内容。用户自行安装的插件、订阅地址及其提供的内容均由用户负责。请仅使用合法授权的音源，并遵守当地法律与平台服务条款。
