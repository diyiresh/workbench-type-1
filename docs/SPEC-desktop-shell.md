# 桌面壳 · 统筹工作台

日期：2026-10-29。分支 `feature/v3-bold-workspace`。这是包在现有 Node 服务外面的 Electron 窗口，不另建台账，不读取或提交 `data/store.json`。

## 它做什么

- 开发时用 `npm run desktop`。若本机还没有 `public/vendor`，这个命令会先构建浏览器资源。若 3780 上已经是本工作台（`/api/health` 返回 `ok: true`），就附着；否则由壳启动 `server.js`，退出时只关掉自己拉起的进程。
- 窗口没有地址栏，标题是「统筹工作台」。
- 页面里的 http(s) 链接默认进右侧内置网页。只有「用系统浏览器打开」或侧栏上的同名按钮才会交给系统浏览器。`javascript:` 和其他协议直接忽略。
- 登录自启动有两层：系统设置里的开关会让 Electron 调用 `setLoginItemSettings`；Windows 开始菜单和启动文件夹由 `scripts/windows-desktop.ps1` 创建快捷方式。单实例锁避免开出两个窗口。

## Tao 开机后在自己的机器上

仓库目录保持为 `D:\OneDrive\Desktop\Ben_My_Agent\5.cursor\搭建工作台`。拉下本分支后：

```powershell
npm install
npm install --prefix desktop
npm test
npm run desktop
```

`desktop/` 里的 Electron 不进根依赖，所以日常 `npm test` 不必下载 Electron。第一次 `npm install --prefix desktop` 会下载 Electron 33，需要能访问 npm。

开始菜单快捷方式，以及登录时启动：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows-desktop.ps1 -Autostart
```

卸载快捷方式（不删仓库）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows-desktop.ps1 -Uninstall
```

快捷方式指向当前仓库里的 `node scripts/run-desktop.js`。Node 必须在创建快捷方式时能被 `Get-Command node` 找到。

系统设置 → 陪伴宠物里的「登录时启动桌面工作台」会写入台账 `meta.companion.autostart`，并在桌面壳里同步 Electron 的登录项。开始菜单这一步仍然要跑上面的脚本，因为未打包的 Electron 登录项在开发态不一定带上应用参数。

## Jarvis

桌面壳启动后，若陪伴宠物开着且今天没有静音，会说且只说：

`Hello BEN, let's change the world!`

Windows 用系统语音（PowerShell `System.Speech`）。其他系统退回窗口里的 `speechSynthesis`。默认每天一次；设置里勾选「每次打开都问候」则每次启动都说。点宠物可以打开工作台、打开我的关注、静音今日或关掉这次窗口。浏览器里打开工作台时，右下角有同一只宠物；进了桌面壳就只用悬浮窗，避免说两遍。

## 不包含

没有签名的安装包，也没有把 Electron 二进制提交进 git。侧栏网页的权限请求默认拒绝。壳不会把台账写进仓库。
