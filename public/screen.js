(function () {
  const socket = io();
  const state = {
    race: {
      status: "waiting",
      articleTitle: "",
      remainingSeconds: 300
    },
    leaderboard: {
      classes: [],
      players: []
    },
    lastRanks: new Map()
  };

  const refs = {
    screenHeadline: document.getElementById("screenHeadline"),
    screenStatus: document.getElementById("screenStatus"),
    screenClassChart: document.getElementById("screenClassChart"),
    screenTopPlayers: document.getElementById("screenTopPlayers"),
    screenArticle: document.getElementById("screenArticle"),
    screenRemaining: document.getElementById("screenRemaining")
  };

  socket.on("connect", () => {
    socket.emit("joinScreen", {}, ({ race, leaderboard }) => {
      state.race = race || state.race;
      state.leaderboard = leaderboard || state.leaderboard;
      render();
    });
  });

  socket.on("screenState", ({ race, leaderboard }) => {
    state.race = race || state.race;
    state.leaderboard = leaderboard || state.leaderboard;
    render();
  });

  socket.on("leaderboardUpdate", (leaderboard) => {
    state.leaderboard = leaderboard || state.leaderboard;
    render();
  });

  function render() {
    refs.screenHeadline.textContent = `${getStatusText(state.race.status)} ｜ ${
      state.race.status === "ended" ? "最终成绩已锁定" : "数据实时刷新中"
    }`;
    refs.screenStatus.textContent = `状态：${getStatusText(state.race.status)}`;
    refs.screenArticle.textContent = `文章：${state.race.articleTitle || "未开始"}`;
    refs.screenRemaining.textContent = `剩余时间：${formatSeconds(state.race.remainingSeconds || 0)}`;

    renderClassChart();
    renderTopPlayers();
  }

  function renderClassChart() {
    const classes = state.leaderboard.classes || [];
    if (classes.length === 0) {
      refs.screenClassChart.innerHTML = '<div class="empty-text">暂无班级成绩数据</div>';
      return;
    }

    const maxScore = Math.max(...classes.map((item) => item.totalScore), 1);
    refs.screenClassChart.innerHTML = classes
      .map(
        (item) => `
          <div class="bar-row">
            <strong>${item.rank}. ${item.className}</strong>
            <div class="bar-track"><div class="bar-fill" style="width:${(item.totalScore / maxScore) * 100}%"></div></div>
            <span>${item.totalScore.toFixed(2)}</span>
          </div>
        `
      )
      .join("");
  }

  function renderTopPlayers() {
    const players = [...(state.leaderboard.players || [])].sort((a, b) => b.speed - a.speed).slice(0, 10);
    if (players.length === 0) {
      refs.screenTopPlayers.innerHTML = '<div class="empty-text">暂无个人榜单数据</div>';
      return;
    }

    refs.screenTopPlayers.innerHTML = players
      .map((item, index) => {
        const lastRank = state.lastRanks.get(item.id);
        const flash = lastRank && lastRank !== index + 1 ? "flash" : "";
        state.lastRanks.set(item.id, index + 1);
        return `
          <article class="rank-item ${flash}">
            <div class="rank-num">${index + 1}</div>
            <div>
              <strong>${item.playerName}</strong>
              <div class="muted">${item.className} ｜ 准确率 ${item.accuracy.toFixed(2)}%</div>
            </div>
            <div>${item.speed.toFixed(2)} 字/分</div>
          </article>
        `;
      })
      .join("");
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
})();
