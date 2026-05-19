(function () {
  const socket = io();
  const tokenKey = "typing-admin-token";
  const state = {
    token: sessionStorage.getItem(tokenKey) || "",
    config: null,
    articles: [],
    importFileContent: "",
    race: {
      status: "waiting",
      remainingSeconds: 300
    },
    leaderboard: {
      classes: [],
      players: []
    },
    players: [],
    lastPlayerRanks: new Map()
  };

  const refs = {
    authView: document.getElementById("authView"),
    dashboardView: document.getElementById("dashboardView"),
    adminSocketBadge: document.getElementById("adminSocketBadge"),
    adminLoginForm: document.getElementById("adminLoginForm"),
    adminPassword: document.getElementById("adminPassword"),
    adminLoginError: document.getElementById("adminLoginError"),
    articleSelect: document.getElementById("articleSelect"),
    articleImportTitle: document.getElementById("articleImportTitle"),
    articleImportFile: document.getElementById("articleImportFile"),
    importArticleButton: document.getElementById("importArticleButton"),
    clearArticleImportButton: document.getElementById("clearArticleImportButton"),
    rosterImportFile: document.getElementById("rosterImportFile"),
    importRosterButton: document.getElementById("importRosterButton"),
    clearRosterButton: document.getElementById("clearRosterButton"),
    rosterStatsPanel: document.getElementById("rosterStatsPanel"),
    rosterTotalStudents: document.getElementById("rosterTotalStudents"),
    rosterTotalClasses: document.getElementById("rosterTotalClasses"),
    rosterStatsList: document.getElementById("rosterStatsList"),
    rosterStatsToggle: document.getElementById("rosterStatsToggle"),
    rosterStatsArrow: document.getElementById("rosterStatsArrow"),
    durationInput: document.getElementById("durationInput"),
    startButton: document.getElementById("startButton"),
    pauseButton: document.getElementById("pauseButton"),
    resumeButton: document.getElementById("resumeButton"),
    endButton: document.getElementById("endButton"),
    exportButton: document.getElementById("exportButton"),
    raceHeadline: document.getElementById("raceHeadline"),
    statusValue: document.getElementById("statusValue"),
    remainingValue: document.getElementById("remainingValue"),
    onlineCount: document.getElementById("onlineCount"),
    classCount: document.getElementById("classCount"),
    classChart: document.getElementById("classChart"),
    topPlayers: document.getElementById("topPlayers"),
    playerTableBody: document.getElementById("playerTableBody"),
    toastStack: document.getElementById("toastStack")
  };

  init();

  async function init() {
    bindEvents();
    await loadBasics();
    connectSocket();
    if (state.token) {
      joinAdmin();
    }
  }

  function bindEvents() {
    refs.adminLoginForm.addEventListener("submit", handleLoginSubmit);
    refs.startButton.addEventListener("click", startRace);
    refs.pauseButton.addEventListener("click", pauseRace);
    refs.resumeButton.addEventListener("click", resumeRace);
    refs.endButton.addEventListener("click", endRace);
    refs.exportButton.addEventListener("click", exportCsv);
    refs.importArticleButton.addEventListener("click", importArticle);
    refs.articleImportFile.addEventListener("change", importArticleFile);
    refs.importRosterButton.addEventListener("click", importRoster);
    refs.clearArticleImportButton.addEventListener("click", clearArticleImport);
    refs.clearRosterButton.addEventListener("click", clearRosterData);
    refs.rosterStatsToggle.addEventListener("click", toggleRosterStats);
  }

  async function loadBasics() {
    const [configResponse, articleResponse] = await Promise.all([fetch("/api/config"), fetch("/api/articles")]);
    state.config = await configResponse.json();
    state.articles = (await articleResponse.json()).articles || [];

    refs.durationInput.value = 5;
    renderArticleOptions();
  }

  function connectSocket() {
    socket.on("connect", () => {
      updateSocketBadge(true);
      if (state.token) {
        joinAdmin();
      }
    });

    socket.on("disconnect", () => {
      updateSocketBadge(false);
      showToast("连接中断", "管理端与服务器的连接已断开，正在自动重连。", "error");
    });

    socket.on("adminState", ({ race, leaderboard, players }) => {
      state.race = race || state.race;
      state.leaderboard = leaderboard || state.leaderboard;
      state.players = players || [];
      renderDashboard();
    });
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    refs.adminLoginError.textContent = "";

    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        password: refs.adminPassword.value
      })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      refs.adminLoginError.textContent = result.message || "登录失败";
      return;
    }

    state.token = result.token;
    sessionStorage.setItem(tokenKey, result.token);
    joinAdmin();
  }

  function joinAdmin() {
    socket.emit("joinAdmin", { token: state.token }, (result) => {
      if (!result?.success) {
        refs.adminLoginError.textContent = result?.message || "管理员验证失败";
        sessionStorage.removeItem(tokenKey);
        state.token = "";
        return;
      }

      state.race = result.race || state.race;
      state.leaderboard = result.leaderboard || state.leaderboard;
      state.players = result.players || [];
      refs.authView.classList.add("hidden");
      refs.dashboardView.classList.remove("hidden");
      renderDashboard();
      loadRosterStats();
    });
  }

  function startRace() {
    const articleId = refs.articleSelect.value;
    const minutes = Number(refs.durationInput.value || 5);
    const duration = minutes * 60;
    socket.emit("adminStartRace", { articleId, duration }, handleCommandResult("比赛开始"));
  }

  async function importArticle() {
    if (!state.token) {
      showToast("未登录", "请先登录管理端后再导入文章。", "error");
      return;
    }

    const title = refs.articleImportTitle.value.trim();
    const content = state.importFileContent.trim();

    if (!title || !content) {
      showToast("导入失败", "请先填写文章标题并选择 TXT 文件。", "error");
      return;
    }

    const response = await fetch("/api/articles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        token: state.token,
        title,
        content
      })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      showToast("导入失败", result.message || "文章导入失败。", "error");
      return;
    }

    state.articles.push(result.article);
    renderArticleOptions(result.article.id);
    refs.articleImportTitle.value = "";
    refs.articleImportFile.value = "";
    state.importFileContent = "";
    showToast("导入成功", "比赛文章已加入可选列表。", "success");
  }

  function importArticleFile(event) {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      state.importFileContent = String(reader.result || "").replace(/\r/g, "").trim();
      if (!refs.articleImportTitle.value.trim()) {
        refs.articleImportTitle.value = file.name.replace(/\.[^.]+$/, "");
      }
      showToast("文件已读取", `已载入 ${file.name}，现在可点击“导入文章”。`, "success");
    };
    reader.readAsText(file, "utf-8");
  }

  function clearArticleImport() {
    refs.articleImportTitle.value = "";
    refs.articleImportFile.value = "";
    state.importFileContent = "";
    showToast("已清除", "文章导入表单已重置。", "success");
  }

  async function clearRosterData() {
    if (!state.token) {
      showToast("未登录", "请先登录管理端。", "error");
      return;
    }

    const response = await fetch(`/api/student-roster?token=${encodeURIComponent(state.token)}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok || !result.success) {
      showToast("清除失败", result.message || "操作失败，请重试。", "error");
      return;
    }

    refs.rosterImportFile.value = "";
    await loadRosterStats();
    showToast("已清除", "学生名单已全部删除。", "success");
  }

  function pauseRace() {
    socket.emit("adminPauseRace", {}, handleCommandResult("比赛已暂停"));
  }

  function resumeRace() {
    socket.emit("adminResumeRace", {}, handleCommandResult("比赛已继续"));
  }

  function endRace() {
    socket.emit("adminEndRace", {}, handleCommandResult("比赛已结束"));
  }

  function handleCommandResult(successTitle) {
    return (result) => {
      if (!result?.success) {
        showToast("操作失败", result?.message || "请稍后重试。", "error");
        return;
      }
      showToast(successTitle, result.message || "", "success");
    };
  }

  function exportCsv() {
    if (!state.token) {
      showToast("未登录", "请先登录管理端后再导出成绩。", "error");
      return;
    }
    window.open(`/api/export?token=${encodeURIComponent(state.token)}`, "_blank");
  }

  function renderArticleOptions(selectedId) {
    refs.articleSelect.innerHTML = state.articles
      .map((item) => `<option value="${item.id}">${item.title}</option>`)
      .join("");

    if (selectedId) {
      refs.articleSelect.value = selectedId;
    }
  }

  function renderDashboard() {
    refs.raceHeadline.textContent = `当前状态：${getStatusText(state.race.status)} ｜ 当前文章：${state.race.articleTitle || "未选择"}`;
    refs.statusValue.textContent = getStatusText(state.race.status);
    refs.remainingValue.textContent = formatSeconds(state.race.remainingSeconds || 0);
    refs.onlineCount.textContent = String(state.players.filter((item) => item.online).length);
    refs.classCount.textContent = String(state.leaderboard.classes.length);

    renderClassChart();
    renderTopPlayers();
    renderPlayerTable();
    renderButtons();
  }

  async function loadRosterStats() {
    try {
      const response = await fetch("/api/student-roster/stats");
      const stats = await response.json();
      if (stats.totalClasses === 0) {
        refs.rosterStatsPanel.classList.add("hidden");
        return;
      }
      refs.rosterStatsPanel.classList.remove("hidden");
      refs.rosterTotalStudents.textContent = String(stats.totalStudents);
      refs.rosterTotalClasses.textContent = String(stats.totalClasses);
      refs.rosterStatsList.innerHTML = stats.classes
        .map(
          (item) =>
            `<div class="roster-stat-row"><span>${item.className}</span><span class="roster-stat-count">${item.studentCount} 人</span></div>`
        )
        .join("");
      refs.rosterStatsList.classList.add("hidden");
      refs.rosterStatsArrow.textContent = "▶";
    } catch (_error) {
      refs.rosterStatsPanel.classList.add("hidden");
    }
  }

  function toggleRosterStats() {
    const isHidden = refs.rosterStatsList.classList.contains("hidden");
    if (isHidden) {
      refs.rosterStatsList.classList.remove("hidden");
      refs.rosterStatsArrow.textContent = "▼";
    } else {
      refs.rosterStatsList.classList.add("hidden");
      refs.rosterStatsArrow.textContent = "▶";
    }
  }

  function renderButtons() {
    const status = state.race.status;
    refs.startButton.disabled = status === "running" || status === "paused";
    refs.pauseButton.disabled = status !== "running";
    refs.resumeButton.disabled = status !== "paused";
    refs.endButton.disabled = status !== "running" && status !== "paused";
    refs.exportButton.disabled = state.leaderboard.players.length === 0;
  }

  function renderClassChart() {
    if (state.leaderboard.classes.length === 0) {
      refs.classChart.innerHTML = '<div class="empty-text">暂无班级成绩数据</div>';
      return;
    }

    const maxScore = Math.max(...state.leaderboard.classes.map((item) => item.totalScore), 1);
    refs.classChart.innerHTML = state.leaderboard.classes
      .map(
        (item) => `
          <div class="bar-row">
            <strong>${item.className}</strong>
            <div class="bar-track"><div class="bar-fill" style="width:${(item.totalScore / maxScore) * 100}%"></div></div>
            <span>${item.totalScore.toFixed(2)}</span>
          </div>
        `
      )
      .join("");
  }

  function renderTopPlayers() {
    const topPlayers = [...state.leaderboard.players]
      .sort((a, b) => b.speed - a.speed)
      .slice(0, 10);

    if (topPlayers.length === 0) {
      refs.topPlayers.innerHTML = '<div class="empty-text">暂无个人榜单数据</div>';
      return;
    }

    refs.topPlayers.innerHTML = topPlayers
      .map((item, index) => {
        const lastRank = state.lastPlayerRanks.get(item.id);
        const flash = lastRank && lastRank !== index + 1 ? "flash" : "";
        state.lastPlayerRanks.set(item.id, index + 1);
        return `
          <article class="rank-item ${flash}">
            <div class="rank-num">${index + 1}</div>
            <div>
              <strong>${item.playerName}</strong>
              <div class="muted">${item.className} ｜ 得分 ${item.score.toFixed(2)} ｜ 准确率 ${item.accuracy.toFixed(2)}%</div>
            </div>
            <div class="speed-badge">${item.speed.toFixed(2)} <span class="muted">字/分</span></div>
          </article>
        `;
      })
      .join("");
  }

  function renderPlayerTable() {
    if (state.players.length === 0) {
      refs.playerTableBody.innerHTML = '<tr><td colspan="9" class="empty-text">暂无选手登录</td></tr>';
      return;
    }

    const sortedPlayers = [...state.players].sort((a, b) => {
      const scoreA = Number(a.score) || 0;
      const scoreB = Number(b.score) || 0;
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      return a.playerName.localeCompare(b.playerName, "zh-CN");
    });

    refs.playerTableBody.innerHTML = sortedPlayers
      .map(
        (item) => `
          <tr>
            <td>${item.className}</td>
            <td>${item.playerName}</td>
            <td>${item.online ? '<span class="success-text">在线</span>' : '<span class="danger-text">离线</span>'}</td>
            <td>${formatHeartbeat(item.lastHeartbeat)}</td>
            <td>${item.progressPercent.toFixed(2)}%</td>
            <td>${item.speed.toFixed(2)}</td>
            <td>${item.accuracy.toFixed(2)}%</td>
            <td>${(item.score || 0).toFixed(2)}</td>
            <td>${item.rank}</td>
          </tr>
        `
      )
      .join("");
  }

  function updateSocketBadge(connected) {
    refs.adminSocketBadge.innerHTML = connected
      ? '<span class="status-dot"></span> 已连接'
      : '<span class="status-dot offline"></span> 已断开';
  }

  function showToast(title, message, type) {
    const item = document.createElement("div");
    item.className = `toast ${type || ""}`.trim();
    item.innerHTML = `<strong>${title}</strong><div>${message}</div>`;
    refs.toastStack.appendChild(item);
    setTimeout(() => item.remove(), 2600);
  }

  function getStatusText(status) {
    if (status === "running") {
      return "比赛进行中";
    }
    if (status === "paused") {
      return "比赛已暂停";
    }
    if (status === "ended") {
      return "比赛已结束";
    }
    return "等待开始";
  }

  function formatSeconds(totalSeconds) {
    const safe = Math.max(0, Number(totalSeconds) || 0);
    const minutes = String(Math.floor(safe / 60)).padStart(2, "0");
    const seconds = String(safe % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function formatHeartbeat(timestamp) {
    if (!timestamp) {
      return "-";
    }
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    return `${seconds} 秒前`;
  }

  async function importRoster() {
    if (!state.token) {
      showToast("未登录", "请先登录管理端后再导入学生名单。", "error");
      return;
    }

    const [file] = refs.rosterImportFile.files || [];
    if (!file) {
      showToast("导入失败", "请先选择 Excel 文件。", "error");
      return;
    }

    if (typeof XLSX === "undefined") {
      showToast("导入失败", "名单解析组件未加载成功，请刷新页面后重试。", "error");
      return;
    }

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const firstSheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
    const normalizedRows = normalizeRosterRows(rows);

    if (normalizedRows.length === 0) {
      showToast("导入失败", "未识别到有效的班级和学生姓名数据。", "error");
      return;
    }

    const response = await fetch("/api/student-roster", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        token: state.token,
        students: normalizedRows
      })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      showToast("导入失败", result.message || "学生名单导入失败。", "error");
      return;
    }

    refs.rosterImportFile.value = "";
    await loadRosterStats();
    showToast("导入成功", `已导入 ${result.classCount} 个班级，共 ${result.studentCount} 名学生。`, "success");
  }

  function normalizeRosterRows(rows) {
    return rows
      .map((row) => {
        const className = String(row["班级"] ?? row["班别"] ?? row["班级名称"] ?? "").trim();
        const playerName = String(
          row["学生姓名"] ?? row["姓名"] ?? row["学生"] ?? row["名字"] ?? ""
        ).trim();
        if (!className || !playerName) {
          return null;
        }
        return { className, playerName };
      })
      .filter(Boolean);
  }
})();
