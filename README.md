# CircuLab

一个基于 `HTML + CSS + JavaScript` 的电路入门教学验证 Demo。

当前版本目标：

- 展示基础元件学习卡片
- 提供 3 个入门关卡
- 允许添加元件、建立端口连线
- 基于简单图结构做教学判题
- 使用 `localStorage` 保存通关进度

## 目录结构

```text
.
├── index.html
├── styles/
│   └── main.css
├── scripts/
│   ├── app.js
│   ├── data.js
│   └── validator.js
├── requirements.txt
└── .gitignore
```

## 直接运行

这是纯静态前端项目，直接双击 `index.html` 就能打开。

项目根目录已经创建好了 `.venv`。

如果你希望通过本地静态服务运行，可以直接执行：

```powershell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python .\dev_server.py
```

然后访问 `http://127.0.0.1:8765`。

也可以直接运行：

```powershell
.\start_server.ps1
```

当前机器上的 `8000` 端口可能被其他本地服务占用，默认建议使用 `8765`。

## 当前限制

- 不是精确电路仿真器，只做教学验证
- 开关当前视为闭合状态
- 并联判定基于简化规则
- 适合验证“结构正确性”，不适合计算真实电压电流

## 后续建议

1. 给元件增加可视化连线画布
2. 引入更细的规则，例如电阻必串联在 LED 前
3. 增加题库配置和错题回放
4. 补一个简单的 Flask 后端用于教师出题和成绩记录

## 环境状态

- 已检测到本机 Python 安装路径：`C:\Users\admin\AppData\Local\Programs\Python\Python312\python.exe`
- 已创建项目虚拟环境：`D:\work\new_work\work2_trae\.venv`
- 已验证 `.venv` 内 `python` 与 `pip` 可用
