(function () {
  const STORAGE_KEY = "circulab-progress-v1";
  const { lessons, components, levels } = window.CIRCUIT_DATA;
  const BOARD_MAX_X = 1020;
  const BOARD_MAX_Y = 640;
  const BOARD_SURFACE_WIDTH = 1120;
  const BOARD_SURFACE_HEIGHT = 760;
  const BOARD_ZOOM_MIN = 0.6;
  const BOARD_ZOOM_MAX = 1.8;
  const BOARD_ZOOM_STEP = 0.2;

  const MIN_WIRE_SEGMENT = 30;
  const WIRE_CORNER_RADIUS = 8;
  const PORT_LEAD_LENGTH = 18;

  const COMPONENT_WIDTH = 168;
  const COMPONENT_HEADER_HEIGHT = 52;
  const COMPONENT_BODY_PADDING = 14;
  const PORT_BUTTON_SIZE = 18;
  const PORT_STACK_GAP = 14;
  const PORT_STACK_LEFT_OFFSET = -23;
  const PORT_STACK_RIGHT_OFFSET = 23;

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
    boardZoom: 1,
    boardOffsetX: 0,
    boardOffsetY: 0,
    panState: null,
    mousePosition: { x: 0, y: 0 },
    hoveredPort: null,
    poweredPorts: new Set(),
    poweredConnections: new Set()
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
    boardViewport: document.querySelector("#board-viewport"),
    boardSurface: document.querySelector("#board-surface"),
    boardComponents: document.querySelector("#board-components"),
    wireLayer: document.querySelector("#wire-layer"),
    wiringStatus: document.querySelector("#wiring-status"),
    boardToolbar: document.querySelector(".board-toolbar"),
    zoomOut: document.querySelector("#zoom-out"),
    zoomIn: document.querySelector("#zoom-in"),
    zoomReset: document.querySelector("#zoom-reset"),
    zoomLevel: document.querySelector("#zoom-level")
  };

  document.querySelector("#jump-to-lab").addEventListener("click", () => {
    document.querySelector("#lab-section").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.querySelector("#reset-progress").addEventListener("click", resetProgress);
  document.querySelector("#validate-circuit").addEventListener("click", validateCircuit);
  document.querySelector("#clear-connections").addEventListener("click", clearConnections);
  document.querySelector("#cancel-wire").addEventListener("click", cancelPendingWire);
  document.querySelector("#reset-board").addEventListener("click", () => bootstrapLevel(getActiveLevel()));
  refs.zoomOut.addEventListener("click", () => setBoardZoom(state.boardZoom - BOARD_ZOOM_STEP));
  refs.zoomIn.addEventListener("click", () => setBoardZoom(state.boardZoom + BOARD_ZOOM_STEP));
  refs.zoomReset.addEventListener("click", resetBoardView);
  window.addEventListener("resize", renderWires);

  refs.boardCanvas.addEventListener("mousedown", handleCanvasMouseDown);
  refs.boardCanvas.addEventListener("mousemove", (event) => {
    handleCanvasMouseMove(event);
    state.mousePosition = screenToLogical(event.clientX, event.clientY);
    if (state.pendingWireStart) {
      requestAnimationFrame(renderWires);
    }
  });
  refs.boardCanvas.addEventListener("mouseup", handleCanvasMouseUp);
  refs.boardCanvas.addEventListener("mouseleave", handleCanvasMouseUp);
  refs.boardCanvas.addEventListener("wheel", handleCanvasWheel, { passive: false });
  refs.boardCanvas.addEventListener("contextmenu", (e) => e.preventDefault());

  applyBoardTransform();
  renderLessons();
  renderLevels();
  bootstrapLevel(getActiveLevel());
  renderProgress();

  function screenToLogical(screenX, screenY) {
    const boardRect = refs.boardCanvas.getBoundingClientRect();
    const viewportX = screenX - boardRect.left - refs.boardCanvas.scrollLeft;
    const viewportY = screenY - boardRect.top - refs.boardCanvas.scrollTop;
    return {
      x: (viewportX - state.boardOffsetX * state.boardZoom) / state.boardZoom,
      y: (viewportY - state.boardOffsetY * state.boardZoom) / state.boardZoom
    };
  }

  function logicalToScreen(logicalX, logicalY) {
    const boardRect = refs.boardCanvas.getBoundingClientRect();
    const viewportX = (logicalX + state.boardOffsetX) * state.boardZoom + refs.boardCanvas.scrollLeft;
    const viewportY = (logicalY + state.boardOffsetY) * state.boardZoom + refs.boardCanvas.scrollTop;
    return {
      x: viewportX + boardRect.left,
      y: viewportY + boardRect.top
    };
  }

  function applyBoardTransform() {
    refs.boardCanvas.style.setProperty("--board-scale", String(state.boardZoom));
    refs.boardCanvas.style.setProperty("--board-offset-x", `${state.boardOffsetX}px`);
    refs.boardCanvas.style.setProperty("--board-offset-y", `${state.boardOffsetY}px`);
    refs.boardCanvas.style.setProperty("--board-surface-width", `${BOARD_SURFACE_WIDTH}px`);
    refs.boardCanvas.style.setProperty("--board-surface-height", `${BOARD_SURFACE_HEIGHT}px`);
    refs.zoomLevel.textContent = `${Math.round(state.boardZoom * 100)}%`;
    updateZoomControls();
  }

  function setBoardZoomAround(newZoom, logicalCenterX, logicalCenterY) {
    const clampedZoom = clamp(newZoom, BOARD_ZOOM_MIN, BOARD_ZOOM_MAX);
    if (Math.abs(clampedZoom - state.boardZoom) < 0.001) {
      return;
    }

    const oldZoom = state.boardZoom;
    const screenCenter = logicalToScreen(logicalCenterX, logicalCenterY);

    state.boardZoom = clampedZoom;

    const newOffsetX = (screenCenter.x - refs.boardCanvas.getBoundingClientRect().left - refs.boardCanvas.scrollLeft) / state.boardZoom - logicalCenterX;
    const newOffsetY = (screenCenter.y - refs.boardCanvas.getBoundingClientRect().top - refs.boardCanvas.scrollTop) / state.boardZoom - logicalCenterY;

    state.boardOffsetX = newOffsetX;
    state.boardOffsetY = newOffsetY;

    applyBoardTransform();
    requestAnimationFrame(renderWires);
  }

  function resetBoardView() {
    state.boardZoom = 1;
    state.boardOffsetX = 0;
    state.boardOffsetY = 0;
    applyBoardTransform();
    requestAnimationFrame(renderWires);
  }

  function handleCanvasMouseDown(event) {
    if (state.dragState) return;

    const isPanButton = event.button === 1 || event.button === 2;
    const isMiddleClick = event.button === 1;
    
    if (isPanButton || (isMiddleClick)) {
      event.preventDefault();
      const logicalPos = screenToLogical(event.clientX, event.clientY);
      state.panState = {
        startLogicalX: logicalPos.x,
        startLogicalY: logicalPos.y,
        startOffsetX: state.boardOffsetX,
        startOffsetY: state.boardOffsetY
      };
      refs.boardCanvas.classList.add("is-panning");
    }
  }

  function handleCanvasMouseMove(event) {
    if (state.panState) {
      event.preventDefault();
      const logicalPos = screenToLogical(event.clientX, event.clientY);
      const deltaX = logicalPos.x - state.panState.startLogicalX;
      const deltaY = logicalPos.y - state.panState.startLogicalY;
      
      state.boardOffsetX = state.panState.startOffsetX - deltaX;
      state.boardOffsetY = state.panState.startOffsetY - deltaY;
      
      applyBoardTransform();
    }
  }

  function handleCanvasMouseUp(event) {
    if (state.panState) {
      state.panState = null;
      refs.boardCanvas.classList.remove("is-panning");
    }
  }

  function handleCanvasWheel(event) {
    event.preventDefault();
    
    const logicalPos = screenToLogical(event.clientX, event.clientY);
    const delta = event.deltaY > 0 ? -BOARD_ZOOM_STEP : BOARD_ZOOM_STEP;
    const newZoom = state.boardZoom + delta;
    
    setBoardZoomAround(newZoom, logicalPos.x, logicalPos.y);
  }

  function getPortAnchorLogical(portRef) {
    const [instanceId, portId] = portRef.split(":");
    const component = state.placedComponents.find(c => c.instanceId === instanceId);
    if (!component) return null;

    const port = component.ports.find(p => p.id === portId);
    if (!port) return null;

    const leftPorts = component.ports.slice(0, 1);
    const rightPorts = component.ports.slice(1);
    
    let direction = 0;
    let isLeftSide = false;
    let isRightSide = false;

    if (rightPorts.length === 0) {
      if (component.ports[0].id === portId) {
        isRightSide = true;
        direction = 1;
      }
    } else {
      if (leftPorts.some(p => p.id === portId)) {
        isLeftSide = true;
        direction = -1;
      }
      if (rightPorts.some(p => p.id === portId)) {
        isRightSide = true;
        direction = 1;
      }
    }

    const portStack = isLeftSide ? leftPorts : rightPorts;
    const portIndex = portStack.findIndex(p => p.id === portId);

    const componentCenterY = component.y + COMPONENT_HEADER_HEIGHT + COMPONENT_BODY_PADDING + 23;
    const stackTopY = componentCenterY - ((portStack.length - 1) * (PORT_BUTTON_SIZE + PORT_STACK_GAP)) / 2;
    const portCenterY = stackTopY + portIndex * (PORT_BUTTON_SIZE + PORT_STACK_GAP);

    let portCenterX;
    let attachPoint;

    if (isLeftSide) {
      portCenterX = component.x + PORT_STACK_LEFT_OFFSET + PORT_BUTTON_SIZE / 2;
      attachPoint = { x: component.x + PORT_STACK_LEFT_OFFSET, y: portCenterY };
    } else if (isRightSide) {
      portCenterX = component.x + COMPONENT_WIDTH + PORT_STACK_RIGHT_OFFSET - PORT_BUTTON_SIZE / 2;
      attachPoint = { x: component.x + COMPONENT_WIDTH + PORT_STACK_RIGHT_OFFSET, y: portCenterY };
    } else {
      portCenterX = component.x + COMPONENT_WIDTH / 2;
      attachPoint = { x: portCenterX, y: portCenterY };
    }

    return {
      attachPoint: attachPoint,
      center: { x: portCenterX, y: portCenterY },
      exitPoint: createLeadPoint(attachPoint, direction, PORT_LEAD_LENGTH),
      side: isLeftSide ? "left" : isRightSide ? "right" : "auto",
      direction: direction,
      componentX: portCenterX,
      componentY: portCenterY
    };
  }

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

    const symbolClass = getSymbolClass(component.id, component.instanceId);
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

      const pointerPos = getBoardPointerPosition(event);
      state.dragState = {
        instanceId: component.instanceId,
        offsetX: pointerPos.x - component.x,
        offsetY: pointerPos.y - component.y
      };
      element.classList.add("is-dragging");
      element.setPointerCapture(event.pointerId);
    });

    element.addEventListener("pointermove", (event) => {
      if (!state.dragState || state.dragState.instanceId !== component.instanceId) {
        return;
      }

      const pointerPos = getBoardPointerPosition(event);
      component.x = clamp(pointerPos.x - state.dragState.offsetX, 20, BOARD_MAX_X);
      component.y = clamp(pointerPos.y - state.dragState.offsetY, 20, BOARD_MAX_Y);
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

  function getSymbolClass(componentId, instanceId) {
    if (!state.isRunning) return "";
    if (componentId === "battery") return "is-lit";

    const component = state.placedComponents.find((c) => c.instanceId === instanceId);
    if (!component) return "";

    const hasPoweredPort = component.ports.some((port) => {
      const portRef = `${instanceId}:${port.id}`;
      return state.poweredPorts.has(portRef);
    });

    if (hasPoweredPort) {
      if (componentId === "led") return "is-lit-led";
      if (componentId === "lamp") return "is-lit-lamp";
    }
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

    if (state.isRunning) {
      calculatePoweredPaths();
      renderBoard();
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
    if (state.isRunning) {
      exitRunningState();
    }
    renderConnections();
    renderBoard();
  }

  function validateCircuit() {
    const level = getActiveLevel();
    const result = window.CircuitValidator.validate(
      level, 
      state.placedComponents, 
      state.connections,
      state.switchStates
    );

    if (result.passed) {
      state.progress[level.id] = {
        completedAt: new Date().toISOString()
      };
      saveProgress();
      renderLevels();
      renderProgress();
      enterRunningState();
    } else {
      exitRunningState();
      renderBoard();
    }

    setFeedback(result);
  }

  function enterRunningState() {
    state.isRunning = true;
    refs.boardCanvas.classList.add("is-running");
    if (refs.boardToolbar) {
      refs.boardToolbar.classList.add("is-running");
    }
    calculatePoweredPaths();
    renderBoard();
  }

  function exitRunningState() {
    state.isRunning = false;
    state.poweredPorts.clear();
    state.poweredConnections.clear();
    refs.boardCanvas.classList.remove("is-running");
    if (refs.boardToolbar) {
      refs.boardToolbar.classList.remove("is-running");
    }
  }

  function calculatePoweredPaths() {
    state.poweredPorts = new Set();
    state.poweredConnections = new Set();

    const batteries = state.placedComponents.filter((c) => c.id === "battery");
    if (batteries.length === 0) return;

    const battery = batteries[0];
    const positivePort = `${battery.instanceId}:positive`;
    const negativePort = `${battery.instanceId}:negative`;

    const { graph, meta } = buildGraphWithSwitches(
      state.placedComponents,
      state.connections,
      state.switchStates
    );

    const visited = new Set();
    const queue = [positivePort];
    visited.add(positivePort);
    state.poweredPorts.add(positivePort);

    while (queue.length > 0) {
      const current = queue.shift();
      const neighbors = graph[current] || new Set();

      neighbors.forEach((next) => {
        if (!visited.has(next)) {
          visited.add(next);
          state.poweredPorts.add(next);

          const conn = state.connections.find(
            (c) =>
              (c.from === current && c.to === next) ||
              (c.from === next && c.to === current)
          );
          if (conn) {
            state.poweredConnections.add(conn.id);
          }

          queue.push(next);
        }
      });
    }

    if (state.poweredPorts.has(negativePort)) {
      state.poweredPorts.add(negativePort);
    }
  }

  function buildGraphWithSwitches(components, connections, switchStates) {
    const graph = {};
    const meta = {};

    components.forEach((component) => {
      component.ports.forEach((port) => {
        const portId = `${component.instanceId}:${port.id}`;
        graph[portId] = graph[portId] || new Set();
        meta[portId] = {
          componentId: component.id,
          instanceId: component.instanceId,
          portId: port.id,
          label: port.label
        };
      });

      const conductivePairs = getInternalConductivePairsWithSwitch(component, switchStates);
      conductivePairs.forEach(([from, to]) => {
        const fromId = `${component.instanceId}:${from}`;
        const toId = `${component.instanceId}:${to}`;
        if (graph[fromId] && graph[toId]) {
          graph[fromId].add(toId);
          graph[toId].add(fromId);
        }
      });
    });

    connections.forEach((connection) => {
      if (graph[connection.from] && graph[connection.to]) {
        graph[connection.from].add(connection.to);
        graph[connection.to].add(connection.from);
      }
    });

    return { graph, meta };
  }

  function getInternalConductivePairsWithSwitch(component, switchStates) {
    if (component.id === "led") {
      return [];
    }

    if (component.id === "switch") {
      const isClosed = switchStates[component.instanceId] === true;
      if (isClosed && component.ports.length >= 2) {
        return [[component.ports[0].id, component.ports[1].id]];
      }
      return [];
    }

    if (component.ports.length < 2) {
      return [];
    }

    return [[component.ports[0].id, component.ports[1].id]];
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

    const feedbackPanel = document.querySelector(".feedback-panel");
    if (feedbackPanel) {
      feedbackPanel.classList.toggle("is-failed", !result.passed);
    }
    refs.feedbackSummary.classList.toggle("is-failed", !result.passed);

    refs.boardComponents.querySelectorAll(".is-error").forEach((el) => {
      el.classList.remove("is-error");
    });
    refs.boardComponents.querySelectorAll(".port-button.is-error").forEach((el) => {
      el.classList.remove("is-error");
    });
    refs.wireLayer.querySelectorAll(".wire-line.is-error").forEach((el) => {
      el.classList.remove("is-error");
    });

    if (!result.passed) {
      if (result.failItems.length > 0) {
        const battery = state.placedComponents.find((c) => c.id === "battery");
        const switches = state.placedComponents.filter((c) => c.id === "switch");

        switches.forEach((sw) => {
          const isClosed = state.switchStates[sw.instanceId] === true;
          if (!isClosed) {
            const el = refs.boardComponents.querySelector(`[data-instance-id="${sw.instanceId}"]`);
            if (el) el.classList.add("is-error");
          }
        });

        if (state.connections.length === 0) {
          refs.boardComponents.querySelectorAll(".port-button").forEach((btn) => {
            btn.classList.add("is-error");
          });
        }
      }
    }
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
    if (state.isRunning) {
      exitRunningState();
    }
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
    const width = Math.max(refs.boardSurface.clientWidth, 1000);
    const height = Math.max(refs.boardSurface.clientHeight, 700);
    refs.wireLayer.setAttribute("viewBox", `0 0 ${width} ${height}`);

    let previewPath = refs.wireLayer.getElementById("preview-wire-path");

    if (state.pendingWireStart) {
      const fromAnchor = getPortAnchor(state.pendingWireStart);
      if (fromAnchor) {
        let toAnchor = null;

        if (state.hoveredPort && state.hoveredPort !== state.pendingWireStart) {
          const [hoverInstance] = state.hoveredPort.split(":");
          const [startInstance] = state.pendingWireStart.split(":");
          if (hoverInstance !== startInstance) {
            toAnchor = getPortAnchor(state.hoveredPort);
          }
        }

        if (!toAnchor) {
          toAnchor = createVirtualAnchor(fromAnchor, state.mousePosition);
        }

        if (!previewPath) {
          previewPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
          previewPath.setAttribute("id", "preview-wire-path");
          previewPath.setAttribute("class", "wire-line wire-line--preview");
          refs.wireLayer.appendChild(previewPath);
        }

        const pathData = createWirePathData(fromAnchor, toAnchor);
        previewPath.setAttribute("d", pathData);
        previewPath.style.display = "block";
      }
    } else {
      if (previewPath) {
        previewPath.style.display = "none";
      }
    }

    const currentConnectionIds = new Set();

    state.connections.forEach((connection) => {
      currentConnectionIds.add(connection.id);

      let path = refs.wireLayer.querySelector(`[data-connection-id="${escapeSelector(connection.id)}"]`);

      if (!path) {
        path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("data-connection-id", connection.id);
        path.setAttribute("class", "wire-line");
        refs.wireLayer.insertBefore(path, previewPath || refs.wireLayer.firstChild);
      }

      const fromAnchor = getPortAnchor(connection.from);
      const toAnchor = getPortAnchor(connection.to);

      if (!fromAnchor || !toAnchor) {
        path.style.display = "none";
        return;
      }

      path.style.display = "block";

      const pathData = createWirePathData(fromAnchor, toAnchor);
      path.setAttribute("d", pathData);

      const isPowered = state.isRunning && state.poweredConnections.has(connection.id);
      path.classList.toggle("is-powered", isPowered);
      path.classList.toggle("is-powered-reverse", false);
    });

    refs.wireLayer.querySelectorAll(".wire-line:not(.wire-line--preview)").forEach((path) => {
      const connId = path.getAttribute("data-connection-id");
      if (connId && !currentConnectionIds.has(connId)) {
        path.remove();
      }
    });
  }

  function createVirtualAnchor(fromAnchor, targetPos) {
    const deltaX = targetPos.x - fromAnchor.exitPoint.x;
    const deltaY = targetPos.y - fromAnchor.exitPoint.y;
    let virtualDirection = 0;

    if (Math.abs(deltaX) > Math.abs(deltaY) + 10) {
      virtualDirection = deltaX >= 0 ? -1 : 1;
    } else if (Math.abs(deltaY) > Math.abs(deltaX) + 10) {
      virtualDirection = deltaY >= 0 ? 2 : -2;
    } else {
      if (fromAnchor.direction !== 0) {
        virtualDirection = fromAnchor.direction;
      } else {
        virtualDirection = deltaX >= 0 ? -1 : 1;
      }
    }

    let attachPoint;
    let exitPoint;

    if (Math.abs(virtualDirection) === 1) {
      exitPoint = createLeadPoint(targetPos, virtualDirection, PORT_LEAD_LENGTH);
      if (virtualDirection === -1) {
        attachPoint = { x: targetPos.x, y: targetPos.y };
      } else {
        attachPoint = { x: targetPos.x, y: targetPos.y };
      }
    } else if (Math.abs(virtualDirection) === 2) {
      const yDirection = virtualDirection / 2;
      exitPoint = {
        x: targetPos.x,
        y: targetPos.y + yDirection * PORT_LEAD_LENGTH
      };
      attachPoint = { x: targetPos.x, y: targetPos.y };
    } else {
      exitPoint = { x: targetPos.x, y: targetPos.y };
      attachPoint = { x: targetPos.x, y: targetPos.y };
    }

    return {
      attachPoint: attachPoint,
      center: { x: targetPos.x, y: targetPos.y },
      exitPoint: exitPoint,
      side: virtualDirection === 1 ? "right" : virtualDirection === -1 ? "left" : "auto",
      direction: virtualDirection,
      componentX: targetPos.x,
      componentY: targetPos.y
    };
  }

  function createWirePathData(fromAnchor, toAnchor) {
    const points = calculateWireSegments(fromAnchor, toAnchor);

    if (points.length < 2) {
      return "";
    }

    return createRoundedOrthogonalPath(points);
  }

  function calculateWireSegments(fromAnchor, toAnchor) {
    const startAttach = fromAnchor.attachPoint || fromAnchor.exitPoint;
    const endAttach = toAnchor.attachPoint || toAnchor.exitPoint;
    const startExit = fromAnchor.exitPoint;
    const endExit = toAnchor.exitPoint;

    const points = [startAttach];

    if (!arePointsEqual(startAttach, startExit)) {
      points.push(startExit);
    }

    const startLane = createLanePoint(startExit, fromAnchor.direction, MIN_WIRE_SEGMENT);
    const endLane = createLanePoint(endExit, toAnchor.direction, MIN_WIRE_SEGMENT);

    if (!arePointsEqual(startExit, startLane)) {
      points.push(startLane);
    }

    const bridgePoints = calculateWireBridgePoints(startLane, endLane, fromAnchor.direction, toAnchor.direction);
    bridgePoints.forEach((point) => {
      points.push(point);
    });

    if (!arePointsEqual(points[points.length - 1], endLane)) {
      points.push(endLane);
    }

    if (!arePointsEqual(endLane, endExit)) {
      points.push(endExit);
    }

    if (!arePointsEqual(endExit, endAttach)) {
      points.push(endAttach);
    }

    return simplifyOrthogonalPoints(points);
  }

  function createLanePoint(point, direction, distance) {
    if (direction === 0) {
      return { x: point.x, y: point.y };
    }

    if (Math.abs(direction) === 1) {
      return {
        x: point.x + direction * distance,
        y: point.y
      };
    }

    if (Math.abs(direction) === 2) {
      const yDir = direction / 2;
      return {
        x: point.x,
        y: point.y + yDir * distance
      };
    }

    return { x: point.x, y: point.y };
  }

  function calculateWireBridgePoints(startLane, endLane, startDir, endDir) {
    if (arePointsEqual(startLane, endLane)) {
      return [];
    }

    const startIsHorizontal = Math.abs(startDir) === 1 || startDir === 0;
    const endIsHorizontal = Math.abs(endDir) === 1 || endDir === 0;

    const startX = startLane.x;
    const startY = startLane.y;
    const endX = endLane.x;
    const endY = endLane.y;

    const sameX = Math.abs(startX - endX) < 1;
    const sameY = Math.abs(startY - endY) < 1;

    if (sameX || sameY) {
      return [endLane];
    }

    if (startIsHorizontal && endIsHorizontal) {
      const laneX = pickWireLaneX(startLane, endLane, startDir, endDir);
      
      const directPathIsBetter = 
        ((startDir === 1 && endDir === -1 && endX > startX) ||
         (startDir === -1 && endDir === 1 && endX < startX)) &&
        Math.abs(endX - startX) > MIN_WIRE_SEGMENT * 2;

      if (directPathIsBetter && sameY) {
        return [endLane];
      }

      const midY = (startY + endY) / 2;
      const startToMidY = Math.abs(midY - startY);
      const endToMidY = Math.abs(endY - midY);

      if (startToMidY > MIN_WIRE_SEGMENT && endToMidY > MIN_WIRE_SEGMENT) {
        const useMidY = 
          (startDir === 1 && endDir === -1 && endX > startX) ||
          (startDir === -1 && endDir === 1 && endX < startX);

        if (useMidY) {
          return [
            { x: startX, y: midY },
            { x: endX, y: midY },
            endLane
          ];
        }
      }

      return [
        { x: laneX, y: startY },
        { x: laneX, y: endY },
        endLane
      ];
    }

    if (startIsHorizontal) {
      return [
        { x: startX, y: endY },
        endLane
      ];
    }

    if (endIsHorizontal) {
      return [
        { x: endX, y: startY },
        endLane
      ];
    }

    return [
      { x: startX, y: endY },
      endLane
    ];
  }

  function pickWireLaneX(startLane, endLane, startDir, endDir) {
    if (startDir === 1 && endDir === -1) {
      if (endLane.x >= startLane.x + MIN_WIRE_SEGMENT) {
        return (startLane.x + endLane.x) / 2;
      }
      return Math.max(startLane.x, endLane.x) + MIN_WIRE_SEGMENT;
    }

    if (startDir === -1 && endDir === 1) {
      if (endLane.x <= startLane.x - MIN_WIRE_SEGMENT) {
        return (startLane.x + endLane.x) / 2;
      }
      return Math.min(startLane.x, endLane.x) - MIN_WIRE_SEGMENT;
    }

    if (startDir === 1 && endDir === 1) {
      return Math.max(startLane.x, endLane.x) + MIN_WIRE_SEGMENT;
    }

    if (startDir === -1 && endDir === -1) {
      return Math.min(startLane.x, endLane.x) - MIN_WIRE_SEGMENT;
    }

    if (startDir === 1) {
      return Math.max(startLane.x, endLane.x, startLane.x + MIN_WIRE_SEGMENT);
    }

    if (startDir === -1) {
      return Math.min(startLane.x, endLane.x, startLane.x - MIN_WIRE_SEGMENT);
    }

    if (endDir === 1) {
      return Math.max(startLane.x, endLane.x, endLane.x + MIN_WIRE_SEGMENT);
    }

    if (endDir === -1) {
      return Math.min(startLane.x, endLane.x, endLane.x - MIN_WIRE_SEGMENT);
    }

    return (startLane.x + endLane.x) / 2;
  }

  function createRoundedOrthogonalPath(points) {
    let d = `M ${points[0].x} ${points[0].y}`;

    for (let i = 1; i < points.length; i++) {
      if (i === points.length - 1) {
        d += ` L ${points[i].x} ${points[i].y}`;
        continue;
      }

      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];
      const radius = getCornerRadius(prev, curr, next);

      if (radius <= 0) {
        d += ` L ${curr.x} ${curr.y}`;
        continue;
      }

      const cornerStart = movePointToward(curr, prev, radius);
      const cornerEnd = movePointToward(curr, next, radius);

      d += ` L ${cornerStart.x} ${cornerStart.y}`;
      d += ` Q ${curr.x} ${curr.y} ${cornerEnd.x} ${cornerEnd.y}`;
    }

    return d;
  }

  function getCornerRadius(prev, curr, next) {
    const prevDistance = distanceBetween(prev, curr);
    const nextDistance = distanceBetween(curr, next);

    if (prevDistance < 1 || nextDistance < 1) {
      return 0;
    }

    return Math.min(WIRE_CORNER_RADIUS, prevDistance / 2, nextDistance / 2);
  }

  function movePointToward(from, to, distance) {
    if (from.x === to.x) {
      return {
        x: from.x,
        y: from.y + Math.sign(to.y - from.y) * distance
      };
    }

    return {
      x: from.x + Math.sign(to.x - from.x) * distance,
      y: from.y
    };
  }

  function distanceBetween(a, b) {
    if (a.x === b.x) {
      return Math.abs(a.y - b.y);
    }

    return Math.abs(a.x - b.x);
  }

  function simplifyOrthogonalPoints(points) {
    const normalized = [];

    points.forEach((point) => {
      if (!normalized.length || !arePointsEqual(normalized[normalized.length - 1], point)) {
        normalized.push(point);
      }
    });

    const simplified = [];
    normalized.forEach((point) => {
      if (simplified.length < 2) {
        simplified.push(point);
        return;
      }

      const prev = simplified[simplified.length - 1];
      const prevPrev = simplified[simplified.length - 2];

      if (isCollinear(prevPrev, prev, point)) {
        simplified[simplified.length - 1] = point;
      } else {
        simplified.push(point);
      }
    });

    return simplified;
  }

  function isCollinear(a, b, c) {
    return (Math.abs(a.x - b.x) < 1 && Math.abs(b.x - c.x) < 1) ||
      (Math.abs(a.y - b.y) < 1 && Math.abs(b.y - c.y) < 1);
  }

  function arePointsEqual(a, b) {
    if (!a || !b) return false;
    return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
  }

  function createLeadPoint(point, direction, distance) {
    if (direction === 0) {
      return { x: point.x, y: point.y };
    }

    return {
      x: point.x + direction * distance,
      y: point.y
    };
  }

  function getPortAnchor(portRef) {
    return getPortAnchorLogical(portRef);
  }

  function getBoardPointerPosition(event) {
    return screenToLogical(event.clientX, event.clientY);
  }

  function setBoardZoom(nextZoom) {
    const canvas = refs.boardCanvas;
    const centerX = canvas.scrollLeft + canvas.clientWidth / 2;
    const centerY = canvas.scrollTop + canvas.clientHeight / 2;
    const boardRect = refs.boardCanvas.getBoundingClientRect();
    
    const screenCenterX = boardRect.left + centerX;
    const screenCenterY = boardRect.top + centerY;
    const logicalCenter = screenToLogical(screenCenterX, screenCenterY);
    
    setBoardZoomAround(nextZoom, logicalCenter.x, logicalCenter.y);
  }

  function applyBoardZoom() {
    applyBoardTransform();
  }

  function updateZoomControls() {
    refs.zoomOut.disabled = state.boardZoom <= BOARD_ZOOM_MIN + 0.001;
    refs.zoomIn.disabled = state.boardZoom >= BOARD_ZOOM_MAX - 0.001;
    refs.zoomReset.disabled = Math.abs(state.boardZoom - 1) < 0.001;
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
