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

## D 桌面伙伴升级（2026-11-01，已确认开发）

复用 Electron 独立透明置顶窗口，主工作台最小化时伙伴保持可见。外观为象牙白机身、深色面罩、薄荷绿眼睛，网页与桌面共享 companion.css；降低动态效果偏好时关闭眨眼。

桌面伙伴以 100×104 DIP 独立窗口容纳 76×78 DIP 机器人，不给主窗口设置 parent。左键拖动，释放后将位置保存到 Electron userData/companion-position.json，不进入业务台账；重启时读回，多屏拔除或分辨率改变时限制在可用工作区。点击或键盘激活打开原生菜单，可恢复工作台、我的关注、静音、隐藏或退出。隐藏后可从桌面壳菜单重新显示；完全退出桌面壳后伙伴也退出。浏览器网页最小化不影响独立桌面壳，必须通过 npm run desktop 保持壳运行。

不改登录自启动、问候和静音偏好，不改技能收集。验收包含窗口最小化后独立可见、恢复工作台、拖动保存/重启读回、跨屏边界与减少动态效果。

### 主窗口关闭后重新打开

伙伴运行时，主窗口右上角关闭按钮隐藏窗口，保留正在编辑的草稿；从伙伴菜单“打开工作台”恢复同一窗口。伙伴菜单“退出桌面工作台”仍完整退出。若主窗口已被销毁，打开操作重新创建窗口及各 WebContentsView，并清理旧引用；第二实例唤醒走同一恢复入口。回归命令：`node test/desktop-companion.test.cjs`，包含关闭后打开及最小化后恢复。
