# 外部工具

左侧一级导航增加「外部工具」，和现有入口一样：轨道按钮加二级分类，主区是卡片。

## 清单

- 种子在 `config/external-tools.json`，随仓库发布。
- 本机增改在 `data/external-tools.json`。同名条目覆盖种子，`hidden` 用来藏起种子条目。这个文件留在本机，不提交。
- 页面底部可以添加、修改、移除。低置信度或「待核不保存动作」不会留下启动动作。
- 待核条目可以出现在清单里，但没有启动按钮。没有核到的程序路径不编造。

## 启动

`POST /api/external-tools/<id>/launch` 只在本机回环上可用。请求只带动作编号，不能另传命令。

Windows 上：文件夹走资源管理器；已登记的 bat、cmd、lnk、exe、html 和本机 http(s) 地址走 `start`；`npm run dev`、`npm start`、`pnpm dev`、`docker compose up -d` 只在登记的目录里执行。参数按数组传给 `cmd.exe`，不打开 shell 拼接。

其他系统只把意图写入 `data/external-tool-launches.jsonl`，不启动进程。

地址只允许 `localhost`、`127.0.0.1` 或 `::1`，并且必须带端口。路径不允许 `..`、引号和 `& | < > ^ % !`。
