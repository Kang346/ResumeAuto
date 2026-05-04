# ResumeAuto

软件工程岗位的简历自动定制 + 自动填表流水线，专为找工作而生。整套流程由 [Claude Code](https://docs.claude.com/en/docs/claude-code) 驱动 —— 它既是编排器也是 LLM，**不需要额外配 API key**。

> English version: [README.en.md](README.en.md)

## 它能干啥

三个阶段，每个交接点都有你确认：

1. **收集** —— Claude Code 在 LinkedIn / Greenhouse / Indeed 上搜符合你画像的新岗位，把合格的写进 Notion 数据库。
2. **定制** —— 对每个岗位，Claude Code 读 JD、从你的项目库里挑最合适的 2 个项目、按 JD 关键词重写 bullet，编译出一份 ATS 友好的单页 PDF。
3. **投递** —— Chrome 插件自动填 Workday / Greenhouse / Lever / Ashby 表单，上传定制好的 PDF；Claude Code 处理多页表单，并起草那些开放式问题的答案（"为啥选我们公司？"、cover letter 这些）。

每一次提交都需要你点头确认。流水线在最后那个 Submit 按钮前会停下来等你。

## 装之前先看一眼

打开 [examples/demo_resume.pdf](examples/demo_resume.pdf) —— 这是用仓库里自带的样例 JD（[examples/sample_jd.md](examples/sample_jd.md)）跑出来的成品 PDF。你不用装 LaTeX 也不用装 Claude Code，先看下输出长啥样，觉得合用再继续往下装。

## 环境要求

- Python 3.9+
- 一个 LaTeX 发行版 —— Windows 推荐 [MiKTeX](https://miktex.org/)，Linux/macOS 用 [TeX Live](https://www.tug.org/texlive/)
- Chrome 浏览器（阶段 3 的插件要用）
- [Claude Code](https://docs.claude.com/en/docs/claude-code) 已安装并能登录
- *（可选）* Notion + 集成 token，如果你想用 Notion 当岗位池

> 关于 Claude Code 的订阅：目前最便宜的方式是 Claude Pro（约 ¥150/月），自动定制简历这个量级用完全够。

## 快速上手

```bash
# 1. clone 仓库 + 装 Python 依赖
git clone <this-repo>
cd ResumeAuto
pip install -r requirements.txt

# 2.（可选）跑一下烟雾测试 —— 用自带的样例 JD 生成一份 PDF，
#    确认你的 LaTeX 装好了。不需要 Claude Code 也不需要 user_data/。
python pipeline/run_pipeline.py --demo
#    成功的话会在 output/Demo_Distributed_Systems_Engineer_<日期>.pdf 看到结果。
#    这一份是预先算好的（见 examples/sample_jd.md 和 examples/sample_tailored.json），
#    真正用 LLM 给你自己的 JD 定制要走第 3 步之后的流程。

# 3. 把你现有的简历（PDF 或 DOCX）导入进来 —— 一步到位地填好 user_data/
#    并改写 templates/example.tex。在项目根目录打开 Claude Code，输入：
#       "import my resume from ~/Downloads/my_resume.pdf"
#    完整流程见 prompts/resume_import.md。
#    （或者跳过自动导入，从 examples/ 手动复制并自己编辑：
#       cp examples/personal_info.example.json   user_data/personal_info.json
#       cp examples/project_library.example.json user_data/project_library.json
#     然后手改这两个文件 + templates/example.tex。）

# 4. 启动本地 server（Chrome 插件靠它跟流水线通信）
python server/serve.py

# 5. 另开一个终端，把 Chrome 插件加载进去：
#    chrome://extensions → 打开开发者模式 → 加载已解压的扩展程序 → 选 ./extension

# 6. 在项目根目录打开 Claude Code，它会自动加载 CLAUDE.md。试试：
#       "tailor my resume for this job: <粘贴 JD>"
```

## 项目结构

```
ResumeAuto/
├── CLAUDE.md           # 编排说明 —— Claude Code 启动时自动加载
├── README.md           # 你正在看
├── pipeline/           # 简历编译流水线（Python）
│   ├── run_pipeline.py # JSON 进 → 单页 PDF 出
│   └── agent.py        # 编排器用的辅助函数
├── templates/
│   └── example.tex     # LaTeX 模板，含 %%% PLACEHOLDER %%% 标记
├── prompts/            # LLM 指令和 agent 提示词
│   ├── prompt_rules.md   # 简历定制阶段的规则
│   ├── form_rules.md     # 阶段 3 表单填写规则
│   └── job_collection.md # 阶段 1 岗位采集 agent 的提示词
├── server/             # 本地 HTTP 桥接，连接 agent 和 Chrome 插件
├── extension/          # Chrome 插件（阶段 3 自动填表）
├── examples/           # 参考模板 —— 从这里拷到 user_data/
└── user_data/          # **你自己的数据** —— 已 gitignore，不会被提交
```

## 配置 `user_data/`

`user_data/` 已经在 .gitignore 里 —— 这个目录里的东西都只在你本地，`git status` 看不到，`git add .` 也不会带上。

需要你维护两个文件：

- **`user_data/personal_info.json`** —— 姓名、联系方式、教育经历、工作经历、工作签证默认答案。本地 server 会读它，阶段 3 自动填表用。
- **`user_data/project_library.json`** —— 你的项目，每个带 `tags`、一行 `summary`、和 LaTeX 格式的 `bullets`。Agent 按 tag 跟 JD 的重合度挑 2 个项目。**至少放 3-5 个项目**，不然 agent 没得选。

最省事的路径：跑快速上手第 3 步的简历导入流程。它会自动填好这两个文件，并用你现有 PDF/DOCX 里的内容重写模板的姓名/教育/工作经历部分。

手动路径：从 `examples/` 拷一份，然后自己改。两个示例文件顶部都有 `_instructions` 字段写了快速指南。

流水线运行时的状态文件（`pending_jobs.json`、`pending_questions.json`、`pending_answers.json`、`autofill_state.json`、`tab_tracker.json`）也都在 `user_data/` 下，server 第一次写的时候自动创建，你不用提前准备。

## 配置简历模板

编辑 `templates/example.tex`：

- 替换 **heading** 部分（姓名、电话、邮箱、LinkedIn、GitHub）。
- 替换 **Education**（教育背景）部分。
- 替换 **Professional Experience**（工作经历）部分。
- **不要动** `%%% PROJECTS_PLACEHOLDER_START/END %%%` 和 `%%% SKILLS_PLACEHOLDER_START/END %%%` 这几个标记。每次跑流水线都会在它们之间注入定制内容。

模板自带一个 "Alex Doe" 的演示版本，能直接编译出有效的单页 PDF 当作健康检查。

## 留学生相关提示

- **签证默认答案** 写在 `user_data/personal_info.json` 里。`work_authorization` 字段建议如实填（H-1B sponsorship needed = yes 之类），阶段 3 表单会按这里的默认值填写 —— 答错了 ATS 会直接筛掉。
- **STEM OPT** 信息也建议填进 personal_info，很多公司表单会问。
- **学校名称、学位** 写英文官方名称（比如 "University of California, San Diego" 而不是 "UCSD"），ATS 的关键词匹配看的是完整名称。
- **GPA 和分数** 美国公司一般不要求，但如果要填，4.0 制和原制都填了更稳（如 "3.8/4.0" 或 "85/100"）。

## 可选：用 Notion 当岗位池

如果你用 Notion 管理岗位，调用 agent 之前先设：

```bash
export NOTION_DB_ID="<你的 database UUID>"
export NOTION_DATA_SOURCE="collection://<uuid>"
```

Notion 的字段定义、状态选项、JD 页面格式都在 `prompts/job_collection.md` 里。第一次用的话，可以让 Claude Code 直接帮你按这套 schema 创建数据库。

不想用 Notion 也行 —— 最简单的替代是建一个 `user_data/jobs.md`，每个岗位写一段 `## 公司 - 岗位` 的 block，然后改一下 `prompts/job_collection.md` 让它从这里读。（CSV/Markdown 数据源适配器现在还没内置进流水线，欢迎贡献 PR。）

## 隐私

- `user_data/`、`output/`、`work/`、`logs/` 都已 gitignore。提交前还是建议过一下 `git status`。
- Chrome 插件通过 `localhost:8765` 读 ATS 表单字段和 `user_data/personal_info.json`，除此之外不发起任何外网请求。
- Claude Code 在编排过程中会读你的 JD、项目库、个人信息。如果你介意这些数据被 LLM 看到，那这个工具不适合你。

## 注意事项

- LaTeX 装起来不轻量，MiKTeX 和 TeX Live 都是几个 GB 起步。
- Chrome 插件目前对 Workday、Greenhouse、Lever、Ashby 有专门适配，其他 ATS 会走通用兜底逻辑（不一定每个字段都填得上）。
- 阶段 3 永远在最后那个 Submit 之前停下来 —— 你自己点 Submit 之前先过一遍内容。

## License

MIT。见 [LICENSE](LICENSE)（TODO —— 发布前补上）。
