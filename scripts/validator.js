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
      startPrompt: "开始吧，做这道题目。先让电池正极接到电阻，再从电阻接到 LED 正端，最后把 LED 负端接回电池负极。",
      checkpoints: [
        "主路径顺序要像这样：电池正极 -> 电阻 -> LED 正端。",
        "LED 负端必须回到电池负极。",
        "不能存在绕过电阻直接到 LED 的旁路。",
        "第 4 关开始已经预留了可扩展验证骨架，后面可以继续加更细的教学规则。"
      ]
    }
  };

  const OBJECTIVE_VALIDATORS = {
    "closed-led-loop": evaluateLedLoop,
    "switch-controls-led": evaluateSwitchLevel,
    "parallel-loads": evaluateParallelLevel,
    "resistor-protects-led": evaluateResistorLevel
  };

  function getLevelScaffold(level) {
    if (!level || !level.objective) {
      return DEFAULT_SCAFFOLD;
    }
    return OBJECTIVE_SCAFFOLDS[level.objective] || DEFAULT_SCAFFOLD;
  }

  function buildGraph(components, connections, switchStates = {}) {
    const graph = {};

    components.forEach((component) => {
      (component.ports || []).forEach((port) => {
        const portId = resolvePort(component.instanceId, port.id);
        graph[portId] = graph[portId] || new Set();
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
    if (component.id === "led" || component.id === "battery") {
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
    if (!graph[from] || !graph[to] || blockedNodes.has(from) || blockedNodes.has(to)) {
      return false;
    }

    const queue = [from];
    const visited = new Set([from]);

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === to) {
        return true;
      }

      graph[current].forEach((next) => {
        if (!visited.has(next) && !blockedNodes.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      });
    }

    return false;
  }

  function resolvePort(instanceId, portId) {
    return `${instanceId}:${portId}`;
  }

  function getComponentsById(components, id) {
    return components.filter((component) => component.id === id);
  }

  function createValidationState(level) {
    const scaffold = getLevelScaffold(level);
    return {
      level,
      scaffold,
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

    (markers.instances || []).forEach((value) => {
      if (value) {
        state.errorInstances.add(value);
      }
    });

    (markers.ports || []).forEach((value) => {
      if (value) {
        state.errorPorts.add(value);
      }
    });

    (markers.connections || []).forEach((value) => {
      if (value) {
        state.errorConnections.add(value);
      }
    });
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

  function evaluateLedLoop({ components, graph, state }) {
    const battery = components.find((component) => component.id === "battery");
    const led = components.find((component) => component.id === "led");
    if (!battery || !led) {
      return;
    }

    const batteryPositive = resolvePort(battery.instanceId, "positive");
    const batteryNegative = resolvePort(battery.instanceId, "negative");
    const ledAnode = resolvePort(led.instanceId, "anode");
    const ledCathode = resolvePort(led.instanceId, "cathode");

    const posToAnode = hasPath(graph, batteryPositive, ledAnode);
    const cathodeToNegative = hasPath(graph, ledCathode, batteryNegative);

    if (posToAnode) {
      addFinding(state, "电池正极已经连接到 LED 正端。");
    } else {
      addIssue(state, "电池正极还没有有效连接到 LED 正端。", {
        instances: [battery.instanceId, led.instanceId],
        ports: [batteryPositive, ledAnode]
      });
    }

    if (cathodeToNegative) {
      addFinding(state, "LED 负端已经回到电池负极。");
    } else {
      addIssue(state, "LED 负端还没有回到电池负极。", {
        instances: [battery.instanceId, led.instanceId],
        ports: [ledCathode, batteryNegative]
      });
    }

    if (posToAnode && cathodeToNegative) {
      addFinding(state, "已经形成符合教学模型的闭合 LED 回路。");
    } else {
      addIssue(state, "电路没有形成完整闭合回路。", {
        instances: [battery.instanceId, led.instanceId]
      });
    }
  }

  function evaluateSwitchLevel({ components, graph, state }) {
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

    const throughSwitch =
      hasPath(graph, batteryPositive, switchA) &&
      hasPath(graph, switchB, ledAnode);
    const ledBack = hasPath(graph, ledCathode, batteryNegative);
    const bypassSwitch = hasPath(graph, batteryPositive, ledAnode, new Set([switchA, switchB]));

    if (throughSwitch) {
      addFinding(state, "主路径已经经过开关并连接到 LED。");
    } else {
      addIssue(state, "开关没有真正串入主回路，请让正极到 LED 的路径经过开关。", {
        instances: [battery.instanceId, sw.instanceId, led.instanceId],
        ports: [batteryPositive, switchA, switchB, ledAnode]
      });
    }

    if (ledBack) {
      addFinding(state, "LED 负端仍能回到电池负极。");
    } else {
      addIssue(state, "LED 负端没有回到电池负极，回路不完整。", {
        instances: [battery.instanceId, led.instanceId],
        ports: [ledCathode, batteryNegative]
      });
    }

    if (!bypassSwitch && throughSwitch) {
      addFinding(state, "没有发现绕过开关的旁路连接。");
    } else if (bypassSwitch) {
      addIssue(state, "检测到正极可以绕过开关直达 LED，开关失去了控制作用。", {
        instances: [battery.instanceId, sw.instanceId, led.instanceId],
        ports: [batteryPositive, ledAnode]
      });
    }
  }

  function evaluateParallelLevel({ components, graph, state }) {
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
    const seriesLike =
      hasPath(graph, firstExit, secondEntry) &&
      !hasPath(graph, batteryPositive, secondEntry);

    if (validBranches === 2) {
      addFinding(state, "两个负载都形成了各自通向电源负极的独立支路。");
    } else {
      addIssue(state, "两个负载还没有都形成独立支路，当前结构不够像标准并联。", {
        instances: loads.slice(0, 2).map((item) => item.instanceId)
      });
    }

    if (!seriesLike) {
      addFinding(state, "没有检测到明显的串联首尾连接。");
    } else {
      addIssue(state, "两个负载看起来被首尾串起来了，而不是并联。", {
        instances: [firstLoad.instanceId, secondLoad.instanceId],
        ports: [firstExit, secondEntry]
      });
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
    const blockedNodes = new Set([resistorA, resistorB]);

    const positiveToResistor =
      hasPath(graph, batteryPositive, resistorA) ||
      hasPath(graph, batteryPositive, resistorB);
    const resistorToLed =
      hasPath(graph, resistorA, ledAnode) ||
      hasPath(graph, resistorB, ledAnode);
    const ledBack = hasPath(graph, ledCathode, batteryNegative);
    const bypassResistor = hasPath(graph, batteryPositive, ledAnode, blockedNodes);

    if (positiveToResistor) {
      addFinding(state, "电池正极已经先接到电阻。");
    } else {
      addIssue(state, "电池正极还没有先连接到电阻。", {
        instances: [battery.instanceId, resistor.instanceId],
        ports: [batteryPositive, resistorA, resistorB]
      });
    }

    if (resistorToLed) {
      addFinding(state, "电阻已经串到 LED 正端之前。");
    } else {
      addIssue(state, "还没有形成从电阻到 LED 正端的主路径。", {
        instances: [resistor.instanceId, led.instanceId],
        ports: [resistorA, resistorB, ledAnode]
      });
    }

    if (ledBack) {
      addFinding(state, "LED 负端已经回到电池负极。");
    } else {
      addIssue(state, "LED 负端还没有回到电池负极。", {
        instances: [battery.instanceId, led.instanceId],
        ports: [ledCathode, batteryNegative]
      });
    }

    if (!bypassResistor && positiveToResistor && resistorToLed) {
      addFinding(state, "没有发现绕过电阻直达 LED 的旁路。");
    } else if (bypassResistor) {
      addIssue(state, "检测到正极可以绕过电阻直接到 LED，电阻没有真正串入主回路。", {
        instances: [battery.instanceId, resistor.instanceId, led.instanceId],
        ports: [batteryPositive, ledAnode]
      });

      connections.forEach((connection) => {
        const touchesLedAnode =
          connection.from === ledAnode ||
          connection.to === ledAnode;
        const touchesBatteryPositive =
          connection.from === batteryPositive ||
          connection.to === batteryPositive;

        if (touchesLedAnode || touchesBatteryPositive) {
          state.errorConnections.add(connection.id);
        }
      });
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
