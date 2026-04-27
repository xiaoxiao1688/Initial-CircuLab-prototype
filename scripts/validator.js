(function () {
  const DEFAULT_SCAFFOLD = {
    startPrompt: "开始吧，做这道题目。先在实验台摆好元件并连线，再点击“验证电路”。",
    checkpoints: ["先确认元件齐全，再逐步检查主路径是否满足本关要求。"]
  };

  const OBJECTIVE_SCAFFOLDS = {
    "closed-led-loop": {
      startPrompt: "开始吧，做这道题目。先把电池、LED 和导线连成一个最基础的闭合回路。",
      checkpoints: [
        "先让电池正极能连到 LED 正端。",
        "再让 LED 负端回到电池负极。",
        "最后确认中间没有断路。"
      ]
    },
    "switch-controls-led": {
      startPrompt: "开始吧，做这道题目。把开关真正串进 LED 主回路，不要只把它摆在旁边。",
      checkpoints: [
        "正极到 LED 的主路径必须经过开关。",
        "LED 负端仍然要回到电池负极。",
        "不要出现绕过开关的旁路。"
      ]
    },
    "parallel-loads": {
      startPrompt: "开始吧，做这道题目。让两个负载共享同一对电源节点，搭出标准并联。",
      checkpoints: [
        "两个负载都要各自接到电池正极一侧。",
        "两个负载都要各自回到电池负极一侧。",
        "不要把两个负载首尾串成一条链。"
      ]
    },
    "resistor-protects-led": {
      startPrompt: "开始吧，做这道题目。目标是把电阻正确串入 LED 主回路：电池正极 → 电阻 → LED 正端 → LED 负端 → 电池负极。",
      checkpoints: [
        "电池正极要先到电阻的一端。",
        "电阻另一端要再到 LED 正端，不能只接一端。",
        "LED 负端必须回到电池负极。",
        "不能存在绕过电阻直接到 LED 正端的旁路。"
      ]
    },
    "switch-protects-led": {
      startPrompt: "新任务开始了：在带保护电阻的 LED 主回路里再串入开关，让开关和电阻都处在主路径上。",
      checkpoints: [
        "主路径顺序应类似：电池正极 → 开关 → 电阻 → LED 正端。",
        "LED 负端仍要回到电池负极。",
        "不能绕过开关，也不能绕过电阻。"
      ]
    },
    "fuse-protects-load": {
      startPrompt: "开始吧，搭一个安全回路：目标是让保险丝真正串入主路径，电流必须经过保险丝才能到达负载。",
      checkpoints: [
        "先确认电池、开关、保险丝和负载（LED 或小灯泡）都已摆放。",
        "主路径顺序应类似：电池正极 → 开关 → 保险丝 → 负载。",
        "负载负端必须回到电池负极形成闭合回路。",
        "保险丝两端都要接入电路，不能只接一端悬空。",
        "最重要：不能有导线绕过保险丝直接连接开关和负载。"
      ]
    }
  };

  const OBJECTIVE_VALIDATORS = {
    "closed-led-loop": evaluateLedLoop,
    "switch-controls-led": evaluateSwitchLevel,
    "parallel-loads": evaluateParallelLevel,
    "resistor-protects-led": evaluateResistorLevel,
    "switch-protects-led": evaluateProtectedSwitchLevel,
    "fuse-protects-load": evaluateFuseLevel
  };

  function getLevelScaffold(level) {
    if (!level || !level.objective) {
      return DEFAULT_SCAFFOLD;
    }
    return OBJECTIVE_SCAFFOLDS[level.objective] || DEFAULT_SCAFFOLD;
  }

  function validate(level, components, connections, switchStates = {}) {
    const state = createValidationState(level);
    const { graph } = buildGraph(components, connections, switchStates);

    if (getComponentsById(components, "battery").length === 0) {
      addIssue(state, "缺少电池，当前电路没有电源。");
    }

    (level.requiredTypes || []).forEach((requiredType) => {
      if (!components.some((component) => component.id === requiredType)) {
        addIssue(state, `缺少必选元件：${getDisplayName(requiredType)}。`);
      }
    });

    const evaluator = OBJECTIVE_VALIDATORS[level.objective];
    if (evaluator) {
      evaluator({ components, connections, graph, switchStates, state });
    }

    const passed = state.failItems.length === 0;
    return {
      passed,
      summary: passed
        ? level.successText
        : `当前电路还没有满足本关目标。${state.scaffold.startPrompt}`,
      passItems: state.passItems,
      failItems: state.failItems,
      errorInstances: Array.from(state.errorInstances),
      errorPorts: Array.from(state.errorPorts),
      errorConnections: Array.from(state.errorConnections),
      scaffold: state.scaffold
    };
  }

  function createValidationState(level) {
    return {
      level,
      scaffold: getLevelScaffold(level),
      passItems: [],
      failItems: [],
      errorInstances: new Set(),
      errorPorts: new Set(),
      errorConnections: new Set()
    };
  }

  function addFinding(state, message) {
    if (message && !state.passItems.includes(message)) {
      state.passItems.push(message);
    }
  }

  function addIssue(state, message, markers = {}) {
    if (message && !state.failItems.includes(message)) {
      state.failItems.push(message);
    }

    (markers.instances || []).forEach((instanceId) => {
      if (instanceId) {
        state.errorInstances.add(instanceId);
      }
    });
    (markers.ports || []).forEach((portRef) => {
      if (portRef) {
        state.errorPorts.add(portRef);
      }
    });
    (markers.connections || []).forEach((connectionId) => {
      if (connectionId) {
        state.errorConnections.add(connectionId);
      }
    });
  }

  function buildGraph(components, connections, switchStates = {}) {
    const graph = {};

    components.forEach((component) => {
      (component.ports || []).forEach((port) => {
        const portRef = resolvePort(component.instanceId, port.id);
        graph[portRef] = graph[portRef] || new Set();
      });

      getInternalConductivePairs(component, switchStates).forEach(([from, to]) => {
        connect(graph, resolvePort(component.instanceId, from), resolvePort(component.instanceId, to));
      });
    });

    connections.forEach((connection) => {
      connect(graph, connection.from, connection.to);
    });

    return { graph };
  }

  function getInternalConductivePairs(component, switchStates = {}) {
    if (component.id === "battery" || component.id === "led") {
      return [];
    }

    if (component.id === "switch") {
      const isClosed = switchStates[component.instanceId] === true;
      if (isClosed && component.ports.length >= 2) {
        return [[component.ports[0].id, component.ports[1].id]];
      }
      return [];
    }

    if ((component.ports || []).length < 2) {
      return [];
    }

    return [[component.ports[0].id, component.ports[1].id]];
  }

  function connect(graph, from, to) {
    if (!from || !to) {
      return;
    }
    graph[from] = graph[from] || new Set();
    graph[to] = graph[to] || new Set();
    graph[from].add(to);
    graph[to].add(from);
  }

  function hasPath(graph, from, to, blockedNodes = new Set()) {
    return findPath(graph, from, to, blockedNodes) !== null;
  }

  function findPath(graph, from, to, blockedNodes = new Set()) {
    if (!graph[from] || !graph[to] || blockedNodes.has(from) || blockedNodes.has(to)) {
      return null;
    }

    const queue = [[from]];
    const visited = new Set([from]);

    while (queue.length > 0) {
      const path = queue.shift();
      const current = path[path.length - 1];

      if (current === to) {
        return path;
      }

      graph[current].forEach((next) => {
        if (!visited.has(next) && !blockedNodes.has(next)) {
          visited.add(next);
          queue.push([...path, next]);
        }
      });
    }

    return null;
  }

  function getComponentsById(components, id) {
    return components.filter((component) => component.id === id);
  }

  function resolvePort(instanceId, portId) {
    return `${instanceId}:${portId}`;
  }

  function getInstanceId(portRef) {
    return typeof portRef === "string" ? portRef.split(":")[0] : null;
  }

  function mergeMarkers(...markers) {
    const merged = {
      instances: new Set(),
      ports: new Set(),
      connections: new Set()
    };

    markers.forEach((marker) => {
      if (!marker) {
        return;
      }
      (marker.instances || []).forEach((value) => merged.instances.add(value));
      (marker.ports || []).forEach((value) => merged.ports.add(value));
      (marker.connections || []).forEach((value) => merged.connections.add(value));
    });

    return {
      instances: Array.from(merged.instances),
      ports: Array.from(merged.ports),
      connections: Array.from(merged.connections)
    };
  }

  function markersFromPorts(ports, connections = []) {
    const portSet = new Set(ports || []);
    const instanceSet = new Set();
    portSet.forEach((portRef) => {
      const instanceId = getInstanceId(portRef);
      if (instanceId) {
        instanceSet.add(instanceId);
      }
    });

    const connectionIds = (connections || [])
      .filter((connection) => portSet.has(connection.from) || portSet.has(connection.to))
      .map((connection) => connection.id);

    return {
      instances: Array.from(instanceSet),
      ports: Array.from(portSet),
      connections: connectionIds
    };
  }

  function markersFromPath(path, connections = []) {
    if (!path || path.length === 0) {
      return { instances: [], ports: [], connections: [] };
    }

    const instanceSet = new Set();
    const portSet = new Set(path);
    path.forEach((portRef) => {
      const instanceId = getInstanceId(portRef);
      if (instanceId) {
        instanceSet.add(instanceId);
      }
    });

    const connectionIds = [];
    for (let index = 0; index < path.length - 1; index += 1) {
      const from = path[index];
      const to = path[index + 1];
      const connection = connections.find(
        (item) =>
          (item.from === from && item.to === to) ||
          (item.from === to && item.to === from)
      );
      if (connection) {
        connectionIds.push(connection.id);
      }
    }

    return {
      instances: Array.from(instanceSet),
      ports: Array.from(portSet),
      connections: connectionIds
    };
  }

  function findSeriesPath(graph, start, pairs, end) {
    function walk(currentStart, pairIndex, collectedPath) {
      if (pairIndex >= pairs.length) {
        const endPath = findPath(graph, currentStart, end);
        if (!endPath) {
          return null;
        }
        return [...collectedPath, ...endPath.slice(1)];
      }

      const [portA, portB] = pairs[pairIndex];
      const orientations = [
        [portA, portB],
        [portB, portA]
      ];

      for (const [entryPort, exitPort] of orientations) {
        const entryPath = findPath(graph, currentStart, entryPort);
        if (!entryPath) {
          continue;
        }
        const nextPath = walk(exitPort, pairIndex + 1, [...collectedPath, ...entryPath.slice(1)]);
        if (nextPath) {
          return nextPath;
        }
      }

      return null;
    }

    return walk(start, 0, [start]);
  }

  function evaluateLedLoop({ components, connections, graph, state }) {
    const battery = components.find((component) => component.id === "battery");
    const led = components.find((component) => component.id === "led");
    if (!battery || !led) {
      return;
    }

    const batteryPositive = resolvePort(battery.instanceId, "positive");
    const batteryNegative = resolvePort(battery.instanceId, "negative");
    const ledAnode = resolvePort(led.instanceId, "anode");
    const ledCathode = resolvePort(led.instanceId, "cathode");

    const posPath = findPath(graph, batteryPositive, ledAnode);
    const negPath = findPath(graph, ledCathode, batteryNegative);

    if (posPath) {
      addFinding(state, "电池正极已经连接到 LED 正端。");
    } else {
      addIssue(state, "电池正极还没有有效连接到 LED 正端。", markersFromPorts([batteryPositive, ledAnode], connections));
    }

    if (negPath) {
      addFinding(state, "LED 负端已经回到电池负极。");
    } else {
      addIssue(state, "LED 负端还没有回到电池负极。", markersFromPorts([ledCathode, batteryNegative], connections));
    }

    if (posPath && negPath) {
      addFinding(state, "已经形成符合教学模型的闭合 LED 回路。");
    } else {
      addIssue(state, "电路没有形成完整闭合回路。", markersFromPorts([batteryPositive, ledAnode, ledCathode, batteryNegative], connections));
    }
  }

  function evaluateSwitchLevel({ components, connections, graph, state }) {
    const battery = components.find((component) => component.id === "battery");
    const led = components.find((component) => component.id === "led");
    const sw = components.find((component) => component.id === "switch");
    if (!battery || !led || !sw) {
      return;
    }

    const batteryPositive = resolvePort(battery.instanceId, "positive");
    const batteryNegative = resolvePort(battery.instanceId, "negative");
    const ledAnode = resolvePort(led.instanceId, "anode");
    const ledCathode = resolvePort(led.instanceId, "cathode");
    const switchA = resolvePort(sw.instanceId, "a");
    const switchB = resolvePort(sw.instanceId, "b");

    const switchPath = findSeriesPath(graph, batteryPositive, [[switchA, switchB]], ledAnode);
    const ledBack = findPath(graph, ledCathode, batteryNegative);
    const bypassPath = findPath(graph, batteryPositive, ledAnode, new Set([switchA, switchB]));

    if (switchPath) {
      addFinding(state, "主路径已经经过开关并连接到 LED。");
    } else {
      addIssue(state, "开关没有真正串入主回路，请让正极到 LED 的路径经过开关。", markersFromPorts([batteryPositive, switchA, switchB, ledAnode], connections));
    }

    if (ledBack) {
      addFinding(state, "LED 负端仍能回到电池负极。");
    } else {
      addIssue(state, "LED 负端没有回到电池负极，回路不完整。", markersFromPorts([ledCathode, batteryNegative], connections));
    }

    if (!bypassPath && switchPath) {
      addFinding(state, "没有发现绕过开关的旁路连接。");
    } else if (bypassPath) {
      addIssue(
        state,
        "检测到正极可以绕过开关直达 LED，开关失去了控制作用。",
        mergeMarkers(
          markersFromPorts([batteryPositive, ledAnode], connections),
          markersFromPath(bypassPath, connections)
        )
      );
    }
  }

  function evaluateParallelLevel({ components, connections, graph, state }) {
    const battery = components.find((component) => component.id === "battery");
    const loads = components.filter((component) => component.id === "lamp" || component.id === "led");
    if (!battery) {
      return;
    }

    if (loads.length < 2) {
      addIssue(state, "并联关卡至少需要两个负载元件。");
      return;
    }

    const batteryPositive = resolvePort(battery.instanceId, "positive");
    const batteryNegative = resolvePort(battery.instanceId, "negative");

    let validBranches = 0;
    loads.slice(0, 2).forEach((load) => {
      const entryPort = resolvePort(load.instanceId, load.id === "led" ? "anode" : "a");
      const exitPort = resolvePort(load.instanceId, load.id === "led" ? "cathode" : "b");
      if (hasPath(graph, batteryPositive, entryPort) && hasPath(graph, exitPort, batteryNegative)) {
        validBranches += 1;
      }
    });

    const firstLoad = loads[0];
    const secondLoad = loads[1];
    const firstExit = resolvePort(firstLoad.instanceId, firstLoad.id === "led" ? "cathode" : "b");
    const secondEntry = resolvePort(secondLoad.instanceId, secondLoad.id === "led" ? "anode" : "a");
    const seriesLike = hasPath(graph, firstExit, secondEntry) && !hasPath(graph, batteryPositive, secondEntry);

    if (validBranches === 2) {
      addFinding(state, "两个负载都形成了各自通向电源负极的独立支路。");
    } else {
      addIssue(state, "两个负载还没有都形成独立支路，当前结构不够像标准并联。", markersFromPorts([
        resolvePort(firstLoad.instanceId, firstLoad.id === "led" ? "anode" : "a"),
        resolvePort(firstLoad.instanceId, firstLoad.id === "led" ? "cathode" : "b"),
        resolvePort(secondLoad.instanceId, secondLoad.id === "led" ? "anode" : "a"),
        resolvePort(secondLoad.instanceId, secondLoad.id === "led" ? "cathode" : "b")
      ], connections));
    }

    if (!seriesLike) {
      addFinding(state, "没有检测到明显的串联首尾连接。");
    } else {
      addIssue(state, "两个负载看起来被首尾串起来了，而不是并联。", markersFromPorts([firstExit, secondEntry], connections));
    }
  }

  function evaluateResistorLevel({ components, connections, graph, state }) {
    const battery = components.find((component) => component.id === "battery");
    const led = components.find((component) => component.id === "led");
    const resistor = components.find((component) => component.id === "resistor");
    if (!battery || !led || !resistor) {
      return;
    }

    const batteryPositive = resolvePort(battery.instanceId, "positive");
    const batteryNegative = resolvePort(battery.instanceId, "negative");
    const ledAnode = resolvePort(led.instanceId, "anode");
    const ledCathode = resolvePort(led.instanceId, "cathode");
    const resistorA = resolvePort(resistor.instanceId, "a");
    const resistorB = resolvePort(resistor.instanceId, "b");

    const positiveToA = findPath(graph, batteryPositive, resistorA);
    const positiveToB = findPath(graph, batteryPositive, resistorB);
    const aToLed = findPath(graph, resistorA, ledAnode);
    const bToLed = findPath(graph, resistorB, ledAnode);
    const throughResistorPath = findSeriesPath(graph, batteryPositive, [[resistorA, resistorB]], ledAnode);
    const ledBackPath = findPath(graph, ledCathode, batteryNegative);
    const bypassPath = findPath(graph, batteryPositive, ledAnode, new Set([resistorA, resistorB]));
    const directPositiveToLed = findPath(graph, batteryPositive, ledAnode);

    const resistorAConnected = (graph[resistorA] || new Set()).size > 0;
    const resistorBConnected = (graph[resistorB] || new Set()).size > 0;
    const ledCathodeConnected = (graph[ledCathode] || new Set()).size > 0;

    const resistorPortA = `${resistor.instanceId}:a`;
    const resistorPortB = `${resistor.instanceId}:b`;
    const batteryPosPort = `${battery.instanceId}:positive`;
    const ledAnodePort = `${led.instanceId}:anode`;
    const ledCathodePort = `${led.instanceId}:cathode`;
    const batteryNegPort = `${battery.instanceId}:negative`;

    if (throughResistorPath) {
      addFinding(state, "电阻已经正确串入 LED 主路径。");
    } else if (!resistorAConnected && !resistorBConnected) {
      addIssue(
        state,
        `电阻完全没有接入电路，${resistorPortA} 和 ${resistorPortB} 两端都还是悬空的。正确连接方式：电池正极（${batteryPosPort}）→ 电阻一端 → 电阻另一端 → LED 正端（${ledAnodePort}）。`,
        markersFromPorts([resistorA, resistorB, batteryPositive, ledAnode], connections)
      );
    } else if (!resistorAConnected || !resistorBConnected) {
      const disconnectedPort = !resistorAConnected ? resistorA : resistorB;
      const disconnectedPortLabel = !resistorAConnected ? resistorPortA : resistorPortB;
      const connectedPort = resistorAConnected ? resistorA : resistorB;
      const connectedPortLabel = resistorAConnected ? resistorPortA : resistorPortB;

      const connectedToPositive = positiveToA || positiveToB;
      const connectedToLed = aToLed || bToLed;

      if (connectedToPositive && !connectedToLed) {
        addIssue(
          state,
          `电阻 ${connectedPortLabel} 已连接到电池正极，但 ${disconnectedPortLabel} 还悬空。请把电阻 ${disconnectedPortLabel} 连接到 LED 正端（${ledAnodePort}）。`,
          markersFromPorts([disconnectedPort, ledAnode], connections)
        );
      } else if (connectedToLed && !connectedToPositive) {
        addIssue(
          state,
          `电阻 ${connectedPortLabel} 已连接到 LED 正端，但 ${disconnectedPortLabel} 还悬空。请把电阻 ${disconnectedPortLabel} 连接到电池正极（${batteryPosPort}）。`,
          markersFromPorts([disconnectedPort, batteryPositive], connections)
        );
      } else {
        addIssue(
          state,
          `电阻只接入了一端（${connectedPortLabel}），${disconnectedPortLabel} 还悬空。电流无法完整经过电阻再流向 LED。请把悬空的那端也接入主回路。`,
          markersFromPorts([resistorA, resistorB, disconnectedPort], connections)
        );
      }
    } else if (!positiveToA && !positiveToB) {
      addIssue(
        state,
        `电池正极（${batteryPosPort}）还没有连接到电阻的任何一端。应该用导线把 ${batteryPosPort} 连接到 ${resistorPortA} 或 ${resistorPortB}。`,
        markersFromPorts([batteryPositive, resistorA, resistorB], connections)
      );
    } else if (!aToLed && !bToLed) {
      const resistorToLedPath = findPath(graph, resistorA, ledAnode) || findPath(graph, resistorB, ledAnode);
      const positiveConnectedPort = positiveToA ? resistorA : resistorB;
      const positiveConnectedPortLabel = positiveToA ? resistorPortA : resistorPortB;
      const otherPort = positiveToA ? resistorB : resistorA;
      const otherPortLabel = positiveToA ? resistorPortB : resistorPortA;

      if (directPositiveToLed && !resistorToLedPath) {
        addIssue(
          state,
          `检测到电池正极（${batteryPosPort}）直接连到了 LED 正端（${ledAnodePort}），但电阻 ${positiveConnectedPortLabel} 虽然连了电池正极，电阻另一端（${otherPortLabel}）却没有连到 LED。电阻被旁路了，没有承担保护作用。正确连接：${batteryPosPort} → ${positiveConnectedPortLabel} → ${otherPortLabel} → ${ledAnodePort}。`,
          mergeMarkers(
            markersFromPorts([batteryPositive, ledAnode, resistorA, resistorB], connections),
            markersFromPath(directPositiveToLed, connections)
          )
        );
      } else {
        addIssue(
          state,
          `电阻 ${positiveConnectedPortLabel} 已连接到电池正极，但电阻另一端（${otherPortLabel}）还没有连接到 LED 正端（${ledAnodePort}）。请用导线把 ${otherPortLabel} 连接到 ${ledAnodePort}。`,
          markersFromPorts([otherPort, ledAnode], connections)
        );
      }
    } else {
      const positiveToResistor = positiveToA ? resistorA : resistorB;
      const positiveToResistorLabel = positiveToA ? resistorPortA : resistorPortB;
      const resistorToLed = aToLed ? resistorA : resistorB;
      const resistorToLedLabel = aToLed ? resistorPortA : resistorPortB;

      if (positiveToResistor === resistorToLed) {
        addIssue(
          state,
          `电阻的同一端（${positiveToResistorLabel}）既连了电池正极又连了 LED 正端。这相当于把电阻短路了，电流不会经过电阻内部。正确连接：电池正极应该连接到电阻的一端，LED 正端应该连接到电阻的另一端。`,
          markersFromPorts([positiveToResistor, resistorA, resistorB, ledAnode], connections)
        );
      } else {
        addIssue(
          state,
          `电阻和 LED 的相对位置不对。当前连接不是标准串联保护结构。标准结构：电池正极（${batteryPosPort}）→ 电阻一端 → 电阻另一端 → LED 正端（${ledAnodePort}）。`,
          markersFromPorts([batteryPositive, resistorA, resistorB, ledAnode], connections)
        );
      }
    }

    if (ledBackPath) {
      addFinding(state, "LED 负端已经回到电池负极。");
    } else if (!ledCathodeConnected) {
      addIssue(
        state,
        `LED 负端（${ledCathodePort}）还没有接线。请用导线把 ${ledCathodePort} 连接到电池负极（${batteryNegPort}）。`,
        markersFromPorts([ledCathode, batteryNegative], connections)
      );
    } else {
      const partialPath = findPath(graph, ledCathode, batteryPositive);
      if (partialPath) {
        addIssue(
          state,
          `LED 负端（${ledCathodePort}）虽然有接线，但没有真正回到电池负极（${batteryNegPort}）。检查一下 ${ledCathodePort} 到 ${batteryNegPort} 的路径是否完整。`,
          mergeMarkers(
            markersFromPorts([ledCathode, batteryNegative], connections),
            markersFromPath(partialPath, connections)
          )
        );
      } else {
        addIssue(
          state,
          `LED 负端（${ledCathodePort}）虽然有接线，但还没有真正回到电池负极（${batteryNegPort}）。`,
          markersFromPorts([ledCathode, batteryNegative], connections)
        );
      }
    }

    if (!bypassPath && throughResistorPath) {
      addFinding(state, "没有发现绕过电阻直达 LED 的旁路。");
    } else if (bypassPath) {
      addIssue(
        state,
        `检测到存在绕过电阻的旁路：电池正极（${batteryPosPort}）可以不经过电阻直接到 LED 正端（${ledAnodePort}）。所以电阻没有真正承担保护作用。请删除旁路导线，确保电流必须经过电阻。`,
        mergeMarkers(
          markersFromPorts([batteryPositive, ledAnode, resistorA, resistorB], connections),
          markersFromPath(bypassPath, connections)
        )
      );
    }
  }

  function evaluateProtectedSwitchLevel({ components, connections, graph, state }) {
    const battery = components.find((component) => component.id === "battery");
    const sw = components.find((component) => component.id === "switch");
    const resistor = components.find((component) => component.id === "resistor");
    const led = components.find((component) => component.id === "led");
    if (!battery || !sw || !resistor || !led) {
      return;
    }

    const batteryPositive = resolvePort(battery.instanceId, "positive");
    const batteryNegative = resolvePort(battery.instanceId, "negative");
    const switchA = resolvePort(sw.instanceId, "a");
    const switchB = resolvePort(sw.instanceId, "b");
    const resistorA = resolvePort(resistor.instanceId, "a");
    const resistorB = resolvePort(resistor.instanceId, "b");
    const ledAnode = resolvePort(led.instanceId, "anode");
    const ledCathode = resolvePort(led.instanceId, "cathode");

    const switchPortA = `${sw.instanceId}:a`;
    const switchPortB = `${sw.instanceId}:b`;
    const resistorPortA = `${resistor.instanceId}:a`;
    const resistorPortB = `${resistor.instanceId}:b`;
    const batteryPosPort = `${battery.instanceId}:positive`;
    const batteryNegPort = `${battery.instanceId}:negative`;
    const ledAnodePort = `${led.instanceId}:anode`;
    const ledCathodePort = `${led.instanceId}:cathode`;

    const orderedPath = findSeriesPath(
      graph,
      batteryPositive,
      [
        [switchA, switchB],
        [resistorA, resistorB]
      ],
      ledAnode
    );
    const switchOnlyPath = findSeriesPath(
      graph,
      batteryPositive,
      [[switchA, switchB]],
      ledAnode
    );
    const resistorOnlyPath = findSeriesPath(
      graph,
      batteryPositive,
      [[resistorA, resistorB]],
      ledAnode
    );

    const ledBackPath = findPath(graph, ledCathode, batteryNegative);
    const bypassSwitchPath = findPath(graph, batteryPositive, ledAnode, new Set([switchA, switchB]));
    const bypassResistorPath = findPath(graph, batteryPositive, ledAnode, new Set([resistorA, resistorB]));
    const directPositiveToLed = findPath(graph, batteryPositive, ledAnode);
    const positiveToSwitchA = findPath(graph, batteryPositive, switchA);
    const positiveToSwitchB = findPath(graph, batteryPositive, switchB);
    const switchToResistorA = findPath(graph, switchA, resistorA) || findPath(graph, switchB, resistorA);
    const switchToResistorB = findPath(graph, switchA, resistorB) || findPath(graph, switchB, resistorB);
    const resistorToLedA = findPath(graph, resistorA, ledAnode);
    const resistorToLedB = findPath(graph, resistorB, ledAnode);

    const switchAConnected = (graph[switchA] || new Set()).size > 0;
    const switchBConnected = (graph[switchB] || new Set()).size > 0;
    const resistorAConnected = (graph[resistorA] || new Set()).size > 0;
    const resistorBConnected = (graph[resistorB] || new Set()).size > 0;
    const ledCathodeConnected = (graph[ledCathode] || new Set()).size > 0;

    if (orderedPath) {
      addFinding(state, "开关和电阻都已经正确串入 LED 主回路。");
    } else if (!switchAConnected && !switchBConnected) {
      addIssue(
        state,
        `开关完全没有接入电路，${switchPortA} 和 ${switchPortB} 两端都还是悬空的。正确连接方式：电池正极（${batteryPosPort}）→ 开关一端 → 开关另一端 → 电阻一端 → 电阻另一端 → LED 正端（${ledAnodePort}）。`,
        markersFromPorts([switchA, switchB, batteryPositive, ledAnode], connections)
      );
    } else if (!resistorAConnected && !resistorBConnected) {
      addIssue(
        state,
        `电阻完全没有接入电路，${resistorPortA} 和 ${resistorPortB} 两端都还是悬空的。正确连接方式：开关一端 → 电阻一端 → 电阻另一端 → LED 正端（${ledAnodePort}）。`,
        markersFromPorts([resistorA, resistorB, switchA, switchB, ledAnode], connections)
      );
    } else if (!switchAConnected || !switchBConnected) {
      const disconnectedPort = !switchAConnected ? switchA : switchB;
      const disconnectedPortLabel = !switchAConnected ? switchPortA : switchPortB;
      const connectedPort = switchAConnected ? switchA : switchB;
      const connectedPortLabel = switchAConnected ? switchPortA : switchPortB;

      const connectedToPositive = positiveToSwitchA || positiveToSwitchB;
      const connectedToResistor = switchToResistorA || switchToResistorB;

      if (connectedToPositive && !connectedToResistor) {
        addIssue(
          state,
          `开关 ${connectedPortLabel} 已连接到电池正极，但 ${disconnectedPortLabel} 还悬空。请把开关 ${disconnectedPortLabel} 连接到电阻的一端（${resistorPortA} 或 ${resistorPortB}）。`,
          markersFromPorts([disconnectedPort, resistorA, resistorB], connections)
        );
      } else if (connectedToResistor && !connectedToPositive) {
        addIssue(
          state,
          `开关 ${connectedPortLabel} 已连接到电阻，但 ${disconnectedPortLabel} 还悬空。请把开关 ${disconnectedPortLabel} 连接到电池正极（${batteryPosPort}）。`,
          markersFromPorts([disconnectedPort, batteryPositive], connections)
        );
      } else {
        addIssue(
          state,
          `开关只接入了一端（${connectedPortLabel}），${disconnectedPortLabel} 还悬空。电流无法完整经过开关再流向后续元件。请把悬空的那端也接入主回路。`,
          markersFromPorts([switchA, switchB, disconnectedPort], connections)
        );
      }
    } else if (!resistorAConnected || !resistorBConnected) {
      const disconnectedPort = !resistorAConnected ? resistorA : resistorB;
      const disconnectedPortLabel = !resistorAConnected ? resistorPortA : resistorPortB;
      const connectedPort = resistorAConnected ? resistorA : resistorB;
      const connectedPortLabel = resistorAConnected ? resistorPortA : resistorPortB;

      const connectedToSwitch = switchToResistorA || switchToResistorB;
      const connectedToLed = resistorToLedA || resistorToLedB;

      if (connectedToSwitch && !connectedToLed) {
        addIssue(
          state,
          `电阻 ${connectedPortLabel} 已连接到开关，但 ${disconnectedPortLabel} 还悬空。请把电阻 ${disconnectedPortLabel} 连接到 LED 正端（${ledAnodePort}）。`,
          markersFromPorts([disconnectedPort, ledAnode], connections)
        );
      } else if (connectedToLed && !connectedToSwitch) {
        addIssue(
          state,
          `电阻 ${connectedPortLabel} 已连接到 LED 正端，但 ${disconnectedPortLabel} 还悬空。请把电阻 ${disconnectedPortLabel} 连接到开关的一端（${switchPortA} 或 ${switchPortB}）。`,
          markersFromPorts([disconnectedPort, switchA, switchB], connections)
        );
      } else {
        addIssue(
          state,
          `电阻只接入了一端（${connectedPortLabel}），${disconnectedPortLabel} 还悬空。电流无法完整经过电阻再流向 LED。请把悬空的那端也接入主回路。`,
          markersFromPorts([resistorA, resistorB, disconnectedPort], connections)
        );
      }
    } else if (!positiveToSwitchA && !positiveToSwitchB) {
      addIssue(
        state,
        `电池正极（${batteryPosPort}）还没有连接到开关的任何一端。应该用导线把 ${batteryPosPort} 连接到 ${switchPortA} 或 ${switchPortB}。`,
        markersFromPorts([batteryPositive, switchA, switchB], connections)
      );
    } else if (!switchToResistorA && !switchToResistorB) {
      const positiveConnectedSwitchPort = positiveToSwitchA ? switchA : switchB;
      const positiveConnectedSwitchPortLabel = positiveToSwitchA ? switchPortA : switchPortB;
      const otherSwitchPort = positiveToSwitchA ? switchB : switchA;
      const otherSwitchPortLabel = positiveToSwitchA ? switchPortB : switchPortA;

      if (directPositiveToLed && !resistorToLedA && !resistorToLedB) {
        addIssue(
          state,
          `检测到电池正极（${batteryPosPort}）直接连到了 LED 正端（${ledAnodePort}），但开关 ${positiveConnectedSwitchPortLabel} 虽然连了电池正极，电阻却没有连到这条路径上。保护元件被旁路了，没有承担保护作用。正确连接：${batteryPosPort} → ${positiveConnectedSwitchPortLabel} → ${otherSwitchPortLabel} → 电阻一端 → 电阻另一端 → ${ledAnodePort}。`,
          mergeMarkers(
            markersFromPorts([batteryPositive, ledAnode, switchA, switchB, resistorA, resistorB], connections),
            markersFromPath(directPositiveToLed, connections)
          )
        );
      } else if (resistorOnlyPath && !switchOnlyPath) {
        addIssue(
          state,
          `电阻已经串入回路（电池正极 → 电阻 → LED），但开关被绕过了。正确顺序应该是：${batteryPosPort} → 开关 → 电阻 → ${ledAnodePort}。请确保电池正极先连到开关，再从开关连到电阻。`,
          mergeMarkers(
            markersFromPorts([batteryPositive, switchA, switchB, resistorA, resistorB], connections),
            bypassResistorPath ? markersFromPath(bypassResistorPath, connections) : null
          )
        );
      } else if (switchOnlyPath && !resistorOnlyPath) {
        addIssue(
          state,
          `开关已经串入回路（电池正极 → 开关 → LED），但电阻没有接到这条路径上。电阻应该在开关和 LED 之间。正确连接：${positiveConnectedSwitchPortLabel} → ${otherSwitchPortLabel} → 电阻一端 → 电阻另一端 → ${ledAnodePort}。`,
          mergeMarkers(
            markersFromPorts([switchA, switchB, resistorA, resistorB, ledAnode], connections),
            markersFromPath(switchOnlyPath, connections)
          )
        );
      } else {
        addIssue(
          state,
          `开关 ${positiveConnectedSwitchPortLabel} 已连接到电池正极，但开关另一端（${otherSwitchPortLabel}）还没有连接到电阻的任何一端。请用导线把 ${otherSwitchPortLabel} 连接到 ${resistorPortA} 或 ${resistorPortB}。`,
          markersFromPorts([otherSwitchPort, resistorA, resistorB], connections)
        );
      }
    } else if (!resistorToLedA && !resistorToLedB) {
      const positiveToLed = findPath(graph, batteryPositive, ledAnode);
      const switchConnectedResistorPort = switchToResistorA ? resistorA : resistorB;
      const switchConnectedResistorPortLabel = switchToResistorA ? resistorPortA : resistorPortB;
      const otherResistorPort = switchToResistorA ? resistorB : resistorA;
      const otherResistorPortLabel = switchToResistorA ? resistorPortB : resistorPortA;

      if (positiveToLed && positiveToLed.length > 0) {
        addIssue(
          state,
          `检测到电池正极（${batteryPosPort}）可以到达 LED 正端（${ledAnodePort}），但路径没有经过电阻。电阻被旁路了，没有承担保护作用。请删除旁路导线，确保电流必须经过电阻。`,
          mergeMarkers(
            markersFromPorts([batteryPositive, ledAnode, resistorA, resistorB], connections),
            markersFromPath(positiveToLed, connections)
          )
        );
      } else {
        addIssue(
          state,
          `电阻 ${switchConnectedResistorPortLabel} 已连接到开关，但电阻另一端（${otherResistorPortLabel}）还没有连接到 LED 正端（${ledAnodePort}）。请用导线把 ${otherResistorPortLabel} 连接到 ${ledAnodePort}。`,
          markersFromPorts([otherResistorPort, ledAnode], connections)
        );
      }
    } else {
      const positiveToSwitchPort = positiveToSwitchA ? switchA : switchB;
      const positiveToSwitchPortLabel = positiveToSwitchA ? switchPortA : switchPortB;
      const switchToResistorPort = switchToResistorA ? resistorA : resistorB;
      const switchToResistorPortLabel = switchToResistorA ? resistorPortA : resistorPortB;
      const resistorToLedPort = resistorToLedA ? resistorA : resistorB;
      const resistorToLedPortLabel = resistorToLedA ? resistorPortA : resistorPortB;

      if (switchToResistorPort === resistorToLedPort) {
        addIssue(
          state,
          `电阻的同一端（${switchToResistorPortLabel}）既连了开关又连了 LED。这相当于把电阻短路了，电流不会经过电阻内部。正确连接：开关应该连接到电阻的一端，LED 正端应该连接到电阻的另一端。`,
          markersFromPorts([switchToResistorPort, resistorA, resistorB, ledAnode], connections)
        );
      } else if (resistorOnlyPath && !switchOnlyPath) {
        addIssue(
          state,
          `虽然电阻串入了回路，但开关被绕过了。正确顺序应该是：${batteryPosPort} → 开关 → 电阻 → ${ledAnodePort}。请确保电池正极先经过开关，再到电阻。`,
          mergeMarkers(
            markersFromPorts([batteryPositive, switchA, switchB, resistorA, resistorB, ledAnode], connections),
            bypassSwitchPath ? markersFromPath(bypassSwitchPath, connections) : null
          )
        );
      } else {
        addIssue(
          state,
          `开关、电阻和 LED 的相对位置不对。当前连接不是标准串联保护结构。标准结构：${batteryPosPort} → 开关一端 → 开关另一端 → 电阻一端 → 电阻另一端 → ${ledAnodePort}。`,
          markersFromPorts([batteryPositive, switchA, switchB, resistorA, resistorB, ledAnode], connections)
        );
      }
    }

    if (ledBackPath) {
      addFinding(state, "LED 负端已经回到电池负极。");
    } else if (!ledCathodeConnected) {
      addIssue(
        state,
        `LED 负端（${ledCathodePort}）还没有接线。请用导线把 ${ledCathodePort} 连接到电池负极（${batteryNegPort}）。`,
        markersFromPorts([ledCathode, batteryNegative], connections)
      );
    } else {
      const partialPath = findPath(graph, ledCathode, batteryPositive);
      if (partialPath) {
        addIssue(
          state,
          `LED 负端（${ledCathodePort}）虽然有接线，但没有真正回到电池负极（${batteryNegPort}）。检查一下 ${ledCathodePort} 到 ${batteryNegPort} 的路径是否完整。`,
          mergeMarkers(
            markersFromPorts([ledCathode, batteryNegative], connections),
            markersFromPath(partialPath, connections)
          )
        );
      } else {
        addIssue(
          state,
          `LED 负端（${ledCathodePort}）虽然有接线，但还没有真正回到电池负极（${batteryNegPort}）。`,
          markersFromPorts([ledCathode, batteryNegative], connections)
        );
      }
    }

    if (bypassSwitchPath && orderedPath) {
      addIssue(
        state,
        "检测到存在绕过开关的旁路：电池正极可以不经过开关直接到达电阻或 LED，开关失去了控制作用。",
        mergeMarkers(
          markersFromPorts([switchA, switchB, batteryPositive, ledAnode], connections),
          markersFromPath(bypassSwitchPath, connections)
        )
      );
    } else if (bypassSwitchPath) {
      addIssue(
        state,
        "检测到存在绕过开关的旁路，开关失去了控制作用。",
        mergeMarkers(
          markersFromPorts([switchA, switchB, batteryPositive, ledAnode], connections),
          markersFromPath(bypassSwitchPath, connections)
        )
      );
    }

    if (bypassResistorPath && orderedPath) {
      addIssue(
        state,
        "检测到存在绕过电阻的旁路：电池正极可以不经过电阻直接到 LED 正端，所以电阻没有真正承担保护作用。",
        mergeMarkers(
          markersFromPorts([resistorA, resistorB, batteryPositive, ledAnode], connections),
          markersFromPath(bypassResistorPath, connections)
        )
      );
    } else if (bypassResistorPath) {
      addIssue(
        state,
        "检测到存在绕过电阻的旁路，电阻失去了保护作用。",
        mergeMarkers(
          markersFromPorts([resistorA, resistorB, batteryPositive, ledAnode], connections),
          markersFromPath(bypassResistorPath, connections)
        )
      );
    }

    if (!bypassSwitchPath && !bypassResistorPath && orderedPath && ledBackPath) {
      addFinding(state, "没有发现绕过开关或电阻的旁路连接。");
    }
  }

  function evaluateFuseLevel({ components, connections, graph, state }) {
    const battery = components.find((component) => component.id === "battery");
    const sw = components.find((component) => component.id === "switch");
    const fuse = components.find((component) => component.id === "fuse");
    const led = components.find((component) => component.id === "led");
    const lamp = components.find((component) => component.id === "lamp");

    if (!battery || !sw || !fuse) {
      return;
    }

    const load = led || lamp;
    if (!load) {
      addIssue(state, "缺少负载元件：请放置一个 LED 或小灯泡作为负载。");
      return;
    }

    const batteryPositive = resolvePort(battery.instanceId, "positive");
    const batteryNegative = resolvePort(battery.instanceId, "negative");
    const switchA = resolvePort(sw.instanceId, "a");
    const switchB = resolvePort(sw.instanceId, "b");
    const fuseA = resolvePort(fuse.instanceId, "a");
    const fuseB = resolvePort(fuse.instanceId, "b");

    const loadEntryPort = load.id === "led"
      ? resolvePort(load.instanceId, "anode")
      : resolvePort(load.instanceId, "a");
    const loadExitPort = load.id === "led"
      ? resolvePort(load.instanceId, "cathode")
      : resolvePort(load.instanceId, "b");

    const switchPortA = `${sw.instanceId}:a`;
    const switchPortB = `${sw.instanceId}:b`;
    const fusePortA = `${fuse.instanceId}:a`;
    const fusePortB = `${fuse.instanceId}:b`;
    const batteryPosPort = `${battery.instanceId}:positive`;
    const batteryNegPort = `${battery.instanceId}:negative`;
    const loadEntryPortLabel = load.id === "led" ? `${load.instanceId}:anode` : `${load.instanceId}:a`;
    const loadExitPortLabel = load.id === "led" ? `${load.instanceId}:cathode` : `${load.instanceId}:b`;

    const orderedPath = findSeriesPath(
      graph,
      batteryPositive,
      [
        [switchA, switchB],
        [fuseA, fuseB]
      ],
      loadEntryPort
    );

    const switchOnlyPath = findSeriesPath(
      graph,
      batteryPositive,
      [[switchA, switchB]],
      loadEntryPort
    );
    const fuseOnlyPath = findSeriesPath(
      graph,
      batteryPositive,
      [[fuseA, fuseB]],
      loadEntryPort
    );

    const loadBackPath = findPath(graph, loadExitPort, batteryNegative);
    const bypassSwitchPath = findPath(graph, batteryPositive, loadEntryPort, new Set([switchA, switchB]));
    const bypassFusePath = findPath(graph, batteryPositive, loadEntryPort, new Set([fuseA, fuseB]));
    const directPositiveToLoad = findPath(graph, batteryPositive, loadEntryPort);
    const positiveToSwitchA = findPath(graph, batteryPositive, switchA);
    const positiveToSwitchB = findPath(graph, batteryPositive, switchB);
    const switchToFuseA = findPath(graph, switchA, fuseA) || findPath(graph, switchB, fuseA);
    const switchToFuseB = findPath(graph, switchA, fuseB) || findPath(graph, switchB, fuseB);
    const fuseAToLoad = findPath(graph, fuseA, loadEntryPort);
    const fuseBToLoad = findPath(graph, fuseB, loadEntryPort);

    const fuseAConnected = (graph[fuseA] || new Set()).size > 0;
    const fuseBConnected = (graph[fuseB] || new Set()).size > 0;
    const switchAConnected = (graph[switchA] || new Set()).size > 0;
    const switchBConnected = (graph[switchB] || new Set()).size > 0;
    const loadExitConnected = (graph[loadExitPort] || new Set()).size > 0;

    const loadType = load.id === "led" ? "LED" : "小灯泡";

    if (orderedPath) {
      addFinding(state, `开关和保险丝都已经正确串入 ${loadType} 主回路。`);
    } else if (!switchAConnected && !switchBConnected) {
      addIssue(
        state,
        `开关完全没有接入电路，${switchPortA} 和 ${switchPortB} 两端都还是悬空的。正确连接方式：电池正极（${batteryPosPort}）→ 开关一端 → 开关另一端 → 保险丝一端 → 保险丝另一端 → ${loadType} 正端（${loadEntryPortLabel}）。`,
        markersFromPorts([switchA, switchB, batteryPositive, loadEntryPort], connections)
      );
    } else if (!fuseAConnected && !fuseBConnected) {
      addIssue(
        state,
        `保险丝完全没有接入电路，${fusePortA} 和 ${fusePortB} 两端都还是悬空的。正确连接方式：开关一端 → 保险丝一端 → 保险丝另一端 → ${loadType} 正端（${loadEntryPortLabel}）。`,
        markersFromPorts([fuseA, fuseB, switchA, switchB, loadEntryPort], connections)
      );
    } else if (!switchAConnected || !switchBConnected) {
      const disconnectedPort = !switchAConnected ? switchA : switchB;
      const disconnectedPortLabel = !switchAConnected ? switchPortA : switchPortB;
      const connectedPort = switchAConnected ? switchA : switchB;
      const connectedPortLabel = switchAConnected ? switchPortA : switchPortB;

      const connectedToPositive = positiveToSwitchA || positiveToSwitchB;
      const connectedToFuse = switchToFuseA || switchToFuseB;

      if (connectedToPositive && !connectedToFuse) {
        addIssue(
          state,
          `开关 ${connectedPortLabel} 已连接到电池正极，但 ${disconnectedPortLabel} 还悬空。请把开关 ${disconnectedPortLabel} 连接到保险丝的一端（${fusePortA} 或 ${fusePortB}）。`,
          markersFromPorts([disconnectedPort, fuseA, fuseB], connections)
        );
      } else if (connectedToFuse && !connectedToPositive) {
        addIssue(
          state,
          `开关 ${connectedPortLabel} 已连接到保险丝，但 ${disconnectedPortLabel} 还悬空。请把开关 ${disconnectedPortLabel} 连接到电池正极（${batteryPosPort}）。`,
          markersFromPorts([disconnectedPort, batteryPositive], connections)
        );
      } else {
        addIssue(
          state,
          `开关只接入了一端（${connectedPortLabel}），${disconnectedPortLabel} 还悬空。电流无法完整经过开关再流向后续元件。请把悬空的那端也接入主回路。`,
          markersFromPorts([switchA, switchB, disconnectedPort], connections)
        );
      }
    } else if (!fuseAConnected || !fuseBConnected) {
      const disconnectedPort = !fuseAConnected ? fuseA : fuseB;
      const disconnectedPortLabel = !fuseAConnected ? fusePortA : fusePortB;
      const connectedPort = fuseAConnected ? fuseA : fuseB;
      const connectedPortLabel = fuseAConnected ? fusePortA : fusePortB;

      const connectedToSwitch = switchToFuseA || switchToFuseB;
      const connectedToLoad = fuseAToLoad || fuseBToLoad;

      if (connectedToSwitch && !connectedToLoad) {
        addIssue(
          state,
          `保险丝 ${connectedPortLabel} 已连接到开关，但 ${disconnectedPortLabel} 还悬空。请把保险丝 ${disconnectedPortLabel} 连接到 ${loadType} 正端（${loadEntryPortLabel}）。`,
          markersFromPorts([disconnectedPort, loadEntryPort], connections)
        );
      } else if (connectedToLoad && !connectedToSwitch) {
        addIssue(
          state,
          `保险丝 ${connectedPortLabel} 已连接到 ${loadType} 正端，但 ${disconnectedPortLabel} 还悬空。请把保险丝 ${disconnectedPortLabel} 连接到开关的一端（${switchPortA} 或 ${switchPortB}）。`,
          markersFromPorts([disconnectedPort, switchA, switchB], connections)
        );
      } else {
        addIssue(
          state,
          `保险丝只接入了一端（${connectedPortLabel}），${disconnectedPortLabel} 还悬空。电流无法完整经过保险丝再流向 ${loadType}。请把悬空的那端也接入主回路。`,
          markersFromPorts([fuseA, fuseB, disconnectedPort], connections)
        );
      }
    } else if (!positiveToSwitchA && !positiveToSwitchB) {
      addIssue(
        state,
        `电池正极（${batteryPosPort}）还没有连接到开关的任何一端。应该用导线把 ${batteryPosPort} 连接到 ${switchPortA} 或 ${switchPortB}。`,
        markersFromPorts([batteryPositive, switchA, switchB], connections)
      );
    } else if (!switchToFuseA && !switchToFuseB) {
      const positiveConnectedSwitchPort = positiveToSwitchA ? switchA : switchB;
      const positiveConnectedSwitchPortLabel = positiveToSwitchA ? switchPortA : switchPortB;
      const otherSwitchPort = positiveToSwitchA ? switchB : switchA;
      const otherSwitchPortLabel = positiveToSwitchA ? switchPortB : switchPortA;

      if (directPositiveToLoad && !fuseAToLoad && !fuseBToLoad) {
        addIssue(
          state,
          `检测到电池正极（${batteryPosPort}）直接连到了 ${loadType} 正端（${loadEntryPortLabel}），但开关 ${positiveConnectedSwitchPortLabel} 虽然连了电池正极，保险丝却没有连到这条路径上。保护元件被旁路了，没有承担保护作用。正确连接：${batteryPosPort} → ${positiveConnectedSwitchPortLabel} → ${otherSwitchPortLabel} → 保险丝一端 → 保险丝另一端 → ${loadEntryPortLabel}。`,
          mergeMarkers(
            markersFromPorts([batteryPositive, loadEntryPort, switchA, switchB, fuseA, fuseB], connections),
            markersFromPath(directPositiveToLoad, connections)
          )
        );
      } else if (fuseOnlyPath && !switchOnlyPath) {
        addIssue(
          state,
          `保险丝已经串入回路（电池正极 → 保险丝 → ${loadType}），但开关被绕过了。正确顺序应该是：${batteryPosPort} → 开关 → 保险丝 → ${loadEntryPortLabel}。请确保电池正极先连到开关，再从开关连到保险丝。`,
          mergeMarkers(
            markersFromPorts([batteryPositive, switchA, switchB, fuseA, fuseB], connections),
            bypassFusePath ? markersFromPath(bypassFusePath, connections) : null
          )
        );
      } else if (switchOnlyPath && !fuseOnlyPath) {
        addIssue(
          state,
          `开关已经串入回路（电池正极 → 开关 → ${loadType}），但保险丝没有接到这条路径上。保险丝应该在开关和 ${loadType} 之间。正确连接：${positiveConnectedSwitchPortLabel} → ${otherSwitchPortLabel} → 保险丝一端 → 保险丝另一端 → ${loadEntryPortLabel}。`,
          mergeMarkers(
            markersFromPorts([switchA, switchB, fuseA, fuseB, loadEntryPort], connections),
            markersFromPath(switchOnlyPath, connections)
          )
        );
      } else {
        addIssue(
          state,
          `开关 ${positiveConnectedSwitchPortLabel} 已连接到电池正极，但开关另一端（${otherSwitchPortLabel}）还没有连接到保险丝的任何一端。请用导线把 ${otherSwitchPortLabel} 连接到 ${fusePortA} 或 ${fusePortB}。`,
          markersFromPorts([otherSwitchPort, fuseA, fuseB], connections)
        );
      }
    } else if (!fuseAToLoad && !fuseBToLoad) {
      const positiveToLoad = findPath(graph, batteryPositive, loadEntryPort);
      const switchConnectedFusePort = switchToFuseA ? fuseA : fuseB;
      const switchConnectedFusePortLabel = switchToFuseA ? fusePortA : fusePortB;
      const otherFusePort = switchToFuseA ? fuseB : fuseA;
      const otherFusePortLabel = switchToFuseA ? fusePortB : fusePortA;

      if (positiveToLoad && positiveToLoad.length > 0) {
        addIssue(
          state,
          `检测到电池正极（${batteryPosPort}）可以到达 ${loadType} 正端（${loadEntryPortLabel}），但路径没有经过保险丝。保险丝被旁路了，没有承担保护作用。请删除旁路导线，确保电流必须经过保险丝。`,
          mergeMarkers(
            markersFromPorts([batteryPositive, loadEntryPort, fuseA, fuseB], connections),
            markersFromPath(positiveToLoad, connections)
          )
        );
      } else {
        addIssue(
          state,
          `保险丝 ${switchConnectedFusePortLabel} 已连接到开关，但保险丝另一端（${otherFusePortLabel}）还没有连接到 ${loadType} 正端（${loadEntryPortLabel}）。请用导线把 ${otherFusePortLabel} 连接到 ${loadEntryPortLabel}。`,
          markersFromPorts([otherFusePort, loadEntryPort], connections)
        );
      }
    } else {
      const positiveToSwitchPort = positiveToSwitchA ? switchA : switchB;
      const positiveToSwitchPortLabel = positiveToSwitchA ? switchPortA : switchPortB;
      const switchToFusePort = switchToFuseA ? fuseA : fuseB;
      const switchToFusePortLabel = switchToFuseA ? fusePortA : fusePortB;
      const fuseToLoadPort = fuseAToLoad ? fuseA : fuseB;
      const fuseToLoadPortLabel = fuseAToLoad ? fusePortA : fusePortB;

      if (switchToFusePort === fuseToLoadPort) {
        addIssue(
          state,
          `保险丝的同一端（${switchToFusePortLabel}）既连了开关又连了 ${loadType}。这相当于把保险丝短路了，电流不会经过保险丝内部。正确连接：开关应该连接到保险丝的一端，${loadType} 正端应该连接到保险丝的另一端。`,
          markersFromPorts([switchToFusePort, fuseA, fuseB, loadEntryPort], connections)
        );
      } else if (fuseOnlyPath && !switchOnlyPath) {
        addIssue(
          state,
          `虽然保险丝串入了回路，但开关被绕过了。正确顺序应该是：${batteryPosPort} → 开关 → 保险丝 → ${loadEntryPortLabel}。请确保电池正极先经过开关，再到保险丝。`,
          mergeMarkers(
            markersFromPorts([batteryPositive, switchA, switchB, fuseA, fuseB, loadEntryPort], connections),
            bypassSwitchPath ? markersFromPath(bypassSwitchPath, connections) : null
          )
        );
      } else {
        addIssue(
          state,
          `开关、保险丝和 ${loadType} 的相对位置不对。当前连接不是标准串联保护结构。标准结构：${batteryPosPort} → 开关一端 → 开关另一端 → 保险丝一端 → 保险丝另一端 → ${loadEntryPortLabel}。`,
          markersFromPorts([batteryPositive, switchA, switchB, fuseA, fuseB, loadEntryPort], connections)
        );
      }
    }

    if (loadBackPath) {
      addFinding(state, `${loadType} 负端已经回到电池负极。`);
    } else if (!loadExitConnected) {
      addIssue(
        state,
        `${loadType} 负端（${loadExitPortLabel}）还没有接线。请用导线把 ${loadExitPortLabel} 连接到电池负极（${batteryNegPort}）。`,
        markersFromPorts([loadExitPort, batteryNegative], connections)
      );
    } else {
      const partialPath = findPath(graph, loadExitPort, batteryPositive);
      if (partialPath) {
        addIssue(
          state,
          `${loadType} 负端（${loadExitPortLabel}）虽然有接线，但没有真正回到电池负极（${batteryNegPort}）。检查一下 ${loadExitPortLabel} 到 ${batteryNegPort} 的路径是否完整。`,
          mergeMarkers(
            markersFromPorts([loadExitPort, batteryNegative], connections),
            markersFromPath(partialPath, connections)
          )
        );
      } else {
        addIssue(
          state,
          `${loadType} 负端（${loadExitPortLabel}）虽然有接线，但还没有真正回到电池负极（${batteryNegPort}）。`,
          markersFromPorts([loadExitPort, batteryNegative], connections)
        );
      }
    }

    if (bypassSwitchPath && orderedPath) {
      addIssue(
        state,
        `检测到存在绕过开关的旁路：电池正极（${batteryPosPort}）可以不经过开关直接到达保险丝或 ${loadType} 正端（${loadEntryPortLabel}），开关失去了控制作用。请删除旁路导线，确保电流必须经过开关。`,
        mergeMarkers(
          markersFromPorts([switchA, switchB, batteryPositive, loadEntryPort], connections),
          markersFromPath(bypassSwitchPath, connections)
        )
      );
    } else if (bypassSwitchPath) {
      addIssue(
        state,
        `检测到存在绕过开关的旁路，开关失去了控制作用。请删除旁路导线，确保电流必须经过开关。`,
        mergeMarkers(
          markersFromPorts([switchA, switchB, batteryPositive, loadEntryPort], connections),
          markersFromPath(bypassSwitchPath, connections)
        )
      );
    }

    if (bypassFusePath && orderedPath) {
      addIssue(
        state,
        `检测到存在绕过保险丝的旁路：电池正极（${batteryPosPort}）可以不经过保险丝直接到 ${loadType} 正端（${loadEntryPortLabel}）。所以保险丝没有真正承担保护作用。请删除旁路导线，确保电流必须经过保险丝。`,
        mergeMarkers(
          markersFromPorts([fuseA, fuseB, batteryPositive, loadEntryPort], connections),
          markersFromPath(bypassFusePath, connections)
        )
      );
    } else if (bypassFusePath) {
      addIssue(
        state,
        `检测到存在绕过保险丝的旁路，保险丝失去了保护作用。请删除旁路导线，确保电流必须经过保险丝。`,
        mergeMarkers(
          markersFromPorts([fuseA, fuseB, batteryPositive, loadEntryPort], connections),
          markersFromPath(bypassFusePath, connections)
        )
      );
    }

    if (!bypassSwitchPath && !bypassFusePath && orderedPath && loadBackPath) {
      addFinding(state, "没有发现绕过开关或保险丝的旁路连接。");
    }
  }

  function getDisplayName(componentId) {
    const map = {
      battery: "电池",
      led: "LED",
      switch: "开关",
      wire: "导线",
      lamp: "小灯泡",
      resistor: "电阻",
      fuse: "保险丝"
    };

    return map[componentId] || componentId;
  }

  window.CircuitValidator = {
    validate,
    getLevelScaffold
  };
})();
