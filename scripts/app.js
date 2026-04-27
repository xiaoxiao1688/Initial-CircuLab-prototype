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
  const GRID_SIZE = 32;

  const MIN_WIRE_SEGMENT = 30;
  const WIRE_CORNER_RADIUS = 8;
  const PORT_LEAD_LENGTH = 18;
  const PORT_SNAP_DISTANCE = 32;

  const COMPONENT_WIDTH = 168;
  const COMPONENT_HEADER_HEIGHT = 52;
  const COMPONENT_BODY_PADDING = 14;
  const PORT_BUTTON_SIZE = 18;
  const PORT_STACK_GAP = 14;
  const PORT_STACK_LEFT_OFFSET = -23;
  const PORT_STACK_RIGHT_OFFSET = 23;
  const PAN_SENSITIVITY = 0.28;
  const BOARD_PAN_PADDING = 96;
  const COMPONENT_PARAMETER_DEFS = {
    battery: [
      { key: "voltage", label: "电压", unit: "V", min: 0.5, max: 48, step: 0.1, defaultValue: 5 }
    ],
    resistor: [
      { key: "resistance", label: "电阻", unit: "Ω", min: 1, max: 100000, step: 1, defaultValue: 220 }
    ],
    led: [
      { key: "resistance", label: "串联电阻", unit: "Ω", min: 1, max: 10000, step: 1, defaultValue: 180 },
      { key: "forwardVoltage", label: "正向压降", unit: "V", min: 0.5, max: 5, step: 0.1, defaultValue: 2.0 }
    ],
    lamp: [
      { key: "resistance", label: "灯丝电阻", unit: "Ω", min: 1, max: 10000, step: 1, defaultValue: 120 }
    ],
    motor: [
      { key: "resistance", label: "绕组电阻", unit: "Ω", min: 1, max: 10000, step: 1, defaultValue: 56 }
    ],
    fan: [
      { key: "resistance", label: "等效电阻", unit: "Ω", min: 1, max: 10000, step: 1, defaultValue: 68 }
    ],
    buzzer: [
      { key: "resistance", label: "等效电阻", unit: "Ω", min: 1, max: 10000, step: 1, defaultValue: 150 }
    ],
    capacitor: [
      { key: "capacitance", label: "电容值", unit: "F", min: 0.000001, max: 0.01, step: 0.000001, defaultValue: 0.0001 }
    ],
    fuse: [
      { key: "resistance", label: "熔丝电阻", unit: "Ω", min: 0.01, max: 100, step: 0.01, defaultValue: 0.2 }
    ]
  };

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
    poweredConnections: new Set(),
    sidebarOpen: false,
    simulation: {
      status: "idle",
      data: null,
      error: "",
      hasRun: false
    },
    simulationRequestSeq: 0,
    lastSwitchEvent: null
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
    zoomLevel: document.querySelector("#zoom-level"),
    toggleSidebar: document.querySelector("#toggle-sidebar"),
    sidebarOverlay: document.querySelector("#sidebar-overlay"),
    toolPanel: document.querySelector(".tool-panel"),
    infoPanel: document.querySelector(".info-panel"),
    simulationStatus: document.querySelector("#simulation-status"),
    simulationSummary: document.querySelector("#simulation-summary"),
    simulationMetrics: document.querySelector("#simulation-metrics"),
    waveformTraces: document.querySelector("#waveform-traces")
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
  
  if (refs.toggleSidebar) {
    refs.toggleSidebar.addEventListener("click", toggleSidebar);
  }
  if (refs.sidebarOverlay) {
    refs.sidebarOverlay.addEventListener("click", closeSidebar);
  }
  
  window.addEventListener("resize", () => {
    renderWires();
    if (window.innerWidth > 720 && state.sidebarOpen) {
      closeSidebar();
    }
  });
  window.addEventListener("mousemove", handleWindowMouseMove);
  window.addEventListener("mouseup", handleCanvasMouseUp);
  window.addEventListener("blur", cancelCanvasPan);

  refs.boardCanvas.addEventListener("mousedown", handleCanvasMouseDown);
  refs.boardCanvas.addEventListener("mousemove", (event) => {
    handleCanvasMouseMove(event);
    state.mousePosition = screenToLogical(event.clientX, event.clientY);
    checkPortProximity(state.mousePosition);
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
  renderSimulation();

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
    clampBoardOffsets();
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

    if (event.button === 2) {
      event.preventDefault();
      state.panState = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        startOffsetX: state.boardOffsetX,
        startOffsetY: state.boardOffsetY
      };
      refs.boardCanvas.classList.add("is-panning");
    }
  }

  function handleCanvasMouseMove(event) {
    if (state.panState) {
      event.preventDefault();
      const deltaX = ((event.clientX - state.panState.startClientX) / state.boardZoom) * PAN_SENSITIVITY;
      const deltaY = ((event.clientY - state.panState.startClientY) / state.boardZoom) * PAN_SENSITIVITY;

      state.boardOffsetX = state.panState.startOffsetX + deltaX;
      state.boardOffsetY = state.panState.startOffsetY + deltaY;
      
      applyBoardTransform();
      requestAnimationFrame(renderWires);
    }
  }

  function handleWindowMouseMove(event) {
    if (!state.panState) return;
    handleCanvasMouseMove(event);
  }

  function handleCanvasMouseUp(event) {
    if (state.panState) {
      state.panState = null;
      refs.boardCanvas.classList.remove("is-panning");
    }
  }

  function cancelCanvasPan() {
    if (!state.panState) return;
    state.panState = null;
    refs.boardCanvas.classList.remove("is-panning");
  }

  function handleCanvasWheel(event) {
    event.preventDefault();
    
    const logicalPos = screenToLogical(event.clientX, event.clientY);
    const delta = event.deltaY > 0 ? -BOARD_ZOOM_STEP : BOARD_ZOOM_STEP;
    const newZoom = state.boardZoom + delta;
    
    setBoardZoomAround(newZoom, logicalPos.x, logicalPos.y);
  }

  function clampBoardOffsets() {
    const viewportWidth = refs.boardCanvas.clientWidth / state.boardZoom;
    const viewportHeight = refs.boardCanvas.clientHeight / state.boardZoom;

    const minOffsetX = viewportWidth - BOARD_SURFACE_WIDTH - BOARD_PAN_PADDING;
    const maxOffsetX = BOARD_PAN_PADDING;
    const minOffsetY = viewportHeight - BOARD_SURFACE_HEIGHT - BOARD_PAN_PADDING;
    const maxOffsetY = BOARD_PAN_PADDING;

    if (minOffsetX > maxOffsetX) {
      state.boardOffsetX = (viewportWidth - BOARD_SURFACE_WIDTH) / 2;
    } else {
      state.boardOffsetX = clamp(state.boardOffsetX, minOffsetX, maxOffsetX);
    }

    if (minOffsetY > maxOffsetY) {
      state.boardOffsetY = (viewportHeight - BOARD_SURFACE_HEIGHT) / 2;
    } else {
      state.boardOffsetY = clamp(state.boardOffsetY, minOffsetY, maxOffsetY);
    }
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
    const levelScaffold = getLevelScaffold(level);
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
    refs.feedbackSummary.textContent = levelScaffold.startPrompt;
    refs.feedbackPass.innerHTML = "<li>验证通过后，这里会显示已经完成的条件。</li>";
    refs.feedbackFail.innerHTML = levelScaffold.checkpoints.length
      ? levelScaffold.checkpoints.map((item) => `<li>${item}</li>`).join("")
      : '<li>开始吧，做这道题目，然后点击“验证电路”。</li>';
    refs.feedbackBadge.textContent = "待开始";
    refs.feedbackBadge.className = "badge";
    clearSimulationState();
    refs.feedbackSummary.textContent = levelScaffold.startPrompt;
    refs.feedbackPass.innerHTML = "<li>验证通过后，这里会显示已经完成的条件。</li>";
    refs.feedbackFail.innerHTML = levelScaffold.checkpoints.length
      ? levelScaffold.checkpoints.map((item) => `<li>${item}</li>`).join("")
      : '<li>开始吧，做这道题目，然后点击“验证电路”。</li>';
    refs.feedbackBadge.textContent = "待开始";
    
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

  function getLevelScaffold(level) {
    if (window.CircuitValidator && typeof window.CircuitValidator.getLevelScaffold === "function") {
      return window.CircuitValidator.getLevelScaffold(level);
    }

    return {
      startPrompt: "开始吧，做这道题目。先在实验台摆好元件并连线，再点击“验证电路”。",
      checkpoints: []
    };
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
        invalidateAnalysisState();
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
      const parameterDefs = getComponentParameterDefinitions(component.id);
      row.innerHTML = `
        <div>
          <strong>${component.instanceId}</strong>
          <span>${component.name} · (${Math.round(component.x)}, ${Math.round(component.y)})</span>
        </div>
        <button class="button button--ghost">移除</button>
      `;
      const infoBlock = row.querySelector("div");
      const removeButton = row.querySelector("button");
      if (infoBlock) {
        infoBlock.classList.add("active-component-row__main");
        if (parameterDefs.length) {
          infoBlock.insertAdjacentHTML(
            "beforeend",
            `
              <div class="component-parameter-grid">
                ${parameterDefs.map((definition) => `
                  <label class="component-parameter-field">
                    <span>${definition.label}</span>
                    <div class="component-parameter-input">
                      <input
                        type="number"
                        class="parameter-input"
                        data-instance-id="${component.instanceId}"
                        data-parameter-key="${definition.key}"
                        min="${definition.min}"
                        max="${definition.max}"
                        step="${definition.step}"
                        value="${formatEditableNumber(component.parameters?.[definition.key] ?? definition.defaultValue)}"
                      />
                      <em>${definition.unit}</em>
                    </div>
                  </label>
                `).join("")}
              </div>
            `
          );
        }
      }
      removeButton.classList.add("active-component-row__remove");
      removeButton.addEventListener("click", () => {
        removeComponent(component.instanceId);
      });
      row.querySelectorAll(".parameter-input").forEach((input) => {
        input.addEventListener("change", handleParameterInputChange);
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
        invalidateAnalysisState();
        state.connections = state.connections.filter((entry) => entry.id !== connection.id);
        renderConnections();
        renderBoard();
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
    element.classList.toggle(
      "is-powered",
      state.isRunning && component.ports.some((port) => state.poweredPorts.has(`${component.instanceId}:${port.id}`))
    );

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
      if (event.button !== 0) {
        return;
      }

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
      bringComponentToFront(component.instanceId);
    });

    element.addEventListener("pointermove", (event) => {
      if (!state.dragState || state.dragState.instanceId !== component.instanceId) {
        return;
      }

      const pointerPos = getBoardPointerPosition(event);
      const rawX = pointerPos.x - state.dragState.offsetX;
      const rawY = pointerPos.y - state.dragState.offsetY;
      
      const snappedPos = snapPositionToGrid(rawX, rawY);
      component.x = clamp(snappedPos.x, 20, BOARD_MAX_X);
      component.y = clamp(snappedPos.y, 20, BOARD_MAX_Y);
      element.style.left = `${component.x}px`;
      element.style.top = `${component.y}px`;
      
      updateGridAlignmentHint(component.x, component.y);
      
      renderWires();
      renderPlacedComponents();
    });

    const endDrag = () => {
      if (!state.dragState || state.dragState.instanceId !== component.instanceId) {
        return;
      }

      state.dragState = null;
      element.classList.remove("is-dragging");
      hideGridAlignmentHint();
    };

    element.addEventListener("pointerup", endDrag);
    element.addEventListener("pointercancel", endDrag);

    return element;
  }

  function getSymbolClass(componentId, instanceId) {
    if (!state.isRunning) return "";

    const component = state.placedComponents.find((c) => c.instanceId === instanceId);
    if (!component) return "";

    const hasPoweredPort = component.ports.some((port) => {
      const portRef = `${instanceId}:${port.id}`;
      return state.poweredPorts.has(portRef);
    });

    if (hasPoweredPort) {
      if (componentId === "led") return "is-lit-led";
      if (componentId === "lamp") return "is-lit-lamp";
      if (["resistor", "motor", "fan", "buzzer", "capacitor", "fuse"].includes(componentId)) {
        return "is-lit-load";
      }
    }
    return "";
  }

  function toggleSwitch(instanceId) {
    const shouldResimulate = state.isRunning || state.simulation.hasRun;
    const previousState = state.switchStates[instanceId] === true;
    state.switchStates[instanceId] = !state.switchStates[instanceId];
    state.lastSwitchEvent = {
      instanceId,
      from: previousState,
      to: state.switchStates[instanceId] === true
    };
    const indicator = refs.boardComponents.querySelector(
      `.switch-indicator[data-instance-id="${instanceId}"]`
    );
    if (indicator) {
      indicator.classList.toggle("is-closed", state.switchStates[instanceId]);
    }

    if (state.isRunning) {
      clearPoweredVisualization();
      renderBoard();
    }
    if (shouldResimulate) {
      requestSimulation();
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
    invalidateAnalysisState();
    state.pendingWireStart = null;
    updateWiringStatus();
    highlightSelectedPort();
    renderConnections();
    renderBoard();
  }

  function clearConnections() {
    state.connections = [];
    cancelPendingWire();
    clearSimulationState();
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
    requestSimulation();
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

    const positiveReachable = collectReachableNodes(graph, positivePort);
    const negativeReachable = collectReachableNodes(graph, negativePort);

    if (!positiveReachable.has(negativePort)) {
      return;
    }

    state.poweredPorts = new Set();
    positiveReachable.forEach((portRef) => {
      if (negativeReachable.has(portRef)) {
        state.poweredPorts.add(portRef);
      }
    });

    state.connections.forEach((connection) => {
      if (state.poweredPorts.has(connection.from) && state.poweredPorts.has(connection.to)) {
        state.poweredConnections.add(connection.id);
      }
    });
  }

  function calculatePoweredPathsFromSimulation() {
    state.poweredPorts = new Set();
    state.poweredConnections = new Set();

    if (!state.simulation.data || !state.simulation.data.operatingPoint) {
      return;
    }

    const componentResults = state.simulation.data.operatingPoint.components || [];
    const ignoredComponents = state.simulation.data.operatingPoint.ignoredComponents || [];
    const ignoredSet = new Set(ignoredComponents);
    const energizedComponents = new Set();
    const significantCurrent = 0.000001;

    componentResults.forEach((result) => {
      if (ignoredSet.has(result.instanceId)) {
        return;
      }
      if (Math.abs(result.current) > significantCurrent) {
        energizedComponents.add(result.instanceId);
      }
    });

    const graph = buildSimulationConductiveGraph(energizedComponents);
    const battery = state.placedComponents.find((component) => component.id === "battery");
    if (!battery) {
      return;
    }

    const positivePort = `${battery.instanceId}:positive`;
    const negativePort = `${battery.instanceId}:negative`;
    const positiveReachable = collectReachableNodes(graph, positivePort);
    const negativeReachable = collectReachableNodes(graph, negativePort);

    positiveReachable.forEach((portRef) => {
      if (negativeReachable.has(portRef)) {
        state.poweredPorts.add(portRef);
      }
    });

    state.connections.forEach((connection) => {
      if (state.poweredPorts.has(connection.from) && state.poweredPorts.has(connection.to)) {
        state.poweredConnections.add(connection.id);
      }
    });
  }

  function buildSimulationConductiveGraph(energizedComponents) {
    const graph = {};

    state.placedComponents.forEach((component) => {
      component.ports.forEach((port) => {
        graph[`${component.instanceId}:${port.id}`] = graph[`${component.instanceId}:${port.id}`] || new Set();
      });
    });

    state.connections.forEach((connection) => {
      connectGraphNodes(graph, connection.from, connection.to);
    });

    state.placedComponents.forEach((component) => {
      const ports = component.ports || [];
      if (ports.length < 2) {
        return;
      }

      const firstPort = `${component.instanceId}:${ports[0].id}`;
      const secondPort = `${component.instanceId}:${ports[1].id}`;

      if (component.id === "wire") {
        connectGraphNodes(graph, firstPort, secondPort);
        return;
      }

      if (component.id === "battery") {
        return;
      }

      if (component.id === "switch") {
        if (state.switchStates[component.instanceId] === true) {
          connectGraphNodes(graph, firstPort, secondPort);
        }
        return;
      }

      if (energizedComponents.has(component.instanceId)) {
        connectGraphNodes(graph, firstPort, secondPort);
      }
    });
    return graph;
  }

  function connectGraphNodes(graph, from, to) {
    graph[from] = graph[from] || new Set();
    graph[to] = graph[to] || new Set();
    graph[from].add(to);
    graph[to].add(from);
  }

  function clearPoweredVisualization() {
    state.poweredPorts = new Set();
    state.poweredConnections = new Set();
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
    if (component.id === "battery") {
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

  function collectReachableNodes(graph, start) {
    if (!graph[start]) {
      return new Set();
    }

    const visited = new Set([start]);
    const queue = [start];

    while (queue.length > 0) {
      const current = queue.shift();
      (graph[current] || []).forEach((next) => {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      });
    }

    return visited;
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
    if (result.passItems.length === 0) {
      refs.feedbackPass.innerHTML = "<li>暂时还没有通过项。</li>";
    }
    if (result.failItems.length === 0) {
      refs.feedbackFail.innerHTML = "<li>没有待修正项。</li>";
    }
    refs.feedbackBadge.textContent = result.passed ? "已通过" : "未通过";

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

    (result.errorInstances || []).forEach((instanceId) => {
      const instanceEl = refs.boardComponents.querySelector(
        `[data-instance-id="${escapeSelector(instanceId)}"]`
      );
      if (instanceEl) {
        instanceEl.classList.add("is-error");
      }
    });

    (result.errorPorts || []).forEach((portRef) => {
      const portEl = refs.boardComponents.querySelector(
        `.port-button[data-port-ref="${escapeSelector(portRef)}"]`
      );
      if (portEl) {
        portEl.classList.add("is-error");
      }
    });

    (result.errorConnections || []).forEach((connectionId) => {
      const wireEl = refs.wireLayer.querySelector(
        `.wire-line[data-connection-id="${escapeSelector(connectionId)}"]`
      );
      if (wireEl) {
        wireEl.classList.add("is-error");
      }
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
    invalidateAnalysisState();
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

  function getComponentParameterDefinitions(componentId) {
    return COMPONENT_PARAMETER_DEFS[componentId] || [];
  }

  function createDefaultParameters(componentId) {
    return getComponentParameterDefinitions(componentId).reduce((result, definition) => {
      result[definition.key] = definition.defaultValue;
      return result;
    }, {});
  }

  function createInstance(componentId, position) {
    const definition = components.find((item) => item.id === componentId);
    state.instanceSeed += 1;
    return {
      ...definition,
      ports: definition.ports.map((port) => ({ ...port })),
      parameters: createDefaultParameters(componentId),
      instanceId: `${componentId}-${state.instanceSeed}`,
      x: position.x,
      y: position.y
    };
  }

  function handleParameterInputChange(event) {
    const input = event.currentTarget;
    const instanceId = input.dataset.instanceId;
    const parameterKey = input.dataset.parameterKey;
    const component = state.placedComponents.find((item) => item.instanceId === instanceId);
    if (!component) {
      return;
    }

    const definition = getComponentParameterDefinitions(component.id).find((item) => item.key === parameterKey);
    if (!definition) {
      return;
    }

    const nextValue = sanitizeParameterValue(input.value, definition);
    input.value = formatEditableNumber(nextValue);
    component.parameters = {
      ...(component.parameters || {}),
      [parameterKey]: nextValue
    };

    const shouldResimulate = state.isRunning || state.simulation.hasRun;
    invalidateAnalysisState();
    renderPlacedComponents();
    if (shouldResimulate) {
      requestSimulation();
    }
  }

  function sanitizeParameterValue(rawValue, definition) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return definition.defaultValue;
    }
    return clamp(parsed, definition.min, definition.max);
  }

  function formatEditableNumber(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return "";
    }
    return numericValue.toString();
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
      x: clamp(snapToGrid(start.x + 20), 20, BOARD_MAX_X),
      y: clamp(snapToGrid(start.y + 20), 20, BOARD_MAX_Y)
    };
  }

  function snapToGrid(value) {
    return Math.round(value / GRID_SIZE) * GRID_SIZE;
  }

  function snapPositionToGrid(x, y) {
    return {
      x: snapToGrid(x),
      y: snapToGrid(y)
    };
  }

  function updateGridAlignmentHint(x, y) {
    let hint = refs.boardSurface.querySelector(".grid-alignment-hint");
    if (!hint) {
      hint = document.createElement("div");
      hint.className = "grid-alignment-hint";
      refs.boardSurface.appendChild(hint);
    }
    hint.style.left = `${x}px`;
    hint.style.top = `${y}px`;
    hint.style.display = "block";
  }

  function hideGridAlignmentHint() {
    const hint = refs.boardSurface.querySelector(".grid-alignment-hint");
    if (hint) {
      hint.style.display = "none";
    }
  }

  function bringComponentToFront(instanceId) {
    const allComponents = refs.boardComponents.querySelectorAll(".board-component");
    let maxZIndex = 0;
    
    allComponents.forEach((el) => {
      const zIndex = parseInt(window.getComputedStyle(el).zIndex) || 0;
      if (zIndex > maxZIndex) {
        maxZIndex = zIndex;
      }
    });

    const targetElement = refs.boardComponents.querySelector(`[data-instance-id="${instanceId}"]`);
    if (targetElement) {
      targetElement.style.zIndex = maxZIndex + 1;
    }
  }

  function checkPortProximity(mousePos) {
    if (state.dragState) return;

    let nearestPort = null;
    let nearestDistance = Infinity;

    state.placedComponents.forEach((component) => {
      component.ports.forEach((port) => {
        const portRef = `${component.instanceId}:${port.id}`;
        const anchor = getPortAnchorLogical(portRef);
        if (!anchor) return;

        const dx = mousePos.x - anchor.center.x;
        const dy = mousePos.y - anchor.center.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < nearestDistance && distance < PORT_SNAP_DISTANCE) {
          nearestDistance = distance;
          nearestPort = portRef;
        }
      });
    });

    if (nearestPort && nearestPort !== state.hoveredPort) {
      const previousHovered = state.hoveredPort;
      if (previousHovered) {
        const prevButton = refs.boardComponents.querySelector(
          `.port-button[data-port-ref="${escapeSelector(previousHovered)}"]`
        );
        if (prevButton) {
          prevButton.classList.remove("is-hovered");
        }
      }

      state.hoveredPort = nearestPort;
      const button = refs.boardComponents.querySelector(
        `.port-button[data-port-ref="${escapeSelector(nearestPort)}"]`
      );
      if (button) {
        button.classList.add("is-hovered");
      }

      if (state.pendingWireStart) {
        requestAnimationFrame(renderWires);
      }
    } else if (!nearestPort && state.hoveredPort) {
      const button = refs.boardComponents.querySelector(
        `.port-button[data-port-ref="${escapeSelector(state.hoveredPort)}"]`
      );
      if (button) {
        button.classList.remove("is-hovered");
      }
      state.hoveredPort = null;
      
      if (state.pendingWireStart) {
        requestAnimationFrame(renderWires);
      }
    }
  }

  function toggleSidebar() {
    state.sidebarOpen = !state.sidebarOpen;
    
    if (refs.toolPanel) {
      refs.toolPanel.classList.toggle("is-open", state.sidebarOpen);
    }
    if (refs.sidebarOverlay) {
      refs.sidebarOverlay.classList.toggle("is-visible", state.sidebarOpen);
    }
  }

  function closeSidebar() {
    state.sidebarOpen = false;
    
    if (refs.toolPanel) {
      refs.toolPanel.classList.remove("is-open");
    }
    if (refs.sidebarOverlay) {
      refs.sidebarOverlay.classList.remove("is-visible");
    }
  }

  function invalidateAnalysisState() {
    clearSimulationState();
    if (state.isRunning) {
      exitRunningState();
    }
  }

  function clearSimulationState() {
    state.simulationRequestSeq += 1;
    state.lastSwitchEvent = null;
    state.simulation = {
      status: "idle",
      data: null,
      error: "",
      hasRun: false
    };
    renderSimulation();
  }

  async function requestSimulation() {
    if (!refs.simulationStatus || !refs.simulationSummary) {
      return;
    }

    const requestSeq = state.simulationRequestSeq + 1;
    state.simulationRequestSeq = requestSeq;
    state.simulation = {
      status: "loading",
      data: null,
      error: "",
      hasRun: true
    };
    renderSimulation();

    try {
      const response = await fetch("./api/simulate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          levelId: state.activeLevelId,
          components: state.placedComponents,
          connections: state.connections,
          switchStates: state.switchStates,
          switchEvent: state.lastSwitchEvent
        })
      });

      const result = await response.json();
      if (requestSeq !== state.simulationRequestSeq) {
        return;
      }

      if (!response.ok || !result.ok) {
        state.simulation = {
          status: "error",
          data: null,
          error: result.error || `仿真请求失败 (${response.status})`,
          hasRun: true
        };
        if (state.isRunning) {
          clearPoweredVisualization();
          renderBoard();
        }
      } else {
        state.simulation = {
          status: "ready",
          data: result,
          error: "",
          hasRun: true
        };
        state.lastSwitchEvent = null;
        if (state.isRunning) {
          calculatePoweredPathsFromSimulation();
          renderBoard();
        }
      }
      renderSimulation();
    } catch (error) {
      if (requestSeq !== state.simulationRequestSeq) {
        return;
      }

      state.simulation = {
        status: "error",
        data: null,
        error:
          "无法连接 Python 仿真服务。请用 .venv 里的 python 运行 dev_server.py，而不是直接双击 index.html。",
        hasRun: true
      };
      if (state.isRunning) {
        clearPoweredVisualization();
        renderBoard();
      }
      renderSimulation();
    }
  }

  function renderSimulation() {
    if (!refs.simulationStatus || !refs.simulationSummary || !refs.simulationMetrics || !refs.waveformTraces) {
      return;
    }

    const { status, data, error } = state.simulation;

    if (status === "idle") {
      refs.simulationStatus.textContent = "未运行";
      refs.simulationStatus.className = "badge";
      refs.simulationSummary.textContent =
        "点击“验证电路”后会调用 Python 仿真器，返回电压、电流和波形结果。";
      refs.simulationMetrics.innerHTML = "";
      refs.waveformTraces.innerHTML = "";
      return;
    }

    if (status === "loading") {
      refs.simulationStatus.textContent = "仿真中";
      refs.simulationStatus.className = "badge is-warning";
      refs.simulationSummary.textContent = "Python 求解器正在计算当前电路的结点电压和支路电流。";
      refs.simulationMetrics.innerHTML = "";
      refs.waveformTraces.innerHTML = "";
      return;
    }

    if (status === "error") {
      refs.simulationStatus.textContent = "失败";
      refs.simulationStatus.className = "badge is-warning";
      refs.simulationSummary.textContent = error;
      refs.simulationMetrics.innerHTML = "";
      refs.waveformTraces.innerHTML = "";
      return;
    }

    refs.simulationStatus.textContent = "已更新";
    refs.simulationStatus.className = "badge is-success";

    const warningText = data.warnings && data.warnings.length
      ? ` ${data.warnings.join(" ")}`
      : "";
    refs.simulationSummary.textContent = `${data.summary || ""}${warningText}`;
    refs.simulationMetrics.innerHTML = (data.metrics || [])
      .map(
        (metric) => `
          <div class="simulation-metric">
            <span>${metric.label}</span>
            <strong>${formatMetricValue(metric.value, metric.unit)}</strong>
          </div>
        `
      )
      .join("");

    renderWaveformTraces(data.waveform);
  }

  function renderWaveformTraces(waveform) {
    if (!refs.waveformTraces) {
      return;
    }

    if (!waveform || !Array.isArray(waveform.series) || waveform.series.length === 0) {
      refs.waveformTraces.innerHTML = "";
      return;
    }

    refs.waveformTraces.innerHTML = waveform.series
      .map((series) => {
        const svg = createWaveformSvg(
          waveform.time || [],
          series.values || [],
          series.color || "#d95f23",
          waveform.eventTime || 0
        );
        return `
          <div class="waveform-trace">
            <div class="waveform-trace__meta">
              <strong>${series.label}</strong>
              <span>${series.unit}</span>
            </div>
            ${svg}
          </div>
        `;
      })
      .join("");
  }

  function createWaveformSvg(timePoints, values, color, eventTime) {
    const width = 320;
    const height = 124;
    const padLeft = 12;
    const padRight = 12;
    const padTop = 10;
    const padBottom = 18;
    const innerWidth = width - padLeft - padRight;
    const innerHeight = height - padTop - padBottom;
    const safeValues = values.length ? values : [0, 0];
    const minValue = Math.min(...safeValues);
    const maxValue = Math.max(...safeValues);
    const span = Math.abs(maxValue - minValue) < 1e-9 ? 1 : maxValue - minValue;
    const duration = timePoints.length > 1 ? timePoints[timePoints.length - 1] || 1 : 1;

    const pathData = safeValues
      .map((value, index) => {
        const timeValue = timePoints[index] || 0;
        const x = padLeft + (duration === 0 ? 0 : (timeValue / duration) * innerWidth);
        const y = padTop + innerHeight - ((value - minValue) / span) * innerHeight;
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");

    const gridY1 = padTop + innerHeight * 0.25;
    const gridY2 = padTop + innerHeight * 0.5;
    const gridY3 = padTop + innerHeight * 0.75;
    const hasEvent = Number.isFinite(eventTime);
    const eventX = hasEvent ? padLeft + (duration === 0 ? 0 : (eventTime / duration) * innerWidth) : null;

    return `
      <svg class="waveform-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        <line class="grid-line" x1="${padLeft}" y1="${gridY1}" x2="${width - padRight}" y2="${gridY1}"></line>
        <line class="grid-line" x1="${padLeft}" y1="${gridY2}" x2="${width - padRight}" y2="${gridY2}"></line>
        <line class="grid-line" x1="${padLeft}" y1="${gridY3}" x2="${width - padRight}" y2="${gridY3}"></line>
        ${hasEvent ? `<line class="event-line" x1="${eventX}" y1="${padTop}" x2="${eventX}" y2="${height - padBottom}"></line>` : ""}
        <path class="trace-line" d="${pathData}" style="stroke:${color};"></path>
        <text class="axis-label" x="${padLeft}" y="${height - 4}">0 ms</text>
        ${hasEvent ? `<text class="axis-label" x="${Math.max(padLeft, eventX - 18)}" y="${padTop + 12}">switch</text>` : ""}
        <text class="axis-label" x="${width - padRight - 34}" y="${height - 4}">
          ${(duration * 1000).toFixed(0)} ms
        </text>
      </svg>
    `;
  }

  function formatMetricValue(value, unit) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return `-- ${unit}`;
    }

    if (numericValue === 0) {
      return `0 ${unit}`;
    }

    const absValue = Math.abs(numericValue);
    const digits = absValue >= 10 ? 2 : absValue >= 1 ? 3 : 4;
    return `${numericValue.toFixed(digits)} ${unit}`;
  }

  function getComponentSymbol(componentId) {
    const map = {
      battery: "+ -",
      wire: "WIRE",
      switch: "SW",
      resistor: "R",
      led: "LED",
      lamp: "LAMP",
      motor: "MTR",
      fan: "FAN",
      buzzer: "BUZ",
      capacitor: "CAP",
      fuse: "FUSE"
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
