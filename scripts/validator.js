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
    }
  };

  const OBJECTIVE_VALIDATORS = {
    "closed-led-loop": evaluateLedLoop,
    "switch-controls-led": evaluateSwitchLevel,
    "parallel-loads": evaluateParallelLevel,
    "resistor-protects-led": evaluateResistorLevel,
    "switch-protects-led": evaluateProtectedSwitchLevel
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

    const resistorAConnected = (graph[resistorA] || new Set()).size > 0;
    const resistorBConnected = (graph[resistorB] || new Set()).size > 0;
    const ledCathodeConnected = (graph[ledCathode] || new Set()).size > 0;

    if (throughResistorPath) {
      addFinding(state, "电阻已经正确串入 LED 主路径。");
    } else if (!resistorAConnected && !resistorBConnected) {
      addIssue(state, "电阻完全没有接入电路，两端都还是悬空的。", markersFromPorts([resistorA, resistorB], connections));
    } else if (!positiveToA && !positiveToB) {
      addIssue(
        state,
        "电池正极还没有先到电阻，主路径起点就错了。",
        markersFromPorts([batteryPositive, resistorA, resistorB], connections)
      );
    } else if (!aToLed && !bToLed) {
      addIssue(
        state,
        "电阻已经接到了主路径前半段，但它的另一端还没有接到 LED 正端。",
        markersFromPorts([resistorA, resistorB, ledAnode], connections)
      );
    } else if (!resistorAConnected || !resistorBConnected) {
      addIssue(
        state,
        "电阻只接入了一端，电流无法完整经过电阻再流向 LED。",
        markersFromPorts([resistorA, resistorB, ledAnode], connections)
      );
    } else {
      addIssue(
        state,
        "电阻和 LED 的相对位置还不对，电阻没有形成稳定的串联保护结构。",
        markersFromPorts([batteryPositive, resistorA, resistorB, ledAnode], connections)
      );
    }

    if (ledBackPath) {
      addFinding(state, "LED 负端已经回到电池负极。");
    } else if (!ledCathodeConnected) {
      addIssue(state, "LED 负端还没有接线，请把它接回电池负极。", markersFromPorts([ledCathode, batteryNegative], connections));
    } else {
      addIssue(state, "LED 负端虽然有接线，但还没有真正回到电池负极。", markersFromPorts([ledCathode, batteryNegative], connections));
    }

    if (!bypassPath && throughResistorPath) {
      addFinding(state, "没有发现绕过电阻直达 LED 的旁路。");
    } else if (bypassPath) {
      addIssue(
        state,
        "检测到存在绕过电阻的旁路：电池正极可以不经过电阻直接到 LED 正端，所以电阻没有真正承担保护作用。",
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

    const orderedPath = findSeriesPath(
      graph,
      batteryPositive,
      [
        [switchA, switchB],
        [resistorA, resistorB]
      ],
      ledAnode
    );
    const ledBackPath = findPath(graph, ledCathode, batteryNegative);
    const bypassSwitchPath = findPath(graph, batteryPositive, ledAnode, new Set([switchA, switchB]));
    const bypassResistorPath = findPath(graph, batteryPositive, ledAnode, new Set([resistorA, resistorB]));

    if (orderedPath) {
      addFinding(state, "开关和电阻都已经串入 LED 主回路。");
    } else {
      addIssue(
        state,
        "新任务还没有完成：需要把开关和电阻依次串入 LED 主回路。",
        markersFromPorts([batteryPositive, switchA, switchB, resistorA, resistorB, ledAnode], connections)
      );
    }

    if (ledBackPath) {
      addFinding(state, "LED 负端已经回到电池负极。");
    } else {
      addIssue(state, "LED 负端还没有回到电池负极。", markersFromPorts([ledCathode, batteryNegative], connections));
    }

    if (bypassSwitchPath) {
      addIssue(
        state,
        "检测到存在绕过开关的旁路，开关失去了控制作用。",
        mergeMarkers(
          markersFromPorts([switchA, switchB, batteryPositive, ledAnode], connections),
          markersFromPath(bypassSwitchPath, connections)
        )
      );
    }

    if (bypassResistorPath) {
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

  function getDisplayName(componentId) {
    const map = {
      battery: "电池",
      led: "LED",
      switch: "开关",
      wire: "导线",
      lamp: "小灯泡",
      resistor: "电阻"
    };

    return map[componentId] || componentId;
  }

  window.CircuitValidator = {
    validate,
    getLevelScaffold
  };
})();
