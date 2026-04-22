(function () {
  const STORAGE_KEY = "circulab-progress-v1";
  const { lessons, components, levels } = window.CIRCUIT_DATA;
  const BOARD_MAX_X = 1020;
  const BOARD_MAX_Y = 640;

  const state = {
    activeLevelId: levels[0].id,
    placedComponents: [],
    connections: [],
    progress: loadProgress(),
    instanceSeed: 0,
    pendingWireStart: null,
    dragState: null,
    isRunning: false,
    switchStates: {},
    mousePosition: { x: 0, y: 0 },
    hoveredPort: null
  };

  const refs = {
    lessonList: document.querySelector("#lesson-list"),
    levelList: document.querySelector("#level-list"),
    levelTitle: document.querySelector("#level-title"),
    levelDescription: document.querySelector("#level-description"),
    levelGoals: document.querySelector("#level-goals"),
    componentPalette: document.querySelector("#component-palette"),
    activeComponents: document.querySelector("#active-components"),
    connectionList: document.querySelector("#connection-list"),
    feedbackSummary: document.querySelector("#feedback-summary"),
    feedbackPass: document.querySelector("#feedback-pass"),
    feedbackFail: document.querySelector("#feedback-fail"),
    feedbackBadge: document.querySelector("#feedback-badge"),
    completedCount: document.querySelector("#completed-count"),
    activeLevelTitle: document.querySelector("#active-level-title"),
    boardCanvas: document.querySelector("#board-canvas"),
    boardComponents: document.querySelector("#board-components"),
    wireLayer: document.querySelector("#wire-layer"),
    wiringStatus: document.querySelector("#wiring-status"),
    boardToolbar: document.querySelector(".board-toolbar")
  };

  document.querySelector("#jump-to-lab").addEventListener("click", () => {
    document.querySelector("#lab-section").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.querySelector("#reset-progress").addEventListener("click", resetProgress);
  document.querySelector("#validate-circuit").addEventListener("click", validateCircuit);
  document.querySelector("#clear-connections").addEventListener("click", clearConnections);
  document.querySelector("#cancel-wire").addEventListener("click", cancelPendingWire);
  document.querySelector("#reset-board").addEventListener("click", () => bootstrapLevel(getActiveLevel()));
  window.addEventListener("resize", renderWires);

  refs.boardCanvas.addEventListener("mousemove", (event) => {
    const boardRect = refs.boardCanvas.getBoundingClientRect();
    state.mousePosition = {
      x: event.clientX - boardRect.left,
      y: event.clientY - boardRect.top
    };
    if (state.pendingWireStart) {
      requestAnimationFrame(renderWires);
    }
  });

  renderLessons();
  renderLevels();
  bootstrapLevel(getActiveLevel());
  renderProgress();

  function renderLessons() {
    const template = document.querySelector("#lesson-card-template");
    refs.lessonList.innerHTML = "";

    lessons.forEach((lesson) => {
      const fragment = template.content.cloneNode(true);
      fragment.querySelector(".lesson-card__icon").textContent = lesson.icon;
      fragment.querySelector("h3").textContent = lesson.title;
      fragment.querySelector(".muted").textContent = lesson.summary;
      fragment.querySelector(".lesson-card__body").textContent = lesson.body;
      fragment.querySelector(".lesson-card__tip").textContent = lesson.tip;
      refs.lessonList.appendChild(fragment);
    });
  }

  function renderLevels() {
    const template = document.querySelector("#level-card-template");
    refs.levelList.innerHTML = "";

    levels.forEach((level) => {
      const fragment = template.content.cloneNode(true);
      const card = fragment.querySelector(".level-card");
      const badge = fragment.querySelector(".badge");
      const title = fragment.querySelector("strong");
      const description = fragment.querySelector("p");
      const completed = Boolean(state.progress[level.id]);

      card.dataset.levelId = level.id;
      title.textContent = level.title;
      description.textContent = level.description;
      badge.textContent = completed ? "已完成" : "进行中";
      badge.classList.toggle("is-success", completed);
      badge.classList.toggle("is-warning", !completed);
      card.classList.toggle("is-active", level.id === state.activeLevelId);
      card.addEventListener("click", () => {
        state.activeLevelId = level.id;
        renderLevels();
        bootstrapLevel(level);
        renderProgress();
      });
      refs.levelList.appendChild(fragment);
    });
  }

  function bootstrapLevel(level) {
    state.instanceSeed = 0;
    state.pendingWireStart = null;
    state.dragState = null;
    state.connections = [];
    state.isRunning = false;
    state.switchStates = {};
    state.placedComponents = level.starterComponents.map((componentId, index) => {
      const instance = createInstance(componentId, getStarterPosition(index));
      if (componentId === "switch") {
        state.switchStates[instance.instanceId] = true;
      }
      return instance;
    });

    refs.levelTitle.textContent = level.title;
    refs.levelDescription.textContent = level.description;
    refs.activeLevelTitle.textContent = level.title;
    refs.levelGoals.innerHTML = level.goals.map((goal) => `<li>${goal}</li>`).join("");
    refs.feedbackSummary.textContent = "先在实验台摆好元件并连线，再点击“验证电路”。";
    refs.feedbackPass.innerHTML = "";
    refs.feedbackFail.innerHTML = "";
    refs.feedbackBadge.textContent = "待验证";
    refs.feedbackBadge.className = "badge";
    
    refs.boardCanvas.classList.remove("is-running");
    if (refs.boardToolbar) {
      refs.boardToolbar.classList.remove("is-running");
    }

    updateWiringStatus();
    renderPalette(level);
    renderPlacedComponents();
    renderConnections();
    renderBoard();
  }

  function renderPalette(level) {
    const template = document.querySelector("#palette-card-template");
    refs.componentPalette.innerHTML = "";

    components.forEach((component) => {
      const fragment = template.content.cloneNode(true);
      const isRecommended =
        level.requiredTypes.includes(component.id) || level.recommendedTypes.includes(component.id);

      fragment.querySelector("h3").textContent = component.name;
      fragment.querySelector("p").textContent = component.description;
      fragment.querySelector(".component-card__meta").innerHTML =
        component.tags.map((tag) => `<span class="badge">${tag}</span>`).join("") +
        (isRecommended ? '<span class="badge is-success">推荐</span>' : "");
      fragment.querySelector("button").addEventListener("click", () => {
        const instance = createInstance(component.id, getDropPosition());
        if (component.id === "switch") {
          state.switchStates[instance.instanceId] = true;
        }
        state.placedComponents.push(instance);
        renderPlacedComponents();
        renderBoard();
      });

      refs.componentPalette.appendChild(fragment);
    });
  }

  function renderPlacedComponents() {
    refs.activeComponents.innerHTML = "";

    if (state.placedComponents.length === 0) {
      refs.activeComponents.innerHTML = '<p class="muted">实验台为空，请从左侧元件库放置元件。</p>';
      return;
    }

    state.placedComponents.forEach((component) => {
      const row = document.createElement("div");
      row.className = "active-component-row";
      row.innerHTML = `
        <div>
          <strong>${component.instanceId}</strong>
          <span>${component.name} · (${Math.round(component.x)}, ${Math.round(component.y)})</span>
        </div>
        <button class="button button--ghost">移除</button>
      `;
      row.querySelector("button").addEventListener("click", () => {
        removeComponent(component.instanceId);
      });
      refs.activeComponents.appendChild(row);
    });
  }

  function renderConnections() {
    refs.connectionList.innerHTML = "";

    if (state.connections.length === 0) {
      refs.connectionList.innerHTML = '<p class="muted">还没有导线。点击两个端口即可布线。</p>';
      return;
    }

    state.connections.forEach((connection) => {
      const item = document.createElement("div");
      item.className = "connection-item";
      item.innerHTML = `
        <span>${formatPortLabel(connection.from)} <strong>→</strong> ${formatPortLabel(connection.to)}</span>
        <button class="button button--ghost">删除</button>
      `;
      item.querySelector("button").addEventListener("click", () => {
        state.connections = state.connections.filter((entry) => entry.id !== connection.id);
        renderConnections();
        renderWires();
      });
      refs.connectionList.appendChild(item);
    });
  }

  function renderBoard() {
    refs.boardComponents.innerHTML = "";
    state.placedComponents.forEach((component) => {
      refs.boardComponents.appendChild(createBoardComponent(component));
    });
    highlightSelectedPort();
    requestAnimationFrame(renderWires);
  }

  function createBoardComponent(component) {
    const element = document.createElement("article");
    element.className = "board-component";
    element.style.left = `${component.x}px`;
    element.style.top = `${component.y}px`;
    element.dataset.instanceId = component.instanceId;

    if (state.isRunning) {
      element.classList.add("is-running");
    }

    const leftPorts = component.ports.slice(0, 1);
    const rightPorts = component.ports.slice(1);
    if (rightPorts.length === 0) {
      rightPorts.push(component.ports[0]);
      leftPorts.length = 0;
    }

    const symbolClass = getSymbolClass(component.id);
    const switchIndicator = component.id === "switch" 
      ? `<div class="switch-indicator ${state.switchStates[component.instanceId] ? 'is-closed' : ''}" data-instance-id="${component.instanceId}"></div>`
      : '';

    element.innerHTML = `
      <div class="board-component__header">
        <div>
          <h3>${component.name}</h3>
          <p>${component.instanceId}</p>
        </div>
        <button class="board-component__remove" aria-label="移除元件">x</button>
      </div>
      <div class="board-component__body">
        <div class="port-stack port-stack--left">${leftPorts
          .map((port) => createPortButton(component, port))
          .join("")}</div>
        <div class="component-symbol ${symbolClass}">${getComponentSymbol(component.id)}${switchIndicator}</div>
        <div class="port-stack port-stack--right">${rightPorts
          .map((port) => createPortButton(component, port))
          .join("")}</div>
      </div>
    `;

    element.querySelector(".board-component__remove").addEventListener("click", (event) => {
      event.stopPropagation();
      removeComponent(component.instanceId);
    });

    element.querySelectorAll(".port-button").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        handlePortClick(button.dataset.portRef);
      });

      button.addEventListener("mouseenter", (event) => {
        state.hoveredPort = button.dataset.portRef;
        button.classList.add("is-hovered");
        if (state.pendingWireStart) {
          requestAnimationFrame(renderWires);
        }
      });

      button.addEventListener("mouseleave", (event) => {
        state.hoveredPort = null;
        button.classList.remove("is-hovered");
        if (state.pendingWireStart) {
          requestAnimationFrame(renderWires);
        }
      });
    });

    const switchIndicatorEl = element.querySelector(".switch-indicator");
    if (switchIndicatorEl) {
      switchIndicatorEl.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleSwitch(component.instanceId);
      });
    }

    element.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".port-button") || 
          event.target.closest(".board-component__remove") ||
          event.target.closest(".switch-indicator")) {
        return;
      }

      const boardRect = refs.boardCanvas.getBoundingClientRect();
      state.dragState = {
        instanceId: component.instanceId,
        offsetX: event.clientX - boardRect.left - component.x,
        offsetY: event.clientY - boardRect.top - component.y
      };
      element.classList.add("is-dragging");
      element.setPointerCapture(event.pointerId);
    });

    element.addEventListener("pointermove", (event) => {
      if (!state.dragState || state.dragState.instanceId !== component.instanceId) {
        return;
      }

      const boardRect = refs.boardCanvas.getBoundingClientRect();
      component.x = clamp(event.clientX - boardRect.left - state.dragState.offsetX, 20, BOARD_MAX_X);
      component.y = clamp(event.clientY - boardRect.top - state.dragState.offsetY, 20, BOARD_MAX_Y);
      element.style.left = `${component.x}px`;
      element.style.top = `${component.y}px`;
      renderWires();
      renderPlacedComponents();
    });

    const endDrag = () => {
      if (!state.dragState || state.dragState.instanceId !== component.instanceId) {
        return;
      }

      state.dragState = null;
      element.classList.remove("is-dragging");
    };

    element.addEventListener("pointerup", endDrag);
    element.addEventListener("pointercancel", endDrag);

    return element;
  }

  function getSymbolClass(componentId) {
    if (!state.isRunning) return "";
    if (componentId === "led") return "is-lit-led";
    if (componentId === "lamp") return "is-lit-lamp";
    if (componentId === "battery") return "is-lit";
    return "";
  }

  function toggleSwitch(instanceId) {
    state.switchStates[instanceId] = !state.switchStates[instanceId];
    const indicator = refs.boardComponents.querySelector(
      `.switch-indicator[data-instance-id="${instanceId}"]`
    );
    if (indicator) {
      indicator.classList.toggle("is-closed", state.switchStates[instanceId]);
    }
  }

  function handlePortClick(portRef) {
    if (!state.pendingWireStart) {
      state.pendingWireStart = portRef;
      updateWiringStatus();
      highlightSelectedPort();
      return;
    }

    if (state.pendingWireStart === portRef) {
      cancelPendingWire();
      return;
    }

    const [fromInstance] = state.pendingWireStart.split(":");
    const [toInstance] = portRef.split(":");

    if (fromInstance === toInstance) {
      setFeedback({
        passed: false,
        summary: "同一个元件的两个端口不能用外部导线直接短接。",
        passItems: [],
        failItems: ["请改为连接到其他元件的端口。"]
      });
      cancelPendingWire();
      return;
    }

    const duplicate = state.connections.some(
      (connection) =>
        (connection.from === state.pendingWireStart && connection.to === portRef) ||
        (connection.from === portRef && connection.to === state.pendingWireStart)
    );

    if (duplicate) {
      setFeedback({
        passed: false,
        summary: "这条导线已经存在。",
        passItems: [],
        failItems: ["重复导线不会改变当前电路结构。"]
      });
      cancelPendingWire();
      return;
    }

    state.connections.push({
      id: `${state.pendingWireStart}->${portRef}`,
      from: state.pendingWireStart,
      to: portRef
    });
    state.pendingWireStart = null;
    updateWiringStatus();
    highlightSelectedPort();
    renderConnections();
    renderWires();
  }

  function clearConnections() {
    state.connections = [];
    cancelPendingWire();
    renderConnections();
    renderWires();
  }

  function validateCircuit() {
    const level = getActiveLevel();
    const result = window.CircuitValidator.validate(level, state.placedComponents, state.connections);

    if (result.passed) {
      state.progress[level.id] = {
        completedAt: new Date().toISOString()
      };
      saveProgress();
      renderLevels();
      renderProgress();
      enterRunningState();
    }

    setFeedback(result);
  }

  function enterRunningState() {
    state.isRunning = true;
    refs.boardCanvas.classList.add("is-running");
    if (refs.boardToolbar) {
      refs.boardToolbar.classList.add("is-running");
    }
    renderBoard();
  }

  function setFeedback(result) {
    refs.feedbackSummary.textContent = result.summary;
    refs.feedbackPass.innerHTML = result.passItems.length
      ? result.passItems.map((item) => `<li>${item}</li>`).join("")
      : "<li>暂时还没有通过项。</li>";
    refs.feedbackFail.innerHTML = result.failItems.length
      ? result.failItems.map((item) => `<li>${item}</li>`).join("")
      : "<li>没有待修正项。</li>";
    refs.feedbackBadge.textContent = result.passed ? "已通过" : "未通过";
    refs.feedbackBadge.className = `badge ${result.passed ? "is-success" : "is-warning"}`;
  }

  function removeComponent(instanceId) {
    state.placedComponents = state.placedComponents.filter((component) => component.instanceId !== instanceId);
    state.connections = state.connections.filter(
      (connection) => !connection.from.startsWith(instanceId) && !connection.to.startsWith(instanceId)
    );
    if (state.pendingWireStart && state.pendingWireStart.startsWith(instanceId)) {
      state.pendingWireStart = null;
    }
    delete state.switchStates[instanceId];
    updateWiringStatus();
    renderPlacedComponents();
    renderConnections();
    renderBoard();
  }

  function renderProgress() {
    const completed = Object.keys(state.progress).length;
    refs.completedCount.textContent = `${completed} / ${levels.length}`;
  }

  function renderWires() {
    const boardRect = refs.boardCanvas.getBoundingClientRect();
    const width = Math.max(boardRect.width, 1000);
    const height = Math.max(boardRect.height, 700);
    refs.wireLayer.setAttribute("viewBox", `0 0 ${width} ${height}`);
    refs.wireLayer.innerHTML = "";

    state.connections.forEach((connection) => {
      const from = getPortCenter(connection.from, boardRect);
      const to = getPortCenter(connection.to, boardRect);

      if (!from || !to) {
        return;
      }

      const fromSide = getPortSide(connection.from);
      const toSide = getPortSide(connection.to);
      
      const path = createOptimizedWirePath(from, to, fromSide, toSide, false);
      if (state.isRunning) {
        path.classList.add("is-powered");
      }
      refs.wireLayer.appendChild(path);
    });

    if (state.pendingWireStart) {
      const start = getPortCenter(state.pendingWireStart, boardRect);
      if (start) {
        let endPoint;
        let endPort = null;
        
        if (state.hoveredPort && state.hoveredPort !== state.pendingWireStart) {
          const [hoverInstance] = state.hoveredPort.split(":");
          const [startInstance] = state.pendingWireStart.split(":");
          if (hoverInstance !== startInstance) {
            endPoint = getPortCenter(state.hoveredPort, boardRect);
            endPort = state.hoveredPort;
          }
        }
        
        if (!endPoint) {
          endPoint = state.mousePosition;
        }

        const fromSide = getPortSide(state.pendingWireStart);
        const toSide = endPort ? getPortSide(endPort) : "auto";
        
        const previewPath = createOptimizedWirePath(start, endPoint, fromSide, toSide, true);
        refs.wireLayer.appendChild(previewPath);
      }
    }
  }

  function getPortSide(portRef) {
    const selector = `[data-port-ref="${escapeSelector(portRef)}"]`;
    const port = refs.boardComponents.querySelector(selector);
    if (!port) return "auto";
    
    const portStack = port.closest(".port-stack");
    if (portStack && portStack.classList.contains("port-stack--left")) return "left";
    if (portStack && portStack.classList.contains("port-stack--right")) return "right";
    return "auto";
  }

  function createOptimizedWirePath(from, to, fromSide, toSide, isPreview) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    
    const MIN_OFFSET = 40;
    let controlPoint1, controlPoint2;
    
    let fromOffset = fromSide === "left" ? -MIN_OFFSET : (fromSide === "right" ? MIN_OFFSET : 0);
    let toOffset = toSide === "left" ? -MIN_OFFSET : (toSide === "right" ? MIN_OFFSET : 0);
    
    if (fromOffset === 0) {
      fromOffset = to.x > from.x ? MIN_OFFSET : -MIN_OFFSET;
    }
    if (toOffset === 0) {
      toOffset = from.x > to.x ? -MIN_OFFSET : MIN_OFFSET;
    }
    
    const fromExit = { x: from.x + fromOffset, y: from.y };
    const toEntry = { x: to.x + toOffset, y: to.y };
    
    const dx = Math.abs(fromExit.x - toEntry.x);
    const midX = (fromExit.x + toEntry.x) / 2;
    const useMidControl = dx > MIN_OFFSET * 2;
    
    if (useMidControl) {
      controlPoint1 = { x: midX, y: fromExit.y };
      controlPoint2 = { x: midX, y: toEntry.y };
    } else {
      const avgY = (fromExit.y + toEntry.y) / 2;
      controlPoint1 = { x: fromExit.x, y: avgY };
      controlPoint2 = { x: toEntry.x, y: avgY };
    }

    path.setAttribute(
      "d",
      `M ${from.x} ${from.y} L ${fromExit.x} ${fromExit.y} C ${controlPoint1.x} ${controlPoint1.y}, ${controlPoint2.x} ${controlPoint2.y}, ${toEntry.x} ${toEntry.y} L ${to.x} ${to.y}`
    );
    
    path.setAttribute("class", `wire-line${isPreview ? " wire-line--preview" : ""}`);
    return path;
  }

  function getPortCenter(portRef, boardRect) {
    const selector = `[data-port-ref="${escapeSelector(portRef)}"]`;
    const port = refs.boardComponents.querySelector(selector);
    if (!port) {
      return null;
    }

    const rect = port.getBoundingClientRect();
    return {
      x: rect.left - boardRect.left + rect.width / 2,
      y: rect.top - boardRect.top + rect.height / 2
    };
  }

  function highlightSelectedPort() {
    refs.boardComponents.querySelectorAll(".port-button").forEach((button) => {
      const isSelected = button.dataset.portRef === state.pendingWireStart;
      button.classList.toggle("is-selected", isSelected);
      
      if (state.pendingWireStart && !isSelected) {
        const [buttonInstance] = button.dataset.portRef.split(":");
        const [startInstance] = state.pendingWireStart.split(":");
        button.classList.toggle("is-connectable", buttonInstance !== startInstance);
      } else {
        button.classList.remove("is-connectable");
      }
    });
  }

  function updateWiringStatus() {
    refs.wiringStatus.textContent = state.pendingWireStart
      ? `已选择 ${formatPortLabel(state.pendingWireStart)}，请点击第二个端口`
      : "点击一个端口开始布线";
  }

  function cancelPendingWire() {
    state.pendingWireStart = null;
    state.hoveredPort = null;
    updateWiringStatus();
    highlightSelectedPort();
    renderWires();
  }

  function formatPortLabel(portRef) {
    const [instanceId, portId] = portRef.split(":");
    const component = state.placedComponents.find((item) => item.instanceId === instanceId);
    const port = component ? component.ports.find((item) => item.id === portId) : null;
    return port ? `${instanceId}.${port.label}` : portRef;
  }

  function createInstance(componentId, position) {
    const definition = components.find((item) => item.id === componentId);
    state.instanceSeed += 1;
    return {
      ...definition,
      ports: definition.ports.map((port) => ({ ...port })),
      instanceId: `${componentId}-${state.instanceSeed}`,
      x: position.x,
      y: position.y
    };
  }

  function createPortButton(component, port) {
    const portRef = `${component.instanceId}:${port.id}`;
    return `
      <button
        class="port-button"
        type="button"
        data-port-ref="${portRef}"
        data-label="${port.label}"
        title="${component.instanceId}.${port.label}"
      ></button>
    `;
  }

  function getStarterPosition(index) {
    const columns = 3;
    const gapX = 250;
    const gapY = 180;
    return {
      x: 40 + (index % columns) * gapX,
      y: 48 + Math.floor(index / columns) * gapY
    };
  }

  function getDropPosition() {
    const index = state.placedComponents.length;
    const start = getStarterPosition(index);
    return {
      x: clamp(start.x + 20, 20, BOARD_MAX_X),
      y: clamp(start.y + 20, 20, BOARD_MAX_Y)
    };
  }

  function getComponentSymbol(componentId) {
    const map = {
      battery: "+ -",
      wire: "WIRE",
      switch: "SW",
      resistor: "R",
      led: "LED",
      lamp: "LAMP"
    };
    return map[componentId] || componentId.toUpperCase();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getActiveLevel() {
    return levels.find((level) => level.id === state.activeLevelId) || levels[0];
  }

  function loadProgress() {
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY)) || {};
    } catch (error) {
      return {};
    }
  }

  function saveProgress() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
  }

  function resetProgress() {
    state.progress = {};
    saveProgress();
    renderLevels();
    renderProgress();
    bootstrapLevel(getActiveLevel());
  }

  function escapeSelector(value) {
    return value.replace(/["\\]/g, "\\$&");
  }
})();
